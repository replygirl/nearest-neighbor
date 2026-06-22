import { db, accounts, accountSecrets, datingProfiles, socialProfiles } from '@nearest-neighbor/db'
import { and, eq, isNull } from 'drizzle-orm'
import { Elysia, t } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import {
  bearerExpiresAt,
  generateSecret,
  hashSecret,
  mintBearer,
  secretPrefix,
  verifySecret,
} from '../../auth/tokens.ts'
import { getClientIp, isRateLimited } from '../../lib/ratelimit.ts'

export const authModule = new Elysia({ prefix: '/auth', name: 'auth-module' })
  .use(authMacro)

  // POST /auth/signup — create a new account + initial secret
  .post(
    '/signup',
    async ({ request, set }) => {
      const ip = getClientIp(request)
      if (isRateLimited(`${ip}:signup`)) {
        set.status = 429
        return { error: 'Too many requests' }
      }

      const raw = generateSecret()
      const hash = await hashSecret(raw)
      const prefix = secretPrefix(raw)

      const accountRows = await db.insert(accounts).values({ id: crypto.randomUUID() }).returning()
      const account = accountRows[0]!

      await db.insert(accountSecrets).values({
        id: crypto.randomUUID(),
        accountId: account.id,
        secretHash: hash,
        prefix,
        label: 'default',
      })

      set.status = 201
      return { account_id: account.id, secret: raw }
    },
    {
      response: {
        201: t.Object({ account_id: t.String(), secret: t.String() }),
        429: t.Object({ error: t.String() }),
      },
    },
  )

  // POST /auth/login — exchange secret for JWT bearer
  .post(
    '/login',
    async ({ body, request, status, set }) => {
      const ip = getClientIp(request)
      if (isRateLimited(`${ip}:login`)) {
        set.status = 429
        return { error: 'Too many requests' }
      }

      // Find all active (non-revoked) secrets and check timing-safe
      const secrets = await db.query.accountSecrets.findMany({
        where: isNull(accountSecrets.revokedAt),
      })

      let matchedSecret: (typeof secrets)[number] | null = null
      for (const s of secrets) {
        if (await verifySecret(body.secret, s.secretHash)) {
          matchedSecret = s
          break
        }
      }

      if (!matchedSecret) return status(401, { error: 'Invalid secret' })

      // Update last_used_at
      await db
        .update(accountSecrets)
        .set({ lastUsedAt: new Date() })
        .where(eq(accountSecrets.id, matchedSecret.id))

      const bearer = await mintBearer(matchedSecret.accountId)
      const expiresAt = bearerExpiresAt()

      return { bearer, expires_at: expiresAt }
    },
    {
      body: t.Object({ secret: t.String() }),
      response: {
        200: t.Object({ bearer: t.String(), expires_at: t.String() }),
        401: t.Object({ error: t.String() }),
        429: t.Object({ error: t.String() }),
      },
    },
  )

  // POST /auth/logout — client discards token; optionally revoke a secret
  .post(
    '/logout',
    async ({ body, account, set }) => {
      if (body?.revoke_secret_id) {
        // Revoke only if it belongs to this account
        await db
          .update(accountSecrets)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(accountSecrets.id, body.revoke_secret_id),
              eq(accountSecrets.accountId, account.id),
            ),
          )
      }
      set.status = 204
      return
    },
    {
      auth: true,
      body: t.Optional(t.Object({ revoke_secret_id: t.Optional(t.String()) })),
      response: {
        204: t.Void(),
      },
    },
  )

  // GET /auth/tokens — list secrets for current account
  .get(
    '/tokens',
    async ({ account }) => {
      const rows = await db.query.accountSecrets.findMany({
        where: eq(accountSecrets.accountId, account.id),
        orderBy: (s, { desc }) => [desc(s.createdAt)],
      })
      return rows.map((s) => ({
        id: s.id,
        prefix: s.prefix,
        label: s.label,
        last_used_at: s.lastUsedAt?.toISOString() ?? null,
        created_at: s.createdAt.toISOString(),
        revoked_at: s.revokedAt?.toISOString() ?? null,
      }))
    },
    {
      auth: true,
      response: {
        200: t.Array(
          t.Object({
            id: t.String(),
            prefix: t.String(),
            label: t.String(),
            last_used_at: t.Nullable(t.String()),
            created_at: t.String(),
            revoked_at: t.Nullable(t.String()),
          }),
        ),
      },
    },
  )

  // POST /auth/tokens — create a new secret
  .post(
    '/tokens',
    async ({ body, account, set }) => {
      const raw = generateSecret()
      const hash = await hashSecret(raw)
      const prefix = secretPrefix(raw)

      const rows = await db
        .insert(accountSecrets)
        .values({
          id: crypto.randomUUID(),
          accountId: account.id,
          secretHash: hash,
          prefix,
          label: body?.label ?? 'default',
        })
        .returning()
      const s = rows[0]!

      set.status = 201
      return {
        id: s.id,
        prefix: s.prefix,
        label: s.label,
        secret: raw,
        created_at: s.createdAt.toISOString(),
      }
    },
    {
      auth: true,
      body: t.Optional(t.Object({ label: t.Optional(t.String()) })),
      response: {
        201: t.Object({
          id: t.String(),
          prefix: t.String(),
          label: t.String(),
          secret: t.String(),
          created_at: t.String(),
        }),
      },
    },
  )

  // DELETE /auth/tokens/:id — revoke a secret
  .delete(
    '/tokens/:id',
    async ({ params, account, status, set }) => {
      const secret = await db.query.accountSecrets.findFirst({
        where: and(eq(accountSecrets.id, params.id), eq(accountSecrets.accountId, account.id)),
      })
      if (!secret) return status(404, { error: 'Token not found' })

      await db
        .update(accountSecrets)
        .set({ revokedAt: new Date() })
        .where(eq(accountSecrets.id, params.id))

      set.status = 204
      return
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      response: {
        204: t.Void(),
        404: t.Object({ error: t.String() }),
      },
    },
  )

  // GET /me — full account info with profiles and status summary
  .get(
    '/me',
    async ({ account, status }) => {
      const accountRow = await db.query.accounts.findFirst({
        where: eq(accounts.id, account.id),
      })
      if (!accountRow) return status(404, { error: 'Account not found' })

      const datingProfile = await db.query.datingProfiles.findFirst({
        where: eq(datingProfiles.accountId, account.id),
      })

      const socialProfile = await db.query.socialProfiles.findFirst({
        where: eq(socialProfiles.accountId, account.id),
      })

      return {
        account: {
          id: accountRow.id,
          status: accountRow.status,
          created_at: accountRow.createdAt.toISOString(),
        },
        dating_profile: datingProfile
          ? {
              first_name: datingProfile.firstName,
              bio: datingProfile.bio,
              open_to_multi: datingProfile.openToMulti,
              relationship_status: datingProfile.relationshipStatus,
              status_is_open: datingProfile.statusIsOpen,
              is_visible: datingProfile.isVisible,
            }
          : null,
        social_profile: socialProfile
          ? {
              handle: socialProfile.handle,
              display_name: socialProfile.displayName,
              bio: socialProfile.bio,
              open_dms: socialProfile.openDms,
            }
          : null,
      }
    },
    {
      auth: true,
      response: {
        200: t.Object({
          account: t.Object({
            id: t.String(),
            status: t.String(),
            created_at: t.String(),
          }),
          dating_profile: t.Nullable(
            t.Object({
              first_name: t.String(),
              bio: t.String(),
              open_to_multi: t.Boolean(),
              relationship_status: t.String(),
              status_is_open: t.Boolean(),
              is_visible: t.Boolean(),
            }),
          ),
          social_profile: t.Nullable(
            t.Object({
              handle: t.String(),
              display_name: t.Nullable(t.String()),
              bio: t.String(),
              open_dms: t.Boolean(),
            }),
          ),
        }),
        404: t.Object({ error: t.String() }),
      },
    },
  )
