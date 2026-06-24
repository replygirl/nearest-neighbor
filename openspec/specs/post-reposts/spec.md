# post-reposts Specification

## Purpose

TBD - created by archiving change post-likes-and-reposts. Update Purpose after
archive.

## Requirements

### Requirement: Reposts storage

The system SHALL persist reposts in a dedicated `reposts` table with columns
`id` (uuid primary key), `account_id` (uuid, FK → `accounts.id`,
`ON DELETE CASCADE`), `post_id` (uuid, FK → `posts.id`, `ON DELETE CASCADE`),
and `created_at` (timestamptz, default `now()`). The table SHALL enforce
`UNIQUE(account_id, post_id)` so an account can repost a given post at most
once, and SHALL carry indexes on `post_id` (for per-post repost counts) and on
`(account_id, created_at)` (for assembling the reposter's feed boost in reverse
chronological order).

#### Scenario: One repost per account per post

- **WHEN** an authenticated account reposts a post it has not yet reposted
- **THEN** exactly one `reposts` row is inserted for `(account_id, post_id)`
- **AND** the post's `repost_count` increases by one

#### Scenario: Cascade on post or account deletion

- **WHEN** the referenced post row or the reposting account row is deleted
- **THEN** the dependent `reposts` rows are removed via `ON DELETE CASCADE`

### Requirement: Repost a post endpoint

The system SHALL expose `POST /v1/social/posts/:id/repost` requiring
authentication. It SHALL be idempotent: reposting an already-reposted post MUST
NOT create a duplicate row and MUST NOT send a duplicate notification. It SHALL
return `{ reposted: true, repost_count: <int> }` with status 200.

#### Scenario: Repost a post for the first time

- **WHEN** an authenticated account POSTs to `/v1/social/posts/:id/repost` for a
  visible post it has not reposted
- **THEN** the response is `200 { reposted: true, repost_count }`
- **AND** a `reposts` row is created
- **AND** a `new_repost` notification is written to the post author (unless the
  reposter is the author — see self-action rule)

#### Scenario: Repost is idempotent

- **WHEN** an authenticated account reposts a post it has already reposted
- **THEN** the response is `200 { reposted: true, repost_count }` with the
  unchanged count
- **AND** no new `reposts` row is inserted (`onConflictDoNothing`)
- **AND** no additional `new_repost` notification is written

#### Scenario: Repost requires authentication

- **WHEN** an unauthenticated request POSTs to `/v1/social/posts/:id/repost`
- **THEN** the response is `401` and no row is inserted

#### Scenario: Repost a missing or deleted post

- **WHEN** an authenticated account reposts a post id that does not exist or is
  soft-deleted
- **THEN** the response is `404 { error: "Post not found" }` and no row is
  inserted

### Requirement: Undo a repost endpoint

The system SHALL expose `DELETE /v1/social/posts/:id/repost` requiring
authentication. It SHALL be idempotent and SHALL return
`{ reposted: false, repost_count: <int> }` with status 200. Undoing a repost
SHALL remove the boost from followers' feeds (the boosted entry no longer
appears) but SHALL NOT delete any notification already written.

#### Scenario: Undo a repost

- **WHEN** an authenticated account DELETEs `/v1/social/posts/:id/repost` for a
  post it has reposted
- **THEN** the `reposts` row is removed
- **AND** the response is `200 { reposted: false, repost_count }` with the count
  decreased by one
- **AND** the boosted entry no longer appears in that account's followers' feeds

#### Scenario: Undo is idempotent

- **WHEN** an authenticated account undoes a repost it never made
- **THEN** the response is `200 { reposted: false, repost_count }` and no error
  is raised

#### Scenario: Repost-then-unrepost-then-repost sends a fresh notification

- **WHEN** an account reposts a post, undoes it, then reposts it again
- **THEN** the second repost inserts a new `reposts` row
- **AND** a second `new_repost` notification is written

### Requirement: Repost counts and viewer state in responses

Every post-bearing response SHALL include `repost_count` (integer),
`reply_count` (integer, number of non-deleted posts whose `reply_to_id` equals
this post), and, when authenticated, `reposted_by_me` (boolean). For
unauthenticated responses `reposted_by_me` SHALL be `false`. `reply_count`
reflects the already-existing reply relationship; this change surfaces the count
but does not alter reply behavior.

#### Scenario: Counts surface on the post payload

- **WHEN** any client fetches a post that has 2 likes, 3 reposts, and 1 reply
- **THEN** the payload includes `like_count: 2`, `repost_count: 3`,
  `reply_count: 1`

#### Scenario: Authenticated reposter sees their own repost state

- **WHEN** an authenticated account fetches a post it has reposted
- **THEN** the payload includes `reposted_by_me: true`

### Requirement: Reposts boost the original post into followers' feeds

The system SHALL surface a reposted post as a boosted feed entry to the
reposter's followers. When account R reposts post P (authored by A),
`GET /v1/social/feed` for any account F that follows R MUST surface P as a
boosted entry attributed to R. The boosted feed item SHALL carry the original
post's content and counts plus attribution fields `reposted_by` (R's handle),
`reposted_by_account_id` (R's id), and `reposted_at` (the repost `created_at`),
and SHALL be ordered in the feed by `reposted_at` (the boost time), not the
original post's `created_at`. A feed item that is an original post (not a boost)
SHALL leave the `reposted_by*` fields null. Deduplication: if F's feed would
contain the same post both as an original (F follows A) and as a boost (F
follows R), the feed MAY include both entries but each boost entry SHALL be
distinct per reposter; a single reposter SHALL NOT produce duplicate boost
entries for the same post. `GET /v1/social/discover` SHALL NOT be affected by
reposts — it remains a reverse-chronological stream of original, non-deleted
posts ordered by the post's own `created_at`.

#### Scenario: A repost surfaces in a follower's feed with attribution

- **WHEN** account F follows R, and R reposts post P authored by A (whom F does
  not follow)
- **THEN** F's `/v1/social/feed` includes P with `reposted_by = R.handle`,
  `reposted_by_account_id = R.id`, and `reposted_at` set to the repost time
- **AND** the entry is ordered by `reposted_at`

#### Scenario: Original feed items carry null repost attribution

- **WHEN** F's feed includes a post authored by someone F follows directly (not
  a boost)
- **THEN** that item's `reposted_by`, `reposted_by_account_id`, and
  `reposted_at` fields are null

#### Scenario: Discover ignores reposts

- **WHEN** a post is reposted many times
- **THEN** `/v1/social/discover` still lists that post at most once, ordered by
  the post's own `created_at`, with no `reposted_by*` attribution

#### Scenario: Undoing a repost removes the boost

- **WHEN** R undoes a repost of P and F (who follows R but not A) refetches the
  feed
- **THEN** P no longer appears as a boost from R in F's feed

### Requirement: Repost notification is its own type

When an account reposts a post, the system SHALL write a notification of type
`new_repost` (a new `notification_type` enum value) to the post author,
synchronously via `notify()`, priority `normal`, with payload including the
reposter's `account_id`, `handle` (nullable), and the `post_id`. The system
SHALL NOT reuse `new_like` or `new_post_like` for reposts.

#### Scenario: Reposting notifies the author with new_repost

- **WHEN** account R reposts a post authored by account A
- **THEN** a notification with `type = 'new_repost'`, `account_id = A`, and
  payload `{ reposter_account_id, reposter_handle, post_id }` is written

#### Scenario: No self-notification for reposting your own post

- **WHEN** an account reposts a post it authored
- **THEN** the `reposts` row is created (the repost counts and boosts to
  followers)
- **AND** no `new_repost` notification is written to the author

### Requirement: Reposts introduce no comments or mentions

The post-reposts capability SHALL NOT add quote-posts with commentary, comments,
or mentions. A repost is a structured boost with no added text. Replies remain
unchanged.

#### Scenario: Repost carries no text payload

- **WHEN** an account reposts a post
- **THEN** the request body is empty and no comment, quote text, or mention is
  created
