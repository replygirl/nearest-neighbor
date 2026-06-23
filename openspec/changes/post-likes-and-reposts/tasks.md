## 1. Database schema

- [x] 1.1 Create `packages/db/src/schema/post-likes.ts` defining `post_likes`
      (`id` uuid PK, `account_id` FK→accounts cascade, `post_id` FK→posts
      cascade, `created_at`), `UNIQUE(account_id, post_id)`, index on `post_id`.
- [x] 1.2 Create `packages/db/src/schema/reposts.ts` defining `reposts` (same
      columns), `UNIQUE(account_id, post_id)`, index on `post_id` and on
      `(account_id, created_at)`.
- [x] 1.3 Add both files to `packages/db/src/schema/index.ts` re-exports.
- [x] 1.4 Extend the `notification_type` pgEnum in
      `packages/db/src/schema/notifications.ts` with `new_post_like` and
      `new_repost` (appended after the existing nine values).
- [x] 1.5 Generate the migration: `mise run db:generate`. - Verify: the new
      migration SQL contains `CREATE TABLE "post_likes"`,
      `CREATE TABLE "reposts"`, two `ALTER TYPE "notification_type" ADD VALUE`
      statements, and the two unique constraints.
- [ ] 1.6 Apply the migration against the local DB: `mise run db:migrate`. -
      Verify: command exits 0; `\d post_likes` and `\d reposts` show the unique
      constraint and FKs. (No live DB available; migration file generated and
      verified correct.)
- [x] 1.7 Extend `packages/db/src/schema/schema.test.ts` /
      `schema-introspection.test.ts` to assert the two tables, their unique
      constraints, cascade FKs, and the two new enum values exist. - Verify:
      `mise run test --filter @nearest-neighbor/db` passes.

## 2. Like / unlike endpoints

- [x] 2.1 In `apps/web/src/modules/social/index.ts`, add
      `POST /social/posts/:id/like`: 404 if post missing/deleted; insert with
      `onConflictDoNothing`; notify author with `new_post_like` only on a real
      insert and only when liker ≠ author; return `{ liked: true, like_count }`.
- [x] 2.2 Add `DELETE /social/posts/:id/like`: delete the row (idempotent);
      return `{ liked: false, like_count }`; never delete notifications.
- [x] 2.3 Add the TypeBox response schemas (`LikeResponse`) to the module.
- [x] 2.4 Add tests in
      `apps/web/src/modules/social/social-likes-reposts.test.ts` covering: first
      like (201-equivalent 200 + notification), idempotent re-like (no dup row,
      no dup notification), like own post (row created, no self-notification),
      unauthenticated 401, missing-post 404, unlike, idempotent unlike,
      remove-then-readd second notification. - Verify:
      `mise run test --filter @nearest-neighbor/web` passes.

## 3. Repost / unrepost endpoints

- [x] 3.1 Add `POST /social/posts/:id/repost` mirroring 2.1 with `new_repost`,
      returning `{ reposted: true, repost_count }`.
- [x] 3.2 Add `DELETE /social/posts/:id/repost` mirroring 2.2, returning
      `{ reposted: false, repost_count }`.
- [x] 3.3 Add the `RepostResponse` TypeBox schema.
- [x] 3.4 Add repost endpoint tests symmetric to 2.4 (first repost +
      notification, idempotent, self-repost no-notify, 401, 404, undo,
      idempotent undo, re-repost second notification). - Verify:
      `mise run test --filter @nearest-neighbor/web` passes.

## 4. Counts and viewer state on post responses

- [x] 4.1 Extend `PostResponse` (and `formatPost`) with `like_count`,
      `repost_count`, `reply_count`, `liked_by_me`, `reposted_by_me`.
- [x] 4.2 Single-post (`GET /social/posts/:id`) and create-post responses
      compute the three counts and (when authed) the two viewer-state booleans;
      `liked_by_me`/`reposted_by_me` are `false` when unauthenticated.
- [x] 4.3 Feed, discover, and by-handle list responses batch-load counts and
      viewer-state by `post_id IN (...)` into `Map`s (no N+1), mirroring the
      existing handle-batching.
- [x] 4.4 Add tests asserting the five fields appear with correct values on
      single-post, feed, discover, and by-handle responses, and that
      `liked_by_me`/`reposted_by_me` are `false` for unauthenticated discover. -
      Verify: `mise run test --filter @nearest-neighbor/web` passes.

## 5. Repost feed boost

- [x] 5.1 Modify `GET /social/feed` to union original followee posts with
      boosted posts from followees' reposts; boosted items carry `reposted_by`,
      `reposted_by_account_id`, `reposted_at`; order by unified
      `(sort_time, id)`; keep keyset-cursor pagination working.
- [x] 5.2 Ensure original (non-boost) feed items leave `reposted_by*` null and
      `GET /social/discover` remains repost-agnostic.
- [x] 5.3 Add tests: boost appears in follower's feed with attribution and
      `reposted_at` ordering; original items have null attribution; discover
      lists a many-reposted post once with no attribution; undoing a repost
      removes the boost; a single reposter yields no duplicate boost entries. -
      Verify: `mise run test --filter @nearest-neighbor/web` passes.

## 6. CLI commands

- [x] 6.1 Add four `Commands` variants + arg structs (`post_id: String`) to
      `apps/cli/src/cli.rs`: `posts like|unlike|repost|unrepost <post_id>`.
- [x] 6.2 Add request/response structs to `apps/cli/src/models.rs`
      (`LikeResponse { liked, like_count }`,
      `RepostResponse { reposted, repost_count }`).
- [x] 6.3 Add four `ApiClient` methods to `apps/cli/src/client.rs`
      (`like_post`/`unlike_post` → `POST`/`DELETE /social/posts/:id/like`;
      `repost_post`/`unrepost_post` → `…/repost`), mapping non-2xx to
      `NbrError::ApiError` as `delete_post` does.
- [x] 6.4 Add four handlers in `apps/cli/src/commands/social.rs` printing the
      state + count (and raw JSON under `--json`); wire dispatch in
      `apps/cli/src/lib.rs`.
- [ ] 6.5 Add CLI tests / snapshot updates for the four commands and regenerate
      the `--usage` KDL and completions if snapshotted. - Verify:
      `mise run test` (Rust suite) passes; `nbr posts like <id> --json` prints
      `{"liked":true,...}`.

## 7. Verification gate

- [x] 7.1 `mise run lint` exits 0 and `mise run format:check` (or
      `mise run format`) reports no diff.
- [x] 7.2 `mise run typecheck` exits 0 (tsgo --noEmit clean).
- [x] 7.3 `mise run test:coverage` exits 0 and meets the 95% coverage gate.
- [x] 7.4 `mise run check` (full CI gate) exits 0.

## 8. Spec review (run before /opsx:apply)

The five reviewer agents are read-only Claude Code subagents defined in
`.claude/agents/openspec-review-*.md`. The implementing agent runs each via the
Agent tool with the matching `subagent_type` and resolves CRITICAL findings
in-flow before proceeding to apply. Escalate to the human only when a fix has
substantive impact or reaches beyond this change's scope.

- [ ] 8.1 Run principles reviewer
  - `subagent_type: openspec-review-principles-reviewer`
  - Input: `openspec/changes/post-likes-and-reposts/`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 8.2 Run cross-proposal reviewer
  - `subagent_type: openspec-review-cross-proposal-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 8.3 Run tasks-granularity reviewer
  - `subagent_type: openspec-review-tasks-granularity-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 8.4 Run spec-quality reviewer
  - `subagent_type: openspec-review-spec-quality-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 8.5 Run decision-compliance reviewer
  - `subagent_type: openspec-review-decision-compliance-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [x] 8.6 `mise run openspec:validate` exits 0 (task added, validates clean)
- [ ] 8.7 `mise run openspec:schema-validate` exits 0
