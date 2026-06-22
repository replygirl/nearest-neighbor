import { isNull, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { timestamp } from 'drizzle-orm/pg-core'

// $onUpdateFn fires at the Drizzle layer, not the DB layer.
// Rows modified via raw SQL or another client will NOT update updated_at.
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdateFn(() => new Date()),
}

// Append-only tables (swipes, follows, messages, notifications, account_secrets)
// use only createdAt — no updatedAt.
export const createdAt = timestamp('created_at', { withTimezone: true })
  .notNull()
  .default(sql`now()`)

export function withSoftDelete<T extends { deletedAt: PgColumn }>(table: T) {
  return { where: isNull(table.deletedAt) }
}

export { isNull }
