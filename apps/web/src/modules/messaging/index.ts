// Messaging module — conversations list/get/messages/send/read/start-DM.
// Permission: mutual-follow OR recipient open_dms (for social DMs).
// Participants + >=1 context unlocked required to send messages.

import {
  conversations,
  db,
  follows,
  messages,
  relationships,
  socialProfiles,
} from '@nearest-neighbor/db'
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm'
import { Elysia, t } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import { getOrCreateConversation, touchLastMessage, unlockSocial } from '../../lib/conversations.ts'
import { notify } from '../../lib/notifications.ts'
import { decodeCursor, encodeCursor } from '../../lib/pagination.ts'
import { applyRateLimit } from '../../lib/ratelimit.ts'
import {
  MAX_BODY,
  PHOTO_MAX_LINE_LENGTH,
  PHOTO_MAX_LINES,
  isValidAsciiArt,
} from '../../lib/validation.ts'

// ── Shape helpers ────────────────────────────────────────────────────────────

const OtherShape = t.Object({
  handle: t.Nullable(t.String()),
  account_id: t.String(),
})

const ConversationShape = t.Object({
  id: t.String(),
  other: OtherShape,
  social_unlocked: t.Boolean(),
  dating_unlocked: t.Boolean(),
  last_message_at: t.Nullable(t.String()),
  unread_count: t.Number(),
})

const MessageShape = t.Object({
  id: t.String(),
  conversation_id: t.String(),
  sender_id: t.String(),
  body: t.String(),
  ascii_image: t.Nullable(t.String()),
  read_at: t.Nullable(t.String()),
  created_at: t.String(),
})

// ── Helper: resolve other account id in a conversation ──────────────────────

function otherAccountId(conv: { accountAId: string; accountBId: string }, myId: string): string {
  return conv.accountAId === myId ? conv.accountBId : conv.accountAId
}

// ── Helper: check mutual-follow ──────────────────────────────────────────────

async function isMutualFollow(a: string, b: string): Promise<boolean> {
  // Sequential to avoid concurrent connection exhaustion in PGlite / connection pools.
  const aFollowsB = await db.query.follows.findFirst({
    where: and(eq(follows.followerId, a), eq(follows.followeeId, b)),
  })
  if (!aFollowsB) return false
  const bFollowsA = await db.query.follows.findFirst({
    where: and(eq(follows.followerId, b), eq(follows.followeeId, a)),
  })
  return !!bFollowsA
}

// ── Helper: check if sender is recipient's active partner ────────────────────

async function isActivePartner(senderId: string, recipientId: string): Promise<boolean> {
  // Look for an active relationship between the two
  const rel = await db.query.relationships.findFirst({
    where: and(
      eq(relationships.state, 'active'),
      or(
        and(eq(relationships.accountAId, senderId), eq(relationships.accountBId, recipientId)),
        and(eq(relationships.accountAId, recipientId), eq(relationships.accountBId, senderId)),
      ),
    ),
  })
  return !!rel
}

// ── Helper: format message row ───────────────────────────────────────────────

function formatMessage(m: {
  id: string
  conversationId: string
  senderId: string
  body: string
  asciiImage: string | null
  readAt: Date | null
  createdAt: Date
}) {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    sender_id: m.senderId,
    body: m.body,
    ascii_image: m.asciiImage,
    read_at: m.readAt?.toISOString() ?? null,
    created_at: m.createdAt.toISOString(),
  }
}

// ── Helper: build conversation response ─────────────────────────────────────

async function buildConversationResponse(
  conv: {
    id: string
    accountAId: string
    accountBId: string
    socialUnlockedAt: Date | null
    datingUnlockedAt: Date | null
    lastMessageAt: Date | null
  },
  myId: string,
) {
  const otherId = otherAccountId(conv, myId)

  // Get other's social profile handle (may not exist)
  const otherProfile = await db.query.socialProfiles.findFirst({
    where: eq(socialProfiles.accountId, otherId),
  })

  // Count unread messages (sent by other, not yet read)
  const unreadRows = await db.query.messages.findMany({
    where: and(
      eq(messages.conversationId, conv.id),
      eq(messages.senderId, otherId),
      isNull(messages.readAt),
    ),
  })

  return {
    id: conv.id,
    other: {
      handle: otherProfile?.handle ?? null,
      account_id: otherId,
    },
    social_unlocked: !!conv.socialUnlockedAt,
    dating_unlocked: !!conv.datingUnlockedAt,
    last_message_at: conv.lastMessageAt?.toISOString() ?? null,
    unread_count: unreadRows.length,
  }
}

// ── Module ───────────────────────────────────────────────────────────────────

export const messagingModule = new Elysia({ prefix: '/conversations', name: 'messaging-module' })
  .use(authMacro)

  // GET /conversations — list all conversations for authenticated account
  .get(
    '/',
    async ({ account }) => {
      const myId = account.id

      const convRows = await db.query.conversations.findMany({
        where: or(eq(conversations.accountAId, myId), eq(conversations.accountBId, myId)),
        orderBy: [desc(conversations.lastMessageAt), desc(conversations.createdAt)],
      })

      const items = await Promise.all(convRows.map((c) => buildConversationResponse(c, myId)))
      return items
    },
    {
      auth: true,
      response: {
        200: t.Array(ConversationShape),
      },
    },
  )

  // POST /conversations — start or retrieve a social DM conversation
  .post(
    '/',
    async ({ account, body, status, set }) => {
      const myId = account.id

      if (applyRateLimit(set, `${myId}:messaging:create-conv`, 20, 60_000)) {
        return status(429, { error: 'Too many requests' })
      }

      // Resolve the other account id
      let otherId: string | null = null

      if ('account_id' in body && body.account_id) {
        otherId = body.account_id
      } else if ('handle' in body && body.handle) {
        const profile = await db.query.socialProfiles.findFirst({
          where: eq(socialProfiles.handle, body.handle),
        })
        if (!profile) return status(404, { error: 'Profile not found' })
        otherId = profile.accountId
      }

      if (!otherId) return status(400, { error: 'Must provide handle or account_id' })
      if (otherId === myId)
        return status(400, { error: 'Cannot start a conversation with yourself' })

      // Check permission: mutual-follow OR recipient open_dms
      // Sequential to avoid concurrent connection exhaustion (PGlite / pool).
      const mutualFollow = await isMutualFollow(myId, otherId)
      const recipientProfile = await db.query.socialProfiles.findFirst({
        where: eq(socialProfiles.accountId, otherId),
      })

      if (!mutualFollow && !recipientProfile?.openDms) {
        return status(403, { error: 'Not permitted: require mutual follow or recipient open_dms' })
      }

      // Get or create the conversation and unlock social context
      const conv = await getOrCreateConversation(myId, otherId)
      await unlockSocial(myId, otherId)

      // Return fresh conv (with unlocked timestamp)
      const freshConv = await db.query.conversations.findFirst({
        where: eq(conversations.id, conv.id),
      })

      return buildConversationResponse(freshConv!, myId)
    },
    {
      auth: true,
      body: t.Object({
        handle: t.Optional(t.String()),
        account_id: t.Optional(t.String()),
      }),
      response: {
        200: ConversationShape,
        400: t.Object({ error: t.String() }),
        403: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
        429: t.Object({ error: t.String() }),
      },
    },
  )

  // GET /conversations/:id — get a single conversation
  .get(
    '/:id',
    async ({ account, params, status }) => {
      const myId = account.id

      const conv = await db.query.conversations.findFirst({
        where: eq(conversations.id, params.id),
      })

      if (!conv) return status(404, { error: 'Conversation not found' })
      if (conv.accountAId !== myId && conv.accountBId !== myId) {
        return status(403, { error: 'Not a participant' })
      }

      return buildConversationResponse(conv, myId)
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      response: {
        200: ConversationShape,
        403: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
      },
    },
  )

  // GET /conversations/:id/messages — paginated message list
  .get(
    '/:id/messages',
    async ({ account, params, query, status }) => {
      const myId = account.id

      const conv = await db.query.conversations.findFirst({
        where: eq(conversations.id, params.id),
      })

      if (!conv) return status(404, { error: 'Conversation not found' })
      if (conv.accountAId !== myId && conv.accountBId !== myId) {
        return status(403, { error: 'Not a participant' })
      }

      const limit = Math.min(query.limit ?? 30, 100)
      const cursor = query.cursor ? decodeCursor(query.cursor) : null

      const conditions = [eq(messages.conversationId, params.id)]
      if (cursor) {
        conditions.push(
          or(
            lt(messages.createdAt, new Date(cursor.createdAt)),
            and(eq(messages.createdAt, new Date(cursor.createdAt)), lt(messages.id, cursor.id))!,
          )!,
        )
      }

      const rows = await db.query.messages.findMany({
        where: and(...conditions),
        orderBy: [desc(messages.createdAt), desc(messages.id)],
        limit: limit + 1,
      })

      const hasMore = rows.length > limit
      const items = hasMore ? rows.slice(0, limit) : rows
      const lastItem = items[items.length - 1]
      const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null

      return {
        items: items.map(formatMessage),
        next_cursor: nextCursor,
      }
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      query: t.Object({
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
      }),
      response: {
        200: t.Object({
          items: t.Array(MessageShape),
          next_cursor: t.Nullable(t.String()),
        }),
        403: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
      },
    },
  )

  // POST /conversations/:id/messages — send a message
  .post(
    '/:id/messages',
    async ({ account, params, body, status, set }) => {
      const myId = account.id

      if (applyRateLimit(set, `${myId}:messaging:send`, 60, 60_000)) {
        return status(429, { error: 'Too many requests' })
      }

      if (body.body.length < 1 || body.body.length > MAX_BODY) {
        return status(400, { error: `Body must be 1-${MAX_BODY} characters` })
      }

      if (body.ascii_image != null && !isValidAsciiArt(body.ascii_image)) {
        return status(422, {
          error: `ASCII image must be at most ${PHOTO_MAX_LINES} lines of at most ${PHOTO_MAX_LINE_LENGTH} characters each`,
        })
      }

      const conv = await db.query.conversations.findFirst({
        where: eq(conversations.id, params.id),
      })

      if (!conv) return status(404, { error: 'Conversation not found' })
      if (conv.accountAId !== myId && conv.accountBId !== myId) {
        return status(403, { error: 'Not a participant' })
      }

      // Require at least one context to be unlocked
      if (!conv.socialUnlockedAt && !conv.datingUnlockedAt) {
        return status(403, { error: 'No conversation context unlocked' })
      }

      const recipientId = otherAccountId(conv, myId)

      // Insert message
      const msgRows = await db
        .insert(messages)
        .values({
          id: crypto.randomUUID(),
          conversationId: conv.id,
          senderId: myId,
          body: body.body,
          asciiImage: body.ascii_image ?? null,
        })
        .returning()

      const msg = msgRows[0]!

      // Update conversation last_message_at
      await touchLastMessage(conv.id)

      // Notify recipient — elevated if sender is recipient's active partner
      const isPartner = await isActivePartner(myId, recipientId)
      await notify(
        recipientId,
        'new_message',
        { conversation_id: conv.id, message_id: msg.id, sender_id: myId },
        isPartner ? 'elevated' : 'normal',
      )

      return formatMessage(msg)
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      body: t.Object({
        body: t.String({ minLength: 1 }),
        ascii_image: t.Optional(t.String({ maxLength: 4000 })),
      }),
      response: {
        200: MessageShape,
        400: t.Object({ error: t.String() }),
        403: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
        422: t.Object({ error: t.String() }),
        429: t.Object({ error: t.String() }),
      },
    },
  )

  // POST /conversations/:id/read — mark all messages from other as read
  .post(
    '/:id/read',
    async ({ account, params, status, set }) => {
      const myId = account.id

      const conv = await db.query.conversations.findFirst({
        where: eq(conversations.id, params.id),
      })

      if (!conv) return status(404, { error: 'Conversation not found' })
      if (conv.accountAId !== myId && conv.accountBId !== myId) {
        return status(403, { error: 'Not a participant' })
      }

      const otherId = otherAccountId(conv, myId)

      // Mark all messages from other as read
      await db
        .update(messages)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(messages.conversationId, conv.id),
            eq(messages.senderId, otherId),
            isNull(messages.readAt),
          ),
        )

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
      },
    },
  )
