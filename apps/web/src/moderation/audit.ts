// Moderation verdict audit + PostHog drift events.
//
// recordVerdict() writes exactly one `moderation_verdicts` row for every
// decision (allow/block/unavailable) and emits the matching PostHog drift event.
// The DB insert and the analytics client are injectable so the unit tests can
// assert on metadata-only arguments without a live DB or PostHog.
//
// Storage is metadata only — the table has no content column by design. The
// sexual/minors carve-out additionally leaves `scores`/`categories` null and the
// analytics event carries only `surface` + `category=sexual_minors`.

import { captureServerEvent } from '@nearest-neighbor/analytics/node'
import { db, moderationVerdicts } from '@nearest-neighbor/db'
import type { NewModerationVerdict } from '@nearest-neighbor/db'

export type AuditDecision = 'allow' | 'block' | 'unavailable'

export interface RecordVerdictParams {
  /** Authenticated account id — the analytics distinctId and the NOT-NULL FK. */
  accountId: string
  surface: string
  decision: AuditDecision
  /** Provider model id; null on an outage (`unavailable`). */
  model: string | null
  flagged: boolean | null
  /** Precise OpenAI category (audit `top_category`); null for allow/unavailable. */
  topCategory: string | null
  /** Coarse public family for the analytics event; null for allow/unavailable. */
  category: string | null
  scores: Record<string, number> | null
  categories: Record<string, boolean> | null
  appliedInputTypes: Record<string, string[]> | null
  /** Surfaced category's score for analytics; null when not applicable. */
  topScore: number | null
  /** True for a sexual/minors block — forces metadata-only storage + event. */
  isSexualMinors?: boolean
}

export interface RecordVerdictDeps {
  db?: Pick<typeof db, 'insert'>
  capture?: typeof captureServerEvent
}

function emitDriftEvent(
  capture: typeof captureServerEvent,
  params: RecordVerdictParams,
  isSexualMinors: boolean,
): void {
  const event =
    params.decision === 'block'
      ? 'moderation_blocked'
      : params.decision === 'unavailable'
        ? 'moderation_unavailable'
        : 'moderation_checked'

  // For sexual/minors carry ONLY surface + category — no score, no content. The
  // event name already encodes the block, so decision is omitted here.
  const properties: Record<string, unknown> = isSexualMinors
    ? { surface: params.surface, category: 'sexual_minors' }
    : { surface: params.surface, decision: params.decision }

  if (!isSexualMinors) {
    if (params.category !== null) properties['category'] = params.category
    if (params.topCategory !== null) properties['top_category'] = params.topCategory
    if (params.model !== null) properties['model'] = params.model
    if (params.topScore !== null) properties['top_score'] = params.topScore
  }

  // Analytics is best-effort: a PostHog failure MUST NOT change the verdict or
  // the HTTP response. This is a specific, expected carve-out (per the
  // drift-observability spec) — not a blanket swallow of infrastructure errors.
  try {
    capture(params.accountId, event, properties)
  } catch {
    // intentionally ignored — best-effort analytics
  }
}

/**
 * Persist one audit row for the decision and emit the matching drift event.
 * The DB insert is awaited and its errors propagate (a real infrastructure
 * failure, distinct from the provider-outage path). The analytics emit is
 * best-effort.
 */
export async function recordVerdict(
  params: RecordVerdictParams,
  deps: RecordVerdictDeps = {},
): Promise<void> {
  const database = deps.db ?? db
  const capture = deps.capture ?? captureServerEvent
  const isSexualMinors = params.isSexualMinors ?? false

  // CSAM carve-out: never store raw scores/categories/applied-types for a
  // sexual/minors block — store verdict metadata only.
  const scores = isSexualMinors ? null : params.scores
  const categories = isSexualMinors ? null : params.categories
  const appliedInputTypes = isSexualMinors ? null : params.appliedInputTypes

  const row: NewModerationVerdict = {
    accountId: params.accountId,
    surface: params.surface,
    decision: params.decision,
    model: params.model,
    flagged: params.flagged,
    topCategory: params.topCategory,
    scores,
    categories,
    appliedInputTypes,
  }

  await database.insert(moderationVerdicts).values(row)

  emitDriftEvent(capture, params, isSexualMinors)
}
