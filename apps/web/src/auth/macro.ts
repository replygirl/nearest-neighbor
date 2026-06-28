// authMacro: use(authMacro) in any Elysia app, then add { auth: true } to
// route options to require a valid Bearer JWT. The resolved context will
// include { account: { id: string } }.
//
// Pattern:
//   app.use(authMacro).get('/foo', ({ account }) => ..., { auth: true })

import { db, accountSecrets } from '@nearest-neighbor/db'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'

import { verifyBearer } from './tokens.ts'

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

      return { account: { id: accountId } }
    },
  },
})
