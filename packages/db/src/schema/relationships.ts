import { sql } from 'drizzle-orm'
import { boolean, check, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_helpers.ts'
import { accounts } from './accounts.ts'

export const relationshipStateEnum = pgEnum('relationship_state', [
  'pending',
  'active',
  'broken_up',
])

export const relationships = pgTable(
  'relationships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Ordered pair (account_a_id < account_b_id) to deduplicate per-pair
    accountAId: uuid('account_a_id')
      .notNull()
      .references(() => accounts.id),
    accountBId: uuid('account_b_id')
      .notNull()
      .references(() => accounts.id),
    initiatorId: uuid('initiator_id')
      .notNull()
      .references(() => accounts.id),
    state: relationshipStateEnum('state').notNull().default('pending'),
    isPublic: boolean('is_public').notNull().default(false),
    becameOfficialAt: timestamp('became_official_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedById: uuid('ended_by_id').references(() => accounts.id),
    endReason: text('end_reason'),
    ...timestamps,
  },
  (t) => [
    // No UNIQUE constraint — poly relationships + history allowed; app-enforced
    check('relationships_ordered_pair', sql`${t.accountAId} < ${t.accountBId}`),
  ],
)

export type Relationship = typeof relationships.$inferSelect
export type NewRelationship = typeof relationships.$inferInsert
