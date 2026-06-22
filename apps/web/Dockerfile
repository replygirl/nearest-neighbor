FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/analytics/package.json packages/analytics/
COPY packages/api-types/package.json packages/api-types/
COPY apps/web/package.json apps/web/

RUN bun install --frozen-lockfile

COPY . .

RUN bun run --filter @nearest-neighbor/web build

FROM oven/bun:1-slim
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/web/build ./apps/web/build
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder /app/apps/web/server.ts ./apps/web/server.ts
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "/app/apps/web/server.ts"]
