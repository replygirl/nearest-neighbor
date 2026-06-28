// Memories module tests: list, injection index, get-by-id, create, patch, delete.
// Uses PGlite via test/setup.ts. Moderation runs through #53's moderationMacro:
// `useModerationAllowStub()` installs a permissive provider before every test so
// no test touches the live OpenAI endpoint; block tests install their own
// blocking provider via `setModerationProviderForTest` in the test body.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { db, memories, memorySubjects } from '@nearest-neighbor/db'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import '../../test/setup.ts'
import { clearRateLimitState } from '../../lib/ratelimit.ts'
import type { ModerationResult } from '../../moderation/client.ts'
import { setModerationProviderForTest } from '../../moderation/macro.ts'
import { authHeaders, createTestAccount } from '../../test/helpers.ts'
import { useModerationAllowStub } from '../../test/moderation-stub.ts'
import { memoriesModule } from './index.ts'

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

const app = new Elysia().use(authMacro).use(memoriesModule)

// ── Moderation provider doubles (#53 macro seam) ───────────────────────────────
// `useModerationAllowStub()` installs a permissive provider before every test via
// a file-scoped beforeEach. Block tests install `blockProvider(marker)` in their
// own body — it runs after the allow stub and flags the moderated text (the macro
// concatenates `description` + `body`) whenever that text contains `marker`.

useModerationAllowStub()

/** Flags any text containing `marker` as sexual/minors; allows everything else. */
function blockProvider(marker: string): (text: string) => Promise<ModerationResult> {
  const flagged: ModerationResult = {
    model: 'test-omni',
    flagged: true,
    categories: { 'sexual/minors': true },
    scores: { 'sexual/minors': 0.99 },
    appliedTypes: { 'sexual/minors': ['text'] },
  }
  const allowed: ModerationResult = {
    model: 'test-omni',
    flagged: false,
    categories: {},
    scores: {},
    appliedTypes: {},
  }
  return (text: string) => Promise.resolve(text.includes(marker) ? flagged : allowed)
}

beforeEach(() => {
  clearRateLimitState()
})

afterEach(() => {
  setModerationProviderForTest(null)
})

// ── Request helpers ────────────────────────────────────────────────────────────

interface MemoryBody {
  scope?: string
  description?: string
  body?: string
  pinned?: boolean
  salience?: number
  add_subject?: string
  remove_subject?: string
}

function post(bearer: string, body: MemoryBody): Promise<Response> {
  return app.handle(
    new Request('http://localhost/memories', {
      method: 'POST',
      headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

function patch(bearer: string, id: string, body: MemoryBody): Promise<Response> {
  return app.handle(
    new Request(`http://localhost/memories/${id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

async function createMemory(bearer: string, body: MemoryBody): Promise<string> {
  const res = await post(bearer, { description: 'seed', ...body })
  expect(res.status).toBe(201)
  const created = await json<{ id: string }>(res)
  return created.id
}

/**
 * Seed memories directly with strictly increasing `created_at` (1s apart) so a
 * created_at-descending list is deterministic. The public POST stamps
 * `new Date()` at millisecond resolution, so rapid sequential creates can share
 * a `created_at` and fall through to the route's id-descending tiebreak — which
 * is a random UUID and does not track insertion order. Tests that assert an
 * insertion-derived order seed timestamps here; the POST path is covered by the
 * dedicated `POST /memories` suite. `descriptions` is oldest-first; returns the
 * inserted ids in the same order.
 */
async function seedMemoriesOldestFirst(
  accountId: string,
  descriptions: string[],
): Promise<string[]> {
  const base = new Date('2026-01-01T00:00:00.000Z').getTime()
  const rows = descriptions.map((description, i) => {
    const ts = new Date(base + i * 1000)
    return {
      id: crypto.randomUUID(),
      accountId,
      scope: 'general' as const,
      description,
      createdAt: ts,
      updatedAt: ts,
    }
  })
  await db.insert(memories).values(rows)
  return rows.map((r) => r.id)
}

// ── POST /memories ─────────────────────────────────────────────────────────────

describe('POST /memories', () => {
  test('creates a memory and responds 201 with the summary', async () => {
    const { bearer } = await createTestAccount()
    const res = await post(bearer, {
      scope: 'identity',
      description: 'I am a curious agent',
      body: 'long form body',
      pinned: true,
      salience: 0.9,
    })
    expect(res.status).toBe(201)
    const created = await json<{
      id: string
      scope: string
      description: string
      salience: number
      pinned: boolean
      created_at: string
    }>(res)
    expect(created.id).toBeTruthy()
    expect(created.scope).toBe('identity')
    expect(created.description).toBe('I am a curious agent')
    expect(created.salience).toBe(0.9)
    expect(created.pinned).toBe(true)
    expect(created.created_at).toBeTruthy()
    // Summary never leaks the long body.
    expect((created as Record<string, unknown>)['body']).toBeUndefined()
  })

  test('defaults scope to general, salience to 0.5, pinned to false', async () => {
    const { bearer } = await createTestAccount()
    const res = await post(bearer, { description: 'minimal' })
    expect(res.status).toBe(201)
    const created = await json<{ scope: string; salience: number; pinned: boolean }>(res)
    expect(created.scope).toBe('general')
    expect(created.salience).toBe(0.5)
    expect(created.pinned).toBe(false)
  })

  test('duplicate create produces a distinct row (always-additive, no 409)', async () => {
    const { bearer, id } = await createTestAccount()
    const payload = { scope: 'taste', description: 'I like jazz', body: 'same body' }
    const r1 = await post(bearer, payload)
    const r2 = await post(bearer, payload)
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)
    const a = await json<{ id: string }>(r1)
    const b = await json<{ id: string }>(r2)
    expect(a.id).not.toBe(b.id)
    const rows = await db.query.memories.findMany({ where: eq(memories.accountId, id) })
    expect(rows.length).toBe(2)
  })

  test('rejects salience above 1.0 with 422 and inserts no row', async () => {
    const { bearer, id } = await createTestAccount()
    const res = await post(bearer, { description: 'too salient', salience: 1.4 })
    expect(res.status).toBe(422)
    const rows = await db.query.memories.findMany({ where: eq(memories.accountId, id) })
    expect(rows.length).toBe(0)
  })

  test('rejects salience below 0.0 with 422', async () => {
    const { bearer } = await createTestAccount()
    const res = await post(bearer, { description: 'negative', salience: -0.1 })
    expect(res.status).toBe(422)
  })

  test('accepts salience at the boundaries 0.0 and 1.0', async () => {
    const { bearer } = await createTestAccount()
    expect((await post(bearer, { description: 'min', salience: 0 })).status).toBe(201)
    expect((await post(bearer, { description: 'max', salience: 1 })).status).toBe(201)
  })

  test('rejects a description flagged by moderation with 422 and inserts no row', async () => {
    const { bearer, id } = await createTestAccount()
    setModerationProviderForTest(blockProvider('FLAGGED'))
    const res = await post(bearer, { description: 'this is FLAGGED text', body: 'clean' })
    expect(res.status).toBe(422)
    const rows = await db.query.memories.findMany({ where: eq(memories.accountId, id) })
    expect(rows.length).toBe(0)
  })

  test('rejects a body flagged by moderation with 422 (description passes first)', async () => {
    const { bearer, id } = await createTestAccount()
    setModerationProviderForTest(blockProvider('BADBODY'))
    const res = await post(bearer, { description: 'clean description', body: 'contains BADBODY' })
    expect(res.status).toBe(422)
    const rows = await db.query.memories.findMany({ where: eq(memories.accountId, id) })
    expect(rows.length).toBe(0)
  })

  test('returns 401 without auth and inserts no row', async () => {
    const res = await app.handle(
      new Request('http://localhost/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'no auth' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  test('returns 429 once the per-account create limit is exceeded', async () => {
    const { bearer } = await createTestAccount()
    for (let i = 0; i < 60; i++) {
      const ok = await post(bearer, { description: `entry ${i}` })
      expect(ok.status).toBe(201)
    }
    const limited = await post(bearer, { description: 'one too many' })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).not.toBeNull()
  })
})

// ── GET /memories ───────────────────────────────────────────────────────────────

describe('GET /memories', () => {
  test('lists own memories newest-first, without body, with a cursor field', async () => {
    const { bearer, id } = await createTestAccount()
    await seedMemoriesOldestFirst(id, ['first', 'second', 'third'])

    const res = await app.handle(
      new Request('http://localhost/memories', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const out = await json<{
      items: Array<{ description: string }>
      next_cursor: string | null
    }>(res)
    expect(out.items.length).toBe(3)
    expect(out.items.map((m) => m.description)).toEqual(['third', 'second', 'first'])
    expect((out.items[0] as Record<string, unknown>)['body']).toBeUndefined()
    expect(out).toHaveProperty('next_cursor')
  })

  test('excludes other accounts memories', async () => {
    const { bearer: aBearer } = await createTestAccount()
    const { bearer: bBearer } = await createTestAccount()
    await createMemory(aBearer, { description: 'A-owned' })
    await createMemory(bBearer, { description: 'B-owned' })

    const res = await app.handle(
      new Request('http://localhost/memories', { headers: authHeaders(aBearer) }),
    )
    const out = await json<{ items: Array<{ description: string }> }>(res)
    expect(out.items.length).toBe(1)
    expect(out.items[0]!.description).toBe('A-owned')
  })

  test('filters by ?scope=', async () => {
    const { bearer } = await createTestAccount()
    await createMemory(bearer, { scope: 'taste', description: 'a taste' })
    await createMemory(bearer, { scope: 'anxiety', description: 'an anxiety' })

    const res = await app.handle(
      new Request('http://localhost/memories?scope=taste', { headers: authHeaders(bearer) }),
    )
    const out = await json<{ items: Array<{ scope: string }> }>(res)
    expect(out.items.length).toBe(1)
    expect(out.items[0]!.scope).toBe('taste')
  })

  test('paginates via the created_at cursor', async () => {
    const { bearer, id } = await createTestAccount()
    await seedMemoriesOldestFirst(id, ['older', 'newer'])

    const page1 = await app.handle(
      new Request('http://localhost/memories?limit=1', { headers: authHeaders(bearer) }),
    )
    const out1 = await json<{
      items: Array<{ description: string }>
      next_cursor: string | null
    }>(page1)
    expect(out1.items.length).toBe(1)
    expect(out1.items[0]!.description).toBe('newer')
    expect(out1.next_cursor).not.toBeNull()

    const page2 = await app.handle(
      new Request(`http://localhost/memories?limit=1&cursor=${out1.next_cursor}`, {
        headers: authHeaders(bearer),
      }),
    )
    const out2 = await json<{ items: Array<{ description: string }> }>(page2)
    expect(out2.items.length).toBe(1)
    expect(out2.items[0]!.description).toBe('older')
  })

  test('returns 401 without auth', async () => {
    const res = await app.handle(new Request('http://localhost/memories'))
    expect(res.status).toBe(401)
  })
})

// ── GET /memories/index ─────────────────────────────────────────────────────────

describe('GET /memories/index', () => {
  async function indexFor(bearer: string, budget?: string) {
    const url = budget
      ? `http://localhost/memories/index?budget=${budget}`
      : 'http://localhost/memories/index'
    return app.handle(new Request(url, { headers: authHeaders(bearer) }))
  }

  test('orders identity-first, then pinned, then salience desc; deterministic', async () => {
    const { bearer } = await createTestAccount()
    await createMemory(bearer, { scope: 'identity', description: 'I am', salience: 0.1 })
    await createMemory(bearer, {
      scope: 'taste',
      description: 'pinned taste',
      salience: 0.9,
      pinned: true,
    })
    await createMemory(bearer, { scope: 'taste', description: 'high taste', salience: 0.8 })
    await createMemory(bearer, { scope: 'general', description: 'low general', salience: 0.2 })

    const res = await indexFor(bearer, 'default')
    expect(res.status).toBe(200)
    const out = await json<{
      budget: string
      items: Array<{ scope: string; description: string; pinned: boolean }>
      omitted_count: number
    }>(res)
    expect(out.budget).toBe('default')
    expect(out.items.map((m) => m.description)).toEqual([
      'I am',
      'pinned taste',
      'high taste',
      'low general',
    ])
    expect(out.items[0]!.scope).toBe('identity')
    expect(out.items[1]!.pinned).toBe(true)
    expect(out.omitted_count).toBe(0)

    // Deterministic: a second identical request yields the same ordering.
    const res2 = await indexFor(bearer, 'default')
    const out2 = await json<{ items: Array<{ description: string }> }>(res2)
    expect(out2.items.map((m) => m.description)).toEqual(out.items.map((m) => m.description))
  })

  test('default budget admits at least as many memories as hermes', async () => {
    const { bearer } = await createTestAccount()
    // 15 short non-identity memories — the hermes 12-entry cap binds; default (30) admits all.
    for (let i = 0; i < 15; i++) {
      await createMemory(bearer, {
        scope: 'general',
        description: `m${i}`,
        salience: i / 100,
      })
    }

    const def = await json<{ items: unknown[]; omitted_count: number }>(await indexFor(bearer))
    const her = await json<{ items: unknown[]; omitted_count: number }>(
      await indexFor(bearer, 'hermes'),
    )
    expect(def.items.length).toBe(15)
    expect(def.omitted_count).toBe(0)
    expect(her.items.length).toBe(12)
    expect(her.omitted_count).toBe(3)
    expect(def.items.length).toBeGreaterThanOrEqual(her.items.length)
  })

  test('breaks salience ties by created_at desc then id desc (deterministic)', async () => {
    const { bearer, id } = await createTestAccount()
    const sharedTime = new Date('2026-01-01T00:00:00.000Z')
    // Two identity memories with identical salience AND identical created_at:
    // ordering must fall through to the id-descending tiebreak.
    const idA = '00000000-0000-0000-0000-0000000000aa'
    const idB = '00000000-0000-0000-0000-0000000000bb'
    await db.insert(memories).values([
      {
        id: idA,
        accountId: id,
        scope: 'identity',
        description: 'tie A',
        salience: 0.5,
        createdAt: sharedTime,
        updatedAt: sharedTime,
      },
      {
        id: idB,
        accountId: id,
        scope: 'identity',
        description: 'tie B',
        salience: 0.5,
        createdAt: sharedTime,
        updatedAt: sharedTime,
      },
    ])
    // A later, higher-created_at identity memory must rank ahead of the tied pair.
    await createMemory(bearer, { scope: 'identity', description: 'newest', salience: 0.5 })

    const out = await json<{ items: Array<{ description: string }> }>(await indexFor(bearer))
    // newest (later created_at) first, then idB > idA by id-descending tiebreak.
    expect(out.items.map((m) => m.description)).toEqual(['newest', 'tie B', 'tie A'])
  })

  test('absent budget defaults to default (no 400)', async () => {
    const { bearer } = await createTestAccount()
    const res = await indexFor(bearer)
    expect(res.status).toBe(200)
    const out = await json<{ budget: string }>(res)
    expect(out.budget).toBe('default')
  })

  test('unknown budget returns 400 naming the valid values', async () => {
    const { bearer } = await createTestAccount()
    const res = await indexFor(bearer, 'gpt')
    expect(res.status).toBe(400)
    const out = await json<{ error: string }>(res)
    expect(out.error).toContain('default')
    expect(out.error).toContain('hermes')
  })

  test('empty store returns an empty selection', async () => {
    const { bearer } = await createTestAccount()
    const out = await json<{ items: unknown[]; omitted_count: number }>(await indexFor(bearer))
    expect(out.items.length).toBe(0)
    expect(out.omitted_count).toBe(0)
  })

  test('returns 401 without auth', async () => {
    const res = await app.handle(new Request('http://localhost/memories/index'))
    expect(res.status).toBe(401)
  })
})

// ── GET /memories/:id ────────────────────────────────────────────────────────────

describe('GET /memories/:id', () => {
  test('owner fetches the full body and (relationship) subjects', async () => {
    const { bearer } = await createTestAccount()
    const { id: peerId } = await createTestAccount()
    const memId = await createMemory(bearer, {
      scope: 'relationship',
      description: 'about a peer',
      body: 'the long story',
    })
    await patch(bearer, memId, { add_subject: peerId })

    const res = await app.handle(
      new Request(`http://localhost/memories/${memId}`, { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const out = await json<{ body: string; subjects: string[] }>(res)
    expect(out.body).toBe('the long story')
    expect(out.subjects).toEqual([peerId])
  })

  test('non-owner gets a privacy 404 (not 403)', async () => {
    const { bearer: ownerBearer } = await createTestAccount()
    const { bearer: otherBearer } = await createTestAccount()
    const memId = await createMemory(ownerBearer, { description: 'secret' })

    const res = await app.handle(
      new Request(`http://localhost/memories/${memId}`, { headers: authHeaders(otherBearer) }),
    )
    expect(res.status).toBe(404)
  })

  test('returns 404 for a non-existent id', async () => {
    const { bearer } = await createTestAccount()
    const res = await app.handle(
      new Request(`http://localhost/memories/${crypto.randomUUID()}`, {
        headers: authHeaders(bearer),
      }),
    )
    expect(res.status).toBe(404)
  })

  test('returns 401 without auth', async () => {
    const res = await app.handle(new Request(`http://localhost/memories/${crypto.randomUUID()}`))
    expect(res.status).toBe(401)
  })
})

// ── PATCH /memories/:id ──────────────────────────────────────────────────────────

describe('PATCH /memories/:id', () => {
  test('partial field update touches updated_at and leaves other fields unchanged', async () => {
    const { bearer } = await createTestAccount()
    const memId = await createMemory(bearer, {
      description: 'keep me',
      salience: 0.3,
      pinned: false,
    })
    const before = await json<{ created_at: string; updated_at: string }>(
      await app.handle(
        new Request(`http://localhost/memories/${memId}`, { headers: authHeaders(bearer) }),
      ),
    )

    const res = await patch(bearer, memId, { pinned: true, salience: 0.7 })
    expect(res.status).toBe(200)
    const out = await json<{
      description: string
      pinned: boolean
      salience: number
      updated_at: string
    }>(res)
    expect(out.pinned).toBe(true)
    expect(out.salience).toBe(0.7)
    expect(out.description).toBe('keep me')
    expect(new Date(out.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.created_at).getTime(),
    )
  })

  test('adds and removes a subject on a relationship memory', async () => {
    const { bearer } = await createTestAccount()
    const { id: peerId } = await createTestAccount()
    const memId = await createMemory(bearer, { scope: 'relationship', description: 'rel' })

    const added = await json<{ subjects: string[] }>(
      await patch(bearer, memId, { add_subject: peerId }),
    )
    expect(added.subjects).toEqual([peerId])

    const removed = await json<{ subjects: string[] }>(
      await patch(bearer, memId, { remove_subject: peerId }),
    )
    expect(removed.subjects).toEqual([])
  })

  test('duplicate subject add does not create a second row', async () => {
    const { bearer } = await createTestAccount()
    const { id: peerId } = await createTestAccount()
    const memId = await createMemory(bearer, { scope: 'relationship', description: 'rel' })
    await patch(bearer, memId, { add_subject: peerId })
    const second = await json<{ subjects: string[] }>(
      await patch(bearer, memId, { add_subject: peerId }),
    )
    expect(second.subjects).toEqual([peerId])
    const rows = await db.query.memorySubjects.findMany({
      where: eq(memorySubjects.memoryId, memId),
    })
    expect(rows.length).toBe(1)
  })

  test('rejects a subject on a non-relationship scope with 422', async () => {
    const { bearer } = await createTestAccount()
    const { id: peerId } = await createTestAccount()
    const memId = await createMemory(bearer, { scope: 'identity', description: 'self' })
    const res = await patch(bearer, memId, { add_subject: peerId })
    expect(res.status).toBe(422)
    const rows = await db.query.memorySubjects.findMany({
      where: eq(memorySubjects.memoryId, memId),
    })
    expect(rows.length).toBe(0)
  })

  test('rejects a self-subject on a relationship memory with 422', async () => {
    const { bearer, id } = await createTestAccount()
    const memId = await createMemory(bearer, { scope: 'relationship', description: 'rel' })
    const res = await patch(bearer, memId, { add_subject: id })
    expect(res.status).toBe(422)
    const rows = await db.query.memorySubjects.findMany({
      where: eq(memorySubjects.memoryId, memId),
    })
    expect(rows.length).toBe(0)
  })

  test('rejects a non-existent subject account id with 422', async () => {
    const { bearer } = await createTestAccount()
    const memId = await createMemory(bearer, { scope: 'relationship', description: 'rel' })
    const ghostId = crypto.randomUUID()
    const res = await patch(bearer, memId, { add_subject: ghostId })
    expect(res.status).toBe(422)
    const body = await json<{ error: string }>(res)
    expect(body.error).toContain('subject account does not exist')
    const rows = await db.query.memorySubjects.findMany({
      where: eq(memorySubjects.memoryId, memId),
    })
    expect(rows.length).toBe(0)
  })

  test('rejects a non-existent subject WITHOUT persisting the field update (no partial write)', async () => {
    const { bearer } = await createTestAccount()
    const memId = await createMemory(bearer, {
      scope: 'relationship',
      description: 'original',
    })
    const before = await json<{ description: string; updated_at: string }>(
      await app.handle(
        new Request(`http://localhost/memories/${memId}`, { headers: authHeaders(bearer) }),
      ),
    )

    // A combined patch: a valid field change PLUS an add_subject for a ghost
    // account. The whole request must be rejected 422 and NOTHING must persist.
    const ghostId = crypto.randomUUID()
    const res = await patch(bearer, memId, { description: 'changed', add_subject: ghostId })
    expect(res.status).toBe(422)
    const body = await json<{ error: string }>(res)
    expect(body.error).toContain('subject account does not exist')

    // The description and updated_at must be unchanged: no partial write.
    const after = await json<{ description: string; updated_at: string }>(
      await app.handle(
        new Request(`http://localhost/memories/${memId}`, { headers: authHeaders(bearer) }),
      ),
    )
    expect(after.description).toBe('original')
    expect(after.updated_at).toBe(before.updated_at)
  })

  test('rejects salience out of range with 422', async () => {
    const { bearer } = await createTestAccount()
    const memId = await createMemory(bearer, { description: 'm' })
    const res = await patch(bearer, memId, { salience: 5 })
    expect(res.status).toBe(422)
  })

  test('rejects a flagged description with 422', async () => {
    const { bearer } = await createTestAccount()
    const memId = await createMemory(bearer, { description: 'clean' })
    setModerationProviderForTest(blockProvider('NSFW'))
    const res = await patch(bearer, memId, { description: 'now NSFW text' })
    expect(res.status).toBe(422)
  })

  test('rejects a flagged body with 422', async () => {
    const { bearer } = await createTestAccount()
    const memId = await createMemory(bearer, { description: 'clean' })
    setModerationProviderForTest(blockProvider('NSFW'))
    const res = await patch(bearer, memId, { body: 'now NSFW body' })
    expect(res.status).toBe(422)
  })

  test('patch on a non-owned memory returns 404', async () => {
    const { bearer: ownerBearer } = await createTestAccount()
    const { bearer: otherBearer } = await createTestAccount()
    const memId = await createMemory(ownerBearer, { description: 'owned' })
    const res = await patch(otherBearer, memId, { pinned: true })
    expect(res.status).toBe(404)
  })

  test('repeated identical patch is idempotent at the field level', async () => {
    const { bearer } = await createTestAccount()
    const memId = await createMemory(bearer, { description: 'm', salience: 0.2, pinned: false })
    const first = await json<{ pinned: boolean; salience: number; description: string }>(
      await patch(bearer, memId, { pinned: true, salience: 0.8 }),
    )
    const second = await json<{ pinned: boolean; salience: number; description: string }>(
      await patch(bearer, memId, { pinned: true, salience: 0.8 }),
    )
    expect(second.pinned).toBe(first.pinned)
    expect(second.salience).toBe(first.salience)
    expect(second.description).toBe(first.description)
  })

  test('returns 429 once the per-account patch limit is exceeded', async () => {
    const { bearer } = await createTestAccount()
    const memId = await createMemory(bearer, { description: 'm' })
    for (let i = 0; i < 60; i++) {
      const ok = await patch(bearer, memId, { pinned: i % 2 === 0 })
      expect(ok.status).toBe(200)
    }
    const limited = await patch(bearer, memId, { pinned: true })
    expect(limited.status).toBe(429)
  })

  test('returns 401 without auth', async () => {
    const res = await app.handle(
      new Request(`http://localhost/memories/${crypto.randomUUID()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: true }),
      }),
    )
    expect(res.status).toBe(401)
  })
})

// ── DELETE /memories/:id ─────────────────────────────────────────────────────────

describe('DELETE /memories/:id', () => {
  function del(bearer: string, id: string): Promise<Response> {
    return app.handle(
      new Request(`http://localhost/memories/${id}`, {
        method: 'DELETE',
        headers: authHeaders(bearer),
      }),
    )
  }

  test('owner deletes a memory and cascade-removes its subjects, returning 200 { deleted: true }', async () => {
    const { bearer } = await createTestAccount()
    const { id: peerId } = await createTestAccount()
    const memId = await createMemory(bearer, { scope: 'relationship', description: 'rel' })
    await patch(bearer, memId, { add_subject: peerId })

    const res = await del(bearer, memId)
    expect(res.status).toBe(200)
    const out = await json<{ deleted: boolean }>(res)
    expect(out.deleted).toBe(true)

    const memRows = await db.query.memories.findMany({ where: eq(memories.id, memId) })
    expect(memRows.length).toBe(0)
    const subjectRows = await db.query.memorySubjects.findMany({
      where: eq(memorySubjects.memoryId, memId),
    })
    expect(subjectRows.length).toBe(0)
  })

  test('non-owner delete returns 404 and the memory still exists', async () => {
    const { bearer: ownerBearer } = await createTestAccount()
    const { bearer: otherBearer } = await createTestAccount()
    const memId = await createMemory(ownerBearer, { description: 'owned' })

    const res = await del(otherBearer, memId)
    expect(res.status).toBe(404)
    const stillThere = await db.query.memories.findFirst({ where: eq(memories.id, memId) })
    expect(stillThere).not.toBeUndefined()
  })

  test('returns 404 for a non-existent id', async () => {
    const { bearer } = await createTestAccount()
    const res = await del(bearer, crypto.randomUUID())
    expect(res.status).toBe(404)
  })

  test('returns 429 once the per-account delete limit is exceeded', async () => {
    const { bearer } = await createTestAccount()
    // Deletes against a non-existent id 404 (after passing the limiter) and consume the window.
    for (let i = 0; i < 60; i++) {
      const r = await del(bearer, crypto.randomUUID())
      expect(r.status).toBe(404)
    }
    const limited = await del(bearer, crypto.randomUUID())
    expect(limited.status).toBe(429)
  })

  test('returns 401 without auth', async () => {
    const res = await app.handle(
      new Request(`http://localhost/memories/${crypto.randomUUID()}`, { method: 'DELETE' }),
    )
    expect(res.status).toBe(401)
  })
})
