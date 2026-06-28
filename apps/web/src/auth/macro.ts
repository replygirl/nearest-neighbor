// authMacro: use(authMacro) in any Elysia app, then add { auth: true } to
// route options to require a valid Bearer JWT. The resolved context will
// include { account: { id: string } }.
//
// Pattern:
//   app.use(authMacro).get('/foo', ({ account }) => ..., { auth: true })

import { captureException } from '@nearest-neighbor/analytics/node'
import { accountSecrets, accounts, db } from '@nearest-neighbor/db'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { Elysia } from 'elysia'

import { verifyBearer } from './tokens.ts'

// Injectable seam so the failure path can be unit-tested without globally
// mocking the db module (a global mock.module('@nearest-neighbor/db', ...)
// leaks into Bun's shared registry and breaks every other test file).
export type RecordLastActiveDeps = {
  write?: (accountId: string) => PromiseLike<unknown>
  report?: (err: unknown) => void
}

// Guarded, day-debounced activity write: at most one row-write per account per
// UTC day. current_date is evaluated by the DB (single clock source); on a day
// already recorded the predicate matches zero rows, so no row version is created.
function defaultLastActiveWrite(accountId: string): PromiseLike<unknown> {
  return db
    .update(accounts)
    .set({ lastActiveAt: sql`current_date` })
    .where(
      and(
        eq(accounts.id, accountId),
        or(isNull(accounts.lastActiveAt), lt(accounts.lastActiveAt, sql`current_date`)),
      ),
    )
}

// Fire-and-forget: never blocks the request and never throws into it. A failure
// is reported via captureException (surfaced, not silently swallowed).
export function recordLastActive(accountId: string, deps: RecordLastActiveDeps = {}): void {
  const write = deps.write ?? defaultLastActiveWrite
  const report =
    deps.report ?? ((err: unknown) => captureException(err, 'server', { op: 'last_active_write' }))
  void Promise.resolve(write(accountId)).catch(report)
}

export const authMacro = new Elysia({ name: 'auth-macro' }).macro({
  auth: {
    async resolve({ status, request: { headers } }) {
      const authorization = headers.get('authorization')
      if (!authorization?.startsWith('Bearer ')) return status(401)
      const token = authorization.slice(7)
      const payload = await verifyBearer(token)
      if (!payload) return status(401)
      const { accountId, sid } = payload

      // Revocation check: if the JWT carries a secret id (sid), look up the
      // account_secrets row. If the row exists and revokedAt is non-null, the
      // secret was revoked — reject the request. If sid is absent or the row is
      // not found, we allow through (tolerant path for legacy/sid-less tokens).
      // Revocation is a soft-delete: a revoked row remains with revokedAt set,
      // so "row not found" means the token predates sid embedding, not revocation.
      if (sid) {
        const secretRow = await db.query.accountSecrets.findFirst({
          where: eq(accountSecrets.id, sid),
        })
        if (secretRow?.revokedAt != null) return status(401)
      }

      // Record authenticated activity (non-blocking, debounced to once/day).
      recordLastActive(accountId)

      return { account: { id: accountId } }
    },
  },
})
