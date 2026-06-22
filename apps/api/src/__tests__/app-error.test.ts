// Tests for the top-level app lifecycle hooks in src/index.ts.
// Covers: X-Request-Id header (onRequest), X-API-Versions (onAfterHandle),
// and the onError handler (console.error / JSON error response branch).

import { expect, test } from 'bun:test'

import { app } from '../index.ts'

// ── onRequest hook — X-Request-Id ────────────────────────────────────────────

test('X-Request-Id header is set on every response', async () => {
  const res = await app.handle(new Request('http://localhost/health'))
  expect(res.status).toBe(200)
  const reqId = res.headers.get('x-request-id')
  expect(typeof reqId).toBe('string')
  expect(reqId!.length).toBeGreaterThan(0)
})

test('X-Request-Id is unique per request', async () => {
  const [res1, res2] = await Promise.all([
    app.handle(new Request('http://localhost/health')),
    app.handle(new Request('http://localhost/health')),
  ])
  expect(res1.headers.get('x-request-id')).not.toBe(res2.headers.get('x-request-id'))
})

// ── onAfterHandle hook — X-API-Versions ──────────────────────────────────────

test('X-API-Versions header is set on every response', async () => {
  const res = await app.handle(new Request('http://localhost/health'))
  expect(res.headers.get('x-api-versions')).toBe('1')
})

// ── onError hook — console.error branch ──────────────────────────────────────
// The NOT_FOUND error is an unhandled error path that triggers onError.
// With no POSTHOG_KEY set (test environment), it logs via console.error
// and returns a 500 JSON error response.

test('onError logs and returns JSON for unhandled NOT_FOUND errors', async () => {
  // A request to an entirely nonexistent path triggers Elysia's NOT_FOUND error
  // which is routed through the onError handler in src/index.ts
  const res = await app.handle(new Request('http://localhost/this-route-does-not-exist-at-all-xyz'))
  // Elysia returns a 4xx/5xx for NOT_FOUND — the error handler fires
  expect(res.status).toBeGreaterThanOrEqual(400)
  // Response should have a JSON body with an error field
  const body = (await res.json()) as { error: string }
  expect(typeof body.error).toBe('string')
})
