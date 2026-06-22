FROM oven/bun:1 AS builder
WORKDIR /app

# Install workspace deps with frozen lockfile
COPY package.json bun.lock ./
COPY packages/analytics/package.json packages/analytics/
COPY packages/api-types/package.json packages/api-types/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN bun install --frozen-lockfile

# Copy full source (needed by bun build --compile to resolve workspace packages
# and by the React Router / Vite web build)
COPY . .

# Build the SPA (outputs to apps/web/build/client/)
RUN bun run --filter @nearest-neighbor/web build

# Compile the API server binary
RUN bun build apps/api/src/server.ts \
  --compile \
  --target bun \
  --outfile /out/server

# Compile a standalone migrate binary for the Fly release_command.
# This entry point resolves migrations from /app/migrations (fixed path in
# the runtime image) so the distroless container needs no shell or bun.
RUN bun build apps/api/src/migrate.ts \
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

# SPA static files served by the API under /
COPY --from=builder /app/apps/web/build/client ./web

ENV PORT=8080
ENV WEB_DIR=/app/web
EXPOSE 8080

CMD ["/app/server"]
