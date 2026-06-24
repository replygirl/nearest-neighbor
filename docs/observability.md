# Observability

nearest-neighbor uses two observability layers:

- **PostHog Cloud** — analytics, session replay, feature flags, error tracking,
  LLM analytics, and OTLP log shipping
- **Fly Grafana** (`fly-metrics.net`) — infrastructure metrics via Fly's managed
  Prometheus scraper

---

## PostHog: project layout

One PostHog project per environment, sharing the same event schema:

| Project                        | `POSTHOG_KEY`              | When active                                             |
| ------------------------------ | -------------------------- | ------------------------------------------------------- |
| `nearest-neighbor-production`  | prod project token         | Always — Fly secret on `nearest-neighbor-prod`          |
| `nearest-neighbor-staging`     | staging project token      | Always — Fly secret on `nearest-neighbor-staging`       |
| `nearest-neighbor-preview`     | preview project token      | Per-PR — injected by CI; events tagged with `pr_number` |
| `nearest-neighbor-development` | dev project token (opt-in) | Off by default; opt in via `.env.local`                 |

### Local opt-in

PostHog is a **no-op without `POSTHOG_KEY`** — no guards needed in application
code, no `NODE_ENV` checks. To opt in locally:

```sh
# .env.local
POSTHOG_KEY=phc_<your-dev-project-token>
POSTHOG_HOST=https://us.i.posthog.com
```

Restart `mise run dev` after adding these.

---

## PostHog proxy (managed)

Ingestion routes through a first-party domain to reduce ad-blocker interference.
We use PostHog's **managed reverse proxy** — PostHog hosts it (free) and
auto-provisions SSL; we do **not** run any proxy infrastructure ourselves.

Setup (one-time):

1. In the PostHog UI → organization settings → **managed reverse proxy**, create
   a proxy for the subdomain `k.nearest-neighbor.replygirl.club`. PostHog
   returns a CNAME target like `<id>.proxy-us.posthog.com`.
2. Add a DNS record: `k.nearest-neighbor.replygirl.club` CNAME → that PostHog
   target. **Disable** any DNS-provider proxying (e.g. Cloudflare orange-cloud).
3. PostHog auto-detects the record and issues the cert (status waiting → issuing
   → live, ~2–5 min). No `flyctl certs` / no Fly app involved.

Then point the SDKs at it:

- `api_host` = `https://k.nearest-neighbor.replygirl.club` (server
  `POSTHOG_HOST`, web `VITE_POSTHOG_HOST`, CLI capture host).
- `ui_host` = `https://us.posthog.com` (so PostHog UI links resolve).

Optional fallback (no proxy): set the hosts to `https://us.i.posthog.com` and
events route to PostHog Cloud directly (ad-blockable).

---

## SDK usage

### Web (`posthog-js` via `packages/analytics`)

- `PHProvider` wraps the React Router app root in `app/root.tsx`
- `usePostHog()` gives access to the client in components
- `useFeatureFlagEnabled(flag)` for feature flag checks
- Session replay: `sampleRate = 0.2` (20% of sessions)

### API (`posthog-node` via `packages/analytics`)

- `getPostHogClient()` returns a singleton client
- `captureException(error, context)` for error tracking (called in Elysia
  `onError`)
- `isFeatureEnabled(flag, distinctId)` for server-side flag evaluation
- `shutdownPostHog()` is called on `SIGTERM` to flush queued events

### OTLP log shipping

The API process ships structured logs to PostHog via `OTLPLogExporter`:

- **Endpoint:** `${POSTHOG_HOST}/i/v1/logs`
- **Auth:** `Authorization: Bearer ${POSTHOG_KEY}`

### LLM analytics

AI feature calls use `@posthog/ai` (`packages/analytics/src/llm.ts`). Wraps
Anthropic SDK calls to automatically capture `ai_generation` events (model,
token counts, latency, cost estimate).

---

## Error tracking

`captureException(error, { distinctId, context })` is the entry point. Errors
appear in PostHog → **Error tracking** tab.

### Sourcemap upload

The web build emits hidden sourcemaps uploaded to PostHog after every successful
deploy:

```sh
POSTHOG_PERSONAL_API_KEY=<key> POSTHOG_HOST=https://us.i.posthog.com mise run posthog:upload-sourcemaps
```

This runs automatically in the deploy workflow.

---

## Fly Grafana

Fly scrapes `/metrics` on port 9091 every 15 seconds.

Access: `fly-metrics.net` → sign in with Fly account → select org `replygirl`.

### Key PromQL queries

**5xx rate (production):**

```promql
sum(rate(http_requests_total{status=~"5..",app="nearest-neighbor-prod"}[5m]))
  / sum(rate(http_requests_total{app="nearest-neighbor-prod"}[5m]))
```

**Active Postgres connections:**

```promql
pg_stat_activity_count{app="nearest-neighbor-prod-pg",state="active"}
```

### Recommended alerts

| Alert                        | Condition                                     | Threshold      |
| ---------------------------- | --------------------------------------------- | -------------- |
| Machine OOM                  | `container_oom_killed_total` increases        | Any occurrence |
| HTTP 5xx rate                | 5xx / total (5-minute window)                 | > 1%           |
| Postgres connection pressure | Active connections > 80% of `max_connections` | Warning        |

---

## On-call runbook

### High error rate

1. Check PostHog → Error tracking for new exception types
2. Check Fly Grafana → HTTP 5xx rate
3. Tail live logs: `mise run fly:logs:production`
4. If sustained (> 5% over 5 min) and caused by new deployment: follow the
   [rollback procedure](deployment.md#rollback)

### Database connection exhaustion

```sh
fly mpg connect nearest-neighbor-prod-pg
# Inside psql:
SELECT count(*), state FROM pg_stat_activity GROUP BY state;
```

---

## Feature flags

- **Client-side (web):** `useFeatureFlagEnabled(flagKey)` from `posthog-js`
- **Server-side (API):** `posthog.isFeatureEnabled(flagKey, distinctId)` with
  local evaluation

Define flags in PostHog → Feature Flags. Use the `staging` project for testing.
