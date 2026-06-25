import { extname, join } from 'node:path'

import { createRequestHandler } from 'react-router'

import { config } from './config.ts'
import { app } from './index.ts'
import { renderLlmsFullTxt, renderLlmsTxt } from './seo/llms.ts'
import { renderOpenapiMarkdown } from './seo/openapi-md.ts'
import { renderRobotsTxt } from './seo/robots.ts'
import { renderSitemapXml } from './seo/sitemap.ts'

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
  '.md': 'text/markdown; charset=utf-8',
}

let webDirExists = false
try {
  webDirExists = await Bun.file(INDEX_HTML).exists()
} catch {
  // WEB_DIR does not exist; fall through to API-only mode
}

// Cache the pre-rendered landing page HTML once at startup. It is immutable
// per build — reading it once avoids repeated disk I/O. The '__NN_ORIGIN__'
// placeholder is replaced per-request so environment-aware URLs are injected.
let cachedIndexHtml: string | null = null
if (webDirExists) {
  try {
    cachedIndexHtml = await Bun.file(INDEX_HTML).text()
  } catch {
    // Should not happen — webDirExists already confirmed the file is readable.
    cachedIndexHtml = null
  }
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

const SEO_CACHE_CONTROL = 'public, max-age=300'

const server = Bun.serve({
  port: config.PORT,
  hostname: '0.0.0.0',
  async fetch(request) {
    const url = new URL(request.url)
    const { pathname } = url
    // Behind Fly's proxy the app is reached over plain HTTP with the public
    // scheme/host in X-Forwarded-Proto/Host. Trust them so canonical, og:image,
    // and the llms/robots/sitemap URLs are the real https public origin rather
    // than the internal http one. Falls back to the request URL in local dev.
    const fwdProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    const fwdHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    const origin = `${fwdProto ?? url.protocol.slice(0, -1)}://${fwdHost ?? url.host}`

    // ── SEO / LLMs routes ────────────────────────────────────────────────────
    // Handled before static-file lookup and SSR so they are never shadowed by
    // files on disk or delegated to Elysia.

    if (pathname === '/llms.txt') {
      return new Response(renderLlmsTxt(origin), {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': SEO_CACHE_CONTROL,
        },
      })
    }

    if (pathname === '/llms-full.txt') {
      return new Response(renderLlmsFullTxt(origin), {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': SEO_CACHE_CONTROL,
        },
      })
    }

    if (pathname === '/robots.txt') {
      return new Response(renderRobotsTxt(origin), {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': SEO_CACHE_CONTROL,
        },
      })
    }

    if (pathname === '/sitemap.xml') {
      return new Response(renderSitemapXml(origin), {
        headers: {
          'content-type': 'application/xml; charset=utf-8',
          'cache-control': SEO_CACHE_CONTROL,
        },
      })
    }

    // /v1/docs.md — must be handled BEFORE the '/v1' delegate-to-Elysia branch
    // below so Elysia does not claim the request first.
    if (pathname === '/v1/docs.md') {
      let body: string
      try {
        const res = await app.handle(new Request(`${origin}/v1/openapi.json`))
        const spec: unknown = await res.json()
        body = renderOpenapiMarkdown(spec)
      } catch {
        body = '# API\n\nSpec unavailable.\n'
      }
      return new Response(body, {
        headers: {
          'content-type': 'text/markdown; charset=utf-8',
          'cache-control': SEO_CACHE_CONTROL,
        },
      })
    }

    // ── API routes ───────────────────────────────────────────────────────────
    // Delegate to Elysia after the SEO routes above are matched.
    if (pathname === '/health' || pathname.startsWith('/v1') || pathname.startsWith('/docs')) {
      return app.fetch(request)
    }

    // Web routes — only when a build is present (production binary).
    if (webDirExists) {
      // `/` is pre-rendered to a static document at build time. Serve it
      // directly with the request origin injected so environment-aware URLs
      // are correct. The cached HTML is immutable per build; only the origin
      // placeholder varies per request.
      if (pathname === '/') {
        if (cachedIndexHtml !== null) {
          const html = cachedIndexHtml.replaceAll('__NN_ORIGIN__', origin)
          return new Response(html, {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          })
        }
        // cachedIndexHtml unexpectedly null — fall through to SSR
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
