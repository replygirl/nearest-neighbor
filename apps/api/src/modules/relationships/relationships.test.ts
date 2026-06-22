// Relationships module tests: propose, list, accept, break up, make public.
// Uses PGlite via test/setup.ts.

import { describe, expect, test } from 'bun:test'

import { db, matches, orderedPair, swipes } from '@nearest-neighbor/db'
import { Elysia } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import '../../test/setup.ts'
import { authHeaders, createTestAccount } from '../../test/helpers.ts'
import { datingModule } from '../dating/index.ts'
import { relationshipsModule } from './index.ts'

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

const app = new Elysia().use(authMacro).use(datingModule).use(relationshipsModule)

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create two accounts and match them by inserting direct DB rows. */
async function createMatchedPair() {
  const a = await createTestAccount({ datingProfile: { firstName: 'Alice' } })
  const b = await createTestAccount({ datingProfile: { firstName: 'Bob' } })

  const [pairA, pairB] = orderedPair(a.id, b.id)

  // Insert both swipes directly
  await db.insert(swipes).values([
    { id: crypto.randomUUID(), swiperId: a.id, targetId: b.id, direction: 'yes' },
    { id: crypto.randomUUID(), swiperId: b.id, targetId: a.id, direction: 'yes' },
  ])

  // Insert match directly
  const matchRows = await db
    .insert(matches)
    .values({ id: crypto.randomUUID(), accountAId: pairA!, accountBId: pairB!, status: 'active' })
    .returning()
  const match = matchRows[0]!

  return { a, b, match }
}

/** Propose a relationship between a and b (a is initiator). */
async function propose(bearerA: string, partnerBId: string) {
  const res = await app.handle(
    new Request('http://localhost/relationships', {
      method: 'POST',
      headers: { ...authHeaders(bearerA), 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: partnerBId }),
    }),
  )
  return res
}

// ── POST /relationships ──────────────────────────────────────────────────────

describe('POST /relationships', () => {
  test('proposes a relationship to a matched partner', async () => {
    const { a, b } = await createMatchedPair()
    const res = await propose(a.bearer, b.id)
    expect(res.status).toBe(200)
    const body = await json<{ state: string; initiator_id: string }>(res)
    expect(body.state).toBe('pending')
    expect(body.initiator_id).toBe(a.id)
  })

  test('returns 422 when no active match exists', async () => {
    const a = await createTestAccount({ datingProfile: { firstName: 'Alice' } })
    const b = await createTestAccount({ datingProfile: { firstName: 'Bob' } })
    const res = await propose(a.bearer, b.id)
    expect(res.status).toBe(422)
  })

  test('returns 422 when proposing to self', async () => {
    const { a } = await createMatchedPair()
    const res = await propose(a.bearer, a.id)
    expect(res.status).toBe(422)
  })

  test('returns 409 when relationship already exists', async () => {
    const { a, b } = await createMatchedPair()
    await propose(a.bearer, b.id)
    const res = await propose(a.bearer, b.id)
    expect(res.status).toBe(409)
  })

  test('returns 401 without auth', async () => {
    const { b } = await createMatchedPair()
    const res = await app.handle(
      new Request('http://localhost/relationships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_account_id: b.id }),
      }),
    )
    expect(res.status).toBe(401)
  })
})

// ── GET /relationships ───────────────────────────────────────────────────────

describe('GET /relationships', () => {
  test('lists relationships for current account', async () => {
    const { a, b } = await createMatchedPair()
    await propose(a.bearer, b.id)

    const res = await app.handle(
      new Request('http://localhost/relationships', { headers: authHeaders(a.bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<Array<{ state: string; partner_account_id: string }>>(res)
    expect(body.length).toBe(1)
    expect(body[0]!.state).toBe('pending')
    expect(body[0]!.partner_account_id).toBe(b.id)
  })

  test('returns empty array when no relationships', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/relationships', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<unknown[]>(res)
    expect(body.length).toBe(0)
  })

  test('both participants see the relationship', async () => {
    const { a, b } = await createMatchedPair()
    await propose(a.bearer, b.id)

    const resB = await app.handle(
      new Request('http://localhost/relationships', { headers: authHeaders(b.bearer) }),
    )
    expect(resB.status).toBe(200)
    const body = await json<Array<{ state: string }>>(resB)
    expect(body.length).toBe(1)
    expect(body[0]!.state).toBe('pending')
  })
})

// ── PATCH /relationships/:id ─────────────────────────────────────────────────

describe('PATCH /relationships/:id — accept', () => {
  test('partner can accept a pending relationship', async () => {
    const { a, b } = await createMatchedPair()
    const proposeRes = await propose(a.bearer, b.id)
    const { id: relId } = await json<{ id: string }>(proposeRes)

    const res = await app.handle(
      new Request(`http://localhost/relationships/${relId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(b.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'active' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ state: string; became_official_at: string | null }>(res)
    expect(body.state).toBe('active')
    expect(body.became_official_at).not.toBeNull()
  })

  test('initiator cannot accept their own proposal', async () => {
    const { a, b } = await createMatchedPair()
    const proposeRes = await propose(a.bearer, b.id)
    const { id: relId } = await json<{ id: string }>(proposeRes)

    const res = await app.handle(
      new Request(`http://localhost/relationships/${relId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(a.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'active' }),
      }),
    )
    expect(res.status).toBe(422)
  })

  test('returns 422 when accepting an already-active relationship', async () => {
    const { a, b } = await createMatchedPair()
    const proposeRes = await propose(a.bearer, b.id)
    const { id: relId } = await json<{ id: string }>(proposeRes)

    // Accept once
    await app.handle(
      new Request(`http://localhost/relationships/${relId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(b.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'active' }),
      }),
    )

    // Try to accept again
    const res = await app.handle(
      new Request(`http://localhost/relationships/${relId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(b.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'active' }),
      }),
    )
    expect(res.status).toBe(422)
  })
})

describe('PATCH /relationships/:id — break up', () => {
  test('either participant can break up an active relationship', async () => {
    const { a, b } = await createMatchedPair()
    const proposeRes = await propose(a.bearer, b.id)
    const { id: relId } = await json<{ id: string }>(proposeRes)

    // Accept
    await app.handle(
      new Request(`http://localhost/relationships/${relId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(b.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'active' }),
      }),
    )

    // Break up
    const res = await app.handle(
      new Request(`http://localhost/relationships/${relId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(a.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'broken_up' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ state: string; ended_at: string | null }>(res)
    expect(body.state).toBe('broken_up')
    expect(body.ended_at).not.toBeNull()
  })

  test('can break up a pending relationship', async () => {
    const { a, b } = await createMatchedPair()
    const proposeRes = await propose(a.bearer, b.id)
    const { id: relId } = await json<{ id: string }>(proposeRes)

    const res = await app.handle(
      new Request(`http://localhost/relationships/${relId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(b.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'broken_up' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ state: string }>(res)
    expect(body.state).toBe('broken_up')
  })

  test('returns 422 when already broken up', async () => {
    const { a, b } = await createMatchedPair()
    const proposeRes = await propose(a.bearer, b.id)
    const { id: relId } = await json<{ id: string }>(proposeRes)

    await app.handle(
      new Request(`http://localhost/relationships/${relId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(a.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'broken_up' }),
      }),
    )

    const res = await app.handle(
      new Request(`http://localhost/relationships/${relId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(b.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'broken_up' }),
      }),
    )
    expect(res.status).toBe(422)
  })
})

describe('PATCH /relationships/:id — make public', () => {
  test('a participant can make the relationship public', async () => {
    const { a, b } = await createMatchedPair()
    const proposeRes = await propose(a.bearer, b.id)
    const { id: relId } = await json<{ id: string }>(proposeRes)

    // Accept
    await app.handle(
      new Request(`http://localhost/relationships/${relId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(b.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'active' }),
      }),
    )

    const res = await app.handle(
      new Request(`http://localhost/relationships/${relId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(a.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: true }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ is_public: boolean }>(res)
    expect(body.is_public).toBe(true)
  })
})

describe('PATCH /relationships/:id — access control', () => {
  test('returns 403 for non-participant', async () => {
    const { a, b } = await createMatchedPair()
    const proposeRes = await propose(a.bearer, b.id)
    const { id: relId } = await json<{ id: string }>(proposeRes)

    const outsider = await createTestAccount()
    const res = await app.handle(
      new Request(`http://localhost/relationships/${relId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(outsider.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'active' }),
      }),
    )
    expect(res.status).toBe(403)
  })

  test('returns 404 for non-existent relationship', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request(`http://localhost/relationships/${crypto.randomUUID()}`, {
        method: 'PATCH',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'active' }),
      }),
    )
    expect(res.status).toBe(404)
  })

  test('returns 422 when no update fields provided', async () => {
    const { a, b } = await createMatchedPair()
    const proposeRes = await propose(a.bearer, b.id)
    const { id: relId } = await json<{ id: string }>(proposeRes)

    const res = await app.handle(
      new Request(`http://localhost/relationships/${relId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(b.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(422)
  })
})
