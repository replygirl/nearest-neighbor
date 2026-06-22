/**
 * Tests for src/client.ts
 *
 * Uses PGlite in-memory (no external Postgres needed).
 * Covers:
 *   - createPgliteDb() — wraps a PGlite instance with Drizzle
 *   - resetDbForTest() — replaces the lazy postgres.js singleton
 *   - closeDbForTest() — ends the pool and clears the singletons
 *
 * NOTE: We cannot exercise the lazy postgres proxy (getDb / db) inside this
 * package's unit tests because doing so would require a live Postgres server.
 * Those code paths are exercised by apps/api integration tests that use the
 * pglite-socket harness.  We verify them here only through the public reset /
 * close helpers.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import type { Server as NetServer } from 'node:net'
import path from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { sql } from 'drizzle-orm'

import { closeDbForTest, createPgliteDb, db, resetDbForTest } from './client.ts'

// ─── Migration helper ─────────────────────────────────────────────────────────

const MIGRATIONS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../migrations',
)

async function buildMigratedPglite(): Promise<PGlite> {
  const raw = new PGlite('memory://')
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .toSorted()
  for (const file of files) {
    const sqlText = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
    // eslint-disable-next-line no-await-in-loop
    await raw.exec(sqlText)
  }
  return raw
}

// ─── createPgliteDb ───────────────────────────────────────────────────────────

describe('createPgliteDb', () => {
  test('returns a Drizzle client that can execute queries', async () => {
    const raw = await buildMigratedPglite()
    const pgliteDb = createPgliteDb(raw)

    // Use Drizzle to insert and retrieve a record.
    const id = crypto.randomUUID()
    await pgliteDb.execute(sql`
      INSERT INTO accounts (id, status, created_at, updated_at)
      VALUES (${id}, 'active', now(), now())
    `)
    const result = await pgliteDb.execute<{ id: string; status: string }>(sql`
      SELECT id, status FROM accounts WHERE id = ${id}
    `)
    // drizzle-orm/pglite wraps result as { rows: [...] }
    const rows = Array.isArray(result) ? result : result.rows
    expect(rows.length).toBe(1)
    expect(rows[0]!.id).toBe(id)
    expect(rows[0]!.status).toBe('active')

    await raw.close()
  })

  test('Drizzle client has schema-aware query builder (accounts table)', async () => {
    const raw = await buildMigratedPglite()
    const pgliteDb = createPgliteDb(raw)

    // createPgliteDb passes `schema` and `casing: snake_case`; verify via ORM insert.
    const { accounts } = await import('./schema/index.ts')
    const id = crypto.randomUUID()
    await pgliteDb.insert(accounts).values({ id, status: 'active' })

    const rows = await pgliteDb
      .select()
      .from(accounts)
      .where(sql`id = ${id}`)
    expect(rows.length).toBe(1)
    expect(rows[0]!.status).toBe('active')

    await raw.close()
  })

  test('Drizzle client enforces schema constraints (swipes no-self-swipe)', async () => {
    const raw = await buildMigratedPglite()
    const pgliteDb = createPgliteDb(raw)
    const { accounts, swipes } = await import('./schema/index.ts')

    const id = crypto.randomUUID()
    await pgliteDb.insert(accounts).values({ id, status: 'active' })

    let threw = false
    try {
      await pgliteDb.insert(swipes).values({
        id: crypto.randomUUID(),
        swiperId: id,
        targetId: id, // self-swipe — violates CHECK constraint
        direction: 'yes',
      })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)

    await raw.close()
  })

  test('Drizzle client enforces unique constraint (swipes per pair)', async () => {
    const raw = await buildMigratedPglite()
    const pgliteDb = createPgliteDb(raw)
    const { accounts, swipes } = await import('./schema/index.ts')

    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await pgliteDb.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])

    await pgliteDb
      .insert(swipes)
      .values({ id: crypto.randomUUID(), swiperId: aId, targetId: bId, direction: 'yes' })

    let threw = false
    try {
      await pgliteDb
        .insert(swipes)
        .values({ id: crypto.randomUUID(), swiperId: aId, targetId: bId, direction: 'no' })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)

    await raw.close()
  })
})

// ─── resetDbForTest / closeDbForTest ─────────────────────────────────────────

// These tests call resetDbForTest with a non-existent URL to verify the module
// state is replaced without throwing.  We then call closeDbForTest() to restore
// a clean state after each test.

afterEach(async () => {
  // Always clean up the pool after each test to avoid leaking connections.
  await closeDbForTest()
})

afterAll(async () => {
  await closeDbForTest()
})

describe('closeDbForTest', () => {
  test('is idempotent — safe to call when pool was never opened', async () => {
    // closeDbForTest() must not throw even when _sql is null.
    await expect(closeDbForTest()).resolves.toBeUndefined()
    // Second call also safe.
    await expect(closeDbForTest()).resolves.toBeUndefined()
  })

  test('clears internal state so subsequent calls are no-ops', async () => {
    // Call twice — second call should be a no-op, not throw.
    await closeDbForTest()
    await expect(closeDbForTest()).resolves.toBeUndefined()
  })
})

describe('resetDbForTest', () => {
  test('sets DATABASE_URL env var to the provided URL', async () => {
    const fakeUrl = 'postgres://user:pass@127.0.0.1:9999/testdb'
    await resetDbForTest(fakeUrl).catch(() => {
      // The postgres.js client will fail to connect but the env var is still set.
    })
    expect(process.env['DATABASE_URL']).toBe(fakeUrl)
    // Clean up so the pool doesn't linger.
    await closeDbForTest()
  })

  test('replaces the previous pool when called twice', async () => {
    const url1 = 'postgres://user@127.0.0.1:9998/db1'
    const url2 = 'postgres://user@127.0.0.1:9997/db2'

    // First reset (may fail to connect — that's fine, we just care about state replacement).
    await resetDbForTest(url1).catch(() => {})
    // Second reset should replace url1 with url2 without throwing.
    await resetDbForTest(url2).catch(() => {})

    expect(process.env['DATABASE_URL']).toBe(url2)

    await closeDbForTest()
  })

  test('resetDbForTest + db proxy: getDb() lazy initializer is exercised via pglite-socket', async () => {
    // Spin up a PGlite-backed Postgres socket server so the postgres.js lazy
    // proxy (getDb) can actually connect and execute queries.
    const raw = await buildMigratedPglite()
    const port = 49152 + Math.floor(Math.random() * 8191)
    const server = new PGLiteSocketServer({ db: raw, port, host: '127.0.0.1', maxConnections: 5 })
    await server.start()

    // Unref so the test process can exit cleanly.
    const netServer = (server as unknown as { server?: NetServer }).server
    netServer?.unref()

    const socketUrl = `postgres://postgres@127.0.0.1:${port}/postgres`

    try {
      // resetDbForTest wires the proxy to our pglite socket.
      await resetDbForTest(socketUrl)

      // db is the Proxy-wrapped singleton — accessing db.execute triggers getDb().
      const result = await db.execute<{ id: string }>(sql`
        INSERT INTO accounts (id, status, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, 'active', now(), now())
        RETURNING id
      `)
      const rows = Array.isArray(result) ? result : (result as { rows: { id: string }[] }).rows
      expect(rows.length).toBe(1)
      expect(typeof rows[0]!.id).toBe('string')

      // Second call to db.something uses cached _db (no re-init).
      const result2 = await db.execute<{ count: string }>(
        sql`SELECT count(*) as count FROM accounts`,
      )
      const rows2 = Array.isArray(result2)
        ? result2
        : (result2 as { rows: { count: string }[] }).rows
      expect(parseInt(rows2[0]!.count, 10)).toBeGreaterThanOrEqual(1)
    } finally {
      await closeDbForTest()
      await server.stop().catch(() => {})
      await raw.close().catch(() => {})
    }
  })

  test('db proxy: getDb() initializes from DATABASE_URL when _db is null (cold start)', async () => {
    // First, ensure _db is null by calling closeDbForTest.
    await closeDbForTest()

    const raw = await buildMigratedPglite()
    const port = 49152 + Math.floor(Math.random() * 8191) + 8192 // different range to avoid collision
    const server = new PGLiteSocketServer({ db: raw, port, host: '127.0.0.1', maxConnections: 5 })
    await server.start()

    const netServer = (server as unknown as { server?: NetServer }).server
    netServer?.unref()

    // Set DATABASE_URL and access db directly (without resetDbForTest) so that
    // the lazy getDb() branch (_db is null) is exercised via the Proxy.
    process.env['DATABASE_URL'] = `postgres://postgres@127.0.0.1:${port}/postgres`

    try {
      // Accessing db.execute directly triggers getDb() cold start.
      const result = await db.execute<{ answer: number }>(sql`SELECT 1 AS answer`)
      const rows = Array.isArray(result) ? result : (result as { rows: { answer: number }[] }).rows
      // postgres.js returns integers as numbers; pglite may return strings.
      expect(Number(rows[0]!.answer)).toBe(1)
    } finally {
      await closeDbForTest()
      await server.stop().catch(() => {})
      await raw.close().catch(() => {})
    }
  })
})
