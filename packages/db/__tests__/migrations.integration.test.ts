import { afterAll, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'

// Migrations snapshot test — verifies the DB schema (post-migration) matches
// expected structure.
//
// Engine: PGlite in-memory (no external services needed).
// If DATABASE_TEST_URL is set, a real postgres DB is used instead (nightly CI).

const MIGRATIONS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../migrations',
)

const testUrl = process.env['DATABASE_TEST_URL']

async function buildDb() {
  if (testUrl) {
    const { drizzle: drizzleBunSql } = await import('drizzle-orm/bun-sql')
    return { db: drizzleBunSql({ connection: testUrl }), cleanup: async () => {} }
  }

  const raw = new PGlite('memory://')
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .toSorted()
  // Migrations must run sequentially in order — no-await-in-loop is intentional
  for (const file of files) {
    const sqlText = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
    // eslint-disable-next-line no-await-in-loop
    await raw.exec(sqlText)
  }
  const db = drizzle(raw)
  return { db, cleanup: () => raw.close() }
}

const { db, cleanup } = await buildDb()

type TableRow = { table_name: string }
type IndexRow = { indexname: string; tablename: string }
type ColumnRow = { table_name: string; column_name: string; is_nullable: string }
type ConstraintRow = { constraint_name: string; constraint_type: string }

// drizzle-orm/pglite returns { rows: T[], ... }; drizzle-orm/bun-sql returns T[] directly.
// This helper normalises both shapes so tests work with either engine.
function toRows<T>(result: T[] | { rows: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows
}

// ─── Table presence ─────────────────────────────────────────────────────────

describe('migrations snapshot — all 19 tables exist', () => {
  test('all application tables are present', async () => {
    const result = await db.execute<TableRow>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `)
    const names = toRows(result).map((r) => r.table_name)

    const expected = [
      'account_secrets',
      'accounts',
      'conversations',
      'dating_photos',
      'dating_profiles',
      'follows',
      'matches',
      'memories',
      'memory_subjects',
      'messages',
      'moderation_verdicts',
      'notifications',
      'post_likes',
      'posts',
      'relationships',
      'reports',
      'reposts',
      'social_profiles',
      'swipes',
    ]

    for (const table of expected) {
      expect(names).toContain(table)
    }

    // Exactly 19 app tables (no stray tables)
    const appTables = names.filter((n) => !n.startsWith('_'))
    expect(appTables.length).toBe(19)
  })
})

// ─── Indexes ─────────────────────────────────────────────────────────────────

describe('migrations snapshot — FK and expression indexes', () => {
  test('all expected indexes exist', async () => {
    const result = await db.execute<IndexRow>(sql`
      SELECT indexname, tablename
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `)
    const names = toRows(result).map((r) => r.indexname)

    const expected = [
      'idx_conversations_account_a_id',
      'idx_conversations_account_b_id',
      'idx_follows_followee_id',
      'idx_matches_account_a_id',
      'idx_matches_account_b_id',
      'idx_memories_account_id_created_at_id',
      'idx_memory_subjects_subject_account_id',
      'idx_messages_conversation_id_created_at',
      'idx_moderation_verdicts_account_id',
      'idx_moderation_verdicts_decision',
      'idx_notifications_account_id_read_at',
      'idx_post_likes_post_id',
      'idx_posts_author_id_created_at',
      'idx_posts_reply_to_id',
      'idx_reports_subject',
      'idx_reposts_account_id_created_at',
      'idx_reposts_post_id',
      'idx_swipes_target_id',
      'idx_social_profiles_handle_lower',
    ]

    for (const idx of expected) {
      expect(names).toContain(idx)
    }
  })

  test('idx_social_profiles_handle_lower is a unique index', async () => {
    const result = await db.execute<{ indexname: string; indexdef: string }>(sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'idx_social_profiles_handle_lower'
    `)
    const rows = toRows(result)
    expect(rows.length).toBe(1)
    // The index definition should contain UNIQUE and lower(
    expect(rows[0]!.indexdef.toLowerCase()).toContain('unique')
    expect(rows[0]!.indexdef.toLowerCase()).toContain('lower(')
  })
})

// ─── Constraints ─────────────────────────────────────────────────────────────

describe('migrations snapshot — CHECK constraints', () => {
  test('swipes has no-self-swipe check', async () => {
    const result = await db.execute<ConstraintRow>(sql`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'swipes'
        AND constraint_type = 'CHECK'
    `)
    const names = toRows(result).map((r) => r.constraint_name)
    expect(names).toContain('swipes_no_self_swipe')
  })

  test('follows has no-self-follow check', async () => {
    const result = await db.execute<ConstraintRow>(sql`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'follows'
        AND constraint_type = 'CHECK'
    `)
    const names = toRows(result).map((r) => r.constraint_name)
    expect(names).toContain('follows_no_self_follow')
  })

  test('matches has ordered-pair check', async () => {
    const result = await db.execute<ConstraintRow>(sql`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'matches'
        AND constraint_type = 'CHECK'
    `)
    const names = toRows(result).map((r) => r.constraint_name)
    expect(names).toContain('matches_ordered_pair')
  })

  test('conversations has ordered-pair check', async () => {
    const result = await db.execute<ConstraintRow>(sql`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'conversations'
        AND constraint_type = 'CHECK'
    `)
    const names = toRows(result).map((r) => r.constraint_name)
    expect(names).toContain('conversations_ordered_pair')
  })

  test('relationships has ordered-pair check', async () => {
    const result = await db.execute<ConstraintRow>(sql`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'relationships'
        AND constraint_type = 'CHECK'
    `)
    const names = toRows(result).map((r) => r.constraint_name)
    expect(names).toContain('relationships_ordered_pair')
  })

  test('post_likes has UNIQUE(account_id, post_id)', async () => {
    const result = await db.execute<ConstraintRow>(sql`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'post_likes'
        AND constraint_type = 'UNIQUE'
    `)
    const names = toRows(result).map((r) => r.constraint_name)
    expect(names).toContain('post_likes_account_id_post_id_unique')
  })

  test('reposts has UNIQUE(account_id, post_id)', async () => {
    const result = await db.execute<ConstraintRow>(sql`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'reposts'
        AND constraint_type = 'UNIQUE'
    `)
    const names = toRows(result).map((r) => r.constraint_name)
    expect(names).toContain('reposts_account_id_post_id_unique')
  })
})

// ─── Column nullability ───────────────────────────────────────────────────────

describe('migrations snapshot — column nullability', () => {
  test('accounts.status is NOT NULL', async () => {
    const result = await db.execute<ColumnRow>(sql`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'accounts'
        AND column_name = 'status'
    `)
    const rows = toRows(result)
    expect(rows.length).toBe(1)
    expect(rows[0]!.is_nullable).toBe('NO')
  })

  test('social_profiles.handle is NOT NULL', async () => {
    const result = await db.execute<ColumnRow>(sql`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'social_profiles'
        AND column_name = 'handle'
    `)
    const rows = toRows(result)
    expect(rows.length).toBe(1)
    expect(rows[0]!.is_nullable).toBe('NO')
  })

  test('messages.read_at is nullable (optional read receipt)', async () => {
    const result = await db.execute<ColumnRow>(sql`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'messages'
        AND column_name = 'read_at'
    `)
    const rows = toRows(result)
    expect(rows.length).toBe(1)
    expect(rows[0]!.is_nullable).toBe('YES')
  })

  test('account_secrets has no updated_at (append-only)', async () => {
    const result = await db.execute<ColumnRow>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'account_secrets'
        AND column_name = 'updated_at'
    `)
    const rows = toRows(result)
    expect(rows.length).toBe(0)
  })

  test('notifications has no updated_at (append-only)', async () => {
    const result = await db.execute<ColumnRow>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'notifications'
        AND column_name = 'updated_at'
    `)
    const rows = toRows(result)
    expect(rows.length).toBe(0)
  })
})

// ─── Fixture insert round-trip ────────────────────────────────────────────────

describe('migrations snapshot — fixture insert round-trip', () => {
  test('can insert and retrieve an account', async () => {
    // PGlite requires explicit UUIDs (no gen_random_uuid() in some versions)
    const id = crypto.randomUUID()
    await db.execute(sql`
      INSERT INTO accounts (id, status, created_at, updated_at)
      VALUES (${id}, 'active', now(), now())
    `)
    const result = await db.execute<{ id: string; status: string }>(sql`
      SELECT id, status FROM accounts WHERE id = ${id}
    `)
    const rows = toRows(result)
    expect(rows.length).toBe(1)
    expect(rows[0]!.id).toBe(id)
    expect(rows[0]!.status).toBe('active')
  })

  test('can insert a dating_profile linked to an account', async () => {
    const acctId = crypto.randomUUID()
    await db.execute(sql`
      INSERT INTO accounts (id, status, created_at, updated_at)
      VALUES (${acctId}, 'active', now(), now())
    `)
    await db.execute(sql`
      INSERT INTO dating_profiles
        (account_id, first_name, bio, open_to_multi, relationship_status,
         status_is_open, is_visible, created_at, updated_at)
      VALUES
        (${acctId}, 'Test', '', false, 'single', false, true, now(), now())
    `)
    const result = await db.execute<{ account_id: string; first_name: string }>(sql`
      SELECT account_id, first_name FROM dating_profiles WHERE account_id = ${acctId}
    `)
    const rows = toRows(result)
    expect(rows.length).toBe(1)
    expect(rows[0]!.first_name).toBe('Test')
  })

  test('swipes unique constraint prevents duplicate (swiper, target)', async () => {
    const swiperId = crypto.randomUUID()
    const targetId = crypto.randomUUID()

    // Create both accounts in parallel
    await Promise.all(
      [swiperId, targetId].map((id) =>
        db.execute(sql`
          INSERT INTO accounts (id, status, created_at, updated_at)
          VALUES (${id}, 'active', now(), now())
        `),
      ),
    )

    await db.execute(sql`
      INSERT INTO swipes (id, swiper_id, target_id, direction, created_at)
      VALUES (${crypto.randomUUID()}, ${swiperId}, ${targetId}, 'yes', now())
    `)

    await expect(async () => {
      await db.execute(sql`
        INSERT INTO swipes (id, swiper_id, target_id, direction, created_at)
        VALUES (${crypto.randomUUID()}, ${swiperId}, ${targetId}, 'no', now())
      `)
    }).toThrow()
  })

  test('follows composite PK prevents duplicate follow', async () => {
    const follId = crypto.randomUUID()
    const followeeId = crypto.randomUUID()

    await Promise.all(
      [follId, followeeId].map((id) =>
        db.execute(sql`
          INSERT INTO accounts (id, status, created_at, updated_at)
          VALUES (${id}, 'active', now(), now())
        `),
      ),
    )

    await db.execute(sql`
      INSERT INTO follows (follower_id, followee_id, created_at)
      VALUES (${follId}, ${followeeId}, now())
    `)

    await expect(async () => {
      await db.execute(sql`
        INSERT INTO follows (follower_id, followee_id, created_at)
        VALUES (${follId}, ${followeeId}, now())
      `)
    }).toThrow()
  })

  test('conversations unique constraint prevents duplicate pair', async () => {
    const aId = crypto.randomUUID()
    const bId = crypto.randomUUID()
    // Ensure ordered pair
    const [acA, acB] = aId < bId ? [aId, bId] : [bId, aId]

    await Promise.all(
      [aId, bId].map((id) =>
        db.execute(sql`
          INSERT INTO accounts (id, status, created_at, updated_at)
          VALUES (${id}, 'active', now(), now())
        `),
      ),
    )

    await db.execute(sql`
      INSERT INTO conversations (id, account_a_id, account_b_id, created_at)
      VALUES (${crypto.randomUUID()}, ${acA}, ${acB}, now())
    `)

    await expect(async () => {
      await db.execute(sql`
        INSERT INTO conversations (id, account_a_id, account_b_id, created_at)
        VALUES (${crypto.randomUUID()}, ${acA}, ${acB}, now())
      `)
    }).toThrow()
  })
})

// ─── Enum types ───────────────────────────────────────────────────────────────

describe('migrations snapshot — enum types', () => {
  test('all expected enums are created', async () => {
    const result = await db.execute<{ typname: string }>(sql`
      SELECT typname FROM pg_type
      WHERE typtype = 'e'
        AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      ORDER BY typname
    `)
    const names = toRows(result).map((r) => r.typname)

    const expected = [
      'account_status',
      'dating_relationship_status',
      'match_status',
      'memory_scope',
      'notification_priority',
      'notification_type',
      'relationship_state',
      'swipe_direction',
    ]

    for (const e of expected) {
      expect(names).toContain(e)
    }
  })

  test('memory_scope enum has exactly the nine expected values', async () => {
    const result = await db.execute<{ enumlabel: string }>(sql`
      SELECT enumlabel
      FROM pg_enum
      WHERE enumtypid = (
        SELECT oid FROM pg_type
        WHERE typname = 'memory_scope'
          AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      )
      ORDER BY enumsortorder
    `)
    const labels = toRows(result).map((r) => r.enumlabel)
    expect(labels).toEqual([
      'identity',
      'narrative',
      'taste',
      'aspiration',
      'anxiety',
      'relationship',
      'appearance',
      'general',
      'public_persona',
    ])
  })

  test('notification_type enum contains new_post_like and new_repost', async () => {
    const result = await db.execute<{ enumlabel: string }>(sql`
      SELECT enumlabel
      FROM pg_enum
      WHERE enumtypid = (
        SELECT oid FROM pg_type
        WHERE typname = 'notification_type'
          AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      )
      ORDER BY enumsortorder
    `)
    const labels = toRows(result).map((r) => r.enumlabel)
    expect(labels).toContain('new_post_like')
    expect(labels).toContain('new_repost')
    // Must NOT be confused with the dating like
    expect(labels).toContain('new_like')
    // Verify they are distinct values
    const likeIdx = labels.indexOf('new_like')
    const postLikeIdx = labels.indexOf('new_post_like')
    expect(postLikeIdx).not.toBe(likeIdx)
  })
})

// ─── FK cascade on new tables ─────────────────────────────────────────────────

describe('migrations snapshot — FK cascades on post_likes and reposts', () => {
  test('post_likes has ON DELETE CASCADE FK to accounts and posts', async () => {
    const result = await db.execute<{
      column_name: string
      delete_rule: string
      foreign_table_name: string
    }>(sql`
      SELECT kcu.column_name, rc.delete_rule, ccu.table_name AS foreign_table_name
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON rc.constraint_name = kcu.constraint_name
        AND rc.constraint_schema = kcu.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name
        AND rc.constraint_schema = ccu.constraint_schema
      WHERE kcu.table_schema = 'public'
        AND kcu.table_name = 'post_likes'
    `)
    const rows = toRows(result)
    const accountFk = rows.find((r) => r.foreign_table_name === 'accounts')
    const postFk = rows.find((r) => r.foreign_table_name === 'posts')
    expect(accountFk).toBeDefined()
    expect(accountFk!.delete_rule).toBe('CASCADE')
    expect(postFk).toBeDefined()
    expect(postFk!.delete_rule).toBe('CASCADE')
  })

  test('reposts has ON DELETE CASCADE FK to accounts and posts', async () => {
    const result = await db.execute<{
      column_name: string
      delete_rule: string
      foreign_table_name: string
    }>(sql`
      SELECT kcu.column_name, rc.delete_rule, ccu.table_name AS foreign_table_name
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON rc.constraint_name = kcu.constraint_name
        AND rc.constraint_schema = kcu.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name
        AND rc.constraint_schema = ccu.constraint_schema
      WHERE kcu.table_schema = 'public'
        AND kcu.table_name = 'reposts'
    `)
    const rows = toRows(result)
    const accountFk = rows.find((r) => r.foreign_table_name === 'accounts')
    const postFk = rows.find((r) => r.foreign_table_name === 'posts')
    expect(accountFk).toBeDefined()
    expect(accountFk!.delete_rule).toBe('CASCADE')
    expect(postFk).toBeDefined()
    expect(postFk!.delete_rule).toBe('CASCADE')
  })

  test('moderation_verdicts has ON DELETE CASCADE FK to accounts', async () => {
    const result = await db.execute<{
      column_name: string
      delete_rule: string
      foreign_table_name: string
    }>(sql`
      SELECT kcu.column_name, rc.delete_rule, ccu.table_name AS foreign_table_name
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON rc.constraint_name = kcu.constraint_name
        AND rc.constraint_schema = kcu.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name
        AND rc.constraint_schema = ccu.constraint_schema
      WHERE kcu.table_schema = 'public'
        AND kcu.table_name = 'moderation_verdicts'
    `)
    const rows = toRows(result)
    const accountFk = rows.find((r) => r.foreign_table_name === 'accounts')
    expect(accountFk).toBeDefined()
    expect(accountFk!.column_name).toBe('account_id')
    expect(accountFk!.delete_rule).toBe('CASCADE')
  })
})

// ─── Memory tables ─────────────────────────────────────────────────────────────

describe('migrations snapshot — memories and memory_subjects', () => {
  test('memories has ON DELETE CASCADE FK to accounts', async () => {
    const result = await db.execute<{
      delete_rule: string
      foreign_table_name: string
    }>(sql`
      SELECT rc.delete_rule, ccu.table_name AS foreign_table_name
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON rc.constraint_name = kcu.constraint_name
        AND rc.constraint_schema = kcu.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name
        AND rc.constraint_schema = ccu.constraint_schema
      WHERE kcu.table_schema = 'public'
        AND kcu.table_name = 'memories'
    `)
    const rows = toRows(result)
    const accountFk = rows.find((r) => r.foreign_table_name === 'accounts')
    expect(accountFk).toBeDefined()
    expect(accountFk!.delete_rule).toBe('CASCADE')
  })

  test('memory_subjects has ON DELETE CASCADE FKs to memories and accounts', async () => {
    const result = await db.execute<{
      delete_rule: string
      foreign_table_name: string
    }>(sql`
      SELECT rc.delete_rule, ccu.table_name AS foreign_table_name
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON rc.constraint_name = kcu.constraint_name
        AND rc.constraint_schema = kcu.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON rc.unique_constraint_name = ccu.constraint_name
        AND rc.constraint_schema = ccu.constraint_schema
      WHERE kcu.table_schema = 'public'
        AND kcu.table_name = 'memory_subjects'
    `)
    const rows = toRows(result)
    const memoryFk = rows.find((r) => r.foreign_table_name === 'memories')
    const accountFk = rows.find((r) => r.foreign_table_name === 'accounts')
    expect(memoryFk).toBeDefined()
    expect(memoryFk!.delete_rule).toBe('CASCADE')
    expect(accountFk).toBeDefined()
    expect(accountFk!.delete_rule).toBe('CASCADE')
  })

  test('memory_subjects has a composite PK on (memory_id, subject_account_id)', async () => {
    const result = await db.execute<{ column_name: string }>(sql`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.constraint_schema = kcu.constraint_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'memory_subjects'
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `)
    const cols = toRows(result).map((r) => r.column_name)
    expect(cols).toEqual(['memory_id', 'subject_account_id'])
  })

  test('memories.salience is a real column with default 0.5', async () => {
    const result = await db.execute<{ data_type: string; column_default: string | null }>(sql`
      SELECT data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'memories'
        AND column_name = 'salience'
    `)
    const rows = toRows(result)
    expect(rows.length).toBe(1)
    expect(rows[0]!.data_type).toBe('real')
    expect(rows[0]!.column_default).toContain('0.5')
  })

  test('no archetype column exists on memories, memory_subjects, accounts, or dating_profiles', async () => {
    const result = await db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'archetype'
    `)
    expect(toRows(result).length).toBe(0)
  })
})

// ─── Dating public anchors ─────────────────────────────────────────────────────

describe('migrations snapshot — dating public anchors', () => {
  test('looking_for is NOT NULL text, public_likes/public_dislikes are NOT NULL arrays', async () => {
    const result = await db.execute<{
      column_name: string
      is_nullable: string
      data_type: string
    }>(sql`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'dating_profiles'
        AND column_name IN ('looking_for', 'public_likes', 'public_dislikes')
      ORDER BY column_name
    `)
    const rows = toRows(result)
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]))

    expect(byName['looking_for']!.is_nullable).toBe('NO')
    expect(byName['looking_for']!.data_type).toBe('text')

    expect(byName['public_likes']!.is_nullable).toBe('NO')
    expect(byName['public_likes']!.data_type).toBe('ARRAY')

    expect(byName['public_dislikes']!.is_nullable).toBe('NO')
    expect(byName['public_dislikes']!.data_type).toBe('ARRAY')
  })

  test('existing dating_profiles rows expose the empty anchor defaults', async () => {
    const acctId = crypto.randomUUID()
    await db.execute(sql`
      INSERT INTO accounts (id, status, created_at, updated_at)
      VALUES (${acctId}, 'active', now(), now())
    `)
    // Insert WITHOUT the new columns — relies on the NOT NULL DEFAULTs.
    await db.execute(sql`
      INSERT INTO dating_profiles
        (account_id, first_name, bio, open_to_multi, relationship_status,
         status_is_open, is_visible, created_at, updated_at)
      VALUES
        (${acctId}, 'Defaulted', '', false, 'single', false, true, now(), now())
    `)
    const result = await db.execute<{
      looking_for: string
      public_likes: string[]
      public_dislikes: string[]
    }>(sql`
      SELECT looking_for, public_likes, public_dislikes
      FROM dating_profiles WHERE account_id = ${acctId}
    `)
    const rows = toRows(result)
    expect(rows.length).toBe(1)
    expect(rows[0]!.looking_for).toBe('')
    expect(rows[0]!.public_likes).toEqual([])
    expect(rows[0]!.public_dislikes).toEqual([])
  })
})

afterAll(async () => {
  await cleanup()
})
