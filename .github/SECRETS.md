# GitHub Secrets and Variables

Reference for all secrets (`gh secret set`) and variables (`gh variable set`)
required by this repository's GitHub Actions workflows. Set these before running
any workflow on a fresh clone.

---

## Repository Secrets

| Secret          | Required by          | Notes                                                                                                                                                           |
| --------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FLY_API_TOKEN` | All deploy workflows | Org-scoped deploy token from `flyctl tokens create deploy --org replygirl`. **Not** OIDC — Fly.io does not support OIDC as an inbound GH Actions auth provider. |

---

## Repository Variables

| Variable     | Required by          | Notes                      |
| ------------ | -------------------- | -------------------------- |
| `FLY_ORG`    | All deploy workflows | Fly org slug — `replygirl` |
| `FLY_REGION` | All deploy workflows | Primary Fly region — `iad` |

---

## GitHub Environments

Configure these under **Settings → Environments** before running production
deploys:

| Environment  | Protection rules                      | Used by                 |
| ------------ | ------------------------------------- | ----------------------- |
| `production` | Required reviewers (add at least one) | `deploy-production.yml` |

Production deploys are also triggered by pushes to the `release` branch (in
addition to `workflow_dispatch`). Branch protection on `release` should require
at least one approving review.

---

## Fly App Secrets (set per-app via `flyctl secrets set`)

These secrets live in each Fly app's vault — they are NOT GitHub secrets. RG
provisions and sets these; this table documents what each app requires.

| Secret         | Apps                                                                                                                         | Notes                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL` | `nearest-neighbor-staging`, `nearest-neighbor-production`, `nearest-neighbor-web-staging`, `nearest-neighbor-web-production` | Connection string for the environment's Postgres instance. **Never** commit this.  |
| `JWT_SECRET`   | `nearest-neighbor-staging`, `nearest-neighbor-production`                                                                    | `openssl rand -base64 32` — unique per environment.                                |
| `POSTHOG_KEY`  | `nearest-neighbor-staging`, `nearest-neighbor-production`                                                                    | Per-environment PostHog project API token (`phc_…`).                               |
| `POSTHOG_HOST` | `nearest-neighbor-staging`, `nearest-neighbor-production`                                                                    | `https://k.nearest-neighbor.replygirl.club` (proxy) or `https://us.i.posthog.com`. |
| `WEB_URL`      | `nearest-neighbor-staging`, `nearest-neighbor-production`                                                                    | Canonical web origin for CORS and redirects.                                       |

---

## Branch Protection

| Branch    | Required checks                            | Notes                                            |
| --------- | ------------------------------------------ | ------------------------------------------------ |
| `main`    | `ci-gate`                                  | All PRs must pass `ci-gate` before merge.        |
| `release` | (GitHub Environment gate replaces PR gate) | Production deploys require Environment approval. |

---

## Quick setup

```sh
# Fly deploy token (org-scoped — not a personal token)
flyctl tokens create deploy --org replygirl
gh secret set FLY_API_TOKEN   # paste the token

# GitHub Variables
gh variable set FLY_ORG    --body "replygirl"
gh variable set FLY_REGION --body "iad"
```

Then in **Settings → Environments**, create a `production` environment and add
at least one required reviewer.

---

## Note on Fly.io and OIDC

Fly.io's OIDC implementation is **outbound-only** (Fly Machines authenticating
to external services). GitHub Actions cannot authenticate to Fly using OIDC
tokens. Use `FLY_API_TOKEN` with an org-scoped deploy token generated via:

```sh
flyctl tokens create deploy --org replygirl
```
