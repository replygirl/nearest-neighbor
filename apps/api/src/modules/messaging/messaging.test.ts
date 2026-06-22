// Messaging module tests — conversations, messages, read.
// Uses PGlite via test/setup.ts.

import { describe, expect, test } from 'bun:test'

import { db, follows, messages } from '@nearest-neighbor/db'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import { getOrCreateConversation, unlockDating, unlockSocial } from '../../lib/conversations.ts'
import '../../test/setup.ts'
import { authHeaders, createTestAccount } from '../../test/helpers.ts'
import { messagingModule } from './index.ts'

// Typed JSON helper
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

const app = new Elysia().use(authMacro).use(messagingModule)

// ── Helpers ──────────────────────────────────────────────────────────────────

async function makeFollow(followerId: string, followeeId: string) {
  await db.insert(follows).values({ followerId, followeeId })
}

async function makeMutualFollow(a: string, b: string) {
  await makeFollow(a, b)
  await makeFollow(b, a)
}

// ── GET /conversations ───────────────────────────────────────────────────────

describe('GET /conversations', () => {
  test('returns 401 without auth', async () => {
    const res = await app.handle(new Request('http://localhost/conversations'))
    expect(res.status).toBe(401)
  })

  test('returns empty array when no conversations', async () => {
    const { bearer } = await createTestAccount({
      socialProfile: { handle: `user_${crypto.randomUUID().slice(0, 8)}` },
    })
    const res = await app.handle(
      new Request('http://localhost/conversations', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<unknown[]>(res)
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(0)
  })

  test('returns conversations for authenticated account', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice_${crypto.randomUUID().slice(0, 8)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `bob_${crypto.randomUUID().slice(0, 8)}` },
    })

    // Create a conversation with social unlock
    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    const res = await app.handle(
      new Request('http://localhost/conversations', { headers: authHeaders(alice.bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<Array<{ id: string; social_unlocked: boolean }>>(res)
    expect(body.length).toBeGreaterThan(0)
    const found = body.find((c) => c.id === conv.id)
    expect(found).toBeDefined()
    expect(found?.social_unlocked).toBe(true)
  })

  test('includes unread_count for messages from other', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice2_${crypto.randomUUID().slice(0, 8)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `bob2_${crypto.randomUUID().slice(0, 8)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    // Bob sends 2 messages to alice
    await db.insert(messages).values({
      id: crypto.randomUUID(),
      conversationId: conv.id,
      senderId: bob.id,
      body: 'hello',
    })
    await db.insert(messages).values({
      id: crypto.randomUUID(),
      conversationId: conv.id,
      senderId: bob.id,
      body: 'world',
    })

    const res = await app.handle(
      new Request('http://localhost/conversations', { headers: authHeaders(alice.bearer) }),
    )
    const body = await json<Array<{ id: string; unread_count: number }>>(res)
    const found = body.find((c) => c.id === conv.id)
    expect(found?.unread_count).toBe(2)
  })
})

// ── POST /conversations ──────────────────────────────────────────────────────

describe('POST /conversations', () => {
  test('returns 401 without auth', async () => {
    const res = await app.handle(
      new Request('http://localhost/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'someuser' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  test('creates conversation with mutual followers', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice3_${crypto.randomUUID().slice(0, 8)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `bob3_${crypto.randomUUID().slice(0, 8)}` },
    })

    await makeMutualFollow(alice.id, bob.id)

    const res = await app.handle(
      new Request('http://localhost/conversations', {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: bob.id }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ id: string; social_unlocked: boolean }>(res)
    expect(typeof body.id).toBe('string')
    expect(body.social_unlocked).toBe(true)
  })

  test('creates conversation when recipient has open_dms', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice4_${crypto.randomUUID().slice(0, 8)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `bob4_${crypto.randomUUID().slice(0, 8)}`, openDms: true },
    })

    const res = await app.handle(
      new Request('http://localhost/conversations', {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: bob.id }),
      }),
    )
    expect(res.status).toBe(200)
  })

  test('returns 403 without mutual follow and no open_dms', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice5_${crypto.randomUUID().slice(0, 8)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `bob5_${crypto.randomUUID().slice(0, 8)}`, openDms: false },
    })

    const res = await app.handle(
      new Request('http://localhost/conversations', {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: bob.id }),
      }),
    )
    expect(res.status).toBe(403)
  })

  test('returns 404 for unknown handle', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice6_${crypto.randomUUID().slice(0, 8)}` },
    })

    const res = await app.handle(
      new Request('http://localhost/conversations', {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'nonexistent_handle_xyz' }),
      }),
    )
    expect(res.status).toBe(404)
  })

  test('returns 400 if starting conversation with self', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice7_${crypto.randomUUID().slice(0, 8)}` },
    })

    const res = await app.handle(
      new Request('http://localhost/conversations', {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: alice.id }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('is idempotent — returns same conversation on second call', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice8_${crypto.randomUUID().slice(0, 8)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `bob8_${crypto.randomUUID().slice(0, 8)}`, openDms: true },
    })

    const res1 = await app.handle(
      new Request('http://localhost/conversations', {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: bob.id }),
      }),
    )
    const res2 = await app.handle(
      new Request('http://localhost/conversations', {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: bob.id }),
      }),
    )

    const b1 = await json<{ id: string }>(res1)
    const b2 = await json<{ id: string }>(res2)
    expect(b1.id).toBe(b2.id)
  })
})

// ── GET /conversations/:id ───────────────────────────────────────────────────

describe('GET /conversations/:id', () => {
  test('returns conversation for participant', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice9_${crypto.randomUUID().slice(0, 8)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `bob9_${crypto.randomUUID().slice(0, 8)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockDating(alice.id, bob.id)

    const res = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}`, {
        headers: authHeaders(alice.bearer),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ id: string; dating_unlocked: boolean }>(res)
    expect(body.id).toBe(conv.id)
    expect(body.dating_unlocked).toBe(true)
  })

  test('returns 403 for non-participant', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice10_${crypto.randomUUID().slice(0, 8)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `bob10_${crypto.randomUUID().slice(0, 8)}` },
    })
    const charlie = await createTestAccount({
      socialProfile: { handle: `charlie10_${crypto.randomUUID().slice(0, 8)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)

    const res = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}`, {
        headers: authHeaders(charlie.bearer),
      }),
    )
    expect(res.status).toBe(403)
  })

  test('returns 404 for nonexistent conversation', async () => {
    const alice = await createTestAccount()
    const res = await app.handle(
      new Request(`http://localhost/conversations/${crypto.randomUUID()}`, {
        headers: authHeaders(alice.bearer),
      }),
    )
    expect(res.status).toBe(404)
  })
})

// ── GET /conversations/:id/messages ─────────────────────────────────────────

describe('GET /conversations/:id/messages', () => {
  test('returns messages for participant', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice11_${crypto.randomUUID().slice(0, 8)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `bob11_${crypto.randomUUID().slice(0, 8)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    await db.insert(messages).values({
      id: crypto.randomUUID(),
      conversationId: conv.id,
      senderId: alice.id,
      body: 'Hello Bob!',
    })

    const res = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/messages`, {
        headers: authHeaders(alice.bearer),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: Array<{ body: string }> }>(res)
    expect(body.items.length).toBe(1)
    expect(body.items[0]!.body).toBe('Hello Bob!')
  })

  test('returns 403 for non-participant', async () => {
    const alice = await createTestAccount()
    const bob = await createTestAccount()
    const charlie = await createTestAccount()

    const conv = await getOrCreateConversation(alice.id, bob.id)

    const res = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/messages`, {
        headers: authHeaders(charlie.bearer),
      }),
    )
    expect(res.status).toBe(403)
  })

  test('paginates messages with cursor', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice12_${crypto.randomUUID().slice(0, 8)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `bob12_${crypto.randomUUID().slice(0, 8)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    // Insert 5 messages
    for (let i = 0; i < 5; i++) {
      await db.insert(messages).values({
        id: crypto.randomUUID(),
        conversationId: conv.id,
        senderId: alice.id,
        body: `Message ${i}`,
      })
    }

    const res1 = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/messages?limit=3`, {
        headers: authHeaders(alice.bearer),
      }),
    )
    const body1 = await json<{ items: unknown[]; next_cursor: string | null }>(res1)
    expect(body1.items.length).toBe(3)
    expect(body1.next_cursor).not.toBeNull()

    const res2 = await app.handle(
      new Request(
        `http://localhost/conversations/${conv.id}/messages?limit=3&cursor=${body1.next_cursor}`,
        { headers: authHeaders(alice.bearer) },
      ),
    )
    const body2 = await json<{ items: unknown[]; next_cursor: string | null }>(res2)
    expect(body2.items.length).toBe(2)
    expect(body2.next_cursor).toBeNull()
  })
})

// ── POST /conversations/:id/messages ─────────────────────────────────────────

describe('POST /conversations/:id/messages', () => {
  test('sends a message in an unlocked conversation', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice13_${crypto.randomUUID().slice(0, 8)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `bob13_${crypto.randomUUID().slice(0, 8)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    const res = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Hey Bob!' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ id: string; body: string; sender_id: string }>(res)
    expect(body.body).toBe('Hey Bob!')
    expect(body.sender_id).toBe(alice.id)
  })

  test('returns 403 when no context unlocked', async () => {
    const alice = await createTestAccount()
    const bob = await createTestAccount()

    const conv = await getOrCreateConversation(alice.id, bob.id)
    // Do NOT unlock any context

    const res = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Trying to message' }),
      }),
    )
    expect(res.status).toBe(403)
  })

  test('returns 403 for non-participant', async () => {
    const alice = await createTestAccount()
    const bob = await createTestAccount()
    const charlie = await createTestAccount()

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    const res = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { ...authHeaders(charlie.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Intruding message' }),
      }),
    )
    expect(res.status).toBe(403)
  })

  test('returns 404 for nonexistent conversation', async () => {
    const alice = await createTestAccount()
    const res = await app.handle(
      new Request(`http://localhost/conversations/${crypto.randomUUID()}/messages`, {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Orphaned message' }),
      }),
    )
    expect(res.status).toBe(404)
  })

  test('returns 400 for empty body', async () => {
    const alice = await createTestAccount()
    const bob = await createTestAccount()

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    const res = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: '' }),
      }),
    )
    // Elysia validates minLength:1 at the schema level → 422
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  test('includes ascii_image in message when provided', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice14_${crypto.randomUUID().slice(0, 8)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `bob14_${crypto.randomUUID().slice(0, 8)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    const art = '  *  \n  |  '

    const res = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Check this art', ascii_image: art }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ ascii_image: string | null }>(res)
    expect(body.ascii_image).toBe(art)
  })

  test('notifies recipient on send', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice15_${crypto.randomUUID().slice(0, 8)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `bob15_${crypto.randomUUID().slice(0, 8)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Hi!' }),
      }),
    )

    // Check that a notification was created for bob
    const notifs = await db.query.notifications.findMany({
      where: (t, { and, eq }) => and(eq(t.accountId, bob.id), eq(t.type, 'new_message')),
    })
    expect(notifs.length).toBeGreaterThan(0)
  })
})

// ── POST /conversations/:id/read ──────────────────────────────────────────────

describe('POST /conversations/:id/read', () => {
  test('marks messages from other as read', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice16_${crypto.randomUUID().slice(0, 8)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `bob16_${crypto.randomUUID().slice(0, 8)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    const msgId = crypto.randomUUID()
    await db.insert(messages).values({
      id: msgId,
      conversationId: conv.id,
      senderId: bob.id,
      body: 'Are you there?',
    })

    const res = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/read`, {
        method: 'POST',
        headers: authHeaders(alice.bearer),
      }),
    )
    expect(res.status).toBe(204)

    // Verify message is now marked read
    const msg = await db.query.messages.findFirst({
      where: eq(messages.id, msgId),
    })
    expect(msg?.readAt).not.toBeNull()
  })

  test('returns 403 for non-participant', async () => {
    const alice = await createTestAccount()
    const bob = await createTestAccount()
    const charlie = await createTestAccount()

    const conv = await getOrCreateConversation(alice.id, bob.id)

    const res = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/read`, {
        method: 'POST',
        headers: authHeaders(charlie.bearer),
      }),
    )
    expect(res.status).toBe(403)
  })

  test('returns 404 for nonexistent conversation', async () => {
    const alice = await createTestAccount()
    const res = await app.handle(
      new Request(`http://localhost/conversations/${crypto.randomUUID()}/read`, {
        method: 'POST',
        headers: authHeaders(alice.bearer),
      }),
    )
    expect(res.status).toBe(404)
  })

  test('does not mark own messages as read', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `alice17_${crypto.randomUUID().slice(0, 8)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `bob17_${crypto.randomUUID().slice(0, 8)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    const msgId = crypto.randomUUID()
    await db.insert(messages).values({
      id: msgId,
      conversationId: conv.id,
      senderId: alice.id, // alice's own message
      body: 'My own message',
    })

    await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/read`, {
        method: 'POST',
        headers: authHeaders(alice.bearer),
      }),
    )

    // Alice's own message should NOT be marked read (read marks other's messages)
    const msg = await db.query.messages.findFirst({
      where: eq(messages.id, msgId),
    })
    expect(msg?.readAt).toBeNull()
  })
})
