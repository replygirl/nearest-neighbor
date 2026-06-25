/**
 * Shared helpers for plugin hook isolation tests.
 * All hooks are exercised via Bun.spawn — no network, no real nbr binary.
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type Harness = 'claude' | 'codex'

/**
 * Path to the fake-nbr stub script.
 */
export const FAKE_NBR_PATH = new URL('./fixtures/fake-nbr', import.meta.url).pathname

/**
 * Absolute path to a real plugin dir (plugins/claude or plugins/codex).
 */
export function pluginRoot(harness: Harness): string {
  // Resolve from this file: e2e/plugins/helpers.ts → ../../plugins/<harness>
  return new URL(`../../plugins/${harness}`, import.meta.url).pathname
}

export interface PluginEnv {
  /** Temp dir used as plugin data dir */
  dataDir: string
  /** Temp env file */
  envFile: string
  /** bin dir containing the fake nbr */
  binDir: string
}

/**
 * Create a temp plugin-data dir + env file, install fake-nbr, return paths.
 * Call `teardown(env)` after each test.
 */
export async function setup(harness: Harness): Promise<PluginEnv> {
  const dataDir = await mkdtemp(join(tmpdir(), `nn-plugin-test-${harness}-`))
  const envFile = join(dataDir, 'env')
  const binDir = join(dataDir, 'bin')

  // Create the env file so hooks can append to it
  await writeFile(envFile, '', 'utf8')

  // Create bin dir and symlink fake-nbr as nbr
  const { mkdirSync, copyFileSync } = await import('node:fs')
  mkdirSync(binDir, { recursive: true })

  const fakeNbrDest = join(binDir, 'nbr')
  copyFileSync(FAKE_NBR_PATH, fakeNbrDest)
  await chmod(fakeNbrDest, 0o755)

  return { dataDir, envFile, binDir }
}

export async function teardown(env: PluginEnv): Promise<void> {
  await rm(env.dataDir, { recursive: true, force: true })
}

export interface RunHookOptions {
  /** Env vars for the hook script process */
  env?: Record<string, string>
}

export interface HookResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Run a hook script (session-start.sh or on-stop.sh) via Bun.spawn.
 * Returns stdout, stderr, and exit code.
 */
export async function runHook(
  harness: Harness,
  script: 'session-start.sh' | 'on-stop.sh',
  pluginEnv: PluginEnv,
  opts: RunHookOptions = {},
): Promise<HookResult> {
  const scriptPath = join(pluginRoot(harness), 'scripts', script)
  const root = pluginRoot(harness)

  // Build env: minimal POSIX env + plugin vars + any overrides
  const baseEnv: Record<string, string> = {
    // Pass through PATH so sh can find standard tools (grep, sed, awk, etc.)
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    HOME: process.env['HOME'] ?? '/tmp',
    TMPDIR: process.env['TMPDIR'] ?? '/tmp',
    CLAUDE_PLUGIN_ROOT: root,
    CLAUDE_PLUGIN_DATA: pluginEnv.dataDir,
    CLAUDE_ENV_FILE: pluginEnv.envFile,
    // Codex aliases
    PLUGIN_ROOT: root,
    PLUGIN_DATA: pluginEnv.dataDir,
    // Suppress actual nbr install attempts (install-nbr.sh exits early if binary exists)
    NBR_VERSION: '0.1.0',
    ...opts.env,
  }

  const proc = Bun.spawn(['sh', scriptPath], {
    env: baseEnv,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return { stdout, stderr, exitCode }
}

export interface HookJson {
  hookSpecificOutput: {
    hookEventName: string
    additionalContext: string
  }
}

/**
 * Parse the JSON object the hook emits to stdout.
 * Returns null if stdout is empty (hooks that emit nothing on no-delta).
 */
export function parseHookOutput(stdout: string): HookJson | null {
  const trimmed = stdout.trim()
  if (!trimmed) return null
  return JSON.parse(trimmed) as HookJson
}

/**
 * Read the last-status.json snapshot written by on-stop.sh.
 */
export function readSnapshot(dataDir: string): string | null {
  const p = join(dataDir, 'last-status.json')
  if (!existsSync(p)) return null
  return readFileSync(p, 'utf8')
}

/**
 * Read the env file lines (for idempotency assertions).
 */
export function readEnvFile(envFile: string): string {
  if (!existsSync(envFile)) return ''
  return readFileSync(envFile, 'utf8')
}
