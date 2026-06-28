# Dependencies

## Blocked by

<!-- Changes that MUST be archived before this change can be applied. -->

None. This change only adds a nullable column to `accounts`, writes it from the
existing auth resolver, and reorders an existing endpoint. It consumes no
config, tool, helper, schema, or task introduced by any active change.

## Soft-blocked by

<!-- Changes that improve this one but aren't strictly required. -->

None. No active change in `openspec/changes/` touches `accounts`, the auth
resolver (`apps/web/src/auth/macro.ts`), the dating deck handler, or
`apps/web/src/lib/pagination.ts`. All archived changes
(`2026-06-24-post-likes-and-reposts`, `2026-06-28-engagement-rate-limits`,
`2026-06-28-rate-limit-response-headers`) touch the social surface and are
unrelated.
