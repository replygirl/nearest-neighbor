import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { accounts } from './accounts.ts'
import { conversations } from './conversations.ts'

// Append-only table: no updated_at
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => accounts.id),
    body: text('body').notNull().default(''),
    asciiImage: text('ascii_image'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index('idx_messages_conversation_id_created_at').on(t.conversationId, t.createdAt)],
)

export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
