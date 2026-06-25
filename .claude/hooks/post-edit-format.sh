#!/usr/bin/env bash
# Auto-format files after Claude edits them (oxfmt for TS/JS/JSON/MD, ruff for Python).
# Runs async — exit codes are ignored by Claude Code.
#
# NOTE: format the single edited file with the correct tool directly. Do NOT route
# through `mise run format:fix` — that task runs `oxfmt --write .` AND
# `ruff format plugins/hermes`, and mise appends the file arg to the LAST command,
# so `ruff format <file.json>` mangles JSON manifests into 4-space + magic-trailing-
# comma (invalid JSON). oxfmt formats JSON/JS/MD to strict, valid output.
set -euo pipefail

INPUT="$(cat)"
FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"

[[ -z "$FILE_PATH" ]] && exit 0

cd "$CLAUDE_PROJECT_DIR"
EXT="${FILE_PATH##*.}"

case "$EXT" in
  ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx)
    mise exec -- oxfmt --write "$FILE_PATH" 2>/dev/null || true
    ;;
  py)
    mise exec -- ruff format "$FILE_PATH" 2>/dev/null || true
    mise exec -- ruff check --fix "$FILE_PATH" 2>/dev/null || true
    ;;
esac

exit 0
