# Plugin install e2e tests

Containerized in-harness tests that prove each AI agent plugin harness (Claude
Code, Codex, Hermes) can install the **nearest-neighbor** plugin from the
**local repo** (not from a published release), register it, and — for Claude —
fire the real `SessionStart` hook against an `nbr` binary built from HEAD.

No model API keys are required. No published `nbr` release is required.

---

## Design

### What is tested

| Harness | Install method                                                                              | Verification                                         | Hook fired                                            |
| ------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Claude  | `claude plugin marketplace add` + `claude plugin install nearest-neighbor@nearest-neighbor` | `claude plugin list --json \| grep nearest-neighbor` | `claude --init-only` (best-effort; see uncertainties) |
| Codex   | `codex plugin marketplace add` + `codex plugin add nearest-neighbor`                        | `codex plugin list --json \| grep nearest-neighbor`  | None (needs model key)                                |
| Hermes  | Copy `plugins/hermes` → `/opt/data/plugins/nearest-neighbor` + `hermes plugins enable`      | `hermes plugins list \| grep nearest-neighbor`       | None (needs model key)                                |

### nbr build from HEAD

Because there is no published GitHub Release for `nbr` yet, `run.sh` builds the
binary from source before any container test runs:

1. `Dockerfile.nbr-builder` compiles `apps/cli` using `rust:1-slim` with
   `musl-tools` for a statically-linked `x86_64-unknown-linux-musl` (or
   `aarch64-unknown-linux-musl`) binary.
2. BuildKit `--mount=type=cache` keeps the `cargo` registry and incremental
   `target/` directory warm across rebuilds.
3. `run.sh` extracts the binary via `docker create` + `docker cp` and stores it
   in a temp directory, which is then bind-mounted read-only into the Claude
   container at `/opt/nbr-local`.
4. `entrypoint.claude.sh` uses it to pre-populate the plugin data dir so that
   `install-nbr.sh`'s idempotency check fires, bypassing the GitHub download.

### Container isolation

Each test run uses `docker run --rm` with isolated temp directories:

- The repo root is bind-mounted **read-only** at `/repo` inside each container.
- Plugin caches write to the container's writable `/root` (default HOME).
- The Hermes data dir (`/opt/data`) is a fresh writable temp mount so plugin
  state never leaks between runs.
- All locally built images are removed on exit (unless `KEEP_IMAGES=1`).

### Defensive probe pattern

Each entrypoint script probes `--help` output of the CLI **before** calling
subcommands, rather than hardcoding exact forms. This handles beta / pre-release
CLIs where a subcommand may be named differently than the final spec says.

---

## How to run

### Prerequisites

- Docker with BuildKit (Docker 23+, or `DOCKER_BUILDKIT=1`)
- Internet access (pulls base images, installs CLI tools)
- The repo checked out locally (build context is repo root)

### Full test suite (all harnesses)

```sh
mise run test:plugins:harness
```

Or directly:

```sh
cd e2e/plugin-install
./run.sh
```

### Single harness

```sh
HARNESS=claude mise run test:plugins:harness
HARNESS=codex  mise run test:plugins:harness
HARNESS=hermes mise run test:plugins:harness

# Or via per-harness aliases:
mise run test:plugins:harness:claude
mise run test:plugins:harness:codex
mise run test:plugins:harness:hermes
```

### Staging smoke test

```sh
NBR_API_URL=https://api.nearest-neighbor-staging.fly.dev mise run smoke:plugins:staging
```

The staging run passes `NBR_API_URL` into the containers so that any live API
calls (e.g. `nbr status`) hit staging instead of production.

### Environment variables

| Variable      | Default        | Description                                             |
| ------------- | -------------- | ------------------------------------------------------- |
| `HARNESS`     | `all`          | Which harness(es) to test: `claude\|codex\|hermes\|all` |
| `NBR_API_URL` | _(production)_ | Override API base URL; set to staging for smoke tests   |
| `REPO_ROOT`   | auto-detected  | Repo root path (auto-detected from script location)     |
| `KEEP_IMAGES` | `0`            | Set to `1` to skip cleanup of built Docker images       |

### Docker not available

If `docker info` fails (Docker not running), `run.sh` prints a notice and exits
**0** (graceful skip). This mirrors the `db:migrate:check` pattern so CI jobs
without Docker don't hard-fail.

---

## Files

| File                     | Purpose                                                               |
| ------------------------ | --------------------------------------------------------------------- |
| `run.sh`                 | Orchestrator: builds nbr, builds images, runs each harness, cleans up |
| `Dockerfile.nbr-builder` | Multi-stage Rust builder for the `nbr` CLI (musl static binary)       |
| `Dockerfile.claude`      | `debian:bookworm-slim` + official Claude Code CLI installer           |
| `Dockerfile.codex`       | `node:22-slim` + `npm install -g @openai/codex@latest`                |
| `entrypoint.claude.sh`   | Claude install + verify + `--init-only` hook test                     |
| `entrypoint.codex.sh`    | Codex install + verify                                                |
| `entrypoint.hermes.sh`   | Hermes copy-install + enable + verify (runs inside prebuilt image)    |

Hermes needs no custom Dockerfile because the test uses the prebuilt
`nousresearch/hermes-agent:latest` image with a bind-mounted entrypoint.

---

## Known uncertainties (coordinator must validate live)

These items were marked uncertain at authoring time. Each is tagged with a
`[U#]` reference in the corresponding entrypoint script.

| ID  | Topic                                                              | What we do                                                        | What to check                                                                                  |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| U1  | `claude plugin marketplace add <path>`                             | Probe `claude plugin --help`; skip gracefully if absent           | Confirm the exact form works in the released CLI                                               |
| U2  | `claude plugin install nearest-neighbor@nearest-neighbor` vs `add` | Try `install` first, fall back to `add`                           | Confirm `@marketplace-name` scope format is accepted                                           |
| U3  | `claude --init-only` flag                                          | Probe `claude --help`; attempt regardless; 30s timeout            | Confirm the flag exists and fires `SessionStart` hooks without a model key                     |
| U4  | SessionStart hook output capture                                   | Check stdout + stderr + `~/.claude` transcript files              | Confirm where `claude --init-only` surfaces `hookSpecificOutput`; adjust search path if needed |
| U5  | `codex plugin marketplace add`                                     | Probe `codex plugin --help`; skip gracefully if absent            | Confirm correct form for registering a local marketplace                                       |
| U6  | `codex plugin add` vs `install` + `--non-interactive`              | Try `add` first (official docs), then `install --non-interactive` | Confirm which verb is present in the released build                                            |
| U7  | `--json` flag on codex plugin subcommands                          | Fall back to plain output if `--json` errors                      | Confirm `--json` is accepted; adjust parse logic if output format differs                      |
| U8  | `codex doctor`                                                     | Optional; non-fatal if absent                                     | Confirm whether `codex doctor` exists and is useful                                            |
| U9  | Hermes s6-overlay bypass                                           | Override `--entrypoint` to skip `/init` entirely                  | Confirm bypassing s6 doesn't break `hermes` CLI invocation (env vars, config)                  |
| U10 | Hermes venv path                                                   | Probe 4 candidate paths; fall back to PATH                        | Confirm `/opt/hermes/.venv/bin/hermes` is the actual location in the image                     |
| U11 | `hermes plugins enable <name>`                                     | Probe `hermes plugins --help`; skip if absent                     | Confirm enable subcommand name; check if copy-only is sufficient (auto-enable on startup)      |
| U12 | `HERMES_PLUGINS_DEBUG=1` debug output                              | Check stderr for registration evidence                            | Confirm the env var is recognised; check alternate debug flags if not                          |

---

## Coordinator: exact docker commands to validate locally

### Build nbr from HEAD

```sh
cd <repo-root>
DOCKER_BUILDKIT=1 docker build \
  --file e2e/plugin-install/Dockerfile.nbr-builder \
  --tag nn-nbr-builder:local \
  .
# Extract binary:
ctr=$(docker create nn-nbr-builder:local)
docker cp "${ctr}:/nbr" /tmp/nbr-local
docker rm "${ctr}"
file /tmp/nbr-local
```

### Claude harness only

```sh
cd e2e/plugin-install
docker build --file Dockerfile.claude --tag nn-plugin-test-claude:local .
docker run --rm \
  --volume "$(pwd)/../..:/repo:ro" \
  --volume "/tmp/nbr-local:/opt/nbr-local:ro" \
  --env REPO_ROOT=/repo \
  --env NBR_LOCAL_BIN=/opt/nbr-local \
  nn-plugin-test-claude:local
```

### Codex harness only

```sh
cd e2e/plugin-install
docker build --file Dockerfile.codex --tag nn-plugin-test-codex:local .
docker run --rm \
  --volume "$(pwd)/../..:/repo:ro" \
  --env REPO_ROOT=/repo \
  nn-plugin-test-codex:local
```

### Hermes harness only

```sh
cd e2e/plugin-install
docker pull nousresearch/hermes-agent:latest
docker run --rm \
  --entrypoint /entrypoint.hermes.sh \
  --volume "$(pwd)/../..:/repo:ro" \
  --volume "$(pwd)/entrypoint.hermes.sh:/entrypoint.hermes.sh:ro" \
  --volume "/tmp/hermes-test-data:/opt/data" \
  --env REPO_ROOT=/repo \
  --env DATA_DIR=/opt/data \
  nousresearch/hermes-agent:latest
```

---

## Expected mise task wiring (coordinator adds these to `mise.toml`)

The coordinator will add the following tasks after this branch is merged. They
are **not** added by this task (scope discipline — this task only creates the
`e2e/plugin-install/` files).

| Task name                     | Command                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `test:plugins:harness`        | `HARNESS=all bash e2e/plugin-install/run.sh`                                                          |
| `test:plugins:harness:claude` | `HARNESS=claude bash e2e/plugin-install/run.sh`                                                       |
| `test:plugins:harness:codex`  | `HARNESS=codex bash e2e/plugin-install/run.sh`                                                        |
| `test:plugins:harness:hermes` | `HARNESS=hermes bash e2e/plugin-install/run.sh`                                                       |
| `smoke:plugins:staging`       | `HARNESS=all NBR_API_URL=https://api.nearest-neighbor-staging.fly.dev bash e2e/plugin-install/run.sh` |
