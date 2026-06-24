# Bun handles installs and compiles the server/migrate binaries; Node runs the
# React Router / Vite build. Under Bun on Linux, @react-router/dev's compiled
# typegen reads @babel/traverse's `.default` (undefined via Bun's Linux CJS
# interop — it works on macOS), which crashes `react-router build`. Node has the
# correct interop. react-dom's `renderToReadableStream` (used by entry.server
# for SSR + prerender) is exported by both the node and bun react-dom builds, so
# prerendering works under Node too.
FROM oven/bun:1 AS bun
FROM node:22-slim AS builder
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

# Install workspace deps with frozen lockfile
COPY package.json bun.lock ./
COPY packages/analytics/package.json packages/analytics/
COPY packages/api-types/package.json packages/api-types/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/

RUN bun install --frozen-lockfile

# Copy full source (needed by bun build --compile to resolve workspace packages
# and by the React Router / Vite web build)
COPY . .

# Landing-page (posthog-js) analytics keys are baked into the SPA bundle at
# build time by Vite, so they must be present BEFORE `react-router build`. These
# are the PUBLIC posthog project key (phc_...) + host — safe to pass as build
# args. Supplied via `flyctl deploy --build-arg` (see deploy-fly-app.yml).
# Empty by default → posthog-js is a silent no-op.
ARG VITE_POSTHOG_KEY=""
ARG VITE_POSTHOG_HOST=""
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
ENV VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST

# Build the web app under Node (see the note on the builder image). react-router
# build emits build/client/ (assets + the pre-rendered landing page) and
# build/server/ (the SSR bundle, inlined into the compiled server binary below).
RUN cd apps/web && node node_modules/.bin/react-router build

# Compile the API server binary
RUN bun build apps/web/src/server.ts \
  --compile \
  --target bun \
  --outfile /out/server

# Compile a standalone migrate binary for the Fly release_command.
# This entry point resolves migrations from /app/migrations (fixed path in
# the runtime image) so the distroless container needs no shell or bun.
RUN bun build apps/web/src/migrate.ts \
  --compile \
  --target bun \
  --outfile /out/migrate

# ---- runtime image ----
FROM gcr.io/distroless/base-nossl-debian12
WORKDIR /app

COPY --from=builder /out/server ./server
COPY --from=builder /out/migrate ./migrate

# Migrations are embedded in the image at /app/migrations so the migrate
# binary (which defaults MIGRATIONS_FOLDER=/app/migrations) finds them.
COPY --from=builder /app/packages/db/migrations ./migrations

# Client assets + the pre-rendered landing page, served by the API under /.
# (The SSR server bundle is already compiled into ./server.)
COPY --from=builder /app/apps/web/build/client ./web

ENV PORT=8080
ENV WEB_DIR=/app/web
EXPOSE 8080

CMD ["/app/server"]
