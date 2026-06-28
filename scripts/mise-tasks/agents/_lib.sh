#!/usr/bin/env bash
# _lib.sh — shared functions sourced by every agents:* script.
# NOT a task; no #USAGE headers. Do NOT call `set -euo pipefail` here —
# callers set their own error mode before sourcing.

# ---------------------------------------------------------------------------
# REPO_ROOT — resolved from BASH_SOURCE (NOT git rev-parse; hk sets GIT_DIR)
# ---------------------------------------------------------------------------
_NN_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${_NN_SCRIPT_DIR}/../../.." && pwd)"

# ---------------------------------------------------------------------------
# Auto-discover dev ports — source .dev/ports.env when present.
# This populates PORT, E2E_WEB_PORT, POSTGRES_PORT, DATABASE_URL,
# DATABASE_DIRECT_URL, COMPOSE_PROJECT_NAME, and NBR_API_URL so that agents:*
# tasks follow the randomly-assigned ports without any manual env configuration.
# When the file is absent (e.g. running against staging) the ${VAR:-default}
# fallbacks in nn_nbr_api_url / nn_export_db_env apply as before.
# ---------------------------------------------------------------------------
# shellcheck source=/dev/null
[[ -f "${REPO_ROOT}/.dev/ports.env" ]] && . "${REPO_ROOT}/.dev/ports.env"

# ---------------------------------------------------------------------------
# nn_repo_root — print the resolved repo root
# ---------------------------------------------------------------------------
nn_repo_root() {
  printf '%s\n' "$REPO_ROOT"
}

# ---------------------------------------------------------------------------
# nn_resolve_cmd <harness>
# Echoes the executable for the given harness (claude|codex|hermes).
# ---------------------------------------------------------------------------
nn_resolve_cmd() {
  local harness="$1"
  case "$harness" in
    claude) printf '%s\n' "${AGENTS_CLAUDE_CMD:-claude}" ;;
    codex)  printf '%s\n' "${AGENTS_CODEX_CMD:-codex}" ;;
    hermes) printf '%s\n' "${AGENTS_HERMES_CMD:-hermes}" ;;
    *)
      printf 'ERROR: nn_resolve_cmd: unknown harness "%s"\n' "$harness" >&2
      return 1
      ;;
  esac
}

# ---------------------------------------------------------------------------
# nn_base_dir <harness>
# Echoes the AGENTS_*_BASE directory (expanded with $HOME).
# ---------------------------------------------------------------------------
nn_base_dir() {
  local harness="$1"
  case "$harness" in
    claude) printf '%s\n' "${AGENTS_CLAUDE_BASE:-${HOME}/.claude}" ;;
    codex)  printf '%s\n' "${AGENTS_CODEX_BASE:-${HOME}/.codex}" ;;
    hermes) printf '%s\n' "${AGENTS_HERMES_BASE:-${HOME}/.hermes}" ;;
    *)
      printf 'ERROR: nn_base_dir: unknown harness "%s"\n' "$harness" >&2
      return 1
      ;;
  esac
}

# ---------------------------------------------------------------------------
# nn_cred_filename <harness>
# Echoes the credential filename used by each harness.
# ---------------------------------------------------------------------------
nn_cred_filename() {
  local harness="$1"
  case "$harness" in
    claude) printf '%s\n' '.credentials.json' ;;
    codex)  printf '%s\n' 'auth.json' ;;
    hermes) printf '%s\n' 'auth.json' ;;
    *)
      printf 'ERROR: nn_cred_filename: unknown harness "%s"\n' "$harness" >&2
      return 1
      ;;
  esac
}

# ---------------------------------------------------------------------------
# nn_agent_dir <name>
# Echoes the absolute path to sandbox/agents/<name>.
# ---------------------------------------------------------------------------
nn_agent_dir() {
  local name="$1"
  printf '%s/sandbox/agents/%s\n' "$REPO_ROOT" "$name"
}

# ---------------------------------------------------------------------------
# nn_hermes_profile <name>
# Echoes the real Hermes profile path (~/.hermes/profiles/nbr-<name>).
# HERMES_HOME is only trusted when its parent dir is literally named 'profiles'.
# ---------------------------------------------------------------------------
nn_hermes_profile() {
  local name="$1"
  printf '%s/.hermes/profiles/nbr-%s\n' "$HOME" "$name"
}

# ---------------------------------------------------------------------------
# nn_default_model <harness>
# Echoes the default model for the harness.
# Hermes default matches the base config.yaml model.default (gpt-5.5); Hermes
# requires a non-empty model string and will throw ValueError otherwise.
# ---------------------------------------------------------------------------
nn_default_model() {
  local harness="$1"
  case "$harness" in
    claude) printf '%s\n' 'opus' ;;
    codex)  printf '%s\n' 'gpt-5.5' ;;
    hermes) printf '%s\n' 'gpt-5.5' ;;
    *)
      printf 'ERROR: nn_default_model: unknown harness "%s"\n' "$harness" >&2
      return 1
      ;;
  esac
}

# ---------------------------------------------------------------------------
# nn_default_effort
# Echoes the default reasoning effort (harness-independent; hermes ignores it).
# ---------------------------------------------------------------------------
nn_default_effort() {
  printf '%s\n' 'medium'
}

# ---------------------------------------------------------------------------
# nn_config_dir <name> <harness>
# Echoes the config dir path for the agent.
# - claude/codex: sandbox/agents/<name>/config
# - hermes:       ~/.hermes/profiles/nbr-<name>  (HERMES_HOME constraint)
# ---------------------------------------------------------------------------
nn_config_dir() {
  local name="$1"
  local harness="$2"
  case "$harness" in
    claude|codex)
      printf '%s/sandbox/agents/%s/config\n' "$REPO_ROOT" "$name"
      ;;
    hermes)
      nn_hermes_profile "$name"
      ;;
    *)
      printf 'ERROR: nn_config_dir: unknown harness "%s"\n' "$harness" >&2
      return 1
      ;;
  esac
}

# ---------------------------------------------------------------------------
# nn_write_meta <name> <harness> <model> <effort>
# Writes sandbox/agents/<name>/agent.json using printf (no jq dependency).
# Keys: harness, name, model, effort, profile, createdAt, handle (null).
# Separate declare and assign to avoid SC2155.
# ---------------------------------------------------------------------------
nn_write_meta() {
  local name="$1"
  local harness="$2"
  local model="$3"
  local effort="$4"

  local agent_dir
  agent_dir="$(nn_agent_dir "$name")"

  local profile
  if [[ "$harness" == 'hermes' ]]; then
    profile="$(nn_hermes_profile "$name")"
  else
    profile="${agent_dir}/config"
  fi

  local created_at
  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  printf '{\n  "harness": "%s",\n  "name": "%s",\n  "model": "%s",\n  "effort": "%s",\n  "profile": "%s",\n  "createdAt": "%s",\n  "handle": null\n}\n' \
    "$harness" "$name" "$model" "$effort" "$profile" "$created_at" \
    > "${agent_dir}/agent.json"
}

# ---------------------------------------------------------------------------
# nn_read_meta <name> <key>
# Reads a scalar value from sandbox/agents/<name>/agent.json.
# Greps the "key": "value" pattern (works for string scalars and null).
# Separate declare and assign to avoid SC2155.
# ---------------------------------------------------------------------------
nn_read_meta() {
  local name="$1"
  local key="$2"

  local agent_dir
  agent_dir="$(nn_agent_dir "$name")"

  local json_file
  json_file="${agent_dir}/agent.json"

  if [[ ! -f "$json_file" ]]; then
    printf 'ERROR: nn_read_meta: %s not found (run agents:setup first)\n' "$json_file" >&2
    return 1
  fi

  # Match "key": "value" (quoted) or "key": null
  grep -o "\"${key}\": *[^,}]*" "$json_file" \
    | sed 's/^"[^"]*": *//; s/^"//; s/"$//' \
    | head -1
}

# ---------------------------------------------------------------------------
# nn_export_db_env
# Exports DATABASE_URL and DATABASE_DIRECT_URL with the local dev defaults.
# Callers (agents:ready, agents:report) MUST call this before invoking any
# task or script that reads DATABASE_URL (db:reset, db:seed, inspect.ts).
# The ${VAR:-default} form is forward-compatible: an externally-set value wins.
# ---------------------------------------------------------------------------
nn_export_db_env() {
  export DATABASE_URL="${DATABASE_URL:-postgres://nearest-neighbor:nearest-neighbor@localhost:5432/nearest-neighbor}"
  export DATABASE_DIRECT_URL="${DATABASE_DIRECT_URL:-${DATABASE_URL}}"
}

# ---------------------------------------------------------------------------
# nn_nbr_api_url
# Echoes the local nbr API base URL (from env or default).
# ---------------------------------------------------------------------------
nn_nbr_api_url() {
  printf '%s\n' "${NBR_API_URL:-http://localhost:8080}"
}

# ---------------------------------------------------------------------------
# nn_nbr_local_bin
# Echoes the path to the locally-built nbr binary (from env or default).
# ---------------------------------------------------------------------------
nn_nbr_local_bin() {
  printf '%s\n' "${NBR_LOCAL_BIN:-${REPO_ROOT}/apps/cli/target/release/nbr}"
}
