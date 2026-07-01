// Status module — GET /status aggregate + GET/POST /notifications.

import {
  conversations,
  db,
  follows,
  matches,
  messages,
  notifications,
  relationships,
  swipes,
} from '@nearest-neighbor/db'
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { Elysia, t } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import { decodeCursor, encodeCursor } from '../../lib/pagination.ts'
import { applyRateLimit } from '../../lib/ratelimit.ts'

// ── Notification shape ───────────────────────────────────────────────────────

const NotificationShape = t.Object({
  id: t.String(),
  type: t.String(),
  payload: t.Any(),
  priority: t.String(),
  read_at: t.Nullable(t.String()),
  created_at: t.String(),
})

// ── Status shape ─────────────────────────────────────────────────────────────

const StatusShape = t.Object({
  unread_messages: t.Number(),
  new_likes: t.Number(),
  new_matches: t.Number(),
  new_followers: t.Number(),
  pending_relationships: t.Number(),
  elevated: t.Array(NotificationShape),
})

// ── Helper: compute status for an account ───────────────────────────────────

export async function computeStatus(accountId: string) {
  // Find last read_at of any notification — use as "seen" watermark.
  // Must exclude unread rows (read_at IS NULL): Postgres orders NULLS FIRST
  // under DESC, so without this filter any unread notification would surface
  // here with a null read_at, collapsing the watermark to null and firing the
  // "never read anything" count-all fallback below on every /status call.
  const lastReadNotif = await db.query.notifications.findFirst({
    where: and(eq(notifications.accountId, accountId), isNotNull(notifications.readAt)),
    orderBy: [desc(notifications.readAt)],
  })
  const lastReadAt = lastReadNotif?.readAt ?? null

  // Count unread messages across all conversations
  const myConvs = await db.query.conversations.findMany({
    where: or(eq(conversations.accountAId, accountId), eq(conversations.accountBId, accountId)),
  })

  let unreadMessages = 0
  for (const conv of myConvs) {
    const otherId = conv.accountAId === accountId ? conv.accountBId : conv.accountAId
    const unreadRows = await db.query.messages.findMany({
      where: and(
        eq(messages.conversationId, conv.id),
        eq(messages.senderId, otherId),
        isNull(messages.readAt),
      ),
    })
    unreadMessages += unreadRows.length
  }

  // Count incoming yes-swipes where the account hasn't swiped yet (new likes)
  const newLikesRows = await db.query.swipes.findMany({
    where: and(eq(swipes.targetId, accountId), eq(swipes.direction, 'yes')),
  })
  const swiperIds = newLikesRows.map((s) => s.swiperId)

  let newLikes = 0
  if (swiperIds.length > 0) {
    const mySwipesBack = await db.query.swipes.findMany({
      where: and(eq(swipes.swiperId, accountId), inArray(swipes.targetId, swiperIds)),
    })
    const alreadySwiped = new Set(mySwipesBack.map((s) => s.targetId))
    newLikes = swiperIds.filter((id) => !alreadySwiped.has(id)).length
  }

  // Count active matches involving the account created after the last-read
  // watermark (mirrors new_followers), or all active matches if no notification
  // has been read yet (lastReadAt is null).
  let newMatches = 0
  if (lastReadAt) {
    const newMatchRows = await db.query.matches.findMany({
      where: and(
        eq(matches.status, 'active'),
        or(eq(matches.accountAId, accountId), eq(matches.accountBId, accountId)),
        gt(matches.createdAt, lastReadAt),
      ),
    })
    newMatches = newMatchRows.length
  } else {
    const allMatchRows = await db.query.matches.findMany({
      where: and(
        eq(matches.status, 'active'),
        or(eq(matches.accountAId, accountId), eq(matches.accountBId, accountId)),
      ),
    })
    newMatches = allMatchRows.length
  }

  // Count new followers (followers created after last notification read, or all if never read)
  let newFollowers = 0
  if (lastReadAt) {
    const newFollowerRows = await db.query.follows.findMany({
      where: and(eq(follows.followeeId, accountId), gt(follows.createdAt, lastReadAt)),
    })
    newFollowers = newFollowerRows.length
  } else {
    const allFollowerRows = await db.query.follows.findMany({
      where: eq(follows.followeeId, accountId),
    })
    newFollowers = allFollowerRows.length
  }

  // Count pending relationship proposals where account is not the initiator
  const pendingRels = await db.query.relationships.findMany({
    where: and(
      eq(relationships.state, 'pending'),
      or(eq(relationships.accountAId, accountId), eq(relationships.accountBId, accountId)),
    ),
  })
  // Filter to ones where we're not the initiator (i.e. awaiting our response)
  const pendingRelationships = pendingRels.filter((r) => r.initiatorId !== accountId).length

  // Unread elevated notifications
  const elevatedRows = await db.query.notifications.findMany({
    where: and(
      eq(notifications.accountId, accountId),
      eq(notifications.priority, 'elevated'),
      isNull(notifications.readAt),
    ),
    orderBy: [desc(notifications.createdAt)],
  })

  const elevated = elevatedRows.map((n) => ({
    id: n.id,
    type: n.type,
    payload: n.payload,
    priority: n.priority,
    read_at: n.readAt?.toISOString() ?? null,
    created_at: n.createdAt.toISOString(),
  }))

  return {
    unread_messages: unreadMessages,
    new_likes: newLikes,
    new_matches: newMatches,
    new_followers: newFollowers,
    pending_relationships: pendingRelationships,
    elevated,
  }
}

// ── Module ───────────────────────────────────────────────────────────────────

export const statusModule = new Elysia({ name: 'status-module' })
  .use(authMacro)

  // GET /status — aggregate status summary
  .get(
    '/status',
    async ({ account, status, set }) => {
      if (applyRateLimit(set, `${account.id}:status:get`, 120, 60_000)) {
        return status(429, { error: 'Too many requests' })
      }
      return computeStatus(account.id)
    },
    {
      auth: true,
      response: {
        200: StatusShape,
        429: t.Object({ error: t.String() }),
      },
    },
  )

  // GET /notifications — paginated notification list
  .get(
    '/notifications',
    async ({ account, query }) => {
      const myId = account.id
      const limit = Math.min(query.limit ?? 30, 100)
      const cursor = query.cursor ? decodeCursor(query.cursor) : null

      const conditions = [eq(notifications.accountId, myId)]
      if (cursor) {
        conditions.push(
          or(
            lt(notifications.createdAt, new Date(cursor.createdAt)),
            and(
              eq(notifications.createdAt, new Date(cursor.createdAt)),
              lt(notifications.id, cursor.id),
            )!,
          )!,
        )
      }

      const rows = await db.query.notifications.findMany({
        where: and(...conditions),
        orderBy: [desc(notifications.createdAt), desc(notifications.id)],
        limit: limit + 1,
      })

      const hasMore = rows.length > limit
      const items = hasMore ? rows.slice(0, limit) : rows
      const lastItem = items[items.length - 1]
      const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null

      return {
        items: items.map((n) => ({
          id: n.id,
          type: n.type,
          payload: n.payload,
          priority: n.priority,
          read_at: n.readAt?.toISOString() ?? null,
          created_at: n.createdAt.toISOString(),
        })),
        next_cursor: nextCursor,
      }
    },
    {
      auth: true,
      query: t.Object({
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
      }),
      response: {
        200: t.Object({
          items: t.Array(NotificationShape),
          next_cursor: t.Nullable(t.String()),
        }),
      },
    },
  )

  // POST /notifications/read — mark notifications as read
  .post(
    '/notifications/read',
    async ({ account, body, set }) => {
      const myId = account.id
      const now = new Date()

      const hasAll = body.all === true
      const hasIds = Array.isArray(body.ids) && body.ids.length > 0
      if (!hasAll && !hasIds) {
        set.status = 400
        return { error: 'Provide `all: true` or a non-empty `ids` array' }
      }
      if (hasAll && hasIds) {
        set.status = 400
        return { error: '`all` and `ids` are mutually exclusive' }
      }

      if (body.all === true) {
        // Mark all unread notifications as read
        await db
          .update(notifications)
          .set({ readAt: now })
          .where(and(eq(notifications.accountId, myId), isNull(notifications.readAt)))
      } else if (body.ids && body.ids.length > 0) {
        // Mark specific notifications as read (only own ones)
        await db
          .update(notifications)
          .set({ readAt: now })
          .where(
            and(
              eq(notifications.accountId, myId),
              inArray(notifications.id, body.ids),
              isNull(notifications.readAt),
            ),
          )
      }

      set.status = 204
      return
    },
    {
      auth: true,
      body: t.Object({
        ids: t.Optional(t.Array(t.String(), { maxItems: 100 })),
        all: t.Optional(t.Boolean()),
      }),
      response: {
        204: t.Void(),
        400: t.Object({ error: t.String() }),
      },
    },
  )
