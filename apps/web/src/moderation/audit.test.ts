// Unit tests for audit recording with a mocked db insert + captureServerEvent.

import { describe, expect, test } from 'bun:test'

import type { NewModerationVerdict } from '@nearest-neighbor/db'

import { recordVerdict } from './audit.ts'
import type { RecordVerdictDeps, RecordVerdictParams } from './audit.ts'

interface CapturedEvent {
  distinctId: string
  event: string
  properties: Record<string, unknown>
}

function harness(captureImpl?: () => never) {
  const inserted: NewModerationVerdict[] = []
  const events: CapturedEvent[] = []
  const db = {
    insert: () => ({
      values: (row: NewModerationVerdict) => {
        inserted.push(row)
        return Promise.resolve()
      },
    }),
  } as unknown as NonNullable<RecordVerdictDeps['db']>
  const capture = (distinctId: string, event: string, properties?: Record<string, unknown>) => {
    if (captureImpl) captureImpl()
    events.push({ distinctId, event, properties: properties ?? {} })
  }
  return { inserted, events, deps: { db, capture } satisfies RecordVerdictDeps }
}

const ALLOW: RecordVerdictParams = {
  accountId: 'acc-1',
  surface: 'post',
  decision: 'allow',
  model: 'omni-moderation-2024-09-26',
  flagged: false,
  topCategory: null,
  category: null,
  scores: { harassment: 0.01 },
  categories: { harassment: false },
  appliedInputTypes: { harassment: ['text'] },
  topScore: null,
}

describe('recordVerdict', () => {
  test('an allow writes exactly one row and emits moderation_checked', async () => {
    const { inserted, events, deps } = harness()
    await recordVerdict(ALLOW, deps)

    expect(inserted.length).toBe(1)
    expect(inserted[0]!.decision).toBe('allow')
    expect(inserted[0]!.accountId).toBe('acc-1')
    expect(inserted[0]!.scores).toEqual({ harassment: 0.01 })

    expect(events.length).toBe(1)
    expect(events[0]!.event).toBe('moderation_checked')
    expect(events[0]!.distinctId).toBe('acc-1')
  })

  test('a block writes one row and emits a metadata-only moderation_blocked', async () => {
    const { inserted, events, deps } = harness()
    await recordVerdict(
      {
        accountId: 'acc-2',
        surface: 'message',
        decision: 'block',
        model: 'omni-moderation-2024-09-26',
        flagged: true,
        topCategory: 'harassment',
        category: 'harassment',
        scores: { harassment: 0.42 },
        categories: { harassment: true },
        appliedInputTypes: { harassment: ['text'] },
        topScore: 0.42,
      },
      deps,
    )

    expect(inserted.length).toBe(1)
    expect(inserted[0]!.decision).toBe('block')
    expect(inserted[0]!.topCategory).toBe('harassment')

    expect(events.length).toBe(1)
    const e = events[0]!
    expect(e.event).toBe('moderation_blocked')
    expect(e.properties).toEqual({
      surface: 'message',
      decision: 'block',
      category: 'harassment',
      top_category: 'harassment',
      model: 'omni-moderation-2024-09-26',
      top_score: 0.42,
    })
  })

  test('an unavailable verdict stores model=null and emits moderation_unavailable', async () => {
    const { inserted, events, deps } = harness()
    await recordVerdict(
      {
        accountId: 'acc-3',
        surface: 'dating_bio',
        decision: 'unavailable',
        model: null,
        flagged: null,
        topCategory: null,
        category: null,
        scores: null,
        categories: null,
        appliedInputTypes: null,
        topScore: null,
      },
      deps,
    )

    expect(inserted.length).toBe(1)
    expect(inserted[0]!.model).toBeNull()
    expect(inserted[0]!.scores).toBeNull()
    expect(inserted[0]!.decision).toBe('unavailable')
    expect(events[0]!.event).toBe('moderation_unavailable')
  })

  test('a sexual/minors block stores null scores/categories and emits only surface + category', async () => {
    const { inserted, events, deps } = harness()
    await recordVerdict(
      {
        accountId: 'acc-4',
        surface: 'dating_photo',
        decision: 'block',
        model: 'omni-moderation-2024-09-26',
        flagged: true,
        topCategory: 'sexual/minors',
        category: 'sexual_minors',
        // Even if a caller passed scores, the carve-out must null them out.
        scores: { 'sexual/minors': 0.9 },
        categories: { 'sexual/minors': true },
        appliedInputTypes: { 'sexual/minors': ['text'] },
        topScore: 0.9,
        isSexualMinors: true,
      },
      deps,
    )

    const row = inserted[0]!
    expect(row.decision).toBe('block')
    expect(row.topCategory).toBe('sexual/minors')
    expect(row.flagged).toBe(true)
    expect(row.model).toBe('omni-moderation-2024-09-26')
    // Carve-out: no raw scores/categories/applied-types are stored.
    expect(row.scores).toBeNull()
    expect(row.categories).toBeNull()
    expect(row.appliedInputTypes).toBeNull()

    // Event carries ONLY surface + category — no score, no model, no content.
    expect(events[0]!.event).toBe('moderation_blocked')
    expect(events[0]!.properties).toEqual({ surface: 'dating_photo', category: 'sexual_minors' })
  })

  test('no analytics property carries moderated text or content', async () => {
    const { events, deps } = harness()
    await recordVerdict(ALLOW, deps)
    const keys = Object.keys(events[0]!.properties)
    for (const forbidden of ['text', 'input', 'content', 'body', 'art', 'ascii_image']) {
      expect(keys).not.toContain(forbidden)
    }
  })

  test('an analytics throw does not propagate and the row is still written', async () => {
    const { inserted, deps } = harness(() => {
      throw new Error('posthog exploded')
    })
    await expect(recordVerdict(ALLOW, deps)).resolves.toBeUndefined()
    expect(inserted.length).toBe(1)
  })
})
