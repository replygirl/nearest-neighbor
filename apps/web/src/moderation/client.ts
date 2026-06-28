// OpenAI omni-moderation provider client.
//
// Calls POST https://api.openai.com/v1/moderations via a direct Bun `fetch`
// (NOT the OpenAI SDK, whose default timeout is 10 minutes), following the
// repo's external-HTTP style. The call is bounded by an AbortSignal.timeout per
// attempt and a small number of retries with exponential backoff. Any non-2xx,
// network error, malformed body, or timeout after the retries are exhausted is
// surfaced as a typed `ModerationUnavailable` so the macro can fail open and
// record an `unavailable` audit row.

import { config } from '../config.ts'

const MODERATION_URL = 'https://api.openai.com/v1/moderations'

/**
 * Thrown when the provider cannot produce a verdict (connection error, non-2xx,
 * malformed body, or timeout) after the bounded retries. The macro catches this
 * to fail open uniformly — it is never surfaced to the agent as a block.
 */
export class ModerationUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ModerationUnavailable'
  }
}

export interface ModerationResult {
  /** The model id the provider reported handling the request (for the audit row). */
  model: string
  /** The provider's stable top-level `flagged` boolean. */
  flagged: boolean
  /** The provider's stable per-category booleans (stored for version portability). */
  categories: Record<string, boolean>
  /** The raw per-category floats the binary policy thresholds against. */
  scores: Record<string, number>
  /** Which input modalities each category was applied to (text-only here). */
  appliedTypes: Record<string, string[]>
}

export interface ModerateOptions {
  apiKey?: string | undefined
  model?: string
  timeoutMs?: number
  maxRetries?: number
  /** Base backoff in ms (attempt N waits backoffBaseMs * 2^(N-1)). */
  backoffBaseMs?: number
  /** Injectable fetch for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

interface ModerationApiResponse {
  model?: string
  results?: Array<{
    flagged?: boolean
    categories?: Record<string, boolean>
    category_scores?: Record<string, number>
    category_applied_input_types?: Record<string, string[]>
  }>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function parseResponse(data: ModerationApiResponse, requestedModel: string): ModerationResult {
  const result = data.results?.[0]
  if (!result || typeof result.flagged !== 'boolean' || !result.category_scores) {
    throw new Error('moderation provider returned a malformed body')
  }
  return {
    model: data.model ?? requestedModel,
    flagged: result.flagged,
    categories: result.categories ?? {},
    scores: result.category_scores,
    appliedTypes: result.category_applied_input_types ?? {},
  }
}

/**
 * Screen a single text input against OpenAI omni-moderation. Resolves with the
 * parsed verdict on success; rejects with `ModerationUnavailable` on any outage
 * after the bounded retries.
 */
export async function moderate(
  input: string,
  options: ModerateOptions = {},
): Promise<ModerationResult> {
  const apiKey = options.apiKey ?? config.OPENAI_API_KEY_MODERATION
  const model = options.model ?? config.MODERATION_MODEL
  const timeoutMs = options.timeoutMs ?? config.MODERATION_REQUEST_TIMEOUT_MS
  const maxRetries = options.maxRetries ?? config.MODERATION_MAX_RETRIES
  const backoffBaseMs = options.backoffBaseMs ?? 250
  const fetchImpl = options.fetchImpl ?? fetch

  if (!apiKey) {
    // No dedicated key configured: treat as an outage so the macro fails open
    // and records an `unavailable` verdict, rather than calling unauthenticated.
    throw new ModerationUnavailable('OPENAI_API_KEY_MODERATION is not configured')
  }

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      await sleep(backoffBaseMs * 2 ** (attempt - 1))
    }
    try {
      const response = await fetchImpl(MODERATION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        lastError = new Error(`moderation provider responded ${response.status}`)
        continue
      }
      const data = (await response.json()) as ModerationApiResponse
      return parseResponse(data, model)
    } catch (error) {
      lastError = error
    }
  }

  throw new ModerationUnavailable('moderation provider unavailable after retries', {
    cause: lastError,
  })
}
