// Auth module tests: signup, login, tokens, /me, error cases.
// Uses PGlite via test/setup.ts.

import { beforeEach, describe, expect, test } from 'bun:test'

import { Elysia } from 'elysia'

import { authMacro } from '../auth/macro.ts'
import { clearRateLimitState } from '../lib/ratelimit.ts'
import { authModule } from '../modules/auth/index.ts'
import '../test/setup.ts'
import { authHeaders, createTestAccount } from '../test/helpers.ts'

// Typed JSON helper — avoids repeated `as unknown as T` casts throughout tests.
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

// Mount the auth module on a fresh Elysia instance for testing.
const app = new Elysia().use(authMacro).use(authModule)

// Reset rate limiter before each test to avoid cross-test contamination.
beforeEach(() => {
  clearRateLimitState()
})

// ── /auth/signup ────────────────────────────────────────────────────────────

describe('POST /auth/signup', () => {
  test('creates account and returns secret', async () => {
    const res = await app.handle(new Request('http://localhost/auth/signup', { method: 'POST' }))
    expect(res.status).toBe(201)
    const body = await json<{ account_id: string; secret: string }>(res)
    expect(typeof body.account_id).toBe('string')
    expect(typeof body.secret).toBe('string')
    expect(body.secret.startsWith('nbr_')).toBe(true)
  })

  test('each signup creates a unique account', async () => {
    const res1 = await app.handle(new Request('http://localhost/auth/signup', { method: 'POST' }))
    const res2 = await app.handle(new Request('http://localhost/auth/signup', { method: 'POST' }))
    const b1 = await json<{ account_id: string; secret: string }>(res1)
    const b2 = await json<{ account_id: string; secret: string }>(res2)
    expect(b1.account_id).not.toBe(b2.account_id)
    expect(b1.secret).not.toBe(b2.secret)
  })

  test('returns 429 after exceeding rate limit', async () => {
    // Fill up the rate limit window (default: 10 requests per minute)
    for (let i = 0; i < 10; i++) {
      await app.handle(new Request('http://localhost/auth/signup', { method: 'POST' }))
    }
    const res = await app.handle(new Request('http://localhost/auth/signup', { method: 'POST' }))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).not.toBeNull()
    expect(res.headers.get('ratelimit-reset')).not.toBeNull()
  })

  test('emits RateLimit-* headers on a successful signup', async () => {
    const res = await app.handle(new Request('http://localhost/auth/signup', { method: 'POST' }))
    expect(res.status).toBe(201)
    expect(res.headers.get('ratelimit-limit')).not.toBeNull()
    expect(res.headers.get('ratelimit-remaining')).not.toBeNull()
    expect(res.headers.get('ratelimit-reset')).not.toBeNull()
  })
})

// ── /auth/login ─────────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  test('returns bearer + expires_at for valid secret', async () => {
    const signupRes = await app.handle(
      new Request('http://localhost/auth/signup', { method: 'POST' }),
    )
    const { secret } = await json<{ secret: string }>(signupRes)

    const loginRes = await app.handle(
      new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      }),
    )
    expect(loginRes.status).toBe(200)
    const body = await json<{ bearer: string; expires_at: string }>(loginRes)
    expect(typeof body.bearer).toBe('string')
    expect(typeof body.expires_at).toBe('string')
    // expires_at should be a valid ISO timestamp in the future
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now())
  })

  test('returns 401 for wrong secret', async () => {
    const res = await app.handle(
      new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: 'nbr_wrongsecret' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  test('returns 429 after exceeding rate limit', async () => {
    for (let i = 0; i < 10; i++) {
      await app.handle(
        new Request('http://localhost/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: 'nbr_test' }),
        }),
      )
    }
    const res = await app.handle(
      new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: 'nbr_test' }),
      }),
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).not.toBeNull()
    expect(res.headers.get('ratelimit-reset')).not.toBeNull()
  })

  test('emits RateLimit-* headers on a successful login', async () => {
    const signupRes = await app.handle(
      new Request('http://localhost/auth/signup', { method: 'POST' }),
    )
    const { secret } = await json<{ secret: string }>(signupRes)

    const res = await app.handle(
      new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('ratelimit-limit')).not.toBeNull()
    expect(res.headers.get('ratelimit-remaining')).not.toBeNull()
    expect(res.headers.get('ratelimit-reset')).not.toBeNull()
  })

  test('updates last_used_at on successful login', async () => {
    const signupRes = await app.handle(
      new Request('http://localhost/auth/signup', { method: 'POST' }),
    )
    const { secret, account_id } = await json<{ secret: string; account_id: string }>(signupRes)

    const loginRes = await app.handle(
      new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      }),
    )
    expect(loginRes.status).toBe(200)
    const { bearer } = await json<{ bearer: string }>(loginRes)

    // Check tokens list shows last_used_at
    const tokensRes = await app.handle(
      new Request('http://localhost/auth/tokens', { headers: authHeaders(bearer) }),
    )
    const tokens = await json<Array<{ last_used_at: string | null }>>(tokensRes)
    expect(tokens[0]?.last_used_at).not.toBeNull()
    expect(account_id).toBeDefined()
  })
})

// ── /auth/logout ────────────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  test('returns 204 for authenticated request', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/auth/logout', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(204)
  })

  test('returns 401 without bearer', async () => {
    const res = await app.handle(new Request('http://localhost/auth/logout', { method: 'POST' }))
    expect(res.status).toBe(401)
  })

  test('revokes a specific token when revoke_secret_id provided', async () => {
    const { bearer } = await createTestAccount()

    // Get the token id
    const tokensRes = await app.handle(
      new Request('http://localhost/auth/tokens', { headers: authHeaders(bearer) }),
    )
    const tokens = await json<Array<{ id: string; revoked_at: string | null }>>(tokensRes)
    const tokenId = tokens[0]!.id

    // Logout with revoke
    const logoutRes = await app.handle(
      new Request('http://localhost/auth/logout', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ revoke_secret_id: tokenId }),
      }),
    )
    expect(logoutRes.status).toBe(204)

    // Token should now be revoked
    const tokensRes2 = await app.handle(
      new Request('http://localhost/auth/tokens', { headers: authHeaders(bearer) }),
    )
    const tokens2 = await json<Array<{ revoked_at: string | null }>>(tokensRes2)
    expect(tokens2[0]?.revoked_at).not.toBeNull()
  })
})

// ── /auth/tokens ────────────────────────────────────────────────────────────

describe('GET /auth/tokens', () => {
  test('lists tokens for authenticated account', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/auth/tokens', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const tokens =
      await json<Array<{ id: string; prefix: string; label: string; created_at: string }>>(res)
    expect(Array.isArray(tokens)).toBe(true)
    expect(tokens.length).toBe(1)
    expect(typeof tokens[0]!.id).toBe('string')
    expect(typeof tokens[0]!.prefix).toBe('string')
    expect(typeof tokens[0]!.label).toBe('string')
    expect(typeof tokens[0]!.created_at).toBe('string')
  })

  test('returns 401 without auth', async () => {
    const res = await app.handle(new Request('http://localhost/auth/tokens'))
    expect(res.status).toBe(401)
  })
})

describe('POST /auth/tokens', () => {
  test('creates a new secret token', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/auth/tokens', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'ci-bot' }),
      }),
    )
    expect(res.status).toBe(201)
    const body = await json<{ secret: string; label: string }>(res)
    expect(typeof body.secret).toBe('string')
    expect(body.secret.startsWith('nbr_')).toBe(true)
    expect(body.label).toBe('ci-bot')
  })

  test('rejects label over 100 chars with 422', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/auth/tokens', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'a'.repeat(101) }),
      }),
    )
    expect(res.status).toBe(422)
  })

  test('returns 429 after exceeding token creation rate limit', async () => {
    const { bearer } = await createTestAccount()
    for (let i = 0; i < 10; i++) {
      await app.handle(
        new Request('http://localhost/auth/tokens', {
          method: 'POST',
          headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
    }
    const res = await app.handle(
      new Request('http://localhost/auth/tokens', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).not.toBeNull()
    expect(res.headers.get('ratelimit-reset')).not.toBeNull()
  })

  test('emits RateLimit-* headers on a successful token create', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/auth/tokens', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(201)
    expect(res.headers.get('ratelimit-limit')).not.toBeNull()
    expect(res.headers.get('ratelimit-remaining')).not.toBeNull()
    expect(res.headers.get('ratelimit-reset')).not.toBeNull()
  })
})

// ── JWT revocation ──────────────────────────────────────────────────────────

describe('JWT revocation via sid claim', () => {
  test('bearer is rejected 401 after its secret is revoked', async () => {
    // Sign up to get a fresh secret
    const signupRes = await app.handle(
      new Request('http://localhost/auth/signup', { method: 'POST' }),
    )
    expect(signupRes.status).toBe(201)
    const { secret } = await json<{ secret: string }>(signupRes)

    // Log in — the returned bearer now carries a sid claim
    const loginRes = await app.handle(
      new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      }),
    )
    expect(loginRes.status).toBe(200)
    const { bearer } = await json<{ bearer: string }>(loginRes)

    // Confirm the bearer works before revocation
    const beforeRes = await app.handle(
      new Request('http://localhost/auth/me', { headers: authHeaders(bearer) }),
    )
    expect(beforeRes.status).toBe(200)

    // Fetch the secret id then revoke it
    const tokensRes = await app.handle(
      new Request('http://localhost/auth/tokens', { headers: authHeaders(bearer) }),
    )
    const tokens = await json<Array<{ id: string }>>(tokensRes)
    const secretId = tokens[0]!.id

    const deleteRes = await app.handle(
      new Request(`http://localhost/auth/tokens/${secretId}`, {
        method: 'DELETE',
        headers: authHeaders(bearer),
      }),
    )
    expect(deleteRes.status).toBe(204)

    // The same bearer must now be rejected
    const afterRes = await app.handle(
      new Request('http://localhost/auth/me', { headers: authHeaders(bearer) }),
    )
    expect(afterRes.status).toBe(401)
  })
})

// ── Login prefix narrowing ───────────────────────────────────────────────────

describe('POST /auth/login prefix narrowing', () => {
  test('prefix-narrowed login still authenticates correctly', async () => {
    const signupRes = await app.handle(
      new Request('http://localhost/auth/signup', { method: 'POST' }),
    )
    const { secret } = await json<{ secret: string }>(signupRes)

    const loginRes = await app.handle(
      new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      }),
    )
    expect(loginRes.status).toBe(200)
    const body = await json<{ bearer: string; expires_at: string }>(loginRes)
    expect(typeof body.bearer).toBe('string')
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now())
  })
})

// ── DELETE /auth/tokens/:id ──────────────────────────────────────────────────

describe('DELETE /auth/tokens/:id', () => {
  test('revokes a token', async () => {
    const { bearer } = await createTestAccount()

    // Create an extra token
    const createRes = await app.handle(
      new Request('http://localhost/auth/tokens', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'to-revoke' }),
      }),
    )
    const { id } = await json<{ id: string }>(createRes)

    const deleteRes = await app.handle(
      new Request(`http://localhost/auth/tokens/${id}`, {
        method: 'DELETE',
        headers: authHeaders(bearer),
      }),
    )
    expect(deleteRes.status).toBe(204)
  })

  test('returns 404 for token belonging to another account', async () => {
    const { bearer } = await createTestAccount()
    const { bearer: bearer2 } = await createTestAccount()

    // Get account2's token id
    const tokensRes = await app.handle(
      new Request('http://localhost/auth/tokens', { headers: authHeaders(bearer2) }),
    )
    const tokens = await json<Array<{ id: string }>>(tokensRes)
    const otherId = tokens[0]!.id

    // Try to revoke from account1
    const res = await app.handle(
      new Request(`http://localhost/auth/tokens/${otherId}`, {
        method: 'DELETE',
        headers: authHeaders(bearer),
      }),
    )
    expect(res.status).toBe(404)
  })
})

// ── /auth/me ────────────────────────────────────────────────────────────────

describe('GET /auth/me', () => {
  test('returns account info without profiles', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request('http://localhost/auth/me', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{
      account: { id: string; status: string }
      dating_profile: null
      social_profile: null
    }>(res)
    expect(typeof body.account.id).toBe('string')
    expect(body.account.status).toBe('active')
    expect(body.dating_profile).toBeNull()
    expect(body.social_profile).toBeNull()
  })

  test('includes dating profile when present', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Alice', bio: 'Hello!' },
    })
    const res = await app.handle(
      new Request('http://localhost/auth/me', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ dating_profile: { first_name: string } | null }>(res)
    expect(body.dating_profile).not.toBeNull()
    expect(body.dating_profile?.first_name).toBe('Alice')
  })

  test('includes social profile when present', async () => {
    const handle = `alicetest_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({
      socialProfile: { handle, displayName: 'Alice' },
    })
    const res = await app.handle(
      new Request('http://localhost/auth/me', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ social_profile: { handle: string } | null }>(res)
    expect(body.social_profile).not.toBeNull()
    expect(body.social_profile?.handle).toBe(handle)
  })

  test('returns 401 without auth', async () => {
    const res = await app.handle(new Request('http://localhost/auth/me'))
    expect(res.status).toBe(401)
  })

  test('returns 401 with invalid bearer', async () => {
    const res = await app.handle(
      new Request('http://localhost/auth/me', {
        headers: { Authorization: 'Bearer invalid.jwt.here' },
      }),
    )
    expect(res.status).toBe(401)
  })
})
