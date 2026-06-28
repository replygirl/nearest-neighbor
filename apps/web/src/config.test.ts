import { afterEach, describe, expect, test } from 'bun:test'

import { config, parseThreshold } from './config.ts'

describe('parseThreshold', () => {
  const KEY = 'MODERATION_THRESHOLD_TEST_ONLY'
  afterEach(() => {
    delete process.env[KEY]
  })

  test('returns the fallback when the env var is unset', () => {
    delete process.env[KEY]
    expect(parseThreshold(KEY, 0.42)).toBe(0.42)
  })

  test('parses a valid float override in [0, 1]', () => {
    process.env[KEY] = '0.7'
    expect(parseThreshold(KEY, 0.42)).toBe(0.7)
  })

  test('accepts the boundaries 0 and 1', () => {
    process.env[KEY] = '0'
    expect(parseThreshold(KEY, 0.42)).toBe(0)
    process.env[KEY] = '1'
    expect(parseThreshold(KEY, 0.42)).toBe(1)
  })

  test('falls back on an unparseable value', () => {
    process.env[KEY] = 'not-a-number'
    expect(parseThreshold(KEY, 0.42)).toBe(0.42)
  })

  test('falls back on an out-of-range value', () => {
    process.env[KEY] = '1.5'
    expect(parseThreshold(KEY, 0.42)).toBe(0.42)
    process.env[KEY] = '-0.1'
    expect(parseThreshold(KEY, 0.42)).toBe(0.42)
  })
})

describe('moderation config defaults', () => {
  test('surfaces the dedicated key var, pinned model, and bounds', () => {
    expect('OPENAI_API_KEY_MODERATION' in config).toBe(true)
    expect(config.MODERATION_MODEL).toBe('omni-moderation-2024-09-26')
    expect(config.MODERATION_REQUEST_TIMEOUT_MS).toBe(3000)
    expect(config.MODERATION_MAX_RETRIES).toBe(2)
    expect(config.MODERATION_CSAM_PRESERVATION_ENABLED).toBe(false)
  })

  test('has the eight per-category thresholds at their documented defaults', () => {
    expect(config.MODERATION_THRESHOLDS).toEqual({
      'sexual/minors': 0.15,
      'hate/threatening': 0.25,
      'harassment/threatening': 0.25,
      'self-harm/instructions': 0.25,
      hate: 0.35,
      harassment: 0.4,
      'illicit/violent': 0.75,
      illicit: 0.85,
    })
  })
})
