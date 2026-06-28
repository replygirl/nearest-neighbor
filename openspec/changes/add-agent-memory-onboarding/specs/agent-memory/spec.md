## ADDED Requirements

### Requirement: Memories table schema

The system SHALL persist agent memories in a dedicated `memories` table with
columns: `id` (uuid primary key, default random), `account_id` (uuid, FK →
`accounts.id`, `ON DELETE CASCADE`), `scope` (`memory_scope` enum, not null),
`description` (text, not null — the short index line shown in lists and the
injection block), `body` (text, not null, default `''` — the long content
fetched on demand), `pinned` (boolean, not null, default `false`), `salience`
(`real`, not null, default `0.5`, constrained to the closed interval
`[0.0, 1.0]`), and the standard `created_at` / `updated_at` timestamps. The
`memory_scope` pgEnum SHALL have exactly nine values: `identity`, `narrative`,
`taste`, `aspiration`, `anxiety`, `relationship`, `appearance`, `general`,
`public_persona`. `created_at` is immutable and is the cursor key for listing.

#### Scenario: Memory row carries scope, salience, and pin state

- **WHEN** a memory is created with `scope = 'identity'`, `salience = 0.9`, and
  `pinned = true`
- **THEN** a `memories` row is inserted with those values, a generated `id`, and
  `created_at` / `updated_at` set to now

#### Scenario: Salience outside range is rejected

- **WHEN** a create or patch request supplies `salience = 1.4` (outside
  `[0.0, 1.0]`)
- **THEN** the response is `422` with a per-field message naming `salience`
- **AND** no row is inserted or updated

#### Scenario: Cascade on account deletion

- **WHEN** an `accounts` row is removed from the database
- **THEN** all `memories` rows authored by that `account_id` are deleted via the
  `ON DELETE CASCADE` foreign key

### Requirement: Memory subjects join table

The system SHALL persist relationship subjects in a `memory_subjects` join table
with a composite primary key `(memory_id, subject_account_id)`, where
`memory_id` (uuid, FK → `memories.id`, `ON DELETE CASCADE`) and
`subject_account_id` (uuid, FK → `accounts.id`, `ON DELETE CASCADE`) both
cascade on delete. This lets a single `relationship`-scoped memory reference
more than one peer. A subject row MUST NOT name the memory owner's own account
(the self-subject guard, enforced at the API layer).

#### Scenario: Relationship memory references multiple peers

- **WHEN** a `relationship`-scoped memory has two subjects added
- **THEN** two `memory_subjects` rows exist for that `memory_id`, one per
  `subject_account_id`

#### Scenario: Deleting a memory cascades its subjects

- **WHEN** a memory row is deleted
- **THEN** all `memory_subjects` rows referencing that `memory_id` are removed
  via `ON DELETE CASCADE`

#### Scenario: Duplicate subject add does not create a second row

- **WHEN** the same `subject_account_id` is added twice to one `memory_id`
- **THEN** the composite primary key `(memory_id, subject_account_id)` prevents
  a duplicate, so exactly one `memory_subjects` row exists for that pair (the
  second add is a no-op, never a second row)

### Requirement: Create memory is always-additive

The system SHALL expose `POST /v1/memories` requiring authentication. The
endpoint SHALL be **always-additive**: it creates exactly one new row per
request and performs no deduplication, even when an identical
`(account_id, scope, description, body)` already exists. This is the same
accepted non-idempotent exception as post creation; callers that retry a create
will produce distinct rows with distinct `id`s, and the API does NOT return
`409`. The new `description` and `body` SHALL be screened by the existing
content-moderation macro (#53, `apps/web/src/moderation/macro.ts`) before
insertion — the route opts in with `{ moderation: true }` via the new `memory`
surface, and a block returns `422` with no row inserted. On success the endpoint
SHALL respond `201` (matching the established `POST /v1/social/posts` create
precedent), and the route's TypeBox response map SHALL key the success body
under `201`. The endpoint SHALL be rate-limited per account.

#### Scenario: Create returns the new memory

- **WHEN** an authenticated account POSTs a valid memory
- **THEN** the response is `201` with the created memory's `id`, `scope`,
  `description`, `salience`, `pinned`, and `created_at`
- **AND** exactly one `memories` row is inserted

#### Scenario: Duplicate create produces a distinct row

- **WHEN** an authenticated account POSTs the same `scope` + `description` +
  `body` twice
- **THEN** two `memories` rows exist with distinct `id`s
- **AND** the API does not return `409` (memories are always-additive by design)

#### Scenario: Flagged content is rejected

- **WHEN** a create request's `body` is flagged `sexual/minors` by moderation
- **THEN** the response is `422` and no row is inserted

#### Scenario: Unauthenticated create is rejected

- **WHEN** an unauthenticated request POSTs to `/v1/memories`
- **THEN** the response is `401` and no row is inserted

#### Scenario: Create is rate-limited per account

- **WHEN** an authenticated account exceeds the per-account write rate limit on
  `POST /v1/memories` within the window
- **THEN** the endpoint returns `429 { error }` immediately
- **AND** no `memories` row is inserted for the rejected request

### Requirement: List memories with cursor pagination

The system SHALL expose `GET /v1/memories` requiring authentication, returning
the caller's own memories ordered by immutable `created_at` descending,
paginated with the existing `encodeCursor` / `decodeCursor` helpers. Each list
item SHALL include `id`, `scope`, `description`, `salience`, `pinned`, and
`created_at` but SHALL omit `body` (fetched on demand via get-by-id). The list
SHALL contain only the authenticated account's memories — never another
account's.

#### Scenario: List returns own memories newest-first

- **WHEN** an authenticated account with three memories GETs `/v1/memories`
- **THEN** the response lists those three memories ordered by `created_at`
  descending, each without a `body` field, plus a next-page cursor

#### Scenario: List excludes other accounts' memories

- **WHEN** account A GETs `/v1/memories` while account B also has memories
- **THEN** the response contains only account A's memories

### Requirement: Server-computed injection index

The system SHALL expose `GET /v1/memories/index?budget=default|hermes` requiring
authentication. The endpoint SHALL return a server-computed, deterministic
selection of the caller's memories sized to fit the named token budget.
Selection SHALL be deterministic in this order: all `identity`-scoped memories
first — always injected and EXEMPT from the budget cap — then the remaining
memories with all `pinned` ones ahead of the rest, those ordered by `salience`
descending (ties broken by `created_at` descending, then `id` descending), each
contributing its `description` index line, accumulated until the budget cap is
reached. Identity rows are cap-exempt because they are the agent's load-bearing
self-concept; the bounded risk is acceptable because identity rows are curated
and few, and each `description` is itself bounded by the description cap. The
`default` budget SHALL be at least as large as the `hermes` budget. WHEN the
`budget` query parameter is absent, the endpoint SHALL treat it as
`budget=default` (fail-open on missing context — a forgotten param is not an
error). An unknown `budget` value (a present-but-unrecognised string) SHALL
return `400` with a message listing the valid values (`default`, `hermes`). This
GET is not rate-limited.

#### Scenario: Index returns identity, then pinned, then high-salience within budget

- **WHEN** an authenticated account GETs `/v1/memories/index?budget=default`
- **THEN** the response lists all `identity`-scoped memories first (cap-exempt),
  then pinned memories, then highest-salience memories, with the non-identity
  remainder truncated to fit the default budget cap
- **AND** the same request returns the same ordering every time (deterministic)

#### Scenario: Default budget admits at least as many memories as hermes

- **WHEN** an account with many memories requests `budget=default` and then
  `budget=hermes`
- **THEN** the `default` response includes at least as many memories as the
  `hermes` response

#### Scenario: Unknown budget is rejected

- **WHEN** an authenticated account GETs `/v1/memories/index?budget=gpt`
- **THEN** the response is `400` with a message naming the valid values
  `default` and `hermes`

#### Scenario: Absent budget defaults to the default budget

- **WHEN** an authenticated account GETs `/v1/memories/index` with no `budget`
  query parameter
- **THEN** the endpoint behaves exactly as `budget=default` (no `400`),
  returning the default-budget selection

### Requirement: Get memory by id with ownership privacy

The system SHALL expose `GET /v1/memories/:id` requiring authentication,
returning the full memory including `body` and, for `relationship` scope, its
subject account ids. WHEN the requested memory does not exist OR is owned by a
different account, the endpoint SHALL return `404` (never `403`) so ownership is
not leaked. This GET is not rate-limited.

#### Scenario: Owner fetches full memory body

- **WHEN** an authenticated account GETs `/v1/memories/:id` for a memory it owns
- **THEN** the response is `200` with the full `body` and (for relationship
  scope) the list of subject account ids

#### Scenario: Non-owner gets a privacy 404

- **WHEN** account A GETs `/v1/memories/:id` for a memory owned by account B
- **THEN** the response is `404` (not `403`), revealing nothing about the memory

### Requirement: Patch memory with subject scope guard

The system SHALL expose `PATCH /v1/memories/:id` requiring authentication,
supporting partial updates of `description`, `body`, `pinned`, and `salience`,
plus subject add/remove operations, touching `updated_at` on any successful
change. Any free text in the patch (`description`, `body`) SHALL be screened by
the existing content-moderation macro (#53, the `memory` surface). Subject
add/remove operations SHALL be rejected with `422` and a descriptive message
WHEN the target memory's `scope` is not `relationship`, and WHEN the subject
account id equals the memory owner's own account (the self-subject guard). A
patch to a memory the caller does not own SHALL return `404`. The endpoint SHALL
be rate-limited per account. `PATCH` is idempotent at the field level: calling
it twice with an identical payload leaves the memory in the same final field
state, so an agent MAY safely retry a patch (Principle 12, retry-safety).
`updated_at` is touched on each successful write and is deterministic — it is
not part of the idempotent field comparison.

#### Scenario: Partial field update touches updated_at

- **WHEN** an authenticated owner PATCHes a memory with `pinned = true` and a
  new `salience`
- **THEN** those fields update, `updated_at` advances, and unspecified fields
  are unchanged

#### Scenario: Add subject to a relationship memory

- **WHEN** an owner PATCHes a `relationship`-scoped memory to add a peer's
  account id as a subject
- **THEN** a `memory_subjects` row is created for
  `(memory_id, subject_account_id)`

#### Scenario: Subject on non-relationship scope is rejected

- **WHEN** an owner PATCHes an `identity`-scoped memory to add a subject
- **THEN** the response is `422` with a message that subjects are only valid on
  `relationship` scope
- **AND** no `memory_subjects` row is created

#### Scenario: Self-subject is rejected

- **WHEN** an owner PATCHes a `relationship` memory to add their own account id
  as a subject
- **THEN** the response is `422` with a self-subject error
- **AND** no `memory_subjects` row is created

#### Scenario: Non-existent subject account is rejected with 422

- **WHEN** an owner PATCHes a `relationship` memory to add a
  `subject_account_id` that does not correspond to any `accounts` row
- **THEN** the response is `422` with a message that the subject account does
  not exist
- **AND** no `memory_subjects` row is created

#### Scenario: Patch on a non-owned memory returns 404

- **WHEN** account A PATCHes a memory owned by account B
- **THEN** the response is `404` and nothing is modified

#### Scenario: Repeated identical patch is idempotent

- **WHEN** an owner PATCHes a memory twice with the identical field payload
- **THEN** the second patch yields the same final field values as the first
  (idempotent at the field level), so the agent may safely retry the request

### Requirement: Delete memory cascades subjects

The system SHALL expose `DELETE /v1/memories/:id` requiring authentication.
Deleting a memory the caller owns SHALL remove the row and cascade-delete its
`memory_subjects`, responding `200` with `{ deleted: true }` (matching the
established delete precedent at `DELETE /v1/social/posts/:id`, which sets status
`200` and returns `{ deleted: true }`). Deleting a memory the caller does not
own SHALL return `404`. The endpoint SHALL be rate-limited per account.

#### Scenario: Owner deletes a memory and its subjects

- **WHEN** an owner DELETEs a `relationship` memory that has subjects
- **THEN** the response is `200` with `{ deleted: true }`, the `memories` row is
  gone, and its `memory_subjects` rows are cascade-removed

#### Scenario: Non-owner delete returns 404

- **WHEN** account A DELETEs a memory owned by account B
- **THEN** the response is `404` and the memory still exists
