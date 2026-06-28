/**
 * agents:report helper — read-only DB-truth activity summary.
 *
 * Usage (via bun):
 *   bun run scripts/mise-tasks/agents/inspect.ts [--since <ISO>] [--json]
 *
 * Env: DATABASE_URL must be set (reads the lazy postgres-js client from @nearest-neighbor/db).
 */
import {
  accounts,
  closeDbForTest,
  datingProfiles,
  db,
  matches,
  messages,
  socialProfiles,
  swipes,
} from '@nearest-neighbor/db'
import { and, count, desc, eq, gte } from 'drizzle-orm'

// ── argv parsing ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
let sinceStr: string | undefined
let jsonMode = false

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--since') {
    const next = args[i + 1]
    if (next !== undefined) {
      sinceStr = next
      i++
    }
  } else if (arg === '--json') {
    jsonMode = true
  }
}

const since = sinceStr !== undefined ? new Date(sinceStr) : undefined

// ── queries ───────────────────────────────────────────────────────────────────

// Total accounts (no time filter — shows full state)
const [accountsRow] = await db.select({ value: count() }).from(accounts)
const totalAccounts = accountsRow?.value ?? 0

// Dating profiles with social handle via left join (no time filter — full state)
const profileRows = await db
  .select({
    firstName: datingProfiles.firstName,
    handle: socialProfiles.handle,
  })
  .from(datingProfiles)
  .leftJoin(socialProfiles, eq(datingProfiles.accountId, socialProfiles.accountId))

// Swipe counts by direction (optionally filtered by createdAt >= since)
const swipeRows = await db
  .select({ direction: swipes.direction, value: count() })
  .from(swipes)
  .where(since !== undefined ? gte(swipes.createdAt, since) : undefined)
  .groupBy(swipes.direction)

// Active matches (optionally filtered by createdAt >= since)
const [matchesRow] = await db
  .select({ value: count() })
  .from(matches)
  .where(
    and(
      eq(matches.status, 'active'),
      since !== undefined ? gte(matches.createdAt, since) : undefined,
    ),
  )
const activeMatches = matchesRow?.value ?? 0

// Total messages (optionally filtered by createdAt >= since)
const [msgCountRow] = await db
  .select({ value: count() })
  .from(messages)
  .where(since !== undefined ? gte(messages.createdAt, since) : undefined)
const totalMessages = msgCountRow?.value ?? 0

// 10 most recent messages with sender handle (optionally filtered)
const recentMsgs = await db
  .select({
    handle: socialProfiles.handle,
    body: messages.body,
    createdAt: messages.createdAt,
  })
  .from(messages)
  .leftJoin(socialProfiles, eq(messages.senderId, socialProfiles.accountId))
  .where(since !== undefined ? gte(messages.createdAt, since) : undefined)
  .orderBy(desc(messages.createdAt))
  .limit(10)

// ── build swipe-counts map ────────────────────────────────────────────────────
const swipeCounts: Record<string, number> = {}
for (const row of swipeRows) {
  swipeCounts[row.direction] = row.value
}

// ── output ────────────────────────────────────────────────────────────────────
if (jsonMode) {
  const payload = {
    ...(since !== undefined && { since: since.toISOString() }),
    totalAccounts,
    datingProfiles: profileRows.map((r) => ({
      firstName: r.firstName,
      handle: r.handle ?? null,
    })),
    swipes: swipeCounts,
    activeMatches,
    totalMessages,
    recentMessages: recentMsgs.map((m) => ({
      handle: m.handle ?? null,
      body: m.body.length > 80 ? `${m.body.slice(0, 77)}...` : m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  }
  console.log(JSON.stringify(payload, null, 2))
} else {
  const sinceLabel = since !== undefined ? ` (since ${since.toISOString()})` : ''
  console.log(`=== nearest-neighbor agent activity${sinceLabel} ===\n`)
  console.log(`Accounts:        ${totalAccounts}`)
  console.log(`Dating profiles: ${profileRows.length}`)

  if (profileRows.length > 0) {
    console.log('\nFirst Name     Handle')
    console.log('─'.repeat(36))
    for (const r of profileRows) {
      console.log(`${r.firstName.padEnd(14)} ${r.handle ?? '(no handle)'}`)
    }
  }

  console.log(`\nSwipes${sinceLabel}:`)
  const swipeEntries = Object.entries(swipeCounts)
  if (swipeEntries.length === 0) {
    console.log('  (none)')
  } else {
    for (const [dir, n] of swipeEntries) {
      console.log(`  ${dir}: ${n}`)
    }
  }

  console.log(`\nActive matches:  ${activeMatches}`)
  console.log(`Messages:        ${totalMessages}`)

  if (recentMsgs.length > 0) {
    console.log('\nRecent messages:')
    console.log(`  ${'Handle'.padEnd(16)}${'Body'.padEnd(52)}Created At`)
    console.log(`  ${'─'.repeat(80)}`)
    for (const m of recentMsgs) {
      const handle = (m.handle ?? '(unknown)').padEnd(16)
      const truncated = m.body.length > 50 ? `${m.body.slice(0, 47)}...` : m.body
      const body = truncated.padEnd(52)
      const ts = m.createdAt.toISOString()
      console.log(`  ${handle}${body}${ts}`)
    }
  }
}

// Close the pool so the process exits cleanly
await closeDbForTest()
