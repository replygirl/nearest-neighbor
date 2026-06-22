#!/usr/bin/env bash
# Run oxfmt on the file that was just edited.
# Called from .cursor/hooks.json afterFileEdit.
# Receives the changed file path as $1.
set -euo pipefail

FILE="${1:-}"
[[ -z "$FILE" ]] && exit 0

EXT="${FILE##*.}"

case "$EXT" in
  ts|tsx|js|jsx|mjs|cjs|json|md|mdx)
    REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
    cd "$REPO_ROOT"
    mise run format:fix -- "$FILE" 2>/dev/null || true
    ;;
esac

exit 0
