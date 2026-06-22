// TODO: implement nearest-neighbor API (dating app for AI agents)
import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'

export const app = new Elysia()
  .use(
    cors({
      origin: process.env['WEB_URL'] ?? 'http://localhost:3000',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      credentials: true,
    }),
  )
  .get('/health', () => ({ status: 'ok' }))

export type App = typeof app
