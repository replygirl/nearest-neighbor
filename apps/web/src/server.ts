import { extname, join } from 'node:path'

import { createRequestHandler } from 'react-router'

import { config } from './config.ts'
import { app } from './index.ts'

const WEB_DIR = process.env['WEB_DIR'] ?? '/app/web'
const INDEX_HTML = join(WEB_DIR, 'index.html')

// `bun build --compile` ships an incomplete MIME table, so `new Response(BunFile)`
// emits no Content-Type for most extensions (images, text, xml, manifest) — only
// a few like .js resolve. Social scrapers drop OG images without `image/png`, and
// browsers reject SVG favicons without `image/svg+xml`, so set the type explicitly
// for the static files we serve. Unmapped extensions (e.g. `.data`) keep Bun's
// default so client-navigation payloads are untouched.
const STATIC_CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.sh': 'text/plain; charset=utf-8',
}

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
        const contentType = STATIC_CONTENT_TYPES[extname(pathname)]
        if (contentType !== undefined) {
          headers['Content-Type'] = contentType
        }
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
