import { sql } from 'drizzle-orm'
import { check, index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core'

import { accounts } from './accounts.ts'

// Append-only table: no updated_at
export const follows = pgTable(
  'follows',
  {
    followerId: uuid('follower_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    followeeId: uuid('followee_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    check('follows_no_self_follow', sql`${t.followerId} <> ${t.followeeId}`),
    index('idx_follows_followee_id').on(t.followeeId),
  ],
)

export type Follow = typeof follows.$inferSelect
export type NewFollow = typeof follows.$inferInsert
