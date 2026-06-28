// Binary block-or-allow policy.
//
// Every successful moderation response reduces to exactly one of two outcomes —
// `block` or `allow` — with no hold/review/soft tier (the end users are agents).
// A category contributes a block only when its raw score is >= its configured
// threshold. The five always-allow categories (sexual adult, violence,
// violence/graphic, self-harm, self-harm/intent) are intentionally absent from
// the severity order, so they never block under any threshold. When several
// categories cross, the single highest-severity one is surfaced.

/** Coarse snake_case family exposed to agents (the precise OpenAI sub-category is
 * never leaked — it would invite threshold-gaming). */
export type PublicCategory =
  | 'hate'
  | 'harassment'
  | 'sexual'
  | 'sexual_minors'
  | 'violence'
  | 'self_harm'
  | 'illicit'

export interface PolicyDecision {
  decision: 'allow' | 'block'
  /** Coarse public family of the surfaced category; present only on a block. */
  category?: PublicCategory
  /** Precise OpenAI category that crossed (for the audit `top_category`); block only. */
  topCategory?: string
  /** True iff the surfaced category is `sexual/minors` — drives the CSAM runbook. */
  isSexualMinors: boolean
}

// Fixed severity order, highest-severity first. self-harm/instructions is STRICT
// (harm-instruction is the most dangerous self-harm subtype) while discussion is
// preserved by leaving self-harm / self-harm/intent off this list entirely.
const SEVERITY_ORDER = [
  'sexual/minors',
  'hate/threatening',
  'harassment/threatening',
  'self-harm/instructions',
  'hate',
  'harassment',
  'illicit/violent',
  'illicit',
] as const

type ThresholdedCategory = (typeof SEVERITY_ORDER)[number]

const PUBLIC_FAMILY: Record<ThresholdedCategory, PublicCategory> = {
  'sexual/minors': 'sexual_minors',
  'hate/threatening': 'hate',
  'harassment/threatening': 'harassment',
  'self-harm/instructions': 'self_harm',
  hate: 'hate',
  harassment: 'harassment',
  'illicit/violent': 'illicit',
  illicit: 'illicit',
}

/**
 * Decide block-or-allow by thresholding the provider's raw `category_scores`.
 * A missing category key is treated as score 0. On multiple crossings the single
 * highest-severity category (per the fixed order) is surfaced.
 */
export function decide(
  scores: Readonly<Record<string, number>>,
  thresholds: Readonly<Record<string, number>>,
): PolicyDecision {
  for (const category of SEVERITY_ORDER) {
    const threshold = thresholds[category]
    if (threshold === undefined) continue
    const score = scores[category] ?? 0
    if (score >= threshold) {
      return {
        decision: 'block',
        category: PUBLIC_FAMILY[category],
        topCategory: category,
        isSexualMinors: category === 'sexual/minors',
      }
    }
  }
  return { decision: 'allow', isSexualMinors: false }
}
