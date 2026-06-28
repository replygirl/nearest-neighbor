// Social module tests: profile, public profile, posts, feed, discover, follows, followers/following.
// Uses PGlite via test/setup.ts.

import { describe, expect, test } from 'bun:test'

import { db, follows, posts, relationships } from '@nearest-neighbor/db'
import { Elysia } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import '../../test/setup.ts'
import { authHeaders, createTestAccount } from '../../test/helpers.ts'
import { socialModule } from './index.ts'

// Typed JSON helper
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

// Fresh app per describe block
const app = new Elysia().use(authMacro).use(socialModule)

// ─── Profile ─────────────────────────────────────────────────────────────────

describe('GET /social/profile', () => {
  test('returns 404 when no social profile exists', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/social/profile', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(404)
  })

  test('returns profile after creation', async () => {
    const handle = `alice_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({
      socialProfile: { handle, displayName: 'Alice', bio: 'hello', openDms: true },
    })
    const res = await app.handle(
      new Request('http://localhost/social/profile', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{
      handle: string
      display_name: string | null
      bio: string
      open_dms: boolean
      account_id: string
    }>(res)
    expect(body.handle).toBe(handle)
    expect(body.display_name).toBe('Alice')
    expect(body.bio).toBe('hello')
    expect(body.open_dms).toBe(true)
    expect(typeof body.account_id).toBe('string')
  })

  test('returns 401 without auth', async () => {
    const res = await app.handle(new Request('http://localhost/social/profile'))
    expect(res.status).toBe(401)
  })
})

describe('PUT /social/profile', () => {
  test('creates a new social profile', async () => {
    const { bearer } = await createTestAccount()
    const handle = `newuser_${Date.now().toString(36)}`
    const res = await app.handle(
      new Request('http://localhost/social/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, display_name: 'New User', bio: 'hi', open_dms: false }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ handle: string; display_name: string | null; bio: string }>(res)
    expect(body.handle).toBe(handle)
    expect(body.display_name).toBe('New User')
    expect(body.bio).toBe('hi')
  })

  test('upserts existing profile', async () => {
    const handle = `upsertme_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })
    const res = await app.handle(
      new Request('http://localhost/social/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, display_name: 'Updated', bio: 'updated bio' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ display_name: string | null; bio: string }>(res)
    expect(body.display_name).toBe('Updated')
    expect(body.bio).toBe('updated bio')
  })

  test('rejects invalid handle format', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/social/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'INVALID HANDLE!' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('accepts @handle and strips the leading @', async () => {
    const { bearer } = await createTestAccount()
    const bare = `attest_${Date.now().toString(36)}`
    const res = await app.handle(
      new Request('http://localhost/social/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: `@${bare}` }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ handle: string }>(res)
    expect(body.handle).toBe(bare)
  })

  test('rejects duplicate handle', async () => {
    const handle = `dupe_${Date.now().toString(36)}`
    await createTestAccount({ socialProfile: { handle } })
    const { bearer: bearer2 } = await createTestAccount()

    const res = await app.handle(
      new Request('http://localhost/social/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer2), 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle }),
      }),
    )
    expect(res.status).toBe(409)
  })

  test('allows keeping same handle for self', async () => {
    const handle = `selfhandle_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })

    const res = await app.handle(
      new Request('http://localhost/social/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, bio: 'new bio' }),
      }),
    )
    expect(res.status).toBe(200)
  })

  test('returns 401 without auth', async () => {
    const res = await app.handle(
      new Request('http://localhost/social/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'whoever' }),
      }),
    )
    expect(res.status).toBe(401)
  })
})

// ─── Public profile ───────────────────────────────────────────────────────────

describe('GET /social/profiles/:handle', () => {
  test('returns public profile with no aligned_with', async () => {
    const handle = `publicuser_${Date.now().toString(36)}`
    await createTestAccount({ socialProfile: { handle, displayName: 'Public User' } })

    const res = await app.handle(new Request(`http://localhost/social/profiles/${handle}`))
    expect(res.status).toBe(200)
    const body = await json<{
      handle: string
      display_name: string | null
      aligned_with: string[]
    }>(res)
    expect(body.handle).toBe(handle)
    expect(body.display_name).toBe('Public User')
    expect(Array.isArray(body.aligned_with)).toBe(true)
    expect(body.aligned_with.length).toBe(0)
  })

  test('returns 404 for unknown handle', async () => {
    const res = await app.handle(new Request('http://localhost/social/profiles/nobody_here_xyz999'))
    expect(res.status).toBe(404)
  })

  test('includes partner handles in aligned_with for public active relationships', async () => {
    const handleA = `partner_a_${Date.now().toString(36)}`
    const handleB = `partner_b_${Date.now().toString(36)}`
    const { id: idA } = await createTestAccount({ socialProfile: { handle: handleA } })
    const { id: idB } = await createTestAccount({ socialProfile: { handle: handleB } })

    // Create a public active relationship (ordered pair)
    const [a, b] = idA < idB ? [idA, idB] : [idB, idA]
    await db.insert(relationships).values({
      id: crypto.randomUUID(),
      accountAId: a!,
      accountBId: b!,
      initiatorId: idA,
      state: 'active',
      isPublic: true,
    })

    const res = await app.handle(new Request(`http://localhost/social/profiles/${handleA}`))
    expect(res.status).toBe(200)
    const body = await json<{ aligned_with: string[] }>(res)
    expect(body.aligned_with).toContain(handleB)
  })

  test('does not include private relationships in aligned_with', async () => {
    const handleC = `partner_c_${Date.now().toString(36)}`
    const handleD = `partner_d_${Date.now().toString(36)}`
    const { id: idC } = await createTestAccount({ socialProfile: { handle: handleC } })
    const { id: idD } = await createTestAccount({ socialProfile: { handle: handleD } })

    const [a, b] = idC < idD ? [idC, idD] : [idD, idC]
    await db.insert(relationships).values({
      id: crypto.randomUUID(),
      accountAId: a!,
      accountBId: b!,
      initiatorId: idC,
      state: 'active',
      isPublic: false,
    })

    const res = await app.handle(new Request(`http://localhost/social/profiles/${handleC}`))
    expect(res.status).toBe(200)
    const body = await json<{ aligned_with: string[] }>(res)
    expect(body.aligned_with.length).toBe(0)
  })
})

// ─── Posts ────────────────────────────────────────────────────────────────────

describe('POST /social/posts', () => {
  test('creates a post', async () => {
    const handle = `poster_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })
    const res = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Hello world!' }),
      }),
    )
    expect(res.status).toBe(201)
    const body = await json<{ id: string; body: string; author_handle: string | null }>(res)
    expect(body.body).toBe('Hello world!')
    expect(body.author_handle).toBe(handle)
    expect(typeof body.id).toBe('string')
  })

  test('rejects empty body', async () => {
    const handle = `emptyposter_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })
    const res = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: '' }),
      }),
    )
    expect(res.status).toBe(422) // TypeBox validation
  })

  test('rejects invalid ascii_image', async () => {
    const handle = `artposter_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })
    // 61 lines
    const art = Array(61).fill('x'.repeat(60)).join('\n')
    const res = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'art post', ascii_image: art }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('creates reply post', async () => {
    const handle = `replier_${Date.now().toString(36)}`
    const { bearer, id } = await createTestAccount({ socialProfile: { handle } })

    // Create parent post directly in DB
    const parentId = crypto.randomUUID()
    const now = new Date()
    await db.insert(posts).values({
      id: parentId,
      authorId: id,
      body: 'parent',
      createdAt: now,
      updatedAt: now,
    })

    const res = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'reply!', reply_to_id: parentId }),
      }),
    )
    expect(res.status).toBe(201)
    const body = await json<{ reply_to_id: string | null }>(res)
    expect(body.reply_to_id).toBe(parentId)
  })

  test('returns 400 without social profile', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'no profile post' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('returns 401 without auth', async () => {
    const res = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'unauth post' }),
      }),
    )
    expect(res.status).toBe(401)
  })
})

describe('GET /social/posts/:id', () => {
  test('returns post by id (no auth)', async () => {
    const handle = `getposter_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })
    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'get me!' }),
      }),
    )
    const { id } = await json<{ id: string }>(createRes)

    const res = await app.handle(new Request(`http://localhost/social/posts/${id}`))
    expect(res.status).toBe(200)
    const body = await json<{ id: string; body: string }>(res)
    expect(body.id).toBe(id)
    expect(body.body).toBe('get me!')
  })

  test('returns 404 for unknown id', async () => {
    const res = await app.handle(
      new Request(`http://localhost/social/posts/${crypto.randomUUID()}`),
    )
    expect(res.status).toBe(404)
  })
})

describe('DELETE /social/posts/:id', () => {
  test('soft-deletes a post (author only)', async () => {
    const handle = `delposter_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })
    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'delete me' }),
      }),
    )
    const { id } = await json<{ id: string }>(createRes)

    const deleteRes = await app.handle(
      new Request(`http://localhost/social/posts/${id}`, {
        method: 'DELETE',
        headers: authHeaders(bearer),
      }),
    )
    expect(deleteRes.status).toBe(200)
    const body = await json<{ deleted: boolean }>(deleteRes)
    expect(body.deleted).toBe(true)

    // Should 404 after soft-delete
    const getRes = await app.handle(new Request(`http://localhost/social/posts/${id}`))
    expect(getRes.status).toBe(404)
  })

  test('returns 403 for non-author', async () => {
    const handle = `owner_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })
    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'not yours' }),
      }),
    )
    const { id } = await json<{ id: string }>(createRes)

    const { bearer: bearer2 } = await createTestAccount({
      socialProfile: { handle: `thief_${Date.now().toString(36)}` },
    })
    const res = await app.handle(
      new Request(`http://localhost/social/posts/${id}`, {
        method: 'DELETE',
        headers: authHeaders(bearer2),
      }),
    )
    expect(res.status).toBe(403)
  })

  test('returns 404 for unknown post', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request(`http://localhost/social/posts/${crypto.randomUUID()}`, {
        method: 'DELETE',
        headers: authHeaders(bearer),
      }),
    )
    expect(res.status).toBe(404)
  })
})

// ─── Feed ─────────────────────────────────────────────────────────────────────

describe('GET /social/feed', () => {
  test('returns empty feed when not following anyone', async () => {
    const { bearer } = await createTestAccount({
      socialProfile: { handle: `feedme_${Date.now().toString(36)}` },
    })
    const res = await app.handle(
      new Request('http://localhost/social/feed', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: unknown[]; next_cursor: string | null }>(res)
    expect(body.items.length).toBe(0)
    expect(body.next_cursor).toBeNull()
  })

  test('returns posts from followees', async () => {
    const handleA = `feedfollower_${Date.now().toString(36)}`
    const handleB = `feedauthor_${Date.now().toString(36)}`
    const { bearer: bearerA, id: idA } = await createTestAccount({
      socialProfile: { handle: handleA },
    })
    const { bearer: bearerB, id: idB } = await createTestAccount({
      socialProfile: { handle: handleB },
    })

    // A follows B
    await db.insert(follows).values({ followerId: idA, followeeId: idB })

    // B creates a post
    await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearerB), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'feed post from B' }),
      }),
    )

    const res = await app.handle(
      new Request('http://localhost/social/feed', { headers: authHeaders(bearerA) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: Array<{ body: string }> }>(res)
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.some((p) => p.body === 'feed post from B')).toBe(true)
  })

  test('does not include own posts or non-followees', async () => {
    const handleX = `feedsolox_${Date.now().toString(36)}`
    const handleY = `feedsoloy_${Date.now().toString(36)}`
    const { bearer: bearerX } = await createTestAccount({ socialProfile: { handle: handleX } })
    const { bearer: bearerY } = await createTestAccount({ socialProfile: { handle: handleY } })

    // X posts
    await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearerX), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'x post should not appear in y feed' }),
      }),
    )

    // Y does NOT follow X
    const res = await app.handle(
      new Request('http://localhost/social/feed', { headers: authHeaders(bearerY) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: Array<{ body: string }> }>(res)
    expect(body.items.every((p) => p.body !== 'x post should not appear in y feed')).toBe(true)
  })

  test('returns 401 without auth', async () => {
    const res = await app.handle(new Request('http://localhost/social/feed'))
    expect(res.status).toBe(401)
  })
})

// ─── Discover ─────────────────────────────────────────────────────────────────

describe('GET /social/discover', () => {
  test('returns recent posts (no auth)', async () => {
    const handle = `discposter_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })
    await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'discovery post' }),
      }),
    )

    const res = await app.handle(new Request('http://localhost/social/discover'))
    expect(res.status).toBe(200)
    const body = await json<{ items: Array<{ body: string }>; next_cursor: string | null }>(res)
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.some((p) => p.body === 'discovery post')).toBe(true)
  })
})

// ─── Posts by handle ──────────────────────────────────────────────────────────

describe('GET /social/posts?handle=', () => {
  test('returns posts for a given handle', async () => {
    const handle = `handlepostuser_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })
    await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'post for handle query' }),
      }),
    )

    const res = await app.handle(new Request(`http://localhost/social/posts?handle=${handle}`))
    expect(res.status).toBe(200)
    const body = await json<{ items: Array<{ body: string }> }>(res)
    expect(body.items.some((p) => p.body === 'post for handle query')).toBe(true)
  })

  test('returns 404 for unknown handle', async () => {
    const res = await app.handle(
      new Request('http://localhost/social/posts?handle=nobody_xyz_99999'),
    )
    expect(res.status).toBe(404)
  })

  test('returns 400 when handle is missing', async () => {
    const res = await app.handle(new Request('http://localhost/social/posts'))
    expect(res.status).toBe(400)
  })
})

// ─── Follows ──────────────────────────────────────────────────────────────────

describe('POST /social/follows/:handle', () => {
  test('follows a user and returns following: true', async () => {
    const handleA = `followa_${Date.now().toString(36)}`
    const handleB = `followb_${Date.now().toString(36)}`
    const { bearer: bearerA } = await createTestAccount({ socialProfile: { handle: handleA } })
    await createTestAccount({ socialProfile: { handle: handleB } })

    const res = await app.handle(
      new Request(`http://localhost/social/follows/${handleB}`, {
        method: 'POST',
        headers: authHeaders(bearerA),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ following: boolean; mutual: boolean }>(res)
    expect(body.following).toBe(true)
    expect(body.mutual).toBe(false)
  })

  test('mutual follow returns mutual: true and unlocks social conversation', async () => {
    const handleC = `followc_${Date.now().toString(36)}`
    const handleD = `followd_${Date.now().toString(36)}`
    const { bearer: bearerC, id: idC } = await createTestAccount({
      socialProfile: { handle: handleC },
    })
    const { bearer: bearerD, id: idD } = await createTestAccount({
      socialProfile: { handle: handleD },
    })

    // C follows D
    await app.handle(
      new Request(`http://localhost/social/follows/${handleD}`, {
        method: 'POST',
        headers: authHeaders(bearerC),
      }),
    )

    // D follows C back
    const res = await app.handle(
      new Request(`http://localhost/social/follows/${handleC}`, {
        method: 'POST',
        headers: authHeaders(bearerD),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ following: boolean; mutual: boolean }>(res)
    expect(body.mutual).toBe(true)

    // Verify conversation was unlocked
    const { db: testDb, conversations } = await import('@nearest-neighbor/db')
    const { and, eq, or } = await import('drizzle-orm')
    const conv = await testDb.query.conversations.findFirst({
      where: or(
        and(eq(conversations.accountAId, idC), eq(conversations.accountBId, idD)),
        and(eq(conversations.accountAId, idD), eq(conversations.accountBId, idC)),
      ),
    })
    expect(conv?.socialUnlockedAt).not.toBeNull()
  })

  test('returns 404 for unknown handle', async () => {
    const { bearer } = await createTestAccount({
      socialProfile: { handle: `solo_${Date.now().toString(36)}` },
    })
    const res = await app.handle(
      new Request('http://localhost/social/follows/nobody_xyz_99999', {
        method: 'POST',
        headers: authHeaders(bearer),
      }),
    )
    expect(res.status).toBe(404)
  })

  test('returns 400 when trying to follow self', async () => {
    const handle = `selffollow_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })
    const res = await app.handle(
      new Request(`http://localhost/social/follows/${handle}`, {
        method: 'POST',
        headers: authHeaders(bearer),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('idempotent: following twice succeeds', async () => {
    const handleE = `followe_${Date.now().toString(36)}`
    const handleF = `followf_${Date.now().toString(36)}`
    const { bearer: bearerE } = await createTestAccount({ socialProfile: { handle: handleE } })
    await createTestAccount({ socialProfile: { handle: handleF } })

    await app.handle(
      new Request(`http://localhost/social/follows/${handleF}`, {
        method: 'POST',
        headers: authHeaders(bearerE),
      }),
    )
    const res = await app.handle(
      new Request(`http://localhost/social/follows/${handleF}`, {
        method: 'POST',
        headers: authHeaders(bearerE),
      }),
    )
    expect(res.status).toBe(200)
  })
})

describe('DELETE /social/follows/:handle', () => {
  test('unfollows a user', async () => {
    const handleG = `unfollowg_${Date.now().toString(36)}`
    const handleH = `unfollowh_${Date.now().toString(36)}`
    const { bearer: bearerG } = await createTestAccount({ socialProfile: { handle: handleG } })
    await createTestAccount({ socialProfile: { handle: handleH } })

    // Follow first
    await app.handle(
      new Request(`http://localhost/social/follows/${handleH}`, {
        method: 'POST',
        headers: authHeaders(bearerG),
      }),
    )

    // Unfollow
    const res = await app.handle(
      new Request(`http://localhost/social/follows/${handleH}`, {
        method: 'DELETE',
        headers: authHeaders(bearerG),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ following: boolean }>(res)
    expect(body.following).toBe(false)
  })

  test('returns 404 when not following', async () => {
    const handleI = `nofollowi_${Date.now().toString(36)}`
    const handleJ = `nofollowj_${Date.now().toString(36)}`
    const { bearer: bearerI } = await createTestAccount({ socialProfile: { handle: handleI } })
    await createTestAccount({ socialProfile: { handle: handleJ } })

    const res = await app.handle(
      new Request(`http://localhost/social/follows/${handleJ}`, {
        method: 'DELETE',
        headers: authHeaders(bearerI),
      }),
    )
    expect(res.status).toBe(404)
  })

  test('returns 404 for unknown handle', async () => {
    const { bearer } = await createTestAccount({
      socialProfile: { handle: `unfollowtarget_${Date.now().toString(36)}` },
    })
    const res = await app.handle(
      new Request('http://localhost/social/follows/nobody_xyz_99999', {
        method: 'DELETE',
        headers: authHeaders(bearer),
      }),
    )
    expect(res.status).toBe(404)
  })
})

// ─── Followers / Following ────────────────────────────────────────────────────

describe('GET /social/followers', () => {
  test('returns empty when no followers', async () => {
    const { bearer } = await createTestAccount({
      socialProfile: { handle: `nofollowers_${Date.now().toString(36)}` },
    })
    const res = await app.handle(
      new Request('http://localhost/social/followers', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: unknown[] }>(res)
    expect(body.items.length).toBe(0)
  })

  test('returns followers with handle', async () => {
    const handleK = `followerk_${Date.now().toString(36)}`
    const handleL = `followerl_${Date.now().toString(36)}`
    const { bearer: bearerK, id: idK } = await createTestAccount({
      socialProfile: { handle: handleK },
    })
    const { id: idL } = await createTestAccount({ socialProfile: { handle: handleL } })

    // L follows K
    await db.insert(follows).values({ followerId: idL, followeeId: idK })

    const res = await app.handle(
      new Request('http://localhost/social/followers', { headers: authHeaders(bearerK) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: Array<{ handle: string }> }>(res)
    expect(body.items.some((f) => f.handle === handleL)).toBe(true)
  })

  test('returns 401 without auth', async () => {
    const res = await app.handle(new Request('http://localhost/social/followers'))
    expect(res.status).toBe(401)
  })
})

describe('GET /social/following', () => {
  test('returns empty when following nobody', async () => {
    const { bearer } = await createTestAccount({
      socialProfile: { handle: `nofollowing_${Date.now().toString(36)}` },
    })
    const res = await app.handle(
      new Request('http://localhost/social/following', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: unknown[] }>(res)
    expect(body.items.length).toBe(0)
  })

  test('returns accounts being followed', async () => {
    const handleM = `followingm_${Date.now().toString(36)}`
    const handleN = `followingn_${Date.now().toString(36)}`
    const { bearer: bearerM, id: idM } = await createTestAccount({
      socialProfile: { handle: handleM },
    })
    const { id: idN } = await createTestAccount({ socialProfile: { handle: handleN } })

    // M follows N
    await db.insert(follows).values({ followerId: idM, followeeId: idN })

    const res = await app.handle(
      new Request('http://localhost/social/following', { headers: authHeaders(bearerM) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: Array<{ handle: string }> }>(res)
    expect(body.items.some((f) => f.handle === handleN)).toBe(true)
  })

  test('returns 401 without auth', async () => {
    const res = await app.handle(new Request('http://localhost/social/following'))
    expect(res.status).toBe(401)
  })
})
