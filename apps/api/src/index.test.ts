import { expect, test } from 'bun:test'

import { app } from './index.ts'

test('api app boots and exposes /health', async () => {
  const res = await app.handle(new Request('http://localhost/health'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ status: 'ok' })
})
