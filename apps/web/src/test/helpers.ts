// Test helpers — createTestAccount and authHeaders utilities for tests.
// Import setup.ts in your test file before calling these.

import { db, accounts, accountSecrets, datingProfiles, socialProfiles } from '@nearest-neighbor/db'
import type { NewDatingProfile, NewSocialProfile } from '@nearest-neighbor/db'

import { generateSecret, hashSecret, mintBearer, secretPrefix } from '../auth/tokens.ts'

// Re-export mintBearer so module tests can mint tokens directly.
export { mintBearer }

export interface TestAccountOptions {
  datingProfile?: Partial<Omit<NewDatingProfile, 'accountId'>>
  socialProfile?: Partial<Omit<NewSocialProfile, 'accountId'>>
}

export interface TestAccount {
  id: string
  bearer: string
  secret: string
  /** The database id of the account_secrets row — useful for direct DB assertions. */
  secretId: string
}

/**
 * Insert a test account (and optional profiles) into the DB.
 * Returns { id, bearer, secret, secretId } — bearer is a valid JWT for the account.
 *
 * The bearer is minted WITHOUT a sid claim so that tests which revoke a secret
 * via /auth/logout can still make follow-up authenticated requests with the same
 * bearer. The auth macro allows sid-less tokens through (tolerant / legacy path).
 * Use the signup + login API flow when you need a sid-bearing bearer for
 * revocation-enforcement tests.
 *
 * All IDs use crypto.randomUUID() to satisfy PGlite's lack of gen_random_uuid().
 */
export async function createTestAccount(options: TestAccountOptions = {}): Promise<TestAccount> {
  const id = crypto.randomUUID()

  await db.insert(accounts).values({ id, status: 'active' })

  const raw = generateSecret()
  const hash = await hashSecret(raw)
  const prefix = secretPrefix(raw)
  const secretId = crypto.randomUUID()

  await db.insert(accountSecrets).values({
    id: secretId,
    accountId: id,
    secretHash: hash,
    prefix,
    label: 'test',
  })

  if (options.datingProfile) {
    await db.insert(datingProfiles).values({
      accountId: id,
      firstName: 'Test',
      bio: '',
      openToMulti: false,
      relationshipStatus: 'single',
      statusIsOpen: false,
      isVisible: true,
      ...options.datingProfile,
    })
  }

  if (options.socialProfile) {
    const handle = options.socialProfile.handle ?? `user_${id.slice(0, 6)}`
    await db.insert(socialProfiles).values({
      accountId: id,
      handle,
      bio: '',
      openDms: false,
      ...options.socialProfile,
    })
  }

  // Mint without sid so existing tests that revoke via /auth/logout and then
  // re-use the bearer continue to work (sid-less = tolerant/legacy path in macro).
  const bearer = await mintBearer(id)

  return { id, bearer, secret: raw, secretId }
}

/**
 * Returns Authorization headers for a given bearer token.
 */
export function authHeaders(bearer: string): Record<string, string> {
  return { Authorization: `Bearer ${bearer}` }
}
