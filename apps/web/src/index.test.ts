import { expect, test } from 'bun:test'

import { app } from './index.ts'

test('api app boots and exposes /health', async () => {
  const res = await app.handle(new Request('http://localhost/health'))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { status: string; uptime: number }
  expect(body.status).toBe('ok')
  expect(typeof body.uptime).toBe('number')
})

test('/v1/health also responds', async () => {
  const res = await app.handle(new Request('http://localhost/v1/health'))
  expect(res.status).toBe(200)
  const body = (await res.json()) as { status: string }
  expect(body.status).toBe('ok')
})

test('security headers are present on all responses', async () => {
  const res = await app.handle(new Request('http://localhost/health'))
  expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  expect(res.headers.get('x-frame-options')).toBe('DENY')
  expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  expect(res.headers.get('strict-transport-security')).toContain('max-age=63072000')
  expect(res.headers.get('permissions-policy')).toContain('geolocation=()')
})
