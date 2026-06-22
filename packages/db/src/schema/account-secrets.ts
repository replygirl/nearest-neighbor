import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { accounts } from './accounts.ts'

// Append-only table: no updated_at
export const accountSecrets = pgTable('account_secrets', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  secretHash: text('secret_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  label: text('label').notNull().default('default'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
})

export type AccountSecret = typeof accountSecrets.$inferSelect
export type NewAccountSecret = typeof accountSecrets.$inferInsert
