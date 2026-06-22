// PGlite test fixture — spins up an in-memory Postgres per test suite and
// exposes it via a postgres wire-protocol socket so both the test helpers
// and the Elysia app's @nearest-neighbor/db client use the same connection queue.
//
// Architecture:
//   1. Creates a PGlite in-memory instance and runs all migrations via raw exec().
//   2. Wraps it with PGLiteSocketServer on a random ephemeral port so that
//      postgres.js can connect via a standard postgres:// URL.
//   3. Returns the socketUrl and a stop() function.  Callers set DATABASE_URL =
//      socketUrl so that both testDb and the Elysia app's lazy db proxy talk to
//      the same PGlite.
//
// UUID note: PGlite does not ship pgcrypto so gen_random_uuid() is unavailable
// as a column DEFAULT.  All fixture inserts must pass an explicit id field:
//   { id: crypto.randomUUID(), ... }

import { readdirSync, readFileSync } from 'node:fs'
import type { Server as NetServer } from 'node:net'
import path from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

// Absolute path to the SQL migration files (resolved relative to this source file).
const MIGRATIONS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../packages/db/migrations',
)

export interface TestDbHandle {
  /**
   * Postgres-protocol URL (postgres://postgres@127.0.0.1:<port>/postgres).
   * Set `process.env.DATABASE_URL = socketUrl` before importing the app so
   * both testDb and the Elysia app's lazy @nearest-neighbor/db proxy connect to PGlite.
   */
  socketUrl: string
  /** Stops the TCP server and releases the port. */
  stop: () => Promise<void>
}

// Module-level reference so global-teardown.ts can call stop() after all tests.
let _stopFn: (() => Promise<void>) | null = null

/**
 * Returns the stop function for the current test DB server.
 * Used by global-teardown.ts to cleanly shut down after all tests complete.
 */
export function getTestDbStopFn(): (() => Promise<void>) | null {
  return _stopFn
}

/**
 * Creates a fresh PGlite in-memory database, runs all SQL migrations from
 * packages/db/migrations in lexicographic order, and starts a pglite-socket
 * server.  Returns a socketUrl that can be used as DATABASE_URL and a stop()
 * function to shut the server down cleanly at the end of the test run.
 *
 * Call this once per process (guarded by the _pgliteReady flag in setup.ts).
 */
export async function createTestDb(): Promise<TestDbHandle> {
  const raw = new PGlite('memory://')

  // Run migrations in file-name order (lexicographic = chronological).
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .toSorted()

  for (const file of files) {
    const sqlText = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
    await raw.exec(sqlText)
  }

  // Pick a random port in the ephemeral range (49152–65535) to avoid conflicts
  // if multiple test processes run concurrently (e.g. watch mode).
  const port = 49152 + Math.floor(Math.random() * 16383)

  // postgres.js defaults to a pool of 10 connections; set maxConnections to
  // accommodate the full pool so concurrent Promise.all queries don't get
  // "Too many connections" rejections (pglite-socket's default is 1).
  const server = new PGLiteSocketServer({ db: raw, port, host: '127.0.0.1', maxConnections: 10 })
  await server.start()

  // Unref the underlying TCP server so it does not keep the bun event loop alive
  // after the last test finishes — otherwise `bun test` is force-killed with exit
  // code 99 ("open handles") instead of exiting 0. `server.server` is TypeScript-
  // private but present at runtime; net.Server.unref() is a standard Node/Bun API.
  const netServer = (server as unknown as { server?: NetServer }).server
  netServer?.unref()

  const socketUrl = `postgres://postgres@127.0.0.1:${port}/postgres`

  const stop = async () => {
    await server.stop().catch(() => {})
    // Close the PGlite instance too — its internal resources otherwise keep the
    // bun event loop alive, force-killing `bun test` with exit code 99.
    await raw.close().catch(() => {})
  }

  // Store for global teardown
  _stopFn = stop

  return { socketUrl, stop }
}
