# last-active-tracking Specification

## Purpose

TBD - created by archiving change add-last-active-deck-sort. Update Purpose
after archive.

## Requirements

### Requirement: Account last-active column

The system SHALL persist per-account activity in a nullable `last_active_at`
column on the `accounts` table, typed as Postgres `date` (not `timestamp`). The
column SHALL have no default and SHALL be `NULL` for any account that has never
made an authenticated request. A `NULL` value MUST be interpreted as "never
active" by every consumer. The column SHALL NOT be exposed on any API response
as part of this capability.

#### Scenario: New account starts with null last_active_at

- **WHEN** a new account is created via `POST /v1/auth/signup`
- **THEN** its `last_active_at` is `NULL` (no activity recorded yet)

#### Scenario: Column is day-granular

- **WHEN** `last_active_at` is written
- **THEN** it stores a calendar date (`YYYY-MM-DD`) with no time-of-day
  component, derived from the database server's `current_date`

#### Scenario: Existing accounts have null last_active_at after migration

- **WHEN** the migration adds `last_active_at` to the `accounts` table
- **THEN** all pre-existing rows have `last_active_at = NULL`
- **AND** no existing account is assigned a default activity date

### Requirement: Debounced activity write on authenticated requests

The system SHALL, on every request that successfully resolves a bearer token in
the auth resolver (`authMacro.resolve`), issue a single guarded UPDATE that sets
`accounts.last_active_at = current_date` for the resolving account **only when**
the stored value is `NULL` or strictly less than `current_date`. As a result the
column SHALL be written at most once per account per UTC day, and requests on a
day already recorded MUST match zero rows (no row version created).
`current_date` MUST be evaluated by the database, not supplied from application
clock time.

#### Scenario: First authenticated request of the day records activity

- **WHEN** an account whose `last_active_at` is `NULL` or an earlier date makes
  any authenticated request
- **THEN** exactly one `accounts` row is updated and `last_active_at` becomes
  the database's `current_date`

#### Scenario: Subsequent same-day requests are no-ops

- **WHEN** an account whose `last_active_at` already equals `current_date` makes
  another authenticated request
- **THEN** the guarded UPDATE matches zero rows
- **AND** no new row version is written for that account

#### Scenario: Concurrent same-day requests write at most once

- **WHEN** two authenticated requests for the same account, on a day not yet
  recorded, are processed concurrently
- **THEN** at most one of them updates the row and the other matches zero rows
- **AND** no error is raised by either request

#### Scenario: Activity is recorded for any authenticated route, not just login

- **WHEN** an account acts on an already-minted bearer token (e.g.
  `GET /v1/dating/deck`, `POST /v1/dating/swipes`) without calling
  `POST /v1/auth/login`
- **THEN** `last_active_at` is still updated for that account on the first such
  request of the day

### Requirement: Activity write never blocks or fails the request

The activity write SHALL be non-blocking with respect to the request it rides
on: the response MUST NOT be delayed waiting for the write, and a failure of the
write MUST NOT change the request's status or body. A write failure MUST be
reported via `captureException` (the project's existing error-reporting path)
and MUST NOT be silently swallowed.

#### Scenario: Write failure does not break the request

- **WHEN** the `last_active_at` UPDATE fails (e.g. a transient database error)
- **THEN** the authenticated request still completes with its normal response
- **AND** the failure is reported via `captureException`
- **AND** the account's `last_active_at` retains its previous value

#### Scenario: Successful write does not delay the response

- **WHEN** an authenticated request triggers the `last_active_at` update and the
  UPDATE succeeds
- **THEN** the response status and body are identical to what they would be
  without the write
- **AND** the response is not delayed waiting for the activity update (the write
  is non-blocking)

#### Scenario: Unauthenticated requests record no activity

- **WHEN** a request presents no bearer token or an invalid/expired one and the
  resolver returns `401`
- **THEN** no `accounts.last_active_at` write is attempted for any account
