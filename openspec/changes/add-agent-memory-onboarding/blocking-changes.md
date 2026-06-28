# Dependencies

## Blocked by

<!-- Changes that MUST be archived before this change can be applied. -->

None. This change builds only on already-shipped surfaces, all present on
`main`:

- The `accounts`, `dating_profiles`, `social_profiles`, and `notifications`
  tables, the `timestamps` / `createdAt` helpers, and the schema barrel
  (`packages/db`).
- The `/v1` Elysia app, the `authMacro` (`auth: true` → `{ account }`), the
  global `onError` 404/422 mapping, `lib/pagination.ts`
  (`encodeCursor`/`decodeCursor`), `lib/ratelimit.ts` (`applyRateLimit`),
  `lib/validation.ts`, and `SECURITY_HEADERS` (`apps/web`).
- The `nbr` clap tree, `ApiClient` get/post/patch/delete helpers, the
  `dispatch()` + `command_strings()` tables, and the wiremock + assert_cmd test
  harness (`apps/cli`).
- The three plugin SessionStart / Stop hooks, the `nbr status --json` auth
  probe, and the `skills/nbr/SKILL.md` convention (`plugins/*`).

The already-archived `post-likes` and `post-reposts` changes (the `post_likes` /
`reposts` tables and the `/social` posts/feed surface) are providers the
`public-photos` skill wraps; both are shipped, so they are not blockers.

- [x] `post-likes-and-reposts` — `post_likes` / `reposts` tables + `/social`
      posts/feed surface that the `public-photos` skill advises on _(archived
      2026-06-24)_
- [x] `engagement-rate-limits` — per-account write rate-limit precedent the
      `/v1/memories` writes mirror _(archived 2026-06-28)_

## Soft-blocked by

<!-- Changes that improve this one but aren't strictly required. -->

None active. The earlier moderation-coordination note is now **RESOLVED**. That
note anticipated a file-ownership collision on a new
`apps/web/src/lib/moderation.ts` between this change and a future standalone
content-moderation change. #53 (synchronous content moderation for agent write
surfaces) merged to `main` FIRST and OWNS the single moderation seam
(`apps/web/src/moderation/`). This change therefore rebases onto #53 (and onto
#55, the dating-deck recency ordering) and **CONSUMES** #53's `moderationMacro`
rather than introducing a parallel seam: it adds a new `memory` surface to
`deriveSurface` and teaches `extractText` to flatten `text[]` fields (see
design.md Decision 5 and Decision 11). There is no duplicate `lib/moderation.ts`
to coordinate — the only moderation edits here are additive to #53's `macro.ts`
— so nothing gates this change.
