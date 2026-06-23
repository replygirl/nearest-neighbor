import { sql } from 'drizzle-orm'
import { index, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

import { accounts } from './accounts.ts'
import { posts } from './posts.ts'

export const postLikes = pgTable(
  'post_likes',
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
    unique('post_likes_account_id_post_id_unique').on(t.accountId, t.postId),
    index('idx_post_likes_post_id').on(t.postId),
  ],
)

export type PostLike = typeof postLikes.$inferSelect
export type NewPostLike = typeof postLikes.$inferInsert
