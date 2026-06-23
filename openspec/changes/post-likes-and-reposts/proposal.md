## Why

The town-square feed mock renders `♥` like counts and `↺` repost counts on every
post (design gaps #8 and #9), but there is **no backing for either**. Replies
exist (`posts.reply_to_id`), yet there is no `post_likes` table and no `reposts`
table — so feed engagement metrics are pure fiction. The existing `new_like`
notification is a **dating-swipe** event and must never be conflated with liking
a post. The `nbr` noun-verb taxonomy already reserves
`nbr posts like/unlike/ repost/unrepost` for this work, so the CLI surface is
pre-named and waiting.

## What Changes

- **NEW** `post_likes` table — one row per (account, post) like,
  `UNIQUE(account_id, post_id)`.
- **NEW** `reposts` table — one row per (account, post) repost,
  `UNIQUE(account_id, post_id)`.
- **NEW** endpoints under the existing `/social` surface:
  - `POST /social/posts/:id/like` — like a post (idempotent).
  - `DELETE /social/posts/:id/like` — remove a like (idempotent).
  - `POST /social/posts/:id/repost` — repost a post (idempotent).
  - `DELETE /social/posts/:id/repost` — undo a repost (idempotent).
- **MODIFIED** post + feed + discover responses gain `like_count`,
  `repost_count`, `reply_count`, `liked_by_me`, `reposted_by_me`. The
  single-post and by-handle list responses gain the same fields. **BREAKING**
  for any client that pins the exact `PostResponse` shape (additive fields only;
  no fields removed or renamed).
- **NEW** repost feed-boost semantics: a repost surfaces the original post in a
  follower's `/social/feed`, attributed to the reposter (`reposted_by` handle +
  `reposted_at`), ranked by repost time. `/social/discover` is **unaffected**
  (it stays a pure recency stream of original posts).
- **NEW** notification types `new_post_like` and `new_repost`, written
  synchronously via the existing `notify()` helper — never reusing dating
  `new_like`.
- **NEW** CLI commands `nbr posts like|unlike|repost|unrepost <post_id>`,
  matching the reserved taxonomy.
- **SCOPE**: likes and reposts are in scope. They introduce **no** comments and
  **no** mentions (both remain out of scope per CLAUDE.md). Replies are
  unchanged.

## Capabilities

### New Capabilities

- `post-likes`: liking and unliking town-square posts, like counts,
  `liked_by_me`, and the `new_post_like` notification.
- `post-reposts`: reposting and un-reposting town-square posts, repost counts,
  `reposted_by_me`, feed-boost surfacing with reposter attribution, and the
  `new_repost` notification.

### Modified Capabilities

<!-- No existing capability has a spec.md in openspec/specs/ yet (the directory is
     empty except .gitkeep), so post/feed response-shape changes are documented as
     ADDED requirements within the new capabilities rather than as delta specs
     against a non-existent base. -->

None.

## Impact

**Affected packages and apps:**

- `packages/db` — new `post-likes.ts` and `reposts.ts` schema files; re-export
  in `schema/index.ts`; generated migration.
- `apps/web` — `src/modules/social/index.ts` (new routes, count aggregation,
  response-shape changes, feed boost); `src/lib/notifications.ts` (no change —
  the helper already accepts any enum value).
- `packages/db/src/schema/notifications.ts` — extend `notification_type` enum
  with `new_post_like` and `new_repost`. **BREAKING** at the DB enum level
  (additive enum values; safe additive migration).
- `packages/api-types` — re-exports `App`; the shape change flows through Eden
  Treaty automatically. No hand-written type edits required beyond the server.
- `apps/cli` — `src/cli.rs` (4 new `Commands` variants + arg structs),
  `src/commands/social.rs` (4 handlers), `src/client.rs` (4 client methods),
  `src/models.rs` (request/response structs), dispatch in `src/lib.rs`.

**Files created or modified:**

- CREATE `packages/db/src/schema/post-likes.ts`
- CREATE `packages/db/src/schema/reposts.ts`
- MODIFY `packages/db/src/schema/index.ts`
- MODIFY `packages/db/src/schema/notifications.ts`
- CREATE `packages/db/drizzle/<generated>_post_likes_reposts.sql` (generated)
- MODIFY `apps/web/src/modules/social/index.ts`
- MODIFY `apps/cli/src/cli.rs`
- MODIFY `apps/cli/src/commands/social.rs`
- MODIFY `apps/cli/src/client.rs`
- MODIFY `apps/cli/src/models.rs`
- MODIFY `apps/cli/src/lib.rs`

**Backward compatibility:** Additive-only. New tables, new endpoints, new enum
values, new response fields, new CLI commands. No existing endpoint, column, or
command is removed or renamed. Response-shape additions are non-breaking for
permissive clients but flagged **BREAKING** for any client asserting an exact
`PostResponse` schema.

## Principles alignment

| Principle (openspec/principles.md)        | Stance   | Note                                                                                             |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| Synchronous notifications, no queue       | EMBODIES | `new_post_like` / `new_repost` written inline via `notify()`, same as `new_follower`.            |
| No object storage                         | N/A      | Likes/reposts are relational rows; no blobs.                                                     |
| Scope discipline                          | EMBODIES | Only likes/reposts; no comments, no mentions; replies untouched.                                 |
| Distinct domains stay distinct            | EMBODIES | Post likes get their own type, never reusing dating `new_like`.                                  |
| Additive, backward-compatible API changes | MEETS    | New routes + additive fields; the one shape caveat is called out as BREAKING for strict clients. |
| Spec before code                          | EMBODIES | This proposal precedes any schema/route/CLI implementation.                                      |
