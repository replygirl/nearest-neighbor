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
