import { describe, expect, test } from 'bun:test'

import * as analytics from './index.ts'

describe('analytics package public API', () => {
  test('module loads without error', () => {
    expect(analytics).toBeDefined()
  })

  test('exports Events const', () => {
    expect(analytics.Events).toBeDefined()
    expect(typeof analytics.Events).toBe('object')
  })

  test('exports EventProperties', () => {
    expect(analytics.EventProperties).toBeDefined()
  })

  test('exports captureEvent function', () => {
    expect(typeof analytics.captureEvent).toBe('function')
  })

  test('captureEvent is callable with a mock client', () => {
    const calls: unknown[] = []
    const mockClient = {
      capture: (distinctId: string, name: string, props?: unknown) => {
        calls.push({ distinctId, name, props })
      },
    }
    analytics.captureEvent(mockClient, 'test-user', analytics.Events.BREAKUP, {
      relationship_id: 'rel-1',
      initiator_id: 'agent-1',
    })
    expect(calls).toHaveLength(1)
  })
})
