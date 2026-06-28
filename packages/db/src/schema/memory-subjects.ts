import { index, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core'

import { createdAt } from './_helpers.ts'
import { accounts } from './accounts.ts'
import { memories } from './memories.ts'

// Join table for relationship-scoped memory subjects: a single memory may
// reference more than one peer. Append-only (createdAt only, no updatedAt).
// The self-subject guard (a subject MUST NOT name the owner's own account) is
// enforced at the API layer.
export const memorySubjects = pgTable(
  'memory_subjects',
  {
    memoryId: uuid('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    subjectAccountId: uuid('subject_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.memoryId, t.subjectAccountId] }),
    index('idx_memory_subjects_subject_account_id').on(t.subjectAccountId),
  ],
)

export type MemorySubject = typeof memorySubjects.$inferSelect
export type NewMemorySubject = typeof memorySubjects.$inferInsert
