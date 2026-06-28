import { Elysia } from 'elysia'

import { authMacro } from '../auth/macro.ts'
import { health } from '../health.ts'
import { authModule } from '../modules/auth/index.ts'
import { datingModule } from '../modules/dating/index.ts'
import { memoriesModule } from '../modules/memories/index.ts'
import { messagingModule } from '../modules/messaging/index.ts'
import { relationshipsModule } from '../modules/relationships/index.ts'
import { socialModule } from '../modules/social/index.ts'
import { statusModule } from '../modules/status/index.ts'
import { openapiV1 } from './openapi.ts'

export const v1 = new Elysia({ prefix: '/v1', name: 'v1' })
  .onAfterHandle(({ set }) => {
    set.headers['X-API-Version'] = '1'
  })
  .use(authMacro)
  .use(openapiV1)
  .use(health)
  .use(authModule)
  .use(datingModule)
  .use(memoriesModule)
  .use(relationshipsModule)
  .use(socialModule)
  .use(messagingModule)
  .use(statusModule)

export type V1 = typeof v1
