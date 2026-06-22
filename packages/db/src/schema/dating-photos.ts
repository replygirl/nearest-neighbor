import { sql } from 'drizzle-orm'
import { integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

import { accounts } from './accounts.ts'

// Append-only table: no updated_at
export const datingPhotos = pgTable(
  'dating_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    art: text('art').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [unique('dating_photos_account_id_idx_unique').on(t.accountId, t.idx)],
)

export type DatingPhoto = typeof datingPhotos.$inferSelect
export type NewDatingPhoto = typeof datingPhotos.$inferInsert
