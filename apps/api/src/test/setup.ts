// Test setup imported by db-touching test files.
//
// Engine selection (in priority order):
//   1. DATABASE_TEST_URL set  → real postgres at that URL (opt-in)
//   2. default                → PGlite in-memory (no external services needed)
//
// PGlite path:
//   createTestDb() boots PGlite, runs all migrations, and wraps the instance
//   with @electric-sql/pglite-socket on a random port.  resetDbForTest() resets
//   the @nearest-neighbor/db lazy proxy so that both testDb (fixture inserts) and the
//   Elysia app's @nearest-neighbor/db client connect to the same pglite-socket
//   instance via postgres.js.

import { beforeAll } from 'bun:test'

import { db, resetDbForTest } from '@nearest-neighbor/db'
import { sql } from 'drizzle-orm'

import { createTestDb } from './pglite-fixture.ts'

const testUrl = process.env['DATABASE_TEST_URL']

let _pgliteReady = false

if (testUrl) {
  process.env['DATABASE_URL'] = testUrl
}

beforeAll(async () => {
  if (!testUrl) {
    if (!_pgliteReady) {
      const handle = await createTestDb()
      await resetDbForTest(handle.socketUrl)
      _pgliteReady = true
    }
    // Truncate all app tables between test files so each file starts clean.
    await db.execute(sql`
      TRUNCATE TABLE
        account_secrets,
        notifications,
        messages,
        conversations,
        swipes,
        matches,
        follows,
        posts,
        relationships,
        dating_photos,
        dating_profiles,
        social_profiles,
        accounts
      RESTART IDENTITY CASCADE
    `)
  } else {
    await db.execute(sql`
      TRUNCATE TABLE
        account_secrets,
        notifications,
        messages,
        conversations,
        swipes,
        matches,
        follows,
        posts,
        relationships,
        dating_photos,
        dating_profiles,
        social_profiles,
        accounts
      RESTART IDENTITY CASCADE
    `)
  }
})

// NOTE: We intentionally do NOT close the postgres.js client in afterAll.
// Bun runs multiple test files in the same process sharing the module cache,
// so afterAll fires for every file that imports setup.ts — closing on completion
// of the first file would kill the DB for all remaining files.
// Resources are reclaimed automatically on process exit.
// The pglite-socket TCP server is unref'd (see pglite-fixture.ts) so it does
// not prevent bun test from exiting cleanly with code 0.

export const testDb = db
