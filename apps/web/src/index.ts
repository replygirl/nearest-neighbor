import { cors } from '@elysiajs/cors'
import { captureException } from '@nearest-neighbor/analytics/node'
import { Elysia, ValidationError } from 'elysia'

import { authMacro } from './auth/macro.ts'
import { config } from './config.ts'
import { health } from './health.ts'
import { v1 } from './v1/index.ts'

// Security headers applied to all API responses.
// Content-Security-Policy is a deliberate follow-up — the SSR React app requires a carefully-built policy.
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
} as const

export const app = new Elysia()
  .onRequest(({ set }) => {
    set.headers['X-Request-Id'] = crypto.randomUUID()
  })
  .onAfterHandle({ as: 'global' }, ({ set }) => {
    set.headers['X-API-Versions'] = '1'
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      set.headers[k] = v
    }
  })
  .onError({ as: 'global' }, ({ error, code, set, request }) => {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    const path = new URL(request.url).pathname
    // X-Request-Id is set by onRequest on app's own routes; for routes in parent
    // apps that use this app as a plugin, onRequest may not have fired, so we
    // generate a fresh id here to ensure every error response carries one.
    const requestId = (set.headers['X-Request-Id'] as string | undefined) ?? crypto.randomUUID()

    if (config.POSTHOG_KEY) {
      captureException(error, 'server', { method: request.method, path })
    } else {
      console.error(JSON.stringify({ method: request.method, path, error: message, stack }))
    }

    // Build a JSON error Response with security headers included
    const jsonResponse = (body: Record<string, unknown>, status: number) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
      })

    // Client-fault codes — return original error details with the correct 4xx status.
    // Clients depend on these codes and messages; do not genericize them.
    if (code === 'NOT_FOUND') return jsonResponse({ error: message }, 404)
    if (code === 'PARSE') return jsonResponse({ error: message }, 400)
    if (code === 'INVALID_COOKIE_SIGNATURE') return jsonResponse({ error: message }, 400)

    if (code === 'VALIDATION' && error instanceof ValidationError) {
      // error.message is the JSON-encoded validation detail produced by the constructor.
      // Return it with 422 (toResponse() is intentionally not used; it hard-codes 400).
      return new Response(error.message, {
        status: 422,
        headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
      })
    }

    // Any error carrying an explicit sub-500 HTTP status (e.g. custom thrown errors)
    const errorStatus =
      'status' in error && typeof (error as { status: unknown }).status === 'number'
        ? (error as { status: number }).status
        : undefined
    if (errorStatus !== undefined && errorStatus < 500) {
      return jsonResponse({ error: message }, errorStatus)
    }

    // Server fault — genericize in production to avoid leaking internals
    const isProduction = process.env['NODE_ENV'] === 'production'
    if (isProduction) {
      return jsonResponse({ error: 'Internal server error', request_id: requestId }, 500)
    }
    return jsonResponse({ error: message, request_id: requestId }, 500)
  })
  .use(
    cors({
      // Same-origin web requests don't need CORS. Allow any origin for CLI,
      // plugins, and other non-browser clients that send explicit Origins.
      // credentials: true is intentionally omitted — auth uses Bearer tokens, not cookies.
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Version'],
      exposeHeaders: ['X-API-Version', 'X-API-Versions', 'X-Request-Id'],
    }),
  )
  .use(authMacro)
  .use(health)
  .use(v1)

export type App = typeof app

// Type-only re-export of the moderation 422 body schema so packages/api-types
// can surface it to Eden Treaty clients without importing a runtime value
// (which would create a circular workspace dependency).
export type { ModerationError } from './moderation/schema.ts'
