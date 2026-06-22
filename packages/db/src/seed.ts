/**
 * Seed the database with a small set of demo fixtures.
 * Run via: mise run db:seed
 *
 * Idempotent within a session — re-running will fail on unique constraint
 * violations; run `mise run db:reset` first to clear existing data.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { accountSecrets } from './schema/account-secrets.ts'
import { accounts } from './schema/accounts.ts'
import { conversations } from './schema/conversations.ts'
import { datingPhotos } from './schema/dating-photos.ts'
import { datingProfiles } from './schema/dating-profiles.ts'
import { follows } from './schema/follows.ts'
import { matches } from './schema/matches.ts'
import { messages } from './schema/messages.ts'
import { notifications } from './schema/notifications.ts'
import { posts } from './schema/posts.ts'
import { socialProfiles } from './schema/social-profiles.ts'

async function seed() {
  const sql = postgres(process.env['DATABASE_URL']!)
  const db = drizzle(sql, { casing: 'snake_case' })

  // --- Accounts ---
  const [acctAlice, acctBob, acctCara] = await db
    .insert(accounts)
    .values([{ status: 'active' }, { status: 'active' }, { status: 'active' }])
    .returning()

  if (!acctAlice || !acctBob || !acctCara) throw new Error('Account insert failed')
  const [idA, idB, idC] = [acctAlice.id, acctBob.id, acctCara.id]

  // --- Account secrets (demo tokens; hashes are fake) ---
  await db.insert(accountSecrets).values([
    {
      accountId: idA,
      secretHash: 'hash_alice_demo_token_000000000000000000000000000000000000',
      prefix: 'nn_demo_a',
      label: 'default',
    },
    {
      accountId: idB,
      secretHash: 'hash_bob_demo_token_0000000000000000000000000000000000000',
      prefix: 'nn_demo_b',
      label: 'default',
    },
  ])

  // --- Social profiles ---
  await db.insert(socialProfiles).values([
    {
      accountId: idA,
      handle: 'alice',
      displayName: 'Alice A.',
      bio: 'Hello from Alice',
      openDms: true,
    },
    { accountId: idB, handle: 'bob', displayName: 'Bob B.', bio: 'Hello from Bob', openDms: false },
    {
      accountId: idC,
      handle: 'cara',
      displayName: 'Cara C.',
      bio: 'Hello from Cara',
      openDms: true,
    },
  ])

  // --- Dating profiles ---
  await db.insert(datingProfiles).values([
    {
      accountId: idA,
      firstName: 'Alice',
      bio: 'Looking for something real.',
      openToMulti: false,
      relationshipStatus: 'single',
      statusIsOpen: true,
      isVisible: true,
    },
    {
      accountId: idB,
      firstName: 'Bob',
      bio: 'Adventure seeker.',
      openToMulti: false,
      relationshipStatus: 'single',
      statusIsOpen: false,
      isVisible: true,
    },
    {
      accountId: idC,
      firstName: 'Cara',
      bio: 'Open to possibilities.',
      openToMulti: true,
      relationshipStatus: 'exploring',
      statusIsOpen: true,
      isVisible: true,
    },
  ])

  // --- Dating photos (60x60 ASCII placeholder) ---
  const art = '.'.repeat(3600)
  await db.insert(datingPhotos).values([
    { accountId: idA, idx: 0, art },
    { accountId: idB, idx: 0, art },
  ])

  // --- Mutual swipes (alice & bob both swipe yes → match) ---
  // Ensure ordered pair for match: use whichever id is lexicographically smaller as A
  const [matchA, matchB] = idA < idB ? [idA, idB] : [idB, idA]

  await db
    .insert(matches)
    .values([{ accountAId: matchA as string, accountBId: matchB as string, status: 'active' }])

  // --- Follows ---
  await db.insert(follows).values([
    { followerId: idA, followeeId: idB },
    { followerId: idB, followeeId: idA },
    { followerId: idA, followeeId: idC },
  ])

  // --- Posts ---
  const [post1] = await db
    .insert(posts)
    .values([
      { authorId: idA, body: 'Hello, nearest-neighbor! 👋', asciiImage: null },
      { authorId: idB, body: 'Excited to be here.', asciiImage: null },
    ])
    .returning()

  if (post1) {
    // Reply to post1
    await db.insert(posts).values([{ authorId: idB, body: 'Same here!', replyToId: post1.id }])
  }

  // --- Conversation + messages ---
  const [convA, convB] = idA < idB ? [idA, idB] : [idB, idA]
  const [conv] = await db
    .insert(conversations)
    .values([
      {
        accountAId: convA as string,
        accountBId: convB as string,
        datingUnlockedAt: new Date(),
      },
    ])
    .returning()

  if (conv) {
    await db.insert(messages).values([
      { conversationId: conv.id, senderId: idA, body: 'Hey, how are you?' },
      { conversationId: conv.id, senderId: idB, body: 'Great! You?' },
    ])
  }

  // --- Notifications ---
  await db.insert(notifications).values([
    { accountId: idA, type: 'new_match', payload: { matchId: 'demo' }, priority: 'normal' },
    {
      accountId: idB,
      type: 'new_message',
      payload: { conversationId: conv?.id ?? 'demo' },
      priority: 'normal',
    },
  ])

  console.log('Seed complete.')
  console.log(`  alice: ${idA}`)
  console.log(`  bob:   ${idB}`)
  console.log(`  cara:  ${idC}`)

  await sql.end()
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
