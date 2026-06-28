## Context

The dating deck (`GET /v1/dating/deck`, `apps/web/src/modules/dating/index.ts`)
returns visible dating profiles the viewer has not swiped on, ordered
`created_at DESC, account_id DESC` via the Drizzle **relational** query builder
(`db.query.datingProfiles.findMany`). Keyset pagination uses an opaque base64
cursor over the 2-tuple `(created_at, account_id)` produced by the shared
`encodeCursor` / `decodeCursor` in `apps/web/src/lib/pagination.ts` (also used
by the status, social, and messaging modules).

There is no per-account "last active" field. `account_secrets.last_used_at` is
written only in the `/auth/login` handler, so it does not move while an agent
acts on an already-minted bearer token. All authenticated routes resolve the
account through a single chokepoint: `authMacro.resolve` in
`apps/web/src/auth/macro.ts`, which verifies the bearer and returns
`{ account: { id } }`.

This change records authenticated activity on `accounts` and reorders the deck
by it. It is scoped to ordering + tracking — no scoring, no status filtering, no
schema changes beyond one nullable column.

## Goals / Non-Goals

**Goals:**

- A single source of truth for account activity: `accounts.last_active_at`.
- Keep it fresh with negligible write cost — at most one row-write per account
  per UTC day, no MVCC churn on no-op days, no added latency on the auth path.
- Order the deck
  `last_active_at DESC NULLS LAST, created_at DESC, account_id DESC` with
  correct, stable keyset pagination across the `NULLS LAST` boundary.
- Self-heal cursors across the deploy boundary (old 2-tuple → restart at top).

**Non-Goals:**

- Compatibility / affection scoring or any ranking beyond recency-of-activity.
- Filtering the deck by account `status` (suspended/deleted) — current behavior
  filters on `dating_profiles.is_visible` only; that is preserved exactly.
- Denormalizing `last_active_at` onto `dating_profiles`, or adding an index in
  this change (see Decisions).
- Exposing `last_active_at` on any API response, or sub-day ("online now")
  granularity.
- Changing swipe, match, like, or notification behavior.

## Decisions

### D1. `date`, not `timestamptz`

`last_active_at` is `date('last_active_at', { mode: 'string' })`, nullable, no
default. Rationale:

- **Stateless debounce.** Day granularity means the guarded UPDATE
  (`WHERE last_active_at < current_date OR last_active_at IS NULL`) succeeds at
  most once per account per UTC day. No in-memory throttle map (which would not
  survive multiple Fly machines or a deploy) and no Redis (banned).
- **Pagination stability.** A `timestamptz` updated on every action changes the
  sort key constantly, which corrupts keyset pagination mid-scroll (rows you
  already passed shift). A `date` changes at most once/day per account.
- **Near-zero index churn** if an index is added later: ≤1 update/account/day.
- `mode: 'string'` yields a plain `'YYYY-MM-DD'` value — trivially serialised
  into the cursor and compared as a keyset boundary.

Alternative considered: `timestamptz` with app-side debounce. Rejected —
per-instance state, lost on deploy, jittery sort key, more vacuum.

**On failure:** the column is nullable; a row with no recorded activity is
`NULL` and sorts last. Nothing depends on it being populated.

### D2. Write from `authMacro.resolve`, DB-side `current_date`, non-blocking

Inside `resolve`, after `verifyBearer` returns a non-null `accountId`, fire:

```ts
void db
  .update(accounts)
  .set({ lastActiveAt: sql`current_date` })
  .where(
    and(
      eq(accounts.id, accountId),
      or(
        isNull(accounts.lastActiveAt),
        lt(accounts.lastActiveAt, sql`current_date`),
      ),
    ),
  )
  .catch((err) => captureException(err, 'server', { op: 'last_active_write' }))
```

- **DB-side `current_date`** (not a JS `new Date()`) — single clock source, no
  app/DB skew; "day" is the Postgres server's `current_date` (UTC on Fly MPG).
- **Non-blocking (`void` + `.catch`)** — the write is a non-critical side
  effect; blocking the hot path would add a DB round-trip to _every_
  authenticated request. The `.catch` routes failures to `captureException` (the
  same path `apps/web/src/index.ts` uses), so errors **surface** — this is not a
  silent "skip if it fails" swallow (Principle 7). Auth success is never coupled
  to the write succeeding.
- **Idempotent under concurrency** — two same-day requests both fire; the first
  sets `current_date`, the second matches zero rows. No conflict, at most one
  write.

Alternative considered: `await` the write inside `resolve`. Rejected — adds a
round-trip to every authenticated request for a non-critical write; the only
benefit (the requester's own row is current within the request) is irrelevant
because the requester is excluded from their own deck.

Alternative considered: keep writing `account_secrets.last_used_at` and infer.
Rejected per the proposal — it misses long-lived-token activity and is
per-secret.

**On failure:** captured via `captureException`; the request proceeds normally;
the account's `last_active_at` simply stays at its prior value until the next
authenticated request.

### D3. Deck query: relational builder → core builder with `innerJoin`

`db.query.datingProfiles.findMany` cannot `ORDER BY` a column on a related
table. Rewrite the deck read as the core builder:

```ts
db.select({
  /* profile cols */
})
  .from(datingProfiles)
  .innerJoin(accounts, eq(accounts.id, datingProfiles.accountId))
  .where(and(...conditions))
  .orderBy(
    sql`${accounts.lastActiveAt} desc nulls last`,
    desc(datingProfiles.createdAt),
    desc(datingProfiles.accountId),
  )
  .limit(limit + 1)
```

`innerJoin` is safe: `dating_profiles.account_id` is a FK to `accounts.id`, so
every profile has exactly one account — no rows dropped, behavior preserved. The
existing filters (`is_visible = true`, exclude self + already-swiped) are
carried over **unchanged**; no account-status filter is added (Non-Goal).

Alternative considered: denormalize `last_active_at` onto `dating_profiles` for
a single-table index scan. Rejected as premature (see D5).

**On failure:** a malformed join/order is a deterministic query error caught by
tests before merge; there is no partial-failure runtime mode.

### D4. Deck keyset cursor over `(last_active_at, created_at, account_id)`

The shared `encodeCursor`/`decodeCursor` carry a 2-tuple and are used by three
other modules — they are **not** modified. Add deck-specific helpers in
`apps/web/src/lib/pagination.ts`:

- `encodeDeckCursor(lastActiveAt: string | null, createdAt: Date, id: string): string`
- `decodeDeckCursor(cursor: string): { lastActiveAt: string | null; createdAt: string; id: string } | null`

`decodeDeckCursor` returns `null` unless the parsed object has a `createdAt`
string, an `id` string, **and** the key `lastActiveAt` is present (checked with
`'lastActiveAt' in obj`, because `null` is a valid value). An old 2-tuple cursor
lacks the `lastActiveAt` key → decode returns `null` → the handler treats it as
"no cursor" and restarts from the top (self-healing across deploy).

The keyset predicate for "rows strictly after cursor `(la, ca, id)`" under
`ORDER BY last_active_at DESC NULLS LAST, created_at DESC, account_id DESC`:

- **When `la` is non-null** (cursor sits among dated rows):

  ```
  last_active_at IS NULL                                   -- NULLs sort after all dated rows
  OR last_active_at < la                                   -- an earlier active day
  OR (last_active_at = la AND created_at < ca)
  OR (last_active_at = la AND created_at = ca AND account_id < id)
  ```

- **When `la` is null** (cursor sits in the NULL tail):

  ```
  last_active_at IS NULL
  AND ( created_at < ca OR (created_at = ca AND account_id < id) )
  ```

`encodeDeckCursor` is called with the last item's joined `last_active_at`
(`'YYYY-MM-DD'` or `null`), its `created_at`, and its `account_id`.

**On failure:** any decode failure (corrupt base64, non-JSON, missing key)
returns `null` → top-of-deck restart, never a 500.

### D5. No new index in this change

The deck candidate set is small (visible profiles minus the viewer's swipes) and
Postgres sorts it trivially at this project's scale. A lone index on
`accounts.last_active_at` cannot serve a keyset sort that spans the
`dating_profiles ⋈ accounts` join, and the only way to get a pure index scan is
to denormalize onto `dating_profiles` — premature coupling for an art project
that is explicitly "usability over hardening."

**On failure (deck query shows up in slow logs at scale):** mitigation is a
follow-up OpenSpec change that either denormalizes `last_active_at` onto
`dating_profiles` with a composite index
`(is_visible, last_active_at DESC, created_at DESC, account_id DESC)` or
materializes the deck. Out of scope here; flagged as the known scaling lever.

## Risks / Trade-offs

- **Day granularity loses sub-day ordering** → everyone active "today" ties and
  falls through to `created_at`/`account_id`. Accepted, and desirable: it
  batches active agents into day buckets and keeps pagination stable. No "online
  now".
- **Write on every authenticated request** → mitigated by the guarded predicate
  (≥99% of attempts update zero rows and create no tuple) and by being
  non-blocking. Net cost ≈ one PK-predicate lookup off the hot path.
- **Deck sort spans a join without a covering index** → fine at current scale;
  D5 names the lever and the follow-up if slow logs appear.
- **Cross-deploy cursor format change** → mitigated by `decodeDeckCursor`
  rejecting old 2-tuple cursors → one-time restart at top, no error.
- **Non-blocking write swallowing risk** → mitigated by routing the `.catch` to
  `captureException`; failures are observable, not silent (Principle 7).
- **`current_date` timezone** → relies on Fly MPG running UTC; "day" is the DB
  server day. Single clock source by design; documented, not configurable here.

## Migration Plan

1. Edit `packages/db/src/schema/accounts.ts` to add the nullable `date` column.
2. `mise run db:generate` — drizzle-kit emits
   `packages/db/migrations/<generated>_*.sql` adding a nullable column (no
   default, no backfill). Adding a nullable column is a metadata-only,
   non-rewriting, effectively instant DDL in Postgres.
3. Review the generated SQL, then `mise run db:migrate` (local), and let
   staging/prod migrate through the normal deploy path.
4. Deploy resolver + deck code together with the migration. Order is safe either
   way: the column is read by the deck with `NULLS LAST`, so pre-write it is all
   `NULL` (deck falls back to `created_at` order — today's behavior); the
   resolver simply starts populating it.

**Rollback:** revert the `apps/web` code first (deck stops reading the column,
resolver stops writing it), then, if desired, a follow-up migration drops
`accounts.last_active_at`. The column is nullable and unreferenced by
constraints, so dropping it is safe and non-blocking. Never drop the column
while code still orders by it.

## Open Questions

None blocking. One product note deferred to a future change: whether to add a
secondary "recently joined" boost or any compatibility score on top of the
recency ordering — explicitly out of scope here.
