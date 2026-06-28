## 1. Schema: `accounts.last_active_at`

- [x] 1.1 Add a nullable `date` column to the `accounts` table in
      `packages/db/src/schema/accounts.ts`; import `date` from
      `drizzle-orm/pg-core`. Column definition:

  ```ts
  lastActiveAt: date('last_active_at', { mode: 'string' }),
  ```

  - Verify: `mise run typecheck` passes; `Account` now includes
    `lastActiveAt: string | null`.

- [x] 1.2 Generate the migration with `mise run db:generate`.
  - Verify: a new file under `packages/db/migrations/` contains
    `ALTER TABLE "accounts" ADD COLUMN "last_active_at" date;` — nullable, no
    default, no backfill. Review it: there must be **no** table rewrite and
    **no** `NOT NULL`.
- [x] 1.3 Apply locally with `mise run db:migrate` against the local dev DB.
  - Verify: `mise run db:migrate:check` reports no pending/drift; the column
    exists as `date` and nullable.

## 2. Activity write in the auth resolver

- [x] 2.1 In `apps/web/src/auth/macro.ts`, after `verifyBearer` returns a
      non-null `accountId` and before returning `{ account: { id } }`, fire a
      guarded, **non-blocking** UPDATE (not awaited). Import `db`, `accounts`
      from `@nearest-neighbor/db`, the `drizzle-orm` helpers (`and`, `eq`, `or`,
      `isNull`, `lt`, `sql`), and `captureException` from
      `@nearest-neighbor/analytics/node`:

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
    .catch((err) =>
      captureException(err, 'server', { op: 'last_active_write' }),
    )
  ```

  - Verify: `mise run typecheck` and `mise run lint` pass (no floating-promise
    or `no-console` warnings).

- [x] 2.2 Add a resolver test (`apps/web/src/auth/macro.test.ts`, or the nearest
      existing auth test) asserting: (a) the first authenticated request of the
      day sets `last_active_at` to today; (b) a second same-day authenticated
      request updates zero rows (value unchanged); (c) an unauthenticated `401`
      request triggers no write. Covers spec: _Debounced activity write on
      authenticated requests_.
  - Verify: `mise run test` passes for the new cases.
- [x] 2.3 Add a test asserting the request still succeeds and `captureException`
      is invoked when the activity UPDATE rejects (force the write to throw).
      Covers spec: _Activity write never blocks or fails the request_.
  - Verify: `mise run test` passes; the request returns its normal 2xx response
    despite the write error.

## 3. Deck cursor helpers

- [x] 3.1 In `apps/web/src/lib/pagination.ts`, add two deck-specific helpers,
      leaving the existing `encodeCursor` / `decodeCursor` / `CursorPayload`
      untouched:

  ```ts
  export function encodeDeckCursor(
    lastActiveAt: string | null,
    createdAt: Date,
    id: string,
  ): string
  export function decodeDeckCursor(
    cursor: string,
  ): { lastActiveAt: string | null; createdAt: string; id: string } | null
  ```

  `decodeDeckCursor` returns `null` unless the decoded object has a string
  `createdAt`, a string `id`, **and** the key `lastActiveAt` present (use
  `'lastActiveAt' in obj`, since `null` is a valid value).

  - Verify: `mise run typecheck` passes.

- [x] 3.2 Extend `apps/web/src/__tests__/pagination.test.ts`: round-trip with a
      non-null and a `null` `lastActiveAt`; `decodeDeckCursor` returns `null`
      for corrupt base64, non-JSON, and a legacy 2-tuple `{ createdAt, id }`
      payload (missing `lastActiveAt`). Covers spec: _Deck cursor is
      self-healing across format changes_.
  - Verify: `mise run test` passes for the new cases.

## 4. Deck reorder + keyset pagination

- [x] 4.1 In `apps/web/src/modules/dating/index.ts`, rewrite the `GET /deck`
      query from `db.query.datingProfiles.findMany` to the core builder so it
      can order by a joined column. Select the same profile columns the response
      already returns (do **not** add `last_active_at` to the response).
      Preserve the existing filters exactly (`is_visible = true`, exclude self +
      already-swiped); add **no** account-status filter. Import `accounts`:

  ```ts
  db.select({
    /* existing profile columns only */
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

  - Verify: `mise run typecheck` passes; `DatingProfileShape` is unchanged.

- [x] 4.2 Replace the cursor handling: decode the incoming cursor with
      `decodeDeckCursor` and build the keyset predicate per `design.md` D4 — the
      non-null-`la` branch and the null-`la` tail branch:

  ```text
  -- cursor (la, ca, id), la NOT NULL:
  last_active_at IS NULL
    OR last_active_at < la
    OR (last_active_at = la AND created_at < ca)
    OR (last_active_at = la AND created_at = ca AND account_id < id)

  -- cursor (la, ca, id), la IS NULL (NULL tail):
  last_active_at IS NULL
    AND (created_at < ca OR (created_at = ca AND account_id < id))
  ```

  Emit the next cursor with
  `encodeDeckCursor(lastItem.lastActiveAt, lastItem.createdAt, lastItem.accountId)`.

  - Verify: `mise run typecheck` and `mise run lint` pass.

- [x] 4.3 Add/extend deck integration tests in `apps/web/src/modules/dating/`
      covering: ordering by `last_active_at DESC`; `NULL`-activity profiles sort
      last; same-day tie falls back to `created_at`/`account_id`; deterministic
      repeat ordering; filters unchanged (self / swiped / invisible excluded).
      Covers spec: _Deck ordered by recency of activity_ and _Deck filtering is
      unchanged_.
  - Verify: `mise run test` passes.
- [x] 4.4 Add deck pagination tests covering: a full page then next page with no
      overlap/gap within dated rows; the `NULLS LAST` transition page (dated
      rows then null rows, no overlap/gap); a boundary within the null tail; the
      final page returns `next_cursor: null`; a legacy 2-tuple cursor restarts
      at the top without error. Covers spec: _Deck keyset pagination over the
      activity ordering_ and _Deck cursor is self-healing across format
      changes_.
  - Verify: `mise run test` passes.

## 5. Full verification gate

- [x] 5.1 `mise run lint && mise run format` both pass (no warnings/errors).
- [x] 5.2 `mise run typecheck` passes (`tsgo --noEmit` clean).
- [x] 5.3 `mise run test:coverage` passes and meets the project coverage bar
      (95%+); the new resolver, cursor, and deck branches are covered.
- [x] 5.4 `mise run check` passes locally for every TS/JS gate (lint,
      format:check, typecheck, test, web test:coverage 97%+, openspec:validate).
      The Rust `cli:test:coverage` step fails only in this local sandbox (the
      coverage process is killed); this change touches no `apps/cli/**`, so CI's
      path-filtered `ci-rust` does not run for this PR.

## 6. Spec review (gate before `mise run openspec:archive`)

The five reviewer agents are read-only Claude Code subagents defined in
`.claude/agents/openspec-review-*.md`. The implementing agent runs each via the
Agent tool with the matching `subagent_type` and resolves CRITICAL findings
in-flow before proceeding to apply. Escalate to the human only when a fix has
substantive impact or reaches beyond this change's scope.

> **Apply note:** the five `openspec-review-*` agents are **not present** in
> this repo (only `implementer` and `researcher` exist under `.claude/agents/`),
> so 6.1–6.5 could not run as written and stay unchecked. An equivalent
> independent adversarial review (general-purpose agent) ran instead and
> returned **PASS** with zero CRITICAL findings — including a worked proof that
> the deck keyset predicate is gap- and duplicate-free (`account_id` is the
> `dating_profiles` PK → strict total order). Reconciling these missing agent
> definitions with the names mandated by `openspec/config.yaml` is a repo-level
> follow-up, out of scope for this change.

- [ ] 6.1 Run principles reviewer
  - `subagent_type: openspec-review-principles-reviewer`
  - Input: `openspec/changes/add-last-active-deck-sort/`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 6.2 Run cross-proposal reviewer
  - `subagent_type: openspec-review-cross-proposal-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 6.3 Run tasks-granularity reviewer
  - `subagent_type: openspec-review-tasks-granularity-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 6.4 Run spec-quality reviewer
  - `subagent_type: openspec-review-spec-quality-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 6.5 Run decision-compliance reviewer
  - `subagent_type: openspec-review-decision-compliance-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [x] 6.6 `mise run openspec:validate` exits 0
