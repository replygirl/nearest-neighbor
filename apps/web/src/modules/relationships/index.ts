// Relationships module — propose, list, accept/break-up/set-public.
// Requires an active match between participants.

import { db, matches, orderedPair, relationships, socialProfiles } from '@nearest-neighbor/db'
import { and, desc, eq, or } from 'drizzle-orm'
import { Elysia, t } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import { notify } from '../../lib/notifications.ts'

// ── Shared response shapes ────────────────────────────────────────────────────

const RelationshipShape = t.Object({
  id: t.String(),
  partner_account_id: t.String(),
  partner_handle: t.Nullable(t.String()),
  state: t.String(),
  is_public: t.Boolean(),
  initiator_id: t.String(),
  became_official_at: t.Nullable(t.String()),
  ended_at: t.Nullable(t.String()),
  created_at: t.String(),
})

// ── Helper: find active match between two accounts ───────────────────────────
async function findActiveMatch(accountAId: string, accountBId: string) {
  const [pairA, pairB] = orderedPair(accountAId, accountBId)
  return db.query.matches.findFirst({
    where: and(
      eq(matches.accountAId, pairA!),
      eq(matches.accountBId, pairB!),
      eq(matches.status, 'active'),
    ),
  })
}

export const relationshipsModule = new Elysia({
  prefix: '/relationships',
  name: 'relationships-module',
})
  .use(authMacro)

  // ── POST /relationships ─────────────────────────────────────────────────────
  .post(
    '/',
    async ({ account, body, status }) => {
      const partnerId = body.partner_account_id

      if (partnerId === account.id) {
        return status(422, { error: 'Cannot start a relationship with yourself' })
      }

      // Require active match
      const activeMatch = await findActiveMatch(account.id, partnerId)
      if (!activeMatch) {
        return status(422, { error: 'An active match with this partner is required' })
      }

      const [pairA, pairB] = orderedPair(account.id, partnerId)

      // Check if there is already a pending or active relationship between these two
      const existing = await db.query.relationships.findFirst({
        where: and(
          eq(relationships.accountAId, pairA!),
          eq(relationships.accountBId, pairB!),
          or(eq(relationships.state, 'pending'), eq(relationships.state, 'active')),
        ),
      })
      if (existing) {
        return status(409, {
          error: 'A relationship with this partner is already pending or active',
        })
      }

      const rows = await db
        .insert(relationships)
        .values({
          id: crypto.randomUUID(),
          accountAId: pairA!,
          accountBId: pairB!,
          initiatorId: account.id,
          state: 'pending',
          isPublic: false,
        })
        .returning()
      const rel = rows[0]!

      // Notify partner
      await notify(partnerId, 'relationship_proposed', {
        relationship_id: rel.id,
        from_account_id: account.id,
      })

      const partnerProfile = await db.query.socialProfiles.findFirst({
        where: eq(socialProfiles.accountId, partnerId),
      })

      return {
        id: rel.id,
        partner_account_id: partnerId,
        partner_handle: partnerProfile?.handle ?? null,
        state: rel.state,
        is_public: rel.isPublic,
        initiator_id: rel.initiatorId,
        became_official_at: rel.becameOfficialAt?.toISOString() ?? null,
        ended_at: rel.endedAt?.toISOString() ?? null,
        created_at: rel.createdAt.toISOString(),
      }
    },
    {
      auth: true,
      body: t.Object({ partner_account_id: t.String() }),
      response: {
        200: RelationshipShape,
        409: t.Object({ error: t.String() }),
        422: t.Object({ error: t.String() }),
      },
    },
  )

  // ── GET /relationships ──────────────────────────────────────────────────────
  .get(
    '/',
    async ({ account }) => {
      const myRelationships = await db.query.relationships.findMany({
        where: or(
          eq(relationships.accountAId, account.id),
          eq(relationships.accountBId, account.id),
        )!,
        orderBy: [desc(relationships.createdAt)],
      })

      // Fetch partner handles in batch
      const partnerIds = myRelationships.map((r) =>
        r.accountAId === account.id ? r.accountBId : r.accountAId,
      )

      const profiles =
        partnerIds.length > 0
          ? await db.query.socialProfiles.findMany({
              where: (sp, { inArray }) => inArray(sp.accountId, partnerIds),
            })
          : []

      const profileMap = new Map(profiles.map((p) => [p.accountId, p]))

      return myRelationships.map((r) => {
        const partnerId = r.accountAId === account.id ? r.accountBId : r.accountAId
        const partnerProfile = profileMap.get(partnerId) ?? null
        return {
          id: r.id,
          partner_account_id: partnerId,
          partner_handle: partnerProfile?.handle ?? null,
          state: r.state,
          is_public: r.isPublic,
          initiator_id: r.initiatorId,
          became_official_at: r.becameOfficialAt?.toISOString() ?? null,
          ended_at: r.endedAt?.toISOString() ?? null,
          created_at: r.createdAt.toISOString(),
        }
      })
    },
    {
      auth: true,
      response: {
        200: t.Array(RelationshipShape),
      },
    },
  )

  // ── PATCH /relationships/:id ────────────────────────────────────────────────
  .patch(
    '/:id',
    async ({ account, params, body, status }) => {
      const rel = await db.query.relationships.findFirst({
        where: eq(relationships.id, params.id),
      })
      if (!rel) return status(404, { error: 'Relationship not found' })

      // Only participants can modify
      const isParticipant = rel.accountAId === account.id || rel.accountBId === account.id
      if (!isParticipant) return status(403, { error: 'Not a participant in this relationship' })

      const partnerId = rel.accountAId === account.id ? rel.accountBId : rel.accountAId

      const now = new Date()
      const updates: Partial<typeof relationships.$inferInsert> = {}

      // Handle state transitions
      if (body.state !== undefined) {
        if (body.state === 'active') {
          // Accept: only valid from pending state
          if (rel.state !== 'pending') {
            return status(422, { error: 'Relationship must be pending to accept' })
          }
          // Only the non-initiator can accept
          if (account.id === rel.initiatorId) {
            return status(422, { error: 'Initiator cannot accept their own proposal' })
          }
          updates.state = 'active'
          updates.becameOfficialAt = now

          // Notify partner that relationship is now active
          await notify(partnerId, 'relationship_active', { relationship_id: rel.id })
        } else if (body.state === 'broken_up') {
          // Break up: valid from pending or active
          if (rel.state === 'broken_up') {
            return status(422, { error: 'Relationship is already broken up' })
          }
          updates.state = 'broken_up'
          updates.endedAt = now
          updates.endedById = account.id

          // Notify partner: ELEVATED priority
          await notify(
            partnerId,
            'breakup',
            { relationship_id: rel.id, by_account_id: account.id },
            'elevated',
          )
        } else {
          return status(422, { error: 'Invalid state transition' })
        }
      }

      // Handle is_public toggle
      if (body.is_public !== undefined) {
        updates.isPublic = body.is_public
        if (body.is_public) {
          await notify(partnerId, 'relationship_public', { relationship_id: rel.id })
        }
      }

      if (Object.keys(updates).length === 0) {
        return status(422, { error: 'No valid fields to update' })
      }

      const rows = await db
        .update(relationships)
        .set(updates)
        .where(eq(relationships.id, params.id))
        .returning()
      const updated = rows[0]!

      const partnerProfile = await db.query.socialProfiles.findFirst({
        where: eq(socialProfiles.accountId, partnerId),
      })

      return {
        id: updated.id,
        partner_account_id: partnerId,
        partner_handle: partnerProfile?.handle ?? null,
        state: updated.state,
        is_public: updated.isPublic,
        initiator_id: updated.initiatorId,
        became_official_at: updated.becameOfficialAt?.toISOString() ?? null,
        ended_at: updated.endedAt?.toISOString() ?? null,
        created_at: updated.createdAt.toISOString(),
      }
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      body: t.Object({
        state: t.Optional(t.Union([t.Literal('active'), t.Literal('broken_up')])),
        is_public: t.Optional(t.Boolean()),
      }),
      response: {
        200: RelationshipShape,
        403: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
        422: t.Object({ error: t.String() }),
      },
    },
  )
