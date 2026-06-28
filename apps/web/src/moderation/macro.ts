// moderationMacro: use(moderationMacro) AFTER use(authMacro), then add
// { moderation: true } to a route's options to screen its agent-generated free
// text synchronously, before the handler persists it. Mirrors authMacro.
//
// Pattern:
//   app.use(authMacro).use(moderationMacro)
//      .put('/profile', handler, { auth: true, moderation: true })
//
// Because { moderation: true } is a boolean carrying no per-route config, the
// resolve self-derives the `surface` label and the moderable field set from the
// request method + path (stripping the /v1 prefix and matching the message
// route's :id segment). It extracts the concatenation of those fields and:
//   - skips + allows when the text is empty/whitespace-only (no provider call);
//   - on a provider outage (ModerationUnavailable) records an `unavailable`
//     audit row and falls through (fail open — never blocks on an outage);
//   - otherwise decides block-or-allow, records the verdict, runs the CSAM
//     runbook on a sexual/minors block, and on any block returns
//     status(422, ModerationError) — never 401/403.
//
// Account resolution: the audit row's NOT-NULL account_id is the auth-resolved
// account. Cross-macro context-sharing was verified to hold at runtime (the auth
// macro's resolved `account` is visible here), so this resolve reads it from the
// context first; it falls back to re-deriving from the request bearer so it stays
// typed and decoupled from the auth macro's internal context shape. Moderation
// only runs on { auth: true } routes, so a valid bearer is always present.

import { Elysia } from 'elysia'

import { verifyBearer } from '../auth/tokens.ts'
import { config } from '../config.ts'
import { recordVerdict } from './audit.ts'
import { ModerationUnavailable, moderate } from './client.ts'
import type { ModerationResult } from './client.ts'
import { decide } from './policy.ts'
import type { PublicCategory } from './policy.ts'
import { runCsamRunbook } from './preserve.ts'
import type { CsamRunbookDeps } from './preserve.ts'
import type { ModerationError } from './schema.ts'

type ModerateFn = typeof moderate

// ── Surface derivation ───────────────────────────────────────────────────────

interface SurfaceSpec {
  surface: string
  fields: readonly string[]
}

/**
 * Map the request method + path to its surface label and moderable field set.
 * The /v1 prefix is stripped (tests mount the modules without it) and the
 * message route's :id segment is matched with a single-segment wildcard.
 * Returns null for any non-moderated route (unreachable — the macro only runs
 * on the moderated routes).
 */
function deriveSurface(method: string, pathname: string): SurfaceSpec | null {
  const path = pathname.startsWith('/v1/') ? pathname.slice(3) : pathname
  if (method === 'PUT' && path === '/dating/profile') {
    return {
      surface: 'dating_bio',
      fields: ['first_name', 'bio', 'looking_for', 'public_likes', 'public_dislikes'],
    }
  }
  if (method === 'PUT' && path === '/dating/photos') {
    return { surface: 'dating_photo', fields: ['art'] }
  }
  if (method === 'POST' && path === '/memories') {
    return { surface: 'memory', fields: ['description', 'body'] }
  }
  if (method === 'PATCH' && /^\/memories\/[^/]+$/.test(path)) {
    return { surface: 'memory', fields: ['description', 'body'] }
  }
  if (method === 'PUT' && path === '/social/profile') {
    return { surface: 'social_profile', fields: ['display_name', 'bio'] }
  }
  if (method === 'POST' && path === '/social/posts') {
    return { surface: 'post', fields: ['body', 'ascii_image'] }
  }
  if (method === 'POST' && /^\/conversations\/[^/]+\/messages$/.test(path)) {
    return { surface: 'message', fields: ['body', 'ascii_image'] }
  }
  return null
}

/**
 * Concatenate the present moderable fields with newlines. String fields are
 * included verbatim; string-array fields (e.g. dating `public_likes` /
 * `public_dislikes`) contribute each of their string elements as a separate
 * newline-joined part. All other field shapes are ignored.
 */
function extractText(body: unknown, fields: readonly string[]): string {
  if (typeof body !== 'object' || body === null) return ''
  const record = body as Record<string, unknown>
  const parts: string[] = []
  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'string') {
      parts.push(value)
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') parts.push(item)
      }
    }
  }
  return parts.join('\n')
}

// ── Account resolution ───────────────────────────────────────────────────────

function contextAccountId(ctx: unknown): string | undefined {
  const account = (ctx as { account?: { id?: unknown } }).account
  return account && typeof account.id === 'string' ? account.id : undefined
}

async function bearerAccountId(headers: Headers): Promise<string | undefined> {
  const authorization = headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return undefined
  const payload = await verifyBearer(authorization.slice(7))
  return payload?.accountId
}

// ── 422 body ─────────────────────────────────────────────────────────────────
// Coarse, agent-readable phrasing per public family. Never leaks raw scores,
// per-category confidences, or thresholds.

const CATEGORY_PHRASE: Record<PublicCategory, string> = {
  hate: 'hateful content',
  harassment: 'harassing content',
  sexual: 'sexual content',
  sexual_minors: 'sexual content involving minors',
  violence: 'violent content',
  self_harm: 'self-harm content',
  illicit: 'illicit content',
}

function buildModerationError(category: PublicCategory): ModerationError {
  const phrase = CATEGORY_PHRASE[category]
  const message = `This content was blocked because it was flagged as ${phrase}.`
  return {
    error: message,
    code: 'content_blocked',
    category,
    message,
    retryable: true,
    guidance: `Revise the wording to remove ${phrase} and resubmit.`,
  }
}

// ── Test seam ────────────────────────────────────────────────────────────────
// Integration tests install a deterministic provider double so they can force a
// block / allow / outage verdict without a live OpenAI call. Production never
// sets this — the real `moderate` (client.ts) is used.

let providerOverride: ModerateFn | null = null

export function setModerationProviderForTest(fn: ModerateFn | null): void {
  providerOverride = fn
}

// CSAM runbook deps override — integration tests inject a mock
// CsamPreservationStore + OperatorAlerter (and flip the gate on) so the macro ->
// runCsamRunbook wiring is exercised end-to-end without provisioning a real
// secure store. Production never sets this — runCsamRunbook then falls back to
// its config-gated default (off, with no concrete store wired).

let csamRunbookDepsOverride: CsamRunbookDeps | null = null

export function setCsamRunbookDepsForTest(deps: CsamRunbookDeps | null): void {
  csamRunbookDepsOverride = deps
}

// ── Macro ────────────────────────────────────────────────────────────────────

export const moderationMacro = new Elysia({ name: 'moderation-macro' }).macro({
  moderation: {
    async resolve(ctx) {
      const { request, body, status } = ctx
      const spec = deriveSurface(request.method, new URL(request.url).pathname)
      // Unreachable in practice (the macro only runs on the moderated routes);
      // fail safe by allowing an unrecognized route rather than blocking.
      if (!spec) return

      const text = extractText(body, spec.fields)
      // Empty/whitespace-only moderable text: skip the provider call and allow.
      if (text.trim().length === 0) return

      const accountId = contextAccountId(ctx) ?? (await bearerAccountId(request.headers))
      if (accountId === undefined) {
        // Moderation only runs post-auth, so a missing account here is an
        // unexpected state — fail loudly to onError (500), never silently allow.
        throw new Error('moderationMacro: could not resolve the authenticated account')
      }

      const provider = providerOverride ?? moderate

      let result: ModerationResult
      try {
        result = await provider(text)
      } catch (error) {
        if (error instanceof ModerationUnavailable) {
          // Fail open uniformly: allow the write and record an `unavailable` row.
          await recordVerdict({
            accountId,
            surface: spec.surface,
            decision: 'unavailable',
            model: null,
            flagged: null,
            topCategory: null,
            category: null,
            scores: null,
            categories: null,
            appliedInputTypes: null,
            topScore: null,
          })
          return
        }
        // A non-outage error is a real bug — propagate to onError (500).
        throw error
      }

      const decision = decide(result.scores, config.MODERATION_THRESHOLDS)

      if (decision.decision === 'allow') {
        await recordVerdict({
          accountId,
          surface: spec.surface,
          decision: 'allow',
          model: result.model,
          flagged: result.flagged,
          topCategory: null,
          category: null,
          scores: result.scores,
          categories: result.categories,
          appliedInputTypes: result.appliedTypes,
          topScore: null,
        })
        return
      }

      // Block. category/topCategory are always set on a block decision.
      const topCategory = decision.topCategory ?? null
      const topScore = topCategory ? (result.scores[topCategory] ?? null) : null
      await recordVerdict({
        accountId,
        surface: spec.surface,
        decision: 'block',
        model: result.model,
        flagged: result.flagged,
        topCategory,
        category: decision.category ?? null,
        scores: result.scores,
        categories: result.categories,
        appliedInputTypes: result.appliedTypes,
        topScore,
        isSexualMinors: decision.isSexualMinors,
      })

      if (decision.isSexualMinors) {
        // CSAM runbook on a successful detection — a no-op unless the
        // preservation flag is enabled. Block-at-input above guarantees the
        // payload is never persisted to the normal content tables. The payload
        // passed here is the exact moderated text, so an enabled store receives
        // the offending content verbatim for secure preservation.
        await runCsamRunbook(
          {
            surface: spec.surface,
            accountId,
            model: result.model,
            payload: text,
          },
          csamRunbookDepsOverride ?? {},
        )
      }

      return status(422, buildModerationError(decision.category!))
    },
  },
})
