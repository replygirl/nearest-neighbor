# Deployment

Deployment runbook for nearest-neighbor: provisioning, environments, day-to-day
operations, and rollback.

---

## Environments

Each environment is a **single Fly app** that serves both the web app (`/`) and
the API (`/v1`, `/health`, `/docs`). There is no separate web app.

| Env        | Fly app                       | URL                                | Triggered by                                             | Strategy  |
| ---------- | ----------------------------- | ---------------------------------- | -------------------------------------------------------- | --------- |
| Production | `nearest-neighbor-production` | `nearest-neighbor.replygirl.club`  | Manual `workflow_dispatch` + GitHub Environment approval | Bluegreen |
| Staging    | `nearest-neighbor-staging`    | `nearest-neighbor-staging.fly.dev` | Push to `main`                                           | Rolling   |
| Preview    | `nearest-neighbor-pr-<N>`     | `nearest-neighbor-pr-<N>.fly.dev`  | PR opened / pushed                                       | Rolling   |

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
file. The same `release_command = "/app/migrate"` runs against whichever
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

`WEB_URL` is no longer needed — the web and API are served from the same origin.

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
2. **`release_command`** runs: `/app/migrate`. If this fails, the deploy aborts
   and old Machines keep serving traffic. Zero users affected.
3. Health checks poll `GET /health` every 15 s. All new Machines must pass
   before traffic shifts.
4. Traffic cuts over to new Machines; old Machines are destroyed.

Migrations must be backwards-compatible (add-then-remove; never rename in
place). Drizzle does not generate automatic down migrations.

---

## Scaling and autoscaling

Production runs a **pool of small machines that Fly autostarts/autostops on
load**, not a few large ones. The web server is a single-process Bun/Elysia app
(no `reusePort` cluster), so extra vCPUs on a bigger machine sit idle —
horizontal scale uses CPU, vertical does not. The workload is I/O-bound
(Postgres + synchronous OpenAI moderation), so shared CPUs suffice; dedicated
`performance` CPUs (~10× the price) are not warranted yet.

**Per-machine VM** (`apps/web/fly.production.toml`):

```toml
[[vm]]
size = "shared-cpu-1x"   # 1 shared vCPU — a single Bun process can't use more
memory = "1gb"           # headroom over the 512mb boot floor for SSR under load
```

**Autoscaling** is the built-in Fly Proxy autostart/autostop, triggered by the
concurrency `soft_limit`:

```toml
[http_service]
auto_stop_machines = "suspend"   # idle machines suspend (fast resume), not billed for compute
auto_start_machines = true
min_machines_running = 2         # always-on floor: HA + zero-downtime restarts

[http_service.concurrency]
type = "requests"
soft_limit = 50                  # per-machine comfort threshold; tune from Grafana
# hard_limit intentionally unset — fail loud, scale out
```

When **every** running machine is above `soft_limit`, Fly Proxy starts another
machine from the pool; when traffic falls it suspends machines back down to
`min_machines_running`.

**Setting the cap.** The toml cannot express the upper bound — Fly only
autostarts machines that already exist. Provision the pool out-of-band:

```sh
fly scale count 8 --app nearest-neighbor-production   # floor 2 (min), cap 8 (pool)
```

Stopped/suspended machines aren't billed for compute, so an idle pool of 8 costs
roughly the same as the 2 always-running machines. Each running machine opens
~10 Postgres connections, so keep `cap × 10` under the cluster's
`max_connections` (a bluegreen deploy transiently doubles the running count, and
thus connections).

> **`soft_limit = 50` is a placeholder** chosen without load data. Tune it: set
> it high (e.g. 1000), drive load, watch CPU / memory / p95 latency in Grafana
> and concurrency in PostHog, then set `soft_limit` just below where latency
> degrades. See Fly's
> [concurrency-limits blueprint](https://fly.io/docs/blueprints/setting-concurrency-limits/).

> **Beyond a fixed pool.** For on-demand provisioning past the pre-scaled cap,
> deploy [`fly-autoscaler`](https://fly.io/docs/blueprints/autoscale-machines/)
> as a separate metrics-based app. Not needed at current scale.

> **Verify the first autostop deploy.** Bluegreen + `auto_stop_machines` is new
> here; an earlier scale-to-zero race (min 0) bit the preview env. Production's
> floor of 2 avoids that specific race, but watch the first production release
> after this change to confirm suspended machines roll cleanly.

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
mise run fly:logs:production
mise run fly:logs:staging

# SSH
mise run fly:ssh:production
mise run fly:ssh:staging

# Status
mise run fly:status:production
mise run fly:status:staging
```

---

## Production readiness checklist

- [ ] `GET /health` returns 200 when DB is reachable
- [ ] `release_command = "/app/migrate"` in `apps/web/fly.production.toml`
- [x] `min_machines_running = 2` for zero-downtime rolling restarts (set in
      `fly.production.toml`)
- [ ] PostHog sourcemap upload working after web build
- [ ] GitHub Environment `production` requires reviewer approval
- [ ] Fly secrets set for all variables in the inventory above
