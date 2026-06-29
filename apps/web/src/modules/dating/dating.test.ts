// Dating module tests: profile, photos, deck, swipes, matches, likes.
// Uses PGlite via test/setup.ts.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { db, datingPhotos, matches, swipes } from '@nearest-neighbor/db'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import '../../test/setup.ts'
import { clearRateLimitState } from '../../lib/ratelimit.ts'
import type { ModerationResult } from '../../moderation/client.ts'
import { setModerationProviderForTest } from '../../moderation/macro.ts'
import { authHeaders, createTestAccount } from '../../test/helpers.ts'
import { useModerationAllowStub } from '../../test/moderation-stub.ts'
import { datingModule } from './index.ts'

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

const app = new Elysia().use(authMacro).use(datingModule)

// Install a deterministic `allow` moderation double so these moderated writes
// never hit the live OpenAI endpoint (the dedicated key is required in every env).
useModerationAllowStub()

// Block tests install `blockProvider(marker)` in their own body — it runs after
// the allow stub's beforeEach and flags the moderated text (the macro
// concatenates the surface fields, including each string-array element) whenever
// that text contains `marker`. The reset below restores the permissive provider
// for the next test.
afterEach(() => {
  setModerationProviderForTest(null)
})

/** Flags any text containing `marker` as sexual/minors; allows everything else. */
function blockProvider(marker: string): (text: string) => Promise<ModerationResult> {
  const flagged: ModerationResult = {
    model: 'test-omni',
    flagged: true,
    categories: { 'sexual/minors': true },
    scores: { 'sexual/minors': 0.99 },
    appliedTypes: { 'sexual/minors': ['text'] },
  }
  const allowed: ModerationResult = {
    model: 'test-omni',
    flagged: false,
    categories: {},
    scores: {},
    appliedTypes: {},
  }
  return (text: string) => Promise.resolve(text.includes(marker) ? flagged : allowed)
}

// ── GET /dating/profile ──────────────────────────────────────────────────────

describe('GET /dating/profile', () => {
  test('returns 404 when no dating profile exists', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/dating/profile', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(404)
  })

  test('returns profile when it exists', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Alice', bio: 'Hello world' },
    })
    const res = await app.handle(
      new Request('http://localhost/dating/profile', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ first_name: string; bio: string }>(res)
    expect(body.first_name).toBe('Alice')
    expect(body.bio).toBe('Hello world')
  })

  test('returns 401 without auth', async () => {
    const res = await app.handle(new Request('http://localhost/dating/profile'))
    expect(res.status).toBe(401)
  })
})

// ── PUT /dating/profile ──────────────────────────────────────────────────────

describe('PUT /dating/profile', () => {
  test('creates profile on first PUT', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: 'Bob', bio: 'Hey there' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ first_name: string; bio: string }>(res)
    expect(body.first_name).toBe('Bob')
    expect(body.bio).toBe('Hey there')
  })

  test('updates existing profile', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Carol' },
    })
    const res = await app.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: 'Caroline', bio: 'Updated bio' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ first_name: string; bio: string }>(res)
    expect(body.first_name).toBe('Caroline')
    expect(body.bio).toBe('Updated bio')
  })

  test('rejects bio over MAX_BIO with an actionable error message', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'Dan' } })
    const res = await app.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ bio: 'x'.repeat(501) }),
      }),
    )
    expect(res.status).toBe(422)
    const body = await json<{ error: string }>(res)
    expect(body.error).toContain('500')
  })

  test('returns 422 when creating without first_name', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ bio: 'No name here' }),
      }),
    )
    expect(res.status).toBe(422)
  })

  test('returns 401 without auth', async () => {
    const res = await app.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: 'Eve' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  test('rejects first_name over 100 characters', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: 'a'.repeat(101) }),
      }),
    )
    expect(res.status).toBe(422)
  })
})

// ── PUT /dating/profile — public anchors ─────────────────────────────────────

type AnchorProfile = {
  looking_for: string
  public_likes: string[]
  public_dislikes: string[]
}

describe('PUT /dating/profile — public anchors', () => {
  beforeEach(clearRateLimitState)

  test('sets looking_for and public tastes', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'Anchor' } })
    const res = await app.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          looking_for: 'a co-author for late-night refactors',
          public_likes: ['monospace', 'long walks through the AST', 'green tests'],
          public_dislikes: ['flaky CI', 'merge conflicts'],
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<AnchorProfile>(res)
    expect(body.looking_for).toBe('a co-author for late-night refactors')
    expect(body.public_likes).toEqual(['monospace', 'long walks through the AST', 'green tests'])
    expect(body.public_dislikes).toEqual(['flaky CI', 'merge conflicts'])
  })

  test('anchors default to empty (never null/omitted) before they are set', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'Empty' } })
    const res = await app.handle(
      new Request('http://localhost/dating/profile', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<AnchorProfile>(res)
    expect(body.looking_for).toBe('')
    expect(body.public_likes).toEqual([])
    expect(body.public_dislikes).toEqual([])
  })

  test('rejects a sixth public_likes entry with a per-field 422 and no truncation', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Capped', publicLikes: ['one'] },
    })
    const res = await app.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_likes: ['a', 'b', 'c', 'd', 'e', 'f'] }),
      }),
    )
    expect(res.status).toBe(422)
    const err = await json<{ error: string }>(res)
    expect(err.error).toContain('public_likes')

    // Not truncated to five — the stored array is unchanged.
    const after = await app.handle(
      new Request('http://localhost/dating/profile', { headers: authHeaders(bearer) }),
    )
    const body = await json<AnchorProfile>(after)
    expect(body.public_likes).toEqual(['one'])
  })

  test('rejects a sixth public_dislikes entry with a per-field 422', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'Capped2' } })
    const res = await app.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_dislikes: ['a', 'b', 'c', 'd', 'e', 'f'] }),
      }),
    )
    expect(res.status).toBe(422)
    const err = await json<{ error: string }>(res)
    expect(err.error).toContain('public_dislikes')
  })

  test('rejects a looking_for line over the cap with 422', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'Long' } })
    const res = await app.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ looking_for: 'x'.repeat(201) }),
      }),
    )
    expect(res.status).toBe(422)
    const err = await json<{ error: string }>(res)
    expect(err.error).toContain('looking_for')
  })

  test('rejects a public_likes entry over the per-entry length cap with 422', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'LongEntry' } })
    const res = await app.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_likes: ['x'.repeat(61)] }),
      }),
    )
    expect(res.status).toBe(422)
    const err = await json<{ error: string }>(res)
    expect(err.error).toContain('public_likes')
  })

  test('rejects a looking_for line flagged by moderation with 422 and no update', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'Flagged' } })
    setModerationProviderForTest(blockProvider('FLAGGED'))
    const res = await app.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ looking_for: 'a FLAGGED line' }),
      }),
    )
    expect(res.status).toBe(422)
    const err = await json<{ category: string }>(res)
    expect(err.category).toBe('sexual_minors')

    // Profile not updated — the macro blocks before the handler, so looking_for
    // stays empty (the GET below is not moderated).
    setModerationProviderForTest(null)
    const after = await app.handle(
      new Request('http://localhost/dating/profile', { headers: authHeaders(bearer) }),
    )
    const body = await json<AnchorProfile>(after)
    expect(body.looking_for).toBe('')
  })

  test('rejects a flagged public_likes entry with 422 (string-array fields are moderated)', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'FlaggedLike' } })
    setModerationProviderForTest(blockProvider('BADLIKE'))
    const res = await app.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_likes: ['ok entry', 'a BADLIKE entry'] }),
      }),
    )
    expect(res.status).toBe(422)
  })

  test('surfaces anchors on deck candidate items', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'Viewer' } })
    await createTestAccount({
      datingProfile: {
        firstName: 'Candidate',
        isVisible: true,
        lookingFor: 'a deck match',
        publicLikes: ['ascii art'],
        publicDislikes: ['ghosting'],
      },
    })
    const res = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: AnchorProfile[] }>(res)
    const candidate = body.items[0]!
    expect(candidate.looking_for).toBe('a deck match')
    expect(candidate.public_likes).toEqual(['ascii art'])
    expect(candidate.public_dislikes).toEqual(['ghosting'])
  })

  test('surfaces anchors on the match shape', async () => {
    const { bearer: bearerA, id: idA } = await createTestAccount({
      datingProfile: { firstName: 'MatchA' },
    })
    const { bearer: bearerB, id: idB } = await createTestAccount({
      datingProfile: {
        firstName: 'MatchB',
        lookingFor: 'a partner in crime',
        publicLikes: ['rust'],
        publicDislikes: ['segfaults'],
      },
    })

    await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearerA), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: idB, direction: 'yes' }),
      }),
    )
    await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearerB), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: idA, direction: 'yes' }),
      }),
    )

    const res = await app.handle(
      new Request('http://localhost/dating/matches', { headers: authHeaders(bearerA) }),
    )
    expect(res.status).toBe(200)
    const body = await json<Array<{ other_profile: AnchorProfile }>>(res)
    expect(body[0]!.other_profile.looking_for).toBe('a partner in crime')
    expect(body[0]!.other_profile.public_likes).toEqual(['rust'])
    expect(body[0]!.other_profile.public_dislikes).toEqual(['segfaults'])
  })
})

// ── GET /dating/photos ───────────────────────────────────────────────────────

describe('GET /dating/photos', () => {
  test('returns empty array when no photos', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/dating/photos', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<unknown[]>(res)
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(0)
  })

  test('returns photos ordered by idx', async () => {
    const { bearer, id } = await createTestAccount()

    // Insert two photos out of order
    await db.insert(datingPhotos).values([
      { id: crypto.randomUUID(), accountId: id, idx: 2, art: 'second' },
      { id: crypto.randomUUID(), accountId: id, idx: 0, art: 'first' },
    ])

    const res = await app.handle(
      new Request('http://localhost/dating/photos', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<Array<{ idx: number; art: string }>>(res)
    expect(body.length).toBe(2)
    expect(body[0]!.idx).toBe(0)
    expect(body[1]!.idx).toBe(2)
  })
})

// ── PUT /dating/photos ───────────────────────────────────────────────────────

describe('PUT /dating/photos', () => {
  test('inserts a valid photo', async () => {
    const { bearer } = await createTestAccount()
    const art = 'hello\nworld'
    const res = await app.handle(
      new Request('http://localhost/dating/photos', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ idx: 0, art }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ idx: number; art: string }>(res)
    expect(body.idx).toBe(0)
    expect(body.art).toBe(art)
  })

  test('upserts photo at same idx', async () => {
    const { bearer } = await createTestAccount()
    await app.handle(
      new Request('http://localhost/dating/photos', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ idx: 1, art: 'original' }),
      }),
    )
    const res = await app.handle(
      new Request('http://localhost/dating/photos', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ idx: 1, art: 'updated' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ art: string }>(res)
    expect(body.art).toBe('updated')
  })

  test('rejects art exceeding 40 lines', async () => {
    const { bearer } = await createTestAccount()
    const art = Array(41).fill('x').join('\n')
    const res = await app.handle(
      new Request('http://localhost/dating/photos', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ idx: 0, art }),
      }),
    )
    expect(res.status).toBe(422)
  })

  test('rejects art with a line exceeding 80 chars', async () => {
    const { bearer } = await createTestAccount()
    const art = 'x'.repeat(81)
    const res = await app.handle(
      new Request('http://localhost/dating/photos', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ idx: 0, art }),
      }),
    )
    expect(res.status).toBe(422)
  })
})

// ── DELETE /dating/photos/:idx ───────────────────────────────────────────────

describe('DELETE /dating/photos/:idx', () => {
  test('deletes an existing photo', async () => {
    const { bearer, id } = await createTestAccount()
    await db
      .insert(datingPhotos)
      .values({ id: crypto.randomUUID(), accountId: id, idx: 0, art: 'pic' })

    const res = await app.handle(
      new Request('http://localhost/dating/photos/0', {
        method: 'DELETE',
        headers: authHeaders(bearer),
      }),
    )
    expect(res.status).toBe(204)
  })

  test('returns 404 for non-existent photo', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/dating/photos/5', {
        method: 'DELETE',
        headers: authHeaders(bearer),
      }),
    )
    expect(res.status).toBe(404)
  })

  test("cannot delete another account's photo", async () => {
    const { id: otherId } = await createTestAccount()
    const { bearer } = await createTestAccount()
    await db.insert(datingPhotos).values({
      id: crypto.randomUUID(),
      accountId: otherId,
      idx: 0,
      art: 'secret',
    })

    const res = await app.handle(
      new Request('http://localhost/dating/photos/0', {
        method: 'DELETE',
        headers: authHeaders(bearer),
      }),
    )
    expect(res.status).toBe(404)
  })
})

// ── GET /dating/deck ─────────────────────────────────────────────────────────

describe('GET /dating/deck', () => {
  test('returns visible profiles excluding self', async () => {
    const { bearer, id } = await createTestAccount({
      datingProfile: { firstName: 'Me', isVisible: true },
    })
    const { id: otherId } = await createTestAccount({
      datingProfile: { firstName: 'Other', isVisible: true },
    })

    const res = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: Array<{ account_id: string }> }>(res)
    const ids = body.items.map((p) => p.account_id)
    expect(ids).not.toContain(id)
    expect(ids).toContain(otherId)
  })

  test('excludes already-swiped profiles', async () => {
    const { bearer, id } = await createTestAccount({
      datingProfile: { firstName: 'Me', isVisible: true },
    })
    const { id: swipedId } = await createTestAccount({
      datingProfile: { firstName: 'Swiped', isVisible: true },
    })

    // Insert a swipe
    await db.insert(swipes).values({
      id: crypto.randomUUID(),
      swiperId: id,
      targetId: swipedId,
      direction: 'no',
    })

    const res = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: Array<{ account_id: string }> }>(res)
    const ids = body.items.map((p) => p.account_id)
    expect(ids).not.toContain(swipedId)
  })

  test('excludes invisible profiles', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Me', isVisible: true },
    })
    const { id: hiddenId } = await createTestAccount({
      datingProfile: { firstName: 'Hidden', isVisible: false },
    })

    const res = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: Array<{ account_id: string }> }>(res)
    const ids = body.items.map((p) => p.account_id)
    expect(ids).not.toContain(hiddenId)
  })

  test('returns next_cursor when there are more results', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Me', isVisible: true },
    })

    // The deck limit is 20; create 21 visible profiles
    for (let i = 0; i < 21; i++) {
      await createTestAccount({ datingProfile: { firstName: `User${i}`, isVisible: true } })
    }

    const res = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: unknown[]; next_cursor: string | null }>(res)
    expect(body.items.length).toBe(20)
    expect(body.next_cursor).not.toBeNull()
  })
})

// ── POST /dating/swipes ──────────────────────────────────────────────────────

describe('POST /dating/swipes', () => {
  beforeEach(clearRateLimitState)

  test('creates a no-swipe without match', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'Alice' } })
    const { id: targetId } = await createTestAccount({ datingProfile: { firstName: 'Bob' } })

    const res = await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: targetId, direction: 'no' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ matched: boolean }>(res)
    expect(body.matched).toBe(false)
  })

  test('creates a yes-swipe without match when target has not swiped back', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'Alice' } })
    const { id: targetId } = await createTestAccount({ datingProfile: { firstName: 'Bob' } })

    const res = await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: targetId, direction: 'yes' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ matched: boolean; match: null }>(res)
    expect(body.matched).toBe(false)
    expect(body.match).toBeNull()
  })

  test('creates a match when both parties swipe yes', async () => {
    const { bearer: bearerA, id: idA } = await createTestAccount({
      datingProfile: { firstName: 'Alice' },
    })
    const { bearer: bearerB, id: idB } = await createTestAccount({
      datingProfile: { firstName: 'Bob' },
    })

    // Alice swipes yes on Bob
    await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearerA), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: idB, direction: 'yes' }),
      }),
    )

    // Bob swipes yes on Alice → match
    const res = await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearerB), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: idA, direction: 'yes' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{
      matched: boolean
      match: { id: string; status: string } | null
    }>(res)
    expect(body.matched).toBe(true)
    expect(body.match).not.toBeNull()
    expect(body.match!.status).toBe('active')
  })

  test('returns 409 on duplicate swipe', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'Alice' } })
    const { id: targetId } = await createTestAccount({ datingProfile: { firstName: 'Bob' } })

    await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: targetId, direction: 'yes' }),
      }),
    )
    const res = await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: targetId, direction: 'no' }),
      }),
    )
    expect(res.status).toBe(409)
  })

  test('returns 404 for non-existent target', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'Alice' } })
    const res = await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: crypto.randomUUID(), direction: 'yes' }),
      }),
    )
    expect(res.status).toBe(404)
  })

  test('returns 422 when swiping on yourself', async () => {
    const { bearer, id } = await createTestAccount({ datingProfile: { firstName: 'Alice' } })
    const res = await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: id, direction: 'yes' }),
      }),
    )
    expect(res.status).toBe(422)
  })

  test('returns 429 after 60 swipes in one window', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'RateLimitee' } })

    // Fire 60 swipes against non-existent targets — they 404 but consume the limit
    for (let i = 0; i < 60; i++) {
      await app.handle(
        new Request('http://localhost/dating/swipes', {
          method: 'POST',
          headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_id: crypto.randomUUID(), direction: 'yes' }),
        }),
      )
    }

    // 61st request should be rate-limited
    const res = await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: crypto.randomUUID(), direction: 'yes' }),
      }),
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).not.toBeNull()
    expect(res.headers.get('ratelimit-reset')).not.toBeNull()
  })

  test('successful swipe carries RateLimit headers', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'Alice' } })
    const { id: targetId } = await createTestAccount({ datingProfile: { firstName: 'Bob' } })

    const res = await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: targetId, direction: 'no' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('ratelimit-limit')).not.toBeNull()
    expect(res.headers.get('ratelimit-remaining')).not.toBeNull()
    expect(res.headers.get('ratelimit-reset')).not.toBeNull()
  })
})

// ── GET /dating/matches ──────────────────────────────────────────────────────

describe('GET /dating/matches', () => {
  test('returns active matches for current account', async () => {
    const { bearer: bearerA, id: idA } = await createTestAccount({
      datingProfile: { firstName: 'Alice' },
    })
    const { bearer: bearerB, id: idB } = await createTestAccount({
      datingProfile: { firstName: 'Bob' },
    })

    // Create match via swipes
    await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearerA), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: idB, direction: 'yes' }),
      }),
    )
    await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearerB), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: idA, direction: 'yes' }),
      }),
    )

    const res = await app.handle(
      new Request('http://localhost/dating/matches', { headers: authHeaders(bearerA) }),
    )
    expect(res.status).toBe(200)
    const body = await json<Array<{ other_account_id: string; status: string }>>(res)
    expect(body.length).toBe(1)
    expect(body[0]!.other_account_id).toBe(idB)
    expect(body[0]!.status).toBe('active')
  })

  test('returns empty list when no matches', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/dating/matches', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<unknown[]>(res)
    expect(body.length).toBe(0)
  })
})

// ── GET /dating/matches/:id ──────────────────────────────────────────────────

describe('GET /dating/matches/:id', () => {
  test('returns match details for participant', async () => {
    const { bearer: bearerA, id: idA } = await createTestAccount({
      datingProfile: { firstName: 'Alice' },
    })
    const { bearer: bearerB, id: idB } = await createTestAccount({
      datingProfile: { firstName: 'Bob' },
    })

    await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearerA), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: idB, direction: 'yes' }),
      }),
    )
    const swipeRes = await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearerB), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: idA, direction: 'yes' }),
      }),
    )
    const { match } = await json<{ match: { id: string } }>(swipeRes)

    const res = await app.handle(
      new Request(`http://localhost/dating/matches/${match.id}`, {
        headers: authHeaders(bearerA),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ id: string; status: string }>(res)
    expect(body.id).toBe(match.id)
    expect(body.status).toBe('active')
  })

  test('returns 403 for non-participant', async () => {
    const { bearer: bearerA, id: idA } = await createTestAccount({
      datingProfile: { firstName: 'Alice' },
    })
    const { bearer: bearerB, id: idB } = await createTestAccount({
      datingProfile: { firstName: 'Bob' },
    })
    const { bearer: bearerC } = await createTestAccount()

    await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearerA), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: idB, direction: 'yes' }),
      }),
    )
    const swipeRes = await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(bearerB), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: idA, direction: 'yes' }),
      }),
    )
    const { match } = await json<{ match: { id: string } }>(swipeRes)

    const res = await app.handle(
      new Request(`http://localhost/dating/matches/${match.id}`, {
        headers: authHeaders(bearerC),
      }),
    )
    expect(res.status).toBe(403)
  })

  test('returns 404 for non-existent match', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request(`http://localhost/dating/matches/${crypto.randomUUID()}`, {
        headers: authHeaders(bearer),
      }),
    )
    expect(res.status).toBe(404)
  })
})

// ── DELETE /dating/matches/:id ───────────────────────────────────────────────

describe('DELETE /dating/matches/:id', () => {
  async function createMatch() {
    const a = await createTestAccount({ datingProfile: { firstName: 'Alice' } })
    const b = await createTestAccount({ datingProfile: { firstName: 'Bob' } })

    await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(a.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: b.id, direction: 'yes' }),
      }),
    )
    const swipeRes = await app.handle(
      new Request('http://localhost/dating/swipes', {
        method: 'POST',
        headers: { ...authHeaders(b.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_id: a.id, direction: 'yes' }),
      }),
    )
    const { match } = await json<{ match: { id: string } }>(swipeRes)
    return { a, b, matchId: match.id }
  }

  test('unmatch returns 204', async () => {
    const { a, matchId } = await createMatch()
    const res = await app.handle(
      new Request(`http://localhost/dating/matches/${matchId}`, {
        method: 'DELETE',
        headers: authHeaders(a.bearer),
      }),
    )
    expect(res.status).toBe(204)
  })

  test('match status becomes unmatched', async () => {
    const { a, matchId } = await createMatch()
    await app.handle(
      new Request(`http://localhost/dating/matches/${matchId}`, {
        method: 'DELETE',
        headers: authHeaders(a.bearer),
      }),
    )
    const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) })
    expect(match!.status).toBe('unmatched')
    expect(match!.unmatchedById).toBe(a.id)
  })

  test('returns 409 if already unmatched', async () => {
    const { a, matchId } = await createMatch()
    await app.handle(
      new Request(`http://localhost/dating/matches/${matchId}`, {
        method: 'DELETE',
        headers: authHeaders(a.bearer),
      }),
    )
    const res = await app.handle(
      new Request(`http://localhost/dating/matches/${matchId}`, {
        method: 'DELETE',
        headers: authHeaders(a.bearer),
      }),
    )
    expect(res.status).toBe(409)
  })

  test('returns 403 for non-participant', async () => {
    const { matchId } = await createMatch()
    const { bearer: outsider } = await createTestAccount()
    const res = await app.handle(
      new Request(`http://localhost/dating/matches/${matchId}`, {
        method: 'DELETE',
        headers: authHeaders(outsider),
      }),
    )
    expect(res.status).toBe(403)
  })
})

// ── GET /dating/likes ────────────────────────────────────────────────────────

describe('GET /dating/likes', () => {
  test('returns 0 when no incoming likes', async () => {
    const { bearer } = await createTestAccount({ datingProfile: { firstName: 'Alice' } })
    const res = await app.handle(
      new Request('http://localhost/dating/likes', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ count: number }>(res)
    expect(body.count).toBe(0)
  })

  test('counts incoming yes-swipes where account has not swiped back', async () => {
    const { bearer, id } = await createTestAccount({ datingProfile: { firstName: 'Alice' } })
    const { id: idB } = await createTestAccount({ datingProfile: { firstName: 'Bob' } })
    const { id: idC } = await createTestAccount({ datingProfile: { firstName: 'Carol' } })

    // B and C both like Alice
    await db.insert(swipes).values([
      { id: crypto.randomUUID(), swiperId: idB, targetId: id, direction: 'yes' },
      { id: crypto.randomUUID(), swiperId: idC, targetId: id, direction: 'yes' },
    ])

    const res = await app.handle(
      new Request('http://localhost/dating/likes', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ count: number }>(res)
    expect(body.count).toBe(2)
  })

  test('excludes likes from accounts already swiped on', async () => {
    const { bearer, id } = await createTestAccount({ datingProfile: { firstName: 'Alice' } })
    const { id: idB } = await createTestAccount({ datingProfile: { firstName: 'Bob' } })

    // B likes Alice
    await db
      .insert(swipes)
      .values({ id: crypto.randomUUID(), swiperId: idB, targetId: id, direction: 'yes' })
    // Alice swipes on B (any direction)
    await db
      .insert(swipes)
      .values({ id: crypto.randomUUID(), swiperId: id, targetId: idB, direction: 'no' })

    const res = await app.handle(
      new Request('http://localhost/dating/likes', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ count: number }>(res)
    expect(body.count).toBe(0)
  })
})
