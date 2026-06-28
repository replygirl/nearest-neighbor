## Why

The security-hardening pass added standard rate-limit response headers
(`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After`) to
the like, unlike, repost, and unrepost endpoints via the `applyRateLimit`
helper, but the post-likes and post-reposts specs do not record this observable
API contract. This change documents the headers so clients and spec consumers
can rely on them.

## What Changes

- **MODIFIED behavior (spec only)** `POST /v1/social/posts/:id/like` — now
  includes `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`
  headers on every response; additionally includes `Retry-After` (equal to
  `RateLimit-Reset`) on the `429`.
- **MODIFIED behavior (spec only)** `DELETE /v1/social/posts/:id/like` — same
  header contract.
- **MODIFIED behavior (spec only)** `POST /v1/social/posts/:id/repost` — same
  header contract.
- **MODIFIED behavior (spec only)** `DELETE /v1/social/posts/:id/repost` — same
  header contract.

Header format follows IETF draft-polli-ratelimit-headers-02. `RateLimit-Reset`
is a delta-second value (seconds until the window resets). `Retry-After` on a
429 equals `RateLimit-Reset`. No other behavioral or schema changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `post-likes`: like and unlike endpoints now declare rate-limit response
  headers as part of their observable API contract.
- `post-reposts`: repost and unrepost endpoints now declare rate-limit response
  headers as part of their observable API contract.

## Impact

**Affected packages and apps:**

- None — this is a spec-only documentation change. The headers are already
  emitted by `apps/web/src/lib/ratelimit.ts` (`applyRateLimit`). No code changes
  required.

**Files modified (spec only):**

- MODIFY `openspec/specs/post-likes/spec.md` (via delta in
  `openspec/changes/rate-limit-response-headers/specs/post-likes/spec.md`)
- MODIFY `openspec/specs/post-reposts/spec.md` (via delta in
  `openspec/changes/rate-limit-response-headers/specs/post-reposts/spec.md`)

**Backward compatibility:** Additive. Rate-limit headers are a new observable
contract; existing clients that ignore unknown headers are unaffected.

## Principles alignment

| Principle (openspec/principles.md)        | Stance   | Note                                                                                        |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| Synchronous notifications, no queue       | N/A      | No notification path involved.                                                              |
| Scope discipline                          | EMBODIES | Only the four engagement endpoints are touched; no schema, DB, or other route change.       |
| Additive, backward-compatible API changes | MEETS    | New headers are additive; no existing response fields are removed or altered.               |
| Spec before code                          | EMBODIES | Spec records already-shipped behavior so the contract is formally documented and queryable. |
