function resolveJwtSecret(): string {
  const secret = process.env['JWT_SECRET']
  if (!secret) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('JWT_SECRET must be set in production')
    }
    return 'dev-secret-do-not-use-in-prod'
  }
  return secret
}

// Content moderation is mandatory and cannot run without a dedicated bearer key,
// so the key is required in EVERY environment and the app refuses to boot when it
// is unset. This is the misconfiguration guard, distinct from a provider outage:
// a missing key fails loudly here; a transient outage (timeout/5xx/network/
// malformed body) still fails open in the client.
export function requireModerationKey(): string {
  const key = process.env['OPENAI_API_KEY_MODERATION']
  if (!key) {
    throw new Error(
      'OPENAI_API_KEY_MODERATION must be set — content moderation is mandatory and cannot run without it. ' +
        'Set it in mise.local.toml locally and as a secret in CI and every deployed environment. ' +
        '(A provider outage fails open; a missing key fails loudly.)',
    )
  }
  return key
}

// Parse a per-category moderation threshold from the environment. Each threshold
// is a float in [0, 1]; a missing or unparseable value falls back to the listed
// default rather than disabling the category.
export function parseThreshold(envName: string, fallback: number): number {
  const raw = process.env[envName]
  if (raw === undefined) return fallback
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback
  return parsed
}

export const config = Object.freeze({
  PORT: Number(process.env['PORT'] ?? 8080),
  JWT_SECRET: resolveJwtSecret(),
  JWT_TTL_SECONDS: Number(process.env['JWT_TTL_SECONDS'] ?? 3600),
  WEB_URL: process.env['WEB_URL'] ?? 'http://localhost:3000',
  POSTHOG_KEY: process.env['POSTHOG_KEY'],
  POSTHOG_HOST: process.env['POSTHOG_HOST'],

  // ── Moderation ──────────────────────────────────────────────────────────────
  // Dedicated moderation-only bearer key (NOT the generic OPENAI_API_KEY).
  // Required in every environment: the app fails to boot if this is unset. A
  // provider outage fails open; a missing key fails loudly.
  OPENAI_API_KEY_MODERATION: requireModerationKey(),
  // Pinned snapshot so scores do not drift silently; a model bump is a conscious
  // recalibration, not a surprise.
  MODERATION_MODEL: process.env['MODERATION_MODEL'] ?? 'omni-moderation-2024-09-26',
  MODERATION_REQUEST_TIMEOUT_MS: Number(process.env['MODERATION_REQUEST_TIMEOUT_MS'] ?? 3000),
  MODERATION_MAX_RETRIES: Number(process.env['MODERATION_MAX_RETRIES'] ?? 2),
  // Gates the CSAM preservation + operator-alert seams (default off). Block-at-
  // input and the metadata-only audit row are always on regardless of this flag.
  MODERATION_CSAM_PRESERVATION_ENABLED:
    process.env['MODERATION_CSAM_PRESERVATION_ENABLED'] === 'true',
  // Per-category block thresholds keyed by the raw OpenAI category. A category
  // contributes a block only when its score is >= its threshold. The five
  // always-allow categories (sexual adult, violence, violence/graphic,
  // self-harm, self-harm/intent) are intentionally absent.
  MODERATION_THRESHOLDS: Object.freeze({
    'sexual/minors': parseThreshold('MODERATION_THRESHOLD_SEXUAL_MINORS', 0.15),
    'hate/threatening': parseThreshold('MODERATION_THRESHOLD_HATE_THREATENING', 0.25),
    'harassment/threatening': parseThreshold('MODERATION_THRESHOLD_HARASSMENT_THREATENING', 0.25),
    'self-harm/instructions': parseThreshold('MODERATION_THRESHOLD_SELF_HARM_INSTRUCTIONS', 0.25),
    hate: parseThreshold('MODERATION_THRESHOLD_HATE', 0.35),
    harassment: parseThreshold('MODERATION_THRESHOLD_HARASSMENT', 0.4),
    'illicit/violent': parseThreshold('MODERATION_THRESHOLD_ILLICIT_VIOLENT', 0.75),
    illicit: parseThreshold('MODERATION_THRESHOLD_ILLICIT', 0.85),
  }),
})

export type ApplicationConfig = typeof config
export type ModerationThresholds = ApplicationConfig['MODERATION_THRESHOLDS']
