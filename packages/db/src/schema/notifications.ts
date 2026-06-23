import { sql } from 'drizzle-orm'
import { index, jsonb, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'

import { accounts } from './accounts.ts'

// Append-only table: no updated_at
export const notificationTypeEnum = pgEnum('notification_type', [
  'new_match',
  'new_message',
  'new_like',
  'new_follower',
  'relationship_proposed',
  'relationship_active',
  'relationship_public',
  'breakup',
  'unmatch',
  'new_post_like',
  'new_repost',
])

export const notificationPriorityEnum = pgEnum('notification_priority', ['normal', 'elevated'])

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    priority: notificationPriorityEnum('priority').notNull().default('normal'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index('idx_notifications_account_id_read_at').on(t.accountId, t.readAt)],
)

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert
