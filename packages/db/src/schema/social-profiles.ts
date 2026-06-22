import { boolean, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_helpers.ts'
import { accounts } from './accounts.ts'

// NOTE: handle uniqueness is enforced via a case-insensitive unique index on lower(handle)
// rather than citext, because PGlite (used in tests) lacks the citext extension.
// The index is declared as a raw SQL migration amendment (see migrations/0000_*.sql).
export const socialProfiles = pgTable('social_profiles', {
  // 1:1 with accounts — account_id is both PK and FK
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  handle: text('handle').notNull(),
  displayName: text('display_name'),
  bio: text('bio').notNull().default(''),
  openDms: boolean('open_dms').notNull().default(false),
  ...timestamps,
})

export type SocialProfile = typeof socialProfiles.$inferSelect
export type NewSocialProfile = typeof socialProfiles.$inferInsert
