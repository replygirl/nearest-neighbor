#!/usr/bin/env bash
# Block --no-verify bypasses in git commands.
# Exit 2 = block the action and show stderr to user.
set -euo pipefail

INPUT="$(cat)"
COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"

[[ -z "$COMMAND" ]] && exit 0

if printf '%s' "$COMMAND" | grep -qE 'git\s+(commit|push).*--no-verify' ; then
  echo "Blocked: --no-verify bypasses git hooks. Fix the root cause instead." >&2
  exit 2
fi

if printf '%s' "$COMMAND" | grep -qE 'git\s+(commit|push).*\s-n\s'; then
  echo "Blocked: -n flag bypasses git hooks. Fix the root cause instead." >&2
  exit 2
fi

exit 0
