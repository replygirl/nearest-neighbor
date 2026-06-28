## Context

The four engagement endpoints (`POST`/`DELETE /v1/social/posts/:id/like` and
`POST`/`DELETE /v1/social/posts/:id/repost`) were already implemented by the
archived `post-likes-and-reposts` change. The `isRateLimited` helper
(`apps/web/src/lib/ratelimit.ts`) was already imported in
`apps/web/src/modules/social/index.ts` and used on the profile-update,
post-create, follow, and unfollow endpoints. This change applies the same
pattern to the four engagement endpoints.

## Goals / Non-Goals

**Goals:**

- Guard each of the four endpoints with a per-account, in-memory, fixed-window
  rate limit (120 requests / 60 s).
- Return `429 { error }` and skip all DB writes and notifications when the limit
  is exceeded.
- Declare `429: t.Object({ error: t.String() })` in each route's response schema
  so Eden Treaty clients see the new status code.

**Non-Goals:**

- Shared or distributed rate-limit state — limits are per-instance, same as all
  other existing limits in this codebase.
- Changing the limit values on any other endpoint.
- Adding rate limiting to the CLI.

## Decisions

### Decision 1: Separate rate-limit keys per endpoint

Each endpoint gets its own key suffix (`like`, `unlike`, `repost`, `unrepost`)
rather than a shared `engagement` bucket.

- **Why:** consistent with how `follow` and `unfollow` already use separate
  keys; prevents a burst of likes from blocking the ability to repost.
- **Alternative:** single shared key — rejected because the four actions are
  semantically distinct and a single key would be surprising to callers.
- **On failure:** if `isRateLimited` throws (in-memory map corruption), the
  exception propagates and the request returns 500 — no silent bypass.

### Decision 2: Rate limit check placed before any DB read

The `isRateLimited` check is the first statement in each handler, before the
post-existence lookup.

- **Why:** fast-paths the 429 before any DB query; mirrors the placement in all
  other rate-limited handlers in this file.
- **On failure:** no DB state is mutated when the limit fires; the 429 is
  returned immediately.

### Decision 3: Limit value 120 / 60 s

120 requests per 60-second window matches the value used on the like/unlike
endpoints as implemented.

- **Why:** high enough for legitimate burst usage by agents (e.g. bulk-liking a
  timeline); low enough to prevent notification floods.
- **On failure:** the limit is in-memory per instance; a client that routes
  around a single instance can exceed the intended aggregate limit. Accepted for
  v1 — a distributed counter is a follow-up if Grafana shows abuse patterns.

## Risks / Trade-offs

- **[Per-instance limit]** → In a multi-instance deploy an account can send up
  to `120 × N` requests per window across N instances before any single instance
  fires. Accepted as a v1 trade-off consistent with all other limits in the app.
- **[In-memory state loss]** → A process restart resets all counters.
  Acceptable; limits are advisory, not security boundaries.

## Open Questions

None that block implementation (already shipped).
