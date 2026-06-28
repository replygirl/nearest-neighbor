// Unit tests for the sexual/minors runbook preservation + operator-alert gate.

import { describe, expect, test } from 'bun:test'

import { CSAM_MIN_RETENTION_DAYS, runCsamRunbook } from './preserve.ts'
import type { CsamPreservationRecord, CsamRunbookParams, OperatorAlertNotice } from './preserve.ts'

const SENTINEL = 'OFFENDING_CONTENT_SENTINEL_DO_NOT_LEAK'

const PARAMS: CsamRunbookParams = {
  surface: 'dating_photo',
  accountId: 'acc-9',
  model: 'omni-moderation-2024-09-26',
  payload: SENTINEL,
}

function mockStore() {
  const preserved: CsamPreservationRecord[] = []
  return {
    preserved,
    store: {
      preserve: async (record: CsamPreservationRecord) => {
        preserved.push(record)
      },
    },
  }
}

function mockAlerter() {
  const alerts: OperatorAlertNotice[] = []
  return {
    alerts,
    alerter: {
      alert: async (notice: OperatorAlertNotice) => {
        alerts.push(notice)
      },
    },
  }
}

describe('runCsamRunbook', () => {
  test('with the flag DISABLED (default config), invokes no preservation or alert', async () => {
    const { preserved, store } = mockStore()
    const { alerts, alerter } = mockAlerter()
    // No `enabled` passed → uses config default (false in the test environment).
    await runCsamRunbook(PARAMS, { store, alerter })
    expect(preserved.length).toBe(0)
    expect(alerts.length).toBe(0)
  })

  test('with the flag disabled and no store wired, is a clean no-op', async () => {
    await expect(runCsamRunbook(PARAMS, { enabled: false })).resolves.toBeUndefined()
  })

  test('with the flag ENABLED and a mock store + alerter, invokes both metadata-only', async () => {
    const { preserved, store } = mockStore()
    const { alerts, alerter } = mockAlerter()
    await runCsamRunbook(PARAMS, { enabled: true, store, alerter })

    expect(preserved.length).toBe(1)
    const record = preserved[0]!
    expect(record.surface).toBe('dating_photo')
    expect(record.accountId).toBe('acc-9')
    expect(record.retentionDays).toBeGreaterThanOrEqual(365)
    expect(record.retentionDays).toBe(CSAM_MIN_RETENTION_DAYS)

    expect(alerts.length).toBe(1)
    const notice = alerts[0]!
    expect(notice.category).toBe('sexual_minors')
    expect(notice.surface).toBe('dating_photo')
    expect(notice.accountId).toBe('acc-9')
    expect(notice.model).toBe('omni-moderation-2024-09-26')
    expect(typeof notice.detectedAt).toBe('string')
  })

  test('the operator alert notice carries NO offending content', async () => {
    const { store } = mockStore()
    const { alerts, alerter } = mockAlerter()
    await runCsamRunbook(PARAMS, { enabled: true, store, alerter })
    // The alert is metadata-only: the sentinel payload must not appear anywhere.
    expect(JSON.stringify(alerts[0])).not.toContain(SENTINEL)
    expect(Object.keys(alerts[0]!)).not.toContain('payload')
  })

  test('with the flag ENABLED but no store wired, fails loudly', async () => {
    await expect(runCsamRunbook(PARAMS, { enabled: true })).rejects.toThrow(
      /preservation store not provisioned/,
    )
  })

  test('with the flag ENABLED, a store but no alerter, also fails loudly', async () => {
    const { store } = mockStore()
    await expect(runCsamRunbook(PARAMS, { enabled: true, store })).rejects.toThrow(
      /preservation store not provisioned/,
    )
  })

  test('a preservation-store failure propagates and the alert is not attempted', async () => {
    const { alerts, alerter } = mockAlerter()
    const failingStore = {
      preserve: async () => {
        throw new Error('secure store write failed')
      },
    }
    await expect(
      runCsamRunbook(PARAMS, { enabled: true, store: failingStore, alerter }),
    ).rejects.toThrow(/secure store write failed/)
    // No fallback to persisting; the alert must not fire after a failed preserve.
    expect(alerts.length).toBe(0)
  })
})
