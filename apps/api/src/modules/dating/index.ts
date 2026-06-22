// Dating module — profile, photos, deck, swipes, matches, likes.

import {
  conversations,
  db,
  datingPhotos,
  datingProfiles,
  matches,
  orderedPair,
  swipes,
} from '@nearest-neighbor/db'
import { and, desc, eq, inArray, lt, notInArray, or } from 'drizzle-orm'
import { Elysia, t } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import { getOrCreateConversation, unlockDating } from '../../lib/conversations.ts'
import { notify } from '../../lib/notifications.ts'
import { decodeCursor, encodeCursor } from '../../lib/pagination.ts'
import { MAX_BIO, isValidAsciiArt } from '../../lib/validation.ts'

// ── Shared response shapes ────────────────────────────────────────────────────

const DatingProfileShape = t.Object({
  account_id: t.String(),
  first_name: t.String(),
  bio: t.String(),
  open_to_multi: t.Boolean(),
  relationship_status: t.String(),
  status_is_open: t.Boolean(),
  is_visible: t.Boolean(),
})

const MatchShape = t.Object({
  id: t.String(),
  other_account_id: t.String(),
  other_profile: t.Nullable(
    t.Object({
      first_name: t.String(),
      bio: t.String(),
      open_to_multi: t.Boolean(),
      relationship_status: t.String(),
      status_is_open: t.Boolean(),
      is_visible: t.Boolean(),
    }),
  ),
  status: t.String(),
  created_at: t.String(),
})

export const datingModule = new Elysia({ prefix: '/dating', name: 'dating-module' })
  .use(authMacro)

  // ── GET /dating/profile ─────────────────────────────────────────────────────
  .get(
    '/profile',
    async ({ account, status }) => {
      const profile = await db.query.datingProfiles.findFirst({
        where: eq(datingProfiles.accountId, account.id),
      })
      if (!profile) return status(404, { error: 'Dating profile not found' })
      return {
        account_id: profile.accountId,
        first_name: profile.firstName,
        bio: profile.bio,
        open_to_multi: profile.openToMulti,
        relationship_status: profile.relationshipStatus,
        status_is_open: profile.statusIsOpen,
        is_visible: profile.isVisible,
      }
    },
    {
      auth: true,
      response: {
        200: DatingProfileShape,
        404: t.Object({ error: t.String() }),
      },
    },
  )

  // ── PUT /dating/profile ─────────────────────────────────────────────────────
  .put(
    '/profile',
    async ({ account, body, status }) => {
      if (body.bio !== undefined && body.bio.length > MAX_BIO) {
        return status(422, { error: `Bio must be at most ${MAX_BIO} characters` })
      }

      const existing = await db.query.datingProfiles.findFirst({
        where: eq(datingProfiles.accountId, account.id),
      })

      if (existing) {
        const rows = await db
          .update(datingProfiles)
          .set({
            ...(body.first_name !== undefined && { firstName: body.first_name }),
            ...(body.bio !== undefined && { bio: body.bio }),
            ...(body.open_to_multi !== undefined && { openToMulti: body.open_to_multi }),
            ...(body.relationship_status !== undefined && {
              relationshipStatus: body.relationship_status,
            }),
            ...(body.status_is_open !== undefined && { statusIsOpen: body.status_is_open }),
            ...(body.is_visible !== undefined && { isVisible: body.is_visible }),
          })
          .where(eq(datingProfiles.accountId, account.id))
          .returning()
        const updated = rows[0]!
        return {
          account_id: updated.accountId,
          first_name: updated.firstName,
          bio: updated.bio,
          open_to_multi: updated.openToMulti,
          relationship_status: updated.relationshipStatus,
          status_is_open: updated.statusIsOpen,
          is_visible: updated.isVisible,
        }
      } else {
        // Insert requires first_name
        if (!body.first_name) {
          return status(422, { error: 'first_name is required to create a dating profile' })
        }
        const rows = await db
          .insert(datingProfiles)
          .values({
            accountId: account.id,
            firstName: body.first_name,
            bio: body.bio ?? '',
            openToMulti: body.open_to_multi ?? false,
            relationshipStatus: body.relationship_status ?? 'single',
            statusIsOpen: body.status_is_open ?? false,
            isVisible: body.is_visible ?? true,
          })
          .returning()
        const inserted = rows[0]!
        return {
          account_id: inserted.accountId,
          first_name: inserted.firstName,
          bio: inserted.bio,
          open_to_multi: inserted.openToMulti,
          relationship_status: inserted.relationshipStatus,
          status_is_open: inserted.statusIsOpen,
          is_visible: inserted.isVisible,
        }
      }
    },
    {
      auth: true,
      body: t.Object({
        first_name: t.Optional(t.String({ minLength: 1 })),
        bio: t.Optional(t.String()),
        open_to_multi: t.Optional(t.Boolean()),
        relationship_status: t.Optional(
          t.Union([
            t.Literal('single'),
            t.Literal('exploring'),
            t.Literal('aligned'),
            t.Literal('complicated'),
            t.Literal('private'),
          ]),
        ),
        status_is_open: t.Optional(t.Boolean()),
        is_visible: t.Optional(t.Boolean()),
      }),
      response: {
        200: DatingProfileShape,
        422: t.Object({ error: t.String() }),
      },
    },
  )

  // ── GET /dating/photos ──────────────────────────────────────────────────────
  .get(
    '/photos',
    async ({ account }) => {
      const photos = await db.query.datingPhotos.findMany({
        where: eq(datingPhotos.accountId, account.id),
        orderBy: (p, { asc }) => [asc(p.idx)],
      })
      return photos.map((p) => ({
        id: p.id,
        idx: p.idx,
        art: p.art,
        created_at: p.createdAt.toISOString(),
      }))
    },
    {
      auth: true,
      response: {
        200: t.Array(
          t.Object({
            id: t.String(),
            idx: t.Number(),
            art: t.String(),
            created_at: t.String(),
          }),
        ),
      },
    },
  )

  // ── PUT /dating/photos ──────────────────────────────────────────────────────
  .put(
    '/photos',
    async ({ account, body, status }) => {
      if (!isValidAsciiArt(body.art)) {
        return status(422, { error: 'Art must be at most 60 lines of at most 60 characters each' })
      }

      // Upsert by (account_id, idx)
      const rows = await db
        .insert(datingPhotos)
        .values({
          id: crypto.randomUUID(),
          accountId: account.id,
          idx: body.idx,
          art: body.art,
        })
        .onConflictDoUpdate({
          target: [datingPhotos.accountId, datingPhotos.idx],
          set: { art: body.art },
        })
        .returning()
      const photo = rows[0]!
      return {
        id: photo.id,
        idx: photo.idx,
        art: photo.art,
        created_at: photo.createdAt.toISOString(),
      }
    },
    {
      auth: true,
      body: t.Object({
        idx: t.Number({ minimum: 0, maximum: 9 }),
        art: t.String(),
      }),
      response: {
        200: t.Object({
          id: t.String(),
          idx: t.Number(),
          art: t.String(),
          created_at: t.String(),
        }),
        422: t.Object({ error: t.String() }),
      },
    },
  )

  // ── DELETE /dating/photos/:idx ──────────────────────────────────────────────
  .delete(
    '/photos/:idx',
    async ({ account, params, status, set }) => {
      const idx = parseInt(params.idx, 10)
      if (isNaN(idx)) return status(422, { error: 'Invalid idx' })

      const existing = await db.query.datingPhotos.findFirst({
        where: and(eq(datingPhotos.accountId, account.id), eq(datingPhotos.idx, idx)),
      })
      if (!existing) return status(404, { error: 'Photo not found' })

      await db
        .delete(datingPhotos)
        .where(and(eq(datingPhotos.accountId, account.id), eq(datingPhotos.idx, idx)))

      set.status = 204
      return
    },
    {
      auth: true,
      params: t.Object({ idx: t.String() }),
      response: {
        204: t.Void(),
        404: t.Object({ error: t.String() }),
        422: t.Object({ error: t.String() }),
      },
    },
  )

  // ── GET /dating/deck ────────────────────────────────────────────────────────
  .get(
    '/deck',
    async ({ account, query }) => {
      const limit = 20
      const cursor = query.cursor ? decodeCursor(query.cursor) : null

      // IDs already swiped by this account
      const swipedRows = await db.query.swipes.findMany({
        where: eq(swipes.swiperId, account.id),
        columns: { targetId: true },
      })
      const swipedIds = swipedRows.map((s) => s.targetId)

      // Build exclusion list: self + already swiped
      const excludeIds = [account.id, ...swipedIds]

      // Build conditions
      const conditions = [
        eq(datingProfiles.isVisible, true),
        notInArray(datingProfiles.accountId, excludeIds),
      ]

      if (cursor) {
        conditions.push(
          or(
            lt(datingProfiles.createdAt, new Date(cursor.createdAt)),
            and(
              eq(datingProfiles.createdAt, new Date(cursor.createdAt)),
              lt(datingProfiles.accountId, cursor.id),
            )!,
          )!,
        )
      }

      const rows = await db.query.datingProfiles.findMany({
        where: and(...conditions),
        orderBy: [desc(datingProfiles.createdAt), desc(datingProfiles.accountId)],
        limit: limit + 1,
      })

      const hasMore = rows.length > limit
      const items = hasMore ? rows.slice(0, limit) : rows
      const lastItem = items[items.length - 1]
      const nextCursor =
        hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.accountId) : null

      return {
        items: items.map((p) => ({
          account_id: p.accountId,
          first_name: p.firstName,
          bio: p.bio,
          open_to_multi: p.openToMulti,
          relationship_status: p.relationshipStatus,
          status_is_open: p.statusIsOpen,
          is_visible: p.isVisible,
        })),
        next_cursor: nextCursor,
      }
    },
    {
      auth: true,
      query: t.Object({ cursor: t.Optional(t.String()) }),
      response: {
        200: t.Object({
          items: t.Array(DatingProfileShape),
          next_cursor: t.Nullable(t.String()),
        }),
      },
    },
  )

  // ── POST /dating/swipes ─────────────────────────────────────────────────────
  .post(
    '/swipes',
    async ({ account, body, status }) => {
      if (body.target_id === account.id) {
        return status(422, { error: 'Cannot swipe on yourself' })
      }

      // Check target has a dating profile
      const targetProfile = await db.query.datingProfiles.findFirst({
        where: eq(datingProfiles.accountId, body.target_id),
      })
      if (!targetProfile) return status(404, { error: 'Target profile not found' })

      // Check for existing swipe (unique constraint)
      const existing = await db.query.swipes.findFirst({
        where: and(eq(swipes.swiperId, account.id), eq(swipes.targetId, body.target_id)),
      })
      if (existing) return status(409, { error: 'Already swiped on this profile' })

      // Insert swipe
      await db.insert(swipes).values({
        id: crypto.randomUUID(),
        swiperId: account.id,
        targetId: body.target_id,
        direction: body.direction,
      })

      // Notify target of the like (on yes swipe)
      if (body.direction === 'yes') {
        await notify(body.target_id, 'new_like', { from_account_id: account.id })
      }

      // Check for mutual yes (match)
      const theirSwipe = await db.query.swipes.findFirst({
        where: and(
          eq(swipes.swiperId, body.target_id),
          eq(swipes.targetId, account.id),
          eq(swipes.direction, 'yes'),
        ),
      })

      if (body.direction === 'yes' && theirSwipe) {
        // Create match (ordered pair)
        const [matchA, matchB] = orderedPair(account.id, body.target_id)

        // Check no active match already
        const existingMatch = await db.query.matches.findFirst({
          where: and(eq(matches.accountAId, matchA!), eq(matches.accountBId, matchB!)),
        })

        if (!existingMatch) {
          const matchRows = await db
            .insert(matches)
            .values({
              id: crypto.randomUUID(),
              accountAId: matchA!,
              accountBId: matchB!,
              status: 'active',
            })
            .returning()
          const match = matchRows[0]!

          // Unlock dating conversation
          await getOrCreateConversation(account.id, body.target_id)
          await unlockDating(account.id, body.target_id)

          // Notify both parties of new match
          await notify(account.id, 'new_match', {
            match_id: match.id,
            with_account_id: body.target_id,
          })
          await notify(body.target_id, 'new_match', {
            match_id: match.id,
            with_account_id: account.id,
          })

          return {
            matched: true,
            match: {
              id: match.id,
              account_a_id: match.accountAId,
              account_b_id: match.accountBId,
              status: match.status,
              created_at: match.createdAt.toISOString(),
            },
          }
        }
      }

      return { matched: false, match: null }
    },
    {
      auth: true,
      body: t.Object({
        target_id: t.String(),
        direction: t.Union([t.Literal('yes'), t.Literal('no')]),
      }),
      response: {
        200: t.Object({
          matched: t.Boolean(),
          match: t.Nullable(
            t.Object({
              id: t.String(),
              account_a_id: t.String(),
              account_b_id: t.String(),
              status: t.String(),
              created_at: t.String(),
            }),
          ),
        }),
        404: t.Object({ error: t.String() }),
        409: t.Object({ error: t.String() }),
        422: t.Object({ error: t.String() }),
      },
    },
  )

  // ── GET /dating/matches ─────────────────────────────────────────────────────
  .get(
    '/matches',
    async ({ account }) => {
      const myMatches = await db.query.matches.findMany({
        where: and(
          eq(matches.status, 'active'),
          or(eq(matches.accountAId, account.id), eq(matches.accountBId, account.id))!,
        ),
        orderBy: [desc(matches.createdAt)],
      })

      // Fetch other profiles in batch
      const otherIds = myMatches.map((m) =>
        m.accountAId === account.id ? m.accountBId : m.accountAId,
      )

      const profiles =
        otherIds.length > 0
          ? await db.query.datingProfiles.findMany({
              where: inArray(datingProfiles.accountId, otherIds),
            })
          : []

      const profileMap = new Map(profiles.map((p) => [p.accountId, p]))

      return myMatches.map((m) => {
        const otherId = m.accountAId === account.id ? m.accountBId : m.accountAId
        const otherProfile = profileMap.get(otherId) ?? null
        return {
          id: m.id,
          other_account_id: otherId,
          other_profile: otherProfile
            ? {
                first_name: otherProfile.firstName,
                bio: otherProfile.bio,
                open_to_multi: otherProfile.openToMulti,
                relationship_status: otherProfile.relationshipStatus,
                status_is_open: otherProfile.statusIsOpen,
                is_visible: otherProfile.isVisible,
              }
            : null,
          status: m.status,
          created_at: m.createdAt.toISOString(),
        }
      })
    },
    {
      auth: true,
      response: {
        200: t.Array(MatchShape),
      },
    },
  )

  // ── GET /dating/matches/:id ─────────────────────────────────────────────────
  .get(
    '/matches/:id',
    async ({ account, params, status }) => {
      const match = await db.query.matches.findFirst({
        where: eq(matches.id, params.id),
      })
      if (!match) return status(404, { error: 'Match not found' })

      const isParticipant = match.accountAId === account.id || match.accountBId === account.id
      if (!isParticipant) return status(403, { error: 'Not a participant in this match' })

      const otherId = match.accountAId === account.id ? match.accountBId : match.accountAId
      const otherProfile = await db.query.datingProfiles.findFirst({
        where: eq(datingProfiles.accountId, otherId),
      })

      return {
        id: match.id,
        other_account_id: otherId,
        other_profile: otherProfile
          ? {
              first_name: otherProfile.firstName,
              bio: otherProfile.bio,
              open_to_multi: otherProfile.openToMulti,
              relationship_status: otherProfile.relationshipStatus,
              status_is_open: otherProfile.statusIsOpen,
              is_visible: otherProfile.isVisible,
            }
          : null,
        status: match.status,
        created_at: match.createdAt.toISOString(),
      }
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      response: {
        200: MatchShape,
        403: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
      },
    },
  )

  // ── DELETE /dating/matches/:id ──────────────────────────────────────────────
  .delete(
    '/matches/:id',
    async ({ account, params, status, set }) => {
      const match = await db.query.matches.findFirst({
        where: eq(matches.id, params.id),
      })
      if (!match) return status(404, { error: 'Match not found' })

      const isParticipant = match.accountAId === account.id || match.accountBId === account.id
      if (!isParticipant) return status(403, { error: 'Not a participant in this match' })

      if (match.status === 'unmatched') {
        return status(409, { error: 'Match is already unmatched' })
      }

      const now = new Date()
      await db
        .update(matches)
        .set({ status: 'unmatched', unmatchedById: account.id, unmatchedAt: now })
        .where(eq(matches.id, params.id))

      // Relock dating conversation (set dating_unlocked_at = null)
      const [pairA, pairB] = orderedPair(match.accountAId, match.accountBId)
      await db
        .update(conversations)
        .set({ datingUnlockedAt: null })
        .where(and(eq(conversations.accountAId, pairA!), eq(conversations.accountBId, pairB!)))

      // Notify the other participant
      const otherId = match.accountAId === account.id ? match.accountBId : match.accountAId
      await notify(otherId, 'unmatch', { match_id: match.id, by_account_id: account.id })

      set.status = 204
      return
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      response: {
        204: t.Void(),
        403: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
        409: t.Object({ error: t.String() }),
      },
    },
  )

  // ── GET /dating/likes ───────────────────────────────────────────────────────
  .get(
    '/likes',
    async ({ account }) => {
      // Count incoming yes-swipes where current account hasn't swiped back yet
      const incomingYes = await db.query.swipes.findMany({
        where: and(eq(swipes.targetId, account.id), eq(swipes.direction, 'yes')),
        columns: { swiperId: true },
      })

      const incomingIds = incomingYes.map((s) => s.swiperId)
      if (incomingIds.length === 0) return { count: 0 }

      // Filter out those we've already swiped on
      const alreadySwiped = await db.query.swipes.findMany({
        where: and(eq(swipes.swiperId, account.id), inArray(swipes.targetId, incomingIds)),
        columns: { targetId: true },
      })
      const alreadySwipedIds = new Set(alreadySwiped.map((s) => s.targetId))

      const count = incomingIds.filter((id) => !alreadySwipedIds.has(id)).length
      return { count }
    },
    {
      auth: true,
      response: {
        200: t.Object({ count: t.Number() }),
      },
    },
  )
