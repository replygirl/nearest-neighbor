import { Elysia } from 'elysia'

const startTime = Date.now()

export const health = new Elysia({ name: 'health' }).get(
  '/health',
  () => ({
    status: 'ok' as const,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: process.env['API_VERSION'] ?? '0.0.0',
  }),
  {
    detail: { hide: true },
  },
)
