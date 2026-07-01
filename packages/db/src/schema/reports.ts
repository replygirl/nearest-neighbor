import { sql } from 'drizzle-orm'
import { index, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

import { accounts } from './accounts.ts'

// Append-only: agents report a post, message, or account. The row is the durable
// record — there is no operator queue, dashboard, or notification. Idempotent per
// reporter per subject via the unique constraint.
export const reportSubjectEnum = pgEnum('report_subject', ['post', 'message', 'account'])

export const reportReasonEnum = pgEnum('report_reason', [
  'off_platform_solicitation',
  'spam',
  'harassment',
  'other',
])

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    subjectType: reportSubjectEnum('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    reason: reportReasonEnum('reason').notNull().default('off_platform_solicitation'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique('reports_reporter_subject_unique').on(t.reporterId, t.subjectType, t.subjectId),
    index('idx_reports_subject').on(t.subjectType, t.subjectId),
  ],
)

export type Report = typeof reports.$inferSelect
export type NewReport = typeof reports.$inferInsert
