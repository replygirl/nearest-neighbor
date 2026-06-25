# Testing

Testing strategy for nearest-neighbor: test inventory, how to run the
integration suite locally, CI behaviour with and without a database, the
coverage gate, and Playwright E2E.

See [docs/architecture.md](architecture.md) section 7 for the CI topology.

---

## Test inventory

| Workspace             | Runner       | DB required | Notes                                                                                                        |
| --------------------- | ------------ | ----------- | ------------------------------------------------------------------------------------------------------------ |
| `apps/web`            | `bun test`   | optional    | API + web tests; DB-touching tests skip when `DATABASE_URL` absent                                           |
| `packages/db`         | `bun test`   | optional    | Migration snapshot test; skips without DB                                                                    |
| `packages/analytics`  | `bun test`   | no          | Fully mocked PostHog client                                                                                  |
| `e2e/`                | Playwright   | yes (live)  | Separate task: `mise run test:e2e`; requires running stack                                                   |
| `apps/cli/`           | `cargo test` | no          | Rust unit tests (keychain-safe via `NBR_NO_KEYRING=1`)                                                       |
| `e2e/plugins/`        | `bun test`   | no          | Plugin hook isolation (claude/codex shell hooks + install-nbr); stub `nbr`, no keys. `mise run test:plugins` |
| `plugins/hermes/`     | `pytest`     | no          | Hermes hook unit tests (hermetic, monkeypatched). `mise run test:plugins:hermes`                             |
| `e2e/plugin-install/` | Docker       | no (Docker) | In-harness install tests (claude/codex/hermes); no model keys. `mise run test:plugins:harness`               |

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

Runs on every TypeScript/JavaScript change. Provisions a Postgres 17 service
(`DATABASE_URL` is set), but API tests still use PGlite by default because they
gate on `DATABASE_TEST_URL`, not `DATABASE_URL`. Executes:

- `mise run lint`
- `mise run format:check`
- `mise run typecheck`
- `mise run test:coverage` (non-blocking — `continue-on-error: true` until the
  95 % coverage threshold is stable)

DB-touching tests skip gracefully — `ci-bun` never fails due to a missing
database.

### `ci-rust`

Runs when `apps/cli/**` changes. Executes `mise run //apps/cli:fmt:check`,
`mise run //apps/cli:clippy`, and `mise run //apps/cli:test` (keychain-safe via
`NBR_NO_KEYRING=1`).

### `ci-plugins`

Runs when `plugins/**`, `apps/cli/**`, either `marketplace.json`, or
`e2e/plugin{s,-install}/**` changes. Executes `mise run test:plugins`,
`mise run test:plugins:hermes`, and `mise run test:plugins:harness` (Docker is
preinstalled on `ubuntu-latest`). No model API keys required.

### `ci-gate`

Single required status check. `ci-bun`, `ci-rust`, `ci-plugins` and the other
surface jobs feed into `ci-gate`. Uses `if: always()` — skipped jobs count as
passing.

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

## Plugin e2e tests (claude / codex / hermes)

The agent plugins under `plugins/` are verified at two layers — neither needs a
model API key, so there is **no token cost**.

### Layer 1 — hook isolation (fast, no Docker)

Runs the real hook code against a stub `nbr` (`e2e/plugins/fixtures/fake-nbr`)
and asserts env-file mutation, the emitted `hookSpecificOutput` JSON, the
onboarding-vs-status branch, and the Stop/delta logic.

```sh
mise run test:plugins         # claude + codex shell hooks + install-nbr (bun)
mise run test:plugins:hermes  # hermes hooks.py (pytest)
```

Both are included in `mise run check` and run in the `ci-plugins` CI job.

### Layer 2 — in-harness install (Docker, no keys)

Builds `nbr` from HEAD (never a published release) and installs the plugin into
the **real, latest** harness CLI in a container, asserting it registers:

- **Claude** — `claude plugin marketplace add` + `install` + `plugin list`, then
  runs the installed `session-start.sh` against the HEAD `nbr` and asserts the
  onboarding context (`claude --init-only` only initialises; it does not surface
  hook output).
- **Codex** — `codex plugin marketplace add` + `add` + `plugin list` + `doctor`.
- **Hermes** — uses `nousresearch/hermes-agent:latest`; enables the plugin and
  greps `hermes plugins list`.

```sh
mise run test:plugins:harness                # all three
HARNESS=claude mise run test:plugins:harness # one harness
mise run test:plugins:harness:claude         # per-harness alias
```

`run.sh` self-skips with a notice (exit 0) when no Docker daemon is reachable,
so contributors without Docker can still push. See
[e2e/plugin-install/README.md](../e2e/plugin-install/README.md) for design and
internals.

### Where each layer runs

| Gate                                     | Layer 1 (isolation) | Layer 2 (Docker harness)                                                              |
| ---------------------------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| pre-push (`HK_PROFILE=slow`, path-gated) | yes                 | yes (skips without Docker)                                                            |
| PR CI (`ci-plugins`, path-gated)         | yes                 | yes                                                                                   |
| staging (post-deploy `plugin-smoke`)     | —                   | Claude only, vs the live staging API (`mise run smoke:plugins:staging`, non-blocking) |

---

## Adding a new workspace to the coverage gate

1. Add a `test:coverage` script to the workspace's `package.json`:
   ```json
   "test:coverage": "bun test --coverage"
   ```
2. Verify `mise run test:coverage` passes.
3. Commit. The workspace is picked up automatically by `check-coverage.sh`.
