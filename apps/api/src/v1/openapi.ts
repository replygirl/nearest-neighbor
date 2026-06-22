import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'

// Mounted inside v1 Elysia (prefix: '/v1'), so paths resolve to /v1/docs and /v1/openapi.json
export const openapiV1 = new Elysia({ name: 'openapi-v1' }).use(
  openapi({
    path: '/docs',
    specPath: '/openapi.json',
    documentation: {
      info: {
        title: 'Nearest Neighbor API v1',
        // '1' is the contract version (URL /v1/), orthogonal to binary semver
        version: '1',
        description: 'REST API for Nearest Neighbor — dating, social, messaging, and status.',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http' as const,
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    scalar: {
      version: '1.52.6',
      theme: 'none',
    },
  }),
)
