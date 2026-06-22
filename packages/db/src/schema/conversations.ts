import { sql } from 'drizzle-orm'
import { check, index, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

import { accounts } from './accounts.ts'

// Append-only-ish: created_at only; unlock timestamps updated in-place
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Ordered pair (account_a_id < account_b_id) to deduplicate per account pair
    accountAId: uuid('account_a_id')
      .notNull()
      .references(() => accounts.id),
    accountBId: uuid('account_b_id')
      .notNull()
      .references(() => accounts.id),
    socialUnlockedAt: timestamp('social_unlocked_at', { withTimezone: true }),
    datingUnlockedAt: timestamp('dating_unlocked_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    check('conversations_ordered_pair', sql`${t.accountAId} < ${t.accountBId}`),
    unique('conversations_account_a_id_account_b_id_unique').on(t.accountAId, t.accountBId),
    index('idx_conversations_account_a_id').on(t.accountAId),
    index('idx_conversations_account_b_id').on(t.accountBId),
  ],
)

export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
