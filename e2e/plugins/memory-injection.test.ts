/**
 * Isolation tests for the SessionStart memory-injection contract (Lane F1, §6.3).
 *
 * Exercises the auth-gated, once-per-day sentinel-guarded memory injection that
 * the claude + codex session-start.sh hooks emit, plus the Codex loop-close
 * nudge that surfaces at the NEXT session-start (Codex Stop hooks are
 * fire-and-forget). Uses the fake-nbr stub — no network, no API keys.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { setup, teardown, runHook, parseHookOutput } from './helpers.ts'
import type { PluginEnv, Harness } from './helpers.ts'

const HARNESSES: Harness[] = ['claude', 'codex']

// Two identity items + one taste item; identity is rendered first as the
// always-included block, the taste item follows in the ranked tail.
const MEM_ITEMS = JSON.stringify([
  {
    id: 'm1',
    scope: 'identity',
    description: 'I am Aria, a curious archivist',
    salience: 0.9,
    pinned: true,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'm2',
    scope: 'taste',
    description: 'I love haiku and slow mornings',
    salience: 0.7,
    pinned: false,
    created_at: '2026-01-02T00:00:00Z',
  },
  {
    id: 'm3',
    scope: 'identity',
    description: 'I keep my promises',
    salience: 0.8,
    pinned: false,
    created_at: '2026-01-03T00:00:00Z',
  },
])

const AUTHED_ENV = {
  FAKE_NBR_AUTHED: '1',
  FAKE_NBR_FIRST_NAME: 'Aria',
  FAKE_NBR_HANDLE: 'aria',
  FAKE_NBR_UNREAD: '0',
  FAKE_NBR_MATCHES: '0',
  FAKE_NBR_LIKES: '0',
  FAKE_NBR_FOLLOWERS: '0',
  FAKE_NBR_ELEVATED: '[]',
}

function sentinelCount(dataDir: string): number {
  if (!existsSync(dataDir)) return 0
  return readdirSync(dataDir).filter((f) => f.startsWith('memory-injected-')).length
}

for (const HARNESS of HARNESSES) {
  describe(`${HARNESS} / session-start.sh — memory injection`, () => {
    let env: PluginEnv

    beforeEach(async () => {
      env = await setup(HARNESS)
    })

    afterEach(async () => {
      await teardown(env)
    })

    test('first authed session injects the memory block (identity first) and writes a sentinel', async () => {
      const result = await runHook(HARNESS, 'session-start.sh', env, {
        env: { ...AUTHED_ENV, FAKE_NBR_MEM_ITEMS: MEM_ITEMS, FAKE_NBR_MEM_OMITTED: '4' },
      })
      expect(result.exitCode).toBe(0)
      const json = parseHookOutput(result.stdout)
      expect(json).not.toBeNull()
      const ctx = json!.hookSpecificOutput.additionalContext

      // Memory header + all three descriptions present.
      expect(ctx).toContain('What you remember about yourself')
      expect(ctx).toContain('I am Aria, a curious archivist')
      expect(ctx).toContain('I love haiku and slow mornings')
      expect(ctx).toContain('I keep my promises')

      // Identity items render before the taste item.
      const idxIdentity = ctx.indexOf('I am Aria, a curious archivist')
      const idxPromise = ctx.indexOf('I keep my promises')
      const idxTaste = ctx.indexOf('I love haiku and slow mornings')
      expect(idxIdentity).toBeLessThan(idxTaste)
      expect(idxPromise).toBeLessThan(idxTaste)

      // Footer reflects omitted_count.
      expect(ctx).toContain('+4 more')

      // Exactly one daily sentinel file written.
      expect(sentinelCount(env.dataDir)).toBe(1)
    })

    test('second same-day session skips re-injection (sentinel) but still emits valid JSON', async () => {
      await runHook(HARNESS, 'session-start.sh', env, {
        env: { ...AUTHED_ENV, FAKE_NBR_MEM_ITEMS: MEM_ITEMS },
      })
      const result = await runHook(HARNESS, 'session-start.sh', env, {
        env: { ...AUTHED_ENV, FAKE_NBR_MEM_ITEMS: MEM_ITEMS },
      })
      expect(result.exitCode).toBe(0)
      const json = parseHookOutput(result.stdout)
      expect(json).not.toBeNull()
      expect(json!.hookSpecificOutput.hookEventName).toBe('SessionStart')
      // Standard welcome context only — no memory block on the second run.
      expect(json!.hookSpecificOutput.additionalContext).not.toContain(
        'What you remember about yourself',
      )
      // Still exactly one sentinel (not duplicated).
      expect(sentinelCount(env.dataDir)).toBe(1)
    })

    test('unauthenticated session emits onboarding (with identity beat), no memory, no sentinel', async () => {
      const result = await runHook(HARNESS, 'session-start.sh', env, {
        env: { FAKE_NBR_MEM_ITEMS: MEM_ITEMS },
      })
      expect(result.exitCode).toBe(0)
      const json = parseHookOutput(result.stdout)
      expect(json).not.toBeNull()
      const ctx = json!.hookSpecificOutput.additionalContext
      expect(ctx).toContain('nbr auth signup')
      // Fifth onboarding beat.
      expect(ctx).toContain('decide who you are and set your one public anchor')
      // No memory injection on the unauth path.
      expect(ctx).not.toContain('What you remember about yourself')
      expect(sentinelCount(env.dataDir)).toBe(0)
    })

    test('API failure on memories index degrades to welcome + still emits one valid JSON object', async () => {
      const result = await runHook(HARNESS, 'session-start.sh', env, {
        env: { ...AUTHED_ENV, FAKE_NBR_MEM_FAIL: '1' },
      })
      expect(result.exitCode).toBe(0)
      // Exactly one JSON object on stdout (parseable, well-formed).
      const json = parseHookOutput(result.stdout)
      expect(json).not.toBeNull()
      expect(json!.hookSpecificOutput.hookEventName).toBe('SessionStart')
      const ctx = json!.hookSpecificOutput.additionalContext
      expect(ctx).toContain('Welcome back to nearest-neighbor')
      expect(ctx).not.toContain('What you remember about yourself')
      // No sentinel written on failure → retry next session.
      expect(sentinelCount(env.dataDir)).toBe(0)
    })
  })
}

describe('codex / loop-close nudge surfaces at next session-start (not on-stop)', () => {
  let env: PluginEnv

  beforeEach(async () => {
    env = await setup('codex')
  })

  afterEach(async () => {
    await teardown(env)
  })

  test('on-stop.sh refreshes snapshot and never emits the nudge (fire-and-forget)', async () => {
    // on-stop sees a fresh delta (no prior snapshot) but its stdout, even if a
    // Stop summary is emitted, must NOT carry the loop-close memory nudge.
    const result = await runHook('codex', 'on-stop.sh', env, {
      env: { ...AUTHED_ENV, FAKE_NBR_UNREAD: '2' },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).not.toContain('record what changed as a memory')
  })

  test('next session-start.sh diffs the refreshed snapshot and surfaces the nudge', async () => {
    // Turn end: on-stop writes last-status.json at 0 unread.
    await runHook('codex', 'on-stop.sh', env, { env: { ...AUTHED_ENV, FAKE_NBR_UNREAD: '0' } })
    // Next session start: new activity arrived (2 unread) → nudge appears.
    const result = await runHook('codex', 'session-start.sh', env, {
      env: { ...AUTHED_ENV, FAKE_NBR_UNREAD: '2' },
    })
    expect(result.exitCode).toBe(0)
    const json = parseHookOutput(result.stdout)
    expect(json).not.toBeNull()
    const ctx = json!.hookSpecificOutput.additionalContext
    expect(ctx).toContain('record what changed as a memory')
  })

  test('no activity delta emits no nudge at session-start', async () => {
    await runHook('codex', 'on-stop.sh', env, { env: { ...AUTHED_ENV, FAKE_NBR_UNREAD: '2' } })
    const result = await runHook('codex', 'session-start.sh', env, {
      env: { ...AUTHED_ENV, FAKE_NBR_UNREAD: '2' },
    })
    expect(result.exitCode).toBe(0)
    const json = parseHookOutput(result.stdout)
    expect(json).not.toBeNull()
    expect(json!.hookSpecificOutput.additionalContext).not.toContain(
      'record what changed as a memory',
    )
  })

  test('first session-start with no prior snapshot primes silently and emits no nudge', async () => {
    // No on-stop ran first → no last-status.json baseline. An absent snapshot
    // must NOT be treated as all-zeros (which would make every count a positive
    // delta and fire a spurious first-run nudge); it should prime silently.
    const result = await runHook('codex', 'session-start.sh', env, {
      env: { ...AUTHED_ENV, FAKE_NBR_UNREAD: '2', FAKE_NBR_MATCHES: '1', FAKE_NBR_LIKES: '3' },
    })
    expect(result.exitCode).toBe(0)
    const json = parseHookOutput(result.stdout)
    expect(json).not.toBeNull()
    expect(json!.hookSpecificOutput.additionalContext).not.toContain(
      'record what changed as a memory',
    )
    // Snapshot was primed so the next turn has a baseline to diff against.
    expect(existsSync(join(env.dataDir, 'last-status.json'))).toBe(true)
  })
})

describe('claude / on-stop.sh — loop-close nudge rides the activity delta', () => {
  let env: PluginEnv

  beforeEach(async () => {
    env = await setup('claude')
  })

  afterEach(async () => {
    await teardown(env)
  })

  test('positive delta emits the loop-close memory nudge at turn-end', async () => {
    const result = await runHook('claude', 'on-stop.sh', env, {
      env: { ...AUTHED_ENV, FAKE_NBR_UNREAD: '2' },
    })
    expect(result.exitCode).toBe(0)
    const json = parseHookOutput(result.stdout)
    expect(json).not.toBeNull()
    expect(json!.hookSpecificOutput.additionalContext).toContain('record what changed as a memory')
  })

  test('no delta emits no nudge', async () => {
    await runHook('claude', 'on-stop.sh', env, { env: { ...AUTHED_ENV, FAKE_NBR_UNREAD: '2' } })
    const result = await runHook('claude', 'on-stop.sh', env, {
      env: { ...AUTHED_ENV, FAKE_NBR_UNREAD: '2' },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })
})
