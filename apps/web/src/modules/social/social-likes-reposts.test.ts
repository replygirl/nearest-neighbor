// Tests for POST/DELETE /social/posts/:id/like, POST/DELETE /social/posts/:id/repost,
// counts on post responses, and repost feed boost.
// Uses PGlite via test/setup.ts.

import { beforeEach, describe, expect, test } from 'bun:test'

import { db, follows, notifications, postLikes, reposts } from '@nearest-neighbor/db'
import { and, eq } from 'drizzle-orm'
import { Elysia } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import { clearRateLimitState } from '../../lib/ratelimit.ts'
import '../../test/setup.ts'
import { authHeaders, createTestAccount } from '../../test/helpers.ts'
import { socialModule } from './index.ts'

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

const app = new Elysia().use(authMacro).use(socialModule)

beforeEach(() => {
  clearRateLimitState()
})

// ─── Like / Unlike endpoints ──────────────────────────────────────────────────

describe('POST /social/posts/:id/like', () => {
  test('first like returns liked: true and like_count: 1', async () => {
    const { bearer: authorBearer, id: authorId } = await createTestAccount({
      socialProfile: { handle: `likeauthor_${Date.now().toString(36)}` },
    })
    const { bearer: likerBearer } = await createTestAccount({
      socialProfile: { handle: `liker_${Date.now().toString(36)}` },
    })

    // Author creates a post
    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'like this post' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    // Liker likes the post
    const res = await app.handle(
      new Request(`http://localhost/social/posts/${postId}/like`, {
        method: 'POST',
        headers: authHeaders(likerBearer),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ liked: boolean; like_count: number }>(res)
    expect(body.liked).toBe(true)
    expect(body.like_count).toBe(1)

    // Verify notification was written to author
    const notif = await db.query.notifications.findFirst({
      where: and(eq(notifications.accountId, authorId), eq(notifications.type, 'new_post_like')),
    })
    expect(notif).toBeDefined()
    expect((notif!.payload as { post_id: string }).post_id).toBe(postId)
  })

  test('idempotent re-like: no dup row, no dup notification', async () => {
    const { bearer: authorBearer, id: authorId } = await createTestAccount({
      socialProfile: { handle: `likeauthor2_${Date.now().toString(36)}` },
    })
    const { bearer: likerBearer } = await createTestAccount({
      socialProfile: { handle: `liker2_${Date.now().toString(36)}` },
    })

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'idempotent like test' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/like`, {
        method: 'POST',
        headers: authHeaders(likerBearer),
      }),
    )
    const res2 = await app.handle(
      new Request(`http://localhost/social/posts/${postId}/like`, {
        method: 'POST',
        headers: authHeaders(likerBearer),
      }),
    )
    expect(res2.status).toBe(200)
    const body = await json<{ liked: boolean; like_count: number }>(res2)
    expect(body.like_count).toBe(1) // still 1, not 2

    // Only one notification should exist
    const notifs = await db.query.notifications.findMany({
      where: and(eq(notifications.accountId, authorId), eq(notifications.type, 'new_post_like')),
    })
    const postNotifs = notifs.filter((n) => (n.payload as { post_id?: string }).post_id === postId)
    expect(postNotifs.length).toBe(1)

    // Only one row in post_likes
    const likes = await db.select().from(postLikes).where(eq(postLikes.postId, postId))
    expect(likes.length).toBe(1)
  })

  test('like own post: row created, no self-notification', async () => {
    const { bearer, id: authorId } = await createTestAccount({
      socialProfile: { handle: `selflike_${Date.now().toString(36)}` },
    })

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'self like post' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    const res = await app.handle(
      new Request(`http://localhost/social/posts/${postId}/like`, {
        method: 'POST',
        headers: authHeaders(bearer),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ liked: boolean; like_count: number }>(res)
    expect(body.liked).toBe(true)
    expect(body.like_count).toBe(1)

    // No self-notification
    const notif = await db.query.notifications.findFirst({
      where: and(eq(notifications.accountId, authorId), eq(notifications.type, 'new_post_like')),
    })
    expect(notif).toBeUndefined()
  })

  test('unauthenticated returns 401', async () => {
    const { bearer } = await createTestAccount({
      socialProfile: { handle: `likepublic_${Date.now().toString(36)}` },
    })
    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'public post' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    const res = await app.handle(
      new Request(`http://localhost/social/posts/${postId}/like`, { method: 'POST' }),
    )
    expect(res.status).toBe(401)
  })

  test('missing post returns 404', async () => {
    const { bearer } = await createTestAccount({
      socialProfile: { handle: `like404_${Date.now().toString(36)}` },
    })
    const res = await app.handle(
      new Request(`http://localhost/social/posts/${crypto.randomUUID()}/like`, {
        method: 'POST',
        headers: authHeaders(bearer),
      }),
    )
    expect(res.status).toBe(404)
  })

  test('remove-then-readd sends a fresh notification', async () => {
    const { bearer: authorBearer, id: authorId } = await createTestAccount({
      socialProfile: { handle: `likeauthor3_${Date.now().toString(36)}` },
    })
    const { bearer: likerBearer } = await createTestAccount({
      socialProfile: { handle: `liker3_${Date.now().toString(36)}` },
    })

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'readd like test' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    // Like
    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/like`, {
        method: 'POST',
        headers: authHeaders(likerBearer),
      }),
    )
    // Unlike
    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/like`, {
        method: 'DELETE',
        headers: authHeaders(likerBearer),
      }),
    )
    // Re-like
    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/like`, {
        method: 'POST',
        headers: authHeaders(likerBearer),
      }),
    )

    // Two notifications should exist (one for each real like insert)
    const notifs = await db.query.notifications.findMany({
      where: and(eq(notifications.accountId, authorId), eq(notifications.type, 'new_post_like')),
    })
    const postNotifs = notifs.filter((n) => (n.payload as { post_id?: string }).post_id === postId)
    expect(postNotifs.length).toBe(2)
  })
})

describe('DELETE /social/posts/:id/like', () => {
  test('unlike a liked post returns liked: false and decremented count', async () => {
    const { bearer: authorBearer } = await createTestAccount({
      socialProfile: { handle: `unlikeauthor_${Date.now().toString(36)}` },
    })
    const { bearer: likerBearer } = await createTestAccount({
      socialProfile: { handle: `unlikeliker_${Date.now().toString(36)}` },
    })

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'unlike this' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    // Like first
    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/like`, {
        method: 'POST',
        headers: authHeaders(likerBearer),
      }),
    )

    // Unlike
    const res = await app.handle(
      new Request(`http://localhost/social/posts/${postId}/like`, {
        method: 'DELETE',
        headers: authHeaders(likerBearer),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ liked: boolean; like_count: number }>(res)
    expect(body.liked).toBe(false)
    expect(body.like_count).toBe(0)
  })

  test('idempotent unlike: succeeds even if not liked', async () => {
    const { bearer: authorBearer } = await createTestAccount({
      socialProfile: { handle: `idempotentunlike_${Date.now().toString(36)}` },
    })
    const { bearer: likerBearer } = await createTestAccount({
      socialProfile: { handle: `idempotentunliker_${Date.now().toString(36)}` },
    })

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'idempotent unlike post' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    // Unlike without ever liking — should succeed
    const res = await app.handle(
      new Request(`http://localhost/social/posts/${postId}/like`, {
        method: 'DELETE',
        headers: authHeaders(likerBearer),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ liked: boolean; like_count: number }>(res)
    expect(body.liked).toBe(false)
    expect(body.like_count).toBe(0)
  })
})

// ─── Repost / Unrepost endpoints ──────────────────────────────────────────────

describe('POST /social/posts/:id/repost', () => {
  test('first repost returns reposted: true and repost_count: 1', async () => {
    const { bearer: authorBearer, id: authorId } = await createTestAccount({
      socialProfile: { handle: `repostauthor_${Date.now().toString(36)}` },
    })
    const { bearer: reposterBearer } = await createTestAccount({
      socialProfile: { handle: `reposter_${Date.now().toString(36)}` },
    })

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'repost this post' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    const res = await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'POST',
        headers: authHeaders(reposterBearer),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ reposted: boolean; repost_count: number }>(res)
    expect(body.reposted).toBe(true)
    expect(body.repost_count).toBe(1)

    // Verify notification was written to author
    const notif = await db.query.notifications.findFirst({
      where: and(eq(notifications.accountId, authorId), eq(notifications.type, 'new_repost')),
    })
    expect(notif).toBeDefined()
    expect((notif!.payload as { post_id: string }).post_id).toBe(postId)
  })

  test('idempotent re-repost: no dup row, no dup notification', async () => {
    const { bearer: authorBearer, id: authorId } = await createTestAccount({
      socialProfile: { handle: `repostauthor2_${Date.now().toString(36)}` },
    })
    const { bearer: reposterBearer } = await createTestAccount({
      socialProfile: { handle: `reposter2_${Date.now().toString(36)}` },
    })

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'idempotent repost' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'POST',
        headers: authHeaders(reposterBearer),
      }),
    )
    const res2 = await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'POST',
        headers: authHeaders(reposterBearer),
      }),
    )
    expect(res2.status).toBe(200)
    const body = await json<{ reposted: boolean; repost_count: number }>(res2)
    expect(body.repost_count).toBe(1)

    // Only one notification
    const notifs = await db.query.notifications.findMany({
      where: and(eq(notifications.accountId, authorId), eq(notifications.type, 'new_repost')),
    })
    const postNotifs = notifs.filter((n) => (n.payload as { post_id?: string }).post_id === postId)
    expect(postNotifs.length).toBe(1)

    // Only one row in reposts
    const repostRows = await db.select().from(reposts).where(eq(reposts.postId, postId))
    expect(repostRows.length).toBe(1)
  })

  test('self-repost: row created, no self-notification', async () => {
    const { bearer, id: authorId } = await createTestAccount({
      socialProfile: { handle: `selfrepost_${Date.now().toString(36)}` },
    })

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'self repost post' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    const res = await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'POST',
        headers: authHeaders(bearer),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ reposted: boolean; repost_count: number }>(res)
    expect(body.reposted).toBe(true)
    expect(body.repost_count).toBe(1)

    // No self-notification
    const notif = await db.query.notifications.findFirst({
      where: and(eq(notifications.accountId, authorId), eq(notifications.type, 'new_repost')),
    })
    expect(notif).toBeUndefined()
  })

  test('unauthenticated returns 401', async () => {
    const { bearer } = await createTestAccount({
      socialProfile: { handle: `repostpublic_${Date.now().toString(36)}` },
    })
    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'public repost test' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    const res = await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, { method: 'POST' }),
    )
    expect(res.status).toBe(401)
  })

  test('missing post returns 404', async () => {
    const { bearer } = await createTestAccount({
      socialProfile: { handle: `repost404_${Date.now().toString(36)}` },
    })
    const res = await app.handle(
      new Request(`http://localhost/social/posts/${crypto.randomUUID()}/repost`, {
        method: 'POST',
        headers: authHeaders(bearer),
      }),
    )
    expect(res.status).toBe(404)
  })

  test('remove-then-readd sends a fresh notification', async () => {
    const { bearer: authorBearer, id: authorId } = await createTestAccount({
      socialProfile: { handle: `repostauthor3_${Date.now().toString(36)}` },
    })
    const { bearer: reposterBearer } = await createTestAccount({
      socialProfile: { handle: `reposter3_${Date.now().toString(36)}` },
    })

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'readd repost test' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'POST',
        headers: authHeaders(reposterBearer),
      }),
    )
    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'DELETE',
        headers: authHeaders(reposterBearer),
      }),
    )
    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'POST',
        headers: authHeaders(reposterBearer),
      }),
    )

    const notifs = await db.query.notifications.findMany({
      where: and(eq(notifications.accountId, authorId), eq(notifications.type, 'new_repost')),
    })
    const postNotifs = notifs.filter((n) => (n.payload as { post_id?: string }).post_id === postId)
    expect(postNotifs.length).toBe(2)
  })
})

describe('DELETE /social/posts/:id/repost', () => {
  test('unrepost removes the row and returns reposted: false', async () => {
    const { bearer: authorBearer } = await createTestAccount({
      socialProfile: { handle: `unrepostauthor_${Date.now().toString(36)}` },
    })
    const { bearer: reposterBearer } = await createTestAccount({
      socialProfile: { handle: `unrepostreposter_${Date.now().toString(36)}` },
    })

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'unrepost this' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'POST',
        headers: authHeaders(reposterBearer),
      }),
    )

    const res = await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'DELETE',
        headers: authHeaders(reposterBearer),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ reposted: boolean; repost_count: number }>(res)
    expect(body.reposted).toBe(false)
    expect(body.repost_count).toBe(0)
  })

  test('idempotent unrepost: succeeds even if not reposted', async () => {
    const { bearer: authorBearer } = await createTestAccount({
      socialProfile: { handle: `idempotentunrepost_${Date.now().toString(36)}` },
    })
    const { bearer: reposterBearer } = await createTestAccount({
      socialProfile: { handle: `idempotentunreposter_${Date.now().toString(36)}` },
    })

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'idempotent unrepost post' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    const res = await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'DELETE',
        headers: authHeaders(reposterBearer),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ reposted: boolean; repost_count: number }>(res)
    expect(body.reposted).toBe(false)
  })
})

// ─── Counts and viewer state on post responses ────────────────────────────────

describe('Post counts (like_count, repost_count, reply_count) and viewer state', () => {
  test('GET /social/posts/:id includes all five fields with correct values', async () => {
    const { bearer: authorBearer } = await createTestAccount({
      socialProfile: { handle: `countauthor_${Date.now().toString(36)}` },
    })
    const { bearer: likerBearer } = await createTestAccount({
      socialProfile: { handle: `countliker_${Date.now().toString(36)}` },
    })

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'count test post' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    // Like and repost
    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/like`, {
        method: 'POST',
        headers: authHeaders(likerBearer),
      }),
    )
    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'POST',
        headers: authHeaders(likerBearer),
      }),
    )

    // Create a reply
    await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'reply!', reply_to_id: postId }),
      }),
    )

    // Fetch post without auth (unauthenticated)
    const res = await app.handle(new Request(`http://localhost/social/posts/${postId}`))
    expect(res.status).toBe(200)
    const body = await json<{
      like_count: number
      repost_count: number
      reply_count: number
      liked_by_me: boolean
      reposted_by_me: boolean
    }>(res)
    expect(body.like_count).toBe(1)
    expect(body.repost_count).toBe(1)
    expect(body.reply_count).toBe(1)
    expect(body.liked_by_me).toBe(false) // unauthenticated
    expect(body.reposted_by_me).toBe(false) // unauthenticated
  })

  test('POST /social/posts returns counts on created post', async () => {
    const { bearer } = await createTestAccount({
      socialProfile: { handle: `createcounts_${Date.now().toString(36)}` },
    })

    const res = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'fresh post with counts' }),
      }),
    )
    expect(res.status).toBe(201)
    const body = await json<{
      like_count: number
      repost_count: number
      reply_count: number
      liked_by_me: boolean
      reposted_by_me: boolean
    }>(res)
    expect(body.like_count).toBe(0)
    expect(body.repost_count).toBe(0)
    expect(body.reply_count).toBe(0)
    expect(body.liked_by_me).toBe(false)
    expect(body.reposted_by_me).toBe(false)
  })

  test('GET /social/posts?handle= includes counts', async () => {
    const { bearer } = await createTestAccount({
      socialProfile: { handle: `handlecounts_${Date.now().toString(36)}` },
    })

    await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'handle counts post' }),
      }),
    )

    // Determine handle
    const profileRes = await app.handle(
      new Request('http://localhost/social/profile', { headers: authHeaders(bearer) }),
    )
    const { handle } = await json<{ handle: string }>(profileRes)

    const res = await app.handle(new Request(`http://localhost/social/posts?handle=${handle}`))
    expect(res.status).toBe(200)
    const body = await json<{
      items: Array<{
        like_count: number
        repost_count: number
        reply_count: number
        liked_by_me: boolean
        reposted_by_me: boolean
      }>
    }>(res)
    expect(body.items.length).toBeGreaterThan(0)
    const item = body.items[0]!
    expect(typeof item.like_count).toBe('number')
    expect(typeof item.repost_count).toBe('number')
    expect(typeof item.reply_count).toBe('number')
    expect(item.liked_by_me).toBe(false)
    expect(item.reposted_by_me).toBe(false)
  })

  test('GET /social/discover includes counts with liked_by_me: false', async () => {
    const { bearer } = await createTestAccount({
      socialProfile: { handle: `disccounts_${Date.now().toString(36)}` },
    })

    await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'discover counts post' }),
      }),
    )

    const res = await app.handle(new Request('http://localhost/social/discover?limit=1'))
    expect(res.status).toBe(200)
    const body = await json<{
      items: Array<{
        like_count: number
        repost_count: number
        reply_count: number
        liked_by_me: boolean
        reposted_by_me: boolean
      }>
    }>(res)
    expect(body.items.length).toBeGreaterThan(0)
    const item = body.items[0]!
    expect(typeof item.like_count).toBe('number')
    expect(typeof item.repost_count).toBe('number')
    expect(item.liked_by_me).toBe(false)
    expect(item.reposted_by_me).toBe(false)
  })
})

// ─── Repost feed boost ────────────────────────────────────────────────────────

describe('Repost feed boost', () => {
  test('repost surfaces in follower feed with attribution', async () => {
    const { bearer: authorBearer } = await createTestAccount({
      socialProfile: { handle: `boostauthor_${Date.now().toString(36)}` },
    })
    const { bearer: reposterBearer, id: reposterId } = await createTestAccount({
      socialProfile: { handle: `boostreposter_${Date.now().toString(36)}` },
    })
    const { bearer: followerBearer, id: followerId } = await createTestAccount({
      socialProfile: { handle: `boostfollower_${Date.now().toString(36)}` },
    })

    // Follower follows the reposter (but NOT the author)
    await db.insert(follows).values({ followerId, followeeId: reposterId })

    // Author creates a post
    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'boosted post content' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    // Reposter reposts the post
    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'POST',
        headers: authHeaders(reposterBearer),
      }),
    )

    // Follower fetches their feed
    const feedRes = await app.handle(
      new Request('http://localhost/social/feed', { headers: authHeaders(followerBearer) }),
    )
    expect(feedRes.status).toBe(200)
    const feedBody = await json<{
      items: Array<{
        id: string
        body: string
        reposted_by: string | null
        reposted_by_account_id: string | null
        reposted_at: string | null
      }>
    }>(feedRes)

    const boost = feedBody.items.find((i) => i.id === postId)
    expect(boost).toBeDefined()
    expect(boost!.body).toBe('boosted post content')
    expect(boost!.reposted_by_account_id).toBe(reposterId)
    expect(typeof boost!.reposted_at).toBe('string')
  })

  test('original feed items have null repost attribution', async () => {
    const { bearer: authorBearer, id: authorId } = await createTestAccount({
      socialProfile: { handle: `origauthor_${Date.now().toString(36)}` },
    })
    const { bearer: followerBearer, id: followerId } = await createTestAccount({
      socialProfile: { handle: `origfollower_${Date.now().toString(36)}` },
    })

    // Follower follows the author directly
    await db.insert(follows).values({ followerId, followeeId: authorId })

    await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'original feed post' }),
      }),
    )

    const feedRes = await app.handle(
      new Request('http://localhost/social/feed', { headers: authHeaders(followerBearer) }),
    )
    expect(feedRes.status).toBe(200)
    const feedBody = await json<{
      items: Array<{
        body: string
        reposted_by: string | null
        reposted_by_account_id: string | null
        reposted_at: string | null
      }>
    }>(feedRes)

    const orig = feedBody.items.find((i) => i.body === 'original feed post')
    expect(orig).toBeDefined()
    expect(orig!.reposted_by).toBeNull()
    expect(orig!.reposted_by_account_id).toBeNull()
    expect(orig!.reposted_at).toBeNull()
  })

  test('discover ignores reposts — post appears once with no attribution', async () => {
    const { bearer } = await createTestAccount({
      socialProfile: { handle: `discrepost_${Date.now().toString(36)}` },
    })
    const { bearer: reposterBearer } = await createTestAccount({
      socialProfile: { handle: `discreposter_${Date.now().toString(36)}` },
    })

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'discover repost test' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    // Repost it
    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'POST',
        headers: authHeaders(reposterBearer),
      }),
    )

    const discoverRes = await app.handle(new Request('http://localhost/social/discover'))
    expect(discoverRes.status).toBe(200)
    const discoverBody = await json<{
      items: Array<{
        id: string
        reposted_by: unknown
        reposted_at: unknown
      }>
    }>(discoverRes)

    // The post should appear at most once in discover, and not have repost_ fields
    const discoverItems = discoverBody.items.filter((i) => i.id === postId)
    expect(discoverItems.length).toBe(1)
    // discover returns PostResponse (no repost_ fields)
    expect('reposted_by' in discoverItems[0]!).toBe(false)
  })

  test('undoing a repost removes the boost from follower feed', async () => {
    const { bearer: authorBearer } = await createTestAccount({
      socialProfile: { handle: `undoauthor_${Date.now().toString(36)}` },
    })
    const { bearer: reposterBearer, id: reposterId } = await createTestAccount({
      socialProfile: { handle: `undoreposter_${Date.now().toString(36)}` },
    })
    const { bearer: followerBearer, id: followerId } = await createTestAccount({
      socialProfile: { handle: `undofollower_${Date.now().toString(36)}` },
    })

    await db.insert(follows).values({ followerId, followeeId: reposterId })

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'undo boost test' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    // Repost
    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'POST',
        headers: authHeaders(reposterBearer),
      }),
    )

    // Undo repost
    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'DELETE',
        headers: authHeaders(reposterBearer),
      }),
    )

    // Feed should no longer contain the boost
    const feedRes = await app.handle(
      new Request('http://localhost/social/feed', { headers: authHeaders(followerBearer) }),
    )
    const feedBody = await json<{ items: Array<{ id: string }> }>(feedRes)
    const boost = feedBody.items.find((i) => i.id === postId)
    expect(boost).toBeUndefined()
  })

  test('single reposter does not produce duplicate boost entries', async () => {
    const { bearer: authorBearer } = await createTestAccount({
      socialProfile: { handle: `dedupauthor_${Date.now().toString(36)}` },
    })
    const { bearer: reposterBearer, id: reposterId } = await createTestAccount({
      socialProfile: { handle: `dedupreposter_${Date.now().toString(36)}` },
    })
    const { bearer: followerBearer, id: followerId } = await createTestAccount({
      socialProfile: { handle: `dedupfollower_${Date.now().toString(36)}` },
    })

    await db.insert(follows).values({ followerId, followeeId: reposterId })

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(authorBearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'dedup boost test' }),
      }),
    )
    const { id: postId } = await json<{ id: string }>(createRes)

    // Repost (single reposter, UNIQUE constraint ensures only one row)
    await app.handle(
      new Request(`http://localhost/social/posts/${postId}/repost`, {
        method: 'POST',
        headers: authHeaders(reposterBearer),
      }),
    )

    const feedRes = await app.handle(
      new Request('http://localhost/social/feed', { headers: authHeaders(followerBearer) }),
    )
    const feedBody = await json<{ items: Array<{ id: string }> }>(feedRes)
    const boosts = feedBody.items.filter((i) => i.id === postId)
    expect(boosts.length).toBe(1)
  })
})
