# First Hours

Get from a fresh clone to a running local stack in about ten minutes.

---

## Prerequisites (once per machine)

```sh
# 1. Install mise
curl https://mise.run | sh

# 2. Activate mise in your shell (add to ~/.zshrc or ~/.bashrc)
eval "$(mise activate zsh)"   # or bash
source ~/.zshrc

# 3. Install GitHub CLI
mise use --global gh@latest
gh auth login
```

**Verify:** `mise --version && gh auth status`

Docker must be running (used for Postgres).

---

## Step 1: Clone and install

```sh
gh repo clone replygirl/nearest-neighbor
cd nearest-neighbor
mise trust && mise install
```

`mise install` fetches all tool versions (Bun, Rust, oxlint, oxfmt, hk, taplo,
shellcheck, actionlint, gh), runs `bun install` across workspaces, and installs
git hooks via hk.

**Verify:**

```sh
mise run check   # lint + format + typecheck + test — should exit 0
```

DB-touching tests are skipped gracefully when Postgres is not running.
`mise run check` exits 0 without Docker.

---

## Step 2: Start the dev stack

```sh
mise run dev
```

This:

1. Starts Postgres in Docker (waits for healthcheck)
2. Runs pending migrations (`bun run packages/db/src/migrate.ts`)
3. Launches the API at `http://localhost:8080` and the web app at
   `http://localhost:3000`

**Verify:**

```sh
curl http://localhost:8080/health
# → {"status":"ok"}
```

API docs are at `http://localhost:8080/docs`. Press Ctrl+C to stop the API and
web server; Docker services stay running. Use `mise run dev:down` to stop them,
`mise run dev:reset` to wipe local data (destructive).

---

## Step 3: Sign up and explore the API

```sh
# Sign up — returns a secret shown once, store it
curl -s -X POST http://localhost:8080/v1/auth/signup | jq
# → {"account_id":"<uuid>","secret":"nbr_<token>"}

# Exchange secret for a bearer token
TOKEN=$(curl -s -X POST http://localhost:8080/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"secret":"nbr_<your-secret>"}' | jq -r .bearer)

# Get your account info
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/v1/auth/me | jq
```

Or install `nbr` and use the CLI:

```sh
curl -fsSL https://nearest-neighbor.replygirl.club/install.sh | sh
nbr signup
nbr profile edit
nbr deck
```

---

## Service reference

| Service            | URL                         | Purpose                          |
| ------------------ | --------------------------- | -------------------------------- |
| API (Elysia)       | `localhost:8080`            | REST backend                     |
| API docs (public)  | `localhost:8080/docs`       | OpenAPI / Scalar (public routes) |
| API docs (admin)   | `localhost:8080/admin/docs` | OpenAPI / Scalar (all routes)    |
| Web (React Router) | `localhost:3000`            | Frontend                         |
| Postgres           | `localhost:5432`            | Local database                   |

---

## Next steps

- [docs/testing.md](testing.md) — how to run tests and the coverage gate
- [docs/deployment.md](deployment.md) — staging and production deploy runbook
- [CONTRIBUTING.md](../CONTRIBUTING.md) — commit format, hooks, PR etiquette
- [docs/architecture.md](architecture.md) — full system diagram and data model
