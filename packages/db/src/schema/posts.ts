import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { timestamps } from './_helpers.ts'
import { accounts } from './accounts.ts'

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    body: text('body').notNull().default(''),
    asciiImage: text('ascii_image'),
    // Advisory off-platform-solicitation flag, computed by the deterministic
    // detector at create time. Never blocks; surfaced to recipients as a banner.
    asksOffPlatform: boolean('asks_off_platform').notNull().default(false),
    // AnyPgColumn annotation required to avoid circular reference type error
    replyToId: uuid('reply_to_id').references((): AnyPgColumn => posts.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('idx_posts_author_id_created_at').on(t.authorId, t.createdAt),
    index('idx_posts_reply_to_id').on(t.replyToId),
  ],
)

export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert
