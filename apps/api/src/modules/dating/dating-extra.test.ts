// Additional dating module tests covering previously uncovered branches.
// Uses PGlite via test/setup.ts.

import { describe, expect, test } from 'bun:test'

import { Elysia } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import '../../test/setup.ts'
import { authHeaders, createTestAccount } from '../../test/helpers.ts'
import { datingModule } from './index.ts'

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

const app = new Elysia().use(authMacro).use(datingModule)

// ── GET /dating/deck — cursor pagination branch ───────────────────────────────

describe('GET /dating/deck — cursor pagination branch', () => {
  test('paginates deck with cursor (exercises cursor filter branch)', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'DeckMe', isVisible: true },
    })

    // Create 22 visible profiles to push past the default page size of 20
    for (let i = 0; i < 22; i++) {
      await createTestAccount({ datingProfile: { firstName: `Deck${i}`, isVisible: true } })
    }

    // First page — should fill limit=20
    const res1 = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    expect(res1.status).toBe(200)
    const b1 = await json<{ items: unknown[]; next_cursor: string | null }>(res1)
    expect(b1.items.length).toBe(20)
    expect(b1.next_cursor).not.toBeNull()

    // Second page using the cursor — exercises lines 303-311
    const res2 = await app.handle(
      new Request(`http://localhost/dating/deck?cursor=${b1.next_cursor}`, {
        headers: authHeaders(bearer),
      }),
    )
    expect(res2.status).toBe(200)
    const b2 = await json<{ items: unknown[]; next_cursor: string | null }>(res2)
    expect(Array.isArray(b2.items)).toBe(true)
    // Second page has the remaining 2+ profiles
    expect(b2.items.length).toBeGreaterThanOrEqual(1)
  })
})
