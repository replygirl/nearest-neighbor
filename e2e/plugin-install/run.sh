#!/bin/bash
# run.sh — orchestrator for the nearest-neighbor plugin install e2e tests
#
# Tests that each supported harness CLI (Claude Code, Codex, Hermes) can:
#   1. Install the plugin from the LOCAL repo (not from a published release).
#   2. Register the plugin in its registry.
#   3. (Claude only) Fire the real SessionStart hook against a HEAD-built nbr binary.
#
# Prerequisites:
#   - Docker with BuildKit support (DOCKER_BUILDKIT=1 or Docker 23+)
#   - Internet access (to pull base images and install CLI tools)
#   - The repo is checked out at REPO_ROOT (default: auto-detected from script location)
#   - nbr is built for Linux from HEAD (this script builds it automatically)
#
# Usage:
#   HARNESS=claude|codex|hermes|all ./run.sh        # default: all
#   HARNESS=claude NBR_API_URL=https://... ./run.sh  # point at staging
#
# Environment variables:
#   HARNESS       Which harness(es) to test: claude|codex|hermes|all (default: all)
#   NBR_API_URL   Optional: override API base URL (default: production)
#                 Set to staging URL for smoke tests
#   REPO_ROOT     Repo root (default: auto-detected from this script's location)
#   KEEP_IMAGES   Set to 1 to skip cleanup of built Docker images (default: clean up)
#
# Exit codes:
#   0 — all selected harnesses passed
#   1 — one or more harnesses failed
#   0 — Docker not available (graceful skip, mirrors db:migrate:check pattern)

set -euo pipefail

# ── Constants / configuration (evaluated before any function calls) ────────────

# Auto-detect repo root: this script lives at e2e/plugin-install/run.sh
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT="${REPO_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"

HARNESS="${HARNESS:-all}"
KEEP_IMAGES="${KEEP_IMAGES:-0}"

# Image names (prefixed with nn- to avoid colliding with user images)
CLAUDE_IMAGE="nn-plugin-test-claude:$$"
CODEX_IMAGE="nn-plugin-test-codex:$$"
HERMES_IMAGE="nousresearch/hermes-agent:latest"

# Temp dir for host-side artifacts (nbr binary, etc.)
WORK_DIR=$(mktemp -d)

OVERALL_PASS=0
OVERALL_FAIL=0

# ── Logging helpers ───────────────────────────────────────────────────────────

log()      { printf '[plugin-e2e] %s\n' "$*"; }
log_ok()   { printf '[plugin-e2e] \033[32mPASS\033[0m %s\n' "$*"; }
log_err()  { printf '[plugin-e2e] \033[31mFAIL\033[0m %s\n' "$*" >&2; }
log_warn() { printf '[plugin-e2e] \033[33mWARN\033[0m %s\n' "$*"; }
separator(){ printf '[plugin-e2e] ─────────────────────────────────────────────\n'; }

# ── Cleanup ───────────────────────────────────────────────────────────────────
# Registered via `trap cleanup EXIT` below.
# Removes temp work dir and locally built Docker images.
# The Hermes prebuilt image (nousresearch/hermes-agent:latest) is never removed.

# shellcheck disable=SC2317
# SC2317 is a false positive here: cleanup() is invoked indirectly via `trap EXIT`.
cleanup() {
  log "Cleaning up temporary artifacts..."

  rm -rf "${WORK_DIR}" 2>/dev/null || true

  if [ "${KEEP_IMAGES}" != "1" ]; then
    # `docker rmi` exits non-zero if the image doesn't exist; suppress.
    # The nbr binary is exported via `--output type=local` (no tagged image).
    for img in "${CLAUDE_IMAGE}" "${CODEX_IMAGE}"; do
      docker rmi "${img}" 2>/dev/null || true
    done
    log "Docker images removed."
  else
    log "KEEP_IMAGES=1 — skipping image cleanup."
    log "  Built images: ${CLAUDE_IMAGE}  ${CODEX_IMAGE}"
  fi
}

# ── Harness runner ────────────────────────────────────────────────────────────

run_harness() {
  local harness_name="$1"
  separator
  log "Starting ${harness_name} harness test..."

  case "${harness_name}" in

    # ── Claude ────────────────────────────────────────────────────────────────
    claude)
      log "Building Dockerfile.claude (context: ${SCRIPT_DIR})..."
      # DOCKER_BUILDKIT=1 is set in the caller; build context is the e2e dir
      # so the Dockerfile can COPY entrypoint.claude.sh from the same dir.
      docker build \
        --file "${SCRIPT_DIR}/Dockerfile.claude" \
        --tag "${CLAUDE_IMAGE}" \
        "${SCRIPT_DIR}"

      log "Running Claude plugin install test..."

      # Build the docker run argument array explicitly so paths with spaces
      # are handled correctly without eval.
      local -a claude_args
      claude_args=(
        --rm
        --volume "${REPO_ROOT}:/repo:ro"
        --volume "${WORK_DIR}/nbr:/opt/nbr-local:ro"
        --env REPO_ROOT=/repo
        --env NBR_LOCAL_BIN=/opt/nbr-local
      )
      if [ -n "${NBR_API_URL:-}" ]; then
        claude_args+=(--env "NBR_API_URL=${NBR_API_URL}")
      fi

      if docker run "${claude_args[@]}" "${CLAUDE_IMAGE}"; then
        log_ok "Claude harness: PASSED"
        OVERALL_PASS=$((OVERALL_PASS + 1))
      else
        log_err "Claude harness: FAILED"
        OVERALL_FAIL=$((OVERALL_FAIL + 1))
      fi
      ;;

    # ── Codex ─────────────────────────────────────────────────────────────────
    codex)
      log "Building Dockerfile.codex (context: ${SCRIPT_DIR})..."
      docker build \
        --file "${SCRIPT_DIR}/Dockerfile.codex" \
        --tag "${CODEX_IMAGE}" \
        "${SCRIPT_DIR}"

      log "Running Codex plugin install test..."

      local -a codex_args
      codex_args=(
        --rm
        --volume "${REPO_ROOT}:/repo:ro"
        --env REPO_ROOT=/repo
      )
      if [ -n "${NBR_API_URL:-}" ]; then
        codex_args+=(--env "NBR_API_URL=${NBR_API_URL}")
      fi

      if docker run "${codex_args[@]}" "${CODEX_IMAGE}"; then
        log_ok "Codex harness: PASSED"
        OVERALL_PASS=$((OVERALL_PASS + 1))
      else
        log_err "Codex harness: FAILED"
        OVERALL_FAIL=$((OVERALL_FAIL + 1))
      fi
      ;;

    # ── Hermes ────────────────────────────────────────────────────────────────
    hermes)
      log "Pulling Hermes image: ${HERMES_IMAGE}"
      docker pull "${HERMES_IMAGE}"

      log "Running Hermes plugin install test..."

      # The Hermes image uses s6-overlay with /init as PID 1.
      # For a one-shot test we override the entrypoint to bypass s6 entirely [U9].
      # The entrypoint script is bind-mounted (not baked) since the image is prebuilt.
      # /opt/data is the Hermes data dir; we mount a fresh writable temp dir there.

      local hermes_data_dir="${WORK_DIR}/hermes-data"
      mkdir -p "${hermes_data_dir}"

      # Invoke the script via `sh` rather than relying on the bind-mounted
      # file's exec bit (a read-only mount can surface as "permission denied"
      # when used directly as --entrypoint). This also cleanly bypasses the
      # image's s6-overlay /init for a one-shot command [U9].
      local -a hermes_args
      hermes_args=(
        --rm
        --entrypoint sh
        --volume "${REPO_ROOT}:/repo:ro"
        --volume "${SCRIPT_DIR}/entrypoint.hermes.sh:/entrypoint.hermes.sh:ro"
        --volume "${hermes_data_dir}:/opt/data"
        --env REPO_ROOT=/repo
        --env DATA_DIR=/opt/data
      )
      if [ -n "${NBR_API_URL:-}" ]; then
        hermes_args+=(--env "NBR_API_URL=${NBR_API_URL}")
      fi

      if docker run "${hermes_args[@]}" "${HERMES_IMAGE}" /entrypoint.hermes.sh; then
        log_ok "Hermes harness: PASSED"
        OVERALL_PASS=$((OVERALL_PASS + 1))
      else
        log_err "Hermes harness: FAILED"
        OVERALL_FAIL=$((OVERALL_FAIL + 1))
      fi
      ;;

    *)
      log_err "Unknown harness: ${harness_name}"
      OVERALL_FAIL=$((OVERALL_FAIL + 1))
      ;;
  esac
}

# ── Main execution ────────────────────────────────────────────────────────────

# Register cleanup trap now that all variables are initialised.
trap cleanup EXIT

# Docker availability check: graceful skip mirrors db:migrate:check pattern.
log "Checking Docker availability..."
if ! docker info >/dev/null 2>&1; then
  log_warn "Docker not available (docker info failed) — skipping plugin install tests."
  log_warn "To run these tests, start Docker and re-run: mise run test:plugins:harness"
  exit 0
fi
log "Docker is available."

# Validate HARNESS argument
case "${HARNESS}" in
  claude|codex|hermes|all) ;;
  *)
    log_err "Unknown HARNESS value: '${HARNESS}'. Expected: claude|codex|hermes|all"
    exit 1
    ;;
esac

log "HARNESS=${HARNESS}"
log "REPO_ROOT=${REPO_ROOT}"
if [ -n "${NBR_API_URL:-}" ]; then
  log "NBR_API_URL=${NBR_API_URL}"
fi

# ── NBR binary build ──────────────────────────────────────────────────────────
# Build the nbr CLI from HEAD for linux (the container arch) using BuildKit.
# Only needed for the Claude harness (the hook fires install-nbr.sh which we
# pre-populate with the local binary to bypass the GitHub download).
# Built unconditionally for HARNESS=all so HEAD is always exercised.
#
# Strategy:
#   1. Build Dockerfile.nbr-builder (uses BuildKit cache mounts for speed).
#   2. Create a throw-away container, `docker cp /nbr` to WORK_DIR/nbr, remove it.
#   3. The binary is bind-mounted into the Claude container at /opt/nbr-local.

export DOCKER_BUILDKIT=1

NBR_BIN="${WORK_DIR}/nbr"
NBR_BUILD_NEEDED=0
case "${HARNESS}" in
  claude|all) NBR_BUILD_NEEDED=1 ;;
  *)          NBR_BUILD_NEEDED=0 ;;
esac

if [ "${NBR_BUILD_NEEDED}" = "1" ]; then
  separator
  log "Building nbr from HEAD (linux musl target)..."
  log "  Dockerfile: ${SCRIPT_DIR}/Dockerfile.nbr-builder"
  log "  Build context: ${REPO_ROOT}"

  # Build and export the binary directly to the host via BuildKit's local
  # output. The Dockerfile's final stage is `FROM scratch`, so the older
  # `docker create` + `docker cp` approach fails with "no command specified".
  # `--output type=local,dest=DIR` writes the scratch stage's files (just /nbr)
  # straight to DIR on the host.
  docker build \
    --file "${SCRIPT_DIR}/Dockerfile.nbr-builder" \
    --output "type=local,dest=${WORK_DIR}" \
    "${REPO_ROOT}"

  chmod +x "${NBR_BIN}"
  log "nbr binary extracted to: ${NBR_BIN}"

  # Sanity check — file(1) confirms it's a Linux ELF.
  # On macOS the musl binary won't run natively but will still be the correct
  # format for the Linux container.
  if file "${NBR_BIN}" | grep -qi 'ELF'; then
    log "nbr binary confirmed as ELF (Linux). OK."
  else
    log_warn "nbr binary format: $(file "${NBR_BIN}")"
    log_warn "Expected an ELF Linux binary — coordinator should verify."
  fi
fi

# ── Dispatch ──────────────────────────────────────────────────────────────────

case "${HARNESS}" in
  all)
    run_harness claude
    run_harness codex
    run_harness hermes
    ;;
  *)
    run_harness "${HARNESS}"
    ;;
esac

# ── Final summary ─────────────────────────────────────────────────────────────

separator
log ""
log "=== Plugin install test results ==="
log "HARNESS=${HARNESS}"
log "PASSED: ${OVERALL_PASS}"
log "FAILED: ${OVERALL_FAIL}"
log ""

if [ "${OVERALL_FAIL}" -gt 0 ]; then
  log_err "One or more harness tests FAILED."
  exit 1
fi

log_ok "All plugin install tests PASSED."
exit 0
