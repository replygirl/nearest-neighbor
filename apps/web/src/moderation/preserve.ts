// Sexual/minors (CSAM) runbook — preservation + operator-alert seams.
//
// LEGAL: this is general information, not legal advice.
//
// CSAM possession/distribution is a federal crime with no Section 230 shield,
// and hosting it even in logs or audit JSON is itself criminal. The compliant
// path is block-at-input -> preserve (securely) -> report, keeping the content
// out of logs/analytics/audit JSON.
//
// In this change the ALWAYS-ON behavior is: (1) block at input so nothing is
// written to the normal content tables — handled by the macro returning a 422;
// (2) a metadata-only audit row — handled by `audit.recordVerdict` with the
// sexual/minors carve-out. Both are fully built and tested in this change.
//
// The DOWNSTREAM preservation + operator-alert delivery are expressed here as
// INJECTABLE interfaces, gated behind `MODERATION_CSAM_PRESERVATION_ENABLED`
// (default false). This change does NOT create a `csam_preservation` table or
// any concrete store — provisioning the genuinely sensitive CSAM-storage backend
// is deferred to the operator + counsel. When the flag is enabled but no
// concrete store/alert is wired (the state in this change), the runbook FAILS
// LOUDLY rather than silently host CSAM or silently drop the runbook obligation.

import { config } from '../config.ts'

// REPORT Act requires preservation for at least one year. 366 covers a leap year.
export const CSAM_MIN_RETENTION_DAYS = 366

export interface CsamPreservationRecord {
  /** Surface the block fired on (metadata). */
  surface: string
  /** Authenticated account id (metadata). */
  accountId: string
  /**
   * The offending payload. Preserved ONLY in the secure, access-restricted
   * store — it is NEVER written to content tables, logs, analytics, or audit
   * JSON.
   */
  payload: string
  /** Minimum retention; REPORT Act >= 1 year. */
  retentionDays: number
}

/**
 * Secure, access-restricted preservation store for a sexual/minors detection.
 * No concrete implementation exists in this change (deferred to operator +
 * counsel); any eventual store is constrained to Postgres by the project's "no
 * object storage" principle.
 */
export interface CsamPreservationStore {
  preserve(record: CsamPreservationRecord): Promise<void>
}

/**
 * Metadata-only notice for the operator alert. Carries NO offending content —
 * no payload, no text, no ASCII art.
 */
export interface OperatorAlertNotice {
  surface: string
  accountId: string
  category: 'sexual_minors'
  /** Provider model id for the detection (metadata). */
  model: string | null
  /** ISO timestamp of the detection (metadata). */
  detectedAt: string
}

/**
 * Delivers a metadata-only, elevated-priority, operator-polled alert to review
 * and file an NCMEC CyberTipline report (18 U.S.C. §2258A). No concrete channel
 * is provisioned in this change.
 */
export interface OperatorAlerter {
  alert(notice: OperatorAlertNotice): Promise<void>
}

export interface CsamRunbookParams {
  surface: string
  accountId: string
  model: string | null
  /** Offending payload — used ONLY for preservation when enabled; never logged. */
  payload: string
}

export interface CsamRunbookDeps {
  /** Defaults to `config.MODERATION_CSAM_PRESERVATION_ENABLED`. */
  enabled?: boolean
  store?: CsamPreservationStore
  alerter?: OperatorAlerter
  retentionDays?: number
  now?: () => Date
}

/**
 * The gated portion of the sexual/minors runbook: preserve + operator-alert.
 *
 * Block-at-input and the metadata-only audit row are handled upstream and are
 * ALWAYS on regardless of the flag. When the gate is off this is a no-op. When
 * the gate is on but no concrete store/alert is wired, it FAILS LOUDLY. When the
 * gate is on and both are wired, it preserves the payload (>= 1-year retention)
 * then delivers a metadata-only operator alert. A preservation failure
 * propagates (never falls back to persisting the content, never silently
 * dropped) and the alert is not attempted after a failed preservation.
 */
export async function runCsamRunbook(
  params: CsamRunbookParams,
  deps: CsamRunbookDeps = {},
): Promise<void> {
  const enabled = deps.enabled ?? config.MODERATION_CSAM_PRESERVATION_ENABLED
  if (!enabled) {
    // Gate off: block-at-input + metadata-only audit row already happened
    // upstream; attempt no preservation and no alert.
    return
  }

  const { store, alerter } = deps
  if (!store || !alerter) {
    throw new Error(
      'preservation store not provisioned: MODERATION_CSAM_PRESERVATION_ENABLED is set but no CsamPreservationStore/operator-alert implementation is wired',
    )
  }

  const retentionDays = deps.retentionDays ?? CSAM_MIN_RETENTION_DAYS
  const detectedAt = (deps.now?.() ?? new Date()).toISOString()

  await store.preserve({
    surface: params.surface,
    accountId: params.accountId,
    payload: params.payload,
    retentionDays,
  })

  await alerter.alert({
    surface: params.surface,
    accountId: params.accountId,
    category: 'sexual_minors',
    model: params.model,
    detectedAt,
  })
}
