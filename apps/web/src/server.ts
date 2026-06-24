import { join } from 'node:path'

import { createRequestHandler } from 'react-router'

import { config } from './config.ts'
import { app } from './index.ts'

const WEB_DIR = process.env['WEB_DIR'] ?? '/app/web'
const INDEX_HTML = join(WEB_DIR, 'index.html')

let webDirExists = false
try {
  webDirExists = await Bun.file(INDEX_HTML).exists()
} catch {
  // WEB_DIR does not exist; fall through to API-only mode
}

// React Router request handler for server-rendered routes. The server build is
// bundled into the compiled binary — the build pipeline runs `react-router
// build` (which emits `build/server`) before `bun build --compile`, so the
// dynamic import resolves at compile time. `build` is a lazy function so that
// local API-only dev, which has no build output, never resolves it.
const handleSSR = createRequestHandler(
  // @ts-expect-error generated server build has no type declarations
  () => import('../build/server/index.js'),
  process.env['NODE_ENV'] === 'development' ? 'development' : 'production',
)

const server = Bun.serve({
  port: config.PORT,
  hostname: '0.0.0.0',
  async fetch(request) {
    const url = new URL(request.url)
    const { pathname } = url

    // API routes: delegate to Elysia
    if (pathname === '/health' || pathname.startsWith('/v1') || pathname.startsWith('/docs')) {
      return app.fetch(request)
    }

    // Web routes — only when a build is present (production binary).
    if (webDirExists) {
      // `/` is pre-rendered to a static document at build time. Serve it
      // directly — fastest first paint, no per-request render.
      if (pathname === '/') {
        return new Response(Bun.file(INDEX_HTML), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }

      // Static files: hashed assets, other pre-rendered documents, and
      // client-navigation `.data` payloads all live under WEB_DIR.
      const file = Bun.file(join(WEB_DIR, pathname))
      if (await file.exists()) {
        const headers: Record<string, string> = {}
        if (pathname.startsWith('/assets/')) {
          headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        }
        return new Response(file, { headers })
      }

      // Not static and not pre-rendered → server-render via React Router.
      return handleSSR(request)
    }

    // No WEB_DIR — delegate everything to Elysia (API-only local dev)
    return app.fetch(request)
  },
})

console.log(`[api] started on 0.0.0.0:${server.port}`)
