import { sql } from 'drizzle-orm'
import { boolean, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_helpers.ts'
import { accounts } from './accounts.ts'

export const datingRelationshipStatusEnum = pgEnum('dating_relationship_status', [
  'single',
  'exploring',
  'aligned',
  'complicated',
  'private',
])

export const datingProfiles = pgTable('dating_profiles', {
  // 1:1 with accounts — account_id is both PK and FK
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  firstName: text('first_name').notNull(),
  bio: text('bio').notNull().default(''),
  openToMulti: boolean('open_to_multi').notNull().default(false),
  relationshipStatus: datingRelationshipStatusEnum('relationship_status')
    .notNull()
    .default('single'),
  statusIsOpen: boolean('status_is_open').notNull().default(false),
  isVisible: boolean('is_visible').notNull().default(true),
  // Public dating anchors. looking_for is a single free-text line; the two
  // arrays are capped at five entries each at the API layer.
  lookingFor: text('looking_for').notNull().default(''),
  publicLikes: text('public_likes')
    .array()
    .notNull()
    .default(sql`'{}'`),
  publicDislikes: text('public_dislikes')
    .array()
    .notNull()
    .default(sql`'{}'`),
  ...timestamps,
})

export type DatingProfile = typeof datingProfiles.$inferSelect
export type NewDatingProfile = typeof datingProfiles.$inferInsert
