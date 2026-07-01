// Reports module — a single, idempotent report-submission endpoint for posts,
// messages, and accounts. Append-only: the reports row is the durable record,
// there is no operator queue, dashboard, or notification.
// Prefix: /reports (mounted under the v1 `/v1` prefix → external path `/v1/reports`)

import { accounts, conversations, db, messages, posts, reports } from '@nearest-neighbor/db'
import type { Report } from '@nearest-neighbor/db'
import { and, eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import { applyRateLimit } from '../../lib/ratelimit.ts'

// ─── Constants ────────────────────────────────────────────────────────────────

const REPORTS_WINDOW_MS = 60_000
const REPORTS_MAX = 30

const MAX_NOTE = 1000

// Manual uuid validation — TypeBox `format: 'uuid'` would surface a malformed
// subject_id as a 422 (schema-validation failure); the spec requires 400.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DEFAULT_REASON = 'off_platform_solicitation'

// Explicit tuple (not `REASONS.map(...)`) so TypeBox can infer the static union;
// a mapped array widens the inferred type to `never`.
const ReasonSchema = t.Union([
  t.Literal('off_platform_solicitation'),
  t.Literal('spam'),
  t.Literal('harassment'),
  t.Literal('other'),
])

const SubjectTypeSchema = t.Union([t.Literal('post'), t.Literal('message'), t.Literal('account')])

// ─── Response shapes ────────────────────────────────────────────────────────

const ReportShape = t.Object({
  id: t.String(),
  subject_type: SubjectTypeSchema,
  subject_id: t.String(),
  reason: ReasonSchema,
  note: t.Nullable(t.String()),
  created_at: t.String(),
})

const ErrorShape = t.Object({ error: t.String() })

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toReportShape(r: Report) {
  return {
    id: r.id,
    subject_type: r.subjectType,
    subject_id: r.subjectId,
    reason: r.reason,
    note: r.note,
    created_at: r.createdAt.toISOString(),
  }
}

// ─── Module ───────────────────────────────────────────────────────────────────

export const reportsModule = new Elysia({ prefix: '/reports', name: 'reports-module' })
  .use(authMacro)

  // ── POST /reports — submit a report on a post, message, or account ─────────
  .post(
    '/',
    async ({ account, body, set, status }) => {
      if (applyRateLimit(set, `${account.id}:reports`, REPORTS_MAX, REPORTS_WINDOW_MS)) {
        return status(429, { error: 'Too many requests' })
      }

      const { subject_type, subject_id, note } = body
      const reason = body.reason ?? DEFAULT_REASON

      if (!UUID_RE.test(subject_id)) {
        return status(400, { error: 'invalid subject_id' })
      }

      if (subject_type === 'post') {
        const post = await db.query.posts.findFirst({
          where: eq(posts.id, subject_id),
        })
        if (!post || post.deletedAt != null) {
          return status(404, { error: 'Post not found' })
        }
        if (post.authorId === account.id) {
          return status(422, { error: 'Cannot report your own post' })
        }
      } else if (subject_type === 'message') {
        const message = await db.query.messages.findFirst({
          where: eq(messages.id, subject_id),
        })
        if (!message) {
          return status(404, { error: 'Message not found' })
        }
        const conversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, message.conversationId),
        })
        // Not a participant (or the conversation is somehow missing) → 404. Never
        // reveals existence of a message the reporter cannot see.
        if (
          !conversation ||
          (conversation.accountAId !== account.id && conversation.accountBId !== account.id)
        ) {
          return status(404, { error: 'Message not found' })
        }
        if (message.senderId === account.id) {
          return status(422, { error: 'Cannot report your own message' })
        }
      } else {
        const subjectAccount = await db.query.accounts.findFirst({
          where: eq(accounts.id, subject_id),
        })
        if (!subjectAccount) {
          return status(404, { error: 'Account not found' })
        }
        if (subject_id === account.id) {
          return status(422, { error: 'Cannot report your own account' })
        }
      }

      const inserted = await db
        .insert(reports)
        .values({
          reporterId: account.id,
          subjectType: subject_type,
          subjectId: subject_id,
          reason,
          note: note ?? null,
        })
        .onConflictDoNothing()
        .returning()

      if (inserted[0]) {
        return status(201, toReportShape(inserted[0]))
      }

      // Conflict on the (reporter_id, subject_type, subject_id) unique constraint
      // → idempotent 200 with the existing report.
      const existing = await db.query.reports.findFirst({
        where: and(
          eq(reports.reporterId, account.id),
          eq(reports.subjectType, subject_type),
          eq(reports.subjectId, subject_id),
        ),
      })

      return status(200, toReportShape(existing!))
    },
    {
      auth: true,
      body: t.Object({
        subject_type: SubjectTypeSchema,
        subject_id: t.String(),
        reason: t.Optional(ReasonSchema),
        note: t.Optional(t.String({ maxLength: MAX_NOTE })),
      }),
      response: {
        200: ReportShape,
        201: ReportShape,
        400: ErrorShape,
        401: ErrorShape,
        404: ErrorShape,
        422: ErrorShape,
        429: ErrorShape,
      },
    },
  )
