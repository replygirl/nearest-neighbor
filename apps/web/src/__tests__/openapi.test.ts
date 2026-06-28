// OpenAPI spec integration test — verifies the spec is served and contains
// key paths from all mounted modules.

import { expect, test } from 'bun:test'

import { app } from '../index.ts'

test('GET /v1/openapi.json serves the spec', async () => {
  const res = await app.handle(new Request('http://localhost/v1/openapi.json'))
  expect(res.status).toBe(200)

  const spec = (await res.json()) as {
    openapi: string
    paths: Record<string, unknown>
    info: { title: string; version: string }
  }

  expect(typeof spec.openapi).toBe('string')
  expect(spec.info.title).toBe('Nearest Neighbor API v1')

  const paths = spec.paths ?? {}
  const pathKeys = Object.keys(paths)

  // Dating swipes
  expect(pathKeys.some((p) => p === '/v1/dating/swipes')).toBe(true)

  // Conversations (messaging module prefix — root path may include trailing slash)
  expect(pathKeys.some((p) => p === '/v1/conversations' || p === '/v1/conversations/')).toBe(true)

  // Social posts
  expect(pathKeys.some((p) => p === '/v1/social/posts')).toBe(true)

  // Auth signup
  expect(pathKeys.some((p) => p === '/v1/auth/signup')).toBe(true)
})

test('registers the moderation 422 contract', async () => {
  const res = await app.handle(new Request('http://localhost/v1/openapi.json'))
  expect(res.status).toBe(200)

  const spec = (await res.json()) as {
    components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> }
    paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>
  }

  // The named ModerationError component is registered with the full field set.
  const moderationError = spec.components?.schemas?.['ModerationError']
  expect(moderationError).toBeDefined()
  for (const field of ['error', 'code', 'category', 'message', 'retryable', 'guidance']) {
    expect(moderationError!.properties?.[field]).toBeDefined()
  }

  // A moderated write route surfaces a 422 response in the generated spec.
  const postPosts = spec.paths['/v1/social/posts']?.['post']
  expect(postPosts?.responses?.['422']).toBeDefined()
})

test('GET /v1/docs redirects or serves the scalar UI', async () => {
  const res = await app.handle(new Request('http://localhost/v1/docs'))
  // Scalar UI returns a redirect (302) or an HTML page (200)
  expect([200, 301, 302, 307, 308]).toContain(res.status)
})
