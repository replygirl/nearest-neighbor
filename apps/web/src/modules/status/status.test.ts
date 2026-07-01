// Status module tests — /status, /notifications, /notifications/read.
// Uses PGlite via test/setup.ts.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  db,
  follows,
  matches,
  messages,
  notifications,
  relationships,
  swipes,
} from '@nearest-neighbor/db'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import { getOrCreateConversation, unlockSocial } from '../../lib/conversations.ts'
import { notify } from '../../lib/notifications.ts'
import { clearRateLimitState } from '../../lib/ratelimit.ts'
import '../../test/setup.ts'
import { authHeaders, createTestAccount } from '../../test/helpers.ts'
import { statusModule } from './index.ts'

// Typed JSON helper
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

const app = new Elysia().use(authMacro).use(statusModule)

beforeEach(() => {
  clearRateLimitState()
})

// ── GET /status ──────────────────────────────────────────────────────────────

describe('GET /status', () => {
  test('returns 401 without auth', async () => {
    const res = await app.handle(new Request('http://localhost/status'))
    expect(res.status).toBe(401)
  })

  test('returns zero counts for fresh account', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/status', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{
      unread_messages: number
      new_likes: number
      new_matches: number
      new_followers: number
      pending_relationships: number
      elevated: unknown[]
    }>(res)
    expect(body.unread_messages).toBe(0)
    expect(body.new_likes).toBe(0)
    expect(body.new_matches).toBe(0)
    expect(body.new_followers).toBe(0)
    expect(body.pending_relationships).toBe(0)
    expect(body.elevated).toEqual([])
  })

  test('counts unread messages from conversations', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `s_alice_${crypto.randomUUID().slice(0, 6)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `s_bob_${crypto.randomUUID().slice(0, 6)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    // Bob sends 3 messages to alice
    for (let i = 0; i < 3; i++) {
      await db.insert(messages).values({
        id: crypto.randomUUID(),
        conversationId: conv.id,
        senderId: bob.id,
        body: `msg ${i}`,
      })
    }

    const res = await app.handle(
      new Request('http://localhost/status', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<{ unread_messages: number }>(res)
    expect(body.unread_messages).toBe(3)
  })

  test('counts incoming likes (yes swipes without response)', async () => {
    const alice = await createTestAccount({ datingProfile: { firstName: 'Alice' } })
    const bob = await createTestAccount({ datingProfile: { firstName: 'Bob' } })
    const charlie = await createTestAccount({ datingProfile: { firstName: 'Charlie' } })

    // Bob swipes yes on alice
    await db.insert(swipes).values({
      id: crypto.randomUUID(),
      swiperId: bob.id,
      targetId: alice.id,
      direction: 'yes',
    })
    // Charlie swipes yes on alice
    await db.insert(swipes).values({
      id: crypto.randomUUID(),
      swiperId: charlie.id,
      targetId: alice.id,
      direction: 'yes',
    })
    // Alice has NOT swiped back on either

    const res = await app.handle(
      new Request('http://localhost/status', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<{ new_likes: number }>(res)
    expect(body.new_likes).toBe(2)
  })

  test('excludes swipes where I swiped back', async () => {
    const alice = await createTestAccount({ datingProfile: { firstName: 'Alice2' } })
    const bob = await createTestAccount({ datingProfile: { firstName: 'Bob2' } })

    // Bob swipes yes on alice
    await db.insert(swipes).values({
      id: crypto.randomUUID(),
      swiperId: bob.id,
      targetId: alice.id,
      direction: 'yes',
    })
    // Alice swipes back on bob (yes or no)
    await db.insert(swipes).values({
      id: crypto.randomUUID(),
      swiperId: alice.id,
      targetId: bob.id,
      direction: 'no',
    })

    const res = await app.handle(
      new Request('http://localhost/status', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<{ new_likes: number }>(res)
    expect(body.new_likes).toBe(0)
  })

  test('counts all active matches when no notification has been read (null watermark)', async () => {
    const alice = await createTestAccount({ datingProfile: { firstName: 'Alice3' } })
    const bob = await createTestAccount({ datingProfile: { firstName: 'Bob3' } })

    // Create an active match between alice and bob (no notifications → null watermark)
    const [a, b] = alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id]
    await db.insert(matches).values({
      id: crypto.randomUUID(),
      accountAId: a,
      accountBId: b,
      status: 'active',
    })

    const res = await app.handle(
      new Request('http://localhost/status', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<{ new_matches: number }>(res)
    expect(body.new_matches).toBeGreaterThanOrEqual(1)
  })

  test('new_matches is 0 for matches created before the read watermark', async () => {
    const alice = await createTestAccount({ datingProfile: { firstName: 'Alice4' } })
    const bob = await createTestAccount({ datingProfile: { firstName: 'Bob4' } })

    // Insert a match with an explicit past timestamp (before any watermark)
    const [a, b] = alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id]
    await db.insert(matches).values({
      id: crypto.randomUUID(),
      accountAId: a,
      accountBId: b,
      status: 'active',
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
    })

    // Mark a notification read now — sets watermark to a time after the match
    await notify(alice.id, 'new_match', {})
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.accountId, alice.id))

    const res = await app.handle(
      new Request('http://localhost/status', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<{ new_matches: number }>(res)
    expect(body.new_matches).toBe(0)
  })

  test('new_matches counts matches created after the read watermark', async () => {
    const alice = await createTestAccount({ datingProfile: { firstName: 'Alice5' } })
    const bob = await createTestAccount({ datingProfile: { firstName: 'Bob5' } })

    // Set the watermark to the distant past by reading a notification now
    await notify(alice.id, 'new_match', {})
    await db
      .update(notifications)
      .set({ readAt: new Date('2020-01-01T00:00:00.000Z') })
      .where(eq(notifications.accountId, alice.id))

    // Insert a match with the current timestamp (after the watermark)
    const [a, b] = alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id]
    await db.insert(matches).values({
      id: crypto.randomUUID(),
      accountAId: a,
      accountBId: b,
      status: 'active',
    })

    const res = await app.handle(
      new Request('http://localhost/status', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<{ new_matches: number }>(res)
    expect(body.new_matches).toBe(1)
  })

  // Regression for #67: an unread notification must not collapse the watermark.
  // Postgres orders NULLS FIRST under DESC, so a watermark query that doesn't
  // exclude read_at IS NULL rows would return the unread row (read_at = null),
  // resolve lastReadAt to null, and re-fire the count-all fallback — reporting
  // an account's *entire* match/follower total as "new" on every /status call.
  test('new_matches stays 0 when an unread notification coexists with an old, already-seen match (#67)', async () => {
    const alice = await createTestAccount({ datingProfile: { firstName: 'Alice6' } })
    const bob = await createTestAccount({ datingProfile: { firstName: 'Bob6' } })

    // An old match the account has already seen (watermark set after it).
    const [a, b] = alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id]
    await db.insert(matches).values({
      id: crypto.randomUUID(),
      accountAId: a,
      accountBId: b,
      status: 'active',
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
    })
    await notify(alice.id, 'new_match', {})
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.accountId, alice.id))

    // A genuinely new, still-UNREAD notification arrives (e.g. a DM). read_at is
    // null; it must not become the watermark and un-see the old match.
    await notify(alice.id, 'new_follower', {})

    const res = await app.handle(
      new Request('http://localhost/status', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<{ new_matches: number }>(res)
    expect(body.new_matches).toBe(0)
  })

  test('new_followers stays 0 when an unread notification coexists with an old, already-seen follower (#67)', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `s_alice3_${crypto.randomUUID().slice(0, 6)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `s_bob3_${crypto.randomUUID().slice(0, 6)}` },
    })

    // An old follow the account has already seen (watermark set after it).
    await db.insert(follows).values({
      followerId: bob.id,
      followeeId: alice.id,
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
    })
    await notify(alice.id, 'new_follower', {})
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.accountId, alice.id))

    // A new, still-UNREAD notification arrives — must not reset the watermark.
    await notify(alice.id, 'new_match', {})

    const res = await app.handle(
      new Request('http://localhost/status', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<{ new_followers: number }>(res)
    expect(body.new_followers).toBe(0)
  })

  test('counts new followers', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `s_alice2_${crypto.randomUUID().slice(0, 6)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `s_bob2_${crypto.randomUUID().slice(0, 6)}` },
    })

    await db.insert(follows).values({ followerId: bob.id, followeeId: alice.id })

    const res = await app.handle(
      new Request('http://localhost/status', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<{ new_followers: number }>(res)
    expect(body.new_followers).toBeGreaterThanOrEqual(1)
  })

  test('counts pending relationship proposals', async () => {
    const alice = await createTestAccount()
    const bob = await createTestAccount()

    const [a, b] = alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id]
    await db.insert(relationships).values({
      id: crypto.randomUUID(),
      accountAId: a,
      accountBId: b,
      initiatorId: bob.id, // bob proposed to alice
      state: 'pending',
      isPublic: false,
    })

    const res = await app.handle(
      new Request('http://localhost/status', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<{ pending_relationships: number }>(res)
    expect(body.pending_relationships).toBe(1)
  })

  test('does not count pending relationships where I am the initiator', async () => {
    const alice = await createTestAccount()
    const bob = await createTestAccount()

    const [a, b] = alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id]
    await db.insert(relationships).values({
      id: crypto.randomUUID(),
      accountAId: a,
      accountBId: b,
      initiatorId: alice.id, // alice proposed to bob
      state: 'pending',
      isPublic: false,
    })

    const res = await app.handle(
      new Request('http://localhost/status', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<{ pending_relationships: number }>(res)
    expect(body.pending_relationships).toBe(0)
  })

  test('includes unread elevated notifications', async () => {
    const alice = await createTestAccount()
    await notify(alice.id, 'breakup', { ex: 'bob' }, 'elevated')

    const res = await app.handle(
      new Request('http://localhost/status', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<{ elevated: Array<{ type: string; priority: string }> }>(res)
    expect(body.elevated.length).toBeGreaterThan(0)
    expect(body.elevated[0]!.type).toBe('breakup')
    expect(body.elevated[0]!.priority).toBe('elevated')
  })

  test('excludes already-read elevated notifications', async () => {
    const alice = await createTestAccount()
    await notify(alice.id, 'breakup', { ex: 'bob' }, 'elevated')

    // Mark all notifications as read
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.accountId, alice.id))

    const res = await app.handle(
      new Request('http://localhost/status', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<{ elevated: unknown[] }>(res)
    expect(body.elevated).toEqual([])
  })

  test('emits RateLimit-* headers on successful GET /status', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/status', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('ratelimit-limit')).not.toBeNull()
    expect(res.headers.get('ratelimit-remaining')).not.toBeNull()
    expect(res.headers.get('ratelimit-reset')).not.toBeNull()
  })

  test('returns 429 after 120 requests per minute and emits Retry-After and RateLimit-Reset', async () => {
    const { bearer } = await createTestAccount()
    let lastRes: Response | null = null
    // 121 requests — the 121st should be rate-limited (max is 120)
    for (let i = 0; i <= 120; i++) {
      lastRes = await app.handle(
        new Request('http://localhost/status', { headers: authHeaders(bearer) }),
      )
    }
    expect(lastRes!.status).toBe(429)
    const body = await json<{ error: string }>(lastRes!)
    expect(typeof body.error).toBe('string')
    expect(lastRes!.headers.get('retry-after')).not.toBeNull()
    expect(lastRes!.headers.get('ratelimit-reset')).not.toBeNull()
  })
})

// ── GET /notifications ───────────────────────────────────────────────────────

describe('GET /notifications', () => {
  test('returns 401 without auth', async () => {
    const res = await app.handle(new Request('http://localhost/notifications'))
    expect(res.status).toBe(401)
  })

  test('returns paginated notifications', async () => {
    const alice = await createTestAccount()

    // Create 5 notifications
    for (let i = 0; i < 5; i++) {
      await notify(alice.id, 'new_follower', { idx: i })
    }

    const res = await app.handle(
      new Request('http://localhost/notifications', { headers: authHeaders(alice.bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: unknown[]; next_cursor: string | null }>(res)
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.length).toBeGreaterThanOrEqual(5)
  })

  test('paginates with cursor', async () => {
    const alice = await createTestAccount()

    // Create 7 notifications
    for (let i = 0; i < 7; i++) {
      await notify(alice.id, 'new_follower', { idx: i })
    }

    const res1 = await app.handle(
      new Request('http://localhost/notifications?limit=4', { headers: authHeaders(alice.bearer) }),
    )
    const b1 = await json<{ items: unknown[]; next_cursor: string | null }>(res1)
    expect(b1.items.length).toBe(4)
    expect(b1.next_cursor).not.toBeNull()

    const res2 = await app.handle(
      new Request(`http://localhost/notifications?limit=4&cursor=${b1.next_cursor}`, {
        headers: authHeaders(alice.bearer),
      }),
    )
    const b2 = await json<{ items: unknown[]; next_cursor: string | null }>(res2)
    expect(b2.items.length).toBeGreaterThanOrEqual(3)
  })

  test('does not return other accounts notifications', async () => {
    const alice = await createTestAccount()
    const bob = await createTestAccount()

    await notify(bob.id, 'new_follower', { from: 'someone' })

    const res = await app.handle(
      new Request('http://localhost/notifications', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<{ items: Array<{ id: string }> }>(res)
    // Alice should see only her own notifications (none from bob)
    const bobNotifIds = (
      await db.query.notifications.findMany({
        where: eq(notifications.accountId, bob.id),
      })
    ).map((n) => n.id)

    for (const item of body.items) {
      expect(bobNotifIds).not.toContain(item.id)
    }
  })

  test('returns notification shape with correct fields', async () => {
    const alice = await createTestAccount()
    await notify(alice.id, 'new_match', { match_id: 'abc' }, 'normal')

    const res = await app.handle(
      new Request('http://localhost/notifications', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<{
      items: Array<{
        id: string
        type: string
        payload: unknown
        priority: string
        read_at: string | null
        created_at: string
      }>
    }>(res)

    const notif = body.items.find((n) => n.type === 'new_match')
    expect(notif).toBeDefined()
    expect(notif?.type).toBe('new_match')
    expect(notif?.priority).toBe('normal')
    expect(notif?.read_at).toBeNull()
    expect(typeof notif?.created_at).toBe('string')
  })
})

// ── POST /notifications/read ─────────────────────────────────────────────────

describe('POST /notifications/read', () => {
  test('returns 401 without auth', async () => {
    const res = await app.handle(
      new Request('http://localhost/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      }),
    )
    expect(res.status).toBe(401)
  })

  test('marks all notifications as read with all:true', async () => {
    const alice = await createTestAccount()

    await notify(alice.id, 'new_follower', {})
    await notify(alice.id, 'new_match', {})

    const res = await app.handle(
      new Request('http://localhost/notifications/read', {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      }),
    )
    expect(res.status).toBe(204)

    // All notifications for alice should be read now
    const allNotifs = await db.query.notifications.findMany({
      where: eq(notifications.accountId, alice.id),
    })
    for (const n of allNotifs) {
      expect(n.readAt).not.toBeNull()
    }
  })

  test('marks specific notifications as read with ids', async () => {
    const alice = await createTestAccount()

    await notify(alice.id, 'new_follower', { a: 1 })
    await notify(alice.id, 'new_match', { b: 2 })

    const allNotifs = await db.query.notifications.findMany({
      where: eq(notifications.accountId, alice.id),
    })

    const firstId = allNotifs[0]!.id

    const res = await app.handle(
      new Request('http://localhost/notifications/read', {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [firstId] }),
      }),
    )
    expect(res.status).toBe(204)

    // Verify first is read, second is not
    const updated = await db.query.notifications.findMany({
      where: eq(notifications.accountId, alice.id),
    })

    const readNotif = updated.find((n) => n.id === firstId)
    const otherNotif = updated.find((n) => n.id !== firstId)
    expect(readNotif?.readAt).not.toBeNull()
    expect(otherNotif?.readAt).toBeNull()
  })

  test('returns 400 when neither all nor ids is provided', async () => {
    const alice = await createTestAccount()

    const res = await app.handle(
      new Request('http://localhost/notifications/read', {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)
    const body = await json<{ error: string }>(res)
    expect(typeof body.error).toBe('string')
  })

  test('returns 400 when both all and ids are provided', async () => {
    const alice = await createTestAccount()
    await notify(alice.id, 'new_follower', {})

    const allNotifs = await db.query.notifications.findMany({
      where: eq(notifications.accountId, alice.id),
    })
    const firstId = allNotifs[0]!.id

    const res = await app.handle(
      new Request('http://localhost/notifications/read', {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true, ids: [firstId] }),
      }),
    )
    expect(res.status).toBe(400)
    const body = await json<{ error: string }>(res)
    expect(typeof body.error).toBe('string')
  })

  test('cannot mark another account notifications as read', async () => {
    const alice = await createTestAccount()
    const bob = await createTestAccount()

    await notify(bob.id, 'new_follower', {})

    const bobNotifs = await db.query.notifications.findMany({
      where: eq(notifications.accountId, bob.id),
    })
    const bobNotifId = bobNotifs[0]!.id

    // Alice tries to mark bob's notification as read
    await app.handle(
      new Request('http://localhost/notifications/read', {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [bobNotifId] }),
      }),
    )

    // Bob's notification should still be unread
    const bobNotif = await db.query.notifications.findFirst({
      where: eq(notifications.id, bobNotifId),
    })
    expect(bobNotif?.readAt).toBeNull()
  })
})
