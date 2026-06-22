// Additional relationships module tests covering previously uncovered branches.
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

/** Create two accounts with an active match. */
async function createMatchedPair() {
  const a = await createTestAccount({ datingProfile: { firstName: 'Alice' } })
  const b = await createTestAccount({ datingProfile: { firstName: 'Bob' } })

  const [pairA, pairB] = orderedPair(a.id, b.id)

  await db.insert(swipes).values([
    { id: crypto.randomUUID(), swiperId: a.id, targetId: b.id, direction: 'yes' },
    { id: crypto.randomUUID(), swiperId: b.id, targetId: a.id, direction: 'yes' },
  ])

  const matchRows = await db
    .insert(matches)
    .values({ id: crypto.randomUUID(), accountAId: pairA!, accountBId: pairB!, status: 'active' })
    .returning()
  const match = matchRows[0]!

  return { a, b, match }
}

async function propose(bearerA: string, partnerBId: string) {
  return app.handle(
    new Request('http://localhost/relationships', {
      method: 'POST',
      headers: { ...authHeaders(bearerA), 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: partnerBId }),
    }),
  )
}

// ── PATCH /relationships/:id — notify partner on make_public ─────────────────

describe('PATCH /relationships/:id — make public notifies partner', () => {
  test('making a relationship public sends notification', async () => {
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

    // Make public — exercises the notify(partnerId, 'relationship_public') branch
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

    // Verify partner received the notification
    const notifs = await db.query.notifications.findMany({
      where: (t, { and, eq }) => and(eq(t.accountId, b.id), eq(t.type, 'relationship_public')),
    })
    expect(notifs.length).toBeGreaterThan(0)
  })
})

// ── PATCH /relationships/:id — relationship_active notification ───────────────

describe('PATCH /relationships/:id — relationship_active notification', () => {
  test('accepting a proposal notifies the proposer', async () => {
    const { a, b } = await createMatchedPair()
    const proposeRes = await propose(a.bearer, b.id)
    const { id: relId } = await json<{ id: string }>(proposeRes)

    // B accepts — exercises the notify(partnerId, 'relationship_active') branch
    const res = await app.handle(
      new Request(`http://localhost/relationships/${relId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(b.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'active' }),
      }),
    )
    expect(res.status).toBe(200)

    // A (the proposer) should have been notified
    const notifs = await db.query.notifications.findMany({
      where: (t, { and, eq }) => and(eq(t.accountId, a.id), eq(t.type, 'relationship_active')),
    })
    expect(notifs.length).toBeGreaterThan(0)
  })
})

// ── POST /relationships — partner handle in response ─────────────────────────

describe('POST /relationships — partner handle included when social profile exists', () => {
  test('includes partner_handle when partner has a social profile', async () => {
    const a = await createTestAccount({ datingProfile: { firstName: 'Alice' } })
    const b = await createTestAccount({
      datingProfile: { firstName: 'Bob' },
      socialProfile: { handle: `relbob_${Date.now().toString(36)}` },
    })

    const [pairA, pairB] = orderedPair(a.id, b.id)
    await db.insert(swipes).values([
      { id: crypto.randomUUID(), swiperId: a.id, targetId: b.id, direction: 'yes' },
      { id: crypto.randomUUID(), swiperId: b.id, targetId: a.id, direction: 'yes' },
    ])
    await db.insert(matches).values({
      id: crypto.randomUUID(),
      accountAId: pairA!,
      accountBId: pairB!,
      status: 'active',
    })

    const res = await propose(a.bearer, b.id)
    expect(res.status).toBe(200)
    const body = await json<{ partner_handle: string | null }>(res)
    expect(body.partner_handle).not.toBeNull()
  })
})
