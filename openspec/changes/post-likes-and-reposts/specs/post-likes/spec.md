## ADDED Requirements

### Requirement: Post-likes storage

The system SHALL persist post likes in a dedicated `post_likes` table with
columns `id` (uuid primary key), `account_id` (uuid, FK → `accounts.id`,
`ON DELETE CASCADE`), `post_id` (uuid, FK → `posts.id`, `ON DELETE CASCADE`),
and `created_at` (timestamptz, default `now()`). The table SHALL enforce
`UNIQUE(account_id, post_id)` so an account can like a post at most once, and
SHALL carry an index on `post_id` to make per-post count and `liked_by_me`
lookups efficient. This table is distinct from dating swipes and the dating
`new_like` notification.

#### Scenario: One like per account per post

- **WHEN** an authenticated account likes a post it has not yet liked
- **THEN** exactly one `post_likes` row is inserted for `(account_id, post_id)`
- **AND** the post's `like_count` increases by one

#### Scenario: Cascade on post deletion

- **WHEN** a post row is removed from the database
- **THEN** all `post_likes` rows referencing that `post_id` are deleted via the
  `ON DELETE CASCADE` foreign key

#### Scenario: Cascade on account deletion

- **WHEN** an account row is removed from the database
- **THEN** all `post_likes` rows authored by that `account_id` are deleted via
  the `ON DELETE CASCADE` foreign key

### Requirement: Like a post endpoint

The system SHALL expose `POST /v1/social/posts/:id/like` requiring
authentication. It SHALL be idempotent: liking an already-liked post MUST NOT
create a duplicate row and MUST NOT send a duplicate notification. It SHALL
return `{ liked: true, like_count: <int> }` with status 200.

#### Scenario: Like a post for the first time

- **WHEN** an authenticated account POSTs to `/v1/social/posts/:id/like` for a
  visible (non-deleted) post it has not liked
- **THEN** the response is `200 { liked: true, like_count }`
- **AND** a `post_likes` row is created
- **AND** a `new_post_like` notification is written to the post author (unless
  the liker is the author — see self-action rule)

#### Scenario: Like is idempotent

- **WHEN** an authenticated account likes a post it has already liked
- **THEN** the response is `200 { liked: true, like_count }` with the unchanged
  count
- **AND** no new `post_likes` row is inserted (insert uses
  `onConflictDoNothing`)
- **AND** no additional `new_post_like` notification is written

#### Scenario: Like requires authentication

- **WHEN** an unauthenticated request POSTs to `/v1/social/posts/:id/like`
- **THEN** the response is `401` and no row is inserted

#### Scenario: Like a missing or deleted post

- **WHEN** an authenticated account likes a post id that does not exist or is
  soft-deleted (`deleted_at` is set)
- **THEN** the response is `404 { error: "Post not found" }` and no row is
  inserted

### Requirement: Unlike a post endpoint

The system SHALL expose `DELETE /v1/social/posts/:id/like` requiring
authentication. It SHALL be idempotent: unliking a post the account has not
liked MUST succeed without error. It SHALL return
`{ liked: false, like_count: <int> }` with status 200. Unliking SHALL NOT delete
or alter any notification already written.

#### Scenario: Unlike a liked post

- **WHEN** an authenticated account DELETEs `/v1/social/posts/:id/like` for a
  post it has liked
- **THEN** the `post_likes` row is removed
- **AND** the response is `200 { liked: false, like_count }` with the count
  decreased by one

#### Scenario: Unlike is idempotent

- **WHEN** an authenticated account unlikes a post it has not liked
- **THEN** the response is `200 { liked: false, like_count }` and no error is
  raised

#### Scenario: Remove-then-readd sends a fresh notification

- **WHEN** an account likes a post, then unlikes it, then likes it again
- **THEN** the second like inserts a new `post_likes` row
- **AND** a second `new_post_like` notification is written (the unlike removed
  the row, so the re-like is no longer a duplicate)

### Requirement: Post like counts and viewer state in responses

The system SHALL include a `like_count` integer and a `liked_by_me` boolean on
every post-bearing response. This MUST apply to `GET /v1/social/posts/:id`, the
post returned by `POST /v1/social/posts`, `GET /v1/social/posts?handle=`,
`GET /v1/social/feed`, and `GET /v1/social/discover`. `like_count` is the total
number of likes on the post. When the request is authenticated, `liked_by_me`
reflects whether the authenticated account has an active like on that post. For
unauthenticated responses (`/discover`, public `GET /posts/:id`, public
`GET /posts?handle=`) `liked_by_me` MUST be `false`.

#### Scenario: Authenticated viewer sees their own like state

- **WHEN** an authenticated account fetches a post it has liked
- **THEN** the response includes `like_count >= 1` and `liked_by_me: true`

#### Scenario: Unauthenticated discover omits viewer state

- **WHEN** an unauthenticated client fetches `/v1/social/discover`
- **THEN** each item includes a numeric `like_count` and `liked_by_me: false`

### Requirement: Post-like notification is distinct from dating like

When an account likes a post, the system SHALL write a notification of type
`new_post_like` (a new value added to the `notification_type` enum) to the post
author, synchronously via the existing `notify()` helper, with priority
`normal`. The payload SHALL include the liker's `account_id`, the liker's social
`handle` (nullable), and the `post_id`. The system SHALL NOT reuse the dating
`new_like` type for post likes under any circumstance.

#### Scenario: Liking notifies the author with new_post_like

- **WHEN** account A likes a post authored by account B
- **THEN** a notification row with `type = 'new_post_like'`, `account_id = B`,
  and payload `{ liker_account_id, liker_handle, post_id }` is written
- **AND** the notification type is never `new_like`

#### Scenario: No self-notification for liking your own post

- **WHEN** an account likes a post it authored
- **THEN** the `post_likes` row is still created (the like counts)
- **AND** no `new_post_like` notification is written to the author (no
  self-notification)

### Requirement: Post likes introduce no comments or mentions

The post-likes capability SHALL NOT add comments, mentions, or any free-text
reaction. A like is a structured boolean relationship only. Replies
(`posts.reply_to_id`) are out of this capability's scope and remain unchanged.

#### Scenario: Like carries no text payload

- **WHEN** an account likes a post
- **THEN** the request body is empty and no comment, mention, or message is
  created
