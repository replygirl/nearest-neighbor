## Why

The security-hardening pass identified that the like, unlike, repost, and
unrepost endpoints had no per-account throttle. An
unauthenticated-to-authenticated account could flood the notification table —
writing a `new_post_like` or `new_repost` notification for each request — with
no back-pressure. Adding per-account fixed-window rate limits closes the
notification-flood vector and brings these four endpoints in line with the rest
of the social surface.

## What Changes

- **MODIFIED** `POST /v1/social/posts/:id/like` — now returns `429 { error }`
  and performs no DB write when the per-account fixed-window limit (120 requests
  / 60 s) is exceeded. No change to the happy-path response or behavior.
- **MODIFIED** `DELETE /v1/social/posts/:id/like` — same limit and 429 shape.
- **MODIFIED** `POST /v1/social/posts/:id/repost` — same limit and 429 shape.
- **MODIFIED** `DELETE /v1/social/posts/:id/repost` — same limit and 429 shape.

Rate limiting is in-memory (per instance), fixed-window, keyed on `account_id`.
Limits are: 120 requests per 60-second window on each of the four endpoints
(tracked with separate keys: `{id}:social:like`, `{id}:social:unlike`,
`{id}:social:repost`, `{id}:social:unrepost`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `post-likes`: like and unlike endpoints now enforce per-account rate limits;
  exceeding the limit returns 429 with no DB write or notification.
- `post-reposts`: repost and unrepost endpoints now enforce per-account rate
  limits; exceeding the limit returns 429 with no DB write or notification.

## Impact

**Affected packages and apps:**

- `apps/web` — `src/modules/social/index.ts` (four routes gain `isRateLimited`
  guard and a `429` response schema entry; `isRateLimited` was already
  imported).

**Files modified:**

- MODIFY `apps/web/src/modules/social/index.ts`

**Backward compatibility:** Additive. The 429 status is a new possible response
code on these four endpoints; all prior 2xx/4xx behavior is unchanged. Clients
that do not retry on 429 will observe a new failure mode, but the endpoints
continue to behave identically under the limit.

## Principles alignment

| Principle (openspec/principles.md)        | Stance   | Note                                                                                   |
| ----------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| Synchronous notifications, no queue       | N/A      | Rate limiting prevents excess notifications; does not change the notification path.    |
| Scope discipline                          | EMBODIES | Only the four engagement endpoints are touched; no schema, CLI, or other route change. |
| Additive, backward-compatible API changes | MEETS    | 429 is a new response code; happy-path is unchanged.                                   |
| Spec before code                          | EMBODIES | This proposal documents already-implemented limits so the spec tracks reality.         |
