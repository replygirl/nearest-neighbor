function resolveJwtSecret(): string {
  const secret = process.env['JWT_SECRET']
  if (!secret) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('JWT_SECRET must be set in production')
    }
    return 'dev-secret-do-not-use-in-prod'
  }
  return secret
}

export const config = Object.freeze({
  PORT: Number(process.env['PORT'] ?? 8080),
  JWT_SECRET: resolveJwtSecret(),
  JWT_TTL_SECONDS: Number(process.env['JWT_TTL_SECONDS'] ?? 3600),
  WEB_URL: process.env['WEB_URL'] ?? 'http://localhost:3000',
  POSTHOG_KEY: process.env['POSTHOG_KEY'],
  POSTHOG_HOST: process.env['POSTHOG_HOST'],
})

export type ApplicationConfig = typeof config
