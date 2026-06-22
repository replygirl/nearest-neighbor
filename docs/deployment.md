# Deployment

Deployment runbook for nearest-neighbor: provisioning, environments, day-to-day
operations, and rollback.

---

## Environments

| Env        | Fly app                    | Triggered by                                             | Strategy  |
| ---------- | -------------------------- | -------------------------------------------------------- | --------- |
| Production | `nearest-neighbor-prod`    | Manual `workflow_dispatch` + GitHub Environment approval | Bluegreen |
| Staging    | `nearest-neighbor-staging` | Push to `main`                                           | Rolling   |
| Preview    | `nearest-neighbor-pr-<N>`  | PR opened / pushed                                       | Rolling   |

Web frontend:

| Env        | Fly app                        |
| ---------- | ------------------------------ |
| Production | `nearest-neighbor-web-prod`    |
| Staging    | `nearest-neighbor-web-staging` |

Org: `replygirl`, region: `iad`.

---

## Postgres strategy

| Env              | Postgres type                             | Name                           |
| ---------------- | ----------------------------------------- | ------------------------------ |
| Production       | Fly Managed Postgres (shared org cluster) | `nearest-neighbor-prod-pg`     |
| Staging          | Unmanaged Fly Postgres app                | `nearest-neighbor-db-staging`  |
| Preview (per PR) | Database on staging instance              | `pr_<N>` (cloned from staging) |

**Production** uses a shared Fly Managed Postgres cluster at the org level
(`replygirl`). Each production app in the org gets its own database and user on
that cluster. Managed Postgres provides durability and automated backups without
per-app overhead.

**Staging and preview** use an unmanaged single-node Fly Postgres app to save
cost. PR previews create a template-cloned database
(`CREATE DATABASE pr_<N> TEMPLATE staging`) on the staging instance and drop it
when the PR closes.

`DATABASE_URL` is a per-app Fly secret — not in `mise.toml` or any committed
file. The same `release_command = "bun run db:migrate"` runs against whichever
`DATABASE_URL` is set in the environment.

---

## Secrets inventory

| Variable        | Prod | Staging | Preview | Notes                                               |
| --------------- | ---- | ------- | ------- | --------------------------------------------------- |
| `DATABASE_URL`  | yes  | yes     | yes     | Fly secret; set by provisioning script              |
| `JWT_SECRET`    | yes  | yes     | yes     | Fly secret; `openssl rand -base64 32`               |
| `POSTHOG_KEY`   | yes  | yes     | yes     | Fly secret + GH secret (per-env project token)      |
| `POSTHOG_HOST`  | yes  | yes     | yes     | GH variable; `https://us.i.posthog.com` or proxy    |
| `FLY_API_TOKEN` | —    | —       | —       | GH secret (org-scoped deploy token; not in Fly app) |

---

## First deploy: one-time provisioning

### Prerequisites

```sh
fly auth login          # org: replygirl
mise use --global gh@latest
gh auth login
```

### Provision

```sh
mise run bootstrap:provision
```

Interactive script — prompts for Fly org (`replygirl`) and region (`iad`).
Creates:

- Fly Managed Postgres cluster for production
- Unmanaged Postgres app for staging
- All required Fly secrets across apps

### GitHub secrets and variables

```sh
gh secret set FLY_API_TOKEN        # org-scoped deploy token
gh secret set POSTHOG_KEY_PROD
gh secret set POSTHOG_KEY_STAGING
gh secret set POSTHOG_KEY_PREVIEW
gh variable set FLY_ORG    --body "replygirl"
gh variable set FLY_REGION --body "iad"
gh variable set POSTHOG_HOST --body "https://us.i.posthog.com"
```

---

## Staging deploys (automatic)

Every push to `main` triggers `deploy-environment-staging.yml`.

```sh
gh run list --workflow deploy-environment-staging.yml --limit 5
gh run watch <run-id>
```

Verify:

```sh
curl https://nearest-neighbor-staging.fly.dev/health
# → {"status":"ok"}
```

---

## Production deploys (manual)

```sh
gh workflow run deploy-environment-production.yml --field confirm=yes
```

Approve in the GitHub Environment review UI: Settings → Environments →
`production` → Review deployments.

---

## Bluegreen mechanics

1. Fly spins up new Machines with the new image.
2. **`release_command`** runs: `bun run db:migrate`. If this fails, the deploy
   aborts and old Machines keep serving traffic. Zero users affected.
3. Health checks poll `GET /health` every 15 s. All new Machines must pass
   before traffic shifts.
4. Traffic cuts over to new Machines; old Machines are destroyed.

Migrations must be backwards-compatible (add-then-remove; never rename in
place). Drizzle does not generate automatic down migrations.

---

## Rollback

```sh
# Find the previous image
fly releases list --app nearest-neighbor-prod

# Deploy the previous image (bluegreen)
fly deploy --image <previous-image-digest> --app nearest-neighbor-prod --strategy bluegreen

# Verify
curl https://nearest-neighbor-prod.fly.dev/health
```

---

## Preview environment lifecycle

| Event              | Action                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| PR opened          | Create `nearest-neighbor-pr-<N>` Fly app + `pr_<N>` Postgres database; rolling deploy; sticky PR comment with URL |
| PR push            | Rolling re-deploy; cancel-in-progress                                                                             |
| PR merged / closed | Destroy Fly app; drop `pr_<N>` database                                                                           |

Preview apps use `auto_stop_machines = "suspend"`.

Manually destroy a preview:

```sh
fly apps destroy nearest-neighbor-pr-<N>
fly mpg connect nearest-neighbor-db-staging --command "DROP DATABASE pr_<N>"
```

---

## Useful commands

```sh
# Logs
mise run fly:logs:api:prod
mise run fly:logs:api:staging

# SSH
mise run fly:ssh:api:prod
mise run fly:ssh:api:staging

# Status
mise run fly:status:api:prod
mise run fly:status:api:staging
```

---

## Production readiness checklist

- [ ] `GET /health` returns 200 when DB is reachable
- [ ] `release_command = "bun run db:migrate"` in `fly.prod.toml`
- [ ] `min_machines_running = 2` for zero-downtime rolling restarts
- [ ] PostHog sourcemap upload working after web build
- [ ] GitHub Environment `production` requires reviewer approval
- [ ] Fly secrets set for all variables in the inventory above
