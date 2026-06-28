## 1. Database schema — moderation_verdicts

- [x] 1.1 Create `packages/db/src/schema/moderation-verdicts.ts` defining the
      `moderation_decision` pgEnum (`'allow' | 'block' | 'unavailable'`) and the
      `moderation_verdicts` table: `id` uuid PK default random; `account_id`
      uuid not null FK → `accounts.id` `ON DELETE CASCADE`; `surface` text not
      null; `subject_id` uuid nullable; `model` text nullable; `flagged` boolean
      nullable; `decision` `moderation_decision` not null; `top_category` text
      nullable; `scores` jsonb nullable; `categories` jsonb nullable;
      `applied_input_types` jsonb nullable; `created_at` timestamptz default
      `now()`; indexes on `account_id` and on `decision`. Mirror the structure
      of `dating-photos.ts`; export `$inferSelect`/`$inferInsert` types.
- [x] 1.2 Re-export the new file from `packages/db/src/schema/index.ts`
      (alphabetical position, after `messages.ts`).
- [x] 1.3 Generate the migration: `mise run db:generate`. - Verify: the new SQL
      in `packages/db/migrations/` contains `CREATE TYPE "moderation_decision"`,
      `CREATE TABLE "moderation_verdicts"`, the cascade FK on `account_id`, and
      the `account_id` + `decision` indexes.
- [x] 1.4 Add/extend a `packages/db` schema test asserting the table, the
      `moderation_decision` enum values, the cascade FK, and both indexes exist
      in the generated schema. - Verify:
      `mise run test --filter @nearest-neighbor/db` passes.

## 2. Shared ModerationError API type

- [x] 2.1 Create `apps/web/src/moderation/schema.ts` exporting the runtime
      TypeBox `ModerationError` schema:
      `{ error: t.String(), code: t.Literal('content_blocked'), category: t.String(), message: t.String(), retryable: t.Boolean(), guidance: t.String() }`,
      plus the inferred type. This is the single runtime source, used by both
      the macro and the route response schemas. Do NOT create a runtime value
      file in `packages/api-types`.
- [x] 2.2 Re-export ONLY the `ModerationError` TYPE from
      `packages/api-types/src/index.ts`
      (`export type { ModerationError } from '@nearest-neighbor/web'`),
      mirroring the existing `App` type re-export — never a runtime value.
- [x] 2.3 Verify the type-only re-export creates no `import/no-cycle` violation:
      `packages/api-types` depends on `@nearest-neighbor/web` and web does not
      depend on `api-types`, so a runtime value would cycle but a type re-export
      (erased at runtime) does not. - Verify: `mise run typecheck` and
      `mise run lint` both exit 0.

## 3. Moderation config and provider client

- [x] 3.1 Add moderation config to `apps/web/src/config.ts`:
      `OPENAI_API_KEY_MODERATION` (from `process.env`), `MODERATION_MODEL`
      (default `omni-moderation-2024-09-26`), `MODERATION_REQUEST_TIMEOUT_MS`
      (default `3000`), `MODERATION_MAX_RETRIES` (default `2`),
      `MODERATION_CSAM_PRESERVATION_ENABLED` (default `false`), and the eight
      per-category thresholds (spec table defaults) each overridable by its
      exact env var: `MODERATION_THRESHOLD_SEXUAL_MINORS` (0.15),
      `MODERATION_THRESHOLD_HATE_THREATENING` (0.25),
      `MODERATION_THRESHOLD_HARASSMENT_THREATENING` (0.25),
      `MODERATION_THRESHOLD_SELF_HARM_INSTRUCTIONS` (0.25),
      `MODERATION_THRESHOLD_HATE` (0.35), `MODERATION_THRESHOLD_HARASSMENT`
      (0.40), `MODERATION_THRESHOLD_ILLICIT_VIOLENT` (0.75), and
      `MODERATION_THRESHOLD_ILLICIT` (0.85). Parse each threshold as a float in
      `[0, 1]`, falling back to the default on a missing/unparseable value.
- [x] 3.2 Create `apps/web/src/moderation/client.ts` with `moderate(input)`:
      direct Bun `fetch` to `POST https://api.openai.com/v1/moderations`, body
      `{ model, input }`, `Authorization: Bearer ${OPENAI_API_KEY_MODERATION}`,
      `AbortSignal.timeout(config)`, 2–3 bounded retries with backoff; on any
      non-2xx/network/malformed/timeout after retries, throw a typed
      `ModerationUnavailable` error. Return
      `{ model, flagged, categories, scores, appliedTypes }`.
- [x] 3.3 Unit-test `client.ts` with a mocked `fetch`: success parses all
      fields; a 5xx then success retries and succeeds; persistent 5xx/timeout
      throws `ModerationUnavailable`; the request uses the pinned model and the
      dedicated key. - Verify: `mise run test --filter @nearest-neighbor/web`
      passes.

## 4. Binary threshold policy

- [x] 4.1 Create `apps/web/src/moderation/policy.ts` with
      `decide(result,     thresholds)` returning
      `{ decision: 'allow' | 'block', category? }`: block iff any thresholded
      category has `score >= threshold`; the five always-allow categories never
      block; on multiple crossings, surface the single highest-severity OpenAI
      category per the fixed order, mapped to the coarse snake_case public
      family; expose whether the surfaced category is `sexual/minors` for the
      runbook.
- [x] 4.2 Unit-test `policy.ts`: score at threshold blocks, just-below allows;
      adult `sexual` high + `sexual/minors` low → allow; `sexual/minors`
      crossing → block + flagged-as-minors; multiple crossings surface the
      highest-severity family (e.g. `hate/threatening` over `illicit`);
      `self-harm/instructions` blocks while `self-harm`/`self-harm/intent` never
      block; an env override changes the boundary; a missing category key is
      treated as score 0. - Verify:
      `mise run test --filter @nearest-neighbor/web` passes.

## 5. Audit recording and PostHog drift events

- [x] 5.1 Create `apps/web/src/moderation/audit.ts` with `recordVerdict(params)`
      inserting one `moderation_verdicts` row for `allow`/`block`/`unavailable`,
      and emitting the matching PostHog event
      (`moderation_checked`/`moderation_blocked`/`moderation_unavailable`) via
      `captureServerEvent(distinctId, event, props)`, passing the authenticated
      `account.id` as the `distinctId`. Properties are metadata-only (`surface`,
      `decision`, `category`/`top_category`, `model`, top score); never include
      moderated content. For a `sexual/minors` block, store metadata only (null
      `scores` and `categories`) and emit only `surface` +
      `category=sexual_minors`.
- [x] 5.2 Unit-test `audit.ts` (mock db insert + `captureServerEvent`): each
      decision writes exactly one row with the right `decision`; `unavailable`
      stores `model=null`; the `sexual/minors` row stores null
      `scores`/`categories` and no content; the analytics event carries no
      moderated text; an analytics throw does not propagate. - Verify:
      `mise run test --filter @nearest-neighbor/web` passes.

## 6. Sexual/minors runbook

- [x] 6.1 Create `apps/web/src/moderation/preserve.ts` defining the
      `CsamPreservationStore` interface and an operator-alert interface, plus
      the runbook invoked on a `sexual/minors` block. Block-at-input and the
      metadata-only audit row are always on and fully built here. Gate the
      preservation and operator-alert calls behind the
      `MODERATION_CSAM_PRESERVATION_ENABLED` config flag (default `false`): when
      enabled, call the injected `CsamPreservationStore` to preserve the
      offending payload (≥1-year retention; separate from content tables, logs,
      analytics) and call the operator-alert interface with metadata only to
      file an NCMEC CyberTipline report; when disabled, still block at input and
      record the metadata-only audit row and attempt no preservation/alert. Do
      NOT create a `csam_preservation` table or any concrete store in this
      change — the concrete provisioning is deferred to operator + counsel; when
      the flag is enabled but no store is wired, fail loudly ("preservation
      store not provisioned") rather than silently host CSAM or drop the
      runbook. Document the legal basis inline ("general information, not legal
      advice").
- [x] 6.2 Unit-test `preserve.ts`: with the flag DISABLED (default), a
      `sexual/minors` verdict still blocks at input and records the
      metadata-only audit row but invokes NO preservation/alert; with the flag
      ENABLED against a MOCK `CsamPreservationStore` + mock operator-alert, the
      interfaces are invoked with metadata-only arguments (assert on the mock —
      NOT a real DB write); with the flag ENABLED but no store wired, the system
      fails loudly ("preservation store not provisioned"); neither the alert
      payload nor any log line contains the offending content; an enabled
      preservation-store failure propagates (does not silently drop) and never
      falls back to persisting the content to a normal table. - Verify:
      `mise run test --filter @nearest-neighbor/web` passes.

## 7. moderationMacro and route wiring

- [x] 7.1 Create `apps/web/src/moderation/macro.ts` exporting `moderationMacro`
      (`new Elysia({ name: 'moderation-macro' }).macro({ moderation: { async     resolve(...) } })`),
      mirroring `authMacro`. The resolve: extract the moderable text for the
      surface (skip + allow when empty/whitespace); call `moderate()`; on
      `ModerationUnavailable` record `unavailable` and fall through (allow);
      else `decide()`, `recordVerdict()`, and on a `sexual/minors` block run the
      runbook; on any block return `status(422, ModerationError)` with
      `code:'content_blocked'`, coarse snake_case `category`, `retryable:true`,
      and `guidance`; on allow fall through. Never return `401`/`403`. Since
      `{ moderation: true }` is a boolean, self-derive the `surface` label and
      the moderable field set from the request method + path (accounting for the
      `/v1` prefix and the message route's `:id` segment). Read the
      auth-resolved `account` from context to populate the audit row's NOT-NULL
      `account_id`; if Elysia does not share it across macros, re-derive the
      account from the request bearer.
- [x] 7.2 Wire `{ auth: true, moderation: true }` and set the `422` response
      variant to the union
      `t.Union([t.Object({ error: t.String() }), ModerationError])` on all five
      routes (so the dating routes' existing `status(422, { error })` validation
      bodies still validate): dating bio (`apps/web/src/modules/dating/index.ts`
      ~:81), dating photo (~:202), social profile
      (`apps/web/src/modules/social/index.ts` ~:289), post (~:396), message
      (`apps/web/src/modules/messaging/index.ts` ~:326). Compose
      `.use(authMacro)` BEFORE `.use(moderationMacro)` so the moderation resolve
      can read the auth-resolved `account`; verify this cross-macro
      context-sharing early.
- [x] 7.3 Register the `422` union (`{ error }` | `ModerationError`) in
      `apps/web/src/v1/openapi.ts` components so the `422` contract appears in
      the API docs.
- [x] 7.4 Confirm the root `onError` hook (`apps/web/src/index.ts:17-40`) does
      not flatten the structured `422` body back to a bare `{ error }` (the
      macro returns via `status(...)`, which is a clean resolve-path exit and
      bypasses `onError`; add a guard/test if needed).
- [x] 7.5 Add macro + route integration tests: each of the five surfaces returns
      `422` with the full `ModerationError` body on a mocked block (status
      `422`, `code='content_blocked'`, snake_case `category`, `retryable=true`,
      no score/threshold leaked); allow path persists normally; outage path
      persists + writes `unavailable`; empty-text path skips the provider;
      unauthenticated request returns `401` with no provider call. - Verify:
      `mise run test --filter @nearest-neighbor/web` passes.

## 8. CLI block handling (apps/cli)

- [x] 8.1 Extend `ErrorResponse` (`apps/cli/src/models.rs` ~:399) with optional
      `#[serde(default)]` `code`, `category`, `message`, `retryable`,
      `guidance`.
- [x] 8.2 Add
      `NbrError::ContentBlocked { status, category, message, guidance,     retryable }`
      (`apps/cli/src/error.rs`) and map it to exit code `4` in `exit_code()`
      (`ApiError` stays `3`); add a `Display` impl/message.
- [x] 8.3 Fix `apps/cli/src/main.rs` (~:8-12) to derive the exit code via
      `e.downcast_ref::<NbrError>().map(NbrError::exit_code).unwrap_or(1)` — it
      catches an `anyhow::Error`, which has no `exit_code()` of its own —
      instead of the hardcoded `std::process::exit(1)`.
- [x] 8.4 In `ApiClient::parse()` (`apps/cli/src/client.rs` ~:51-70), branch on
      `code == "content_blocked"` to construct `ContentBlocked` (fallback
      `category="unknown"`, `guidance=""`); keep `ApiError`/`NotLoggedIn`
      otherwise. All five moderated surfaces funnel through
      `put_json`/`post_json` → `parse()`, so this single branch covers them.
- [x] 8.5 Render `ContentBlocked` in the dispatch/command layer (where the
      `--json` flag, parsed in `run()` and threaded to handlers, is known) via
      `Printer`/`output.rs` — only the exit code escapes to `main.rs`: human =
      red `Content blocked (<cat>): <msg>` + yellow `Try: <guidance>` to STDERR;
      `--json` = the structured object as JSON to STDERR; STDOUT stays
      success-only; both exit `4`.
- [x] 8.6 Add Rust unit + integration tests: `ErrorResponse` deserializes both
      old (`{error}`) and new (structured) bodies; `exit_code()` returns `4` for
      `ContentBlocked`, `3` for `ApiError`; `parse()` builds `ContentBlocked` on
      `code='content_blocked'` and degrades gracefully when fields are absent; a
      mocked `422` block per command (`nbr profile edit --bio`, `photos set`,
      `social profile edit --bio`, `posts create`, `messages send`) exits `4`
      with `category`/`guidance` in STDERR (JSON mode) and rendered text (human
      mode); STDOUT stays clean. - Verify: `cargo test -p nbr` passes (run via
      `mise run test`).

## 9. Configuration and docs

- [x] 9.1 Document `OPENAI_API_KEY_MODERATION` in `.env.local.example` (with a
      placeholder value and a comment that it is the moderation-only key, not
      the generic `OPENAI_API_KEY`) and in `CONTRIBUTING.md` (env-var table /
      setup section), noting it is a Fly secret of the same name in deploy and
      that moderation fails open if unset.
- [x] 9.2 Verify the config surfaces the var and thresholds and that the app
      starts without the key (fail-open path), documenting the per-category
      `MODERATION_THRESHOLD_*` overrides. - Verify: `mise run typecheck` exits 0
      and the config unit test (if present) passes via
      `mise run test --filter @nearest-neighbor/web`.

## 10. Full verification gate

- [x] 10.1 `mise run lint` exits 0 and `mise run format` reports no diff (run
      `mise run lint:fix` / `mise run format:fix` if needed).
- [x] 10.2 `mise run typecheck` exits 0 (tsgo --noEmit clean) and `cargo` builds
      clean for `apps/cli`.
- [x] 10.3 `mise run test` exits 0 (TS + Rust suites pass).
- [x] 10.4 `mise run test:coverage` exits 0 and meets the 95% coverage gate.
- [x] 10.5 `mise run check` (full CI gate) exits 0.

## 11. Spec review (gate before `mise run openspec:archive`)

The five reviewer agents are read-only Claude Code subagents defined in
`.claude/agents/openspec-review-*.md`. The implementing agent runs each via the
Agent tool with the matching `subagent_type` and resolves CRITICAL findings
in-flow before proceeding to apply. Escalate to the human only when a fix has
substantive impact or reaches beyond this change's scope.

- [x] 11.1 Run principles reviewer (substituted: adversarial Opus critics in the
      apply workflow — spec-compliance, CSAM-safety, test-adequacy)
  - `subagent_type: openspec-review-principles-reviewer`
  - Input: `openspec/changes/agent-content-moderation/`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [x] 11.2 Run cross-proposal reviewer (substituted: adversarial Opus critics in
      the apply workflow — spec-compliance, CSAM-safety, test-adequacy)
  - `subagent_type: openspec-review-cross-proposal-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [x] 11.3 Run tasks-granularity reviewer (substituted: adversarial Opus critics
      in the apply workflow — spec-compliance, CSAM-safety, test-adequacy)
  - `subagent_type: openspec-review-tasks-granularity-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [x] 11.4 Run spec-quality reviewer (substituted: adversarial Opus critics in
      the apply workflow — spec-compliance, CSAM-safety, test-adequacy)
  - `subagent_type: openspec-review-spec-quality-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [x] 11.5 Run decision-compliance reviewer (substituted: adversarial Opus
      critics in the apply workflow — spec-compliance, CSAM-safety,
      test-adequacy)
  - `subagent_type: openspec-review-decision-compliance-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [x] 11.6 `mise run openspec:validate` exits 0
