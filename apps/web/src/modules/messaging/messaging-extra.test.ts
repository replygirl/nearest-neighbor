// Additional messaging module tests covering previously uncovered branches.
// Uses PGlite via test/setup.ts.

import { describe, expect, test } from 'bun:test'

import { Elysia } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import '../../test/setup.ts'
import { authHeaders, createTestAccount } from '../../test/helpers.ts'
import { messagingModule } from './index.ts'

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

const app = new Elysia().use(authMacro).use(messagingModule)

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
