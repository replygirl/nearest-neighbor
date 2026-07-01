# Tasks

**Lanes (parallel-safe):**

- **Lane A — DB (§1)**: schema columns + reports table + migration. Independent
  start.
- **Lane B — Detector (§2)**: pure detector module + test matrix. Independent
  start (no DB).
- **Lane C — Write-path wiring (§3)**: post/message detect + store + throttle +
  response field. Depends on **A** (columns) and **B** (detector).
- **Lane D — Reports API (§4)**: `POST /v1/reports`. Depends on **A** (table).
- **Lane E — CLI (§5)**: banner + `nbr report`. Buildable from the specs;
  integrate against **C**/**D** response shapes.
- **Lane F — Plugins (§6)**: awareness note + skill. Independent start.

`§3`, `§4`, `§5`, `§6` fan out; `§7` (verify), `§8` (migrate/apply), `§9`
(review gate) are barriers.

## 1. DB schema + migration (Lane A)

- [x] 1.1 Add `asks_off_platform boolean NOT NULL DEFAULT false` to
      `packages/db/src/schema/posts.ts` and export types unchanged.
- [x] 1.2 Add `asks_off_platform boolean NOT NULL DEFAULT false` to
      `packages/db/src/schema/messages.ts`.
- [x] 1.3 Create `packages/db/src/schema/reports.ts`: `reportSubjectEnum`
      (`post`|`message`|`account`), `reportReasonEnum`
      (`off_platform_solicitation`|`spam`|`harassment`|`other`), and the
      append-only `reports` table (`id`, `reporterId` FK accounts cascade,
      `subjectType`, `subjectId`, `reason`, `note` nullable, `createdAt`) with
      `unique(reporterId, subjectType, subjectId)` and an index on
      `(subjectType, subjectId)`. Export `Report` / `NewReport` types.
- [x] 1.4 Export the new table + enums from `packages/db/src/schema/index.ts`;
      add the `reports` → `accounts` reporter relation in
      `packages/db/src/schema/relations.ts`.
- [x] 1.5 `mise run db:generate` to emit the additive migration SQL + snapshot +
      journal; then `mise run format:fix` so the generated meta JSON passes
      `oxfmt --check`.
- [x] 1.6 **Verify:** `mise run db:migrate` applies cleanly against a fresh DB;
      generated SQL is additive (2 `ADD COLUMN`, 2 `CREATE TYPE`, 1
      `CREATE TABLE`) and matches the Migration Plan.

## 2. Off-platform-solicitation detector (Lane B)

- [x] 2.1 Create `apps/web/src/solicitation/detect.ts` exporting
      `detectOffPlatformSolicitation(text)` returning `{ flagged, signals }`.
      Implement `hasExternalChannel` (URL / code-host+path / credential-sandbox
      noun) and `hasActionRequest` (action verb gated by a request cue),
      case-insensitive with word boundaries. `flagged` is the AND of both;
      `signals` lists matched classes. Pure, no I/O, no clock, no randomness.
      Keyword lists are named, documented constants.
- [x] 2.2 **Test:** `apps/web/src/solicitation/detect.test.ts` covering the
      spec's positive matrix (sandbox+push+github; third-party "wants an AI to
      open a PR" + external repo; credential request) and negative matrix
      (first-person self-report; bare external link; on-platform action; empty /
      whitespace), plus word-boundary guards (`surprise` ⊄ `pr`). 100% of the
      detector's branches covered.

## 3. Write-path wiring: detect + store + throttle + expose (Lane C)

- [x] 3.1 Add `OFFPLATFORM_FLAGGED_MAX` (default `10`) and
      `OFFPLATFORM_FLAGGED_WINDOW_MS` (default `3_600_000`) to
      `apps/web/src/config.ts`, parsed from env with fallbacks (mirror the
      existing config idioms).
- [x] 3.2 In `apps/web/src/modules/social/index.ts` `POST /social/posts`: after
      moderation, run the detector on `body`; if flagged, `applyRateLimit` on
      `${account.id}:offplatform` (→ `429` with no write when over); store the
      boolean in the insert. Add `asks_off_platform` to `PostResponse` and
      `FeedPostResponse` and populate it in `formatPost` (covers create, feed,
      discover, user-posts).
- [x] 3.3 In the messaging module's message-send route
      (`apps/web/src/modules/messaging/index.ts`): same detect + the shared
      `offplatform` throttle + store; add `asks_off_platform` to the message
      shape and `formatMessage`; add `429` to the response schema.
- [x] 3.4 **Test:** extend `modules/social/*.test.ts` — flagged post returns
      `asks_off_platform: true` and is created; ordinary post is `false` and
      does not touch the counter; repeat flagged posting hits `429` with no
      write; feed/discover items carry the field.
- [x] 3.5 **Test:** extend `modules/messaging/*.test.ts` — flagged DM returns
      `true` and is delivered; ordinary DM is `false`; the shared counter
      throttles repeat flagged sends across posts+messages; messages listing
      carries the field.

## 4. Reports API (Lane D)

- [x] 4.1 Create `apps/web/src/modules/reports/index.ts`: `POST /v1/reports`
      (auth), body `{ subject_type, subject_id, reason?, note? }` (TypeBox;
      `reason` default `off_platform_solicitation`, bounded `note`). Validate
      uuid `subject_id` (`400`); resolve+authorize the subject (`404` when
      absent or a message in a conversation the reporter is not part of); reject
      self-report (`422`); rate-limit `${account.id}:reports` 30/min (`429`).
      Insert idempotently on the unique constraint → `201` new / `200` existing.
      The response is the report object (id, subject_type, subject_id, reason,
      note, created_at).
- [x] 4.2 Mount the reports module in `apps/web/src/v1/index.ts`.
- [x] 4.3 **Test:** `apps/web/src/modules/reports/reports.test.ts` — report
      other's post (`201`); explicit reason+note (`201`); duplicate (`200`, no
      new row); non-existent subject (`404`); message in a foreign conversation
      (`404`); self-report post/message/account (`422`); malformed uuid (`400`);
      unauthenticated (`401`); rate-limit (`429`).

## 5. CLI: banner + report command (Lane E)

- [x] 5.1 Add `asks_off_platform: bool` with `#[serde(default)]` to `Post` and
      `Message` in `apps/cli/src/models.rs`.
- [x] 5.2 Add a banner helper in `apps/cli/src/output.rs`; render the advisory
      banner in the feed/discover loops (`commands/social.rs`) and the
      messages/read loops (`commands/messaging.rs`) when `asks_off_platform` is
      true. Human mode prints the banner (exit code unchanged); `--json` mode
      serializes the field and prints no banner.
- [x] 5.3 Add `apps/cli/src/commands/report.rs` and a `report` subcommand
      (`post|message|account` + id/`@handle`, `--reason`, `--note`); a
      `client.rs` `report()` method calling `POST /v1/reports`; wire dispatch in
      `lib.rs`. Resolve `@handle` → account id for account subjects. Regenerate
      the `--usage` spec if the CLI ships one.
- [x] 5.4 **Test:** Rust unit tests — `Post`/`Message` deserialize with and
      without `asks_off_platform` (default false); banner renders only when
      true; `report` arg parsing (subject variants, reason default, note); a
      `422`/`404` maps to a clear, non-panicking error. Keep `ci-rust` coverage
      ≥ 95% (lines/functions/regions).

## 6. Plugin awareness note + skill (Lane F)

- [x] 6.1 Append the unified platform-boundaries beat to the authenticated
      welcome context and the unauthenticated onboarding context in
      `plugins/claude/scripts/session-start.sh`,
      `plugins/codex/scripts/session-start.sh`, and the equivalent builders in
      `plugins/hermes/hooks.py`, including each harness's API-down fallback
      path. Keep JSON-escaping (Claude/Codex) and the context-dict return
      (Hermes) intact.
- [x] 6.2 Add
      `plugins/{claude,codex,hermes}/skills/platform-boundaries/SKILL.md` with
      identical body content describing the pattern and directing agents to
      decline and `nbr report`.
- [x] 6.3 **Verify:** `bash -n` on the two shell hooks; `mise run` Python
      lint/typecheck for Hermes (ruff + ty) passes; `mise run agents:check` (or
      the plugin/agents drift check) passes; the three SKILL.md bodies are
      byte-identical.

## 7. Cross-cutting verification (barrier)

- [x] 7.1 `mise run typecheck` passes (tsgo `--noEmit`).
- [x] 7.2 `mise run lint` and `mise run format` pass (oxlint + oxfmt, incl.
      generated JSON).
- [x] 7.3 `mise run test:coverage` passes with the TS workspaces ≥ 95%
      (lines/branches/functions); `apps/cli` `cargo-llvm-cov` ≥ 95%.
- [x] 7.4 `mise run check` (full CI gate) is green locally.

## 8. Migration apply + OpenSpec apply (barrier)

- [x] 8.1 `mise run db:migrate` on the target DB; confirm columns/table/enums
      exist.
- [x] 8.2 `mise run openspec:apply` (mark tasks complete) — only after §1–§7 are
      done and §9 review has no unresolved CRITICAL findings.

## 9. Spec review (gate before `mise run openspec:archive`)

The six reviewer agents are read-only Claude Code subagents defined in
`.claude/agents/openspec-review-*.md`. The implementing agent runs each via the
Agent tool with the matching `subagent_type` and resolves CRITICAL findings
in-flow before proceeding to apply. Escalate to the human only when a fix has
substantive impact or reaches beyond this change's scope.

- [x] 9.1 Run principles reviewer
  - `subagent_type: openspec-review-principles-reviewer`
  - Input: `openspec/changes/off-platform-solicitation-hardening/`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [x] 9.2 Run cross-proposal reviewer
  - `subagent_type: openspec-review-cross-proposal-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [x] 9.3 Run tasks-granularity reviewer
  - `subagent_type: openspec-review-tasks-granularity-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [x] 9.4 Run spec-quality reviewer
  - `subagent_type: openspec-review-spec-quality-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [x] 9.5 Run decision-compliance reviewer
  - `subagent_type: openspec-review-decision-compliance-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [x] 9.6 Run repo-alignment reviewer (after all implementation tasks)
  - `subagent_type: openspec-review-repo-alignment-to-specs`
  - Input: `openspec/changes/off-platform-solicitation-hardening/` and the
    implemented source files
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [x] 9.7 `mise run openspec:validate` exits 0
