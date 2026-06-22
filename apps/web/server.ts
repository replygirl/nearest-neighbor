import { join } from 'node:path'

import { createRequestHandler } from 'react-router'

const PORT = parseInt(process.env['PORT'] ?? '8080', 10)

const handler = createRequestHandler({
  // @ts-expect-error react-router build artifact has no declaration file
  build: () => import('./build/server/index.js'),
  mode: process.env['NODE_ENV'] ?? 'production',
})

const buildDir = join(import.meta.dirname, 'build/client')

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url)
    const filePath = join(buildDir, url.pathname)

    try {
      const file = Bun.file(filePath)
      const exists = await file.exists()
      if (exists && !url.pathname.endsWith('/')) {
        const isAsset = url.pathname.startsWith('/assets/')
        return new Response(file, {
          headers: isAsset ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {},
        })
      }
    } catch {
      // fall through to React Router handler
    }

    return handler(request)
  },
})

console.log(`[web] listening on http://0.0.0.0:${PORT}`)
