#!/usr/bin/env bash
# Guard hook for Cursor beforeShellExecution.
# Blocks known destructive patterns. Exits 1 to cancel the shell command.
# Receives the command as stdin JSON: { "command": "..." }
set -euo pipefail

INPUT="$(cat)"
COMMAND="$(printf '%s' "$INPUT" | jq -r '.command // empty' 2>/dev/null || true)"

[[ -z "$COMMAND" ]] && exit 0

if printf '%s' "$COMMAND" | grep -qE '(--no-verify|git push --force|git push -f)'; then
  echo "Blocked: bypassing git hooks or force-pushing is not allowed." >&2
  exit 1
fi

exit 0
