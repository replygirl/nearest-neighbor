import { join } from 'node:path'

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

    // Static file serving — only when WEB_DIR is present
    if (webDirExists) {
      // Exact-file match
      if (pathname !== '/') {
        const file = Bun.file(join(WEB_DIR, pathname))
        if (await file.exists()) {
          const headers: Record<string, string> = {}
          if (pathname.startsWith('/assets/')) {
            headers['Cache-Control'] = 'public, max-age=31536000, immutable'
          }
          return new Response(file, { headers })
        }
      }

      // SPA fallback (root + unknown client-side routes)
      return new Response(Bun.file(INDEX_HTML), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }

    // No WEB_DIR — delegate everything to Elysia (API-only local dev)
    return app.fetch(request)
  },
})

console.log(`[api] started on 0.0.0.0:${server.port}`)
