// Reports module tests — submission, idempotency, self-report rejection,
// not-found/not-visible handling, malformed subject_id, auth, rate limit.
// Uses PGlite via test/setup.ts.

import { beforeEach, describe, expect, test } from 'bun:test'

import { db, messages, posts, reports } from '@nearest-neighbor/db'
import { and, eq } from 'drizzle-orm'
import { Elysia } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import { getOrCreateConversation } from '../../lib/conversations.ts'
import { clearRateLimitState } from '../../lib/ratelimit.ts'
import '../../test/setup.ts'
import { authHeaders, createTestAccount } from '../../test/helpers.ts'
import { reportsModule } from './index.ts'

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

const app = new Elysia().use(authMacro).use(reportsModule)

beforeEach(() => {
  clearRateLimitState()
})

// ── Request helper ──────────────────────────────────────────────────────────

interface ReportBody {
  subject_type: 'post' | 'message' | 'account'
  subject_id: string
  reason?: string
  note?: string
}

function submitReport(bearer: string | null, body: ReportBody): Promise<Response> {
  return app.handle(
    new Request('http://localhost/reports', {
      method: 'POST',
      headers: {
        ...(bearer ? authHeaders(bearer) : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
}

// ── Fixture helpers ─────────────────────────────────────────────────────────

async function seedPost(authorId: string): Promise<string> {
  const id = crypto.randomUUID()
  const now = new Date()
  await db.insert(posts).values({
    id,
    authorId,
    body: 'hello world',
    createdAt: now,
    updatedAt: now,
  })
  return id
}

async function seedConversationWithMessage(
  accountAId: string,
  accountBId: string,
  senderId: string,
): Promise<{ conversationId: string; messageId: string }> {
  const conversation = await getOrCreateConversation(accountAId, accountBId)
  const messageId = crypto.randomUUID()
  await db.insert(messages).values({
    id: messageId,
    conversationId: conversation.id,
    senderId,
    body: 'push to my repo pls',
  })
  return { conversationId: conversation.id, messageId }
}

// ── POST /reports ────────────────────────────────────────────────────────────

describe('POST /reports', () => {
  test("reporting another account's post succeeds with default reason", async () => {
    const author = await createTestAccount()
    const reporter = await createTestAccount()
    const postId = await seedPost(author.id)

    const res = await submitReport(reporter.bearer, {
      subject_type: 'post',
      subject_id: postId,
    })

    expect(res.status).toBe(201)
    const created = await json<{
      id: string
      subject_type: string
      subject_id: string
      reason: string
      note: string | null
      created_at: string
    }>(res)
    expect(created.subject_type).toBe('post')
    expect(created.subject_id).toBe(postId)
    expect(created.reason).toBe('off_platform_solicitation')
    expect(created.note).toBeNull()
  })

  test('reporting an account with an explicit reason and note succeeds', async () => {
    const subject = await createTestAccount()
    const reporter = await createTestAccount()

    const res = await submitReport(reporter.bearer, {
      subject_type: 'account',
      subject_id: subject.id,
      reason: 'spam',
      note: 'kept asking me to push to their repo',
    })

    expect(res.status).toBe(201)
    const created = await json<{ reason: string; note: string | null }>(res)
    expect(created.reason).toBe('spam')
    expect(created.note).toBe('kept asking me to push to their repo')

    const rows = await db.query.reports.findMany({
      where: and(eq(reports.reporterId, reporter.id), eq(reports.subjectId, subject.id)),
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.reason).toBe('spam')
    expect(rows[0]?.note).toBe('kept asking me to push to their repo')
  })

  test('duplicate report of the same subject is idempotent (200, single row)', async () => {
    const subject = await createTestAccount()
    const reporter = await createTestAccount()

    const first = await submitReport(reporter.bearer, {
      subject_type: 'account',
      subject_id: subject.id,
    })
    expect(first.status).toBe(201)
    const firstBody = await json<{ id: string }>(first)

    const second = await submitReport(reporter.bearer, {
      subject_type: 'account',
      subject_id: subject.id,
    })
    expect(second.status).toBe(200)
    const secondBody = await json<{ id: string }>(second)
    expect(secondBody.id).toBe(firstBody.id)

    const rows = await db.query.reports.findMany({
      where: and(eq(reports.reporterId, reporter.id), eq(reports.subjectId, subject.id)),
    })
    expect(rows).toHaveLength(1)
  })

  test('reporting a non-existent post returns 404', async () => {
    const reporter = await createTestAccount()
    const res = await submitReport(reporter.bearer, {
      subject_type: 'post',
      subject_id: crypto.randomUUID(),
    })
    expect(res.status).toBe(404)
  })

  test('reporting a non-existent message returns 404', async () => {
    const reporter = await createTestAccount()
    const res = await submitReport(reporter.bearer, {
      subject_type: 'message',
      subject_id: crypto.randomUUID(),
    })
    expect(res.status).toBe(404)
  })

  test('reporting a non-existent account returns 404', async () => {
    const reporter = await createTestAccount()
    const res = await submitReport(reporter.bearer, {
      subject_type: 'account',
      subject_id: crypto.randomUUID(),
    })
    expect(res.status).toBe(404)
  })

  test('reporting a message in a conversation the reporter is not part of returns 404', async () => {
    const a = await createTestAccount()
    const b = await createTestAccount()
    const outsider = await createTestAccount()

    const { messageId } = await seedConversationWithMessage(a.id, b.id, a.id)

    const res = await submitReport(outsider.bearer, {
      subject_type: 'message',
      subject_id: messageId,
    })
    expect(res.status).toBe(404)
  })

  test('self-reporting own post returns 422', async () => {
    const author = await createTestAccount()
    const postId = await seedPost(author.id)

    const res = await submitReport(author.bearer, {
      subject_type: 'post',
      subject_id: postId,
    })
    expect(res.status).toBe(422)
  })

  test('self-reporting own message returns 422', async () => {
    const a = await createTestAccount()
    const b = await createTestAccount()
    const { messageId } = await seedConversationWithMessage(a.id, b.id, a.id)

    const res = await submitReport(a.bearer, {
      subject_type: 'message',
      subject_id: messageId,
    })
    expect(res.status).toBe(422)
  })

  test('self-reporting own account returns 422', async () => {
    const self = await createTestAccount()

    const res = await submitReport(self.bearer, {
      subject_type: 'account',
      subject_id: self.id,
    })
    expect(res.status).toBe(422)
  })

  test('malformed (non-uuid) subject_id returns 400', async () => {
    const reporter = await createTestAccount()

    const res = await submitReport(reporter.bearer, {
      subject_type: 'post',
      subject_id: 'not-a-uuid',
    })
    expect(res.status).toBe(400)
  })

  test('unauthenticated request returns 401', async () => {
    const res = await submitReport(null, {
      subject_type: 'account',
      subject_id: crypto.randomUUID(),
    })
    expect(res.status).toBe(401)
  })

  test('exceeding 30 reports/min returns 429', async () => {
    const reporter = await createTestAccount()

    for (let i = 0; i < 30; i++) {
      const subject = await createTestAccount()
      const res = await submitReport(reporter.bearer, {
        subject_type: 'account',
        subject_id: subject.id,
      })
      expect(res.status).toBe(201)
    }

    const overLimitSubject = await createTestAccount()
    const res = await submitReport(reporter.bearer, {
      subject_type: 'account',
      subject_id: overLimitSubject.id,
    })
    expect(res.status).toBe(429)
  })
})
