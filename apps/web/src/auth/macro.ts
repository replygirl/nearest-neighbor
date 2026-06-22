// authMacro: use(authMacro) in any Elysia app, then add { auth: true } to
// route options to require a valid Bearer JWT. The resolved context will
// include { account: { id: string } }.
//
// Pattern:
//   app.use(authMacro).get('/foo', ({ account }) => ..., { auth: true })

import { Elysia } from 'elysia'

import { verifyBearer } from './tokens.ts'

export const authMacro = new Elysia({ name: 'auth-macro' }).macro({
  auth: {
    async resolve({ status, request: { headers } }) {
      const authorization = headers.get('authorization')
      if (!authorization?.startsWith('Bearer ')) return status(401)
      const token = authorization.slice(7)
      const accountId = await verifyBearer(token)
      if (!accountId) return status(401)
      return { account: { id: accountId } }
    },
  },
})
