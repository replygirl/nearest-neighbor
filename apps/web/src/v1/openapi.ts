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
        schemas: {
          // The structured moderation block body — the ModerationError arm of the
          // 422 union (`{ error }` | ModerationError) returned by all five
          // moderated write routes. Mirrors apps/web/src/moderation/schema.ts;
          // kept as a plain OpenAPI object here so the named 422 contract appears
          // in the API docs without importing a runtime TypeBox value.
          ModerationError: {
            type: 'object',
            required: ['error', 'code', 'category', 'message', 'retryable', 'guidance'],
            properties: {
              error: { type: 'string' },
              code: { type: 'string', enum: ['content_blocked'] },
              category: { type: 'string' },
              message: { type: 'string' },
              retryable: { type: 'boolean' },
              guidance: { type: 'string' },
            },
          },
        },
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
