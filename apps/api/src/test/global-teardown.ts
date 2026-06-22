// Global test teardown — loaded by apps/api/bunfig.toml [test].preload.
//
// afterAll in a preload file fires once, after the last test file in the run,
// which is the right place to close long-lived resources (postgres.js pool,
// pglite-socket TCP server) so bun test exits cleanly with code 0 rather than
// being force-killed (code 99) due to open handles.

import { afterAll } from 'bun:test'

import { closeDbForTest } from '@nearest-neighbor/db'

import { getTestDbStopFn } from './pglite-fixture.ts'

afterAll(async () => {
  // Close the postgres.js connection pool.  Without this the pool's idle TCP
  // sockets keep the event loop alive and bun test exits with code 99.
  await closeDbForTest()
  // Stop the pglite-socket TCP server.
  const stop = getTestDbStopFn()
  if (stop) await stop()
})
