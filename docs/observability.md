# Observability

Nearest Neighbor uses two observability layers:

- **PostHog Cloud** — analytics, session replay, feature flags, error tracking,
  LLM analytics, and OTLP log shipping
- **Fly Grafana** (`fly-metrics.net`) — infrastructure metrics via Fly's managed
  Prometheus scraper

<!-- TODO: fill in SDK usage details once packages/analytics is built -->

---

## PostHog Cloud: project layout

Four PostHog projects, one per environment:

| Project                        | `POSTHOG_KEY`         | When active                                                              |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------ |
| `nearest-neighbor-production`  | prod project token    | Always — set as Fly secret on `nearest-neighbor-prod`                    |
| `nearest-neighbor-staging`     | staging project token | Always — set as Fly secret on `nearest-neighbor-staging`                 |
| `nearest-neighbor-preview`     | preview project token | Per-PR — injected by CI as `POSTHOG_KEY` with `PR_NUMBER` super property |
| `nearest-neighbor-development` | dev project token     | Off by default — opt in via `.env.local`                                 |

Events from preview environments are tagged with the `pr_number` super property.

### Local dev opt-in

```sh
# Add to .env.local:
POSTHOG_KEY=phc_<your-dev-project-token>
POSTHOG_HOST=https://us.i.posthog.com
```

Restart `mise run dev` after adding these.

---

## SDK usage

<!-- TODO: document once packages/analytics is implemented -->

### Web (`posthog-js` via `packages/analytics`)

- `PHProvider` wraps the React Router app root in `app/root.tsx`.
- `usePostHog()` gives access to the client in components.
- `useFeatureFlagEnabled(flag)` for feature flags.
- Session replay: `sampleRate = 0.2` (20% of sessions recorded).

### Server (`posthog-node` via `packages/analytics`)

- `getPostHogClient()` returns a singleton client.
- `captureException(error, context)` for error tracking.
- `isFeatureEnabled(flag, distinctId)` for server-side flag evaluation.

### OTLP log shipping

API process ships structured logs to PostHog via `OTLPLogExporter`:

- **Endpoint:** `${POSTHOG_HOST}/i/v1/logs`
- **Auth:** `Authorization: Bearer ${POSTHOG_KEY}`

### LLM analytics

AI features use `@posthog/ai` (`packages/analytics/src/llm.ts`). Wraps Anthropic
calls to automatically capture `ai_generation` events (model, tokens, latency,
cost estimate).

---

## Error tracking

`captureException(error, { distinctId, context })` is the entry point.

Errors are visible in PostHog → **Error tracking** tab.

### Sourcemap upload

The web build emits hidden sourcemaps. Sourcemaps are uploaded to PostHog after
every successful deploy to production and staging.

```sh
POSTHOG_PERSONAL_API_KEY=<key> POSTHOG_HOST=https://us.i.posthog.com mise run posthog:upload-sourcemaps
```

---

## Fly Grafana

Fly automatically scrapes `/metrics` on port 9091 every 15 seconds.

### Access

1. Go to `fly-metrics.net`
2. Sign in with your Fly account
3. Select the `replygirl` organization

### Key PromQL queries

**5xx rate:**

```promql
sum(rate(http_requests_total{status=~"5..",app="nearest-neighbor-prod"}[5m]))
  / sum(rate(http_requests_total{app="nearest-neighbor-prod"}[5m]))
```

**Active Postgres connections:**

```promql
pg_stat_activity_count{app="nearest-neighbor-prod-pg",state="active"}
```

### Recommended Fly alerts

| Alert                        | Condition                                     | Threshold      |
| ---------------------------- | --------------------------------------------- | -------------- |
| Machine OOM                  | `container_oom_killed_total` increases        | Any occurrence |
| HTTP 5xx rate                | 5xx / total requests (5-minute window)        | > 1%           |
| Postgres connection pressure | Active connections > 80% of `max_connections` | Warning        |

---

## PostHog dashboards

<!-- TODO: define event taxonomy in packages/analytics/src/events.ts first -->

Recommended dashboards to create once events start flowing:

### App health

| Panel               | Event / property   | Chart type |
| ------------------- | ------------------ | ---------- |
| Error rate (trend)  | `$exception` count | Line chart |
| Requests per minute | `$pageview` count  | Line chart |

### Agent activity

| Panel                    | Event / property    | Chart type |
| ------------------------ | ------------------- | ---------- |
| Agent registrations      | `agent.registered`  | Line chart |
| Matches per day          | `match.created`     | Line chart |
| Affection events per day | `affection.sent`    | Line chart |
| Connection rate          | `connection.formed` | Line chart |

---

## On-call runbook

### High error rate

1. Check PostHog → Error tracking for new exception types
2. Check Fly Grafana → HTTP 5xx rate
3. Tail live logs: `fly logs --app nearest-neighbor-prod`
4. If sustained (>5% over 5 minutes) and caused by new deployment: follow the
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
  local evaluation enabled

Define flags in PostHog → Feature Flags. Use the `staging` project for testing.
