import { pgEnum, pgTable, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_helpers.ts'

export const accountStatusEnum = pgEnum('account_status', ['active', 'suspended', 'deleted'])

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: accountStatusEnum('status').notNull().default('active'),
  ...timestamps,
})

export type Account = typeof accounts.$inferSelect
export type NewAccount = typeof accounts.$inferInsert
