# Testing

This document covers the testing strategy for Nearest Neighbor — how tests are
structured, how to run the integration suite locally, how CI handles
database-dependent tests, and what happens when postgres is unavailable.

See also [docs/architecture.md](architecture.md) for the CI topology diagram
(section 7).

<!-- TODO: update test counts and workspace list once workspaces are built -->

---

## Test inventory by workspace

| Workspace            | Runner       | Tests | Notes                                                               |
| -------------------- | ------------ | ----- | ------------------------------------------------------------------- |
| `apps/api`           | `bun test`   | TBD   | DB-touching tests opt in via `setup.ts`; skip gracefully without DB |
| `apps/web`           | `vitest run` | TBD   | No DB required                                                      |
| `packages/db`        | `bun test`   | TBD   | Migration snapshot test requires DB; exits cleanly without          |
| `packages/analytics` | `bun test`   | TBD   | Fully mocked PostHog; no DB required                                |
| `e2e/`               | Playwright   | TBD   | Separate task: `mise run test:e2e`; requires running services       |

---

## Local: full integration suite

The API integration tests touch real Postgres. Run them locally with:

```bash
# 1. Boot postgres
docker compose -f docker-compose.dev.yml up -d postgres

# 2. Export the test database URL
export DATABASE_TEST_URL=postgres://nearest-neighbor:nearest-neighbor@localhost:5432/nearest-neighbor_test
export DATABASE_URL=postgres://nearest-neighbor:nearest-neighbor@localhost:5432/nearest-neighbor_test

# 3. Create the test DB if it doesn't exist yet
psql postgres://nearest-neighbor:nearest-neighbor@localhost:5432/nearest-neighbor \
  -c 'CREATE DATABASE nearest-neighbor_test;' 2>/dev/null || true

# 4. Apply migrations
bun run packages/db/src/migrate.ts

# 5. Run all tests
mise run test
```

To tear down:

```bash
docker compose -f docker-compose.dev.yml down
```

---

## CI: integration tests

<!-- TODO: fill in once .github/workflows/ci.yml is created -->

### `ci-bun`

Runs on every TypeScript/JavaScript change. Executes:

- `mise run lint`
- `mise run format:check`
- `mise run typecheck`
- `mise run test:coverage`

Does **not** boot postgres. DB-touching tests skip gracefully (see below).

### `ci-integration`

Runs when `apps/api/**`, `packages/db/**`, or `packages/api-types/**` change.
Uses a GitHub Actions `services:` block to boot a real postgres container:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: nearest-neighbor_test
    ports:
      - 5432:5432
    options: >-
      --health-cmd pg_isready --health-interval 10s --health-timeout 5s
      --health-retries 5
```

### `ci-gate`

Both `ci-bun` and `ci-integration` feed into `ci-gate` (the only required
branch-protection check). Uses `if: always()` — skipped jobs count as passing.

---

## What runs vs what skips without a database

Tests that import `setup.ts` exit 0 when `DATABASE_TEST_URL`/`DATABASE_URL` is
absent — the whole file is skipped, not marked as failed:

```ts
if (!testUrl) {
  console.warn(
    '[test] DATABASE_TEST_URL/DATABASE_URL not set; skipping db-touching tests.',
  )
  process.exit(0)
}
```

This means:

- `mise run test` in a fresh checkout exits 0
- CI `ci-bun` never fails due to missing DB
- Contributors can run unit tests without any Docker setup

---

## Coverage gate

`scripts/check-coverage.sh` enforces minimum coverage percentages across every
workspace that declares a `test:coverage` script in its `package.json`. Invoked
automatically by `mise run test:coverage` and included in `mise run check`.

### Thresholds

| Metric    | Default | Env var override                          |
| --------- | ------- | ----------------------------------------- |
| Lines     | 95 %    | `NEAREST_NEIGHBOR_COVERAGE_MIN_LINES`     |
| Branches  | 80 %    | `NEAREST_NEIGHBOR_COVERAGE_MIN_BRANCHES`  |
| Functions | 95 %    | `NEAREST_NEIGHBOR_COVERAGE_MIN_FUNCTIONS` |

Branch coverage defaults to 80% because Bun's LCOV emitter frequently reports 0
branch totals for pure-function modules.

Override thresholds locally without editing the script:

```bash
NEAREST_NEIGHBOR_COVERAGE_MIN_LINES=80 mise run test:coverage
```

### Skip list

No workspaces are initially in the skip list. Add workspaces here while their
test runner is being wired up (remove once done).

### Output

```
| workspace             | lines%  | branches% | functions% | status |
|------------------------|---------|-----------|------------|--------|
| packages/analytics    | 100.00% |   100.00% |    100.00% | pass   |
| packages/db           | 97.50%  |    85.00% |     96.00% | pass   |

Thresholds: lines >= 95%  branches >= 80%  functions >= 95%
Results: 2 passed, 0 failed, 0 skipped
```

### Adding a new workspace to the gate

Add a `test:coverage` script to its `package.json` (e.g.
`"test:coverage": "bun test --coverage"`) and verify `mise run test:coverage`
passes before committing.

---

## E2E tests (Playwright)

<!-- TODO: fill in once e2e/ is scaffolded -->

```sh
mise run test:e2e   # requires running API + web
```

E2E tests are NOT in the `ci-bun` gate. They run in a separate CI job (or
manually) against a live staging/preview environment.
