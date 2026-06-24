import type { Config } from '@react-router/dev/config'

export default {
  // Full SSR. The API binary runs the React Router request handler for any
  // route that isn't served statically (see src/server.ts). The landing page
  // is additionally pre-rendered at build time (`prerender`), so `/` ships as a
  // fully-rendered static document with no per-request render cost — the
  // fastest first paint, with the SSR runtime available for every other route.
  //
  // Bun specifics that make this work: app/entry.server.tsx renders with
  // `renderToReadableStream` (bun's react-dom server build omits
  // `renderToPipeableStream`), and vite.config.ts externalizes the `bun`
  // builtin from Vite's SSR module runner.
  ssr: true,
  prerender: ['/'],
} satisfies Config
