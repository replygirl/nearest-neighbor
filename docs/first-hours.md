# First Hours

This guide walks you through bootstrapping Nearest Neighbor — from cloning to
your first production release.

<!-- TODO: update with product-specific details once bootstrap scripts exist -->

---

## Prerequisites (one-time, per machine)

```sh
# 1. Install mise (version manager + task runner)
curl https://mise.run | sh

# 2. Add to your shell profile (~/.zshrc or ~/.bashrc)
eval "$(mise activate zsh)"   # or bash
source ~/.zshrc

# 3. Install GitHub CLI globally
mise use --global gh@latest
gh auth login

# 4. Install Fly CLI globally
mise use --global flyctl@latest
fly auth login
```

**Verify by:** `mise --version && gh auth status && fly auth whoami`

---

## Step 1: Clone and install

```sh
gh repo clone replygirl/nearest-neighbor
cd nearest-neighbor
mise trust && mise install
```

`mise install` fetches all tools, runs `bun install` across workspaces, installs
git hooks via `hk install --mise`.

**Verify by:**

```sh
mise run check   # lint + format + typecheck + test — should exit 0
```

See [docs/testing.md](testing.md) for the full test topology.

---

## Step 2: Provision backing services

> Requires a Fly account with billing enabled (org: `replygirl`).

```sh
mise run bootstrap:provision
```

The script prompts for:

- **Fly org slug** — `replygirl`
- **Region** — default `iad`

Resources created:

| Resource            | Name                          |
| ------------------- | ----------------------------- |
| MPG prod cluster    | `nearest-neighbor-prod-pg`    |
| MPG staging cluster | `nearest-neighbor-staging-pg` |

All secrets are staged to the Fly app vaults.

**Verify by:**

```sh
fly apps list | grep nearest-neighbor
fly secrets list --app nearest-neighbor-staging
```

---

## Step 3: PostHog projects

> Requires a PostHog Cloud account and a personal API key.

```sh
mise run bootstrap:posthog
```

The script creates 4 projects:

| Name                           | Description                                           |
| ------------------------------ | ----------------------------------------------------- |
| `nearest-neighbor-production`  | Production analytics                                  |
| `nearest-neighbor-staging`     | Staging analytics                                     |
| `nearest-neighbor-preview`     | Shared across all PR previews (filter by `pr_number`) |
| `nearest-neighbor-development` | Optional; for local opt-in                            |

After the script runs, set the remaining GitHub secrets:

```sh
gh secret set POSTHOG_KEY_PREVIEW
gh variable set POSTHOG_HOST --body "https://us.i.posthog.com"
```

---

## Step 4: Set GitHub secrets and variables

```sh
# Fly API token — org-scoped deploy token
gh secret set FLY_API_TOKEN

# Non-secret config
gh variable set FLY_ORG    --body "replygirl"
gh variable set FLY_REGION --body "iad"
```

**Verify by:** `gh secret list && gh variable list`

---

## Step 5: First staging push

1. Create your `.env.local` from `.env.local.example` and fill in required
   values.
2. Push to `main`:
   ```sh
   git push origin main
   ```
3. Watch CI:
   ```sh
   gh run watch
   ```
4. Verify staging is healthy:
   ```sh
   curl https://nearest-neighbor-staging.fly.dev/health
   ```
   Expected: `{ "status": "ok" }`.

---

## Step 6: First PR and preview environment

1. Create a branch and open a PR:
   ```sh
   git checkout -b feat/hello-world
   git add . && git commit -m "feat: hello world"
   gh pr create --fill
   ```
2. CI runs `ci-gate`. On success, the preview pipeline creates
   `nearest-neighbor-pr-<N>` with its own database.
3. A sticky comment on the PR shows the preview URL:
   `https://nearest-neighbor-pr-<N>.fly.dev`
4. Merge the PR. CI automatically tears down the preview environment and deploys
   to staging.

---

## Step 7: First production deploy

```sh
gh workflow run deploy-environment-production.yml --field confirm=yes
```

Approve in GitHub: Settings → Environments → `production` → Review deployments.

**Verify by:**

```sh
curl https://nearest-neighbor-prod.fly.dev/health
```

---

## Quick reference: what `mise run dev` gives you

```sh
mise trust && mise install   # first time only
mise run dev                 # starts API :8080, web :3000
```

| Service            | URL                         | Purpose                    |
| ------------------ | --------------------------- | -------------------------- |
| API (Elysia)       | `localhost:8080`            | Backend + `/docs` (Scalar) |
| Web (React Router) | `localhost:3000`            | Frontend                   |
| API docs (public)  | `localhost:8080/docs`       | OpenAPI / Scalar           |
| API docs (admin)   | `localhost:8080/admin/docs` | Full route docs            |

Docker services (postgres) stay running between sessions. To stop:
`mise run dev:down`. To wipe all local data: `mise run dev:reset` (destructive).

See [docs/testing.md](testing.md) for running tests, coverage reports, and
Playwright E2E setup.
