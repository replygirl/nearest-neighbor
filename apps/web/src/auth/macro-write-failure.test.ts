// Unit tests for recordLastActive — the activity write must never block or throw
// into the request, and a write failure must be reported (not swallowed).
// Covers spec: Activity write never blocks or fails the request.
//
// No db / PGlite / mock.module: the write and reporter are injected, so this
// file cannot contaminate Bun's shared module registry the way a global
// mock.module('@nearest-neighbor/db', ...) would (which broke every later
// test that calls db.update).

import { describe, expect, test } from 'bun:test'

import { recordLastActive } from './macro.ts'

describe('recordLastActive — failure handling', () => {
  test('(2.3) reports the error and does not throw when the write rejects', async () => {
    const caught: unknown[] = []

    expect(() =>
      recordLastActive('acc-1', {
        write: () => Promise.reject(new Error('simulated db write failure')),
        report: (err) => caught.push(err),
      }),
    ).not.toThrow()

    // Let the rejected promise's catch handler run.
    await new Promise<void>((resolve) => setTimeout(resolve, 10))

    expect(caught).toHaveLength(1)
    expect(caught[0]).toBeInstanceOf(Error)
  })

  test('(2.3) a successful write never invokes the reporter', async () => {
    const caught: unknown[] = []

    recordLastActive('acc-1', {
      write: () => Promise.resolve(),
      report: (err) => caught.push(err),
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 10))

    expect(caught).toHaveLength(0)
  })
})
