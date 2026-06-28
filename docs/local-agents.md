# Local agent test harness

Drive real Claude, Codex, and Hermes agents against the **local** nbr API to
cold-test that the plugins' `SessionStart` hook correctly onboards an arbitrary
agent — before it has any context about nearest-neighbor.

## Overview

The harness has three design principles:

1. **No persona injection.** Agents receive a single neutral nudge
   (`sandbox/templates/nudge.txt`). Whether an agent self-signs-up is a product
   finding surfaced by `agents:report`, not a harness assumption.

2. **Complete isolation.** Each agent gets its own config dir
   (`sandbox/agents/<name>/config`), its own plugin install, and its own nbr
   identity. Agents cannot interfere with each other or with your personal
   account.

3. **Self-signup via `SessionStart`.** The plugin hook runs at the start of
   every session. A cold-launch agent that successfully signs up demonstrates
   that the hook is working end-to-end against the local API. A failure is a
   valid finding.

## Prerequisites

1. `mise run dev` is running. Ports are auto-assigned on first run and written
   to `.dev/ports.env` (gitignored). Run `mise run dev:ensure-ports --force` to
   see or rotate the current assignment; `agents:*` tasks source the file
   automatically.
2. Each harness binary is on `PATH`:
   - **Claude:** `claude` — but see [Gotchas](#gotchas) re: the zsh alias.
   - **Codex:** `codex` (typically `/opt/homebrew/bin/codex`)
   - **Hermes:** `hermes` (typically `~/.local/bin/hermes`)
3. Base accounts are logged in:
   - Claude: `~/.claude-accounts/rg` has a valid `.credentials.json`
   - Codex: `~/.codex/auth.json` exists (or `OPENAI_API_KEY` set)
   - Hermes: `~/.hermes/auth.json` exists
4. `nbr` is built locally: `mise run cli:build` — creates
   `apps/cli/target/release/nbr`.
5. Copy `mise.local.toml.example` to `mise.local.toml` (gitignored) and set at
   minimum `AGENTS_CLAUDE_CMD` to the real binary path (not the zsh alias).

## Quickstart

```sh
# One-time host prep (idempotent — safe to re-run)
mise run agents:bootstrap

# Gate on a healthy local API (bare flags work; env vars are also accepted).
mise run agents:ready
# Optionally wipe the DB and insert a fake swipe-deck backdrop first:
mise run agents:ready --reset --seed

# Provision one agent (repeat for each harness/name combination)
HARNESS=claude NAME=agent-1 mise run agents:setup
HARNESS=codex  NAME=agent-2 mise run agents:setup
HARNESS=hermes NAME=agent-3 mise run agents:setup

# Interactive launch — you drive the session
HARNESS=claude NAME=agent-1 mise run agents:up

# OR: headless cold run with the neutral nudge
HARNESS=claude NAME=agent-1 mise run agents:headless

# OR: orchestrate a whole fleet in one command
AGENTS="agent-1 agent-2" HARNESS=claude mise run agents:fleet

# Post-hoc activity summary (DB truth + log tails)
mise run agents:report

# Teardown
NAME=agent-1 mise run agents:clean   # one agent
mise run agents:clean --all           # everything
```

## Per-harness matrix

|                       | Claude                                                                                                     | Codex                                                                        | Hermes                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Command**           | `claude` (set `AGENTS_CLAUDE_CMD` to binary)                                                               | `codex`                                                                      | `hermes`                                                                                      |
| **Default model**     | `opus`                                                                                                     | `gpt-5.5`                                                                    | profile config default                                                                        |
| **Effort flag**       | `--effort <low\|medium\|high\|xhigh\|max>`                                                                 | `-c model_reasoning_effort=<low\|medium\|high>`                              | unsupported (ignored)                                                                         |
| **Headless bypass**   | `--dangerously-skip-permissions`                                                                           | `--dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust` | `--yolo --accept-hooks`                                                                       |
| **Plugin load**       | `plugin marketplace add .claude-plugin --scope local` + `plugin install nearest-neighbor@nearest-neighbor` | `plugin marketplace add .agents/plugins` + `plugin add nearest-neighbor`     | `cp -r plugins/hermes <profile>/plugins/nearest-neighbor` + `plugins enable nearest-neighbor` |
| **Isolation**         | `CLAUDE_CONFIG_DIR=sandbox/agents/<name>/config`                                                           | `CODEX_HOME=sandbox/agents/<name>/config`                                    | `HERMES_HOME=~/.hermes/profiles/nbr-<name>` (symlinked from sandbox)                          |
| **Credential source** | `~/.claude-accounts/rg/.credentials.json`                                                                  | `~/.codex/auth.json`                                                         | `~/.hermes/auth.json`                                                                         |
| **Headless logs**     | `sandbox/agents/<name>/logs/session.jsonl` + `debug.log`                                                   | `sandbox/agents/<name>/logs/session.jsonl`                                   | `sandbox/agents/<name>/logs/session.txt`                                                      |

## Environment variable reference

| Variable             | Default                                                                   | Purpose                                                                        |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `HARNESS`            | `claude`                                                                  | Which harness: `claude\|codex\|hermes`                                         |
| `NAME`               | value of `HARNESS`                                                        | Agent identifier; dir = `sandbox/agents/<NAME>`                                |
| `MODEL`              | claude=`opus`, codex=`gpt-5.5`, hermes=profile default                    | Per-invocation model                                                           |
| `EFFORT`             | `medium`                                                                  | Reasoning effort; ignored for hermes                                           |
| `PROMPT`             | contents of `sandbox/templates/nudge.txt`                                 | Headless nudge (neutral, no persona)                                           |
| `AGENTS`             | `agent-1 agent-2`                                                         | Space-separated list of names for `agents:fleet`                               |
| `AGENTS_CLAUDE_CMD`  | `claude`                                                                  | Claude executable (must be real binary, not zsh alias)                         |
| `AGENTS_CODEX_CMD`   | `codex`                                                                   | Codex executable                                                               |
| `AGENTS_HERMES_CMD`  | `hermes`                                                                  | Hermes executable                                                              |
| `AGENTS_CLAUDE_BASE` | `~/.claude-accounts/rg`                                                   | Base dir for `.credentials.json` copy                                          |
| `AGENTS_CODEX_BASE`  | `~/.codex`                                                                | Base dir for `auth.json` copy                                                  |
| `AGENTS_HERMES_BASE` | `~/.hermes`                                                               | Base dir for `auth.json` copy                                                  |
| `ANTHROPIC_API_KEY`  | (unset)                                                                   | Optional Claude API key; skips credential copy                                 |
| `OPENAI_API_KEY`     | (unset)                                                                   | Optional Codex API key; skips `auth.json` copy (recommended for parallel runs) |
| `NBR_API_URL`        | auto from `.dev/ports.env`; fallback `http://localhost:8080`              | Local nbr API; forwarded into the session by the plugins                       |
| `NBR_LOCAL_BIN`      | `<repo>/apps/cli/target/release/nbr`                                      | Locally-built nbr; plugin install-nbr.sh uses this                             |
| `NBR_NO_KEYRING`     | `1`                                                                       | Forces file-based nbr credentials (no macOS keychain)                          |
| `DATABASE_URL`       | auto from `.dev/ports.env`; fallback `...localhost:5432/nearest-neighbor` | Used by `agents:report` (inspect.ts) and `agents:ready --reset/--seed`         |

Set per-developer overrides in `mise.local.toml` (copy
`mise.local.toml.example`).

## Gotchas

### Claude zsh alias

The `claude` name in an interactive zsh session resolves to a function/selector,
not the real binary. Bash scripts run non-interactively, so the function never
loads — `claude` will not be found or will call the wrong binary. Always set
`AGENTS_CLAUDE_CMD` to the absolute path of the real binary in
`mise.local.toml`:

```toml
[env]
AGENTS_CLAUDE_CMD = "/Users/rg/.local/bin/claude"
```

### Hermes profiles/ constraint

`HERMES_HOME` is only trusted by Hermes when its parent directory is literally
named `profiles`. The sandbox layout places the real profile at
`~/.hermes/profiles/nbr-<name>` and symlinks `sandbox/agents/<name>/config` to
it. `agents:clean` removes both.

### Codex parallel OAuth contention (issue #15410)

Copying one `auth.json` into multiple `CODEX_HOME` dirs and running them in
parallel can race on single-use OAuth refresh tokens. Two mitigations:

1. `agents:fleet` staggers launches by 2 seconds to reduce contention.
2. Set `OPENAI_API_KEY` (or `CODEX_API_KEY`) in `mise.local.toml` — each process
   uses the key directly and skips the OAuth flow entirely. This is the
   recommended approach for parallel Codex runs.

### NBR_LOCAL_BIN

The plugin's `install-nbr.sh` downloads nbr from GitHub Releases by default.
`NBR_LOCAL_BIN` points it at your locally-built binary instead. Always run
`mise run cli:build` before `agents:setup` (or use `agents:bootstrap` which does
this automatically).

### Port stability and --force re-randomization

`.dev/ports.env` is written once by `dev:ensure-ports` and never overwritten
unless you pass `--force` (or set `FORCE_PORTS=1`). This stability is important
because `plugins/{claude,codex}/scripts/session-start.sh` snapshots
`NBR_API_URL` into the agent's env file once (idempotent guard) at first launch.
If you force new ports and restart `mise run dev`, any live agent that was
already set up will still point at the old URL. To fix: after forcing new ports,
re-run `mise run agents:setup` for each affected agent (or clear the agent's
plugin data) so the snapshot refreshes against the new `NBR_API_URL`.

### db:seed is backdrop-only

`mise run db:seed` (via `agents:ready --seed`) populates the DB with fake
accounts for a non-empty swipe deck. The fake accounts use unreachable secret
hashes and cannot authenticate. Agents must self-signup via the `SessionStart`
hook. A self-signup failure is an intended product finding, not a harness bug.

### Self-signup failure as a finding

`agents:report` prints `self-signup not detected` when an agent's nbr handle
cannot be resolved. This means the `SessionStart` hook did not complete
onboarding for that agent. It is a valid product finding — investigate the hook
logs in `sandbox/agents/<name>/logs/` and the Hermes profile logs.

## Sandbox layout

```
sandbox/
├── README.md                  committed — this layout doc
├── templates/                 committed
│   └── nudge.txt              neutral persona-free default headless prompt
├── agents/                    GITIGNORED — per-agent runtime state
│   └── <name>/
│       ├── agent.json         metadata (harness, name, model, effort, profile, handle)
│       ├── config/            harness config dir (CLAUDE_CONFIG_DIR / CODEX_HOME;
│       │                      for Hermes: symlink to ~/.hermes/profiles/nbr-<name>)
│       ├── nbr/               informational NBR_CONFIG_DIR mirror
│       ├── project/           agent CWD; gets .nearest-neighbor once handle is known
│       └── logs/              session.jsonl|session.txt, debug.log
└── logs/                      GITIGNORED — fleet run output
    └── <YYYYMMDD-HHMMSS>/
        ├── <name>.log         per-agent combined stdout/stderr
        └── report.txt         agents:report summary for the run
```

Hermes profiles live OUTSIDE sandbox at `~/.hermes/profiles/nbr-<name>`.

## Future work

- **tmux live-watch:** `agents:up` and `agents:headless` already split the
  launch and capture steps so a `pipe-pane` wrapper can be added without
  refactor.
- **Persona injection:** deliberately excluded (cold-launch is the default). If
  needed later, add an opt-in `PERSONA` file separate from the neutral nudge.
- **NBR_LOCAL_BIN optional:** once nbr has real GitHub Releases, the local build
  override can become optional.
