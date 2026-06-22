# Deployment

Deployment runbook for Nearest Neighbor: provisioning, first deploy, day-to-day
operations, and rollback.

<!-- TODO: fill in fully after Fly configs and bootstrap scripts are created -->

---

## Environments

| Env        | Fly app                    | Triggered by                                         | Strategy  |
| ---------- | -------------------------- | ---------------------------------------------------- | --------- |
| Production | `nearest-neighbor-prod`    | Manual `workflow_dispatch` + GH Environment approval | Bluegreen |
| Staging    | `nearest-neighbor-staging` | Push to `main`                                       | Rolling   |
| Preview    | `nearest-neighbor-pr-<N>`  | PR opened / pushed                                   | Rolling   |

---

## First deploy: one-time provisioning

<!-- TODO: write bootstrap:provision script and link from here -->

### Prerequisites

1. `fly auth login` — Fly CLI authenticated, org: `replygirl`
2. Fly Managed Postgres access confirmed (`fly mpg list` returns without error)

### Run the provisioning script

```sh
mise run bootstrap:provision
```

This interactive script:

1. Prompts for Fly org slug (`replygirl`), region (default `iad`)
2. Provisions two MPG Basic clusters: `nearest-neighbor-prod-pg` and
   `nearest-neighbor-staging-pg`
3. Verifies `CREATEDB` privilege on `fly-user` against the staging MPG cluster
   (required for `CREATE DATABASE pr_<N> TEMPLATE staging`)
4. Stages all required secrets to each Fly app vault
5. Prints a summary card

The script is idempotent — safe to re-run.

### Set GitHub repository secrets and variables

```sh
# Fly API token (org-scoped deploy token — not personal)
gh secret set FLY_API_TOKEN

# PostHog project tokens (production and staging projects)
gh secret set POSTHOG_KEY_PROD
gh secret set POSTHOG_KEY_STAGING

# Non-secret config
gh variable set FLY_ORG    --body "replygirl"
gh variable set FLY_REGION --body "iad"
gh variable set POSTHOG_HOST --body "https://us.i.posthog.com"
```

---

## Staging deploys (automatic)

Staging deploys automatically on every push to `main` via
`deploy-environment-staging.yml`. Strategy: rolling.

```sh
gh run list --workflow deploy-environment-staging.yml --limit 5
gh run watch <run-id>
```

---

## Production deploys (manual)

```sh
gh workflow run deploy-environment-production.yml --field confirm=yes
```

Approve in the GitHub Environment review UI (Settings → Environments →
`production` → Review deployments). Strategy: bluegreen.

---

## Bluegreen mechanics

1. Fly spins up new Machines with the new image.
2. **`release_command`** runs before traffic shifts: `bun run db:migrate`. If
   this fails, the deploy aborts and old Machines keep serving traffic.
3. Health checks run on `/health` every 15s. All new Machines must pass before
   traffic shifts.
4. Traffic cuts over to the new Machines. Old Machines are destroyed.

Migrations run once, before any request hits new code. If migrations fail, zero
users are affected.

---

## Rollback

```sh
# 1. Find the previous image
fly releases list --app nearest-neighbor-prod

# 2. Deploy the previous image directly
fly deploy --image <previous-image-digest> --app nearest-neighbor-prod --strategy bluegreen

# 3. Verify recovery
curl https://nearest-neighbor-prod.fly.dev/health
```

> **Schema rollbacks:** Drizzle does not auto-generate down migrations. Plan
> migrations to be backwards-compatible (add-then-remove, never rename in
> place).

---

## Secrets inventory

| Variable             | Prod | Staging | Preview | Where it is set                                  |
| -------------------- | ---- | ------- | ------- | ------------------------------------------------ |
| `DATABASE_URL`       | yes  | yes     | yes     | Fly secret (by `bootstrap:provision`)            |
| `BETTER_AUTH_SECRET` | yes  | yes     | yes     | Fly secret (generate: `openssl rand -base64 32`) |
| `POSTHOG_KEY`        | yes  | yes     | yes     | Fly secret + GH secret                           |
| `POSTHOG_HOST`       | yes  | yes     | yes     | GH variable (`https://us.i.posthog.com`)         |
| `FLY_API_TOKEN`      | —    | —       | —       | GH secret (org-scoped deploy token)              |

---

## Preview environment lifecycle

| Event              | Action                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| PR opened          | Create `nearest-neighbor-pr-<N>` Fly app, `pr_<N>` Postgres database; rolling deploy; sticky PR comment with URL |
| PR push            | Rolling re-deploy; cancel-in-progress                                                                            |
| PR merged / closed | Destroy Fly app, drop database                                                                                   |

Preview apps use `auto_stop_machines = "suspend"`.

To manually destroy a preview app:

```sh
fly apps destroy nearest-neighbor-pr-<N>
fly mpg connect nearest-neighbor-staging-pg --command "DROP DATABASE pr_<N>"
```

---

## Production readiness checklist

<!-- TODO: expand as infrastructure matures -->

- [ ] `GET /health` returns 200 when DB is reachable
- [ ] `release_command = "bun run db:migrate"` in `fly.prod.toml`
- [ ] `min_machines_running = 2` for zero-downtime rolling restarts
- [ ] PostHog sourcemap upload working (web build only)
- [ ] GitHub Environment `production` requires reviewer approval
- [ ] Fly secrets rotated within 90 days of initial provisioning
