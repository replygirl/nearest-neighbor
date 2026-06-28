// Tests for the top-level app lifecycle hooks in src/index.ts.
// Covers: X-Request-Id header (onRequest), X-API-Versions (onAfterHandle),
// and the onError handler (client 4xx preservation, production/dev 500 behaviour).

import { beforeEach, expect, test } from 'bun:test'

import { Elysia, t } from 'elysia'

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

// ── onError hook — NOT_FOUND (client-fault) ──────────────────────────────────

test('NOT_FOUND returns 404 JSON with error field', async () => {
  const res = await app.handle(new Request('http://localhost/this-route-does-not-exist-at-all-xyz'))
  expect(res.status).toBe(404)
  const body = (await res.json()) as { error: string }
  expect(typeof body.error).toBe('string')
})

// ── onError hook — VALIDATION (client-fault) ─────────────────────────────────
// Build a local sub-app with a validated route — no DB required.

const validationApp = new Elysia().use(app).post('/test-validate', () => 'ok', {
  body: t.Object({ required_field: t.String() }),
})

test('VALIDATION error returns 422 with structured detail', async () => {
  const res = await validationApp.handle(
    new Request('http://localhost/test-validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // missing required_field
    }),
  )
  expect(res.status).toBe(422)
  // Response must be valid JSON with validation detail — not a generic 500
  const body = (await res.json()) as Record<string, unknown>
  expect(typeof body).toBe('object')
  // Elysia ValidationError encodes type: 'validation' in its message
  expect(body['type']).toBe('validation')
})

// ── onError hook — server fault, production vs development ───────────────────

const throwing500App = new Elysia().use(app).get('/test-500', () => {
  throw new Error('unexpected server error detail')
})

let savedNodeEnv: string | undefined

beforeEach(() => {
  savedNodeEnv = process.env['NODE_ENV']
})

test('production 500 is generic and carries request_id', async () => {
  process.env['NODE_ENV'] = 'production'
  try {
    const res = await throwing500App.handle(new Request('http://localhost/test-500'))
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string; request_id: string }
    expect(body.error).toBe('Internal server error')
    expect(typeof body.request_id).toBe('string')
    expect(body.request_id.length).toBeGreaterThan(0)
  } finally {
    process.env['NODE_ENV'] = savedNodeEnv
  }
})

test('non-production 500 keeps error detail and carries request_id', async () => {
  process.env['NODE_ENV'] = 'test'
  try {
    const res = await throwing500App.handle(new Request('http://localhost/test-500'))
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string; request_id: string }
    expect(body.error).toBe('unexpected server error detail')
    expect(typeof body.request_id).toBe('string')
    expect(body.request_id.length).toBeGreaterThan(0)
  } finally {
    process.env['NODE_ENV'] = savedNodeEnv
  }
})
