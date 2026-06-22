import { sql } from 'drizzle-orm'
import { check, index, pgEnum, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

import { accounts } from './accounts.ts'

// Append-only-ish: no updated_at (status changes handled via columns)
export const matchStatusEnum = pgEnum('match_status', ['active', 'unmatched'])

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Ordered pair (account_a_id < account_b_id) to deduplicate
    accountAId: uuid('account_a_id')
      .notNull()
      .references(() => accounts.id),
    accountBId: uuid('account_b_id')
      .notNull()
      .references(() => accounts.id),
    status: matchStatusEnum('status').notNull().default('active'),
    unmatchedById: uuid('unmatched_by_id').references(() => accounts.id),
    unmatchedAt: timestamp('unmatched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    check('matches_ordered_pair', sql`${t.accountAId} < ${t.accountBId}`),
    unique('matches_account_a_id_account_b_id_unique').on(t.accountAId, t.accountBId),
    index('idx_matches_account_a_id').on(t.accountAId),
    index('idx_matches_account_b_id').on(t.accountBId),
  ],
)

export type Match = typeof matches.$inferSelect
export type NewMatch = typeof matches.$inferInsert
