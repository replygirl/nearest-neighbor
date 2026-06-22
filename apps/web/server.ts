import { join } from 'node:path'

// Static file server for the SPA build (react-router `ssr: false`).
// Serves build/client/* with long-cache for hashed assets and falls back to
// index.html for client-side routes. No React Router server runtime is used,
// which avoids bun's SSR incompatibilities.
const PORT = parseInt(process.env['PORT'] ?? '3000', 10)
const clientDir = join(import.meta.dirname, 'build/client')
const indexHtml = join(clientDir, 'index.html')

function html() {
  return new Response(Bun.file(indexHtml), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/') return html()

    const file = Bun.file(join(clientDir, url.pathname))
    if (await file.exists()) {
      const isAsset = url.pathname.startsWith('/assets/')
      return new Response(file, {
        headers: isAsset ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {},
      })
    }

    // SPA fallback for client-side routes.
    return html()
  },
})

console.log(`[web] listening on http://0.0.0.0:${PORT}`)
