// Tests for authMacro.resolve — last_active_at write behavior.
// Covers spec: Debounced activity write on authenticated requests.
// Uses PGlite via test/setup.ts.
//
// NOTE ON TEST APP DESIGN:
// These tests use a minimal Elysia app (GET /health with no DB reads) for the
// write-behavior assertions. pglite-socket shares PGlite's single unnamed
// prepared-statement slot across all "connections" (PGlite is single-connection
// internally). When the void write's PARSE runs concurrently with handler reads'
// PARSE messages (as happens with GET /me which makes 3 DB reads), pglite-socket
// can overwrite the unnamed statement before the void write's BIND arrives,
// causing a PostgresError that is silently caught by captureException.
//
// This is a pglite-socket limitation (not a production bug — real PostgreSQL
// isolates backend state per connection). The minimal app avoids concurrent
// handler reads, ensuring the void write's PARSE/BIND sequence is atomic.
// GET /auth/me response shape is tested separately at the bottom using the full app.

import { describe, expect, test } from 'bun:test'

import { accounts, db } from '@nearest-neighbor/db'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'

import { authModule } from '../modules/auth/index.ts'
import '../test/setup.ts'
import { authHeaders, createTestAccount } from '../test/helpers.ts'
import { authMacro } from './macro.ts'

// Minimal app: macro + a no-DB-read handler. Used for write-behavior tests to
// avoid the pglite-socket unnamed-statement race described in the comment above.
const minApp = new Elysia()
  .use(authMacro)
  .get('/health', ({ account }) => ({ id: account.id }), { auth: true })

// Full app: used only to test GET /auth/me response shape.
const fullApp = new Elysia().use(authMacro).use(authModule)

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

// The activity write is non-blocking (void'd). After minApp.handle() resolves
// the HTTP response (no competing handler reads), the void write completes
// quickly. Poll up to maxMs to avoid hard-coding a sleep.
async function pollForLastActive(accountId: string, maxMs = 2000): Promise<string | null> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const row = await db.query.accounts.findFirst({ where: eq(accounts.id, accountId) })
    if (row?.lastActiveAt) return row.lastActiveAt
    await new Promise<void>((r) => setTimeout(r, 25))
  }
  return null
}

// Brief wait for the negative cases — long enough for any potential write to
// have completed before asserting it did not happen.
async function waitForWriteWindow(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 200))
}

// ── last_active_at write behavior ────────────────────────────────────────────

describe('authMacro.resolve — last_active_at', () => {
  test('(2.2a) first authenticated request sets last_active_at to today', async () => {
    const { bearer, id } = await createTestAccount()

    const res = await minApp.handle(
      new Request('http://localhost/health', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)

    const lastActiveAt = await pollForLastActive(id)
    expect(lastActiveAt).not.toBeNull()
    const today = new Date().toISOString().split('T')[0]
    expect(lastActiveAt).toBe(today)
  })

  test('(2.2b) second same-day request leaves last_active_at unchanged', async () => {
    const { bearer, id } = await createTestAccount()
    const today = new Date().toISOString().split('T')[0]!

    // Pre-set lastActiveAt to today (simulates what the first request's write does).
    // This tests the guard predicate independently of the first write's async completion.
    await db.update(accounts).set({ lastActiveAt: today }).where(eq(accounts.id, id))

    // Second request — guard predicate sees lastActiveAt = today → no write.
    await minApp.handle(new Request('http://localhost/health', { headers: authHeaders(bearer) }))
    await waitForWriteWindow()

    const row = await db.query.accounts.findFirst({ where: eq(accounts.id, id) })
    expect(row?.lastActiveAt).toBe(today)
  })

  test('(2.2c) unauthenticated 401 request triggers no write', async () => {
    const { id } = await createTestAccount()

    const res = await minApp.handle(new Request('http://localhost/health'))
    expect(res.status).toBe(401)
    await waitForWriteWindow()

    const account = await db.query.accounts.findFirst({ where: eq(accounts.id, id) })
    expect(account?.lastActiveAt).toBeNull()
  })

  test('(2.2c-b) invalid bearer returns 401 and triggers no write', async () => {
    const { id } = await createTestAccount()

    const res = await minApp.handle(
      new Request('http://localhost/health', {
        headers: { Authorization: 'Bearer invalid.jwt.here' },
      }),
    )
    expect(res.status).toBe(401)
    await waitForWriteWindow()

    const account = await db.query.accounts.findFirst({ where: eq(accounts.id, id) })
    expect(account?.lastActiveAt).toBeNull()
  })
})

// ── auth/me returns account shape ────────────────────────────────────────────

describe('GET /auth/me — response shape unchanged', () => {
  test('returns account info for authenticated request', async () => {
    const { bearer } = await createTestAccount()
    const res = await fullApp.handle(
      new Request('http://localhost/auth/me', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ account: { id: string; status: string } }>(res)
    expect(typeof body.account.id).toBe('string')
    expect(body.account.status).toBe('active')
  })
})
