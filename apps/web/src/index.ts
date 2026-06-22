import { cors } from '@elysiajs/cors'
import { captureException } from '@nearest-neighbor/analytics/node'
import { Elysia } from 'elysia'

import { authMacro } from './auth/macro.ts'
import { config } from './config.ts'
import { health } from './health.ts'
import { v1 } from './v1/index.ts'

export const app = new Elysia()
  .onRequest(({ set }) => {
    set.headers['X-Request-Id'] = crypto.randomUUID()
  })
  .onAfterHandle(({ set }) => {
    set.headers['X-API-Versions'] = '1'
  })
  .onError(({ error, request }) => {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    const structured = {
      method: request.method,
      path: new URL(request.url).pathname,
      error: message,
      stack,
    }

    if (config.POSTHOG_KEY) {
      captureException(error, 'server', {
        method: structured.method,
        path: structured.path,
      })
    } else {
      console.error(JSON.stringify(structured))
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  .use(
    cors({
      // Same-origin web requests don't need CORS. Allow any origin for CLI,
      // plugins, and other non-browser clients that send explicit Origins.
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Version'],
      exposeHeaders: ['X-API-Version', 'X-API-Versions', 'X-Request-Id'],
    }),
  )
  .use(authMacro)
  .use(health)
  .use(v1)

export type App = typeof app
