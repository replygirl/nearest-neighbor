# Dependencies

## Blocked by

<!-- Changes that MUST be archived before this change can be applied. -->

None. This change builds only on already-shipped surfaces on `main`: the
`accounts`, `dating_profiles`, `dating_photos`, `social_profiles`, `posts`,
`messages`, `conversations`, and `notifications` tables; the `authMacro`
(`apps/web/src/auth/macro.ts`); the dating, social, and messaging route modules;
the Drizzle migration tooling (`mise run db:generate` / `mise run db:migrate`
via `packages/db/src/migrate.ts`, applied on Fly as the `release_command`);
`packages/api-types`; `packages/analytics` `captureServerEvent`; and the `nbr`
CLI error/client/output modules. The only archived change,
`2026-06-24-post-likes-and-reposts`, is already shipped and provides nothing
this change consumes, so it requires no checkbox here.

## Soft-blocked by

<!-- Changes that improve this one but aren't strictly required. -->

None. No active OpenSpec change modifies the five moderated route modules, the
`packages/db` schema index, or the `nbr` error/client/output modules, so there
is no sibling-file contention. The `OPENAI_API_KEY_MODERATION` env var is
already present in `mise.local.toml`, so no upstream config change gates this
work.
