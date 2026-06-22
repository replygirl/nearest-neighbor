# API Versioning

This document covers how the Nearest Neighbor API handles versioning: URL-path
contract versions (`/v1/`, `/v2/`), binary release tags (`api-v1.2.3`), the auth
carve-out, the sunset window, and force-update signaling.

<!-- TODO: update once apps/api versioning middleware is implemented -->

---

## Two independent version axes

| Axis                     | Format            | Example      | What it means                                |
| ------------------------ | ----------------- | ------------ | -------------------------------------------- |
| **API contract version** | URL path `/v{n}/` | `/v1/agents` | Frozen HTTP interface that clients depend on |
| **Binary release tag**   | `api-v{semver}`   | `api-v1.0.0` | The deployed codebase version                |

These axes are **orthogonal**. A binary tagged `api-v2.0.0` can simultaneously
serve `/v1/` and `/v2/`. A hotfix ships as `api-v1.0.1` with the `/v1/` contract
unchanged.

---

## URL-path versioning scheme

- Monotonic integer: `/v1/`, `/v2/`, ...
- All business-logic routes live under a version prefix.
- Unprefixed legacy routes 308-redirect to `/v1/<path>`.

### Auth carve-out

`/auth/*` stays at the root — not under any `/v{n}/` prefix.

**Why:** `BETTER_AUTH_URL` is embedded in OAuth provider dashboards and API
client configurations. Versioning auth would require re-registering at every
provider. Auth is infrastructure, not a business-logic contract.

---

## Response headers

| Header                     | Meaning                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `X-API-Version`            | Integer of the contract version that served this response (e.g. `1`) |
| `X-API-Versions`           | Comma-separated list of all mounted contract versions                |
| `Sunset`                   | RFC 8594 date after which the version will return 410                |
| `Link`                     | `<docs-url>; rel="deprecation"` companion to Sunset                  |
| `X-Client-Update-Required` | `1` when client is below `MIN_SUPPORTED_CLIENT_VERSION`              |
| `X-Request-Id`             | UUID for request tracing                                             |

All headers are in CORS `exposeHeaders`.

---

## Sunset process

When a contract version must be retired:

1. **Announce** — at least 12 months before the hard cutoff.

2. **Set Fly secrets:**

   ```sh
   fly secrets set SUNSET_VERSIONS=v1 --app nearest-neighbor-prod
   fly secrets set SUNSET_DATE_ISO=2027-06-01T00:00:00Z --app nearest-neighbor-prod
   ```

3. **Monitor** — watch PostHog for requests hitting sunsetted versions.

4. **Hard cutoff (month 13)** — remove the sunsetted version handler. All
   `/v1/*` requests now 404/410.

---

## Force-update vs sunset

| Signal       | Header                        | Trigger                                             | Urgency                        |
| ------------ | ----------------------------- | --------------------------------------------------- | ------------------------------ |
| Sunset       | `Sunset`, `Link`              | Version in `SUNSET_VERSIONS` env                    | Polite advisory (months ahead) |
| Force-update | `X-Client-Update-Required: 1` | Client version below `MIN_SUPPORTED_CLIENT_VERSION` | Emergency (security/data-loss) |

---

## How to ship v2

1. `cp -R apps/api/src/v1 apps/api/src/v2`
2. Freeze `/v1/` — do not modify v1 handlers after this point.
3. Modify v2 handlers in `apps/api/src/v2/` as needed.
4. Mount v2 in `apps/api/src/index.ts`:
   ```typescript
   import { v2 } from './v2/index.ts'
   .use(v1)
   .use(v2)
   ```
5. Update `X-API-Versions` header: `'1, 2'`
6. Add `packages/api-types/src/v2.ts`
7. Open an OpenSpec proposal naming the new version number.

---

## See also

- `docs/deployment.md` — Binary release pipeline
- `apps/api/src/shared/sunset-middleware.ts` — Sunset header implementation
- `apps/api/src/shared/force-update.ts` — Force-update header implementation
