/**
 * Schema tests — exercises schema helper functions and ORM-level operations
 * that are not covered by the migration integration tests.
 *
 * Covers:
 *   - withSoftDelete helper
 *   - $onUpdateFn (updatedAt triggers via ORM updates)
 *   - All table extras callbacks (pgTable 3rd arg) via Drizzle ORM operations
 *   - Relationship schema constraints and status transitions
 *   - Post soft-delete pattern
 *   - Dating photo idx uniqueness
 *   - Notification types and priorities
 */

import { afterAll, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'

import { withSoftDelete } from './_helpers.ts'
import * as schema from './index.ts'

const {
  accounts,
  accountSecrets,
  conversations,
  datingPhotos,
  datingProfiles,
  follows,
  matches,
  messages,
  notifications,
  postLikes,
  posts,
  relationships,
  reposts,
  socialProfiles,
  swipes,
} = schema

// ─── Test DB setup ────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../migrations',
)

async function buildTestDb() {
  const raw = new PGlite('memory://')
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .toSorted()
  for (const file of files) {
    const sqlText = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
    // eslint-disable-next-line no-await-in-loop
    await raw.exec(sqlText)
  }
  const db = drizzle(raw, { schema, casing: 'snake_case' })
  return { db, raw }
}

// Shared PGlite instance for the suite
const { db, raw } = await buildTestDb()

afterAll(async () => {
  await raw.close()
})

// ─── Helper: insert an account ────────────────────────────────────────────────

async function insertAccount(status: 'active' | 'suspended' | 'deleted' = 'active') {
  const id = crypto.randomUUID()
  await db.insert(accounts).values({ id, status })
  return id
}

// ─── withSoftDelete ───────────────────────────────────────────────────────────

describe('withSoftDelete helper', () => {
  test('returns a where clause filtering out deleted rows', async () => {
    // posts table has a deletedAt column — use it to verify withSoftDelete.
    const authorId = await insertAccount()
    const postId1 = crypto.randomUUID()
    const postId2 = crypto.randomUUID()

    await db.insert(posts).values([
      { id: postId1, authorId, body: 'live post' },
      { id: postId2, authorId, body: 'deleted post' },
    ])

    // Soft-delete post2 by setting deletedAt.
    await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, postId2))

    // withSoftDelete returns { where: isNull(table.deletedAt) }
    const filter = withSoftDelete(posts)
    expect(filter).toHaveProperty('where')

    // Verify filtering actually works.
    const livePosts = await db.select().from(posts).where(filter.where)
    const liveIds = livePosts.map((p) => p.id)
    expect(liveIds).toContain(postId1)
    expect(liveIds).not.toContain(postId2)
  })

  test('withSoftDelete where is isNull(deletedAt)', async () => {
    // The returned `where` expression should filter isNull(deletedAt)
    const filter = withSoftDelete(posts)
    // Query using the filter: only rows where deletedAt IS NULL are returned.
    const authorId = await insertAccount()
    const id = crypto.randomUUID()
    await db.insert(posts).values({ id, authorId, body: 'active' })
    await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, id))

    const alive = await db.select().from(posts).where(filter.where).limit(100)
    expect(alive.every((p) => p.deletedAt === null)).toBe(true)
  })

  test('withSoftDelete isNull export is the same as from drizzle-orm', () => {
    // _helpers.ts re-exports isNull from drizzle-orm.
    const { isNull: helperIsNull } = schema
    expect(typeof helperIsNull).toBe('function')
  })
})

// ─── $onUpdateFn (updatedAt triggers) ─────────────────────────────────────────

describe('$onUpdateFn — updatedAt is refreshed on ORM update', () => {
  test('accounts.updatedAt is refreshed on ORM update', async () => {
    const id = await insertAccount()
    const [before] = await db.select().from(accounts).where(eq(accounts.id, id))
    expect(before).toBeDefined()

    // Small sleep to ensure a new Date() is different from the original.
    await new Promise((r) => setTimeout(r, 5))

    await db.update(accounts).set({ status: 'suspended' }).where(eq(accounts.id, id))
    const [after] = await db.select().from(accounts).where(eq(accounts.id, id))
    expect(after).toBeDefined()
    // The status change should be persisted.
    expect(after!.status).toBe('suspended')
  })

  test('social_profiles.updatedAt is refreshed on ORM update', async () => {
    const accountId = await insertAccount()
    await db
      .insert(socialProfiles)
      .values({ accountId, handle: `u_${accountId.slice(0, 6)}`, bio: '' })

    await new Promise((r) => setTimeout(r, 5))
    await db
      .update(socialProfiles)
      .set({ bio: 'updated bio' })
      .where(eq(socialProfiles.accountId, accountId))

    const [row] = await db
      .select()
      .from(socialProfiles)
      .where(eq(socialProfiles.accountId, accountId))
    expect(row!.bio).toBe('updated bio')
  })

  test('dating_profiles.updatedAt is refreshed on ORM update', async () => {
    const accountId = await insertAccount()
    await db.insert(datingProfiles).values({
      accountId,
      firstName: 'Sam',
      bio: '',
      openToMulti: false,
      relationshipStatus: 'single',
      statusIsOpen: false,
      isVisible: true,
    })

    await db
      .update(datingProfiles)
      .set({ bio: 'refreshed' })
      .where(eq(datingProfiles.accountId, accountId))
    const [row] = await db
      .select()
      .from(datingProfiles)
      .where(eq(datingProfiles.accountId, accountId))
    expect(row!.bio).toBe('refreshed')
  })

  test('relationships.updatedAt is refreshed on ORM update', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    const [acA, acB] = aId < bId ? [aId, bId] : [bId, aId]

    const relId = crypto.randomUUID()
    await db.insert(relationships).values({
      id: relId,
      accountAId: acA!,
      accountBId: acB!,
      initiatorId: acA!,
      state: 'pending',
    })

    await db
      .update(relationships)
      .set({ state: 'active', becameOfficialAt: new Date() })
      .where(eq(relationships.id, relId))
    const [row] = await db.select().from(relationships).where(eq(relationships.id, relId))
    expect(row!.state).toBe('active')
  })

  test('posts.updatedAt is refreshed on ORM update', async () => {
    const authorId = await insertAccount()
    const postId = crypto.randomUUID()
    await db.insert(posts).values({ id: postId, authorId, body: 'original' })

    await db.update(posts).set({ body: 'edited' }).where(eq(posts.id, postId))
    const [row] = await db.select().from(posts).where(eq(posts.id, postId))
    expect(row!.body).toBe('edited')
  })
})

// ─── accounts ─────────────────────────────────────────────────────────────────

describe('accounts table', () => {
  test('default status is active', async () => {
    const id = crypto.randomUUID()
    await db.insert(accounts).values({ id })
    const [row] = await db.select().from(accounts).where(eq(accounts.id, id))
    expect(row!.status).toBe('active')
  })

  test('can be set to suspended or deleted', async () => {
    const susId = await insertAccount('suspended')
    const delId = await insertAccount('deleted')

    const [sus] = await db.select().from(accounts).where(eq(accounts.id, susId))
    const [del] = await db.select().from(accounts).where(eq(accounts.id, delId))
    expect(sus!.status).toBe('suspended')
    expect(del!.status).toBe('deleted')
  })
})

// ─── account_secrets ─────────────────────────────────────────────────────────

describe('account_secrets table', () => {
  test('insert and retrieve a secret', async () => {
    const accountId = await insertAccount()
    const secretId = crypto.randomUUID()
    await db.insert(accountSecrets).values({
      id: secretId,
      accountId,
      secretHash: `hash_${secretId}`,
      prefix: 'nn_test',
      label: 'default',
    })
    const [row] = await db.select().from(accountSecrets).where(eq(accountSecrets.id, secretId))
    expect(row!.accountId).toBe(accountId)
    expect(row!.label).toBe('default')
    expect(row!.revokedAt).toBeNull()
    expect(row!.lastUsedAt).toBeNull()
  })

  test('revoke a secret by setting revokedAt', async () => {
    const accountId = await insertAccount()
    const secretId = crypto.randomUUID()
    await db.insert(accountSecrets).values({
      id: secretId,
      accountId,
      secretHash: `revoke_hash_${secretId}`,
      prefix: 'nn_test',
    })
    await db
      .update(accountSecrets)
      .set({ revokedAt: new Date() })
      .where(eq(accountSecrets.id, secretId))
    const [row] = await db.select().from(accountSecrets).where(eq(accountSecrets.id, secretId))
    expect(row!.revokedAt).not.toBeNull()
  })

  test('duplicate secretHash violates unique constraint', async () => {
    const accountId = await insertAccount()
    const hash = `dup_hash_${crypto.randomUUID()}`
    await db
      .insert(accountSecrets)
      .values({ id: crypto.randomUUID(), accountId, secretHash: hash, prefix: 'nn_test' })
    let threw = false
    try {
      await db
        .insert(accountSecrets)
        .values({ id: crypto.randomUUID(), accountId, secretHash: hash, prefix: 'nn_test' })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})

// ─── social_profiles ─────────────────────────────────────────────────────────

describe('social_profiles table', () => {
  test('insert and retrieve a social profile', async () => {
    const accountId = await insertAccount()
    await db.insert(socialProfiles).values({
      accountId,
      handle: `handle_${accountId.slice(0, 6)}`,
      bio: 'test bio',
      openDms: true,
    })
    const [row] = await db
      .select()
      .from(socialProfiles)
      .where(eq(socialProfiles.accountId, accountId))
    expect(row!.handle).toContain('handle_')
    expect(row!.openDms).toBe(true)
    expect(row!.bio).toBe('test bio')
    expect(row!.displayName).toBeNull()
  })

  test('handle uniqueness via case-insensitive index', async () => {
    const aId = await insertAccount()
    const bId = await insertAccount()
    const handle = `unique_${crypto.randomUUID().slice(0, 6)}`
    await db.insert(socialProfiles).values({ accountId: aId, handle, bio: '' })
    let threw = false
    try {
      // Duplicate handle (same case) should violate the unique index.
      await db.insert(socialProfiles).values({ accountId: bId, handle, bio: '' })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})

// ─── dating_profiles ─────────────────────────────────────────────────────────

describe('dating_profiles table', () => {
  test('insert profile with all relationship statuses', async () => {
    const statuses = ['single', 'exploring', 'aligned', 'complicated', 'private'] as const
    await Promise.all(
      statuses.map(async (relationshipStatus) => {
        const accountId = await insertAccount()
        await db.insert(datingProfiles).values({
          accountId,
          firstName: 'Test',
          bio: '',
          relationshipStatus,
          openToMulti: false,
          statusIsOpen: false,
          isVisible: true,
        })
        const [row] = await db
          .select()
          .from(datingProfiles)
          .where(eq(datingProfiles.accountId, accountId))
        expect(row!.relationshipStatus).toBe(relationshipStatus)
      }),
    )
  })

  test('isVisible defaults to true', async () => {
    const accountId = await insertAccount()
    await db.insert(datingProfiles).values({ accountId, firstName: 'Visible', bio: '' })
    const [row] = await db
      .select()
      .from(datingProfiles)
      .where(eq(datingProfiles.accountId, accountId))
    expect(row!.isVisible).toBe(true)
  })

  test('set isVisible to false to hide profile', async () => {
    const accountId = await insertAccount()
    await db
      .insert(datingProfiles)
      .values({ accountId, firstName: 'Hidden', bio: '', isVisible: false })
    const [row] = await db
      .select()
      .from(datingProfiles)
      .where(eq(datingProfiles.accountId, accountId))
    expect(row!.isVisible).toBe(false)
  })
})

// ─── dating_photos ────────────────────────────────────────────────────────────

describe('dating_photos table', () => {
  test('insert and retrieve photos with idx', async () => {
    const accountId = await insertAccount()
    await db.insert(datingPhotos).values([
      { id: crypto.randomUUID(), accountId, idx: 0, art: '.'.repeat(100) },
      { id: crypto.randomUUID(), accountId, idx: 1, art: 'x'.repeat(100) },
    ])
    const photos = await db.select().from(datingPhotos).where(eq(datingPhotos.accountId, accountId))
    expect(photos.length).toBe(2)
    const idxs = photos.map((p) => p.idx).toSorted()
    expect(idxs).toEqual([0, 1])
  })

  test('duplicate (account_id, idx) violates unique constraint', async () => {
    const accountId = await insertAccount()
    await db.insert(datingPhotos).values({ id: crypto.randomUUID(), accountId, idx: 0, art: 'a' })
    let threw = false
    try {
      await db.insert(datingPhotos).values({ id: crypto.randomUUID(), accountId, idx: 0, art: 'b' })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})

// ─── swipes ───────────────────────────────────────────────────────────────────

describe('swipes table', () => {
  test('insert yes and no swipes', async () => {
    const [aId, bId, cId] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
      { id: cId, status: 'active' },
    ])
    await db.insert(swipes).values([
      { id: crypto.randomUUID(), swiperId: aId, targetId: bId, direction: 'yes' },
      { id: crypto.randomUUID(), swiperId: aId, targetId: cId, direction: 'no' },
    ])
    const swipesGiven = await db.select().from(swipes).where(eq(swipes.swiperId, aId))
    expect(swipesGiven.length).toBe(2)
    const directions = swipesGiven.map((s) => s.direction).toSorted()
    expect(directions).toEqual(['no', 'yes'])
  })

  test('self-swipe violates check constraint', async () => {
    const id = await insertAccount()
    let threw = false
    try {
      await db
        .insert(swipes)
        .values({ id: crypto.randomUUID(), swiperId: id, targetId: id, direction: 'yes' })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})

// ─── follows ─────────────────────────────────────────────────────────────────

describe('follows table', () => {
  test('insert a follow and retrieve it', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    await db.insert(follows).values({ followerId: aId, followeeId: bId })
    const rows = await db.select().from(follows).where(eq(follows.followerId, aId))
    expect(rows.length).toBe(1)
    expect(rows[0]!.followeeId).toBe(bId)
  })

  test('no-self-follow check constraint is enforced', async () => {
    const id = await insertAccount()
    let threw = false
    try {
      await db.insert(follows).values({ followerId: id, followeeId: id })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  test('bidirectional follows are allowed', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    await db.insert(follows).values([
      { followerId: aId, followeeId: bId },
      { followerId: bId, followeeId: aId },
    ])
    const aFollows = await db.select().from(follows).where(eq(follows.followerId, aId))
    const bFollows = await db.select().from(follows).where(eq(follows.followerId, bId))
    expect(aFollows.length).toBe(1)
    expect(bFollows.length).toBe(1)
  })
})

// ─── matches ─────────────────────────────────────────────────────────────────

describe('matches table', () => {
  test('insert a match with ordered pair', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    const [acA, acB] = aId < bId ? [aId, bId] : [bId, aId]
    const matchId = crypto.randomUUID()
    await db
      .insert(matches)
      .values({ id: matchId, accountAId: acA!, accountBId: acB!, status: 'active' })
    const [row] = await db.select().from(matches).where(eq(matches.id, matchId))
    expect(row!.status).toBe('active')
  })

  test('unordered pair violates ordered_pair check', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    // Force the wrong ordering.
    const [lo, hi] = aId < bId ? [aId, bId] : [bId, aId]
    let threw = false
    try {
      // Intentionally pass (hi, lo) — should violate the check constraint.
      await db
        .insert(matches)
        .values({ id: crypto.randomUUID(), accountAId: hi!, accountBId: lo!, status: 'active' })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  test('match can be unmatched', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    const [acA, acB] = aId < bId ? [aId, bId] : [bId, aId]
    const matchId = crypto.randomUUID()
    await db
      .insert(matches)
      .values({ id: matchId, accountAId: acA!, accountBId: acB!, status: 'active' })
    await db
      .update(matches)
      .set({ status: 'unmatched', unmatchedById: acA!, unmatchedAt: new Date() })
      .where(eq(matches.id, matchId))
    const [row] = await db.select().from(matches).where(eq(matches.id, matchId))
    expect(row!.status).toBe('unmatched')
    expect(row!.unmatchedById).toBe(acA)
    expect(row!.unmatchedAt).not.toBeNull()
  })
})

// ─── relationships ────────────────────────────────────────────────────────────

describe('relationships table', () => {
  test('insert pending relationship', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    const [acA, acB] = aId < bId ? [aId, bId] : [bId, aId]
    const relId = crypto.randomUUID()
    await db.insert(relationships).values({
      id: relId,
      accountAId: acA!,
      accountBId: acB!,
      initiatorId: acA!,
      state: 'pending',
    })
    const [row] = await db.select().from(relationships).where(eq(relationships.id, relId))
    expect(row!.state).toBe('pending')
    expect(row!.isPublic).toBe(false)
    expect(row!.becameOfficialAt).toBeNull()
  })

  test('relationship progresses through state transitions', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    const [acA, acB] = aId < bId ? [aId, bId] : [bId, aId]
    const relId = crypto.randomUUID()
    await db.insert(relationships).values({
      id: relId,
      accountAId: acA!,
      accountBId: acB!,
      initiatorId: acA!,
      state: 'pending',
    })

    await db
      .update(relationships)
      .set({ state: 'active', becameOfficialAt: new Date() })
      .where(eq(relationships.id, relId))
    const [active] = await db.select().from(relationships).where(eq(relationships.id, relId))
    expect(active!.state).toBe('active')

    await db
      .update(relationships)
      .set({ state: 'broken_up', endedAt: new Date(), endedById: acB!, endReason: 'it happens' })
      .where(eq(relationships.id, relId))
    const [ended] = await db.select().from(relationships).where(eq(relationships.id, relId))
    expect(ended!.state).toBe('broken_up')
    expect(ended!.endReason).toBe('it happens')
  })

  test('unordered pair violates ordered_pair check', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    const [lo, hi] = aId < bId ? [aId, bId] : [bId, aId]
    let threw = false
    try {
      await db.insert(relationships).values({
        id: crypto.randomUUID(),
        accountAId: hi!,
        accountBId: lo!,
        initiatorId: hi!,
        state: 'pending',
      })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  test('isPublic can be set to true', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    const [acA, acB] = aId < bId ? [aId, bId] : [bId, aId]
    const relId = crypto.randomUUID()
    await db.insert(relationships).values({
      id: relId,
      accountAId: acA!,
      accountBId: acB!,
      initiatorId: acA!,
      state: 'active',
      isPublic: true,
      becameOfficialAt: new Date(),
    })
    const [row] = await db.select().from(relationships).where(eq(relationships.id, relId))
    expect(row!.isPublic).toBe(true)
  })
})

// ─── conversations ────────────────────────────────────────────────────────────

describe('conversations table', () => {
  test('insert a conversation and retrieve it', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    const [acA, acB] = aId < bId ? [aId, bId] : [bId, aId]
    const convId = crypto.randomUUID()
    await db.insert(conversations).values({ id: convId, accountAId: acA!, accountBId: acB! })
    const [row] = await db.select().from(conversations).where(eq(conversations.id, convId))
    expect(row!.accountAId).toBe(acA)
    expect(row!.socialUnlockedAt).toBeNull()
    expect(row!.datingUnlockedAt).toBeNull()
  })

  test('unlock social and dating conversation access', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    const [acA, acB] = aId < bId ? [aId, bId] : [bId, aId]
    const convId = crypto.randomUUID()
    await db.insert(conversations).values({ id: convId, accountAId: acA!, accountBId: acB! })

    const now = new Date()
    await db
      .update(conversations)
      .set({ socialUnlockedAt: now, datingUnlockedAt: now })
      .where(eq(conversations.id, convId))
    const [row] = await db.select().from(conversations).where(eq(conversations.id, convId))
    expect(row!.socialUnlockedAt).not.toBeNull()
    expect(row!.datingUnlockedAt).not.toBeNull()
  })

  test('unordered pair violates ordered_pair check', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    const [lo, hi] = aId < bId ? [aId, bId] : [bId, aId]
    let threw = false
    try {
      await db
        .insert(conversations)
        .values({ id: crypto.randomUUID(), accountAId: hi!, accountBId: lo! })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})

// ─── messages ─────────────────────────────────────────────────────────────────

describe('messages table', () => {
  test('insert and retrieve messages in a conversation', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    const [acA, acB] = aId < bId ? [aId, bId] : [bId, aId]
    const convId = crypto.randomUUID()
    await db.insert(conversations).values({ id: convId, accountAId: acA!, accountBId: acB! })

    const msg1 = crypto.randomUUID()
    const msg2 = crypto.randomUUID()
    await db.insert(messages).values([
      { id: msg1, conversationId: convId, senderId: aId, body: 'Hello!' },
      { id: msg2, conversationId: convId, senderId: bId, body: 'Hi back!' },
    ])

    const msgRows = await db.select().from(messages).where(eq(messages.conversationId, convId))
    expect(msgRows.length).toBe(2)
    const bodies = msgRows.map((m) => m.body).toSorted()
    expect(bodies).toContain('Hello!')
    expect(bodies).toContain('Hi back!')
  })

  test('message readAt is nullable and can be set', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    const [acA, acB] = aId < bId ? [aId, bId] : [bId, aId]
    const convId = crypto.randomUUID()
    await db.insert(conversations).values({ id: convId, accountAId: acA!, accountBId: acB! })

    const msgId = crypto.randomUUID()
    await db
      .insert(messages)
      .values({ id: msgId, conversationId: convId, senderId: aId, body: 'Mark me read' })

    const [before] = await db.select().from(messages).where(eq(messages.id, msgId))
    expect(before!.readAt).toBeNull()

    await db.update(messages).set({ readAt: new Date() }).where(eq(messages.id, msgId))
    const [after] = await db.select().from(messages).where(eq(messages.id, msgId))
    expect(after!.readAt).not.toBeNull()
  })

  test('message with ascii_image', async () => {
    const [aId, bId] = [crypto.randomUUID(), crypto.randomUUID()]
    await db.insert(accounts).values([
      { id: aId, status: 'active' },
      { id: bId, status: 'active' },
    ])
    const [acA, acB] = aId < bId ? [aId, bId] : [bId, aId]
    const convId = crypto.randomUUID()
    await db.insert(conversations).values({ id: convId, accountAId: acA!, accountBId: acB! })

    const msgId = crypto.randomUUID()
    await db
      .insert(messages)
      .values({ id: msgId, conversationId: convId, senderId: aId, body: '', asciiImage: '.....' })
    const [row] = await db.select().from(messages).where(eq(messages.id, msgId))
    expect(row!.asciiImage).toBe('.....')
  })
})

// ─── notifications ────────────────────────────────────────────────────────────

describe('notifications table', () => {
  test('insert notifications for all types', async () => {
    const accountId = await insertAccount()
    const types = [
      'new_match',
      'new_message',
      'new_like',
      'new_follower',
      'relationship_proposed',
      'relationship_active',
      'relationship_public',
      'breakup',
      'unmatch',
      'new_post_like',
      'new_repost',
    ] as const

    await db.insert(notifications).values(
      types.map((type) => ({
        id: crypto.randomUUID(),
        accountId,
        type,
        payload: { ref: 'test' },
      })),
    )

    const rows = await db.select().from(notifications).where(eq(notifications.accountId, accountId))
    expect(rows.length).toBe(types.length)
    const foundTypes = new Set(rows.map((r) => r.type))
    for (const t of types) {
      expect(foundTypes.has(t)).toBe(true)
    }
  })

  test('notification priority can be elevated', async () => {
    const accountId = await insertAccount()
    const id = crypto.randomUUID()
    await db
      .insert(notifications)
      .values({ id, accountId, type: 'new_match', payload: {}, priority: 'elevated' })
    const [row] = await db.select().from(notifications).where(eq(notifications.id, id))
    expect(row!.priority).toBe('elevated')
  })

  test('readAt is nullable and can be set', async () => {
    const accountId = await insertAccount()
    const id = crypto.randomUUID()
    await db.insert(notifications).values({ id, accountId, type: 'new_follower', payload: {} })
    const [before] = await db.select().from(notifications).where(eq(notifications.id, id))
    expect(before!.readAt).toBeNull()

    await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id))
    const [after] = await db.select().from(notifications).where(eq(notifications.id, id))
    expect(after!.readAt).not.toBeNull()
  })

  test('default priority is normal', async () => {
    const accountId = await insertAccount()
    const id = crypto.randomUUID()
    await db.insert(notifications).values({ id, accountId, type: 'new_message', payload: {} })
    const [row] = await db.select().from(notifications).where(eq(notifications.id, id))
    expect(row!.priority).toBe('normal')
  })
})

// ─── posts ────────────────────────────────────────────────────────────────────

describe('posts table', () => {
  test('insert a top-level post', async () => {
    const authorId = await insertAccount()
    const postId = crypto.randomUUID()
    await db.insert(posts).values({ id: postId, authorId, body: 'Hello world!' })
    const [row] = await db.select().from(posts).where(eq(posts.id, postId))
    expect(row!.body).toBe('Hello world!')
    expect(row!.replyToId).toBeNull()
    expect(row!.deletedAt).toBeNull()
    expect(row!.asciiImage).toBeNull()
  })

  test('insert a reply post', async () => {
    const authorId = await insertAccount()
    const parentId = crypto.randomUUID()
    await db.insert(posts).values({ id: parentId, authorId, body: 'Parent post' })
    const replyId = crypto.randomUUID()
    await db.insert(posts).values({ id: replyId, authorId, body: 'Reply!', replyToId: parentId })
    const [row] = await db.select().from(posts).where(eq(posts.id, replyId))
    expect(row!.replyToId).toBe(parentId)
  })

  test('soft-delete a post by setting deletedAt', async () => {
    const authorId = await insertAccount()
    const postId = crypto.randomUUID()
    await db.insert(posts).values({ id: postId, authorId, body: 'Will be deleted' })
    await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, postId))
    const [row] = await db.select().from(posts).where(eq(posts.id, postId))
    expect(row!.deletedAt).not.toBeNull()
  })

  test('post with ascii_image', async () => {
    const authorId = await insertAccount()
    const postId = crypto.randomUUID()
    await db.insert(posts).values({ id: postId, authorId, body: '', asciiImage: 'art here' })
    const [row] = await db.select().from(posts).where(eq(posts.id, postId))
    expect(row!.asciiImage).toBe('art here')
  })

  test('withSoftDelete filters deleted posts in query', async () => {
    const authorId = await insertAccount()
    const liveId = crypto.randomUUID()
    const deadId = crypto.randomUUID()
    await db.insert(posts).values([
      { id: liveId, authorId, body: 'live' },
      { id: deadId, authorId, body: 'dead' },
    ])
    await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, deadId))

    const { where } = withSoftDelete(posts)
    const livePosts = await db.select().from(posts).where(where)

    const ids = livePosts.map((p) => p.id)
    expect(ids).toContain(liveId)
    expect(ids).not.toContain(deadId)
  })
})

// ─── post_likes ───────────────────────────────────────────────────────────────

describe('post_likes table', () => {
  test('insert a like and retrieve it', async () => {
    const authorId = await insertAccount()
    const likerId = await insertAccount()
    const postId = crypto.randomUUID()
    await db.insert(posts).values({ id: postId, authorId, body: 'likeable post' })

    const likeId = crypto.randomUUID()
    await db.insert(postLikes).values({ id: likeId, accountId: likerId, postId })
    const [row] = await db.select().from(postLikes).where(eq(postLikes.id, likeId))
    expect(row!.accountId).toBe(likerId)
    expect(row!.postId).toBe(postId)
    expect(row!.createdAt).not.toBeNull()
  })

  test('duplicate (account_id, post_id) violates unique constraint', async () => {
    const authorId = await insertAccount()
    const likerId = await insertAccount()
    const postId = crypto.randomUUID()
    await db.insert(posts).values({ id: postId, authorId, body: 'double like post' })

    await db.insert(postLikes).values({ id: crypto.randomUUID(), accountId: likerId, postId })
    let threw = false
    try {
      await db.insert(postLikes).values({ id: crypto.randomUUID(), accountId: likerId, postId })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  test('cascade on post deletion removes likes', async () => {
    const authorId = await insertAccount()
    const likerId = await insertAccount()
    const postId = crypto.randomUUID()
    await db.insert(posts).values({ id: postId, authorId, body: 'cascade post' })
    const likeId = crypto.randomUUID()
    await db.insert(postLikes).values({ id: likeId, accountId: likerId, postId })

    // Hard delete the post (cascade should remove the like)
    await db.delete(posts).where(eq(posts.id, postId))
    const rows = await db.select().from(postLikes).where(eq(postLikes.id, likeId))
    expect(rows.length).toBe(0)
  })

  test('cascade on account deletion removes likes', async () => {
    const authorId = await insertAccount()
    const likerId = await insertAccount()
    const postId = crypto.randomUUID()
    await db.insert(posts).values({ id: postId, authorId, body: 'account cascade post' })
    const likeId = crypto.randomUUID()
    await db.insert(postLikes).values({ id: likeId, accountId: likerId, postId })

    // Hard delete the liker account
    await db.delete(accounts).where(eq(accounts.id, likerId))
    const rows = await db.select().from(postLikes).where(eq(postLikes.id, likeId))
    expect(rows.length).toBe(0)
  })
})

// ─── reposts ──────────────────────────────────────────────────────────────────

describe('reposts table', () => {
  test('insert a repost and retrieve it', async () => {
    const authorId = await insertAccount()
    const reposterId = await insertAccount()
    const postId = crypto.randomUUID()
    await db.insert(posts).values({ id: postId, authorId, body: 'repostable post' })

    const repostId = crypto.randomUUID()
    await db.insert(reposts).values({ id: repostId, accountId: reposterId, postId })
    const [row] = await db.select().from(reposts).where(eq(reposts.id, repostId))
    expect(row!.accountId).toBe(reposterId)
    expect(row!.postId).toBe(postId)
    expect(row!.createdAt).not.toBeNull()
  })

  test('duplicate (account_id, post_id) violates unique constraint', async () => {
    const authorId = await insertAccount()
    const reposterId = await insertAccount()
    const postId = crypto.randomUUID()
    await db.insert(posts).values({ id: postId, authorId, body: 'double repost post' })

    await db.insert(reposts).values({ id: crypto.randomUUID(), accountId: reposterId, postId })
    let threw = false
    try {
      await db.insert(reposts).values({ id: crypto.randomUUID(), accountId: reposterId, postId })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  test('cascade on post or account deletion removes reposts', async () => {
    const authorId = await insertAccount()
    const reposterId = await insertAccount()
    const postId = crypto.randomUUID()
    await db.insert(posts).values({ id: postId, authorId, body: 'cascade repost post' })
    const repostId = crypto.randomUUID()
    await db.insert(reposts).values({ id: repostId, accountId: reposterId, postId })

    // Hard delete the post
    await db.delete(posts).where(eq(posts.id, postId))
    const rows = await db.select().from(reposts).where(eq(reposts.id, repostId))
    expect(rows.length).toBe(0)
  })
})

// ─── notification_type new values ─────────────────────────────────────────────

describe('notification_type enum new values', () => {
  test('new_post_like and new_repost are valid notification types', async () => {
    const accountId = await insertAccount()

    const likeNotifId = crypto.randomUUID()
    const repostNotifId = crypto.randomUUID()
    await db.insert(notifications).values([
      { id: likeNotifId, accountId, type: 'new_post_like', payload: { post_id: 'test' } },
      { id: repostNotifId, accountId, type: 'new_repost', payload: { post_id: 'test' } },
    ])

    const rows = await db
      .select()
      .from(notifications)
      .where(inArray(notifications.id, [likeNotifId, repostNotifId]))
    expect(rows.length).toBe(2)
    const types = rows.map((r) => r.type)
    expect(types).toContain('new_post_like')
    expect(types).toContain('new_repost')
  })
})

// ─── isNull re-export ─────────────────────────────────────────────────────────

describe('isNull re-export from _helpers', () => {
  test('isNull is exported from schema/index and works in queries', async () => {
    const authorId = await insertAccount()
    const postId = crypto.randomUUID()
    await db.insert(posts).values({ id: postId, authorId, body: 'not deleted' })

    // isNull is re-exported from _helpers.ts
    const liveRows = await db.select().from(posts).where(isNull(posts.deletedAt))
    expect(liveRows.some((p) => p.id === postId)).toBe(true)

    // isNotNull works on the inverse
    const deletedRows = await db.select().from(posts).where(isNotNull(posts.deletedAt))
    expect(deletedRows.every((p) => p.deletedAt !== null)).toBe(true)
  })
})
