// moderationMacro + route integration tests across all five moderated write
// surfaces, exercising the real macro -> policy -> audit -> runbook pipeline
// against the real PGlite DB. Only the OpenAI HTTP boundary is faked, via the
// `setModerationProviderForTest` seam, so block / allow / outage verdicts are
// deterministic. Asserts: block returns the full 422 ModerationError body and
// persists nothing; allow persists and audits `allow`; an outage fails open,
// persists, and audits `unavailable`; empty moderable text skips the provider;
// an unauthenticated request is rejected at the auth layer before moderation.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  datingPhotos,
  datingProfiles,
  db,
  messages,
  moderationVerdicts,
  posts,
  socialProfiles,
} from '@nearest-neighbor/db'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'

import { authMacro } from '../auth/macro.ts'
import { getOrCreateConversation, unlockSocial } from '../lib/conversations.ts'
import { datingModule } from '../modules/dating/index.ts'
import { messagingModule } from '../modules/messaging/index.ts'
import { socialModule } from '../modules/social/index.ts'
import '../test/setup.ts'
import { authHeaders, createTestAccount } from '../test/helpers.ts'
import { ModerationUnavailable } from './client.ts'
import type { ModerationResult } from './client.ts'
import { setCsamRunbookDepsForTest, setModerationProviderForTest } from './macro.ts'
import { CSAM_MIN_RETENTION_DAYS } from './preserve.ts'
import type { CsamPreservationRecord, OperatorAlertNotice } from './preserve.ts'

const datingApp = new Elysia().use(authMacro).use(datingModule)
const socialApp = new Elysia().use(authMacro).use(socialModule)
const messagingApp = new Elysia().use(authMacro).use(messagingModule)

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

interface ModerationErrorBody {
  error: string
  code: string
  category: string
  message: string
  retryable: boolean
  guidance: string
}

// Install a deterministic provider double and track its invocations.
function spyProvider(impl: (text: string) => Promise<ModerationResult>) {
  const state = { calls: 0, texts: [] as string[] }
  setModerationProviderForTest(async (text: string) => {
    state.calls += 1
    state.texts.push(text)
    return impl(text)
  })
  return state
}

function blockResult(category: string, score = 0.95): ModerationResult {
  return {
    model: 'test-omni',
    flagged: true,
    categories: { [category]: true },
    scores: { [category]: score },
    appliedTypes: { [category]: ['text'] },
  }
}

function allowResult(): ModerationResult {
  return {
    model: 'test-omni',
    flagged: false,
    categories: { harassment: false },
    scores: { harassment: 0.01 },
    appliedTypes: { harassment: ['text'] },
  }
}

const blockProvider = (category = 'harassment') =>
  spyProvider(() => Promise.resolve(blockResult(category)))
const allowProvider = () => spyProvider(() => Promise.resolve(allowResult()))
const outageProvider = () =>
  spyProvider(() => Promise.reject(new ModerationUnavailable('test outage')))
const forbiddenProvider = () =>
  spyProvider(() => Promise.reject(new Error('provider must not be called')))

function verdictsFor(accountId: string) {
  return db.select().from(moderationVerdicts).where(eq(moderationVerdicts.accountId, accountId))
}

async function setupConversation() {
  const alice = await createTestAccount({
    socialProfile: { handle: `a_${crypto.randomUUID().slice(0, 8)}` },
  })
  const bob = await createTestAccount({
    socialProfile: { handle: `b_${crypto.randomUUID().slice(0, 8)}` },
  })
  const conv = await getOrCreateConversation(alice.id, bob.id)
  await unlockSocial(alice.id, bob.id)
  return { alice, bob, convId: conv.id }
}

function uniqueHandle() {
  return `u_${crypto.randomUUID().slice(0, 8)}`
}

afterEach(() => {
  setModerationProviderForTest(null)
  setCsamRunbookDepsForTest(null)
})

// ── Block returns the full 422 contract and persists nothing ──────────────────

function assertBlockBody(body: ModerationErrorBody, category: string) {
  expect(body.code).toBe('content_blocked')
  expect(body.category).toBe(category)
  expect(body.retryable).toBe(true)
  expect(typeof body.error).toBe('string')
  expect(typeof body.message).toBe('string')
  expect(typeof body.guidance).toBe('string')
  // No score, confidence, or threshold leaks — exactly the six contract fields.
  expect(Object.keys(body as unknown as Record<string, unknown>).toSorted()).toEqual([
    'category',
    'code',
    'error',
    'guidance',
    'message',
    'retryable',
  ])
}

describe('moderationMacro — block returns full 422 and persists nothing', () => {
  test('dating bio (PUT /dating/profile)', async () => {
    blockProvider()
    const { bearer, id } = await createTestAccount()
    const res = await datingApp.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: 'Bob', bio: 'mean words' }),
      }),
    )
    expect(res.status).toBe(422)
    assertBlockBody(await json<ModerationErrorBody>(res), 'harassment')
    const rows = await db.select().from(datingProfiles).where(eq(datingProfiles.accountId, id))
    expect(rows.length).toBe(0)
    expect((await verdictsFor(id)).some((r) => r.decision === 'block')).toBe(true)
  })

  test('dating photo (PUT /dating/photos)', async () => {
    blockProvider()
    const { bearer, id } = await createTestAccount()
    const res = await datingApp.handle(
      new Request('http://localhost/dating/photos', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ idx: 0, art: 'rude\nart' }),
      }),
    )
    expect(res.status).toBe(422)
    assertBlockBody(await json<ModerationErrorBody>(res), 'harassment')
    const rows = await db.select().from(datingPhotos).where(eq(datingPhotos.accountId, id))
    expect(rows.length).toBe(0)
  })

  test('social profile (PUT /social/profile)', async () => {
    blockProvider()
    const { bearer, id } = await createTestAccount()
    const res = await socialApp.handle(
      new Request('http://localhost/social/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: uniqueHandle(), bio: 'nasty bio' }),
      }),
    )
    expect(res.status).toBe(422)
    assertBlockBody(await json<ModerationErrorBody>(res), 'harassment')
    const rows = await db.select().from(socialProfiles).where(eq(socialProfiles.accountId, id))
    expect(rows.length).toBe(0)
  })

  test('post (POST /social/posts)', async () => {
    blockProvider()
    const { bearer, id } = await createTestAccount({ socialProfile: { handle: uniqueHandle() } })
    const res = await socialApp.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'mean post' }),
      }),
    )
    expect(res.status).toBe(422)
    assertBlockBody(await json<ModerationErrorBody>(res), 'harassment')
    const rows = await db.select().from(posts).where(eq(posts.authorId, id))
    expect(rows.length).toBe(0)
  })

  test('message (POST /conversations/:id/messages)', async () => {
    blockProvider()
    const { alice, convId } = await setupConversation()
    const res = await messagingApp.handle(
      new Request(`http://localhost/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'mean message' }),
      }),
    )
    expect(res.status).toBe(422)
    assertBlockBody(await json<ModerationErrorBody>(res), 'harassment')
    const rows = await db.select().from(messages).where(eq(messages.conversationId, convId))
    expect(rows.length).toBe(0)
    expect((await verdictsFor(alice.id)).some((r) => r.decision === 'block')).toBe(true)
  })
})

// ── Sexual/minors block surfaces sexual_minors and audits metadata only ───────

describe('moderationMacro — sexual/minors block', () => {
  test('returns category sexual_minors and stores a metadata-only audit row', async () => {
    blockProvider('sexual/minors')
    const { bearer, id } = await createTestAccount()
    const res = await datingApp.handle(
      new Request('http://localhost/dating/photos', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ idx: 0, art: 'offending' }),
      }),
    )
    expect(res.status).toBe(422)
    const body = await json<ModerationErrorBody>(res)
    expect(body.category).toBe('sexual_minors')

    // No photo persisted.
    expect(
      (await db.select().from(datingPhotos).where(eq(datingPhotos.accountId, id))).length,
    ).toBe(0)

    // Audit row: block + metadata only (scores/categories null, top_category kept).
    const row = (await verdictsFor(id)).find((r) => r.decision === 'block')
    expect(row).toBeDefined()
    expect(row!.topCategory).toBe('sexual/minors')
    expect(row!.flagged).toBe(true)
    expect(row!.model).toBe('test-omni')
    expect(row!.scores).toBeNull()
    expect(row!.categories).toBeNull()
    expect(row!.appliedInputTypes).toBeNull()
  })
})

// ── Sexual/minors block drives the CSAM runbook end-to-end ────────────────────
// These close the gap between preserve.test.ts (runCsamRunbook in isolation) and
// the real block path: they prove the macro actually invokes the runbook with the
// submitted text as the payload, and that a flag-on-but-unprovisioned store fails
// the request loudly instead of silently persisting or dropping the runbook.

describe('moderationMacro — sexual/minors block runs the CSAM runbook', () => {
  const SENTINEL = 'OFFENDING_ASCII_SENTINEL_DO_NOT_LEAK'

  test('flag ON: invokes the runbook with payload = submitted art and a metadata-only alert', async () => {
    blockProvider('sexual/minors')
    const preserved: CsamPreservationRecord[] = []
    const alerts: OperatorAlertNotice[] = []
    setCsamRunbookDepsForTest({
      enabled: true,
      store: {
        preserve: async (record: CsamPreservationRecord) => {
          preserved.push(record)
        },
      },
      alerter: {
        alert: async (notice: OperatorAlertNotice) => {
          alerts.push(notice)
        },
      },
    })

    const { bearer, id } = await createTestAccount()
    const res = await datingApp.handle(
      new Request('http://localhost/dating/photos', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ idx: 0, art: SENTINEL }),
      }),
    )
    expect(res.status).toBe(422)
    expect((await json<ModerationErrorBody>(res)).category).toBe('sexual_minors')

    // The macro passed the EXACT submitted moderated text as the preservation
    // payload, with a >= 1-year retention intent.
    expect(preserved.length).toBe(1)
    const record = preserved[0]!
    expect(record.payload).toBe(SENTINEL)
    expect(record.surface).toBe('dating_photo')
    expect(record.accountId).toBe(id)
    expect(record.retentionDays).toBeGreaterThanOrEqual(365)
    expect(record.retentionDays).toBe(CSAM_MIN_RETENTION_DAYS)

    // The operator alert is metadata-only — the offending payload must not leak.
    expect(alerts.length).toBe(1)
    const notice = alerts[0]!
    expect(notice.category).toBe('sexual_minors')
    expect(notice.surface).toBe('dating_photo')
    expect(notice.accountId).toBe(id)
    expect(notice.model).toBe('test-omni')
    expect(JSON.stringify(notice)).not.toContain(SENTINEL)
    expect(Object.keys(notice)).not.toContain('payload')

    // Block-at-input still holds: nothing written to the content table.
    expect(
      (await db.select().from(datingPhotos).where(eq(datingPhotos.accountId, id))).length,
    ).toBe(0)
  })

  test('flag ON, no store wired: the route fails loudly (500) and writes no content row', async () => {
    blockProvider('sexual/minors')
    setCsamRunbookDepsForTest({ enabled: true })

    const { bearer, id } = await createTestAccount()
    const res = await datingApp.handle(
      new Request('http://localhost/dating/photos', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ idx: 0, art: SENTINEL }),
      }),
    )
    // The runbook throws "preservation store not provisioned"; it is NOT the
    // outage path, so it propagates to onError as a 500 rather than being
    // swallowed into a silent allow.
    expect(res.status).toBe(500)

    // Block-at-input holds even though the runbook threw: no photo persisted.
    expect(
      (await db.select().from(datingPhotos).where(eq(datingPhotos.accountId, id))).length,
    ).toBe(0)
  })
})

// ── Allow persists normally and audits `allow` ────────────────────────────────

describe('moderationMacro — allow persists and audits', () => {
  test('dating bio', async () => {
    allowProvider()
    const { bearer, id } = await createTestAccount()
    const res = await datingApp.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: 'Nice', bio: 'friendly bio' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(
      (await db.select().from(datingProfiles).where(eq(datingProfiles.accountId, id))).length,
    ).toBe(1)
    const row = (await verdictsFor(id)).find((r) => r.decision === 'allow')
    expect(row).toBeDefined()
    expect(row!.model).toBe('test-omni')
    expect(row!.scores).toEqual({ harassment: 0.01 })
  })

  test('dating photo', async () => {
    allowProvider()
    const { bearer, id } = await createTestAccount()
    const res = await datingApp.handle(
      new Request('http://localhost/dating/photos', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ idx: 0, art: 'cute\nart' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(
      (await db.select().from(datingPhotos).where(eq(datingPhotos.accountId, id))).length,
    ).toBe(1)
    expect((await verdictsFor(id)).some((r) => r.decision === 'allow')).toBe(true)
  })

  test('social profile', async () => {
    allowProvider()
    const { bearer, id } = await createTestAccount()
    const res = await socialApp.handle(
      new Request('http://localhost/social/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: uniqueHandle(), bio: 'friendly bio' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(
      (await db.select().from(socialProfiles).where(eq(socialProfiles.accountId, id))).length,
    ).toBe(1)
    expect((await verdictsFor(id)).some((r) => r.decision === 'allow')).toBe(true)
  })

  test('post', async () => {
    allowProvider()
    const { bearer, id } = await createTestAccount({ socialProfile: { handle: uniqueHandle() } })
    const res = await socialApp.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'a kind hello' }),
      }),
    )
    expect(res.status).toBe(201)
    expect((await db.select().from(posts).where(eq(posts.authorId, id))).length).toBe(1)
    expect((await verdictsFor(id)).some((r) => r.decision === 'allow')).toBe(true)
  })

  test('message', async () => {
    allowProvider()
    const { alice, convId } = await setupConversation()
    const res = await messagingApp.handle(
      new Request(`http://localhost/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'hey there' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(
      (await db.select().from(messages).where(eq(messages.conversationId, convId))).length,
    ).toBe(1)
    expect((await verdictsFor(alice.id)).some((r) => r.decision === 'allow')).toBe(true)
  })
})

// ── Outage fails open: persists + audits `unavailable` ────────────────────────

describe('moderationMacro — outage fails open', () => {
  test('post persists and audits unavailable with model=null', async () => {
    outageProvider()
    const { bearer, id } = await createTestAccount({ socialProfile: { handle: uniqueHandle() } })
    const res = await socialApp.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'anything during an outage' }),
      }),
    )
    expect(res.status).toBe(201)
    expect((await db.select().from(posts).where(eq(posts.authorId, id))).length).toBe(1)
    const row = (await verdictsFor(id)).find((r) => r.decision === 'unavailable')
    expect(row).toBeDefined()
    expect(row!.model).toBeNull()
    expect(row!.scores).toBeNull()
  })

  test('dating bio persists and audits unavailable', async () => {
    outageProvider()
    const { bearer, id } = await createTestAccount()
    const res = await datingApp.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: 'Outage', bio: 'still saved' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(
      (await db.select().from(datingProfiles).where(eq(datingProfiles.accountId, id))).length,
    ).toBe(1)
    expect((await verdictsFor(id)).some((r) => r.decision === 'unavailable')).toBe(true)
  })

  test('message persists and audits unavailable', async () => {
    outageProvider()
    const { alice, convId } = await setupConversation()
    const res = await messagingApp.handle(
      new Request(`http://localhost/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { ...authHeaders(alice.bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'sent during an outage' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(
      (await db.select().from(messages).where(eq(messages.conversationId, convId))).length,
    ).toBe(1)
    expect((await verdictsFor(alice.id)).some((r) => r.decision === 'unavailable')).toBe(true)
  })
})

// ── Empty moderable text skips the provider entirely ──────────────────────────

describe('moderationMacro — empty moderable text skips the provider', () => {
  test('dating profile changing only is_visible does not call the provider', async () => {
    const spy = forbiddenProvider()
    const { bearer, id } = await createTestAccount({ datingProfile: { firstName: 'Existing' } })
    const res = await datingApp.handle(
      new Request('http://localhost/dating/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_visible: false }),
      }),
    )
    expect(res.status).toBe(200)
    expect(spy.calls).toBe(0)
    expect((await verdictsFor(id)).length).toBe(0)
  })

  test('social profile with only a handle does not call the provider', async () => {
    const spy = forbiddenProvider()
    const { bearer, id } = await createTestAccount()
    const res = await socialApp.handle(
      new Request('http://localhost/social/profile', {
        method: 'PUT',
        headers: { ...authHeaders(bearer), 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: uniqueHandle() }),
      }),
    )
    expect(res.status).toBe(200)
    expect(spy.calls).toBe(0)
    expect((await verdictsFor(id)).length).toBe(0)
  })
})

// ── Unauthenticated requests never reach moderation ───────────────────────────

describe('moderationMacro — unauthenticated request rejected before moderation', () => {
  test('post without auth returns 401 and never calls the provider', async () => {
    const spy = forbiddenProvider()
    const res = await socialApp.handle(
      new Request('http://localhost/social/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'unauth post' }),
      }),
    )
    expect(res.status).toBe(401)
    expect(spy.calls).toBe(0)
  })

  test('message without auth returns 401 and never calls the provider', async () => {
    const spy = forbiddenProvider()
    const res = await messagingApp.handle(
      new Request(`http://localhost/conversations/${crypto.randomUUID()}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'unauth message' }),
      }),
    )
    expect(res.status).toBe(401)
    expect(spy.calls).toBe(0)
  })
})
