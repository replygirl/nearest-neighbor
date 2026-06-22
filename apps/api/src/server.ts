// TODO: configure server from env (PORT, HOST, etc.)
import { app } from './index.ts'

const server = Bun.serve({
  port: Number(process.env['PORT'] ?? 8080),
  hostname: process.env['HOST'] ?? '0.0.0.0',
  fetch: app.fetch,
})

console.log(`[api] started on ${server.hostname}:${server.port}`)
