import type { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema/index.ts'

// postgres.js works in both Bun and Node.js (unlike drizzle-orm/bun-sql which
// uses Bun-native SQL APIs unavailable in Node.js / Vite SSR contexts).
// Lazily instantiate so DATABASE_URL can be set before the first query.
let _sql: ReturnType<typeof postgres> | null = null
let _db: ReturnType<typeof drizzlePostgres<typeof schema>> | null = null

function getDb(): ReturnType<typeof drizzlePostgres<typeof schema>> {
  if (!_db) {
    _sql = postgres(process.env['DATABASE_URL']!)
    _db = drizzlePostgres(_sql, {
      schema,
      casing: 'snake_case',
    })
  }
  return _db
}

export const db = new Proxy({} as ReturnType<typeof drizzlePostgres<typeof schema>>, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof drizzlePostgres<typeof schema>>]
  },
})

/**
 * Reset the lazy postgres.js singleton so the next `db` access creates a new
 * client pointing at the given URL. Intended for test environments only —
 * calling this in production will drop the existing connection pool.
 *
 * Must be called BEFORE any code that accesses `db`, because `getDb()` is
 * memoised: once `_db` is set it is never replaced unless this function runs.
 *
 * Eagerly pre-creates the connection pool so `DATABASE_URL` is consumed
 * immediately rather than lazily on first query access.
 */
export async function resetDbForTest(url: string): Promise<void> {
  if (_sql) {
    // End the old pool gracefully so pglite-socket doesn't see a stale connection.
    await _sql.end({ timeout: 1 }).catch(() => {})
  }
  _sql = null
  _db = null
  process.env['DATABASE_URL'] = url
  // Pre-create the pool immediately so DATABASE_URL is consumed now, not lazily.
  _sql = postgres(url)
  _db = drizzlePostgres(_sql, { schema, casing: 'snake_case' })
}

/**
 * Close the postgres.js connection pool. Intended for test environments only —
 * call this after all tests complete to allow the process to exit cleanly.
 * Idempotent: safe to call even if the pool was never opened.
 */
export async function closeDbForTest(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 2 }).catch(() => {})
    _sql = null
    _db = null
  }
}

/**
 * Create a Drizzle client backed by a PGlite instance.
 * Intended for test environments only — PGlite is single-connection and in-memory.
 *
 * @example
 *   const raw = new PGlite('memory://')
 *   const db = createPgliteDb(raw)
 */
export function createPgliteDb(raw: PGlite) {
  return drizzlePglite(raw, { schema, casing: 'snake_case' })
}

export type DbClient = typeof db
export type PgliteDbClient = ReturnType<typeof createPgliteDb>

// Unified type alias for both postgres and pglite clients (test helper).
// Both extend the same Drizzle PgDatabase<> base so they are structurally compatible.
export type Database = DbClient | PgliteDbClient
