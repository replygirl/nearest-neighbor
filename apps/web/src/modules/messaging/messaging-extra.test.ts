// Additional messaging module tests covering previously uncovered branches.
// Uses PGlite via test/setup.ts.

import { beforeEach, describe, expect, test } from 'bun:test'

import { Elysia } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import { getOrCreateConversation, unlockSocial } from '../../lib/conversations.ts'
import { clearRateLimitState } from '../../lib/ratelimit.ts'
import '../../test/setup.ts'
import { authHeaders, createTestAccount } from '../../test/helpers.ts'
import { messagingModule } from './index.ts'

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

const app = new Elysia().use(authMacro).use(messagingModule)

beforeEach(() => {
  clearRateLimitState()
})

// ── POST /conversations — start by handle (line 191 branch) ───────────────────

describe('POST /conversations — start by handle', () => {
  test('creates conversation using handle when recipient has open_dms', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `hconv_alice_${Date.now().toString(36)}` },
    })
    const bobHandle = `hconv_bob_${Date.now().toString(36)}`
    await createTestAccount({
      socialProfile: { handle: bobHandle, openDms: true },
    })

    const res = await app.handle(
      new Request('http://localhost/conversations', {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: bobHandle }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ id: string; social_unlocked: boolean }>(res)
    expect(typeof body.id).toBe('string')
    expect(body.social_unlocked).toBe(true)
  })
})

// ── POST /conversations/:id/messages — rate limiting ─────────────────────────

describe('POST /conversations/:id/messages — rate limiting', () => {
  test('returns 429 after 60 messages per minute per account', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `rl_alice_${Date.now().toString(36)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `rl_bob_${Date.now().toString(36)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    let lastRes: Response | null = null
    // 61 requests — the 61st should be rate-limited (max is 60)
    for (let i = 0; i <= 60; i++) {
      lastRes = await app.handle(
        new Request(`http://localhost/conversations/${conv.id}/messages`, {
          method: 'POST',
          headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: `msg ${i}` }),
        }),
      )
    }

    expect(lastRes!.status).toBe(429)
    const body = await json<{ error: string }>(lastRes!)
    expect(typeof body.error).toBe('string')
    expect(lastRes!.headers.get('retry-after')).not.toBeNull()
    expect(lastRes!.headers.get('ratelimit-reset')).not.toBeNull()
  })

  test('emits RateLimit-* headers on successful message send', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `rl_hdr_alice_${Date.now().toString(36)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `rl_hdr_bob_${Date.now().toString(36)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    const res = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'header check' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('ratelimit-limit')).not.toBeNull()
    expect(res.headers.get('ratelimit-remaining')).not.toBeNull()
    expect(res.headers.get('ratelimit-reset')).not.toBeNull()
  })
})

// ── POST /conversations/:id/messages — ascii_image validation ─────────────────

describe('POST /conversations/:id/messages — ascii_image validation', () => {
  test('returns 422 for ascii_image exceeding 40 lines', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `art_alice_${Date.now().toString(36)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `art_bob_${Date.now().toString(36)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    // 41 lines — exceeds PHOTO_MAX_LINES (40)
    const tooManyLines = Array.from({ length: 41 }, (_, i) => `line ${i}`).join('\n')

    const res = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Here is some art', ascii_image: tooManyLines }),
      }),
    )
    expect(res.status).toBe(422)
    const body = await json<{ error: string }>(res)
    expect(typeof body.error).toBe('string')
  })

  test('returns 422 for ascii_image with a line exceeding 80 chars', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `art2_alice_${Date.now().toString(36)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `art2_bob_${Date.now().toString(36)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    // Single line with 81 chars — exceeds PHOTO_MAX_LINE_LENGTH (80)
    const tooLongLine = 'x'.repeat(81)

    const res = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Here is some art', ascii_image: tooLongLine }),
      }),
    )
    expect(res.status).toBe(422)
    const body = await json<{ error: string }>(res)
    expect(typeof body.error).toBe('string')
  })

  test('accepts valid ascii_image within 40 lines × 80 chars', async () => {
    const alice = await createTestAccount({
      socialProfile: { handle: `art3_alice_${Date.now().toString(36)}` },
    })
    const bob = await createTestAccount({
      socialProfile: { handle: `art3_bob_${Date.now().toString(36)}` },
    })

    const conv = await getOrCreateConversation(alice.id, bob.id)
    await unlockSocial(alice.id, bob.id)

    const validArt = '  *  \n  |  \n /|\\ '

    const res = await app.handle(
      new Request(`http://localhost/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'Check this art', ascii_image: validArt }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ ascii_image: string | null }>(res)
    expect(body.ascii_image).toBe(validArt)
  })
})
