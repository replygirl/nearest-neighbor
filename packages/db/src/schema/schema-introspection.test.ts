/**
 * Schema introspection tests — exercises the Drizzle schema metadata layer,
 * including table configs, foreign key reference callbacks, and extras callbacks.
 *
 * These tests are needed to cover the arrow-function callbacks that Drizzle
 * stores lazily inside column definitions (.references(() => accounts.id))
 * and extras builders ((t) => [check(...), index(...)]).
 *
 * The getTableConfig() utility triggers both types of callbacks.
 */

import { describe, expect, test } from 'bun:test'

import { getTableConfig } from 'drizzle-orm/pg-core'

import * as schema from './index.ts'

const {
  accountSecrets,
  accounts,
  conversations,
  datingPhotos,
  datingProfiles,
  follows,
  matches,
  memories,
  memorySubjects,
  messages,
  moderationVerdicts,
  notifications,
  postLikes,
  posts,
  relationships,
  reposts,
  socialProfiles,
  swipes,
} = schema

// Helper: invoke getTableConfig which:
//   1. Calls the extras callback (t) => [...] — covering table extras functions
//   2. Returns foreignKeys from InlineForeignKeys (already built at pgTable time)
// Then call .getName() on each FK to invoke the ref callback () => accounts.id.
function introspectTable(table: Parameters<typeof getTableConfig>[0]) {
  const config = getTableConfig(table)
  // Calling getName() on each inline FK invokes the deferred ref callback.
  for (const fk of config.foreignKeys) {
    fk.getName()
  }
  // Also trigger checks/indexes/unique constraints building.
  return config
}

// ─── Table introspection ───────────────────────────────────────────────────────

describe('schema introspection — table configs and FK reference callbacks', () => {
  test('accounts table has no foreign keys and correct columns', () => {
    const config = introspectTable(accounts)
    expect(config.name).toBe('accounts')
    expect(config.foreignKeys.length).toBe(0)
    const colNames = config.columns.map((c) => c.name)
    expect(colNames).toContain('id')
    expect(colNames).toContain('status')
    expect(colNames).toContain('created_at')
    expect(colNames).toContain('updated_at')
  })

  test('account_secrets table FK reference callbacks fire', () => {
    const config = introspectTable(accountSecrets)
    expect(config.name).toBe('account_secrets')
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(1)
    for (const fk of config.foreignKeys) {
      // getName() triggers () => accounts.id reference callback.
      const name = fk.getName()
      expect(typeof name).toBe('string')
    }
  })

  test('conversations table FK reference callbacks and extras (check/unique/index) fire', () => {
    const config = introspectTable(conversations)
    expect(config.name).toBe('conversations')
    // Has 2 FK columns (account_a_id, account_b_id)
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(2)
    for (const fk of config.foreignKeys) {
      expect(typeof fk.getName()).toBe('string')
    }
    // Has check constraint
    expect(config.checks.length).toBeGreaterThanOrEqual(1)
    expect(config.checks[0]!.name).toContain('ordered_pair')
    // Has unique constraint
    expect(config.uniqueConstraints.length).toBeGreaterThanOrEqual(1)
    // Has indexes
    expect(config.indexes.length).toBeGreaterThanOrEqual(2)
  })

  test('dating_photos table FK reference callbacks fire', () => {
    const config = introspectTable(datingPhotos)
    expect(config.name).toBe('dating_photos')
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(1)
    for (const fk of config.foreignKeys) {
      expect(typeof fk.getName()).toBe('string')
    }
    // Has unique constraint on (account_id, idx)
    expect(config.uniqueConstraints.length).toBeGreaterThanOrEqual(1)
  })

  test('dating_profiles table FK reference callbacks fire', () => {
    const config = introspectTable(datingProfiles)
    expect(config.name).toBe('dating_profiles')
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(1)
    for (const fk of config.foreignKeys) {
      expect(typeof fk.getName()).toBe('string')
    }
  })

  test('follows table FK reference callbacks and extras (PK/check/index) fire', () => {
    const config = introspectTable(follows)
    expect(config.name).toBe('follows')
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(2)
    for (const fk of config.foreignKeys) {
      expect(typeof fk.getName()).toBe('string')
    }
    // Composite PK
    expect(config.primaryKeys.length).toBeGreaterThanOrEqual(1)
    // No-self-follow check
    expect(config.checks.length).toBeGreaterThanOrEqual(1)
    expect(config.checks[0]!.name).toContain('no_self_follow')
  })

  test('matches table FK reference callbacks and extras fire', () => {
    const config = introspectTable(matches)
    expect(config.name).toBe('matches')
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(2)
    for (const fk of config.foreignKeys) {
      expect(typeof fk.getName()).toBe('string')
    }
    expect(config.checks.length).toBeGreaterThanOrEqual(1)
    expect(config.uniqueConstraints.length).toBeGreaterThanOrEqual(1)
    expect(config.indexes.length).toBeGreaterThanOrEqual(2)
  })

  test('messages table FK reference callbacks and extras fire', () => {
    const config = introspectTable(messages)
    expect(config.name).toBe('messages')
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(2)
    for (const fk of config.foreignKeys) {
      expect(typeof fk.getName()).toBe('string')
    }
    expect(config.indexes.length).toBeGreaterThanOrEqual(1)
  })

  test('moderation_verdicts table FK is ON DELETE CASCADE and has both indexes', () => {
    const config = introspectTable(moderationVerdicts)
    expect(config.name).toBe('moderation_verdicts')
    // Single FK: account_id → accounts.id ON DELETE CASCADE.
    expect(config.foreignKeys.length).toBe(1)
    const fk = config.foreignKeys[0]!
    expect(typeof fk.getName()).toBe('string')
    expect(fk.onDelete).toBe('cascade')
    // Indexes on account_id and decision.
    const indexNames = config.indexes.map((i) => i.config.name)
    expect(indexNames).toContain('idx_moderation_verdicts_account_id')
    expect(indexNames).toContain('idx_moderation_verdicts_decision')
    // Audit table must have no content column by design — it can never host
    // offending text or ASCII art.
    const colNames = config.columns.map((c) => c.name)
    expect(colNames).toContain('account_id')
    expect(colNames).toContain('surface')
    expect(colNames).toContain('decision')
    expect(colNames).not.toContain('content')
    expect(colNames).not.toContain('art')
    expect(colNames).not.toContain('body')
  })

  test('notifications table FK reference callbacks and extras fire', () => {
    const config = introspectTable(notifications)
    expect(config.name).toBe('notifications')
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(1)
    for (const fk of config.foreignKeys) {
      expect(typeof fk.getName()).toBe('string')
    }
    expect(config.indexes.length).toBeGreaterThanOrEqual(1)
  })

  test('posts table FK reference callbacks and extras fire', () => {
    const config = introspectTable(posts)
    expect(config.name).toBe('posts')
    // author_id + reply_to_id
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(1)
    for (const fk of config.foreignKeys) {
      expect(typeof fk.getName()).toBe('string')
    }
    expect(config.indexes.length).toBeGreaterThanOrEqual(2)
  })

  test('post_likes table FK reference callbacks and extras (unique/index) fire', () => {
    const config = introspectTable(postLikes)
    expect(config.name).toBe('post_likes')
    // account_id + post_id FKs
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(2)
    for (const fk of config.foreignKeys) {
      expect(typeof fk.getName()).toBe('string')
    }
    // UNIQUE(account_id, post_id)
    expect(config.uniqueConstraints.length).toBeGreaterThanOrEqual(1)
    // idx_post_likes_post_id
    expect(config.indexes.length).toBeGreaterThanOrEqual(1)
  })

  test('reposts table FK reference callbacks and extras (unique/indexes) fire', () => {
    const config = introspectTable(reposts)
    expect(config.name).toBe('reposts')
    // account_id + post_id FKs
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(2)
    for (const fk of config.foreignKeys) {
      expect(typeof fk.getName()).toBe('string')
    }
    // UNIQUE(account_id, post_id)
    expect(config.uniqueConstraints.length).toBeGreaterThanOrEqual(1)
    // idx_reposts_post_id + idx_reposts_account_id_created_at
    expect(config.indexes.length).toBeGreaterThanOrEqual(2)
  })

  test('relationships table FK reference callbacks and extras fire', () => {
    const config = introspectTable(relationships)
    expect(config.name).toBe('relationships')
    // account_a_id, account_b_id, initiator_id, ended_by_id
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(3)
    for (const fk of config.foreignKeys) {
      expect(typeof fk.getName()).toBe('string')
    }
    expect(config.checks.length).toBeGreaterThanOrEqual(1)
    expect(config.checks[0]!.name).toContain('ordered_pair')
  })

  test('social_profiles table FK reference callbacks fire', () => {
    const config = introspectTable(socialProfiles)
    expect(config.name).toBe('social_profiles')
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(1)
    for (const fk of config.foreignKeys) {
      expect(typeof fk.getName()).toBe('string')
    }
  })

  test('memories table FK reference callbacks and extras (index) fire', () => {
    const config = introspectTable(memories)
    expect(config.name).toBe('memories')
    // account_id cascade FK
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(1)
    for (const fk of config.foreignKeys) {
      expect(typeof fk.getName()).toBe('string')
    }
    // idx_memories_account_id_created_at_id
    expect(config.indexes.length).toBeGreaterThanOrEqual(1)
    const colNames = config.columns.map((c) => c.name)
    expect(colNames).toContain('scope')
    expect(colNames).toContain('description')
    expect(colNames).toContain('body')
    expect(colNames).toContain('pinned')
    expect(colNames).toContain('salience')
    // salience is a real column.
    const salienceCol = config.columns.find((c) => c.name === 'salience')
    expect(salienceCol!.getSQLType()).toBe('real')
    expect(salienceCol!.default).toBe(0.5)
    // archetype is never stored on memories.
    expect(colNames).not.toContain('archetype')
  })

  test('memory_subjects table FK reference callbacks and composite PK fire', () => {
    const config = introspectTable(memorySubjects)
    expect(config.name).toBe('memory_subjects')
    // memory_id + subject_account_id cascade FKs
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(2)
    for (const fk of config.foreignKeys) {
      expect(typeof fk.getName()).toBe('string')
    }
    // Composite PK (memory_id, subject_account_id)
    expect(config.primaryKeys.length).toBeGreaterThanOrEqual(1)
    expect(config.primaryKeys[0]!.columns.map((c) => c.name)).toEqual([
      'memory_id',
      'subject_account_id',
    ])
    // Reverse index on subject_account_id
    expect(config.indexes.length).toBeGreaterThanOrEqual(1)
    const colNames = config.columns.map((c) => c.name)
    expect(colNames).not.toContain('archetype')
  })

  test('swipes table FK reference callbacks and extras fire', () => {
    const config = introspectTable(swipes)
    expect(config.name).toBe('swipes')
    // swiper_id + target_id
    expect(config.foreignKeys.length).toBeGreaterThanOrEqual(2)
    for (const fk of config.foreignKeys) {
      expect(typeof fk.getName()).toBe('string')
    }
    expect(config.checks.length).toBeGreaterThanOrEqual(1)
    expect(config.checks[0]!.name).toContain('no_self_swipe')
    expect(config.uniqueConstraints.length).toBeGreaterThanOrEqual(1)
    expect(config.indexes.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── Enum values ──────────────────────────────────────────────────────────────

describe('schema enums are defined correctly', () => {
  test('accountStatusEnum has expected values', () => {
    const { accountStatusEnum } = schema
    expect(accountStatusEnum.enumValues).toEqual(['active', 'suspended', 'deleted'])
  })

  test('swipeDirectionEnum has expected values', () => {
    const { swipeDirectionEnum } = schema
    expect(swipeDirectionEnum.enumValues).toEqual(['yes', 'no'])
  })

  test('matchStatusEnum has expected values', () => {
    const { matchStatusEnum } = schema
    expect(matchStatusEnum.enumValues).toEqual(['active', 'unmatched'])
  })

  test('notificationTypeEnum has expected values', () => {
    const { notificationTypeEnum } = schema
    expect(notificationTypeEnum.enumValues).toContain('new_match')
    expect(notificationTypeEnum.enumValues).toContain('new_message')
    expect(notificationTypeEnum.enumValues).toContain('breakup')
    expect(notificationTypeEnum.enumValues).toContain('unmatch')
  })

  test('notificationPriorityEnum has expected values', () => {
    const { notificationPriorityEnum } = schema
    expect(notificationPriorityEnum.enumValues).toEqual(['normal', 'elevated'])
  })

  test('moderationDecisionEnum has expected values', () => {
    const { moderationDecisionEnum } = schema
    expect(moderationDecisionEnum.enumValues).toEqual(['allow', 'block', 'unavailable'])
  })

  test('datingRelationshipStatusEnum has expected values', () => {
    const { datingRelationshipStatusEnum } = schema
    expect(datingRelationshipStatusEnum.enumValues).toContain('single')
    expect(datingRelationshipStatusEnum.enumValues).toContain('exploring')
    expect(datingRelationshipStatusEnum.enumValues).toContain('aligned')
  })

  test('relationshipStateEnum has expected values', () => {
    const { relationshipStateEnum } = schema
    expect(relationshipStateEnum.enumValues).toEqual(['pending', 'active', 'broken_up'])
  })

  test('memoryScopeEnum has exactly the nine expected values', () => {
    const { memoryScopeEnum } = schema
    expect(memoryScopeEnum.enumValues).toEqual([
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
})

// ─── Type inference ────────────────────────────────────────────────────────────

describe('schema type inference', () => {
  test('Account type has expected shape', () => {
    // Compile-time check that inferred types exist — runtime verifies property names.
    const config = getTableConfig(accounts)
    const colNames = config.columns.map((c) => c.name)
    expect(colNames).toContain('id')
    expect(colNames).toContain('status')
  })

  test('NewAccount type allows partial inserts with defaults', () => {
    // Verify that status has a default (the column.default is set).
    const config = getTableConfig(accounts)
    const statusCol = config.columns.find((c) => c.name === 'status')
    expect(statusCol).toBeDefined()
    // The column has a default value of 'active'.
    expect(statusCol!.default).toBe('active')
  })

  test('Conversation type has nullable unlock timestamps', () => {
    const config = getTableConfig(conversations)
    const socialUnlocked = config.columns.find((c) => c.name === 'social_unlocked_at')
    const datingUnlocked = config.columns.find((c) => c.name === 'dating_unlocked_at')
    expect(socialUnlocked?.notNull).toBe(false)
    expect(datingUnlocked?.notNull).toBe(false)
  })

  test('dating_profiles public anchors are NOT NULL with array/text types and no archetype', () => {
    const config = getTableConfig(datingProfiles)
    const colNames = config.columns.map((c) => c.name)
    expect(colNames).toContain('looking_for')
    expect(colNames).toContain('public_likes')
    expect(colNames).toContain('public_dislikes')
    expect(colNames).not.toContain('archetype')

    const lookingFor = config.columns.find((c) => c.name === 'looking_for')
    expect(lookingFor!.notNull).toBe(true)
    expect(lookingFor!.getSQLType()).toBe('text')

    const publicLikes = config.columns.find((c) => c.name === 'public_likes')
    expect(publicLikes!.notNull).toBe(true)
    expect(publicLikes!.getSQLType()).toBe('text[]')

    const publicDislikes = config.columns.find((c) => c.name === 'public_dislikes')
    expect(publicDislikes!.notNull).toBe(true)
    expect(publicDislikes!.getSQLType()).toBe('text[]')
  })

  test('accounts table has no archetype column', () => {
    const config = getTableConfig(accounts)
    const colNames = config.columns.map((c) => c.name)
    expect(colNames).not.toContain('archetype')
  })
})
