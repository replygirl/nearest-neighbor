import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Path to the script under test (identical across all three plugins)
const SCRIPT = path.resolve(import.meta.dir, '../../plugins/claude/scripts/install-nbr.sh')

// Version the fake binary reports. Passed explicitly via NBR_VERSION on every
// invocation below, so the installer's NBR_LOCAL_BIN path uses it directly — the
// script no longer hardcodes a default (it resolves the latest release for
// network installs).
const NBR_VERSION = '0.1.0'

/** Spawn a process and return { code, stdout, stderr }. */
async function spawn(
  cmd: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([cmd, ...args], {
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  return { code: proc.exitCode ?? 1, stdout, stderr }
}

describe('install-nbr.sh — NBR_LOCAL_BIN path', () => {
  let tmpDir: string
  let installDir: string
  let fakeBin: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbr-test-'))
    installDir = path.join(tmpDir, 'bin')
    fakeBin = path.join(tmpDir, 'fake-nbr')

    // Write a tiny POSIX sh script that acts as a fake nbr binary
    fs.writeFileSync(
      fakeBin,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "nbr ${NBR_VERSION}"; else echo "fake nbr"; fi\n`,
    )
    fs.chmodSync(fakeBin, 0o755)
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('installs .nbr-real and the nbr wrapper when NBR_LOCAL_BIN is set', async () => {
    const { code, stdout } = await spawn('sh', [SCRIPT, installDir], {
      NBR_LOCAL_BIN: fakeBin,
      NBR_VERSION,
    })

    expect(code).toBe(0)
    expect(stdout).toContain('local binary')

    const nbrReal = path.join(installDir, '.nbr-real')
    const nbrWrapper = path.join(installDir, 'nbr')

    // .nbr-real exists and is executable
    const realStat = fs.statSync(nbrReal)
    expect(realStat.isFile()).toBe(true)
    // owner-execute bit set (mode & 0o100)
    expect(realStat.mode & 0o100).toBeTruthy()

    // nbr wrapper exists and is executable
    const wrapperStat = fs.statSync(nbrWrapper)
    expect(wrapperStat.isFile()).toBe(true)
    expect(wrapperStat.mode & 0o100).toBeTruthy()
  })

  it('wrapper invocation prints the correct version', async () => {
    const nbrWrapper = path.join(installDir, 'nbr')
    const { code, stdout } = await spawn(nbrWrapper, ['--version'], {})

    expect(code).toBe(0)
    expect(stdout.trim()).toBe(`nbr ${NBR_VERSION}`)
  })

  it('project with .claude/settings.json enabling plugin → per-project path', async () => {
    // Create a temp project dir with the plugin enabled in .claude/settings.json.
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbr-proj-claude-'))
    try {
      fs.mkdirSync(path.join(projDir, '.claude'), { recursive: true })
      fs.writeFileSync(
        path.join(projDir, '.claude', 'settings.json'),
        JSON.stringify({ 'nearest-neighbor@nearest-neighbor': true }),
      )
      const nbrWrapper = path.join(installDir, 'nbr')
      const { code, stdout } = await spawn(nbrWrapper, ['--print-config-dir'], {
        CLAUDE_PROJECT_DIR: projDir,
      })

      expect(code).toBe(0)

      // tr -cd 'A-Za-z0-9_.-' DELETES non-matching chars (no trailing underscore).
      const base = path.basename(projDir).replace(/[^A-Za-z0-9_.-]/g, '')
      const hash = createHash('sha256').update(projDir).digest('hex').slice(0, 12)
      const expected = path.join(tmpDir, 'agents', `${base}-${hash}`, 'nbr')

      expect(stdout.trim()).toBe(expected)
      // The wrapper mkdir -p's the config dir at probe time
      expect(fs.existsSync(expected)).toBe(true)
      // Key has NO trailing underscore (tr -cd vs old tr -c)
      expect(base).not.toMatch(/_$/)
    } finally {
      fs.rmSync(projDir, { recursive: true, force: true })
    }
  })

  it('project with .codex/config.toml enabling plugin → per-project path', async () => {
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbr-proj-codex-'))
    try {
      fs.mkdirSync(path.join(projDir, '.codex'), { recursive: true })
      fs.writeFileSync(
        path.join(projDir, '.codex', 'config.toml'),
        '[plugins.nearest-neighbor]\nenabled = true\n',
      )
      const nbrWrapper = path.join(installDir, 'nbr')
      const { code, stdout } = await spawn(nbrWrapper, ['--print-config-dir'], {
        CLAUDE_PROJECT_DIR: projDir,
      })

      expect(code).toBe(0)

      const base = path.basename(projDir).replace(/[^A-Za-z0-9_.-]/g, '')
      const hash = createHash('sha256').update(projDir).digest('hex').slice(0, 12)
      const expected = path.join(tmpDir, 'agents', `${base}-${hash}`, 'nbr')

      expect(stdout.trim()).toBe(expected)
      expect(stdout.trim()).toContain('/agents/')
    } finally {
      fs.rmSync(projDir, { recursive: true, force: true })
    }
  })

  it('project with neither settings file → global path (not under agents/)', async () => {
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbr-proj-none-'))
    try {
      // No .claude/settings*.json or .codex/config.toml — scope detection falls through.
      const nbrWrapper = path.join(installDir, 'nbr')
      const { code, stdout } = await spawn(nbrWrapper, ['--print-config-dir'], {
        CLAUDE_PROJECT_DIR: projDir,
      })

      expect(code).toBe(0)
      expect(stdout.trim()).toBe(path.join(tmpDir, 'nbr'))
      expect(stdout.trim()).not.toContain('/agents/')
    } finally {
      fs.rmSync(projDir, { recursive: true, force: true })
    }
  })

  it('two different project-enabled roots yield two different config dirs', async () => {
    // Core regression: sibling repos must never share an nbr identity.
    const projA = fs.mkdtempSync(path.join(os.tmpdir(), 'nbr-proj-a-'))
    const projB = fs.mkdtempSync(path.join(os.tmpdir(), 'nbr-proj-b-'))
    try {
      for (const d of [projA, projB]) {
        fs.mkdirSync(path.join(d, '.claude'), { recursive: true })
        fs.writeFileSync(
          path.join(d, '.claude', 'settings.json'),
          JSON.stringify({ 'nearest-neighbor@nearest-neighbor': true }),
        )
      }
      const nbrWrapper = path.join(installDir, 'nbr')
      const { stdout: outA } = await spawn(nbrWrapper, ['--print-config-dir'], {
        CLAUDE_PROJECT_DIR: projA,
      })
      const { stdout: outB } = await spawn(nbrWrapper, ['--print-config-dir'], {
        CLAUDE_PROJECT_DIR: projB,
      })

      expect(outA.trim()).not.toBe(outB.trim())
      expect(outA.trim()).toContain('/agents/')
      expect(outB.trim()).toContain('/agents/')
    } finally {
      fs.rmSync(projA, { recursive: true, force: true })
      fs.rmSync(projB, { recursive: true, force: true })
    }
  })

  it('explicit NBR_CONFIG_DIR in env is honored verbatim (override wins)', async () => {
    const nbrWrapper = path.join(installDir, 'nbr')
    const customDir = path.join(tmpDir, 'my-custom-config', 'nbr')
    const { code, stdout } = await spawn(nbrWrapper, ['--print-config-dir'], {
      NBR_CONFIG_DIR: customDir,
      CLAUDE_PROJECT_DIR: '/should/be/ignored',
    })

    expect(code).toBe(0)
    expect(stdout.trim()).toBe(customDir)
  })

  it('$HOME/.claude/settings.json does NOT trigger per-project (user-scope guard)', async () => {
    // Regression: the walk-up must stop AT $HOME so a user/global install (where
    // the plugin is enabled in ~/.claude/settings.json) is never mis-keyed to $HOME.
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nbr-home-'))
    try {
      // User-level settings file (would be ~/.claude/settings.json in real life).
      fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true })
      fs.writeFileSync(
        path.join(tmpHome, '.claude', 'settings.json'),
        JSON.stringify({ 'nearest-neighbor@nearest-neighbor': true }),
      )
      // Project dir inside the fake HOME with NO settings files of its own.
      const projDir = path.join(tmpHome, 'proj')
      fs.mkdirSync(projDir, { recursive: true })

      const nbrWrapper = path.join(installDir, 'nbr')
      const { code, stdout } = await spawn(nbrWrapper, ['--print-config-dir'], {
        CLAUDE_PROJECT_DIR: projDir,
        HOME: tmpHome,
      })

      expect(code).toBe(0)
      // Must resolve to GLOBAL path — not under agents/, not keyed to tmpHome.
      expect(stdout.trim()).toBe(path.join(tmpDir, 'nbr'))
      expect(stdout.trim()).not.toContain('/agents/')
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it('second run is idempotent — skips reinstall when version matches', async () => {
    const { code, stdout } = await spawn('sh', [SCRIPT, installDir], {
      NBR_LOCAL_BIN: fakeBin,
      NBR_VERSION,
    })

    expect(code).toBe(0)
    // Idempotency message is emitted before the local-bin path is reached
    expect(stdout).toContain('already installed')
    expect(stdout).toContain('Skipping')
  })
})

describe('install-nbr.sh — --wrapper-only mode', () => {
  it('writes an executable nbr wrapper, no .nbr-real, exits 0, no network call', async () => {
    const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbr-wrapper-only-'))
    try {
      // No NBR_VERSION, no NBR_LOCAL_BIN — wrapper-only must skip version resolution
      // and the network entirely and just write the wrapper script.
      const { code, stderr } = await spawn('sh', [SCRIPT, '--wrapper-only', wrapperDir], {})

      expect(code).toBe(0)

      // Wrapper must exist and be executable
      const wrapper = path.join(wrapperDir, 'nbr')
      const wrapperStat = fs.statSync(wrapper)
      expect(wrapperStat.isFile()).toBe(true)
      // Owner-execute bit set
      expect(wrapperStat.mode & 0o100).toBeTruthy()

      // .nbr-real must NOT be created (binary is untouched)
      expect(fs.existsSync(path.join(wrapperDir, '.nbr-real'))).toBe(false)

      // Confirmation notice emitted to stderr
      expect(stderr).toContain('wrapper refreshed')
    } finally {
      fs.rmSync(wrapperDir, { recursive: true, force: true })
    }
  })
})

describe('install-nbr.sh — version resolution', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8')

  it('does not pin a hardcoded download version (regression: stranded on v0.1.0)', () => {
    expect(src).not.toContain('NBR_VERSION:-0.1.0')
  })

  it('resolves the latest release tag from the GitHub releases API', () => {
    expect(src).toContain('api.github.com/repos/')
    expect(src).toContain('tag_name')
  })
})
