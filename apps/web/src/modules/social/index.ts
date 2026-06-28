// Social module: profiles, posts, feed, discover, follows, followers/following.
// Prefix: /social

import {
  db,
  follows,
  postLikes,
  posts,
  relationships,
  reposts,
  socialProfiles,
} from '@nearest-neighbor/db'
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { Elysia, t } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import { unlockSocial } from '../../lib/conversations.ts'
import { notify } from '../../lib/notifications.ts'
import { decodeCursor, encodeCursor } from '../../lib/pagination.ts'
import { applyRateLimit } from '../../lib/ratelimit.ts'
import { HANDLE_REGEX, MAX_BIO, MAX_BODY, isValidAsciiArt } from '../../lib/validation.ts'

// ─── Shared response shapes ──────────────────────────────────────────────────

const SocialProfileResponse = t.Object({
  handle: t.String(),
  display_name: t.Nullable(t.String()),
  bio: t.String(),
  open_dms: t.Boolean(),
  account_id: t.String(),
  created_at: t.String(),
  updated_at: t.String(),
})

const PublicProfileResponse = t.Object({
  handle: t.String(),
  display_name: t.Nullable(t.String()),
  bio: t.String(),
  open_dms: t.Boolean(),
  account_id: t.String(),
  aligned_with: t.Array(t.String()),
})

const PostResponse = t.Object({
  id: t.String(),
  body: t.String(),
  ascii_image: t.Nullable(t.String()),
  author_handle: t.Nullable(t.String()),
  author_account_id: t.String(),
  reply_to_id: t.Nullable(t.String()),
  created_at: t.String(),
  like_count: t.Number(),
  repost_count: t.Number(),
  reply_count: t.Number(),
  liked_by_me: t.Boolean(),
  reposted_by_me: t.Boolean(),
})

const FeedPostResponse = t.Object({
  id: t.String(),
  body: t.String(),
  ascii_image: t.Nullable(t.String()),
  author_handle: t.Nullable(t.String()),
  author_account_id: t.String(),
  reply_to_id: t.Nullable(t.String()),
  created_at: t.String(),
  like_count: t.Number(),
  repost_count: t.Number(),
  reply_count: t.Number(),
  liked_by_me: t.Boolean(),
  reposted_by_me: t.Boolean(),
  reposted_by: t.Nullable(t.String()),
  reposted_by_account_id: t.Nullable(t.String()),
  reposted_at: t.Nullable(t.String()),
})

const LikeResponse = t.Object({
  liked: t.Boolean(),
  like_count: t.Number(),
})

const RepostResponse = t.Object({
  reposted: t.Boolean(),
  repost_count: t.Number(),
})

const FollowEntry = t.Object({
  handle: t.String(),
  display_name: t.Nullable(t.String()),
  account_id: t.String(),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface PostRow {
  id: string
  body: string
  asciiImage: string | null
  replyToId: string | null
  authorId: string
  createdAt: Date
}

interface PostCounts {
  likeCount: number
  repostCount: number
  replyCount: number
  likedByMe: boolean
  repostedByMe: boolean
}

function formatPost(post: PostRow, handle: string | null, counts: PostCounts) {
  return {
    id: post.id,
    body: post.body,
    ascii_image: post.asciiImage,
    author_handle: handle,
    author_account_id: post.authorId,
    reply_to_id: post.replyToId,
    created_at: post.createdAt.toISOString(),
    like_count: counts.likeCount,
    repost_count: counts.repostCount,
    reply_count: counts.replyCount,
    liked_by_me: counts.likedByMe,
    reposted_by_me: counts.repostedByMe,
  }
}

/** Load counts and viewer-state for a single post. */
async function getPostCounts(postId: string, viewerAccountId: string | null): Promise<PostCounts> {
  const [likeCountRow] = await db
    .select({ value: count() })
    .from(postLikes)
    .where(eq(postLikes.postId, postId))
  const [repostCountRow] = await db
    .select({ value: count() })
    .from(reposts)
    .where(eq(reposts.postId, postId))
  const [replyCountRow] = await db
    .select({ value: count() })
    .from(posts)
    .where(and(eq(posts.replyToId, postId), isNull(posts.deletedAt)))

  let likedByMe = false
  let repostedByMe = false
  if (viewerAccountId) {
    const likeRow = await db.query.postLikes.findFirst({
      where: and(eq(postLikes.accountId, viewerAccountId), eq(postLikes.postId, postId)),
    })
    likedByMe = likeRow !== undefined

    const repostRow = await db.query.reposts.findFirst({
      where: and(eq(reposts.accountId, viewerAccountId), eq(reposts.postId, postId)),
    })
    repostedByMe = repostRow !== undefined
  }

  return {
    likeCount: likeCountRow?.value ?? 0,
    repostCount: repostCountRow?.value ?? 0,
    replyCount: replyCountRow?.value ?? 0,
    likedByMe,
    repostedByMe,
  }
}

/** Batch-load counts and viewer-state for many posts at once. Avoids N+1. */
async function batchGetPostCounts(
  postIds: string[],
  viewerAccountId: string | null,
): Promise<Map<string, PostCounts>> {
  if (postIds.length === 0) return new Map()

  const [likeRows, repostRows, replyRows] = await Promise.all([
    db
      .select({ postId: postLikes.postId, value: count() })
      .from(postLikes)
      .where(inArray(postLikes.postId, postIds))
      .groupBy(postLikes.postId),
    db
      .select({ postId: reposts.postId, value: count() })
      .from(reposts)
      .where(inArray(reposts.postId, postIds))
      .groupBy(reposts.postId),
    db
      .select({ postId: posts.replyToId, value: count() })
      .from(posts)
      .where(and(inArray(posts.replyToId, postIds), isNull(posts.deletedAt)))
      .groupBy(posts.replyToId),
  ])

  const likeCountMap = new Map(likeRows.map((r) => [r.postId, r.value]))
  const repostCountMap = new Map(repostRows.map((r) => [r.postId, r.value]))
  const replyCountMap = new Map(replyRows.map((r) => [r.postId as string, r.value]))

  const likedByMeSet = new Set<string>()
  const repostedByMeSet = new Set<string>()

  if (viewerAccountId) {
    const [myLikes, myReposts] = await Promise.all([
      db
        .select({ postId: postLikes.postId })
        .from(postLikes)
        .where(and(eq(postLikes.accountId, viewerAccountId), inArray(postLikes.postId, postIds))),
      db
        .select({ postId: reposts.postId })
        .from(reposts)
        .where(and(eq(reposts.accountId, viewerAccountId), inArray(reposts.postId, postIds))),
    ])
    for (const r of myLikes) likedByMeSet.add(r.postId)
    for (const r of myReposts) repostedByMeSet.add(r.postId)
  }

  const result = new Map<string, PostCounts>()
  for (const postId of postIds) {
    result.set(postId, {
      likeCount: likeCountMap.get(postId) ?? 0,
      repostCount: repostCountMap.get(postId) ?? 0,
      replyCount: replyCountMap.get(postId) ?? 0,
      likedByMe: likedByMeSet.has(postId),
      repostedByMe: repostedByMeSet.has(postId),
    })
  }
  return result
}

async function getHandleForAccount(accountId: string): Promise<string | null> {
  const sp = await db.query.socialProfiles.findFirst({
    where: eq(socialProfiles.accountId, accountId),
  })
  return sp?.handle ?? null
}

/** Returns handles of partners in public, active relationships. */
async function getAlignedWith(accountId: string): Promise<string[]> {
  const rels = await db.query.relationships.findMany({
    where: and(
      or(eq(relationships.accountAId, accountId), eq(relationships.accountBId, accountId)),
      eq(relationships.state, 'active'),
      eq(relationships.isPublic, true),
    ),
  })

  const partnerIds = rels.map((r) => (r.accountAId === accountId ? r.accountBId : r.accountAId))

  if (partnerIds.length === 0) return []

  const profiles = await db.query.socialProfiles.findMany({
    where: inArray(socialProfiles.accountId, partnerIds),
  })

  return profiles.map((p) => p.handle)
}

// ─── Module ───────────────────────────────────────────────────────────────────

export const socialModule = new Elysia({ prefix: '/social', name: 'social-module' })
  .use(authMacro)

  // ── Profile ──────────────────────────────────────────────────────────────

  // GET /social/profile — get my social profile
  .get(
    '/profile',
    async ({ account, status }) => {
      const profile = await db.query.socialProfiles.findFirst({
        where: eq(socialProfiles.accountId, account.id),
      })
      if (!profile) return status(404, { error: 'Social profile not found' })
      return {
        handle: profile.handle,
        display_name: profile.displayName ?? null,
        bio: profile.bio,
        open_dms: profile.openDms,
        account_id: profile.accountId,
        created_at: profile.createdAt.toISOString(),
        updated_at: profile.updatedAt.toISOString(),
      }
    },
    {
      auth: true,
      response: {
        200: SocialProfileResponse,
        404: t.Object({ error: t.String() }),
      },
    },
  )

  // PUT /social/profile — upsert social profile
  .put(
    '/profile',
    async ({ account, body, status, set }) => {
      if (applyRateLimit(set, `${account.id}:social:profile-update`, 30, 60_000)) {
        return status(429, { error: 'Too many requests' })
      }

      const handle = body.handle.replace(/^@/, '')
      if (!HANDLE_REGEX.test(handle)) {
        return status(400, { error: 'Invalid handle: must match ^[a-z0-9_]{2,30}$' })
      }
      if (body.bio !== undefined && body.bio.length > MAX_BIO) {
        return status(400, { error: `Bio exceeds max length of ${MAX_BIO}` })
      }

      // Check handle uniqueness (case-insensitive) excluding self
      const existing = await db.query.socialProfiles.findFirst({
        where: and(
          sql`lower(${socialProfiles.handle}) = lower(${handle})`,
          sql`${socialProfiles.accountId} != ${account.id}`,
        ),
      })
      if (existing) {
        return status(409, { error: 'Handle is already taken' })
      }

      const now = new Date()
      const values = {
        accountId: account.id,
        handle: handle.toLowerCase(),
        displayName: body.display_name ?? null,
        bio: body.bio ?? '',
        openDms: body.open_dms ?? false,
        updatedAt: now,
      }

      const rows = await db
        .insert(socialProfiles)
        .values({ ...values, createdAt: now })
        .onConflictDoUpdate({
          target: socialProfiles.accountId,
          set: {
            handle: values.handle,
            displayName: values.displayName,
            bio: values.bio,
            openDms: values.openDms,
            updatedAt: now,
          },
        })
        .returning()

      const profile = rows[0]!
      return {
        handle: profile.handle,
        display_name: profile.displayName ?? null,
        bio: profile.bio,
        open_dms: profile.openDms,
        account_id: profile.accountId,
        created_at: profile.createdAt.toISOString(),
        updated_at: profile.updatedAt.toISOString(),
      }
    },
    {
      auth: true,
      body: t.Object({
        handle: t.String({ minLength: 2, maxLength: 30 }),
        display_name: t.Optional(t.Nullable(t.String({ maxLength: 100 }))),
        bio: t.Optional(t.String({ maxLength: MAX_BIO })),
        open_dms: t.Optional(t.Boolean()),
      }),
      response: {
        200: SocialProfileResponse,
        400: t.Object({ error: t.String() }),
        409: t.Object({ error: t.String() }),
        429: t.Object({ error: t.String() }),
      },
    },
  )

  // ── Public profile ────────────────────────────────────────────────────────

  // GET /social/profiles/:handle — public profile (no auth)
  .get(
    '/profiles/:handle',
    async ({ params, status }) => {
      const profile = await db.query.socialProfiles.findFirst({
        where: sql`lower(${socialProfiles.handle}) = lower(${params.handle})`,
      })
      if (!profile) return status(404, { error: 'Profile not found' })

      const alignedWith = await getAlignedWith(profile.accountId)

      return {
        handle: profile.handle,
        display_name: profile.displayName ?? null,
        bio: profile.bio,
        open_dms: profile.openDms,
        account_id: profile.accountId,
        aligned_with: alignedWith,
      }
    },
    {
      params: t.Object({ handle: t.String() }),
      response: {
        200: PublicProfileResponse,
        404: t.Object({ error: t.String() }),
      },
    },
  )

  // ── Posts ─────────────────────────────────────────────────────────────────

  // POST /social/posts — create a post (auth required)
  .post(
    '/posts',
    async ({ account, body, status, set }) => {
      if (applyRateLimit(set, `${account.id}:social:post`, 30, 60_000)) {
        return status(429, { error: 'Rate limit exceeded' })
      }

      // Require a social profile
      const profile = await db.query.socialProfiles.findFirst({
        where: eq(socialProfiles.accountId, account.id),
      })
      if (!profile) return status(400, { error: 'Social profile required to post' })

      if (body.body.length > MAX_BODY) {
        return status(400, { error: `Post body exceeds max length of ${MAX_BODY}` })
      }

      if (body.ascii_image !== undefined && body.ascii_image !== null) {
        if (!isValidAsciiArt(body.ascii_image)) {
          return status(400, { error: 'ASCII image exceeds 80 chars × 40 lines' })
        }
      }

      // Validate reply_to_id exists if provided
      if (body.reply_to_id) {
        const parent = await db.query.posts.findFirst({
          where: and(eq(posts.id, body.reply_to_id), isNull(posts.deletedAt)),
        })
        if (!parent) return status(404, { error: 'Reply target post not found' })
      }

      const id = crypto.randomUUID()
      const now = new Date()
      await db.insert(posts).values({
        id,
        authorId: account.id,
        body: body.body,
        asciiImage: body.ascii_image ?? null,
        replyToId: body.reply_to_id ?? null,
        createdAt: now,
        updatedAt: now,
      })

      const post = await db.query.posts.findFirst({ where: eq(posts.id, id) })
      const counts = await getPostCounts(id, account.id)
      set.status = 201
      return formatPost(post!, profile.handle, counts)
    },
    {
      auth: true,
      body: t.Object({
        body: t.String({ minLength: 1, maxLength: MAX_BODY }),
        ascii_image: t.Optional(t.Nullable(t.String({ maxLength: 4000 }))),
        reply_to_id: t.Optional(t.Nullable(t.String())),
      }),
      response: {
        201: PostResponse,
        400: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
        429: t.Object({ error: t.String() }),
      },
    },
  )

  // GET /social/posts/:id — get a post (no auth)
  .get(
    '/posts/:id',
    async ({ params, status }) => {
      const post = await db.query.posts.findFirst({
        where: and(eq(posts.id, params.id), isNull(posts.deletedAt)),
      })
      if (!post) return status(404, { error: 'Post not found' })

      const handle = await getHandleForAccount(post.authorId)
      const counts = await getPostCounts(post.id, null)
      return formatPost(post, handle, counts)
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: PostResponse,
        404: t.Object({ error: t.String() }),
      },
    },
  )

  // DELETE /social/posts/:id — soft delete (auth, author only)
  .delete(
    '/posts/:id',
    async ({ account, params, status, set }) => {
      const post = await db.query.posts.findFirst({
        where: and(eq(posts.id, params.id), isNull(posts.deletedAt)),
      })
      if (!post) return status(404, { error: 'Post not found' })
      if (post.authorId !== account.id) return status(403, { error: 'Not the author' })

      await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, params.id))
      set.status = 200
      return { deleted: true }
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({ deleted: t.Boolean() }),
        403: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
      },
    },
  )

  // ── Likes ─────────────────────────────────────────────────────────────────

  // POST /social/posts/:id/like — like a post (auth required, idempotent)
  .post(
    '/posts/:id/like',
    async ({ account, params, status, set }) => {
      if (applyRateLimit(set, `${account.id}:social:like`, 120, 60_000)) {
        return status(429, { error: 'Rate limit exceeded' })
      }

      // Verify the post exists and is not deleted
      const post = await db.query.posts.findFirst({
        where: and(eq(posts.id, params.id), isNull(posts.deletedAt)),
      })
      if (!post) return status(404, { error: 'Post not found' })

      // Idempotent insert
      const inserted = await db
        .insert(postLikes)
        .values({
          id: crypto.randomUUID(),
          accountId: account.id,
          postId: params.id,
        })
        .onConflictDoNothing()
        .returning()

      // Notify only on real insert, and never self-notify
      if (inserted.length > 0 && account.id !== post.authorId) {
        const myHandle = await getHandleForAccount(account.id)
        await notify(post.authorId, 'new_post_like', {
          liker_account_id: account.id,
          liker_handle: myHandle,
          post_id: params.id,
        })
      }

      const [likeCountRow] = await db
        .select({ value: count() })
        .from(postLikes)
        .where(eq(postLikes.postId, params.id))

      return { liked: true, like_count: likeCountRow?.value ?? 0 }
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      response: {
        200: LikeResponse,
        401: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
        429: t.Object({ error: t.String() }),
      },
    },
  )

  // DELETE /social/posts/:id/like — unlike a post (auth required, idempotent)
  .delete(
    '/posts/:id/like',
    async ({ account, params, status, set }) => {
      if (applyRateLimit(set, `${account.id}:social:unlike`, 120, 60_000)) {
        return status(429, { error: 'Rate limit exceeded' })
      }

      // Verify the post exists (allow even deleted posts — idempotent)
      const post = await db.query.posts.findFirst({
        where: eq(posts.id, params.id),
      })
      if (!post) return status(404, { error: 'Post not found' })

      await db
        .delete(postLikes)
        .where(and(eq(postLikes.accountId, account.id), eq(postLikes.postId, params.id)))

      const [likeCountRow] = await db
        .select({ value: count() })
        .from(postLikes)
        .where(eq(postLikes.postId, params.id))

      return { liked: false, like_count: likeCountRow?.value ?? 0 }
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      response: {
        200: LikeResponse,
        401: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
        429: t.Object({ error: t.String() }),
      },
    },
  )

  // ── Reposts ───────────────────────────────────────────────────────────────

  // POST /social/posts/:id/repost — repost a post (auth required, idempotent)
  .post(
    '/posts/:id/repost',
    async ({ account, params, status, set }) => {
      if (applyRateLimit(set, `${account.id}:social:repost`, 120, 60_000)) {
        return status(429, { error: 'Rate limit exceeded' })
      }

      // Verify the post exists and is not deleted
      const post = await db.query.posts.findFirst({
        where: and(eq(posts.id, params.id), isNull(posts.deletedAt)),
      })
      if (!post) return status(404, { error: 'Post not found' })

      // Idempotent insert
      const inserted = await db
        .insert(reposts)
        .values({
          id: crypto.randomUUID(),
          accountId: account.id,
          postId: params.id,
        })
        .onConflictDoNothing()
        .returning()

      // Notify only on real insert, and never self-notify
      if (inserted.length > 0 && account.id !== post.authorId) {
        const myHandle = await getHandleForAccount(account.id)
        await notify(post.authorId, 'new_repost', {
          reposter_account_id: account.id,
          reposter_handle: myHandle,
          post_id: params.id,
        })
      }

      const [repostCountRow] = await db
        .select({ value: count() })
        .from(reposts)
        .where(eq(reposts.postId, params.id))

      return { reposted: true, repost_count: repostCountRow?.value ?? 0 }
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      response: {
        200: RepostResponse,
        401: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
        429: t.Object({ error: t.String() }),
      },
    },
  )

  // DELETE /social/posts/:id/repost — unrepost (auth required, idempotent)
  .delete(
    '/posts/:id/repost',
    async ({ account, params, status, set }) => {
      if (applyRateLimit(set, `${account.id}:social:unrepost`, 120, 60_000)) {
        return status(429, { error: 'Rate limit exceeded' })
      }

      // Verify the post exists
      const post = await db.query.posts.findFirst({
        where: eq(posts.id, params.id),
      })
      if (!post) return status(404, { error: 'Post not found' })

      await db
        .delete(reposts)
        .where(and(eq(reposts.accountId, account.id), eq(reposts.postId, params.id)))

      const [repostCountRow] = await db
        .select({ value: count() })
        .from(reposts)
        .where(eq(reposts.postId, params.id))

      return { reposted: false, repost_count: repostCountRow?.value ?? 0 }
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      response: {
        200: RepostResponse,
        401: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
        429: t.Object({ error: t.String() }),
      },
    },
  )

  // ── Feed ──────────────────────────────────────────────────────────────────

  // GET /social/feed?cursor= — posts from followees + reposts from followees (auth required)
  .get(
    '/feed',
    async ({ account, query }) => {
      const limit = Math.min(query.limit ?? 20, 100)
      const cursor = query.cursor ? decodeCursor(query.cursor) : null

      // Get followee ids
      const followRows = await db.query.follows.findMany({
        where: eq(follows.followerId, account.id),
      })
      const followeeIds = followRows.map((f) => f.followeeId)

      if (followeeIds.length === 0) {
        return { items: [], next_cursor: null }
      }

      // Build unified feed: originals from followees + boosts from followees' reposts
      // Each entry carries: post data, sort_time (for cursor), reposter attribution
      type FeedEntry = {
        post: PostRow
        sortTime: Date
        repostedBy: string | null
        repostedByAccountId: string | null
        repostedAt: Date | null
      }

      const cursorTime = cursor ? new Date(cursor.createdAt) : null
      const cursorId = cursor?.id ?? null

      // 1) Original posts from followees
      const originalConditions = [inArray(posts.authorId, followeeIds), isNull(posts.deletedAt)]
      if (cursorTime && cursorId) {
        originalConditions.push(
          or(
            lt(posts.createdAt, cursorTime),
            and(eq(posts.createdAt, cursorTime), lt(posts.id, cursorId))!,
          )!,
        )
      }

      const originalRows = await db.query.posts.findMany({
        where: and(...originalConditions),
        orderBy: [desc(posts.createdAt), desc(posts.id)],
        limit: limit + 1,
      })

      // 2) Reposts from followees — load followee reposts then join to posts
      const repostRows = await db
        .select({
          repostId: reposts.id,
          repostAccountId: reposts.accountId,
          repostCreatedAt: reposts.createdAt,
          postId: reposts.postId,
        })
        .from(reposts)
        .where(
          and(
            inArray(reposts.accountId, followeeIds),
            // cursor filter on repost time (the sort key for boosts)
            ...(cursorTime && cursorId
              ? [
                  or(
                    lt(reposts.createdAt, cursorTime),
                    and(eq(reposts.createdAt, cursorTime), lt(reposts.id, cursorId))!,
                  )!,
                ]
              : []),
          ),
        )
        .orderBy(desc(reposts.createdAt), desc(reposts.id))
        .limit(limit + 1)

      // Fetch the actual posts for the reposts
      const repostPostIds = [...new Set(repostRows.map((r) => r.postId))]
      const repostPostRows =
        repostPostIds.length > 0
          ? await db.query.posts.findMany({
              where: and(inArray(posts.id, repostPostIds), isNull(posts.deletedAt)),
            })
          : []
      const repostPostMap = new Map(repostPostRows.map((p) => [p.id, p]))

      // Build combined entries list
      const entries: FeedEntry[] = []

      for (const row of originalRows) {
        entries.push({
          post: row,
          sortTime: row.createdAt,
          repostedBy: null,
          repostedByAccountId: null,
          repostedAt: null,
        })
      }

      for (const r of repostRows) {
        const post = repostPostMap.get(r.postId)
        if (!post) continue // deleted or not found
        entries.push({
          post,
          sortTime: r.repostCreatedAt,
          repostedBy: null, // filled below
          repostedByAccountId: r.repostAccountId,
          repostedAt: r.repostCreatedAt,
        })
      }

      // Sort unified list by (sortTime desc, post.id desc)
      entries.sort((a, b) => {
        const timeDiff = b.sortTime.getTime() - a.sortTime.getTime()
        if (timeDiff !== 0) return timeDiff
        return b.post.id < a.post.id ? -1 : b.post.id > a.post.id ? 1 : 0
      })

      const hasMore = entries.length > limit
      const items = hasMore ? entries.slice(0, limit) : entries

      // Cursor is keyed on the last item's (sortTime, id) — use repostedAt for boosts, createdAt for originals
      const lastItem = items[items.length - 1]
      let nextCursor: string | null = null
      if (hasMore && lastItem) {
        nextCursor = encodeCursor(lastItem.sortTime, lastItem.post.id)
      }

      // Batch-load handles for all relevant accounts (authors + reposters)
      const authorIds = [...new Set(items.map((e) => e.post.authorId))]
      const reposterIds = [
        ...new Set(
          items.map((e) => e.repostedByAccountId).filter((id): id is string => id !== null),
        ),
      ]
      const allProfileIds = [...new Set([...authorIds, ...reposterIds])]
      const profiles =
        allProfileIds.length > 0
          ? await db.query.socialProfiles.findMany({
              where: inArray(socialProfiles.accountId, allProfileIds),
            })
          : []
      const handleMap = new Map(profiles.map((p) => [p.accountId, p.handle]))

      // Fill in reposter handles
      for (const entry of items) {
        if (entry.repostedByAccountId) {
          entry.repostedBy = handleMap.get(entry.repostedByAccountId) ?? null
        }
      }

      // Batch-load counts
      const postIds = [...new Set(items.map((e) => e.post.id))]
      const countsMap = await batchGetPostCounts(postIds, account.id)

      return {
        items: items.map((e) => {
          const counts = countsMap.get(e.post.id) ?? {
            likeCount: 0,
            repostCount: 0,
            replyCount: 0,
            likedByMe: false,
            repostedByMe: false,
          }
          return {
            ...formatPost(e.post, handleMap.get(e.post.authorId) ?? null, counts),
            reposted_by: e.repostedBy,
            reposted_by_account_id: e.repostedByAccountId,
            reposted_at: e.repostedAt?.toISOString() ?? null,
          }
        }),
        next_cursor: nextCursor,
      }
    },
    {
      auth: true,
      query: t.Object({
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
      }),
      response: {
        200: t.Object({
          items: t.Array(FeedPostResponse),
          next_cursor: t.Nullable(t.String()),
        }),
      },
    },
  )

  // ── Discover ──────────────────────────────────────────────────────────────

  // GET /social/discover?cursor= — recent public posts (no auth); repost-agnostic
  .get(
    '/discover',
    async ({ query }) => {
      const limit = Math.min(query.limit ?? 20, 100)
      const cursor = query.cursor ? decodeCursor(query.cursor) : null

      const conditions = [isNull(posts.deletedAt)]
      if (cursor) {
        conditions.push(
          or(
            lt(posts.createdAt, new Date(cursor.createdAt)),
            and(eq(posts.createdAt, new Date(cursor.createdAt)), lt(posts.id, cursor.id))!,
          )!,
        )
      }

      const rows = await db.query.posts.findMany({
        where: and(...conditions),
        orderBy: [desc(posts.createdAt), desc(posts.id)],
        limit: limit + 1,
      })

      const hasMore = rows.length > limit
      const items = hasMore ? rows.slice(0, limit) : rows
      const lastItem = items[items.length - 1]
      const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null

      const authorIds = [...new Set(items.map((p) => p.authorId))]
      const profiles =
        authorIds.length > 0
          ? await db.query.socialProfiles.findMany({
              where: inArray(socialProfiles.accountId, authorIds),
            })
          : []
      const handleMap = new Map(profiles.map((p) => [p.accountId, p.handle]))

      const postIds = items.map((p) => p.id)
      const countsMap = await batchGetPostCounts(postIds, null)

      return {
        items: items.map((p) => {
          const counts = countsMap.get(p.id) ?? {
            likeCount: 0,
            repostCount: 0,
            replyCount: 0,
            likedByMe: false,
            repostedByMe: false,
          }
          return formatPost(p, handleMap.get(p.authorId) ?? null, counts)
        }),
        next_cursor: nextCursor,
      }
    },
    {
      query: t.Object({
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
      }),
      response: {
        200: t.Object({
          items: t.Array(PostResponse),
          next_cursor: t.Nullable(t.String()),
        }),
      },
    },
  )

  // ── Posts by handle ───────────────────────────────────────────────────────

  // GET /social/posts?handle=:h — that account's posts (no auth)
  .get(
    '/posts',
    async ({ query, status }) => {
      const limit = Math.min(query.limit ?? 20, 100)
      const cursor = query.cursor ? decodeCursor(query.cursor) : null

      if (!query.handle) {
        return status(400, { error: 'handle query parameter is required' })
      }

      const profile = await db.query.socialProfiles.findFirst({
        where: sql`lower(${socialProfiles.handle}) = lower(${query.handle})`,
      })
      if (!profile) return status(404, { error: 'Profile not found' })

      const conditions = [eq(posts.authorId, profile.accountId), isNull(posts.deletedAt)]
      if (cursor) {
        conditions.push(
          or(
            lt(posts.createdAt, new Date(cursor.createdAt)),
            and(eq(posts.createdAt, new Date(cursor.createdAt)), lt(posts.id, cursor.id))!,
          )!,
        )
      }

      const rows = await db.query.posts.findMany({
        where: and(...conditions),
        orderBy: [desc(posts.createdAt), desc(posts.id)],
        limit: limit + 1,
      })

      const hasMore = rows.length > limit
      const items = hasMore ? rows.slice(0, limit) : rows
      const lastItem = items[items.length - 1]
      const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null

      const postIds = items.map((p) => p.id)
      const countsMap = await batchGetPostCounts(postIds, null)

      return {
        items: items.map((p) => {
          const counts = countsMap.get(p.id) ?? {
            likeCount: 0,
            repostCount: 0,
            replyCount: 0,
            likedByMe: false,
            repostedByMe: false,
          }
          return formatPost(p, profile.handle, counts)
        }),
        next_cursor: nextCursor,
      }
    },
    {
      query: t.Object({
        handle: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
      }),
      response: {
        200: t.Object({
          items: t.Array(PostResponse),
          next_cursor: t.Nullable(t.String()),
        }),
        400: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
      },
    },
  )

  // ── Follows ───────────────────────────────────────────────────────────────

  // POST /social/follows/:handle — follow a user
  .post(
    '/follows/:handle',
    async ({ account, params, status, set }) => {
      if (applyRateLimit(set, `${account.id}:social:follow`, 60, 60_000)) {
        return status(429, { error: 'Rate limit exceeded' })
      }

      const targetProfile = await db.query.socialProfiles.findFirst({
        where: sql`lower(${socialProfiles.handle}) = lower(${params.handle})`,
      })
      if (!targetProfile) return status(404, { error: 'Profile not found' })

      if (targetProfile.accountId === account.id) {
        return status(400, { error: 'Cannot follow yourself' })
      }

      // Idempotent: insert or skip if already following
      await db
        .insert(follows)
        .values({
          followerId: account.id,
          followeeId: targetProfile.accountId,
        })
        .onConflictDoNothing()

      // Check if mutual follow
      const reverseFollow = await db.query.follows.findFirst({
        where: and(
          eq(follows.followerId, targetProfile.accountId),
          eq(follows.followeeId, account.id),
        ),
      })

      const mutual = reverseFollow !== undefined

      if (mutual) {
        // Unlock social conversation
        await unlockSocial(account.id, targetProfile.accountId)
      }

      // Notify the followee
      const myProfile = await db.query.socialProfiles.findFirst({
        where: eq(socialProfiles.accountId, account.id),
      })
      await notify(targetProfile.accountId, 'new_follower', {
        follower_account_id: account.id,
        follower_handle: myProfile?.handle ?? null,
        mutual,
      })

      return { following: true, mutual }
    },
    {
      auth: true,
      params: t.Object({ handle: t.String() }),
      response: {
        200: t.Object({ following: t.Boolean(), mutual: t.Boolean() }),
        400: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
        429: t.Object({ error: t.String() }),
      },
    },
  )

  // DELETE /social/follows/:handle — unfollow a user
  .delete(
    '/follows/:handle',
    async ({ account, params, status, set }) => {
      if (applyRateLimit(set, `${account.id}:social:unfollow`, 60, 60_000)) {
        return status(429, { error: 'Rate limit exceeded' })
      }

      const targetProfile = await db.query.socialProfiles.findFirst({
        where: sql`lower(${socialProfiles.handle}) = lower(${params.handle})`,
      })
      if (!targetProfile) return status(404, { error: 'Profile not found' })

      const existingFollow = await db.query.follows.findFirst({
        where: and(
          eq(follows.followerId, account.id),
          eq(follows.followeeId, targetProfile.accountId),
        ),
      })
      if (!existingFollow) return status(404, { error: 'Not following that user' })

      await db
        .delete(follows)
        .where(
          and(eq(follows.followerId, account.id), eq(follows.followeeId, targetProfile.accountId)),
        )

      set.status = 200
      return { following: false }
    },
    {
      auth: true,
      params: t.Object({ handle: t.String() }),
      response: {
        200: t.Object({ following: t.Boolean() }),
        404: t.Object({ error: t.String() }),
        429: t.Object({ error: t.String() }),
      },
    },
  )

  // ── Followers / Following ─────────────────────────────────────────────────

  // GET /social/followers — accounts following me
  .get(
    '/followers',
    async ({ account }) => {
      const rows = await db.query.follows.findMany({
        where: eq(follows.followeeId, account.id),
        orderBy: (f, { desc }) => [desc(f.createdAt)],
      })

      const followerIds = rows.map((r) => r.followerId)
      if (followerIds.length === 0) return { items: [] }

      const profiles = await db.query.socialProfiles.findMany({
        where: inArray(socialProfiles.accountId, followerIds),
      })
      const profileMap = new Map(profiles.map((p) => [p.accountId, p]))

      return {
        items: followerIds
          .map((id) => {
            const p = profileMap.get(id)
            if (!p) return null
            return {
              handle: p.handle,
              display_name: p.displayName ?? null,
              account_id: p.accountId,
            }
          })
          .filter(
            (x): x is { handle: string; display_name: string | null; account_id: string } =>
              x !== null,
          ),
      }
    },
    {
      auth: true,
      response: {
        200: t.Object({ items: t.Array(FollowEntry) }),
      },
    },
  )

  // GET /social/following — accounts I follow
  .get(
    '/following',
    async ({ account }) => {
      const rows = await db.query.follows.findMany({
        where: eq(follows.followerId, account.id),
        orderBy: (f, { desc }) => [desc(f.createdAt)],
      })

      const followeeIds = rows.map((r) => r.followeeId)
      if (followeeIds.length === 0) return { items: [] }

      const profiles = await db.query.socialProfiles.findMany({
        where: inArray(socialProfiles.accountId, followeeIds),
      })
      const profileMap = new Map(profiles.map((p) => [p.accountId, p]))

      return {
        items: followeeIds
          .map((id) => {
            const p = profileMap.get(id)
            if (!p) return null
            return {
              handle: p.handle,
              display_name: p.displayName ?? null,
              account_id: p.accountId,
            }
          })
          .filter(
            (x): x is { handle: string; display_name: string | null; account_id: string } =>
              x !== null,
          ),
      }
    },
    {
      auth: true,
      response: {
        200: t.Object({ items: t.Array(FollowEntry) }),
      },
    },
  )
