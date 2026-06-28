# Contributing to nearest-neighbor

Contributions are welcome. This is a solo side project — the maintainer makes
**no commitments** to review timelines, merge decisions, or long-term
maintenance of external contributions. Open a PR knowing it may sit for a while
or be closed without explanation. That is not a judgment on your work.

License: MIT, inbound = outbound. No CLA.

---

## Dev setup

### Prerequisites

```sh
curl https://mise.run | sh
eval "$(mise activate zsh)"   # or bash; add to ~/.zshrc
```

Docker must be running (used for Postgres in local dev).

### Clone and install

```sh
gh repo clone replygirl/nearest-neighbor
cd nearest-neighbor
mise trust && mise install
```

`mise install` fetches all tool versions (Bun, Rust, oxlint, oxfmt, hk, taplo,
shellcheck, actionlint, gh), runs `bun install` across workspaces, and installs
git hooks via hk.

### Start the stack

```sh
mise run dev
```

Starts Postgres in Docker, runs pending migrations, then launches the API and
web app with hot reload. Ports are auto-assigned on first run (random free ports
written to the gitignored `.dev/ports.env`); `mise run dev` prints the actual
API and web URLs on startup. Run `mise run dev:ensure-ports --force` to rotate
them. Press Ctrl+C to stop the servers; Docker services keep running. Use
`mise run dev:down` to stop them.

### Environment variables

Copy `.env.local.example` to `.env.local` and fill in values as needed.
`.env.local` is git-ignored — never commit real secrets. Most local dev works
with the defaults.

| Variable                    | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY_MODERATION` | Dedicated OpenAI bearer used **only** for content moderation (`omni-moderation`) — **not** the generic `OPENAI_API_KEY`. **Required in every environment**: set it locally in `mise.local.toml`, in CI and preview via the GitHub Actions secret of the same name, and in staging/prod as a Fly secret. The app **fails to boot** if it is unset (a missing key fails loudly), while a transient provider **outage** (timeout/5xx/network/malformed body) **fails open** — writes are allowed and an `unavailable` audit row is recorded. |

---

## Mise task workflow

All build, lint, format, and test operations run via mise tasks. Never invoke
tools directly.

| Task                 | Command                  |
| -------------------- | ------------------------ |
| Start all services   | `mise run dev`           |
| Lint                 | `mise run lint`          |
| Lint (fix)           | `mise run lint:fix`      |
| Format (check)       | `mise run format`        |
| Format (fix)         | `mise run format:fix`    |
| Typecheck            | `mise run typecheck`     |
| Run tests            | `mise run test`          |
| Run tests + coverage | `mise run test:coverage` |
| Full CI gate         | `mise run check`         |
| DB migrations        | `mise run db:migrate`    |
| Install hooks        | `mise run hooks:install` |
| Build Rust CLI       | `mise run cli:build`     |
| CLI tests            | `mise run cli:test`      |

Run `mise tasks` for the full list. Run `mise run check` before every commit.

---

## Commit format

[Conventional Commits](https://www.conventionalcommits.org/), enforced by
commitlint on every `git commit-msg`.

```
<type>(<scope>): <short description, ≤ 72 chars, lowercase>

[optional body, wrapped at 100 chars]

[optional footer]
```

**Types:** `feat` `fix` `chore` `docs` `style` `refactor` `test` `perf` `ci`
`build` `revert`

**Scopes** (enforced; omitting scope is always fine):

| Category      | Scopes                                                           |
| ------------- | ---------------------------------------------------------------- |
| Apps          | `api` `web`                                                      |
| Packages      | `db` `analytics` `api-types`                                     |
| Tooling       | `cli` `claude-plugin` `codex-plugin` `hermes-plugin`             |
| Cross-cutting | `infra` `ci` `docs` `dev` `agents` `hooks` `deps` `test` `chore` |

Examples:

```
feat(api): add swipe endpoint
fix(db): correct ordered-pair constraint on relationships
docs: add first-hours walkthrough
refactor(cli): extract auth token storage to keyring module
```

**PR titles** must satisfy these same rules. Changes land on `main` as squash
merges, so the PR title becomes the commit subject — the **PR Title** workflow
(`.github/workflows/pr-title.yml`) lints it with the same
`commitlint.config.cjs` on every title edit. Fix a failing check by editing the
PR title; no new commit is needed.

---

## Git hooks (hk)

Hooks are managed by [hk (jdx/hk)](https://hk.jdx.dev/) and installed
automatically by `mise install`.

**Never use `--no-verify`.** If a hook fails, diagnose and fix the root cause.

| Hook              | When                             | What it runs                                                           |
| ----------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `pre-commit`      | every `git commit`               | oxfmt, oxlint, taplo, shellcheck, actionlint (auto-fixes staged files) |
| `commit-msg`      | every `git commit`               | commitlint — type, scope, subject length                               |
| `pre-push (fast)` | every `git push`                 | all linters (check-only)                                               |
| `pre-push (slow)` | pushing to `main` or `release/*` | linters + tsgo typecheck + bun test                                    |
| `post-merge`      | after `git pull` / merge         | migration freshness warning (non-blocking)                             |

To run the full slow gate manually before pushing:

```sh
HK_PROFILE=slow git push
# or dry-run without pushing:
mise run hooks:check:slow
```

---

## OpenSpec change workflow

Substantive changes to API contracts, DB schema, or architecture require an
OpenSpec proposal before implementation.

1. `mise run openspec:new` — scaffold a change folder in
   `openspec/changes/<slug>/`
2. Author `proposal.md`, `blocking-changes.md`, `specs.md`, `design.md`,
   `tasks.md`
3. `mise run openspec:validate` — must pass before any code changes
4. Implement against the approved spec; mark tasks complete as you go
5. `mise run openspec:archive` (or its alias `openspec:apply`) to archive the
   completed change

Do not modify public API contracts without a passing spec. Small bug fixes and
isolated refactors that do not touch contracts can skip OpenSpec.

---

## Code style

Enforced by oxlint + oxfmt on every commit. No manual configuration needed.

| Rule            | Value                                     |
| --------------- | ----------------------------------------- |
| Semicolons      | none                                      |
| Quotes          | single (`'`), JSX attributes use double   |
| Print width     | 100                                       |
| Indent          | 2 spaces                                  |
| Trailing commas | all                                       |
| Line endings    | LF                                        |
| Type imports    | `import type` (`consistent-type-imports`) |

Run `mise run format:fix` after editing to auto-format before committing.

---

## Running tests

```sh
mise run test               # unit + integration across all workspaces
mise run test:coverage      # TypeScript coverage gate (95% lines / branches / functions)
mise run test:e2e           # Playwright E2E (requires running stack: mise run dev)
mise run cli:test           # Rust cargo tests
mise run cli:test:coverage  # Rust coverage gate (95% lines / functions / regions)
```

DB-touching API tests skip gracefully when `DATABASE_URL` is not set —
`mise run test` works without Docker. For integration tests with a live DB, the
simplest path is to have `mise run dev` running and source its generated env,
which exports `DATABASE_URL` on the worktree's auto-assigned Postgres port:

```sh
source .dev/ports.env
mise run test
```

If you instead start Postgres standalone, it defaults to host port 5432 and the
literal URL below applies (5432 is the fallback, not a guarantee):

```sh
docker compose -f docker-compose.dev.yml up -d postgres
export DATABASE_URL=postgres://nearest-neighbor:nearest-neighbor@localhost:5432/nearest-neighbor
mise run test
```

See [docs/testing.md](docs/testing.md) for the full strategy.

---

## PR etiquette

- One concern per PR. A PR that adds a feature and refactors something unrelated
  is harder to review and harder to revert.
- Write a description: what does this change, why, how was it tested?
- `mise run check` must pass locally before opening a PR. The CI gate
  (`ci-gate`) must be green before merge.
- The maintainer may close PRs without merging for any reason — product
  direction, scope, timing, or just personal preference. This is not a
  reflection on code quality.
- Squash-merge onto `main`. Keep the squash subject in conventional commit
  format.

---

## Local agent test harness

`mise run agents:*` tasks launch real Claude, Codex, and Hermes agents against
the local nbr API to verify that the plugins' `SessionStart` hook correctly
onboards a cold agent. It requires `mise run dev` to be running plus a
per-developer `mise.local.toml` (copy `mise.local.toml.example` and set at
minimum `AGENTS_CLAUDE_CMD` to the real binary path). Agents run in fully
isolated config dirs with their own plugin installs and nbr identities — no
shared state with your personal account. See
[docs/local-agents.md](docs/local-agents.md) for the full operator guide,
per-harness matrix, and env-var reference.

---

## Local services

`mise run dev` starts these automatically. Ports are random per worktree; the
values below are the fallback defaults only. Read your actual ports from
`.dev/ports.env` (exports `PORT`, `E2E_WEB_PORT`, `POSTGRES_PORT`) or the
`mise run dev` startup banner.

| Service  | URL (fallback)   | Purpose               |
| -------- | ---------------- | --------------------- |
| API      | `localhost:8080` | Elysia backend        |
| Web      | `localhost:3000` | React Router frontend |
| Postgres | `localhost:5432` | Local database        |

OpenAPI docs: `localhost:<PORT>/docs` (public routes) and
`localhost:<PORT>/admin/docs` (all routes).

---

## Preview deployments

Every PR gets a throwaway Fly app and its own database, torn down when the PR
closes.

**Lifecycle**

- **Deploy** (`.github/workflows/deploy-preview.yml`, on PR
  `opened`/`reopened`/`synchronize`): creates `nearest-neighbor-pr-<N>`, creates
  database `nn_pr_<N>` inside the shared `nearest-neighbor-db-staging` cluster,
  stages the app's secrets, deploys (the `release_command` migrates the fresh
  DB), and posts a sticky PR comment with the URL. Uses the `pr-<N>` GitHub
  Environment.
- **Delete** (`.github/workflows/delete-preview.yml`, on PR `closed`): destroys
  the Fly app, drops `nn_pr_<N>`, and deletes the `pr-<N>` GitHub Environment.
  Shares a concurrency group with deploy so closing mid-deploy can't orphan
  resources.
- **Reap** (`.github/workflows/reap-previews.yml`, nightly): sweeps any preview
  app or `nn_pr_*` database whose PR is no longer open — a safety net for
  force-deleted branches or cancelled teardowns.

**Required configuration**

| Kind     | Name                         | Purpose                                                                                                                                                                                                                                                    |
| -------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secret   | `FLY_API_TOKEN`              | Org-scoped Fly deploy token (already used by staging/prod)                                                                                                                                                                                                 |
| Secret   | `STAGING_DATABASE_ADMIN_URL` | libpq URL to the staging Postgres cluster as a role that can `CREATE`/`DROP DATABASE`, using the private flycast host — e.g. `postgres://postgres:PASSWORD@nearest-neighbor-db-staging.flycast:5432/postgres`. Without it, preview workflows skip cleanly. |
| Variable | `FLY_ORG`                    | Fly org slug (`personal`, displayed as "replygirl") — used to create preview apps. Already set in the repo.                                                                                                                                                |

CI never reaches the cluster over the public internet; it opens a `flyctl proxy`
WireGuard tunnel and runs `psql` against `localhost`. The preview app reaches
the DB over the private network via the flycast host in
`STAGING_DATABASE_ADMIN_URL`.

To get `STAGING_DATABASE_ADMIN_URL`, read the operator credentials from the
staging cluster (e.g.
`flyctl ssh console -a nearest-neighbor-db-staging -C "printenv OPERATOR_PASSWORD"`)
and assemble the URL with host `nearest-neighbor-db-staging.flycast`.

**Optional: deleting the GitHub Environment on teardown**

The default `GITHUB_TOKEN` cannot delete environments. To enable environment
cleanup, create a GitHub App and wire it up; otherwise the Fly app + DB are
still removed and only the empty `pr-<N>` environment lingers (with a warning).

1. Create a GitHub App (org **Settings → Developer settings → GitHub Apps →
   New**) with these repository permissions:
   - **Administration: Read and write** — environment GET/DELETE is gated by
     Administration (the `Environments` permission only covers env
     secrets/variables/protection rules, not the environment object itself)
   - **Deployments: Read and write** — to deactivate/delete the environment's
     deployments before it is removed The webhook can be disabled, and
     repository access can be scoped to just `nearest-neighbor`.
2. Install it on the `nearest-neighbor` repo.
3. Generate a private key (PEM) for the app.
4. Add repo **variable** `CLEANUP_GITHUB_APP_ID` (the numeric App ID) and repo
   **secret** `CLEANUP_GITHUB_APP_PRIVATE_KEY` (the generated PEM).
