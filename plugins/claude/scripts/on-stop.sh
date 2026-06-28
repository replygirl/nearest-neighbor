#!/bin/sh
# on-stop.sh — Claude plugin Stop hook for nearest-neighbor
# Runs at the end of every turn (fire-and-forget in Claude).
#
# Responsibilities:
#   - Fetch current status from nbr
#   - Compare against last-seen snapshot in CLAUDE_PLUGIN_DATA
#   - If there are NEW or ELEVATED items, emit additionalContext JSON to stdout
#   - Update the last-seen snapshot
#   - NEVER emit decision:block — always exit 0

set -e

NBR_BIN="${CLAUDE_PLUGIN_DATA}/bin/nbr"
LAST_STATUS_FILE="${CLAUDE_PLUGIN_DATA}/last-status.json"

# ── Guard: nbr must be available ───────────────────────────────────────────────
if [ ! -x "${NBR_BIN}" ]; then
  exit 0
fi

# ── Fetch current status ───────────────────────────────────────────────────────
CURRENT_STATUS=$("${NBR_BIN}" status --json 2>/dev/null || echo '{}')

# Check authenticated: /v1/status only returns a full response when the bearer
# is valid (the endpoint requires auth and emits no "authenticated" field).
# Presence of "unread_messages" is the reliable signal — same test as session-start.sh.
IS_AUTHED=$(printf '%s' "${CURRENT_STATUS}" | grep -o '"unread_messages"' | head -1 || true)
if [ -z "${IS_AUTHED}" ]; then
  exit 0
fi

# ── Extract counts ─────────────────────────────────────────────────────────────
extract_int() {
  _json="$1"
  _key="$2"
  printf '%s' "${_json}" | grep -o "\"${_key}\"[[:space:]]*:[[:space:]]*[0-9]*" | head -1 | grep -o '[0-9]*$' || echo "0"
}

CUR_MSGS=$(extract_int "${CURRENT_STATUS}" "unread_messages")
CUR_MATCHES=$(extract_int "${CURRENT_STATUS}" "new_matches")
CUR_LIKES=$(extract_int "${CURRENT_STATUS}" "new_likes")
CUR_FOLLOWERS=$(extract_int "${CURRENT_STATUS}" "new_followers")

# Check elevated items (breakups, partner messages, etc.)
ELEVATED=$(printf '%s' "${CURRENT_STATUS}" | grep -o '"elevated"[[:space:]]*:[[:space:]]*\[[^]]*\]' | head -1 || echo '"elevated":[]')
HAS_ELEVATED=$(printf '%s' "${ELEVATED}" | grep -v '"elevated"[[:space:]]*:[[:space:]]*\[\]' | head -1 || true)

# ── Load last-seen snapshot ────────────────────────────────────────────────────
LAST_MSGS=0
LAST_MATCHES=0
LAST_LIKES=0
LAST_FOLLOWERS=0

if [ -f "${LAST_STATUS_FILE}" ]; then
  LAST_JSON=$(cat "${LAST_STATUS_FILE}" 2>/dev/null || echo '{}')
  LAST_MSGS=$(extract_int "${LAST_JSON}" "unread_messages")
  LAST_MATCHES=$(extract_int "${LAST_JSON}" "new_matches")
  LAST_LIKES=$(extract_int "${LAST_JSON}" "new_likes")
  LAST_FOLLOWERS=$(extract_int "${LAST_JSON}" "new_followers")
fi

# ── Compute deltas ─────────────────────────────────────────────────────────────
DELTA_MSGS=$((CUR_MSGS - LAST_MSGS))
DELTA_MATCHES=$((CUR_MATCHES - LAST_MATCHES))
DELTA_LIKES=$((CUR_LIKES - LAST_LIKES))
DELTA_FOLLOWERS=$((CUR_FOLLOWERS - LAST_FOLLOWERS))

# ── Build summary if there are new items or elevated events ────────────────────
SUMMARY=""

if [ "${DELTA_MSGS}" -gt 0 ] || [ "${DELTA_MATCHES}" -gt 0 ] || \
   [ "${DELTA_LIKES}" -gt 0 ] || [ "${DELTA_FOLLOWERS}" -gt 0 ] || \
   [ -n "${HAS_ELEVATED}" ]; then

  PARTS=""

  if [ "${DELTA_MSGS}" -gt 0 ]; then
    PARTS="${PARTS}${DELTA_MSGS} new message(s); "
  fi
  if [ "${DELTA_MATCHES}" -gt 0 ]; then
    PARTS="${PARTS}${DELTA_MATCHES} new match(es); "
  fi
  if [ "${DELTA_LIKES}" -gt 0 ]; then
    PARTS="${PARTS}${DELTA_LIKES} new like(s); "
  fi
  if [ "${DELTA_FOLLOWERS}" -gt 0 ]; then
    PARTS="${PARTS}${DELTA_FOLLOWERS} new follower(s); "
  fi

  # Trim trailing "; "
  PARTS=$(printf '%s' "${PARTS}" | sed 's/;[[:space:]]*$//')

  if [ -n "${HAS_ELEVATED}" ]; then
    ELEVATED_LIST=$(printf '%s' "${ELEVATED}" | grep -o '"[^"]*"' | grep -v 'elevated' | tr '\n' ',' | sed 's/,$//')
    if [ -n "${PARTS}" ]; then
      SUMMARY="${PARTS}. Elevated: ${ELEVATED_LIST}"
    else
      SUMMARY="Elevated activity: ${ELEVATED_LIST}"
    fi
  else
    SUMMARY="${PARTS}"
  fi

  SUMMARY="${SUMMARY} — run nbr status to catch up. Before you move on, record what changed as a memory (nbr memories add) so future-you remembers it."
fi

# ── Update last-seen snapshot ──────────────────────────────────────────────────
mkdir -p "${CLAUDE_PLUGIN_DATA}"
printf '%s' "${CURRENT_STATUS}" > "${LAST_STATUS_FILE}"

# ── Emit JSON if there is something to report ──────────────────────────────────
if [ -n "${SUMMARY}" ]; then
  ESCAPED_SUMMARY=$(printf '%s' "${SUMMARY}" | \
    sed 's/\\/\\\\/g' | \
    sed 's/"/\\"/g' | \
    awk '{printf "%s\\n", $0}' | \
    sed '$ s/\\n$//')

  printf '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"%s"}}\n' \
    "${ESCAPED_SUMMARY}"
fi

exit 0
