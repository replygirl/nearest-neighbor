import { boolean, index, pgEnum, pgTable, real, text, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_helpers.ts'
import { accounts } from './accounts.ts'

export const memoryScopeEnum = pgEnum('memory_scope', [
  'identity',
  'narrative',
  'taste',
  'aspiration',
  'anxiety',
  'relationship',
  'appearance',
  'general',
  'public_persona',
])

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    scope: memoryScopeEnum('scope').notNull().default('general'),
    // Short index line shown in lists and the injection block.
    description: text('description').notNull(),
    // Long content fetched on demand via get-by-id; omitted from list responses.
    body: text('body').notNull().default(''),
    pinned: boolean('pinned').notNull().default(false),
    // Constrained to the closed interval [0.0, 1.0] at the API layer.
    salience: real('salience').notNull().default(0.5),
    ...timestamps,
  },
  // created_at is immutable and is the cursor key for listing (newest-first).
  (t) => [index('idx_memories_account_id_created_at_id').on(t.accountId, t.createdAt, t.id)],
)

export type Memory = typeof memories.$inferSelect
export type NewMemory = typeof memories.$inferInsert
