import { sql } from 'drizzle-orm'
import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { accounts } from './accounts.ts'

// Append-only audit table: one row per moderation decision (allow/block/unavailable).
// The table has no content column by design, so it can never host offending text or
// ASCII art — the sexual/minors carve-out additionally leaves scores/categories null.
export const moderationDecisionEnum = pgEnum('moderation_decision', [
  'allow',
  'block',
  'unavailable',
])

export const moderationVerdicts = pgTable(
  'moderation_verdicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    surface: text('surface').notNull(),
    // Nullable for forward compatibility; effectively always null in this change
    // because the macro always runs pre-insert (no subject row exists yet).
    subjectId: uuid('subject_id'),
    model: text('model'),
    flagged: boolean('flagged'),
    decision: moderationDecisionEnum('decision').notNull(),
    topCategory: text('top_category'),
    scores: jsonb('scores'),
    categories: jsonb('categories'),
    appliedInputTypes: jsonb('applied_input_types'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('idx_moderation_verdicts_account_id').on(t.accountId),
    index('idx_moderation_verdicts_decision').on(t.decision),
  ],
)

export type ModerationVerdict = typeof moderationVerdicts.$inferSelect
export type NewModerationVerdict = typeof moderationVerdicts.$inferInsert
