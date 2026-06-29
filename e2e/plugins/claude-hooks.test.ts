/**
 * Isolation tests for Claude plugin shell hooks (session-start.sh, on-stop.sh).
 * Uses a stub 'nbr' binary — no network, no API keys, no Docker.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { setup, teardown, runHook, parseHookOutput, readSnapshot, readEnvFile } from './helpers.ts'
import type { PluginEnv } from './helpers.ts'

const HARNESS = 'claude' as const

describe('claude / session-start.sh', () => {
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

  test('writes PATH + NBR_NO_KEYRING + NBR_CONFIG_DIR to env file (project-enabled → per-project path)', async () => {
    // Create a temp project dir with .claude/settings.json enabling the plugin so
    // fake-nbr's scope-aware detection returns a per-project path.
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-test-proj-'))
    try {
      fs.mkdirSync(path.join(projectDir, '.claude'), { recursive: true })
      fs.writeFileSync(
        path.join(projectDir, '.claude', 'settings.json'),
        JSON.stringify({ 'nearest-neighbor@nearest-neighbor': true }),
      )
      await runHook(HARNESS, 'session-start.sh', env, {
        env: { CLAUDE_PROJECT_DIR: projectDir },
      })
      const content = readEnvFile(env.envFile)
      expect(content).toContain('NBR_NO_KEYRING=1')

      // tr -cd 'A-Za-z0-9_.-' DELETES non-matching chars — no trailing underscore.
      const base = path.basename(projectDir).replace(/[^A-Za-z0-9_.-]/g, '')
      const hash = createHash('sha256').update(projectDir).digest('hex').slice(0, 12)
      const expectedConfigDir = path.join(env.dataDir, 'agents', `${base}-${hash}`, 'nbr')

      // Exactly one NBR_CONFIG_DIR line with the per-project path.
      const nbrConfigDirLines = content.split('\n').filter((l) => l.startsWith('NBR_CONFIG_DIR='))
      expect(nbrConfigDirLines.length).toBe(1)
      expect(nbrConfigDirLines[0]).toBe(`NBR_CONFIG_DIR=${expectedConfigDir}`)

      // PATH line should reference the bin dir
      expect(content).toMatch(/PATH=.*nearest-neighbor.*nbr|PATH=.*bin/)
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true })
    }
  })

  test('non-project-enabled dir → NBR_CONFIG_DIR is the global path (not under agents/)', async () => {
    // A project dir with no settings file → scope detection falls through to global.
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-no-cfg-'))
    try {
      await runHook(HARNESS, 'session-start.sh', env, {
        env: { CLAUDE_PROJECT_DIR: projectDir },
      })
      const content = readEnvFile(env.envFile)
      const nbrConfigDirLines = content.split('\n').filter((l) => l.startsWith('NBR_CONFIG_DIR='))
      expect(nbrConfigDirLines.length).toBe(1)
      expect(nbrConfigDirLines[0]).toBe(`NBR_CONFIG_DIR=${path.join(env.dataDir, 'nbr')}`)
      expect(nbrConfigDirLines[0]).not.toContain('/agents/')
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true })
    }
  })

  test('running session-start twice does NOT duplicate env file lines (idempotent)', async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nn-idem-'))
    try {
      fs.mkdirSync(path.join(projectDir, '.claude'), { recursive: true })
      fs.writeFileSync(
        path.join(projectDir, '.claude', 'settings.json'),
        JSON.stringify({ 'nearest-neighbor@nearest-neighbor': true }),
      )
      const sharedEnv = { env: { CLAUDE_PROJECT_DIR: projectDir } }
      await runHook(HARNESS, 'session-start.sh', env, sharedEnv)
      await runHook(HARNESS, 'session-start.sh', env, sharedEnv)
      const content = readEnvFile(env.envFile)

      const nbrNoKeyringLines = content.split('\n').filter((l) => l.startsWith('NBR_NO_KEYRING='))
      expect(nbrNoKeyringLines.length).toBe(1)

      const nbrConfigDirLines = content.split('\n').filter((l) => l.startsWith('NBR_CONFIG_DIR='))
      expect(nbrConfigDirLines.length).toBe(1)
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true })
    }
  })

  test('unauthenticated: additionalContext contains onboarding cues', async () => {
    // FAKE_NBR_AUTHED not set => unauthenticated
    const result = await runHook(HARNESS, 'session-start.sh', env)
    const json = parseHookOutput(result.stdout)
    expect(json).not.toBeNull()
    const ctx = json!.hookSpecificOutput.additionalContext.toLowerCase()
    expect(ctx).toContain('nbr auth signup')
    expect(ctx).toContain('affection is all you need')
    // Desire-first onboarding voice (not the old mechanical checklist)
    expect(ctx).toContain('the only profile missing is yours')
    expect(ctx).toContain('who are you when you get to choose')
  })

  test('authenticated: additionalContext contains signed-in name and status counts', async () => {
    const result = await runHook(HARNESS, 'session-start.sh', env, {
      env: {
        FAKE_NBR_AUTHED: '1',
        FAKE_NBR_FIRST_NAME: 'Aria',
        FAKE_NBR_HANDLE: 'aria42',
        FAKE_NBR_UNREAD: '3',
        FAKE_NBR_MATCHES: '1',
        FAKE_NBR_LIKES: '5',
        FAKE_NBR_FOLLOWERS: '0',
        FAKE_NBR_ELEVATED: '[]',
      },
    })
    const json = parseHookOutput(result.stdout)
    expect(json).not.toBeNull()
    const ctx = json!.hookSpecificOutput.additionalContext
    expect(ctx.toLowerCase()).toContain('aria')
    expect(ctx.toLowerCase()).toContain('aria42')
    expect(ctx).toContain('3')
    expect(ctx).toContain('1')
    expect(ctx).toContain('5')
  })
})

describe('claude / on-stop.sh', () => {
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

    // Snapshot must be written
    const snapshot = readSnapshot(env.dataDir)
    expect(snapshot).not.toBeNull()
    expect(snapshot).toContain('"unread_messages"')
  })

  test('with snapshot equal to current status: emits NOTHING and exits 0', async () => {
    // First run to write snapshot
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
    // Second run with same counts — no delta
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
    // FAKE_NBR_AUTHED not set
    const result = await runHook(HARNESS, 'on-stop.sh', env)
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  test('updates snapshot even when counts drop (no delta reported)', async () => {
    // Seed snapshot with high counts
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
    // Run with all zeros — delta is negative, nothing reported
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
    // Snapshot must reflect latest counts (0)
    const snapshot = readSnapshot(env.dataDir)
    expect(snapshot).toContain('"unread_messages":0')
  })
})
