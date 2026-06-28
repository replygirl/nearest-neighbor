// Deck ordering and pagination tests covering the last_active_at sort.
// Tasks 4.3 (ordering, filters) and 4.4 (pagination correctness).
// Uses PGlite via test/setup.ts.

import { beforeEach, describe, expect, test } from 'bun:test'

import { accounts, db, datingProfiles, swipes } from '@nearest-neighbor/db'
import { eq, sql } from 'drizzle-orm'
import { Elysia } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import { encodeCursor } from '../../lib/pagination.ts'
import '../../test/setup.ts'
import { authHeaders, createTestAccount } from '../../test/helpers.ts'
import { datingModule } from './index.ts'

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

const app = new Elysia().use(authMacro).use(datingModule)

// Truncate all app tables before each test so tests are fully isolated.
// setup.ts does this once in beforeAll but tests within the file accumulate data.
beforeEach(async () => {
  await db.execute(sql`
    TRUNCATE TABLE
      account_secrets,
      notifications,
      messages,
      conversations,
      swipes,
      matches,
      follows,
      posts,
      relationships,
      dating_photos,
      dating_profiles,
      social_profiles,
      accounts
    RESTART IDENTITY CASCADE
  `)
})

// Set last_active_at on an account row (must match mode:'string' → YYYY-MM-DD).
async function setLastActive(accountId: string, date: string | null): Promise<void> {
  await db.update(accounts).set({ lastActiveAt: date }).where(eq(accounts.id, accountId))
}

// Set created_at on a dating profile for tie-break ordering tests.
async function setProfileCreatedAt(accountId: string, date: Date): Promise<void> {
  await db
    .update(datingProfiles)
    .set({ createdAt: date })
    .where(eq(datingProfiles.accountId, accountId))
}

// ── 4.3: Deck ordering ────────────────────────────────────────────────────────

describe('GET /dating/deck — ordering by last_active_at', () => {
  test('profiles with last_active_at sort before profiles without (NULLS LAST)', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Viewer', isVisible: true },
    })
    const { id: activeId } = await createTestAccount({
      datingProfile: { firstName: 'Active', isVisible: true },
    })
    const { id: nullId } = await createTestAccount({
      datingProfile: { firstName: 'Inactive', isVisible: true },
    })

    await setLastActive(activeId, '2024-06-15')
    // nullId has lastActiveAt = null by default

    const res = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: Array<{ account_id: string }> }>(res)
    const ids = body.items.map((p) => p.account_id)

    const activeIdx = ids.indexOf(activeId)
    const nullIdx = ids.indexOf(nullId)
    expect(activeIdx).not.toBe(-1)
    expect(nullIdx).not.toBe(-1)
    // Dated profile must appear before the null-activity profile
    expect(activeIdx).toBeLessThan(nullIdx)
  })

  test('among dated profiles, more recent last_active_at comes first', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Viewer', isVisible: true },
    })
    const { id: recentId } = await createTestAccount({
      datingProfile: { firstName: 'Recent', isVisible: true },
    })
    const { id: olderActivityId } = await createTestAccount({
      datingProfile: { firstName: 'Older', isVisible: true },
    })

    await setLastActive(recentId, '2024-06-15')
    await setLastActive(olderActivityId, '2024-06-14')

    const res = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    const body = await json<{ items: Array<{ account_id: string }> }>(res)
    const ids = body.items.map((p) => p.account_id)

    expect(ids.indexOf(recentId)).toBeLessThan(ids.indexOf(olderActivityId))
  })

  test('same last_active_at ties fall back to created_at DESC', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Viewer', isVisible: true },
    })
    const { id: earlierCreatedId } = await createTestAccount({
      datingProfile: { firstName: 'EarlyProfile', isVisible: true },
    })
    const { id: laterCreatedId } = await createTestAccount({
      datingProfile: { firstName: 'LateProfile', isVisible: true },
    })

    const sameDay = '2024-06-15'
    await setLastActive(earlierCreatedId, sameDay)
    await setLastActive(laterCreatedId, sameDay)

    // Set distinct created_at values for deterministic ordering
    await setProfileCreatedAt(earlierCreatedId, new Date('2024-01-01T00:00:00.000Z'))
    await setProfileCreatedAt(laterCreatedId, new Date('2024-01-02T00:00:00.000Z'))

    const res = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    const body = await json<{ items: Array<{ account_id: string }> }>(res)
    const ids = body.items.map((p) => p.account_id)

    // laterCreated (2024-01-02) should appear before earlierCreated (2024-01-01) — DESC
    expect(ids.indexOf(laterCreatedId)).toBeLessThan(ids.indexOf(earlierCreatedId))
  })

  test('same last_active_at and created_at ties fall back to account_id DESC', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Viewer', isVisible: true },
    })
    const { id: idA } = await createTestAccount({
      datingProfile: { firstName: 'AccountA', isVisible: true },
    })
    const { id: idB } = await createTestAccount({
      datingProfile: { firstName: 'AccountB', isVisible: true },
    })

    const sameDay = '2024-06-15'
    const sameTime = new Date('2024-01-01T00:00:00.000Z')
    await setLastActive(idA, sameDay)
    await setLastActive(idB, sameDay)
    await setProfileCreatedAt(idA, sameTime)
    await setProfileCreatedAt(idB, sameTime)

    const res = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    const body = await json<{ items: Array<{ account_id: string }> }>(res)
    const ids = body.items.map((p) => p.account_id)

    const idxA = ids.indexOf(idA)
    const idxB = ids.indexOf(idB)
    expect(idxA).not.toBe(-1)
    expect(idxB).not.toBe(-1)

    // Larger UUID comes first (DESC). UUID comparison is lexicographic in PG.
    const expectedFirst = idA > idB ? idA : idB
    const expectedSecond = idA > idB ? idB : idA
    expect(ids.indexOf(expectedFirst)).toBeLessThan(ids.indexOf(expectedSecond))
  })

  test('deterministic: same deck order on repeated requests', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Viewer', isVisible: true },
    })
    const { id: id1 } = await createTestAccount({
      datingProfile: { firstName: 'P1', isVisible: true },
    })
    const { id: id2 } = await createTestAccount({
      datingProfile: { firstName: 'P2', isVisible: true },
    })
    await createTestAccount({ datingProfile: { firstName: 'P3', isVisible: true } })

    await setLastActive(id1, '2024-06-15')
    await setLastActive(id2, '2024-06-14')
    // P3 stays null — adds a null-tail entry to confirm stable ordering

    const res1 = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    const res2 = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    const b1 = await json<{ items: Array<{ account_id: string }> }>(res1)
    const b2 = await json<{ items: Array<{ account_id: string }> }>(res2)

    expect(b1.items.map((p) => p.account_id)).toEqual(b2.items.map((p) => p.account_id))
  })

  test('filters still exclude self', async () => {
    const { bearer, id } = await createTestAccount({
      datingProfile: { firstName: 'Me', isVisible: true },
    })
    await setLastActive(id, '2024-06-15')

    const res = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    const body = await json<{ items: Array<{ account_id: string }> }>(res)
    expect(body.items.map((p) => p.account_id)).not.toContain(id)
  })

  test('filters still exclude already-swiped profiles', async () => {
    const { bearer, id } = await createTestAccount({
      datingProfile: { firstName: 'Me', isVisible: true },
    })
    const { id: swipedId } = await createTestAccount({
      datingProfile: { firstName: 'Swiped', isVisible: true },
    })

    await setLastActive(swipedId, '2024-06-15')
    await db
      .insert(swipes)
      .values({ id: crypto.randomUUID(), swiperId: id, targetId: swipedId, direction: 'no' })

    const res = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    const body = await json<{ items: Array<{ account_id: string }> }>(res)
    expect(body.items.map((p) => p.account_id)).not.toContain(swipedId)
  })

  test('filters still exclude invisible profiles', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Me', isVisible: true },
    })
    const { id: hiddenId } = await createTestAccount({
      datingProfile: { firstName: 'Hidden', isVisible: false },
    })

    await setLastActive(hiddenId, '2024-06-15')

    const res = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    const body = await json<{ items: Array<{ account_id: string }> }>(res)
    expect(body.items.map((p) => p.account_id)).not.toContain(hiddenId)
  })
})

// ── 4.4: Deck pagination ──────────────────────────────────────────────────────

describe('GET /dating/deck — keyset pagination', () => {
  test('full page within dated rows: no overlap, no gap', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Viewer', isVisible: true },
    })

    // Create 25 profiles all with the same last_active_at (tests pagination within dated group)
    const profileIds: string[] = []
    for (let i = 0; i < 25; i++) {
      const { id } = await createTestAccount({
        datingProfile: { firstName: `DatedP${i}`, isVisible: true },
      })
      await setLastActive(id, '2024-06-15')
      profileIds.push(id)
    }

    // Page 1
    const res1 = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    expect(res1.status).toBe(200)
    const b1 = await json<{ items: Array<{ account_id: string }>; next_cursor: string | null }>(
      res1,
    )
    expect(b1.items.length).toBe(20)
    expect(b1.next_cursor).not.toBeNull()

    const page1Ids = b1.items.map((p) => p.account_id)

    // Page 2
    const res2 = await app.handle(
      new Request(`http://localhost/dating/deck?cursor=${b1.next_cursor}`, {
        headers: authHeaders(bearer),
      }),
    )
    expect(res2.status).toBe(200)
    const b2 = await json<{ items: Array<{ account_id: string }>; next_cursor: string | null }>(
      res2,
    )
    expect(b2.items.length).toBe(5)
    expect(b2.next_cursor).toBeNull()

    const page2Ids = b2.items.map((p) => p.account_id)

    // No overlap
    const overlap = page1Ids.filter((id) => page2Ids.includes(id))
    expect(overlap).toHaveLength(0)

    // Full coverage — all 25 profiles appear across both pages
    const allIds = [...page1Ids, ...page2Ids]
    for (const id of profileIds) {
      expect(allIds).toContain(id)
    }
  })

  test('NULLS LAST transition: dated rows then null rows, no overlap/gap', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Viewer', isVisible: true },
    })

    const datedIds: string[] = []
    const nullIds: string[] = []

    // 12 profiles with a date
    for (let i = 0; i < 12; i++) {
      const { id } = await createTestAccount({
        datingProfile: { firstName: `Dated${i}`, isVisible: true },
      })
      await setLastActive(id, '2024-06-15')
      datedIds.push(id)
    }

    // 12 profiles with null
    for (let i = 0; i < 12; i++) {
      const { id } = await createTestAccount({
        datingProfile: { firstName: `Null${i}`, isVisible: true },
      })
      nullIds.push(id)
    }

    const total = [...datedIds, ...nullIds]

    // Page 1: 20 items (all 12 dated + 8 null)
    const res1 = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    const b1 = await json<{ items: Array<{ account_id: string }>; next_cursor: string | null }>(
      res1,
    )
    expect(b1.items.length).toBe(20)
    expect(b1.next_cursor).not.toBeNull()

    const page1Ids = b1.items.map((p) => p.account_id)

    // All dated profiles must appear on page 1 (they sort first)
    for (const id of datedIds) {
      expect(page1Ids).toContain(id)
    }

    // Page 1's last item is in the null group (cursor.lastActiveAt = null)
    // Verify by checking that the cursor carries null lastActiveAt implicitly
    // (tested via the next page behavior)

    // Page 2: remaining 4 null items
    const res2 = await app.handle(
      new Request(`http://localhost/dating/deck?cursor=${b1.next_cursor}`, {
        headers: authHeaders(bearer),
      }),
    )
    const b2 = await json<{ items: Array<{ account_id: string }>; next_cursor: string | null }>(
      res2,
    )
    expect(b2.items.length).toBe(4)
    expect(b2.next_cursor).toBeNull()

    const page2Ids = b2.items.map((p) => p.account_id)

    // No overlap between pages
    expect(page1Ids.filter((id) => page2Ids.includes(id))).toHaveLength(0)

    // Full coverage
    const allIds = [...page1Ids, ...page2Ids]
    for (const id of total) {
      expect(allIds).toContain(id)
    }

    // All page 2 items are from the null group
    for (const id of page2Ids) {
      expect(nullIds).toContain(id)
    }
  })

  test('pagination within the null tail: no overlap/gap', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Viewer', isVisible: true },
    })

    const nullIds: string[] = []
    for (let i = 0; i < 25; i++) {
      const { id } = await createTestAccount({
        datingProfile: { firstName: `NullP${i}`, isVisible: true },
      })
      nullIds.push(id)
    }

    // Page 1 (all null tail)
    const res1 = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    const b1 = await json<{ items: Array<{ account_id: string }>; next_cursor: string | null }>(
      res1,
    )
    expect(b1.items.length).toBe(20)
    expect(b1.next_cursor).not.toBeNull()

    const page1Ids = b1.items.map((p) => p.account_id)

    // Page 2
    const res2 = await app.handle(
      new Request(`http://localhost/dating/deck?cursor=${b1.next_cursor}`, {
        headers: authHeaders(bearer),
      }),
    )
    const b2 = await json<{ items: Array<{ account_id: string }>; next_cursor: string | null }>(
      res2,
    )
    expect(b2.items.length).toBe(5)
    expect(b2.next_cursor).toBeNull()

    const page2Ids = b2.items.map((p) => p.account_id)

    expect(page1Ids.filter((id) => page2Ids.includes(id))).toHaveLength(0)

    const allIds = [...page1Ids, ...page2Ids]
    for (const id of nullIds) {
      expect(allIds).toContain(id)
    }
  })

  test('final page returns next_cursor: null', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Viewer', isVisible: true },
    })

    // Only 3 profiles — fits on one page
    for (let i = 0; i < 3; i++) {
      await createTestAccount({ datingProfile: { firstName: `Small${i}`, isVisible: true } })
    }

    const res = await app.handle(
      new Request('http://localhost/dating/deck', { headers: authHeaders(bearer) }),
    )
    const body = await json<{ items: unknown[]; next_cursor: string | null }>(res)
    expect(body.items.length).toBe(3)
    expect(body.next_cursor).toBeNull()
  })

  test('legacy 2-tuple cursor (missing lastActiveAt key) restarts at top', async () => {
    const { bearer } = await createTestAccount({
      datingProfile: { firstName: 'Viewer', isVisible: true },
    })

    const allIds: string[] = []
    for (let i = 0; i < 5; i++) {
      const { id } = await createTestAccount({
        datingProfile: { firstName: `Legacy${i}`, isVisible: true },
      })
      allIds.push(id)
    }

    // Encode a legacy 2-tuple cursor (old format — lacks lastActiveAt key)
    const legacyCursor = encodeCursor(new Date(), 'some-uuid')

    const res = await app.handle(
      new Request(`http://localhost/dating/deck?cursor=${legacyCursor}`, {
        headers: authHeaders(bearer),
      }),
    )
    expect(res.status).toBe(200)
    const body = await json<{ items: Array<{ account_id: string }>; next_cursor: string | null }>(
      res,
    )

    // Legacy cursor is rejected → treated as no cursor → returns from top
    const returnedIds = body.items.map((p) => p.account_id)
    for (const id of allIds) {
      expect(returnedIds).toContain(id)
    }
  })
})
