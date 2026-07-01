/**
 * Tests for the `release:set-version` task script
 * (scripts/mise-tasks/release/set-version).
 *
 * The nbr platform ships as ONE versioned GitHub release; the release workflow
 * computes the next semver with cocogitto and then calls this script to stamp
 * that single version into every manifest that carries it. These tests run the
 * script against a throwaway copy of the seven manifests (via its `--root` flag,
 * so the real working tree is never touched) and assert that every file lands at
 * the target version, that a second run is a byte-for-byte no-op (idempotent),
 * and that a bad version arg is rejected.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// Absolute path to the script under test and the repo root it lives in.
const SCRIPT = new URL('../../scripts/mise-tasks/release/set-version', import.meta.url).pathname
const REPO_ROOT = new URL('../../', import.meta.url).pathname

// The seven manifests the script must update, each paired with a reader that
// extracts the version value the way that file encodes it.
interface Manifest {
  /** Repo-relative path. */
  path: string
  /** Pull the platform version out of the file's text. */
  read: (text: string) => string | undefined
}

/** First `version = "..."` under a given TOML section header (e.g. [package]). */
const tomlSectionVersion =
  (section: string) =>
  (text: string): string | undefined => {
    const lines = text.split('\n')
    let inSection = false
    for (const line of lines) {
      if (line.startsWith('[')) inSection = line.trim() === section
      if (inSection) {
        const m = line.match(/^version = "([^"]+)"/)
        if (m) return m[1]
      }
    }
    return undefined
  }

/** The `version` of the [[package]] block whose name is exactly "nbr". */
const cargoLockNbrVersion = (text: string): string | undefined => {
  const lines = text.split('\n')
  let isNbr = false
  for (const line of lines) {
    if (line === '[[package]]') isNbr = false
    if (line === 'name = "nbr"') isNbr = true
    if (isNbr) {
      const m = line.match(/^version = "([^"]+)"/)
      if (m) return m[1]
    }
  }
  return undefined
}

/** The clap dependency pin in Cargo.toml — used to prove deps are untouched. */
const clapPin = (text: string): string | undefined =>
  text.match(/clap = \{ version = "([^"]+)"/)?.[1]

const jsonTopVersion = (text: string): string | undefined => JSON.parse(text).version
const marketplaceVersion = (text: string): string | undefined =>
  JSON.parse(text).plugins.find((p: { name: string }) => p.name === 'nearest-neighbor')?.version

const MANIFESTS: Manifest[] = [
  { path: 'apps/cli/Cargo.toml', read: tomlSectionVersion('[package]') },
  { path: 'apps/cli/Cargo.lock', read: cargoLockNbrVersion },
  { path: 'plugins/hermes/pyproject.toml', read: tomlSectionVersion('[project]') },
  { path: 'plugins/claude/.claude-plugin/plugin.json', read: jsonTopVersion },
  { path: 'plugins/codex/.codex-plugin/plugin.json', read: jsonTopVersion },
  { path: '.claude-plugin/marketplace.json', read: marketplaceVersion },
  { path: '.agents/plugins/marketplace.json', read: marketplaceVersion },
]

/** Run the script against `root`, return its exit code + captured output. */
async function runScript(
  version: string,
  root: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bash', SCRIPT, version, '--root', root], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}

describe('release:set-version', () => {
  let root: string

  beforeEach(() => {
    // Copy just the seven manifests into an isolated temp root, preserving the
    // repo-relative directory layout the script expects.
    root = mkdtempSync(join(tmpdir(), 'nn-set-version-'))
    for (const { path } of MANIFESTS) {
      const dest = join(root, path)
      mkdirSync(dirname(dest), { recursive: true })
      cpSync(join(REPO_ROOT, path), dest)
    }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('stamps the target version into all seven manifests', async () => {
    const target = '9.9.9'
    const { exitCode, stderr } = await runScript(target, root)
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)

    for (const { path, read } of MANIFESTS) {
      const text = readFileSync(join(root, path), 'utf8')
      expect(read(text), `${path} should be at ${target}`).toBe(target)
    }
  })

  test('does not touch dependency version pins in Cargo.toml', async () => {
    // Capture a known dependency pin before the bump.
    const before = clapPin(readFileSync(join(root, 'apps/cli/Cargo.toml'), 'utf8'))
    expect(before).toBeDefined()

    await runScript('9.9.9', root)

    const cargo = readFileSync(join(root, 'apps/cli/Cargo.toml'), 'utf8')
    // The [package] version moved, but the clap dependency pin is unchanged.
    expect(tomlSectionVersion('[package]')(cargo)).toBe('9.9.9')
    expect(clapPin(cargo)).toBe(before)
  })

  test('is idempotent — a second run makes no byte-level change', async () => {
    const target = '9.9.9'
    await runScript(target, root)
    const first = MANIFESTS.map(({ path }) => readFileSync(join(root, path), 'utf8'))

    const { exitCode, stdout } = await runScript(target, root)
    expect(exitCode).toBe(0)
    // Every file should be reported unchanged on the second pass.
    expect(stdout).not.toContain('updated:')

    const second = MANIFESTS.map(({ path }) => readFileSync(join(root, path), 'utf8'))
    expect(second).toEqual(first)
  })

  test('accepts a prerelease semver', async () => {
    const target = '9.9.9-rc.1'
    const { exitCode } = await runScript(target, root)
    expect(exitCode).toBe(0)
    for (const { path, read } of MANIFESTS) {
      expect(read(readFileSync(join(root, path), 'utf8'))).toBe(target)
    }
  })

  test('rejects a non-semver version and leaves files untouched', async () => {
    const before = MANIFESTS.map(({ path }) => readFileSync(join(root, path), 'utf8'))
    const { exitCode, stderr } = await runScript('v1.2', root)
    expect(exitCode).toBe(2)
    expect(stderr).toContain('not a valid semver')
    const after = MANIFESTS.map(({ path }) => readFileSync(join(root, path), 'utf8'))
    expect(after).toEqual(before)
  })

  test('fails fast when a marketplace entry is missing (never silently skips a carrier)', async () => {
    // Rename the nearest-neighbor entry so jq's `select` matches nothing — the
    // script must abort loudly rather than exit 0 with that carrier unstamped.
    const mkt = join(root, '.claude-plugin/marketplace.json')
    const data = JSON.parse(readFileSync(mkt, 'utf8'))
    data.plugins = data.plugins.map((p: { name: string }) =>
      p.name === 'nearest-neighbor' ? { ...p, name: 'renamed' } : p,
    )
    writeFileSync(mkt, `${JSON.stringify(data, null, 2)}\n`)

    const { exitCode, stderr } = await runScript('9.9.9', root)
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain('no entry matching selector')
  })
})
