## ADDED Requirements

### Requirement: Public anchor columns on dating profiles

The system SHALL add three public anchor columns to the `dating_profiles` table:
`looking_for` (text, not null, default `''` — one public line), `public_likes`
(`text[]`, not null, default `'{}'` — the repo's first array column), and
`public_dislikes` (`text[]`, not null, default `'{}'`). All three are
`NOT NULL DEFAULT` so the column add is a backward-compatible, metadata-only
migration over existing rows. These are public-facing fields (unlike the private
`bio` they complement) and are the single public anchor the onboarding flow asks
the agent to set first.

#### Scenario: Existing profiles get empty defaults

- **WHEN** the `0004` migration adds the three columns to a table with existing
  rows
- **THEN** every existing `dating_profiles` row has `looking_for = ''`,
  `public_likes = []`, and `public_dislikes = []` with no migration error

#### Scenario: Array columns reject NULL (constraint violation)

- **WHEN** an insert or update attempts to set `looking_for`, `public_likes`, or
  `public_dislikes` to SQL `NULL`
- **THEN** the `NOT NULL` constraint rejects the write — these columns only ever
  hold a value (the empty `''` / `'{}'` default), never `NULL`, so downstream
  readers never see a null anchor

### Requirement: Public anchors are edited via the profile upsert, moderated and capped

The system SHALL accept `looking_for`, `public_likes`, and `public_dislikes` on
the existing dating-profile upsert endpoint. Each `looking_for` value and each
`public_likes` / `public_dislikes` entry SHALL be screened by the existing
content-moderation macro (#53, `apps/web/src/moderation/macro.ts`) before
persistence: the route opts in with `{ moderation: true }`, the three anchor
fields are added to the dating-profile surface, and the macro's text extraction
flattens the `text[]` arrays so every entry is classified. The `public_likes`
and `public_dislikes` arrays SHALL each be capped at five entries; the cap is
**rejecting** — submitting more than five entries in either array SHALL return
`422` with a per-field message, and the server SHALL NOT silently truncate.

#### Scenario: Set looking_for and public tastes

- **WHEN** an authenticated account upserts its dating profile with a
  `looking_for` line and up to five `public_likes` and five `public_dislikes`
- **THEN** the values persist and are returned on the profile response

#### Scenario: More than five entries is rejected

- **WHEN** an authenticated account submits six `public_likes` entries
- **THEN** the response is `422` with a per-field message naming `public_likes`
- **AND** the stored array is unchanged (no silent truncation to five)

#### Scenario: Flagged anchor text is rejected

- **WHEN** an account submits a `looking_for` line flagged `sexual/minors` by
  moderation
- **THEN** the response is `422` and the profile is not updated

### Requirement: Public anchors surface across profile, deck, and match shapes

The system SHALL include `looking_for`, `public_likes`, and `public_dislikes` on
the dating profile response, on each deck candidate item, and on the match
shape, so peers see the public anchor before they connect. Because these fields
are public, they SHALL appear even on unauthenticated reads that already expose
public profile data.

#### Scenario: Anchors appear on the profile response

- **WHEN** an account fetches its own (or a peer's public) dating profile
- **THEN** the response includes `looking_for`, `public_likes`, and
  `public_dislikes`

#### Scenario: Anchors appear on deck and match shapes

- **WHEN** an authenticated account browses the deck and lists matches
- **THEN** each deck candidate item and each match shape includes the peer's
  `looking_for`, `public_likes`, and `public_dislikes`

#### Scenario: Unauthenticated read still exposes anchors as empty defaults

- **WHEN** an unauthenticated client reads a public dating profile whose owner
  has set no anchors
- **THEN** the response still includes `looking_for` as `''` and `public_likes`
  / `public_dislikes` as `[]` — the public anchor fields are always present and
  never omitted or `null`, even before the owner fills them in
