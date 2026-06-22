# nearest-neighbor PostHog reverse proxy

nginx reverse proxy for PostHog Cloud (US region), running as a single Fly app
at `k.nearest-neighbor.replygirl.club`. This keeps PostHog traffic on the
project's own domain so ad-blockers do not silently drop analytics.

## How it works

The proxy is built from the official PostHog nginx reverse-proxy pattern
(`PostHog/posthog-nginx-reverse-proxy`). A two-stage Dockerfile renders
`nginx.conf.template` with `envsubst` at build time (no runtime secrets needed),
then copies the result into a minimal `nginx:1.27-alpine` image.

Route table:

| Path prefix                                                                    | Upstream                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------- |
| `/static/*`                                                                    | `us-assets.i.posthog.com`                   |
| `/array/*`                                                                     | `us-assets.i.posthog.com`                   |
| `/*` (everything else: `/i/`, `/e`, `/decide`, `/flags`, `/batch`, `/capture`) | `us.i.posthog.com`                          |
| `/health`                                                                      | Returns `200 OK` locally (Fly health check) |

CORS headers are rewritten on every response. `client_max_body_size` is 64 MB to
support large session-recording uploads.

## Deploy

From the repo root:

```sh
flyctl deploy --config proxy/fly.toml --dockerfile proxy/Dockerfile
```

The app must already exist in the `replygirl` org:

```sh
flyctl apps create nearest-neighbor-proxy --org replygirl
```

No Fly secrets are required — all config is baked at build time via
`[build.args]` in `fly.toml`.

## DNS and TLS (RG runs these once)

1. Add the custom domain certificate to the Fly app:

   ```sh
   flyctl certs add k.nearest-neighbor.replygirl.club --app nearest-neighbor-proxy
   ```

   Fly will print the DNS validation record (a `TXT` or `CNAME`). Add it at your
   DNS provider and wait for propagation (usually < 5 min on Cloudflare).

2. Add the routing CNAME at your DNS provider:

   | Name | Type  | Value                            |
   | ---- | ----- | -------------------------------- |
   | `k`  | CNAME | `nearest-neighbor-proxy.fly.dev` |

3. Verify:

   ```sh
   curl https://k.nearest-neighbor.replygirl.club/health
   # Expected: OK
   ```

4. Check TLS cert status:

   ```sh
   flyctl certs show k.nearest-neighbor.replygirl.club --app nearest-neighbor-proxy
   ```

## Client configuration

Set the PostHog host env var in each app to the proxy URL:

```
POSTHOG_HOST=https://k.nearest-neighbor.replygirl.club
```

- **API (posthog-node):** pass `host: process.env.POSTHOG_HOST` to the client
  constructor.
- **Web (posthog-js):** pass `api_host: import.meta.env.VITE_POSTHOG_HOST` and
  `ui_host: 'https://us.posthog.com'`.
- **CLI (Rust):** POST events to `${POSTHOG_HOST}/capture/`.
