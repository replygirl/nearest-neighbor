#!/bin/sh
# entrypoint.claude.sh — Claude plugin install + SessionStart hook test
#
# Runs inside Dockerfile.claude (debian-slim + claude CLI).
# Invoked by run.sh via `docker run --rm ... nn-plugin-test-claude`.
#
# Environment (set by run.sh at docker run time):
#   REPO_ROOT      Path where the repo is bind-mounted (default: /repo)
#   NBR_LOCAL_BIN  Path to the head-built nbr binary inside the container
#                  (bind-mounted by run.sh; install-nbr.sh honours it to bypass
#                  the GitHub download so we exercise the plugin against HEAD)
#   NBR_API_URL    Optional API base URL (staging smoke); defaults to an
#                  unreachable address so `nbr status` fails fast → the hook
#                  deterministically takes the unauthenticated onboarding path.
#
# Exit codes:
#   0 — all assertions passed
#   1 — a required assertion failed (logged with FAIL: prefix)
#
# What we verify (no model API key, no published nbr release):
#   1. claude plugin marketplace add (local path) + claude plugin install register
#      the plugin (claude plugin list shows it).
#   2. `claude --init-only` initialises cleanly with the plugin installed.
#   3. The plugin AS CLAUDE INSTALLED IT (from ~/.claude/plugins/cache) runs its
#      session-start.sh against the HEAD-built nbr and emits valid onboarding
#      context. `claude --init-only` does NOT surface SessionStart
#      additionalContext anywhere capturable, so we invoke the installed hook
#      script directly — this is a real end-to-end check of plugin + nbr.

set -eu

REPO_ROOT="${REPO_ROOT:-/repo}"
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# ── Helpers ────────────────────────────────────────────────────────────────────

log()  { printf '[claude-test] %s\n' "$*"; }
pass() { log "PASS: $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
warn() { log "WARN: $*"; WARN_COUNT=$((WARN_COUNT + 1)); }
fail() { log "FAIL: $*" >&2; FAIL_COUNT=$((FAIL_COUNT + 1)); }

# ── Step 0: Sanity check env ───────────────────────────────────────────────────

log "=== Claude plugin install test ==="
log "REPO_ROOT=${REPO_ROOT}"
log "NBR_LOCAL_BIN=${NBR_LOCAL_BIN:-<not set>}"

if ! command -v claude >/dev/null 2>&1; then
  fail "claude CLI not found on PATH"
  exit 1
fi
CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
log "claude version: ${CLAUDE_VERSION}"

# ── Step 1: Register the local marketplace ────────────────────────────────────
# The repo's .claude-plugin/marketplace.json lists the plugin with
# source ./plugins/claude (relative to the repo root). Pass the repo root.

log "--- Step 1: register local marketplace ---"
MARKETPLACE_JSON="${REPO_ROOT}/.claude-plugin/marketplace.json"

if [ ! -f "${MARKETPLACE_JSON}" ]; then
  fail "marketplace manifest not found at ${MARKETPLACE_JSON}"
else
  MARKETPLACE_OUT=$(claude plugin marketplace add "${REPO_ROOT}" 2>&1 || true)
  log "marketplace add output: ${MARKETPLACE_OUT}"
  if printf '%s' "${MARKETPLACE_OUT}" | grep -qiE 'error|failed|not found'; then
    fail "claude plugin marketplace add reported an error: ${MARKETPLACE_OUT}"
  else
    pass "marketplace registered"
  fi
fi

# ── Step 2: Install the plugin ────────────────────────────────────────────────
# Official form: claude plugin install <plugin>@<marketplace>.

log "--- Step 2: install plugin ---"
INSTALL_OUT=$(claude plugin install nearest-neighbor@nearest-neighbor 2>&1 || true)
log "install output: ${INSTALL_OUT}"
if printf '%s' "${INSTALL_OUT}" | grep -qiE 'error|failed'; then
  fail "claude plugin install reported an error: ${INSTALL_OUT}"
else
  pass "plugin install completed"
fi

# ── Step 3: Verify plugin is listed ──────────────────────────────────────────

log "--- Step 3: verify plugin list ---"
LIST_OUT=$(claude plugin list --json 2>&1 || claude plugin list 2>&1 || true)
log "plugin list output: ${LIST_OUT}"

if printf '%s' "${LIST_OUT}" | grep -qi 'nearest-neighbor'; then
  pass "nearest-neighbor appears in plugin list"
else
  fail "nearest-neighbor NOT found in plugin list. Output: ${LIST_OUT}"
fi

# Claude reports per-plugin hook-load errors in `plugin list`. A manifest that
# references the auto-loaded hooks/hooks.json triggers "Duplicate hooks file
# detected" and the SessionStart/Stop hooks silently fail to load in real
# sessions. Assert the installed plugin loads its hooks cleanly.
if printf '%s' "${LIST_OUT}" | grep -qiE 'hook load failed|duplicate hooks'; then
  fail "plugin reports a hook-load error (does plugin.json reference the auto-loaded hooks.json?): ${LIST_OUT}"
else
  pass "no hook-load errors reported for the installed plugin"
fi

# ── Step 4: claude --init-only smoke ──────────────────────────────────────────
# --init-only initialises config + the plugin cache without a model call. It does
# NOT surface SessionStart additionalContext, so this is only a "boots cleanly
# with the plugin installed" smoke; Step 5 exercises the hook for real.

log "--- Step 4: claude --init-only smoke ---"
INIT_EXIT=0
if command -v timeout >/dev/null 2>&1; then
  timeout 60 claude --init-only >/dev/null 2>&1 || INIT_EXIT=$?
else
  claude --init-only >/dev/null 2>&1 || INIT_EXIT=$?
fi
if [ "${INIT_EXIT}" = "0" ]; then
  pass "claude --init-only completed cleanly (exit 0) with the plugin installed"
else
  warn "claude --init-only exited ${INIT_EXIT} (non-fatal; --init-only behaviour varies by build)"
fi

# ── Step 5: Run the INSTALLED hook against the HEAD-built nbr ──────────────────
# Exercise the plugin exactly as Claude installed it (from the plugin cache),
# driving its session-start.sh with the HEAD nbr. install-nbr.sh honours
# NBR_LOCAL_BIN, so the hook installs the HEAD binary instead of downloading.
# With NBR_API_URL unreachable, `nbr status` fails → the hook emits onboarding.

log "--- Step 5: run installed session-start.sh against HEAD-built nbr ---"
HOOK_SCRIPT=$(find "${HOME}/.claude/plugins/cache" -type f -name 'session-start.sh' 2>/dev/null | head -1)

if [ -z "${HOOK_SCRIPT}" ] || [ ! -f "${HOOK_SCRIPT}" ]; then
  fail "installed session-start.sh not found under ~/.claude/plugins/cache"
else
  PLUGIN_ROOT_DIR=$(cd "$(dirname "${HOOK_SCRIPT}")/.." && pwd)
  log "installed plugin root: ${PLUGIN_ROOT_DIR}"

  HOOK_DATA=$(mktemp -d)
  HOOK_ENV="${HOOK_DATA}/env"
  : > "${HOOK_ENV}"

  # Default to an unreachable API so `nbr status` fails fast (no external
  # traffic) and the unauthenticated onboarding path runs deterministically.
  # The staging smoke overrides NBR_API_URL to hit the live API.
  HOOK_API_URL="${NBR_API_URL:-http://127.0.0.1:1}"

  HOOK_OUT=$(
    CLAUDE_PLUGIN_ROOT="${PLUGIN_ROOT_DIR}" \
    CLAUDE_PLUGIN_DATA="${HOOK_DATA}" \
    CLAUDE_ENV_FILE="${HOOK_ENV}" \
    NBR_LOCAL_BIN="${NBR_LOCAL_BIN:-}" \
    NBR_API_URL="${HOOK_API_URL}" \
    sh "${HOOK_SCRIPT}" 2>/dev/null || true
  )
  log "hook output: ${HOOK_OUT}"

  # Valid SessionStart JSON envelope?
  if printf '%s' "${HOOK_OUT}" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"' >/dev/null 2>&1; then
    pass "installed hook emitted a valid SessionStart hookSpecificOutput JSON object"
  else
    fail "installed hook did not emit valid SessionStart JSON. Output: ${HOOK_OUT}"
  fi

  # Onboarding context present (unauthenticated path)?
  CTX=$(printf '%s' "${HOOK_OUT}" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null || printf '')
  if printf '%s' "${CTX}" | grep -qi 'affection is all you need'; then
    pass "hook injected onboarding context ('affection is all you need')"
  else
    fail "hook onboarding context missing. additionalContext: ${CTX}"
  fi

  # The hook should have installed the HEAD nbr via NBR_LOCAL_BIN.
  if [ -x "${HOOK_DATA}/bin/nbr" ]; then
    INSTALLED_NBR_VER=$("${HOOK_DATA}/bin/nbr" --version 2>/dev/null || echo "?")
    pass "hook installed nbr from HEAD into the plugin data dir (${INSTALLED_NBR_VER})"
  else
    warn "hook did not install nbr into ${HOOK_DATA}/bin (NBR_LOCAL_BIN=${NBR_LOCAL_BIN:-<unset>})"
  fi

  rm -rf "${HOOK_DATA}"
fi

# ── Summary ────────────────────────────────────────────────────────────────────

log ""
log "=== Claude test summary ==="
log "PASS: ${PASS_COUNT}  FAIL: ${FAIL_COUNT}  WARN: ${WARN_COUNT}"
log ""

if [ "${FAIL_COUNT}" -gt 0 ]; then
  log "RESULT: FAILED (${FAIL_COUNT} assertion(s) failed)"
  exit 1
fi

log "RESULT: PASSED"
exit 0
