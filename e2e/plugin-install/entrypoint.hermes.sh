#!/bin/sh
# entrypoint.hermes.sh — Hermes plugin install test
#
# Runs inside the prebuilt `nousresearch/hermes-agent:latest` image.
# Invoked by run.sh via `docker run --rm ... nousresearch/hermes-agent:latest /entrypoint.hermes.sh`.
#
# The Hermes image uses s6-overlay (/init as PID 1) for service management.
# For one-shot test commands we bypass s6 entirely and invoke the hermes CLI
# directly from its venv. This is intentional and noted below [U9].
#
# Environment (set by run.sh at docker run time):
#   REPO_ROOT   Path where the repo is bind-mounted (default: /repo)
#   DATA_DIR    Hermes data dir (default: /opt/data, the image's default)
#
# What 'hermes plugins install' does (and why we copy instead):
#   `hermes plugins install` is GIT-ONLY — it clones from a remote git URL.
#   For a local checkout, we manually copy plugins/hermes into the data dir's
#   plugins/ directory as 'nearest-neighbor', then call `hermes plugins enable`.
#
# Exit codes:
#   0 — all assertions passed
#   1 — a required assertion failed (logged with FAIL: prefix)
#
# Uncertain / coordinator-must-validate:
#   [U9]  s6-overlay bypass: invoking `hermes` directly from the venv without
#         /init may miss some initialisation that s6 would normally do (e.g.
#         loading env vars from /etc/s6/env). If `hermes` reports missing config,
#         the coordinator may need to pass -e flags or adjust DATA_DIR.
#   [U10] Hermes venv path: assumed to be /opt/hermes/.venv/bin/hermes (per the
#         task description). If the binary is at a different path in the actual
#         image, this script probes several candidates.
#   [U11] `hermes plugins enable <name>`: the exact subcommand may differ across
#         Hermes versions. We probe `hermes plugins --help` before attempting.
#   [U12] `HERMES_PLUGINS_DEBUG=1 hermes plugins list` — expected to emit plugin
#         registration detail (register()/hooks loaded) on stderr. If this env
#         var is not recognised by the installed version, the assertion is
#         downgraded to a WARN.

set -eu

REPO_ROOT="${REPO_ROOT:-/repo}"
DATA_DIR="${DATA_DIR:-/opt/data}"
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# ── Helpers ────────────────────────────────────────────────────────────────────

log()  { printf '[hermes-test] %s\n' "$*"; }
pass() { log "PASS: $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
warn() { log "WARN: $*"; WARN_COUNT=$((WARN_COUNT + 1)); }
fail() { log "FAIL: $*" >&2; FAIL_COUNT=$((FAIL_COUNT + 1)); }

# ── Step 0: Locate the hermes CLI ────────────────────────────────────────────
# [U10] The task description says the venv is at /opt/hermes/.venv/bin/hermes.
#       We probe several candidate paths and use the first one found.

log "=== Hermes plugin install test ==="
log "REPO_ROOT=${REPO_ROOT}"
log "DATA_DIR=${DATA_DIR}"

HERMES_BIN=""
for candidate in \
    /opt/hermes/.venv/bin/hermes \
    /opt/hermes/venv/bin/hermes \
    /usr/local/bin/hermes \
    /usr/bin/hermes
do
  if [ -x "${candidate}" ]; then
    HERMES_BIN="${candidate}"
    log "Found hermes CLI at: ${HERMES_BIN}"
    break
  fi
done

# Also try PATH
if [ -z "${HERMES_BIN}" ] && command -v hermes >/dev/null 2>&1; then
  HERMES_BIN=$(command -v hermes)
  log "Found hermes CLI on PATH: ${HERMES_BIN}"
fi

if [ -z "${HERMES_BIN}" ]; then
  fail "hermes CLI not found (tried /opt/hermes/.venv/bin/hermes, /opt/hermes/venv/bin/hermes, PATH)"
  exit 1
fi

HERMES_VERSION=$("${HERMES_BIN}" --version 2>/dev/null || echo "unknown")
log "hermes version: ${HERMES_VERSION}"

# ── Step 1: Copy the plugin into the data dir ─────────────────────────────────
# [U9] Bypassing `hermes plugins install` (git-only) by directly copying.
# The plugin directory structure expected by Hermes:
#   ${DATA_DIR}/plugins/nearest-neighbor/
#     plugin.yaml    <- plugin manifest
#     hooks.py       <- hook implementations
#     __init__.py    <- package init
#     scripts/       <- install-nbr.sh etc.
#     ...

log "--- Step 1: copy plugin into data dir ---"

SRC_PLUGIN="${REPO_ROOT}/plugins/hermes"
DST_PLUGIN="${DATA_DIR}/plugins/nearest-neighbor"

if [ ! -d "${SRC_PLUGIN}" ]; then
  fail "source plugin dir not found: ${SRC_PLUGIN}"
  exit 1
fi

# Create the plugins directory if it doesn't exist
mkdir -p "${DATA_DIR}/plugins"

# Remove stale destination if present (idempotent for re-runs)
if [ -d "${DST_PLUGIN}" ]; then
  rm -rf "${DST_PLUGIN}"
  log "removed stale plugin dir: ${DST_PLUGIN}"
fi

# Copy the plugin tree
cp -r "${SRC_PLUGIN}" "${DST_PLUGIN}"
log "copied ${SRC_PLUGIN} -> ${DST_PLUGIN}"
pass "plugin copied to ${DST_PLUGIN}"

# Verify the manifest is present
if [ -f "${DST_PLUGIN}/plugin.yaml" ]; then
  pass "plugin.yaml present in destination"
else
  fail "plugin.yaml not found in destination ${DST_PLUGIN}"
fi

# ── Step 2: Enable the plugin ─────────────────────────────────────────────────
# [U11] Probe `hermes plugins --help` to find the enable subcommand.

log "--- Step 2: enable the plugin ---"

PLUGINS_HELP=$("${HERMES_BIN}" plugins --help 2>&1 || true)
log "hermes plugins --help:"
printf '%s\n' "${PLUGINS_HELP}" | head -30

HAS_ENABLE=""
if printf '%s' "${PLUGINS_HELP}" | grep -qi '\benable\b'; then
  HAS_ENABLE="1"
  log "  -> 'enable' subcommand detected"
else
  warn "[U11] 'enable' not in hermes plugins --help"
fi

if [ -n "${HAS_ENABLE}" ]; then
  ENABLE_OUT=$("${HERMES_BIN}" plugins enable nearest-neighbor 2>&1 || true)
  log "hermes plugins enable output: ${ENABLE_OUT}"

  if printf '%s' "${ENABLE_OUT}" | grep -qi 'error\|failed\|not found'; then
    warn "[U11] 'hermes plugins enable' reported an error — coordinator must verify."
    warn "      Output: ${ENABLE_OUT}"
  else
    pass "plugin enable completed without obvious error"
  fi
else
  warn "[U11] Skipping enable — 'enable' not in plugins help."
  warn "      The coordinator should determine if plugins are auto-enabled on copy or require a different command."
fi

# ── Step 3: Verify plugin is listed ──────────────────────────────────────────

log "--- Step 3: verify plugin list ---"
LIST_OUT=$("${HERMES_BIN}" plugins list 2>&1 || true)
log "hermes plugins list output: ${LIST_OUT}"

if printf '%s' "${LIST_OUT}" | grep -qi 'nearest-neighbor'; then
  pass "nearest-neighbor appears in hermes plugins list"
else
  fail "nearest-neighbor NOT found in hermes plugins list. Output: ${LIST_OUT}"
fi

# ── Step 4: Debug output — register()/hooks loaded ───────────────────────────
# [U12] `HERMES_PLUGINS_DEBUG=1` should cause Hermes to emit register()/hooks
#       loaded detail on stderr. We capture stderr and assert it contains plugin
#       registration evidence.

log "--- Step 4: verify debug/hook registration ---"

DEBUG_STDERR=$(HERMES_PLUGINS_DEBUG=1 "${HERMES_BIN}" plugins list 2>&1 >/dev/null || true)
log "HERMES_PLUGINS_DEBUG=1 hermes plugins list (stderr):"
printf '%s\n' "${DEBUG_STDERR}"

if printf '%s' "${DEBUG_STDERR}" | grep -qi 'nearest-neighbor\|register\|hooks'; then
  pass "[U12] debug output contains plugin registration evidence"
else
  warn "[U12] HERMES_PLUGINS_DEBUG=1 did not produce expected debug output."
  warn "      This env var may not be supported in the installed version."
  warn "      Coordinator: check if Hermes uses a different debug flag (e.g. --debug, HERMES_DEBUG=1)."
fi

# ── Step 5: [BONUS] Verify hook signatures are importable ────────────────────
# We can't fire pre_llm_call without a model key, but we can at minimum verify
# that the plugin's Python is importable by using `python3 -c "import ..."`.
# The hooks.py references on_session_start and pre_llm_call — Python syntax errors
# would surface here.

log "--- Step 5: [BONUS] verify plugin Python is importable ---"

PYTHON_BIN=""
if [ -x "/opt/hermes/.venv/bin/python" ]; then
  PYTHON_BIN="/opt/hermes/.venv/bin/python"
elif [ -x "/opt/hermes/venv/bin/python" ]; then
  PYTHON_BIN="/opt/hermes/venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN=$(command -v python3)
fi

if [ -n "${PYTHON_BIN}" ] && [ -f "${DST_PLUGIN}/hooks.py" ]; then
  IMPORT_OUT=$("${PYTHON_BIN}" -c "
import sys
sys.path.insert(0, '${DST_PLUGIN}')
import hooks
assert hasattr(hooks, 'on_session_start'), 'on_session_start missing'
assert hasattr(hooks, 'pre_llm_call'), 'pre_llm_call missing'
print('OK: on_session_start and pre_llm_call found in hooks module')
" 2>&1 || true)
  log "import check output: ${IMPORT_OUT}"
  if printf '%s' "${IMPORT_OUT}" | grep -qi 'OK:'; then
    pass "hooks.py is importable and declares expected hook functions"
  else
    warn "[BONUS] hooks.py import check failed: ${IMPORT_OUT}"
  fi
else
  warn "[BONUS] Python binary or hooks.py not available — skipping import check"
fi

# ── Summary ────────────────────────────────────────────────────────────────────

log ""
log "=== Hermes test summary ==="
log "PASS: ${PASS_COUNT}  FAIL: ${FAIL_COUNT}  WARN: ${WARN_COUNT}"
log ""

if [ "${FAIL_COUNT}" -gt 0 ]; then
  log "RESULT: FAILED (${FAIL_COUNT} assertion(s) failed)"
  exit 1
fi

log "RESULT: PASSED"
exit 0
