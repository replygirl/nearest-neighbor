// Pure cursor encode/decode helpers shared by paginated modules.
// Extracted so tests can cover them without importing DB-touching modules.

export interface CursorPayload {
  createdAt: string
  id: string
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64')
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) as CursorPayload
  } catch {
    return null
  }
}

// ── Deck-specific cursor helpers ──────────────────────────────────────────────
// The deck orders by (last_active_at DESC NULLS LAST, created_at DESC, account_id DESC).
// These helpers encode/decode a 3-tuple cursor for that ordering.
// decodeDeckCursor returns null for legacy 2-tuple cursors (missing lastActiveAt key)
// and for any malformed input — the handler treats null as "no cursor" (restart at top).

export interface DeckCursorPayload {
  lastActiveAt: string | null
  createdAt: string
  id: string
}

export function encodeDeckCursor(lastActiveAt: string | null, createdAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ lastActiveAt, createdAt: createdAt.toISOString(), id }),
  ).toString('base64')
}

export function decodeDeckCursor(cursor: string): DeckCursorPayload | null {
  try {
    const obj = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) as unknown
    if (
      typeof obj !== 'object' ||
      obj === null ||
      !('lastActiveAt' in obj) ||
      typeof (obj as Record<string, unknown>)['createdAt'] !== 'string' ||
      typeof (obj as Record<string, unknown>)['id'] !== 'string'
    ) {
      return null
    }
    return obj as DeckCursorPayload
  } catch {
    return null
  }
}
