import type { Config } from '@react-router/dev/config'

export default {
  // SPA mode. The landing page is static marketing content, so we skip SSR —
  // this avoids bun + React Router server-runtime incompatibilities
  // (renderToPipeableStream / null route manifest) and ships a client-only
  // bundle that server.ts serves as static files.
  ssr: false,
} satisfies Config
