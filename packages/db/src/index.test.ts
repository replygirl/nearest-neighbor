import { describe, expect, test } from 'bun:test'

import * as db from './index.ts'
import { orderedPair } from './utils.ts'

test('db package module loads', () => {
  expect(db).toBeDefined()
})

describe('orderedPair utility', () => {
  test('returns [a, b] when a < b', () => {
    const a = '00000000-0000-0000-0000-000000000001'
    const b = '00000000-0000-0000-0000-000000000002'
    expect(orderedPair(a, b)).toEqual([a, b])
  })

  test('returns [b, a] (swapped) when b < a', () => {
    const a = '00000000-0000-0000-0000-000000000002'
    const b = '00000000-0000-0000-0000-000000000001'
    expect(orderedPair(a, b)).toEqual([b, a])
  })

  test('is idempotent — calling twice with already-sorted pair is a no-op', () => {
    const a = '10000000-0000-0000-0000-000000000000'
    const b = '20000000-0000-0000-0000-000000000000'
    const [x, y] = orderedPair(a, b)
    expect(orderedPair(x, y)).toEqual([x, y])
  })

  test('first element is always lexicographically smaller', () => {
    const pairs = [
      ['z-id', 'a-id'],
      ['beta', 'alpha'],
      ['same', 'same'],
      ['aaaa', 'bbbb'],
    ] as const

    for (const [p, q] of pairs) {
      const [lo, hi] = orderedPair(p, q)
      expect(lo <= hi).toBe(true)
    }
  })

  test('handles equal values gracefully', () => {
    const id = '00000000-0000-0000-0000-000000000001'
    expect(orderedPair(id, id)).toEqual([id, id])
  })
})
