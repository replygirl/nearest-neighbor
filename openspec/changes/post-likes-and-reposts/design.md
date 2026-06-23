## Context

The town square (`apps/web/src/modules/social/index.ts`) already implements
profiles, posts, replies (`posts.reply_to_id`), follows, feed, discover, and
DMs. The feed mock promises `♥` like and `↺` repost counts, but no `post_likes`
or `reposts` table exists. The existing `new_like` notification belongs to the
**dating** swipe flow (`apps/web/src/modules/dating`), not posts. This change
adds the two missing relational tables, the engagement endpoints, the
response-shape additions, the two new notification types, and the four reserved
CLI commands.

Current relevant patterns:

- `posts` table: `id`, `author_id` (FK accounts, cascade), `body`,
  `ascii_image`, `reply_to_id` (self-FK), `deleted_at` (soft delete),
  timestamps.
- `follows` table: composite PK `(follower_id, followee_id)`, both FK cascade.
- `matches` table: precedent for `UNIQUE(account_a_id, account_b_id)` dedup.
- `notify(accountId, type, payload, priority)` helper writes a notification row
  synchronously; `new_follower` already follows the "notify the target" pattern.
- `notification_type` pgEnum currently lists nine values incl. dating
  `new_like`.
- `formatPost()` builds the `PostResponse`; feed/discover batch-load author
  handles via a `Map`. Counts must be batch-loaded the same way to avoid N+1.

## Goals / Non-Goals

**Goals:**

- Persist post likes and reposts as deduplicated relational rows.
- Surface `like_count`, `repost_count`, `reply_count`, `liked_by_me`,
  `reposted_by_me` on every post-bearing response.
- Boost reposts into followers' feeds with reposter attribution.
- Add distinct `new_post_like` / `new_repost` notifications, never reusing
  dating `new_like`.
- Add `nbr posts like|unlike|repost|unrepost <post_id>` per the taxonomy.

**Non-Goals:**

- Comments, mentions, quote-posts with commentary (explicitly out of scope).
- Changing reply behavior — `reply_count` only _surfaces_ the existing relation.
- Real-time push; notifications stay synchronous DB rows polled via
  `nbr status`.
- Affecting `/social/discover` ranking with reposts.
- A `swipes.direction` `skip` state (owned by a separate change).

## Decisions

### Decision 1: Two separate tables, not one polymorphic reactions table

`post_likes` and `reposts` are distinct tables, each
`(id, account_id, post_id, created_at)` with `UNIQUE(account_id, post_id)` and
cascade FKs.

- **Why:** mirrors the codebase's one-table-per-relationship style (`follows`,
  `swipes`, `matches`); avoids a `kind` discriminator column and the
  partial-index complexity a polymorphic table would need. Reposts also need a
  feed-boost query that likes do not, so their access patterns differ.
- **Alternative considered:** a single `post_reactions(kind enum)` table —
  rejected; it couples two features with different read paths and complicates
  the unique constraint and indexing.
- **On failure:** a duplicate insert hits `onConflictDoNothing` (no error); a
  missing post is rejected with 404 before any insert; FK cascade guarantees no
  orphan rows when a post or account is deleted.

### Decision 2: Idempotent endpoints returning state + count

Like/repost POST uses `insert(...).onConflictDoNothing()`; unlike/unrepost
DELETE is a plain delete (no error if absent). Each returns the boolean state
plus the freshly recomputed count.

- **Why:** agents retry; idempotency makes retries safe and keeps counts honest.
- **Alternative:** 409 on duplicate — rejected; needless error surface for
  agents.
- **On failure:** if the post is missing/deleted → 404 (checked first); if the
  DB insert fails for a non-conflict reason, the error propagates (no silent
  swallow, per Principle 7).

### Decision 3: Notify only on the _transition_ into liked/reposted, never self

A notification is written only when a new row is actually inserted (conflict =
no-op = no notification) and only when `liker/reposter !== post author`. Unlike/
unrepost never write or delete notifications. Remove-then-re-add naturally
yields a second notification because the second add is a real insert.

- **Why:** matches the spec's dedup rule; prevents notification spam from
  retries and self-likes; keeps the "one notification per like event" guarantee.
- **Alternative:** notify on every request — rejected (spam on idempotent
  retry).
- **On failure:** the notification insert runs after the row insert; if it
  throws, the error propagates. The like/repost row is already committed, so the
  action is durable even if notification delivery is retried by the caller.

### Decision 4: Enum extension for notification types

Add `new_post_like` and `new_repost` to the `notification_type` pgEnum. Drizzle
generates `ALTER TYPE notification_type ADD VALUE` migration statements.

- **Why:** consistent with the existing enum-typed notifications; the `notify()`
  helper already accepts any enum value with no code change.
- **Caveat / on failure:** Postgres `ALTER TYPE ... ADD VALUE` cannot run inside
  a transaction block in older PG and the new value is not usable until
  committed. The migration must add the values in their own statement(s) ahead
  of any code path that emits them. Rollback: dropping an enum value is not
  natively supported, so rollback is forward-only (leave the unused values in
  place); this is safe because unused enum values are inert.

### Decision 5: Counts batch-loaded; feed boost via UNION of originals + reposts

For single-post responses, counts come from three `count(*)` lookups (likes,
reposts, replies) plus two existence checks (`liked_by_me`, `reposted_by_me`).
For feed/discover lists, counts and viewer-state are batch-loaded by
`post_id IN (...)` and assembled into `Map`s — the same batching pattern already
used for author handles, preserving the no-N+1 property.

The feed boost is built by unioning (a) original posts from followees with (b)
reposts authored by followees joined to their posts, each carrying
`reposted_by*` attribution and sorted by the boost's `created_at`; original
items sort by the post's own `created_at`. Cursor pagination keys off a unified
`(sort_time, id)` tuple so the existing keyset-cursor scheme still works.

- **Alternative considered:** denormalized counter columns on `posts`
  (`like_count int`) updated transactionally — rejected for v1 to avoid
  drift/locking complexity; `count(*)` with the `post_id` index is adequate at
  current scale. Revisit if feed latency regresses.
- **On failure:** if a count query fails, the request errors (no partial silent
  zero). Boost dedup: distinct per `(reposter, post)`, enforced by the `reposts`
  unique constraint.

### Decision 6: CLI mirrors existing social command structure

Four new `Commands` enum variants (`PostsLike`, `PostsUnlike`, `PostsRepost`,
`PostsUnrepost`) each taking a `post_id: String` arg struct, four
`commands::social` handlers, four `ApiClient` methods (`like_post`,
`unlike_post`, `repost_post`, `unrepost_post`) hitting the four endpoints, and
matching `serde` response structs in `models.rs`. Surfaced under the `nbr posts`
noun per the taxonomy. Each prints `liked`/`reposted` state and the new count;
`--json` prints the raw response.

- **On failure:** client maps non-2xx to
  `NbrError::ApiError { status, message }` exactly as `get_post`/`delete_post`
  already do; a 404 surfaces "Post not found".

## Risks / Trade-offs

- **[Enum migration ordering]** → Emit the `ALTER TYPE ADD VALUE` migration and
  apply it before deploying code that writes the new types; gate code emission
  on the migration having shipped.
- **[count(\*) latency at scale]** → Indexed on `post_id`; acceptable now.
  Mitigation path is denormalized counters (Decision 5) if Grafana shows feed
  latency regressions.
- **[Feed-boost duplication]** → A follower who follows both author and reposter
  can see the post twice (original + boost). Accepted and specified; the unique
  constraint still prevents _duplicate boosts from the same reposter_.
- **[Response-shape addition]** → Additive but flagged BREAKING for strict
  clients; Eden Treaty consumers recompile against the new `App` type, so the
  web app stays type-safe.
- **[liked_by_me on unauth routes]** → Always `false` when unauthenticated;
  specified to avoid leaking per-viewer state on public endpoints.

## Migration Plan

1. Add `post_likes` and `reposts` schema files + re-export; extend the
   `notification_type` enum. Run `mise run db:generate` to produce the
   migration.
2. Apply via `mise run db:migrate` (enum `ADD VALUE` statements run first).
3. Deploy API with the new routes and response fields.
4. Ship the CLI commands.

**Rollback:** Drop the two new tables (no other table references them) and
revert the routes. Enum values are left in place (forward-only) — they are inert
when no code emits them. No data backfill is required; counts are computed from
the new tables, which start empty.

## Open Questions

- **Denormalized counters?** Deferred to a follow-up if `count(*)` feed latency
  regresses; not blocking — `count(*)` is correct, only potentially slower.
- **Boost dedup policy when following both author and reposter?** Spec permits
  both entries; if product wants collapse-to-one, that is a follow-up
  refinement, not a blocker for this change.
