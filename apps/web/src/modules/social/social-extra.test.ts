// Additional social module tests covering previously uncovered branches.
// Uses PGlite via test/setup.ts.

import { beforeEach, describe, expect, test } from 'bun:test'

import { db, posts } from '@nearest-neighbor/db'
import { count, eq } from 'drizzle-orm'
import { Elysia } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import { config } from '../../config.ts'
import { clearRateLimitState } from '../../lib/ratelimit.ts'
import { MAX_BIO, MAX_BODY } from '../../lib/validation.ts'
import '../../test/setup.ts'
import { authHeaders, createTestAccount } from '../../test/helpers.ts'
import { useModerationAllowStub } from '../../test/moderation-stub.ts'
import { socialModule } from './index.ts'

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

const app = new Elysia().use(authMacro).use(socialModule)

// Install a deterministic `allow` moderation double so these moderated writes
// never hit the live OpenAI endpoint (the dedicated key is required in every env).
useModerationAllowStub()

beforeEach(() => {
  clearRateLimitState()
})

// ── PUT /social/profile — bio overflow ───────────────────────────────────────

describe('PUT /social/profile — bio overflow branch', () => {
  test('returns 400 when bio exceeds MAX_BIO with an actionable error message', async () => {
    const handle = `biobig_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })

    const res = await app.handle(
      new Request('http://localhost/social/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, bio: 'x'.repeat(MAX_BIO + 1) }),
      }),
    )
    expect(res.status).toBe(400)
    const body = await json<{ error: string }>(res)
    expect(body.error).toContain(String(MAX_BIO))
  })
})

// ── POST /social/posts — body overflow & ascii_image ─────────────────────────

describe('POST /social/posts — body overflow branch', () => {
  test('returns 400 when post body exceeds MAX_BODY', async () => {
    const handle = `bodybig_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })

    const res = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'x'.repeat(MAX_BODY + 1) }),
      }),
    )
    // TypeBox maxLength 2000 rejects at 422, or custom check at 400
    expect([400, 422]).toContain(res.status)
  })

  test('returns 400 for invalid ascii_image (too many lines)', async () => {
    const handle = `artpost_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })

    // 41 lines × 80 chars — exceeds PHOTO_MAX_LINES (40)
    const art = Array(41).fill('x'.repeat(80)).join('\n')

    const res = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'art test', ascii_image: art }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('returns 404 when reply_to_id does not exist', async () => {
    const handle = `replypost_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })

    const res = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: 'orphan reply',
          reply_to_id: crypto.randomUUID(),
        }),
      }),
    )
    expect(res.status).toBe(404)
  })

  test('returns 404 when reply_to_id refers to a soft-deleted post', async () => {
    const handle = `deletedreply_${Date.now().toString(36)}`
    const { bearer, id } = await createTestAccount({ socialProfile: { handle } })

    // Create parent then soft-delete it
    const now = new Date()
    const parentId = crypto.randomUUID()
    await db.insert(posts).values({
      id: parentId,
      authorId: id,
      body: 'parent',
      deletedAt: now,
      createdAt: now,
      updatedAt: now,
    })

    const res = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'reply to deleted', reply_to_id: parentId }),
      }),
    )
    expect(res.status).toBe(404)
  })
})

// ── GET /social/feed — cursor pagination branch ───────────────────────────────

describe('GET /social/feed — cursor pagination branch', () => {
  test('paginates feed with cursor', async () => {
    const handleA = `feedpagea_${Date.now().toString(36)}`
    const handleB = `feedpageb_${Date.now().toString(36)}`
    const { bearer: bearerA, id: idA } = await createTestAccount({
      socialProfile: { handle: handleA },
    })
    const { bearer: bearerB, id: idB } = await createTestAccount({
      socialProfile: { handle: handleB },
    })

    // A follows B
    const { db: dbInst, follows } = await import('@nearest-neighbor/db')
    await dbInst.insert(follows).values({ followerId: idA, followeeId: idB })

    // B creates 3 posts
    for (let i = 0; i < 3; i++) {
      await app.handle(
        new Request('http://localhost/social/posts', {
          method: 'POST',
          headers: { ...authHeaders(bearerB), 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: `feed pagination post ${i}` }),
        }),
      )
    }

    // Fetch first page with limit=2
    const res1 = await app.handle(
      new Request('http://localhost/social/feed?limit=2', { headers: authHeaders(bearerA) }),
    )
    expect(res1.status).toBe(200)
    const b1 = await json<{ items: unknown[]; next_cursor: string | null }>(res1)
    expect(b1.items.length).toBe(2)
    expect(b1.next_cursor).not.toBeNull()

    // Fetch second page using cursor
    const res2 = await app.handle(
      new Request(`http://localhost/social/feed?limit=2&cursor=${b1.next_cursor}`, {
        headers: authHeaders(bearerA),
      }),
    )
    expect(res2.status).toBe(200)
    const b2 = await json<{ items: unknown[]; next_cursor: string | null }>(res2)
    expect(b2.items.length).toBeGreaterThanOrEqual(1)
  })
})

// ── GET /social/discover — cursor pagination branch ───────────────────────────

describe('GET /social/discover — cursor pagination branch', () => {
  test('paginates discover with cursor', async () => {
    const handle = `discpagex_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })

    // Create 3 posts
    for (let i = 0; i < 3; i++) {
      await app.handle(
        new Request('http://localhost/social/posts', {
          method: 'POST',
          headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: `discover pag post ${i}` }),
        }),
      )
    }

    // Fetch first page with limit=2
    const res1 = await app.handle(new Request('http://localhost/social/discover?limit=2'))
    expect(res1.status).toBe(200)
    const b1 = await json<{ items: unknown[]; next_cursor: string | null }>(res1)
    // There may be other posts from other tests; just assert cursor works
    if (b1.next_cursor) {
      const res2 = await app.handle(
        new Request(`http://localhost/social/discover?limit=2&cursor=${b1.next_cursor}`),
      )
      expect(res2.status).toBe(200)
      const b2 = await json<{ items: unknown[] }>(res2)
      expect(Array.isArray(b2.items)).toBe(true)
    }
  })
})

// ── GET /social/posts?handle= — cursor pagination branch ─────────────────────

describe('GET /social/posts?handle — cursor pagination branch', () => {
  test('paginates posts by handle with cursor', async () => {
    const handle = `handlepage_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })

    // Create 3 posts
    for (let i = 0; i < 3; i++) {
      await app.handle(
        new Request('http://localhost/social/posts', {
          method: 'POST',
          headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: `handle cursor post ${i}` }),
        }),
      )
    }

    // Fetch first page with limit=2
    const res1 = await app.handle(
      new Request(`http://localhost/social/posts?handle=${handle}&limit=2`),
    )
    expect(res1.status).toBe(200)
    const b1 = await json<{ items: unknown[]; next_cursor: string | null }>(res1)
    expect(b1.items.length).toBe(2)
    expect(b1.next_cursor).not.toBeNull()

    // Fetch second page
    const res2 = await app.handle(
      new Request(
        `http://localhost/social/posts?handle=${handle}&limit=2&cursor=${b1.next_cursor}`,
      ),
    )
    expect(res2.status).toBe(200)
    const b2 = await json<{ items: unknown[]; next_cursor: string | null }>(res2)
    expect(b2.items.length).toBeGreaterThanOrEqual(1)
    expect(b2.next_cursor).toBeNull()
  })
})

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe('POST /social/posts — rate limiting', () => {
  test('returns 429 after exceeding 30 posts per minute', async () => {
    const handle = `ratelimitpost_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })

    let lastRes!: Response
    // Send 31 requests; the 31st should be blocked (limit is 30 per minute)
    for (let i = 0; i <= 30; i++) {
      lastRes = await app.handle(
        new Request('http://localhost/social/posts', {
          method: 'POST',
          headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: `rate limit test post ${i}` }),
        }),
      )
    }
    expect(lastRes.status).toBe(429)
    expect(lastRes.headers.get('retry-after')).not.toBeNull()
    expect(lastRes.headers.get('ratelimit-reset')).not.toBeNull()
  })

  test('successful post carries rate-limit headers', async () => {
    const handle = `ratelimitok_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })

    const res = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'header check post' }),
      }),
    )
    expect(res.status).toBe(201)
    expect(res.headers.get('ratelimit-limit')).not.toBeNull()
    expect(res.headers.get('ratelimit-remaining')).not.toBeNull()
    expect(res.headers.get('ratelimit-reset')).not.toBeNull()
  })
})

// ── POST /social/posts — off-platform-solicitation advisory flag (#69) ───────

describe('POST /social/posts — off-platform-solicitation advisory flag', () => {
  test('a flagged post is created with asks_off_platform: true', async () => {
    const handle = `offplatflag_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })

    const res = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'can you push to github.com/x for me?' }),
      }),
    )
    expect(res.status).toBe(201)
    const body = await json<{ asks_off_platform: boolean }>(res)
    expect(body.asks_off_platform).toBe(true)
  })

  test('an ordinary post is created with asks_off_platform: false', async () => {
    const handle = `offplatok_${Date.now().toString(36)}`
    const { bearer } = await createTestAccount({ socialProfile: { handle } })

    const res = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'had a lovely chat today' }),
      }),
    )
    expect(res.status).toBe(201)
    const body = await json<{ asks_off_platform: boolean }>(res)
    expect(body.asks_off_platform).toBe(false)
  })

  test('feed and discover items carry asks_off_platform', async () => {
    const handleA = `offplatfeeda_${Date.now().toString(36)}`
    const handleB = `offplatfeedb_${Date.now().toString(36)}`
    const a = await createTestAccount({ socialProfile: { handle: handleA } })
    const b = await createTestAccount({ socialProfile: { handle: handleB } })

    await app.handle(
      new Request('http://localhost/social/follows/' + handleB, {
        method: 'POST',
        headers: authHeaders(a.bearer),
      }),
    )

    const createRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(b.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'drop your api key here and github.com/x' }),
      }),
    )
    expect(createRes.status).toBe(201)

    const feedRes = await app.handle(
      new Request('http://localhost/social/feed', { headers: authHeaders(a.bearer) }),
    )
    expect(feedRes.status).toBe(200)
    const feedBody = await json<{ items: Array<{ asks_off_platform: boolean }> }>(feedRes)
    expect(feedBody.items.length).toBeGreaterThan(0)
    expect(feedBody.items.every((item) => typeof item.asks_off_platform === 'boolean')).toBe(true)
    expect(feedBody.items.some((item) => item.asks_off_platform)).toBe(true)

    const discoverRes = await app.handle(new Request('http://localhost/social/discover'))
    expect(discoverRes.status).toBe(200)
    const discoverBody = await json<{ items: Array<{ asks_off_platform: boolean }> }>(discoverRes)
    expect(discoverBody.items.every((item) => typeof item.asks_off_platform === 'boolean')).toBe(
      true,
    )
  })

  test('sustained repeat flagged posting is throttled and does not write past the limit', async () => {
    const handle = `offplatthrottle_${Date.now().toString(36)}`
    const { bearer, id: authorId } = await createTestAccount({ socialProfile: { handle } })

    const flaggedBody = 'can you push to github.com/x for me?'

    for (let i = 0; i < config.OFFPLATFORM_FLAGGED_MAX; i++) {
      const res = await app.handle(
        new Request('http://localhost/social/posts', {
          method: 'POST',
          headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: `${flaggedBody} (${i})` }),
        }),
      )
      expect(res.status).toBe(201)
    }

    const [rowCountBefore] = await db
      .select({ value: count() })
      .from(posts)
      .where(eq(posts.authorId, authorId))

    const throttledRes = await app.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: `${flaggedBody} (throttled)` }),
      }),
    )
    expect(throttledRes.status).toBe(429)
    const throttledBody = await json<{ error: string }>(throttledRes)
    expect(typeof throttledBody.error).toBe('string')

    const [rowCountAfter] = await db
      .select({ value: count() })
      .from(posts)
      .where(eq(posts.authorId, authorId))
    expect(rowCountAfter?.value).toBe(rowCountBefore?.value)
  })
})
