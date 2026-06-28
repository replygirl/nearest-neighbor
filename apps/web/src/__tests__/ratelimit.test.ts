// Unit tests for lib/ratelimit.ts — checkRateLimit and applyRateLimit.
// No database or network needed.

import { afterEach, describe, expect, test } from 'bun:test'

import { applyRateLimit, checkRateLimit, clearRateLimitState } from '../lib/ratelimit.ts'

afterEach(() => {
  clearRateLimitState()
})

describe('checkRateLimit', () => {
  test('remaining decrements with each call', () => {
    const r1 = checkRateLimit('test:1', 5, 60_000)
    expect(r1.remaining).toBe(4)

    const r2 = checkRateLimit('test:1', 5, 60_000)
    expect(r2.remaining).toBe(3)

    const r3 = checkRateLimit('test:1', 5, 60_000)
    expect(r3.remaining).toBe(2)
  })

  test('remaining never goes below 0', () => {
    const max = 2
    const key = 'test:clamp'

    for (let i = 0; i < 10; i++) {
      const result = checkRateLimit(key, max, 60_000)
      expect(result.remaining).toBeGreaterThanOrEqual(0)
    }
  })

  test('limited is false until max is exceeded', () => {
    const max = 3
    const key = 'test:limited'

    expect(checkRateLimit(key, max, 60_000).limited).toBe(false) // 1st
    expect(checkRateLimit(key, max, 60_000).limited).toBe(false) // 2nd
    expect(checkRateLimit(key, max, 60_000).limited).toBe(false) // 3rd — exactly at max
    expect(checkRateLimit(key, max, 60_000).limited).toBe(true) // 4th — over max
    expect(checkRateLimit(key, max, 60_000).limited).toBe(true) // 5th — still over
  })

  test('limited is false on the exact max-th request', () => {
    const max = 1
    const key = 'test:exact'

    const r1 = checkRateLimit(key, max, 60_000)
    expect(r1.limited).toBe(false) // count == max → not limited

    const r2 = checkRateLimit(key, max, 60_000)
    expect(r2.limited).toBe(true) // count > max → limited
  })

  test('resetSeconds is a positive integer within the window', () => {
    const windowMs = 60_000
    const result = checkRateLimit('test:reset', 10, windowMs)

    expect(Number.isInteger(result.resetSeconds)).toBe(true)
    expect(result.resetSeconds).toBeGreaterThan(0)
    expect(result.resetSeconds).toBeLessThanOrEqual(windowMs / 1000)
  })

  test('windowSeconds matches the provided windowMs rounded', () => {
    expect(checkRateLimit('test:ws-60', 10, 60_000).windowSeconds).toBe(60)
    expect(checkRateLimit('test:ws-120', 10, 120_000).windowSeconds).toBe(120)
  })

  test('limit field always equals the provided max', () => {
    const result = checkRateLimit('test:limit-field', 42, 60_000)
    expect(result.limit).toBe(42)
  })

  test('independent keys do not share state', () => {
    checkRateLimit('key:a', 5, 60_000)
    checkRateLimit('key:a', 5, 60_000)

    const b = checkRateLimit('key:b', 5, 60_000)
    expect(b.remaining).toBe(4) // key:b is fresh
  })
})

describe('applyRateLimit', () => {
  function makeSet() {
    return { headers: {} as Record<string, string> }
  }

  test('writes RateLimit-Limit in policy form on every call', () => {
    const set = makeSet()
    applyRateLimit(set, 'rl:policy', 120, 60_000)

    expect(set.headers['RateLimit-Limit']).toBe('120, 120;w=60')
  })

  test('writes RateLimit-Remaining and it decrements', () => {
    const set1 = makeSet()
    applyRateLimit(set1, 'rl:decrement', 5, 60_000)
    expect(set1.headers['RateLimit-Remaining']).toBe('4')

    const set2 = makeSet()
    applyRateLimit(set2, 'rl:decrement', 5, 60_000)
    expect(set2.headers['RateLimit-Remaining']).toBe('3')
  })

  test('writes RateLimit-Reset as a string integer', () => {
    const set = makeSet()
    applyRateLimit(set, 'rl:reset', 10, 60_000)

    const reset = set.headers['RateLimit-Reset']
    expect(typeof reset).toBe('string')
    expect(Number.isInteger(Number(reset))).toBe(true)
    expect(Number(reset)).toBeGreaterThan(0)
  })

  test('does NOT emit Retry-After while under the limit', () => {
    const max = 5
    const key = 'rl:no-retry'

    for (let i = 0; i < max; i++) {
      const set = makeSet()
      const limited = applyRateLimit(set, key, max, 60_000)
      expect(limited).toBe(false)
      expect(set.headers['Retry-After']).toBeUndefined()
    }
  })

  test('emits Retry-After equal to RateLimit-Reset once limited', () => {
    const max = 2
    const key = 'rl:retry'

    // exhaust the limit
    applyRateLimit(makeSet(), key, max, 60_000)
    applyRateLimit(makeSet(), key, max, 60_000)

    // now limited
    const set = makeSet()
    const limited = applyRateLimit(set, key, max, 60_000)

    expect(limited).toBe(true)
    expect(set.headers['Retry-After']).toBe(set.headers['RateLimit-Reset'])
    expect(set.headers['Retry-After']).not.toBeUndefined()
  })

  test('returns false when under the limit', () => {
    const set = makeSet()
    expect(applyRateLimit(set, 'rl:false', 10, 60_000)).toBe(false)
  })

  test('returns true when over the limit', () => {
    const key = 'rl:true'
    const max = 1

    applyRateLimit(makeSet(), key, max, 60_000) // 1st — at limit, not over
    const set = makeSet()
    expect(applyRateLimit(set, key, max, 60_000)).toBe(true) // 2nd — over
  })

  test('RateLimit-Remaining never appears as negative in headers', () => {
    const max = 1
    const key = 'rl:no-neg'

    for (let i = 0; i < 5; i++) {
      const set = makeSet()
      applyRateLimit(set, key, max, 60_000)
      expect(Number(set.headers['RateLimit-Remaining'])).toBeGreaterThanOrEqual(0)
    }
  })
})
