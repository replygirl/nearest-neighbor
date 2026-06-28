// Pure unit tests for lib/pagination.ts helpers.
// No database needed.

import { describe, expect, test } from 'bun:test'

import {
  decodeCursor,
  decodeDeckCursor,
  encodeCursor,
  encodeDeckCursor,
} from '../lib/pagination.ts'

describe('encodeCursor / decodeCursor round-trip', () => {
  test('encodes and decodes a valid cursor', () => {
    const date = new Date('2024-01-15T10:30:00.000Z')
    const id = 'abc-123-def'
    const cursor = encodeCursor(date, id)
    expect(typeof cursor).toBe('string')

    const decoded = decodeCursor(cursor)
    expect(decoded).not.toBeNull()
    expect(decoded!.id).toBe(id)
    expect(decoded!.createdAt).toBe(date.toISOString())
  })

  test('encodeCursor produces a base64 string', () => {
    const cursor = encodeCursor(new Date(), 'test-id')
    // base64 characters only (no special chars except = for padding, or +/)
    expect(/^[A-Za-z0-9+/=]+$/.test(cursor)).toBe(true)
  })

  test('decodeCursor returns null for invalid base64', () => {
    const result = decodeCursor('!!!not-valid-base64!!!')
    expect(result).toBeNull()
  })

  test('decodeCursor returns null for valid base64 but non-JSON content', () => {
    // base64 of "not json"
    const notJson = Buffer.from('this is not json').toString('base64')
    const result = decodeCursor(notJson)
    expect(result).toBeNull()
  })

  test('decodeCursor returns null for empty string', () => {
    const result = decodeCursor('')
    // empty base64 decodes to empty string which is not valid JSON
    expect(result).toBeNull()
  })

  test('multiple cursors are distinct for different inputs', () => {
    const d1 = new Date('2024-01-01T00:00:00.000Z')
    const d2 = new Date('2024-01-02T00:00:00.000Z')
    const c1 = encodeCursor(d1, 'id-1')
    const c2 = encodeCursor(d2, 'id-2')
    expect(c1).not.toBe(c2)
  })
})

describe('encodeDeckCursor / decodeDeckCursor round-trip', () => {
  test('round-trips with a non-null lastActiveAt', () => {
    const lastActiveAt = '2024-06-15'
    const createdAt = new Date('2024-01-15T10:30:00.000Z')
    const id = 'uuid-abc-123'
    const cursor = encodeDeckCursor(lastActiveAt, createdAt, id)
    expect(typeof cursor).toBe('string')

    const decoded = decodeDeckCursor(cursor)
    expect(decoded).not.toBeNull()
    expect(decoded!.lastActiveAt).toBe(lastActiveAt)
    expect(decoded!.createdAt).toBe(createdAt.toISOString())
    expect(decoded!.id).toBe(id)
  })

  test('round-trips with a null lastActiveAt (null is a valid value)', () => {
    const createdAt = new Date('2024-03-01T00:00:00.000Z')
    const id = 'uuid-null-active'
    const cursor = encodeDeckCursor(null, createdAt, id)

    const decoded = decodeDeckCursor(cursor)
    expect(decoded).not.toBeNull()
    expect(decoded!.lastActiveAt).toBeNull()
    expect(decoded!.createdAt).toBe(createdAt.toISOString())
    expect(decoded!.id).toBe(id)
  })

  test('produces a valid base64 string', () => {
    const cursor = encodeDeckCursor('2024-01-01', new Date(), 'some-id')
    expect(/^[A-Za-z0-9+/=]+$/.test(cursor)).toBe(true)
  })

  test('decodeDeckCursor returns null for corrupt base64', () => {
    expect(decodeDeckCursor('!!!not-base64!!!')).toBeNull()
  })

  test('decodeDeckCursor returns null for valid base64 but non-JSON', () => {
    const notJson = Buffer.from('not valid json').toString('base64')
    expect(decodeDeckCursor(notJson)).toBeNull()
  })

  test('decodeDeckCursor returns null for a legacy 2-tuple cursor (missing lastActiveAt key)', () => {
    // Old format: { createdAt, id } — lacks the lastActiveAt key entirely
    const legacy = Buffer.from(
      JSON.stringify({ createdAt: new Date().toISOString(), id: 'some-uuid' }),
    ).toString('base64')
    expect(decodeDeckCursor(legacy)).toBeNull()
  })

  test('decodeDeckCursor returns null for empty string', () => {
    expect(decodeDeckCursor('')).toBeNull()
  })
})
