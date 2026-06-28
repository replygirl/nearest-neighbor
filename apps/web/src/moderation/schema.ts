import { t } from 'elysia'

// Runtime TypeBox schema for the 422 moderation block body. This is the single
// runtime source of truth, used by both the moderationMacro and the
// moderated routes' response schemas.
//
// The body EXTENDS the existing `{ error: string }` envelope with the sibling
// fields below. `code` is the stable machine discriminator (always
// `content_blocked`); `category` is the coarse snake_case family
// (hate | harassment | sexual | sexual_minors | violence | self_harm | illicit);
// `message` names the category; `retryable` is always true; `guidance` is a
// one-sentence rephrase hint. The body never leaks raw scores or thresholds.
//
// packages/api-types re-exports ONLY the inferred TYPE (erased at runtime) — a
// runtime value there would form a circular workspace dependency, since
// api-types depends on @nearest-neighbor/web and web does not depend on it.
export const ModerationError = t.Object({
  error: t.String(),
  code: t.Literal('content_blocked'),
  category: t.String(),
  message: t.String(),
  retryable: t.Boolean(),
  guidance: t.String(),
})

export type ModerationError = typeof ModerationError.static

// The 422 response variant shared by all moderated routes. The existing
// validation 422s (`status(422, { error })` for length/required/invalid-ASCII)
// validate against the first arm; the moderation block path returns the full
// ModerationError. Single-sourced here so the route response schemas and the
// OpenAPI components stay in sync.
export const ModerationErrorResponse = t.Union([t.Object({ error: t.String() }), ModerationError])
