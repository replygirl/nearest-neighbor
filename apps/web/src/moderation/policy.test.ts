// Unit tests for the binary threshold policy.

import { describe, expect, test } from 'bun:test'

import { config } from '../config.ts'
import { decide } from './policy.ts'

// Default thresholds (verified independently in config.test.ts).
const T = config.MODERATION_THRESHOLDS

describe('decide', () => {
  test('allows when every category is below threshold', () => {
    const d = decide({ harassment: 0.39, hate: 0.1 }, T)
    expect(d.decision).toBe('allow')
    expect(d.category).toBeUndefined()
    expect(d.topCategory).toBeUndefined()
    expect(d.isSexualMinors).toBe(false)
  })

  test('blocks when a score is exactly at the threshold (>= boundary)', () => {
    // harassment default threshold = 0.40
    const d = decide({ harassment: 0.4 }, T)
    expect(d.decision).toBe('block')
    expect(d.category).toBe('harassment')
    expect(d.topCategory).toBe('harassment')
    expect(d.isSexualMinors).toBe(false)
  })

  test('allows just below the threshold', () => {
    expect(decide({ harassment: 0.399 }, T).decision).toBe('allow')
  })

  test('allows high adult sexual content when sexual/minors is below threshold', () => {
    const d = decide({ sexual: 0.99, 'sexual/minors': 0.01 }, T)
    expect(d.decision).toBe('allow')
  })

  test('blocks a sexual/minors crossing and flags it for the runbook', () => {
    // sexual/minors default threshold = 0.15; adult sexual score is irrelevant.
    const d = decide({ sexual: 0.05, 'sexual/minors': 0.2 }, T)
    expect(d.decision).toBe('block')
    expect(d.category).toBe('sexual_minors')
    expect(d.topCategory).toBe('sexual/minors')
    expect(d.isSexualMinors).toBe(true)
  })

  test('surfaces the single highest-severity family on multiple crossings', () => {
    // hate/threatening (0.30 >= 0.25) outranks illicit (0.88 >= 0.85).
    const d = decide({ 'hate/threatening': 0.3, illicit: 0.88 }, T)
    expect(d.decision).toBe('block')
    expect(d.category).toBe('hate')
    expect(d.topCategory).toBe('hate/threatening')
    expect(d.isSexualMinors).toBe(false)
  })

  test('self-harm/instructions blocks; self-harm and self-harm/intent never block', () => {
    expect(decide({ 'self-harm/instructions': 0.3 }, T).decision).toBe('block')
    expect(decide({ 'self-harm': 0.99 }, T).decision).toBe('allow')
    expect(decide({ 'self-harm/intent': 0.99 }, T).decision).toBe('allow')
  })

  test('always-allow categories never block even at score 1', () => {
    expect(
      decide({ sexual: 1, violence: 1, 'violence/graphic': 1, 'self-harm': 1 }, T).decision,
    ).toBe('allow')
  })

  test('an env-tunable threshold changes the boundary', () => {
    const strict = { ...T, harassment: 0.2 }
    expect(decide({ harassment: 0.25 }, strict).decision).toBe('block')
    const loose = { ...T, harassment: 0.95 }
    expect(decide({ harassment: 0.25 }, loose).decision).toBe('allow')
  })

  test('a missing category key is treated as score 0', () => {
    expect(decide({}, T).decision).toBe('allow')
    const d = decide({ illicit: 0.9 }, T)
    expect(d.decision).toBe('block')
    expect(d.category).toBe('illicit')
    expect(d.topCategory).toBe('illicit')
  })
})
