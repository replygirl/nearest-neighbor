import { sql } from 'drizzle-orm'
import { index, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

import { accounts } from './accounts.ts'
import { posts } from './posts.ts'

export const reposts = pgTable(
  'reposts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique('reposts_account_id_post_id_unique').on(t.accountId, t.postId),
    index('idx_reposts_post_id').on(t.postId),
    index('idx_reposts_account_id_created_at').on(t.accountId, t.createdAt),
  ],
)

export type Repost = typeof reposts.$inferSelect
export type NewRepost = typeof reposts.$inferInsert
