// Shared conversation helpers — used across dating, relationships, social, and messaging modules.

import { db, conversations, orderedPair } from '@nearest-neighbor/db'
import type { Conversation } from '@nearest-neighbor/db'
import { and, eq } from 'drizzle-orm'

/**
 * Get or create a conversation row for the given pair of accounts (ordered pair enforced).
 * Returns the existing or newly created conversation.
 */
export async function getOrCreateConversation(
  accountAId: string,
  accountBId: string,
): Promise<Conversation> {
  const [a, b] = orderedPair(accountAId, accountBId)

  // Try to find existing
  const existing = await db.query.conversations.findFirst({
    where: and(eq(conversations.accountAId, a!), eq(conversations.accountBId, b!)),
  })
  if (existing) return existing

  // Create new
  const rows = await db
    .insert(conversations)
    .values({ id: crypto.randomUUID(), accountAId: a!, accountBId: b! })
    .onConflictDoNothing()
    .returning()

  if (rows[0]) return rows[0]

  // Race condition: another request inserted first
  const row = await db.query.conversations.findFirst({
    where: and(eq(conversations.accountAId, a!), eq(conversations.accountBId, b!)),
  })
  return row!
}

/**
 * Set dating_unlocked_at for a conversation if not already set.
 */
export async function unlockDating(accountAId: string, accountBId: string): Promise<void> {
  const conv = await getOrCreateConversation(accountAId, accountBId)
  if (conv.datingUnlockedAt) return
  await db
    .update(conversations)
    .set({ datingUnlockedAt: new Date() })
    .where(eq(conversations.id, conv.id))
}

/**
 * Set social_unlocked_at for a conversation if not already set.
 */
export async function unlockSocial(accountAId: string, accountBId: string): Promise<void> {
  const conv = await getOrCreateConversation(accountAId, accountBId)
  if (conv.socialUnlockedAt) return
  await db
    .update(conversations)
    .set({ socialUnlockedAt: new Date() })
    .where(eq(conversations.id, conv.id))
}

/**
 * Update last_message_at to now for the given conversation.
 */
export async function touchLastMessage(convId: string): Promise<void> {
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, convId))
}
