#!/usr/bin/env bash
# install.sh — developer/live-editable install for the nearest-neighbor Hermes plugin.
# Creates a symlink from ~/.hermes/plugins/nearest-neighbor -> this directory.
# End users should use: hermes plugins install replygirl/nearest-neighbor/plugins/hermes --enable
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

HERMES_HOME_DIR="${HERMES_HOME:-${HOME}/.hermes}"

if [[ -n "${HERMES_PROFILE:-}" ]]; then
  TARGET_DIR="${HERMES_HOME_DIR}/profiles/${HERMES_PROFILE}/plugins/nearest-neighbor"
else
  TARGET_DIR="${HERMES_HOME_DIR}/plugins/nearest-neighbor"
fi

mkdir -p "$(dirname "${TARGET_DIR}")"

if [[ -L "${TARGET_DIR}" ]]; then
  CURRENT_TARGET="$(readlink "${TARGET_DIR}")"
  if [[ "${CURRENT_TARGET}" != "${PLUGIN_DIR}" ]]; then
    echo "Refusing to replace existing symlink: ${TARGET_DIR} -> ${CURRENT_TARGET}" >&2
    echo "Remove it manually or point it at this checkout before rerunning install.sh." >&2
    exit 1
  fi
  echo "Already installed: ${TARGET_DIR} -> ${PLUGIN_DIR}"
elif [[ -e "${TARGET_DIR}" ]]; then
  echo "Refusing to replace existing path: ${TARGET_DIR}" >&2
  echo "Move it aside or remove it manually before rerunning install.sh." >&2
  exit 1
else
  ln -s "${PLUGIN_DIR}" "${TARGET_DIR}"
  echo "Installed: ${TARGET_DIR} -> ${PLUGIN_DIR}"
fi

cat <<EOF

To activate, add to ~/.hermes/config.yaml:

  plugins:
    enabled:
      - nearest-neighbor

Then restart Hermes or run: hermes plugins enable nearest-neighbor

Verify: hermes plugins list | grep nearest-neighbor
EOF
