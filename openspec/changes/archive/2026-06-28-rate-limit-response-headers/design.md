## Context

The four engagement endpoints (`POST`/`DELETE /v1/social/posts/:id/like` and
`POST`/`DELETE /v1/social/posts/:id/repost`) were rate-limited by the archived
`engagement-rate-limits` change via the `applyRateLimit` helper in
`apps/web/src/lib/ratelimit.ts`. That helper emits three headers on every
response and a fourth on 429 — but the post-likes and post-reposts specs did not
record this observable contract. This change closes the documentation gap with
no code modifications.

## Goals / Non-Goals

**Goals:**

- Add spec requirements declaring that `RateLimit-Limit`, `RateLimit-Remaining`,
  and `RateLimit-Reset` (delta-seconds) are set on every response from the four
  endpoints, and that `Retry-After` (equal to `RateLimit-Reset`) is additionally
  set on the `429`.
- Comply with IETF draft-polli-ratelimit-headers-02 (the standard the
  implementation already targets).

**Non-Goals:**

- Code changes — `applyRateLimit` already emits the correct headers; no
  modification is needed.
- Changing limit values or window sizes.
- Documenting rate-limit headers on any endpoints outside this capability set.

## Decisions

### Decision 1: ADDED rather than MODIFIED for the header requirements

The header behavior is additive to the existing rate-limit requirements. The
prior spec (from `engagement-rate-limits`) documented the 429 threshold and
error body; it did not describe any response headers. Adding a new `## ADDED`
requirement keeps the delta clean and avoids reproducing the full prior
requirement block under `## MODIFIED`.

- **Why:** The existing per-account rate-limit requirement is unchanged in
  meaning; headers are an orthogonal concern. ADDED avoids content drift.
- **Alternative:** MODIFIED with the full block — rejected; it duplicates
  content unnecessarily and risks introducing mismatches.
- **On failure:** If the archive merge incorrectly merges the ADDED requirement,
  the resulting spec still describes correct behavior since both the ADDED
  header text and the prior MODIFIED text would be present.

### Decision 2: RateLimit-Reset is delta-seconds, not a Unix timestamp

`applyRateLimit` sets `RateLimit-Reset` to `Math.ceil((resetAt - now) / 1000)`,
which is seconds remaining in the current window. IETF
draft-polli-ratelimit-headers-02 permits both formats; delta-seconds is the
simpler client contract and matches the implementation.

- **Why:** Consistent with the implementation; simpler for clients to consume
  without clock synchronization.
- **Alternative:** Unix timestamp (`Date` format) — not used by the
  implementation and harder for clients without synchronized clocks.
- **On failure:** No code impact; this is a spec-documentation decision.

## Risks / Trade-offs

- **[Spec-only change]** → No code risk. If `applyRateLimit` is later refactored
  to change header names or values, this spec becomes stale; that would surface
  as a future spec violation requiring a new change.

## Open Questions

None — the headers are already emitted. This change is documentation only.
