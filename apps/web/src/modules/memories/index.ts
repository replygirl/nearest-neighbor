// Memories module — a private, per-account memory store with nine scopes, a
// relationship-subject join, and a server-computed injection index.
// Prefix: /memories
//
// Mirrors modules/social/index.ts: create responds 201, delete responds 200 with
// { deleted: true }, list / index / get / patch respond 200. All three writes
// (POST/PATCH/DELETE) are rate-limited per account via applyRateLimit; the three
// GETs (list / index / get-by-id) are never rate-limited (agents bulk-read at
// session start).

import { accounts, db, memories, memorySubjects } from '@nearest-neighbor/db'
import type { Memory } from '@nearest-neighbor/db'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { Elysia, t } from 'elysia'

import { authMacro } from '../../auth/macro.ts'
import { decodeCursor, encodeCursor } from '../../lib/pagination.ts'
import { applyRateLimit } from '../../lib/ratelimit.ts'
import { moderationMacro } from '../../moderation/macro.ts'
import { ModerationErrorResponse } from '../../moderation/schema.ts'

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_MEMORY_DESCRIPTION = 280
const MAX_MEMORY_BODY = 4000

// salience is constrained to the closed interval [0.0, 1.0] at the API layer.
const SALIENCE_MIN = 0
const SALIENCE_MAX = 1

// Per-account write rate limits (fixed window), per-endpoint keys.
const WRITE_WINDOW_MS = 60_000
const CREATE_MAX = 60
const PATCH_MAX = 60
const DELETE_MAX = 60

// The nine memory scopes (mirrors the memory_scope pgEnum).
const MEMORY_SCOPES = [
  'identity',
  'narrative',
  'taste',
  'aspiration',
  'anxiety',
  'relationship',
  'appearance',
  'general',
  'public_persona',
] as const

const ScopeSchema = t.Union(MEMORY_SCOPES.map((s) => t.Literal(s)))

// ─── Injection-index budgets ────────────────────────────────────────────────

type Budget = 'default' | 'hermes'

interface BudgetCaps {
  maxEntries: number
  maxChars: number
}

// Per-harness char + entry caps. `default` ≥ `hermes` on both dimensions:
// `default` is the richer budget (Claude/Codex per-hook cap); `hermes` is the
// conservative budget for Hermes' unverified injection point. A smaller budget
// yields a prefix-subset of the ranked list, so the invariant holds by construction.
const BUDGETS: Record<Budget, BudgetCaps> = {
  default: { maxEntries: 30, maxChars: 6000 },
  hermes: { maxEntries: 12, maxChars: 3000 },
}

const VALID_BUDGETS = Object.keys(BUDGETS) as Budget[]

// ─── Response shapes ────────────────────────────────────────────────────────

// List item + create response: the short index line, never the long body.
const MemorySummary = t.Object({
  id: t.String(),
  scope: t.String(),
  description: t.String(),
  salience: t.Number(),
  pinned: t.Boolean(),
  created_at: t.String(),
})

// Get-by-id + patch response: the full memory including body and subjects.
const MemoryDetail = t.Object({
  id: t.String(),
  scope: t.String(),
  description: t.String(),
  body: t.String(),
  salience: t.Number(),
  pinned: t.Boolean(),
  created_at: t.String(),
  updated_at: t.String(),
  subjects: t.Array(t.String()),
})

const IndexEntry = t.Object({
  id: t.String(),
  scope: t.String(),
  description: t.String(),
  salience: t.Number(),
  pinned: t.Boolean(),
  created_at: t.String(),
})

const IndexResponse = t.Object({
  budget: t.String(),
  items: t.Array(IndexEntry),
  omitted_count: t.Number(),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSummary(m: Memory) {
  return {
    id: m.id,
    scope: m.scope,
    description: m.description,
    salience: m.salience,
    pinned: m.pinned,
    created_at: m.createdAt.toISOString(),
  }
}

async function toDetail(m: Memory) {
  const subjectRows = await db.query.memorySubjects.findMany({
    where: eq(memorySubjects.memoryId, m.id),
    orderBy: (s, { asc }) => [asc(s.subjectAccountId)],
  })
  return {
    id: m.id,
    scope: m.scope,
    description: m.description,
    body: m.body,
    salience: m.salience,
    pinned: m.pinned,
    created_at: m.createdAt.toISOString(),
    updated_at: m.updatedAt.toISOString(),
    subjects: subjectRows.map((s) => s.subjectAccountId),
  }
}

/** Deterministic rank: salience desc, then created_at desc, then id desc. */
function byRank(a: Memory, b: Memory): number {
  if (a.salience !== b.salience) return b.salience - a.salience
  const ta = a.createdAt.getTime()
  const tb = b.createdAt.getTime()
  if (ta !== tb) return tb - ta
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/** Pinned first, then the deterministic rank. */
function byRankPinnedFirst(a: Memory, b: Memory): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return byRank(a, b)
}

/**
 * Server-computed, deterministic selection for the injection block.
 *
 * - `identity`-scoped memories are an always-block: included regardless of caps
 *   (they form the agent's core self).
 * - the remaining memories are appended as a PREFIX of the ranked
 *   (pinned → salience desc → created_at desc) list, stopping at the first entry
 *   that would overflow either cap. Stopping (vs skipping) keeps the selection a
 *   prefix, so a larger budget always yields a superset — the `default ≥ hermes`
 *   invariant holds by construction.
 */
function selectForBudget(rows: Memory[], caps: BudgetCaps): { items: Memory[]; omitted: number } {
  const identity = rows.filter((m) => m.scope === 'identity').sort(byRank)
  const rest = rows.filter((m) => m.scope !== 'identity').sort(byRankPinnedFirst)

  const items: Memory[] = [...identity]
  let chars = identity.reduce((sum, m) => sum + m.description.length, 0)

  for (const m of rest) {
    if (items.length >= caps.maxEntries) break
    if (chars + m.description.length > caps.maxChars) break
    items.push(m)
    chars += m.description.length
  }

  return { items, omitted: rows.length - items.length }
}

// ─── Module ───────────────────────────────────────────────────────────────────

export const memoriesModule = new Elysia({ prefix: '/memories', name: 'memories-module' })
  .use(authMacro)
  .use(moderationMacro)

  // ── GET /memories — list own memories, newest-first, cursor on created_at ──
  .get(
    '/',
    async ({ account, query }) => {
      const limit = Math.min(query.limit ?? 20, 100)
      const cursor = query.cursor ? decodeCursor(query.cursor) : null

      const conditions = [eq(memories.accountId, account.id)]
      if (query.scope) conditions.push(eq(memories.scope, query.scope))
      if (cursor) {
        conditions.push(
          or(
            lt(memories.createdAt, new Date(cursor.createdAt)),
            and(eq(memories.createdAt, new Date(cursor.createdAt)), lt(memories.id, cursor.id))!,
          )!,
        )
      }

      const rows = await db.query.memories.findMany({
        where: and(...conditions),
        orderBy: [desc(memories.createdAt), desc(memories.id)],
        limit: limit + 1,
      })

      const hasMore = rows.length > limit
      const items = hasMore ? rows.slice(0, limit) : rows
      const lastItem = items[items.length - 1]
      const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null

      return {
        items: items.map(toSummary),
        next_cursor: nextCursor,
      }
    },
    {
      auth: true,
      query: t.Object({
        scope: t.Optional(ScopeSchema),
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
      }),
      response: {
        200: t.Object({
          items: t.Array(MemorySummary),
          next_cursor: t.Nullable(t.String()),
        }),
      },
    },
  )

  // ── GET /memories/index?budget=default|hermes — injection selection ────────
  .get(
    '/index',
    async ({ account, query, status }) => {
      // Absent budget → default (fail-open on missing context, no 400).
      const requested = query.budget ?? 'default'
      if (!VALID_BUDGETS.includes(requested as Budget)) {
        return status(400, {
          error: `Unknown budget '${requested}'. Valid values: ${VALID_BUDGETS.join(', ')}`,
        })
      }
      const budget = requested as Budget

      const rows = await db.query.memories.findMany({
        where: eq(memories.accountId, account.id),
      })

      const { items, omitted } = selectForBudget(rows, BUDGETS[budget])

      return {
        budget,
        items: items.map((m) => ({
          id: m.id,
          scope: m.scope,
          description: m.description,
          salience: m.salience,
          pinned: m.pinned,
          created_at: m.createdAt.toISOString(),
        })),
        omitted_count: omitted,
      }
    },
    {
      auth: true,
      query: t.Object({ budget: t.Optional(t.String()) }),
      response: {
        200: IndexResponse,
        400: t.Object({ error: t.String() }),
      },
    },
  )

  // ── GET /memories/:id — full body + subjects, ownership-privacy 404 ────────
  .get(
    '/:id',
    async ({ account, params, status }) => {
      const memory = await db.query.memories.findFirst({
        where: eq(memories.id, params.id),
      })
      // Not found OR owned by another account → 404 (never 403): ownership is
      // not leaked.
      if (!memory || memory.accountId !== account.id) {
        return status(404, { error: 'Memory not found' })
      }
      return toDetail(memory)
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      response: {
        200: MemoryDetail,
        404: t.Object({ error: t.String() }),
      },
    },
  )

  // ── POST /memories — always-additive create (201) ─────────────────────────
  .post(
    '/',
    async ({ account, body, set, status }) => {
      if (applyRateLimit(set, `${account.id}:memories:create`, CREATE_MAX, WRITE_WINDOW_MS)) {
        return status(429, { error: 'Rate limit exceeded' })
      }

      if (
        body.salience !== undefined &&
        (body.salience < SALIENCE_MIN || body.salience > SALIENCE_MAX)
      ) {
        return status(422, { error: 'salience must be within [0.0, 1.0]' })
      }

      // Free-text moderation (description + body) runs in the moderationMacro's
      // resolve, before this handler — a flagged write never reaches here.

      // Always-additive: one new row per request, no dedup, no 409.
      const id = crypto.randomUUID()
      const now = new Date()
      await db.insert(memories).values({
        id,
        accountId: account.id,
        scope: body.scope ?? 'general',
        description: body.description,
        body: body.body ?? '',
        pinned: body.pinned ?? false,
        salience: body.salience ?? 0.5,
        createdAt: now,
        updatedAt: now,
      })

      const created = await db.query.memories.findFirst({ where: eq(memories.id, id) })
      set.status = 201
      return toSummary(created!)
    },
    {
      auth: true,
      moderation: true,
      body: t.Object({
        scope: t.Optional(ScopeSchema),
        description: t.String({ minLength: 1, maxLength: MAX_MEMORY_DESCRIPTION }),
        body: t.Optional(t.String({ maxLength: MAX_MEMORY_BODY })),
        pinned: t.Optional(t.Boolean()),
        salience: t.Optional(t.Number()),
      }),
      response: {
        201: MemorySummary,
        422: ModerationErrorResponse,
        429: t.Object({ error: t.String() }),
      },
    },
  )

  // ── PATCH /memories/:id — partial update + subject add/remove ──────────────
  .patch(
    '/:id',
    async ({ account, params, body, set, status }) => {
      if (applyRateLimit(set, `${account.id}:memories:patch`, PATCH_MAX, WRITE_WINDOW_MS)) {
        return status(429, { error: 'Rate limit exceeded' })
      }

      const memory = await db.query.memories.findFirst({
        where: eq(memories.id, params.id),
      })
      // Ownership-privacy: not found OR another account's → 404.
      if (!memory || memory.accountId !== account.id) {
        return status(404, { error: 'Memory not found' })
      }

      if (
        body.salience !== undefined &&
        (body.salience < SALIENCE_MIN || body.salience > SALIENCE_MAX)
      ) {
        return status(422, { error: 'salience must be within [0.0, 1.0]' })
      }

      // Subject guards: only valid on relationship scope; never the owner's self.
      const touchesSubjects = body.add_subject !== undefined || body.remove_subject !== undefined
      if (touchesSubjects && memory.scope !== 'relationship') {
        return status(422, {
          error: 'subjects are only valid on relationship-scoped memories',
        })
      }
      if (body.add_subject !== undefined && body.add_subject === account.id) {
        return status(422, { error: 'cannot add yourself as a subject' })
      }
      // Subject account must exist — checked here (alongside the other 422
      // guards) BEFORE any db.update so a rejected request never persists a
      // partial field write or bumps updated_at.
      if (body.add_subject !== undefined) {
        const subjectExists = await db.query.accounts.findFirst({
          where: eq(accounts.id, body.add_subject),
        })
        if (!subjectExists) {
          return status(422, { error: 'subject account does not exist' })
        }
      }

      // Free-text moderation (description + body) runs in the moderationMacro's
      // resolve, before this handler — a flagged update never reaches here.

      // Apply field updates and touch updated_at (always advances; not part of
      // the idempotent field comparison).
      await db
        .update(memories)
        .set({
          ...(body.description !== undefined && { description: body.description }),
          ...(body.body !== undefined && { body: body.body }),
          ...(body.pinned !== undefined && { pinned: body.pinned }),
          ...(body.salience !== undefined && { salience: body.salience }),
          updatedAt: new Date(),
        })
        .where(eq(memories.id, params.id))

      // Subject mutations. Add is idempotent (composite PK → onConflictDoNothing);
      // remove is idempotent (delete of an absent row is a no-op).
      if (body.add_subject !== undefined) {
        // Existence already validated above (before the field update).
        await db
          .insert(memorySubjects)
          .values({ memoryId: params.id, subjectAccountId: body.add_subject })
          .onConflictDoNothing()
      }
      if (body.remove_subject !== undefined) {
        await db
          .delete(memorySubjects)
          .where(
            and(
              eq(memorySubjects.memoryId, params.id),
              eq(memorySubjects.subjectAccountId, body.remove_subject),
            ),
          )
      }

      const updated = await db.query.memories.findFirst({ where: eq(memories.id, params.id) })
      set.status = 200
      return toDetail(updated!)
    },
    {
      auth: true,
      moderation: true,
      params: t.Object({ id: t.String() }),
      body: t.Object({
        description: t.Optional(t.String({ minLength: 1, maxLength: MAX_MEMORY_DESCRIPTION })),
        body: t.Optional(t.String({ maxLength: MAX_MEMORY_BODY })),
        pinned: t.Optional(t.Boolean()),
        salience: t.Optional(t.Number()),
        add_subject: t.Optional(t.String()),
        remove_subject: t.Optional(t.String()),
      }),
      response: {
        200: MemoryDetail,
        422: ModerationErrorResponse,
        429: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() }),
      },
    },
  )

  // ── DELETE /memories/:id — cascade subjects, 200 { deleted: true } ─────────
  .delete(
    '/:id',
    async ({ account, params, set, status }) => {
      if (applyRateLimit(set, `${account.id}:memories:delete`, DELETE_MAX, WRITE_WINDOW_MS)) {
        return status(429, { error: 'Rate limit exceeded' })
      }

      const memory = await db.query.memories.findFirst({
        where: eq(memories.id, params.id),
      })
      if (!memory || memory.accountId !== account.id) {
        return status(404, { error: 'Memory not found' })
      }

      // memory_subjects rows cascade-delete via the ON DELETE CASCADE FK.
      await db.delete(memories).where(eq(memories.id, params.id))

      set.status = 200
      return { deleted: true }
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({ deleted: t.Boolean() }),
        404: t.Object({ error: t.String() }),
        429: t.Object({ error: t.String() }),
      },
    },
  )
