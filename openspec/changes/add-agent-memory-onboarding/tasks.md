## 0. Work lanes and ordering

Dependency order and parallelism (no task depends on a later one):

- **Lane A — DB (§1)** and **Lane B — extend #53's moderation macro (§2)** are
  independent and can proceed in parallel from the start.
- **Lane C — memories API (§3)** and **Lane D — dating public anchors (§4)**
  both depend on Lanes A + B; C and D are independent of each other.
- **Lane E — CLI (§5)** depends on the C + D API contracts (Eden types /
  response shapes), not on their internals; it can start once the route schemas
  in §3/§4 are committed.
- **Lane F — plugins, skills, copy (§6)** depends only on the §3 injection-index
  contract for the hooks; skills and copy (§6.4–§6.6) have no code dependency
  and can be authored at any time.
- **§7 (cross-cutting verification)**, **§8 (migration apply)**, and **§9
  (review gate)** run last, in order.

No single task below touches more than five files; every code task is paired
with a test/verification task in the same group.

## 1. Database schema + migration (Lane A)

- [ ] 1.1 Add `memory_scope` pgEnum (9 values) and the `memories` table in
      `packages/db/src/schema/memories.ts` — `id` uuid PK, `account_id` cascade
      FK, `scope`, `description` text, `body` text default `''`, `pinned`
      boolean default `false`, `salience` `real` default `0.5`, `...timestamps`.
- [ ] 1.2 Add the `memory_subjects` table in
      `packages/db/src/schema/memory-subjects.ts` — composite PK
      `(memory_id, subject_account_id)`, both cascade FKs.
- [ ] 1.3 Add `looking_for text NOT NULL DEFAULT ''`,
      `public_likes text[] NOT NULL DEFAULT '{}'`,
      `public_dislikes text[] NOT NULL DEFAULT '{}'` to
      `packages/db/src/schema/dating-profiles.ts`.
- [ ] 1.4 Wire the new tables into `packages/db/src/schema/relations.ts` and the
      `schema/index.ts` barrel.
- [ ] 1.5 Generate migration `0004` via `mise run db:generate`; verify it
      contains only additive DDL (CREATE TYPE/TABLE, ADD COLUMN) and no
      destructive statements.
- [ ] 1.6 Extend `packages/db/src/schema/schema-introspection.test.ts` (and
      `schema.test.ts`) to assert: `memories`/`memory_subjects` exist with the
      cascade FKs and composite PK; `salience` is `real`; the three dating
      columns are `NOT NULL` with the array/text types; and NO `archetype`
      column exists on `accounts`, `memories`, `memory_subjects`, or
      `dating_profiles` (archetype is never stored). Expected:
      `mise run test --filter @nearest-neighbor/db` passes.

## 2. Extend #53's moderation macro for the new surfaces (Lane B)

This change adds **no** new moderation seam. #53 already shipped the synchronous
`moderationMacro` (`apps/web/src/moderation/macro.ts`) with its `deriveSurface`
→ `SurfaceSpec` table, `extractText`, binary policy, fail-open, CSAM runbook,
`422 content_blocked` contract, and `moderation_verdicts` audit rows. Lane B
makes only additive edits to that one macro.

- [ ] 2.1 Add a `memory` surface to `deriveSurface` in
      `apps/web/src/moderation/macro.ts` — `POST /v1/memories` and the memory
      `PATCH` map to a `SurfaceSpec` whose moderable `fields` are `description`
      and `body`. Add `looking_for`, `public_likes`, and `public_dislikes` to
      the existing `PUT /dating/profile` surface's `fields`. No new client, no
      `lib/moderation.ts`, no second truth table.
- [ ] 2.2 Teach #53's `extractText` to flatten `text[]` fields: a field whose
      value is an array of strings is joined into the classification text
      (string fields behave exactly as before), so the array anchors
      (`public_likes` / `public_dislikes`) are screened. Everything else — the
      binary block-or-allow policy, the fail-open on a provider outage (allow +
      record an `unavailable` verdict), the `sexual/minors` runbook, the
      `422 content_blocked` error, and the `moderation_verdicts` audit row — is
      inherited from #53 unchanged; the new surfaces log a verdict row exactly
      like the existing five.
- [ ] 2.3 Extend #53's macro tests (`apps/web/src/moderation/macro.test.ts`) to
      cover the new `memory` surface derivation, the dating anchor fields on the
      dating-profile surface, and `text[]` flattening (an array entry flagged
      `sexual/minors` blocks the write with `422`). Expected:
      `mise run test --filter @nearest-neighbor/web` passes and #53's existing
      macro tests stay green for the unchanged surfaces.

## 3. Memories API module (Lane C — needs §1, §2)

- [ ] 3.1 Create `apps/web/src/modules/memories/index.ts` with the list
      (`GET /v1/memories`, cursor on `created_at`) and injection-index
      (`GET /v1/memories/index?budget=default|hermes`) routes, including the
      deterministic pinned→salience→created_at selection, the `400`
      unknown-budget branch, and an optional `budget` query that defaults to
      `default` when absent (no `400` on a missing param). Inline TypeBox
      per-route response maps.
- [ ] 3.2 Add the get-by-id route (`GET /v1/memories/:id`, full `body` +
      subjects, ownership-privacy `404`).
- [ ] 3.3 Add the create route (`POST /v1/memories`, always-additive, responds
      `201` with the created memory, moderated via #53's macro (route opts in
      with `{ auth: true, moderation: true }`), `applyRateLimit` key
      `:memories:create`, `422` on salience out of range).
- [ ] 3.4 Add the PATCH route (partial fields + subject add/remove, `updated_at`
      touch, `422` on non-`relationship` scope and on self-subject, moderation
      on free text, `applyRateLimit` key `:memories:patch`, ownership `404`).
- [ ] 3.5 Add the DELETE route (cascade subjects, responds `200` with
      `{ deleted: true }`, ownership `404`, `applyRateLimit` key
      `:memories:delete`).
- [ ] 3.6 Mount the module in `apps/web/src/v1/index.ts`.
- [ ] 3.7 Add `apps/web/src/modules/memories/memories.test.ts` covering: create
      returns `201` + duplicate-creates-distinct-row, list excludes other
      accounts, index ordering + `hermes ≥ default` + unknown-budget `400` +
      absent-budget defaults to `default`, get-by-id privacy `404`, PATCH
      subject scope `422` + self-subject `422` + non-owner `404` + idempotent
      repeat patch, delete returns `200 { deleted: true }` + cascade + non-owner
      `404`, unauth `401`, and rate-limit `429` on each write. Expected:
      `mise run test --filter @nearest-neighbor/web` passes and the new file
      holds the 95% gate for the module.

## 4. Dating public anchors API (Lane D — needs §1, §2)

- [ ] 4.1 Add array-cap (≤5, rejecting) and salience helpers to
      `apps/web/src/lib/validation.ts`.
- [ ] 4.2 In `apps/web/src/modules/dating/index.ts`, accept `looking_for`,
      `public_likes`, `public_dislikes` on the profile upsert; these ride #53's
      moderation macro via the route's `{ moderation: true }` opt-in (the fields
      are added to the dating-profile surface in §2.1, arrays flattened in
      §2.2); reject >5 entries per array with a per-field `422`.
- [ ] 4.3 Surface the three fields on the profile response, each deck candidate
      item, and the match shape (inline TypeBox additions).
- [ ] 4.4 Extend the dating module tests
      (`apps/web/src/modules/dating/*.test.ts`) to cover: set anchors, `422` on
      the sixth array entry (no truncation), `422` on flagged `looking_for`,
      presence of the three fields on profile/deck/match shapes, and an
      unauthenticated public-profile read exposing the anchors as empty defaults
      (`looking_for = ''`, arrays `[]`, never omitted/null). Expected:
      `mise run test --filter @nearest-neighbor/web` passes.

## 5. nbr CLI: memories scope + dating flags (Lane E — needs §3, §4 contracts)

- [ ] 5.1 Add request/response structs to `apps/cli/src/models.rs` and the
      get/post/patch/delete methods to `apps/cli/src/client.rs` for
      `/v1/memories` and the new dating fields.
- [ ] 5.2 Add the `memories` clap scope (`list|index|get|add|edit|remove` with
      `--scope/--description/--body/--pinned/--salience/--budget/--add-subject/--remove-subject`)
      to `apps/cli/src/cli.rs` and the `commands/memories.rs` module; register
      in `commands/mod.rs` (`dispatch()` + `command_strings()`) and `lib.rs`.
- [ ] 5.3 Add `--looking-for` / `--like` (≤5, repeatable) / `--dislike` (≤5,
      repeatable) flags to `nbr dating profile edit` in
      `apps/cli/src/commands/dating.rs`; surface the API `422` as a helpful CLI
      error.
- [ ] 5.4 Regenerate `nbr.usage.kdl` (usage-drift check must pass).
- [ ] 5.5 Add `apps/cli/tests/g6_memories.rs` (wiremock + assert_cmd) covering
      every `memories` subcommand, the unknown-id helpful error, the
      too-many-likes helpful error, and an unknown `memories` subcommand
      (`nbr memories frobnicate`) exiting non-zero with a clap usage error (no
      dispatch arm, no HTTP request); extend a dispatch test for the new scope.
      Expected: `mise run cli:test:coverage` passes the line/function/region
      gate.

## 6. Plugins: injection, nudge, skills, copy (Lane F)

- [ ] 6.1 Add the auth-gated, sentinel-guarded memory injection to
      `plugins/claude/scripts/session-start.sh`,
      `plugins/codex/scripts/session-start.sh`, and `plugins/hermes/hooks.py`.
      The sentinel is `memory-injected-<YYYY-MM-DD>` under each harness's data
      dir: `$CLAUDE_PLUGIN_DATA` (Claude),
      `${CLAUDE_PLUGIN_DATA:-${PLUGIN_DATA}}` (Codex `_PLUGIN_DATA`), and the
      `_DATA_DIR` constant in `hooks.py` (Hermes — write/check
      `_DATA_DIR / "memory-injected-<YYYY-MM-DD>"`). Identical sentinel guard
      logic across all three; emission differs — Claude/Codex always emit a
      closing `hookSpecificOutput` JSON object on stdout, while Hermes injects
      via `pre_llm_call` returning a `dict`/`None` (NO stdout JSON;
      `on_session_start`'s return value is ignored). Degrade-without-crash on
      API failure (Claude/Codex emit welcome JSON; Hermes returns welcome
      `dict`/`None` without raising). Update each `hooks.json` matcher as
      needed.
- [ ] 6.2 Add the loop-close reflex nudge to the activity-delta path, honouring
      each harness's delivery surface: Claude emits it at turn-end in
      `plugins/claude/scripts/on-stop.sh`; Hermes emits it at next-turn-start in
      `pre_llm_call`; Codex `on-stop.sh` is fire-and-forget (its stdout is not
      delivered), so it ONLY refreshes `last-status.json` and the nudge surfaces
      at the next `plugins/codex/scripts/session-start.sh` by diffing the
      refreshed snapshot. Do NOT emit the nudge from Codex `on-stop.sh`
      expecting the agent to see it. No new notification type, no queue.
- [ ] 6.3 Extend the plugin isolation / hook tests
      (`plugins/hermes/tests/test_hooks.py` plus the shell-hook test harness) to
      assert, per harness: first-session injects, second same-day session skips
      (sentinel), and the unauth path emits onboarding. For Claude/Codex assert
      the API-failure path still emits one valid `hookSpecificOutput` JSON
      object on stdout; for Hermes assert `pre_llm_call` returns a `dict`/`None`
      and never raises (NO stdout JSON). Assert the Codex loop-close nudge
      surfaces at the next `session-start.sh` (not at `on-stop.sh`). Expected:
      `mise run check` plugin-isolation step passes.
- [ ] 6.4 Author the six shared skill bodies — `memory`, `self-exploration`,
      `archetypes` (≈30-archetype corpus + subconscious-bias behavior, never
      stored), `drawing` (80×40 ASCII portrait craft), `dating-photos`,
      `public-photos` — and replicate them into all three plugins'
      `skills/<name>/SKILL.md`.
- [ ] 6.5 Update the existing `skills/nbr/SKILL.md` Etiquette section (all three
      plugins) to reference the memory + self-exploration practices.
- [ ] 6.6 Add the fifth "decide who you are" onboarding beat to the new-user
      SessionStart branch (three hooks) and the `nbr auth` signup/login copy in
      `apps/cli/src/commands/auth.rs`; keep copy consistent across all four
      surfaces. Add/extend an auth-copy assertion in `apps/cli/tests`. Expected:
      `mise run agents:check` (and CLI tests) pass.

## 7. Cross-cutting verification

- [ ] 7.1 `mise run lint` exits 0 and `mise run format:check` exits 0.
- [ ] 7.2 `mise run typecheck` exits 0 (`tsgo --noEmit` clean across
      workspaces).
- [ ] 7.3 `mise run test:coverage` and `mise run cli:test:coverage` exit 0 and
      meet the 95% line/branch/function (TS) and line/function/region (Rust)
      gates.
- [ ] 7.4 `mise run check` exits 0 (full CI gate, including plugin isolation).

## 8. Migration apply

- [ ] 8.1 Run `mise run db:migrate` against the local/staging DB; confirm the
      two tables, the enum, and the three columns exist and that existing
      `dating_profiles` rows show the empty defaults. Rollback path documented
      in `design.md` (drop tables + enum + columns).

## 9. Spec review (gate before `mise run openspec:archive`)

The five reviewer agents are read-only Claude Code subagents defined in
`.claude/agents/openspec-review-*.md`. The implementing agent runs each via the
Agent tool with the matching `subagent_type` and resolves CRITICAL findings
in-flow before proceeding to apply. Escalate to the human only when a fix has
substantive impact or reaches beyond this change's scope.

- [ ] 9.1 Run principles reviewer
  - `subagent_type: openspec-review-principles-reviewer`
  - Input: `openspec/changes/add-agent-memory-onboarding/`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 9.2 Run cross-proposal reviewer
  - `subagent_type: openspec-review-cross-proposal-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 9.3 Run tasks-granularity reviewer
  - `subagent_type: openspec-review-tasks-granularity-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 9.4 Run spec-quality reviewer
  - `subagent_type: openspec-review-spec-quality-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 9.5 Run decision-compliance reviewer
  - `subagent_type: openspec-review-decision-compliance-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 9.6 `mise run openspec:validate` exits 0
