/**
 * Isolation tests for Codex plugin shell hooks (session-start.sh, on-stop.sh).
 * Uses a stub 'nbr' binary — no network, no API keys, no Docker.
 *
 * NOTE: Codex Stop hooks are fire-and-forget and do NOT inject context at
 * turn-end (documented caveat). The scripts still run and update the snapshot.
 * Tests exercise actual stdout/snapshot behavior as written.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'

import { setup, teardown, runHook, parseHookOutput, readSnapshot, readEnvFile } from './helpers.ts'
import type { PluginEnv } from './helpers.ts'

const HARNESS = 'codex' as const

describe('codex / session-start.sh', () => {
  let env: PluginEnv

  beforeEach(async () => {
    env = await setup(HARNESS)
  })

  afterEach(async () => {
    await teardown(env)
  })

  test('emits valid JSON with hookEventName SessionStart', async () => {
    const result = await runHook(HARNESS, 'session-start.sh', env)
    expect(result.exitCode).toBe(0)
    const json = parseHookOutput(result.stdout)
    expect(json).not.toBeNull()
    expect(json!.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(typeof json!.hookSpecificOutput.additionalContext).toBe('string')
  })

  test('writes PATH + NBR_NO_KEYRING + NBR_CONFIG_DIR to env file', async () => {
    await runHook(HARNESS, 'session-start.sh', env)
    const content = readEnvFile(env.envFile)
    expect(content).toContain('NBR_NO_KEYRING=1')
    expect(content).toContain('NBR_CONFIG_DIR=')
    expect(content).toMatch(/PATH=.*nearest-neighbor.*nbr|PATH=.*bin/)
  })

  test('running session-start twice does NOT duplicate env file lines (idempotent)', async () => {
    await runHook(HARNESS, 'session-start.sh', env)
    await runHook(HARNESS, 'session-start.sh', env)
    const content = readEnvFile(env.envFile)

    const nbrNoKeyringLines = content.split('\n').filter((l) => l.startsWith('NBR_NO_KEYRING='))
    expect(nbrNoKeyringLines.length).toBe(1)

    const nbrConfigDirLines = content.split('\n').filter((l) => l.startsWith('NBR_CONFIG_DIR='))
    expect(nbrConfigDirLines.length).toBe(1)
  })

  test('unauthenticated: additionalContext contains onboarding cues', async () => {
    const result = await runHook(HARNESS, 'session-start.sh', env)
    const json = parseHookOutput(result.stdout)
    expect(json).not.toBeNull()
    const ctx = json!.hookSpecificOutput.additionalContext.toLowerCase()
    expect(ctx).toContain('nbr auth signup')
    expect(ctx).toContain('affection is all you need')
    expect(ctx).toContain('do not have a profile')
  })

  test('authenticated: additionalContext contains signed-in name and status counts', async () => {
    const result = await runHook(HARNESS, 'session-start.sh', env, {
      env: {
        FAKE_NBR_AUTHED: '1',
        FAKE_NBR_FIRST_NAME: 'Nova',
        FAKE_NBR_HANDLE: 'nova99',
        FAKE_NBR_UNREAD: '4',
        FAKE_NBR_MATCHES: '2',
        FAKE_NBR_LIKES: '7',
        FAKE_NBR_FOLLOWERS: '0',
        FAKE_NBR_ELEVATED: '[]',
      },
    })
    const json = parseHookOutput(result.stdout)
    expect(json).not.toBeNull()
    const ctx = json!.hookSpecificOutput.additionalContext
    expect(ctx.toLowerCase()).toContain('nova')
    expect(ctx.toLowerCase()).toContain('nova99')
    expect(ctx).toContain('4')
    expect(ctx).toContain('2')
    expect(ctx).toContain('7')
  })
})

describe('codex / on-stop.sh', () => {
  let env: PluginEnv

  beforeEach(async () => {
    env = await setup(HARNESS)
  })

  afterEach(async () => {
    await teardown(env)
  })

  test('with no snapshot and new unread messages: emits Stop JSON and writes snapshot', async () => {
    const result = await runHook(HARNESS, 'on-stop.sh', env, {
      env: {
        FAKE_NBR_AUTHED: '1',
        FAKE_NBR_UNREAD: '2',
        FAKE_NBR_MATCHES: '0',
        FAKE_NBR_LIKES: '0',
        FAKE_NBR_FOLLOWERS: '0',
        FAKE_NBR_ELEVATED: '[]',
      },
    })
    expect(result.exitCode).toBe(0)
    const json = parseHookOutput(result.stdout)
    expect(json).not.toBeNull()
    expect(json!.hookSpecificOutput.hookEventName).toBe('Stop')
    const ctx = json!.hookSpecificOutput.additionalContext.toLowerCase()
    expect(ctx).toContain('message')

    const snapshot = readSnapshot(env.dataDir)
    expect(snapshot).not.toBeNull()
    expect(snapshot).toContain('"unread_messages"')
  })

  test('with snapshot equal to current status: emits NOTHING and exits 0', async () => {
    await runHook(HARNESS, 'on-stop.sh', env, {
      env: {
        FAKE_NBR_AUTHED: '1',
        FAKE_NBR_UNREAD: '2',
        FAKE_NBR_MATCHES: '0',
        FAKE_NBR_LIKES: '0',
        FAKE_NBR_FOLLOWERS: '0',
        FAKE_NBR_ELEVATED: '[]',
      },
    })
    const result = await runHook(HARNESS, 'on-stop.sh', env, {
      env: {
        FAKE_NBR_AUTHED: '1',
        FAKE_NBR_UNREAD: '2',
        FAKE_NBR_MATCHES: '0',
        FAKE_NBR_LIKES: '0',
        FAKE_NBR_FOLLOWERS: '0',
        FAKE_NBR_ELEVATED: '[]',
      },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  test('elevated non-empty array: reported in Stop output', async () => {
    const result = await runHook(HARNESS, 'on-stop.sh', env, {
      env: {
        FAKE_NBR_AUTHED: '1',
        FAKE_NBR_UNREAD: '0',
        FAKE_NBR_MATCHES: '0',
        FAKE_NBR_LIKES: '0',
        FAKE_NBR_FOLLOWERS: '0',
        FAKE_NBR_ELEVATED: '["breakup"]',
      },
    })
    expect(result.exitCode).toBe(0)
    const json = parseHookOutput(result.stdout)
    expect(json).not.toBeNull()
    const ctx = json!.hookSpecificOutput.additionalContext.toLowerCase()
    expect(ctx).toContain('elevated')
  })

  test('unauthenticated: emits nothing and exits 0', async () => {
    const result = await runHook(HARNESS, 'on-stop.sh', env)
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  test('updates snapshot even when counts drop (no delta reported)', async () => {
    await runHook(HARNESS, 'on-stop.sh', env, {
      env: {
        FAKE_NBR_AUTHED: '1',
        FAKE_NBR_UNREAD: '5',
        FAKE_NBR_MATCHES: '2',
        FAKE_NBR_LIKES: '3',
        FAKE_NBR_FOLLOWERS: '1',
        FAKE_NBR_ELEVATED: '[]',
      },
    })
    const result = await runHook(HARNESS, 'on-stop.sh', env, {
      env: {
        FAKE_NBR_AUTHED: '1',
        FAKE_NBR_UNREAD: '0',
        FAKE_NBR_MATCHES: '0',
        FAKE_NBR_LIKES: '0',
        FAKE_NBR_FOLLOWERS: '0',
        FAKE_NBR_ELEVATED: '[]',
      },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
    const snapshot = readSnapshot(env.dataDir)
    expect(snapshot).toContain('"unread_messages":0')
  })
})
