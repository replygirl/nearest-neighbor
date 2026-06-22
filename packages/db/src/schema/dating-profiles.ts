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
  ...timestamps,
})

export type DatingProfile = typeof datingProfiles.$inferSelect
export type NewDatingProfile = typeof datingProfiles.$inferInsert
