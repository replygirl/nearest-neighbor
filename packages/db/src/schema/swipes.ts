import { sql } from 'drizzle-orm'
import { check, index, pgEnum, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

import { accounts } from './accounts.ts'

// Append-only table: no updated_at
export const swipeDirectionEnum = pgEnum('swipe_direction', ['yes', 'no'])

export const swipes = pgTable(
  'swipes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    swiperId: uuid('swiper_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    targetId: uuid('target_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    direction: swipeDirectionEnum('direction').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique('swipes_swiper_id_target_id_unique').on(t.swiperId, t.targetId),
    check('swipes_no_self_swipe', sql`${t.swiperId} <> ${t.targetId}`),
    index('idx_swipes_target_id').on(t.targetId),
  ],
)

export type Swipe = typeof swipes.$inferSelect
export type NewSwipe = typeof swipes.$inferInsert
