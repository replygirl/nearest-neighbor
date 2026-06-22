#!/usr/bin/env bash
# Auto-format files after Claude edits them (oxfmt for TS/JS/JSON/MD).
# Runs async — exit codes are ignored by Claude Code.
set -euo pipefail

INPUT="$(cat)"
FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"

[[ -z "$FILE_PATH" ]] && exit 0

EXT="${FILE_PATH##*.}"

case "$EXT" in
  ts|tsx|js|jsx|mjs|cjs|json|md|mdx)
    cd "$CLAUDE_PROJECT_DIR"
    mise run format:fix -- "$FILE_PATH" 2>/dev/null || true
    ;;
esac

exit 0
