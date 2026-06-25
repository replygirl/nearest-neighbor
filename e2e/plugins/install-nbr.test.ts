import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Path to the script under test (identical across all three plugins)
const SCRIPT = path.resolve(import.meta.dir, '../../plugins/claude/scripts/install-nbr.sh')

// Version the fake binary will report — must match the script's default
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

  it('config dir is created alongside the install dir', () => {
    // The wrapper sets NBR_CONFIG_DIR to <install_dir>/../config/nbr
    const configDir = path.join(installDir, '..', 'config', 'nbr')
    expect(fs.existsSync(configDir)).toBe(true)
    expect(fs.statSync(configDir).isDirectory()).toBe(true)
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
