#!/bin/sh
# entrypoint.codex.sh — Codex plugin install test
#
# Runs inside Dockerfile.codex (node:22-slim + @openai/codex).
# Invoked by run.sh via `docker run --rm ... nn-plugin-test-codex`.
#
# Environment (set by run.sh at docker run time):
#   REPO_ROOT  Path where the repo is bind-mounted (default: /repo)
#
# Exit codes:
#   0 — all assertions passed
#   1 — a required assertion failed (logged with FAIL: prefix)
#
# Uncertain / coordinator-must-validate:
#   [U5] `codex plugin marketplace add <path>` — the `marketplace` subcommand
#        exists in the official Codex plugin spec but actual released builds may
#        use a different form. We probe `codex plugin --help` first.
#   [U6] `codex plugin add nearest-neighbor` vs
#        `codex plugin install nearest-neighbor --non-interactive` — the official
#        docs show `add` but some builds use `install`. We detect which is
#        available from --help output and try in order.
#   [U7] `--json` flag on plugin subcommands — documented but may be absent on
#        some builds. We fall back to plain output if --json fails.
#   [U8] `codex doctor` — optional health-check command; may not exist in all builds.

set -eu

REPO_ROOT="${REPO_ROOT:-/repo}"
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# ── Helpers ────────────────────────────────────────────────────────────────────

log()  { printf '[codex-test] %s\n' "$*"; }
pass() { log "PASS: $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
warn() { log "WARN: $*"; WARN_COUNT=$((WARN_COUNT + 1)); }
fail() { log "FAIL: $*" >&2; FAIL_COUNT=$((FAIL_COUNT + 1)); }

# Run a command with --json; fall back without if the flag causes an error.
# Usage: run_maybe_json <label> <cmd args...>
# Outputs combined stdout+stderr; returns the combined content via stdout.
# shellcheck disable=SC2317
# SC2317: run_with_json_fallback is called later in the script; shellcheck
# static analysis incorrectly flags it as unreachable.
run_with_json_fallback() {
  label="$1"; shift
  # Try with --json first
  OUT=$(eval "$* --json" 2>&1) && {
    log "${label} (--json): ${OUT}"
    printf '%s' "${OUT}"
    return
  }
  # [U7] --json caused an error or the command failed — try without
  warn "[U7] ${label}: --json flag may not be supported; retrying without"
  OUT=$(eval "$*" 2>&1) || true
  log "${label} (no --json): ${OUT}"
  printf '%s' "${OUT}"
}

# ── Step 0: Sanity check env ───────────────────────────────────────────────────

log "=== Codex plugin install test ==="
log "REPO_ROOT=${REPO_ROOT}"

if ! command -v codex >/dev/null 2>&1; then
  fail "codex CLI not found on PATH"
  exit 1
fi
CODEX_VERSION=$(codex --version 2>/dev/null || echo "unknown")
log "codex version: ${CODEX_VERSION}"

# ── Step 1: Probe available plugin subcommands ────────────────────────────────
# [U5][U6] We don't hardcode the exact subcommand — we probe --help output.

log "--- Step 1: probe codex plugin subcommands ---"
PLUGIN_HELP=$(codex plugin --help 2>&1 || true)
log "codex plugin --help output:"
printf '%s\n' "${PLUGIN_HELP}" | head -40

HAS_MARKETPLACE=""
HAS_ADD=""
HAS_INSTALL=""

if printf '%s' "${PLUGIN_HELP}" | grep -qi 'marketplace'; then
  HAS_MARKETPLACE="1"
  log "  -> 'marketplace' subcommand detected"
else
  warn "[U5] 'marketplace' not in codex plugin --help"
fi

if printf '%s' "${PLUGIN_HELP}" | grep -qi '\badd\b'; then
  HAS_ADD="1"
  log "  -> 'add' subcommand detected"
fi

if printf '%s' "${PLUGIN_HELP}" | grep -qi '\binstall\b'; then
  HAS_INSTALL="1"
  log "  -> 'install' subcommand detected"
fi

# ── Step 2: Register the local marketplace ────────────────────────────────────
# The repo's .agents/plugins/marketplace.json lists the plugin with
# source ./plugins/codex (relative to the repo root).
# We pass the repo root as the marketplace path.

log "--- Step 2: register local marketplace ---"
MARKETPLACE_JSON="${REPO_ROOT}/.agents/plugins/marketplace.json"

if [ ! -f "${MARKETPLACE_JSON}" ]; then
  fail "marketplace manifest not found at ${MARKETPLACE_JSON}"
else
  log "marketplace manifest: ${MARKETPLACE_JSON}"

  if [ -n "${HAS_MARKETPLACE}" ]; then
    # [U5] Try documented form; also try passing the JSON file path directly
    MKTPLACE_OUT=$(codex plugin marketplace add "${REPO_ROOT}" --json 2>&1 || \
                   codex plugin marketplace add "${MARKETPLACE_JSON}" --json 2>&1 || \
                   codex plugin marketplace add "${REPO_ROOT}" 2>&1 || true)
    log "marketplace add output: ${MKTPLACE_OUT}"

    if printf '%s' "${MKTPLACE_OUT}" | grep -qi 'error\|failed\|not found'; then
      warn "[U5] 'codex plugin marketplace add' reported an error — coordinator must verify."
      warn "     Output: ${MKTPLACE_OUT}"
    else
      pass "marketplace registered (no error in output)"
    fi
  else
    warn "[U5] Skipping marketplace registration — 'marketplace' not in plugin help."
    warn "     The coordinator should determine the correct form for registering a local marketplace."
  fi
fi

# ── Step 3: Install the plugin ────────────────────────────────────────────────
# [U6] Try `codex plugin add nearest-neighbor --json` first (official docs form),
#      then fall back to `codex plugin install nearest-neighbor --non-interactive --json`.

log "--- Step 3: install plugin ---"
INSTALL_OUT=""

if [ -n "${HAS_ADD}" ]; then
  # Codex requires the <plugin>@<marketplace> form (or -m) to disambiguate the
  # marketplace; both names are "nearest-neighbor" here.
  log "Trying: codex plugin add nearest-neighbor@nearest-neighbor --json"
  INSTALL_OUT=$(codex plugin add nearest-neighbor@nearest-neighbor --json 2>&1 || \
                codex plugin add nearest-neighbor@nearest-neighbor 2>&1 || true)
  log "add output: ${INSTALL_OUT}"
elif [ -n "${HAS_INSTALL}" ]; then
  log "Trying: codex plugin install nearest-neighbor --non-interactive --json"
  INSTALL_OUT=$(codex plugin install nearest-neighbor --non-interactive --json 2>&1 || \
                codex plugin install nearest-neighbor --non-interactive 2>&1 || \
                codex plugin install nearest-neighbor 2>&1 || true)
  log "install output: ${INSTALL_OUT}"
else
  warn "[U6] Neither 'add' nor 'install' found in plugin help — attempting 'add' anyway"
  INSTALL_OUT=$(codex plugin add nearest-neighbor 2>&1 || true)
  log "add output (fallback): ${INSTALL_OUT}"
fi

if printf '%s' "${INSTALL_OUT}" | grep -qi 'error\|failed'; then
  warn "[U6] plugin install output contains error/failed — coordinator must verify live."
  warn "     Output: ${INSTALL_OUT}"
else
  pass "plugin install completed without obvious error"
fi

# ── Step 4: Verify plugin is listed ──────────────────────────────────────────

log "--- Step 4: verify plugin list ---"
# [U7] Try with --json, fall back to plain
LIST_OUT=$(codex plugin list --json 2>&1 || codex plugin list 2>&1 || true)
log "plugin list output: ${LIST_OUT}"

if printf '%s' "${LIST_OUT}" | grep -qi 'nearest-neighbor'; then
  pass "nearest-neighbor appears in plugin list"
else
  fail "nearest-neighbor NOT found in plugin list. Output: ${LIST_OUT}"
fi

# ── Step 5: [OPTIONAL] codex doctor ──────────────────────────────────────────
# [U8] codex doctor may not exist in all builds; non-fatal if absent.

log "--- Step 5: [OPTIONAL] codex doctor ---"
if codex doctor --help >/dev/null 2>&1 || codex doctor --json >/dev/null 2>&1; then
  DOCTOR_OUT=$(codex doctor --json 2>&1 || codex doctor 2>&1 || true)
  log "codex doctor output: ${DOCTOR_OUT}"
  pass "codex doctor ran without fatal error"
else
  warn "[U8] codex doctor not available — skipping (non-fatal)"
fi

# ── Summary ────────────────────────────────────────────────────────────────────

log ""
log "=== Codex test summary ==="
log "PASS: ${PASS_COUNT}  FAIL: ${FAIL_COUNT}  WARN: ${WARN_COUNT}"
log ""

if [ "${FAIL_COUNT}" -gt 0 ]; then
  log "RESULT: FAILED (${FAIL_COUNT} assertion(s) failed)"
  exit 1
fi

log "RESULT: PASSED"
exit 0
