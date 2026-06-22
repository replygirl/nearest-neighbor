# Testing

Testing strategy for nearest-neighbor: test inventory, how to run the
integration suite locally, CI behaviour with and without a database, the
coverage gate, and Playwright E2E.

See [docs/architecture.md](architecture.md) section 7 for the CI topology.

---

## Test inventory

| Workspace            | Runner       | DB required | Notes                                                              |
| -------------------- | ------------ | ----------- | ------------------------------------------------------------------ |
| `apps/web`           | `bun test`   | optional    | API + SPA tests; DB-touching tests skip when `DATABASE_URL` absent |
| `packages/db`        | `bun test`   | optional    | Migration snapshot test; skips without DB                          |
| `packages/analytics` | `bun test`   | no          | Fully mocked PostHog client                                        |
| `e2e/`               | Playwright   | yes (live)  | Separate task: `mise run test:e2e`; requires running stack         |
| `apps/cli/`          | `cargo test` | no          | Rust unit tests (keychain-safe via `NBR_NO_KEYRING=1`)             |

---

## Unit tests (no database required)

```sh
mise run test
```

DB-touching tests exit 0 when `DATABASE_URL` is absent — the whole file is
skipped, not marked as failed:

```ts
if (!testUrl) {
  console.warn('[test] DATABASE_URL not set; skipping db-touching tests.')
  process.exit(0)
}
```

`mise run test` in a fresh checkout exits 0. Contributors can run unit tests
without Docker.

---

## Integration tests (with a live Postgres)

The API tests that touch real Postgres use PGlite for isolation in CI and a real
Postgres instance for local integration runs.

### Local integration suite

```sh
# 1. Start Postgres
docker compose -f docker-compose.dev.yml up -d postgres

# 2. Export the test database URL
export DATABASE_URL=postgres://nearest-neighbor:nearest-neighbor@localhost:5432/nearest-neighbor

# 3. Apply migrations
mise run db:migrate

# 4. Run all tests
mise run test
```

Tear down:

```sh
docker compose -f docker-compose.dev.yml down
```

---

## CI

### `ci-bun`

Runs on every TypeScript/JavaScript change. Does **not** boot Postgres.
Executes:

- `mise run lint`
- `mise run format:check`
- `mise run typecheck`
- `mise run test:coverage`

DB-touching tests skip gracefully — `ci-bun` never fails due to a missing
database.

### `ci-rust`

Runs when `apps/cli/**` changes. Executes `mise run //apps/cli:fmt:check`,
`mise run //apps/cli:clippy`, and `mise run //apps/cli:test` (keychain-safe via
`NBR_NO_KEYRING=1`).

### `ci-gate`

Single required status check. `ci-bun` and `ci-rust` feed into `ci-gate`. Uses
`if: always()` — skipped jobs count as passing.

---

## Coverage gate

`scripts/check-coverage.sh` enforces minimum coverage across every workspace
that declares a `test:coverage` script. Invoked by `mise run test:coverage` and
included in `mise run check`.

### Thresholds

| Metric    | Default | Env var override                          |
| --------- | ------- | ----------------------------------------- |
| Lines     | 95 %    | `NEAREST_NEIGHBOR_COVERAGE_MIN_LINES`     |
| Branches  | 80 %    | `NEAREST_NEIGHBOR_COVERAGE_MIN_BRANCHES`  |
| Functions | 95 %    | `NEAREST_NEIGHBOR_COVERAGE_MIN_FUNCTIONS` |

Branch coverage defaults to 80% because Bun's LCOV emitter frequently reports 0
branch totals for pure-function modules.

Override locally without editing the script:

```sh
NEAREST_NEIGHBOR_COVERAGE_MIN_LINES=80 mise run test:coverage
```

### Output

```
| workspace             | lines%  | branches% | functions% | status |
|------------------------|---------|-----------|------------|--------|
| packages/analytics    | 100.00% |   100.00% |    100.00% | pass   |
| packages/db           | 97.50%  |    85.00% |     96.00% | pass   |

Thresholds: lines >= 95%  branches >= 80%  functions >= 95%
Results: 2 passed, 0 failed, 0 skipped
```

---

## Rust CLI tests

```sh
mise run cli:test    # cargo test in apps/cli/ (keychain-safe)
mise run cli:clippy  # cargo clippy --all-targets -- -D warnings
```

---

## E2E tests (Playwright)

E2E tests live in `e2e/` and run against a live stack with Playwright (Chromium,
Firefox, WebKit). They are not in the `ci-bun` gate; they run in a separate
`ci-e2e` job or manually against a staging/preview environment.

```sh
# Terminal 1 — start the full stack
mise run dev

# Terminal 2 — run the E2E suite
mise run test:e2e
```

Install Playwright browsers once (or after a version bump):

```sh
bunx playwright install chromium firefox webkit
```

Open the interactive UI:

```sh
mise run test:e2e:ui
```

Update visual regression baselines (Linux CI only — macOS font rendering
differs):

```sh
mise run test:e2e:update
```

---

## Adding a new workspace to the coverage gate

1. Add a `test:coverage` script to the workspace's `package.json`:
   ```json
   "test:coverage": "bun test --coverage"
   ```
2. Verify `mise run test:coverage` passes.
3. Commit. The workspace is picked up automatically by `check-coverage.sh`.
