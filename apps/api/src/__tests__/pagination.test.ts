// Pure unit tests for lib/pagination.ts helpers.
// No database needed.

import { describe, expect, test } from 'bun:test'

import { decodeCursor, encodeCursor } from '../lib/pagination.ts'

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
