import { config } from './config.ts'
import { app } from './index.ts'

const server = Bun.serve({
  port: config.PORT,
  hostname: '0.0.0.0',
  fetch: app.fetch,
})

console.log(`[api] started on 0.0.0.0:${server.port}`)
