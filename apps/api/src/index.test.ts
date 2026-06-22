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
