# dating-deck-ordering Specification

## Purpose
TBD - created by archiving change add-last-active-deck-sort. Update Purpose after archive.
## Requirements
### Requirement: Deck ordered by recency of activity

The system SHALL order `GET /v1/dating/deck` by
`accounts.last_active_at DESC NULLS LAST`, then
`dating_profiles.created_at DESC`, then `dating_profiles.account_id DESC`.
Profiles whose account has a more recent `last_active_at` SHALL appear earlier;
profiles whose account has never been active (`last_active_at IS NULL`) SHALL
appear after all profiles with a recorded activity date. `created_at`
(immutable) and `account_id` are the tiebreakers, in that order, so the total
ordering is deterministic and stable.

#### Scenario: More recently active account ranks first

- **WHEN** the deck contains two eligible profiles whose accounts have different
  `last_active_at` dates
- **THEN** the profile whose account has the more recent `last_active_at` is
  returned before the other

#### Scenario: Never-active accounts sort last

- **WHEN** the deck contains a profile whose account `last_active_at` is `NULL`
  and another whose account has any non-null `last_active_at`
- **THEN** the profile with the non-null `last_active_at` is returned first
- **AND** the `NULL`-activity profile appears after all non-null-activity
  profiles

#### Scenario: Same activity day falls back to creation order

- **WHEN** two eligible profiles' accounts share the same `last_active_at` date
- **THEN** they are ordered by `dating_profiles.created_at DESC`, and by
  `account_id DESC` when `created_at` also ties

#### Scenario: Deterministic ordering

- **WHEN** the same viewer requests the deck twice with no intervening data
  changes
- **THEN** the profiles are returned in the identical order both times

#### Scenario: Unauthenticated request is rejected

- **WHEN** a client requests `GET /v1/dating/deck` without a bearer token or
  with an invalid or expired token
- **THEN** the response status is 401
- **AND** no deck profiles are returned

### Requirement: Deck filtering is unchanged

The reordering SHALL NOT change which profiles are eligible for the deck. The
deck SHALL continue to include only profiles with `is_visible = true`, and SHALL
continue to exclude the viewer's own profile and every profile the viewer has
already swiped on (in either direction). No account-status filter SHALL be
added.

#### Scenario: Visibility and swipe exclusions preserved

- **WHEN** a viewer requests the deck
- **THEN** the result excludes the viewer's own profile, every profile the
  viewer has already swiped on, and every profile with `is_visible = false`
- **AND** includes all other profiles, ordered by the activity-recency ordering

#### Scenario: Suspended accounts are not filtered by this change

- **WHEN** an eligible, visible profile belongs to an account with a non-active
  `status`
- **THEN** it is still returned in the deck (status filtering is out of scope),
  ordered by its `last_active_at`

### Requirement: Deck keyset pagination over the activity ordering

The deck SHALL paginate via an opaque base64 cursor encoding the 3-tuple
`(last_active_at, created_at, account_id)` of the last returned item. The next
page SHALL return exactly the profiles that sort strictly after the cursor under
the deck ordering, with no row skipped and no row duplicated across the page
boundary, including across the `NULLS LAST` transition from dated rows to
never-active rows. The cursor MUST remain opaque to clients; its internal
structure is not part of the API contract.

#### Scenario: Page boundary within dated rows

- **WHEN** a client requests the deck, receives a full page ending on a profile
  whose account has a non-null `last_active_at`, and requests the next page with
  the returned cursor
- **THEN** the next page begins with the profile that immediately follows that
  boundary profile under the ordering
- **AND** no profile from the first page reappears

#### Scenario: Page boundary across the NULLS LAST transition

- **WHEN** the cursor's `last_active_at` is non-null and the remaining profiles
  include never-active (`NULL`) accounts
- **THEN** the next page returns the rest of the dated profiles first and then
  the `NULL`-activity profiles, with no overlap or gap

#### Scenario: Page boundary within the NULL tail

- **WHEN** the cursor's `last_active_at` is `NULL` (pagination has reached the
  never-active tail)
- **THEN** the next page returns only `NULL`-activity profiles that sort after
  the cursor by `created_at DESC, account_id DESC`

#### Scenario: Last page returns a null cursor

- **WHEN** the final page of the deck is returned
- **THEN** `next_cursor` is `null`

### Requirement: Deck cursor is self-healing across format changes

The deck cursor decoder SHALL return no cursor (treated as a top-of-deck
restart) when given a cursor that is not a valid deck cursor — including a
corrupt or non-JSON payload and a legacy 2-tuple cursor that lacks the
`last_active_at` field. A bad or outdated cursor MUST NOT produce a `500` and
MUST NOT be partially applied.

#### Scenario: Legacy 2-tuple cursor restarts from the top

- **WHEN** a client submits a cursor that was issued in the previous
  `(created_at, account_id)` format (no `last_active_at` field)
- **THEN** the decoder yields no cursor and the deck is returned from the top
  under the new ordering, without error

#### Scenario: Corrupt cursor restarts from the top

- **WHEN** a client submits a cursor that is not valid base64-encoded JSON, or
  whose JSON lacks `created_at` or `account_id`
- **THEN** the decoder yields no cursor and the deck is returned from the top,
  without error

#### Scenario: Valid deck cursor is decoded and applied

- **WHEN** a client submits a valid base64-encoded JSON cursor containing
  `last_active_at`, `created_at`, and `account_id`
- **THEN** the decoder returns a cursor and the deck continues from the correct
  position under the activity-recency ordering
- **AND** the response status is 200 and no error is raised

