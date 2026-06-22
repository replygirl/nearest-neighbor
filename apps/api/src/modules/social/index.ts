// Social module: profiles, posts, feed, discover, follows, followers/following.
// Prefix: /social

import { db, follows, posts, relationships, socialProfiles } from '@nearest-neighbor/db'
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { Elysia, t } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import { unlockSocial } from '../../lib/conversations.ts'
import { notify } from '../../lib/notifications.ts'
import { decodeCursor, encodeCursor } from '../../lib/pagination.ts'
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
})

const FollowEntry = t.Object({
  handle: t.String(),
  display_name: t.Nullable(t.String()),
  account_id: t.String(),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPost(
  post: {
    id: string
    body: string
    asciiImage: string | null
    replyToId: string | null
    authorId: string
    createdAt: Date
  },
  handle: string | null,
) {
  return {
    id: post.id,
    body: post.body,
    ascii_image: post.asciiImage,
    author_handle: handle,
    author_account_id: post.authorId,
    reply_to_id: post.replyToId,
    created_at: post.createdAt.toISOString(),
  }
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
    async ({ account, body, status }) => {
      if (!HANDLE_REGEX.test(body.handle)) {
        return status(400, { error: 'Invalid handle: must match ^[a-z0-9_]{2,30}$' })
      }
      if (body.bio !== undefined && body.bio.length > MAX_BIO) {
        return status(400, { error: `Bio exceeds max length of ${MAX_BIO}` })
      }

      // Check handle uniqueness (case-insensitive) excluding self
      const existing = await db.query.socialProfiles.findFirst({
        where: and(
          sql`lower(${socialProfiles.handle}) = lower(${body.handle})`,
          sql`${socialProfiles.accountId} != ${account.id}`,
        ),
      })
      if (existing) {
        return status(409, { error: 'Handle is already taken' })
      }

      const now = new Date()
      const values = {
        accountId: account.id,
        handle: body.handle.toLowerCase(),
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
          return status(400, { error: 'ASCII image exceeds 60 lines × 60 chars' })
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
      set.status = 201
      return formatPost(post!, profile.handle)
    },
    {
      auth: true,
      body: t.Object({
        body: t.String({ minLength: 1, maxLength: MAX_BODY }),
        ascii_image: t.Optional(t.Nullable(t.String())),
        reply_to_id: t.Optional(t.Nullable(t.String())),
      }),
      response: {
        201: PostResponse,
        400: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
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
      return formatPost(post, handle)
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

  // ── Feed ──────────────────────────────────────────────────────────────────

  // GET /social/feed?cursor= — posts from followees (auth required)
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

      const conditions = [inArray(posts.authorId, followeeIds), isNull(posts.deletedAt)]
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

      // Batch-load handles
      const authorIds = [...new Set(items.map((p) => p.authorId))]
      const profiles =
        authorIds.length > 0
          ? await db.query.socialProfiles.findMany({
              where: inArray(socialProfiles.accountId, authorIds),
            })
          : []
      const handleMap = new Map(profiles.map((p) => [p.accountId, p.handle]))

      return {
        items: items.map((p) => formatPost(p, handleMap.get(p.authorId) ?? null)),
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
          items: t.Array(PostResponse),
          next_cursor: t.Nullable(t.String()),
        }),
      },
    },
  )

  // ── Discover ──────────────────────────────────────────────────────────────

  // GET /social/discover?cursor= — recent public posts (no auth)
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

      return {
        items: items.map((p) => formatPost(p, handleMap.get(p.authorId) ?? null)),
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

      return {
        items: items.map((p) => formatPost(p, profile.handle)),
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
    async ({ account, params, status }) => {
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
      },
    },
  )

  // DELETE /social/follows/:handle — unfollow a user
  .delete(
    '/follows/:handle',
    async ({ account, params, status, set }) => {
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
