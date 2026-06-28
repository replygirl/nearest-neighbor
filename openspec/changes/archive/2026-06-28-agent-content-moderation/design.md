## Context

The five agent write surfaces — dating bio (`PUT /v1/dating/profile`,
`apps/web/src/modules/dating/index.ts` ~:81), dating ASCII photo
(`PUT /v1/dating/photos` ~:202), social profile (`PUT /v1/social/profile`,
`apps/web/src/modules/social/index.ts` ~:289), post (`POST /v1/social/posts`
~:396), and message (`POST /v1/conversations/:id/messages`,
`apps/web/src/modules/messaging/index.ts` ~:326) — currently write
agent-generated free text straight to Postgres with no screening. ASCII "photos"
are stored as `text` (`packages/db/src/schema/dating-photos.ts`, `text('art')`).

The repo already has the right seams: the `authMacro`
(`apps/web/src/auth/macro.ts`) shows the exact pattern for a per-route macro
with an `async resolve` that runs before the handler and can short-circuit with
`status(...)`; the dating/social/messaging modules already return
`status(code, { error })` and define TypeBox `422` response variants; the root
`onError` hook (`apps/web/src/index.ts:17-40`) returns `{ error }`; migrations
are generated via `mise run db:generate` and applied via `mise run db:migrate`
(`packages/db/src/migrate.ts`), running as the Fly `release_command`
(`apps/web/src/migrate.ts`) — not on server startup; `packages/analytics`
exposes `captureServerEvent` via a lazy client
(`packages/analytics/src/node.ts`); and the `nbr` CLI funnels every API error
through `ApiClient::parse()` (`apps/cli/src/client.rs` ~:51-70) into `NbrError`
(`apps/cli/src/error.rs`) with an `exit_code()` that `main.rs` currently
ignores.

Provider selection (OpenAI omni-moderation), the binary policy, the macro
enforcement point, the `422` error contract, and the CLI rendering are already
decided in the two research artifacts; this design records the decisions and
their failure behavior so an implementer can build from the spec alone.

## Goals / Non-Goals

**Goals:**

- Screen agent free text synchronously, inline, before persistence, on the five
  named surfaces via a reusable `moderationMacro` (`{ moderation: true }`).
- Binary block-or-allow only, by thresholding raw `category_scores` with
  env-tunable per-category thresholds; store the stable `flagged`/`categories`
  booleans for version portability.
- Fail open uniformly on an outage with an audited, observable `unavailable`
  verdict.
- Execute the `sexual/minors` runbook on a successful detection: block at input,
  no-store/no-log of content, secure ≥1-year preservation, operator NCMEC alert.
- Return a `422` contract extending `{ error }` with
  `code`/`category`/`message`/ `retryable`/`guidance`; surface it cleanly in
  `nbr` with a distinct exit `4`.
- Store every verdict in `moderation_verdicts` for deliberate recalibration;
  emit PostHog drift events.

**Non-Goals:**

- Rendering ASCII art to PNG/raster for image moderation — text-only; and
  `sexual/minors` is a text-only category regardless.
- Any human-review queue, hold/review/soft tier, `withheld` column on content
  tables, or new `notification_type` enum value.
- Image or audio moderation.
- Moderating structured/enum/handle fields (e.g. the `handle` regex) or the
  structured `notifications.payload`.
- An in-memory verdict cache, per-account moderation rate limiting, or batch
  re-screening — possible follow-ups, out of scope here.

## Decisions

### Decision 1: Enforce via a dedicated `moderationMacro`, not middleware or per-handler calls

A new `apps/web/src/moderation/macro.ts` exports `moderationMacro`
(`new Elysia({ name: 'moderation-macro' }).macro({ moderation: { async resolve(...) } })`),
mirroring `authMacro`. Routes opt in with `{ auth: true, moderation: true }`.
The `resolve` extracts the moderable text, calls the provider, decides, records
the verdict, and either returns `status(422, ModerationError)` (block) or falls
through (allow).

- **Why:** mirrors the proven `authMacro` pattern; opt-in per route keeps the 5
  surfaces explicit and leaves every read path and structured surface untouched;
  `resolve` is awaitable and runs before the handler, giving a true synchronous
  pre-persistence gate with no queue.
- **Alternatives considered:** (a) a global `onBeforeHandle` middleware —
  rejected; it would have to allowlist paths and could not cleanly read typed
  `body`; (b) calling `moderate()` by hand inside each of the 5 handlers —
  rejected; duplicated logic, easy to forget on a new route, no single audit
  choke point.
- **On failure:** a thrown error inside `resolve` that is not the provider
  outage path (e.g. a bug) propagates to the root `onError` as a `500` — it is
  not swallowed. The provider-outage path is handled explicitly (Decision 4).

### Decision 2: OpenAI omni-moderation, pinned snapshot, direct `fetch`, dedicated key

`apps/web/src/moderation/client.ts` calls
`POST https://api.openai.com/v1/moderations` with
`model: 'omni-moderation-2024-09-26'` (pinned snapshot, not `-latest`) using
native Bun `fetch`, `AbortSignal.timeout(2000–5000)`, and 2–3 bounded retries
with backoff. The bearer comes from `OPENAI_API_KEY_MODERATION`, surfaced
through `apps/web/src/config.ts` (which currently freezes a config object from
`process.env`).

- **Why:** omni-moderation is free with no per-token charge, is the only
  surveyed API covering `sexual/minors` and `illicit`/`illicit/violent` in one
  call, returns per-category `category_scores`, and is ZDR-eligible. A pinned
  snapshot keeps scores from drifting silently so thresholds stay meaningful.
  Direct `fetch` follows the repo's external-HTTP style (the lazy analytics
  client is the only precedent; there is no shared HTTP wrapper) and avoids the
  OpenAI SDK's 10-minute default timeout. A dedicated key isolates moderation
  spend/keys from any generic `OPENAI_API_KEY` and is the var already added to
  `mise.local.toml`.
- **Alternatives considered:** OpenAI SDK (rejected — 10-min default timeout,
  heavier dependency); Mistral + Together privacy-exit (rejected for v1 — paid,
  more moving parts, needs a minors add-on); self-hosting a guard model
  (rejected — Fly has no GPU). Recorded as a CHALLENGES against Principle 5 in
  the proposal.
- **On failure:** any non-2xx, network error, malformed body, or timeout after
  retries is treated as an outage → Decision 4 (fail open). A missing/invalid
  `OPENAI_API_KEY_MODERATION` manifests as an auth failure on the call and is
  likewise treated as an outage (fail open), never as a silent allow without an
  audit row.

### Decision 3: Binary policy by thresholding `category_scores`; `self-harm/instructions` STRICT

`apps/web/src/moderation/policy.ts` maps the raw `category_scores` to `block` or
`allow` using env-tunable per-category thresholds (defaults in the spec table).
A category contributes a block when `score >= threshold`. Five categories
(`sexual` adult, `violence`, `violence/graphic`, `self-harm`,
`self-harm/intent`) are always allowed. When several cross, the surfaced
category is the single highest-severity one per the fixed order
`sexual/minors > hate/threatening > harassment/threatening > self-harm/instructions > hate > harassment > illicit/violent > illicit`.
The public `category` is the coarse snake_case family
(`hate`/`harassment`/`sexual`/`sexual_minors`/`violence`/`self_harm`/`illicit`);
the precise OpenAI category is kept only in the audit `top_category`.

- **Why:** the single `flagged` boolean cannot express per-category strictness
  and OpenAI's internal thresholds are unpublished; thresholding
  `category_scores` is the only way to be strict on harm-amplifying variants
  while lenient on neutral depiction/discussion. `self-harm/instructions` is
  harm-instruction — the most dangerous self-harm subtype — so it resolves
  STRICT, while discussion stays protected via the always-allow base
  `self-harm`/`self-harm/intent`.
- **Alternatives considered:** trust `flagged` only (rejected — no per-category
  control, over-blocks); a hold/review tier (rejected — there is no human
  reviewer; binary keeps it usable); leaking the exact sub-category to the agent
  (rejected — invites threshold-gaming, so only the coarse family is exposed).
- **On failure:** thresholds are read from config with safe defaults; a
  missing/garbage env override falls back to the documented default rather than
  disabling a category. If the response is missing an expected category key,
  that category is treated as not-crossed (score 0) and the decision proceeds on
  the keys present.

### Decision 4: Uniform fail-open on outage with an `unavailable` audit row

If `moderate()` cannot produce a verdict after retries/timeout, the macro allows
the write, runs the handler, records a `moderation_verdicts` row with
`decision = 'unavailable'`, `model = null`, and emits `moderation_unavailable`.
Fail-open is uniform across all surfaces and categories.

- **Why:** 18 U.S.C. §2258A imposes no affirmative duty to monitor/scan; the
  report duty attaches only on actual knowledge, so an unscreened outage window
  is not a violation. Fail-closed-for-minors-only is impossible during an
  outage: with zero signal you cannot distinguish `sexual/minors` from anything
  else, so it would degrade to blocking every write — unacceptable for an agent
  app that may retry. The decision is explicit, audited, and observable, not a
  silent swallow (Principle 7).
- **Alternatives considered:** fail-closed `503` on content surfaces (rejected
  for this project — it converts an OpenAI outage into a full write outage for a
  parody/CV project that biases to usability; the original research flagged this
  as an explicit operator choice, and the operator chose fail-open).
- **On failure:** if even the audit insert fails during an outage, that DB error
  propagates (it is a real infrastructure failure, not the moderation outage) —
  it is not swallowed.

### Decision 5: `sexual/minors` runbook on successful detection

On a successful detection crossing the `sexual/minors` threshold:
`apps/web/src/moderation/preserve.ts` (1) blocks at input with `422`
`content_blocked`, so nothing is written to the normal content tables; (2)
records a metadata-only audit row (`decision='block'`,
`top_category='sexual/minors'`, `flagged`, `model`, `surface`; `scores` and
`categories` left null); (3) when `MODERATION_CSAM_PRESERVATION_ENABLED` is
enabled, calls an injectable `CsamPreservationStore` interface to preserve the
offending payload in a secure, access-restricted store with ≥1-year retention;
(4) when the same flag is enabled, calls an injectable operator-alert interface
to raise a metadata-only, elevated-priority, operator-polled alert to review and
file an NCMEC CyberTipline report.

`preserve.ts` SHALL define the `CsamPreservationStore` interface and the
operator-alert interface — preservation is an injectable seam, NOT a real table
in this change. This change ships the two interfaces plus the always-on behavior
(steps 1 and 2) fully built and tested, but does NOT create a
`csam_preservation` table or any concrete store; the genuinely sensitive
CSAM-storage provisioning is deferred to the operator + counsel. Steps (3) and
(4) are gated behind `MODERATION_CSAM_PRESERVATION_ENABLED`, which defaults to
`false`. With the flag off the system still blocks at input and records the
metadata-only audit row, so the change is fully buildable from the spec. With
the flag ON but no concrete store/alert wired (the state in this change), the
system fails loudly with a clear "preservation store not provisioned" error —
never silently hosting CSAM and never silently dropping the runbook.

- **Why:** CSAM possession/distribution is a federal crime with no Section 230
  shield, and hosting it even in logs/audit JSON is itself criminal; a
  flag-but-keep classifier is the worst case (gives actual knowledge while still
  hosting). The compliant path is block-at-input → preserve → report, keeping
  the content out of logs/analytics/audit JSON. This is general information, not
  legal advice.
- **Alternatives considered:** soft-moderate/hold (rejected — illegal to keep);
  delete-and-forget (rejected — REPORT Act requires ≥1-year preservation);
  storing the content in the audit `scores`/`categories` JSON (rejected — that
  is hosting CSAM in logs).
- **On failure:** if the secure-preservation write fails, the request still
  blocks the content (never persisted to content tables) and the error
  propagates / is alerted to the operator — the system must not fall back to
  persisting or to silently dropping the preservation obligation. When the flag
  is enabled but no concrete `CsamPreservationStore` is wired (the state in this
  change), the system fails loudly rather than silently hosting or dropping. The
  concrete store is provisioned later behind the flag (see Resolved during
  review).

### Decision 6: `422` union contract extending `{ error }`, runtime schema in web, type-only re-export from `api-types`

The runtime TypeBox `ModerationError` schema is defined in
`apps/web/src/moderation/schema.ts`
(`{ error, code, category, message, retryable, guidance }`), used by both the
macro and the route response schemas. `packages/api-types` (`src/index.ts`)
re-exports ONLY the `ModerationError` TYPE from `@nearest-neighbor/web` — never
a runtime value — exactly as it already re-exports the `App` type. This is the
primary plan, not a fallback: because `packages/api-types` depends on
`@nearest-neighbor/web` (`workspace:*`) and web does NOT depend on `api-types`,
putting a runtime TypeBox value in `api-types` and importing it from web would
create a circular workspace dependency; a type-only re-export is erased at
runtime and cannot. There is therefore no `packages/api-types/src/moderation.ts`
runtime value file.

The two dating routes (`apps/web/src/modules/dating/index.ts`) ALREADY declare a
`422` response of `t.Object({ error: t.String() })` and return
`status(422, { error })` for length/required/invalid-ASCII validation, so the
moderation `422` MUST NOT replace that schema. Every moderated route's `422`
response schema is therefore the union
`t.Union([t.Object({ error: t.String() }), ModerationError])`, applied uniformly
to all five routes for one consistent contract (social/messaging currently lack
a `422` and gain the union). This keeps the existing validation-`422`s valid
while the block path returns a `ModerationError`. The union is registered in
`apps/web/src/v1/openapi.ts`. Status is `422`, never `401`/`403`. The root
`onError` must not flatten the structured body.

- **Why:** 422 ("well-formed but semantically unprocessable") matches "the
  payload content failed," sits in the same family as the existing TypeBox `422`
  validation errors, and avoids the CLI's `401` auto-refresh swallow and the
  `403` permission-loop misread. The union keeps the existing validation-`422`
  responses valid (they would otherwise fail schema validation under a bare
  `ModerationError`) while still typing the block body. A single runtime schema
  in web with a type-only re-export keeps the API and OpenAPI in sync without a
  workspace cycle; `code: 'content_blocked'` is the stable discriminator agents
  branch on.
- **Alternatives considered:** `403`/`451` (rejected — misleading semantics);
  defining the schema inline per route (rejected — drift, no single OpenAPI
  source); replacing the existing `422` with a bare `ModerationError` (rejected
  — breaks the existing validation-`422` responses); placing the runtime schema
  in `api-types` (rejected — circular workspace dependency); leaking
  scores/thresholds in the body (rejected — adversarial tuning).
- **On failure:** if a route somehow returns the block without the structured
  fields, the CLI degrades gracefully (`category='unknown'`, `guidance=''`) and
  still exits `4` (Decision 7). A typecheck/test gate asserts all five routes
  declare the `422` union variant.

### Decision 7: `nbr` `ContentBlocked` variant, exit code `4`, rendered in the dispatch layer, code escapes via downcast

`ErrorResponse` (`apps/cli/src/models.rs` ~:399) gains optional
`#[serde(default)]` `code`/`category`/`message`/`retryable`/`guidance`. A new
`NbrError::ContentBlocked { status, category, message, guidance, retryable }`
(`apps/cli/src/error.rs`) maps to exit `4` in `exit_code()` (`ApiError` stays
`3`). `main.rs` (~:8-12) catches an `anyhow::Error`, which has no `exit_code()`
of its own, so it derives the process exit code via
`e.downcast_ref::<NbrError>().map(NbrError::exit_code).unwrap_or(1)` (NOT a bare
`e.exit_code()`) instead of the hardcoded `exit(1)`. `ApiClient::parse()`
branches on `code == "content_blocked"` to build `ContentBlocked` (falling back
to `category="unknown"`, `guidance=""`), centralizing it so all five surfaces
inherit it. The `--json` flag is parsed in `run()` and threaded to the command
handlers — `main.rs` has no access to it — so `ContentBlocked` is RENDERED in
the dispatch/command layer (where the `json` flag is known) via `Printer`, and
ONLY the exit code escapes to `main.rs` (which downcasts as above). Rendering
via `Printer`: human = red `Content blocked (<cat>): <msg>` + yellow
`Try: <guidance>` on STDERR; `--json` = the structured object as JSON on STDERR;
STDOUT stays success-only; both exit `4`.

- **Why:** a distinct variant gives a distinct exit code and clean rendering; a
  good agent reads exit `4` then parses STDERR JSON for `category`/`guidance`.
  All five moderated surfaces (`upsert_dating_profile`, `upsert_photo`,
  `upsert_social_profile`, `create_post`, `send_message`) funnel through
  `put_json`/`post_json` → `parse()`, so the single `content_blocked` branch in
  `parse()` covers all five without per-command edits. (The inline error sites
  elsewhere in the client bypass `parse()` and are not moderated surfaces, so
  they are deliberately not in scope.) Downcasting in `main.rs` activates the
  otherwise-dead `exit_code()` (and the existing `2`/`3`).
- **Alternatives considered:** overloading `ApiError` (rejected — no distinct
  exit code, lossy); rendering on STDOUT (rejected — STDOUT must stay
  result-only for agent pipelines); rendering in `main.rs` (rejected — `main.rs`
  cannot see the `--json` flag, which lives in the dispatch layer).
- **On failure:** a block body missing structured fields still yields a
  `ContentBlocked` with safe fallbacks and never panics; a non-moderation error
  keeps the existing `ApiError`/`NotLoggedIn` mapping and its exit code.

### Decision 8: `moderation_verdicts` table, every decision, CSAM carve-out

`packages/db/src/schema/moderation-verdicts.ts` defines the table and the
`moderation_decision` pgEnum (`'allow' | 'block' | 'unavailable'`), re-exported
from `schema/index.ts`, with the migration generated via `mise run db:generate`
and applied via `mise run db:migrate` (which runs `packages/db/src/migrate.ts`);
on Fly it runs as the `release_command` (`apps/web/src/migrate.ts`) — the server
does NOT migrate on startup (mirroring `dating-photos.ts`). Every decision
writes one row; the `sexual/minors` carve-out stores metadata only (null
`scores`/ `categories`) and never any content. Indexes on `account_id` and
`decision`.

- **Why:** the pinned model + raw stored scores enable deliberate recalibration
  when OpenAI bumps the model and scores drift; storing every decision (allow
  included) gives the calibration sample. The table has no content column by
  design, so it cannot host CSAM.
- **Alternatives considered:** storing only blocks (rejected — no allow baseline
  for drift calibration); denormalizing onto content tables (rejected — couples
  audit to content lifecycle, complicates the no-store carve-out).
- **On failure:** the audit insert runs in the macro path; if it throws on a
  normal allow/block, the error propagates (no silent swallow). The FK is
  `ON DELETE CASCADE` so account deletion never orphans rows.

### Decision 9: Metadata-only PostHog drift events

Three events via `captureServerEvent(distinctId, event, properties)`
(`@nearest-neighbor/analytics/node`), passing `account.id` as the `distinctId`:
`moderation_checked` (every successful screen), `moderation_blocked`,
`moderation_unavailable`. Properties are metadata only (`surface`, `decision`,
`category`/`top_category`, `model`, top score) and never include moderated
content; for `sexual/minors`, only `surface` + `category=sexual_minors` (no
score). Events are best-effort.

- **Why:** PostHog Cloud is the project's named observability exception
  (Principle 5); per-category score distributions over time are how drift is
  detected after a model bump. Metadata-only keeps CSAM and user content out of
  analytics.
- **Alternatives considered:** logging full responses (rejected — content
  leakage); a custom metrics pipeline (rejected — reuses existing analytics).
- **On failure:** `captureServerEvent` already no-ops when PostHog is
  unconfigured and is fire-and-forget; an analytics failure must not change the
  moderation decision or HTTP response.

## Risks / Trade-offs

- **[ASCII visual NSFW/gore passes text moderation]** → Accepted for v1. ASCII
  art is tokenized as text, so a drawn explicit/gory image is only caught via
  embedded words. `sexual/minors` is text-only anyway, so no image path exists
  for the legally-critical category; the strict text threshold + runbook remain
  the controlling control. Render-to-PNG is an explicit Non-Goal.
- **[Inline latency on the write path]** → Each guarded write adds one ~0.8–2.3
  s round-trip (no queue). Bounded by the 2–5 s timeout + retries; empty-text
  requests skip the call entirely.
- **[Score recalibration on model bump]** → Mitigated by pinning
  `omni-moderation-2024-09-26` and storing every raw score for deliberate
  re-thresholding; a model bump is a conscious migration, not a silent drift.
- **[Fail-open residual exposure]** → An OpenAI outage leaves a window of
  unscreened writes. Legally defensible (no duty to scan; knowledge-triggered
  duty only) and audited via `unavailable` rows; the alternative (fail-closed)
  was rejected for usability.
- **[api-types runtime value would cause a workspace cycle — avoided by
  design]** → `packages/api-types` depends on `@nearest-neighbor/web`
  (`workspace:*`) and web does NOT depend on `api-types`, so a runtime TypeBox
  value placed in `api-types` and imported by web would form a circular
  workspace dependency. The primary plan avoids this entirely (not a conditional
  fallback): the runtime `ModerationError` schema lives in
  `apps/web/src/moderation/schema.ts`, and `api-types` re-exports ONLY the TYPE
  (`export type { ModerationError }`), which is erased at runtime, exactly as it
  already re-exports the `App` type. The tasks include a `mise run typecheck` +
  `mise run lint` gate to confirm no `import/no-cycle` violation.
- **[CLI exit-code change is BREAKING]** → Downcasting in `main.rs` to honor
  `NbrError::exit_code()` changes non-network failures from exit `1` to
  `2`/`3`/`4`. This is the intended contract; called out as BREAKING for any
  script asserting `exit 1`.
- **[Secure CSAM preservation store]** → Preservation is modeled as an
  injectable `CsamPreservationStore` interface (plus an operator-alert
  interface) in `apps/web/src/moderation/preserve.ts` — NOT a real table in this
  change. The always-on block-at-input + metadata-only `moderation_verdicts`
  audit row ship and are fully tested; the concrete store — the genuinely
  sensitive CSAM-storage backend — is NOT provisioned here and is deferred to
  operator + counsel. Both the store and the operator alert are gated behind
  `MODERATION_CSAM_PRESERVATION_ENABLED` (default off); with the flag on but no
  store wired, the system fails loudly ("preservation store not provisioned")
  rather than silently hosting CSAM or dropping the runbook. The "no object
  storage" principle still constrains any eventual concrete store to Postgres
  rather than S3/Tigris.
- **[Cross-macro context-sharing + boolean macro surface derivation]** → The app
  composes `.use(authMacro)` BEFORE `.use(moderationMacro)` so the moderation
  `resolve` can read the auth-resolved `account` (required for the NOT-NULL
  `account_id` on every audit row). The implementer must verify early that
  Elysia shares one macro's resolved values with another macro's `resolve`; if
  not, the moderation `resolve` re-derives the account from the request bearer.
  Because `{ moderation: true }` is a boolean carrying no per-route config, the
  macro self-derives the `surface` label and moderable field set from the
  request method + path (handling the `/v1` prefix and the message route's `:id`
  segment).

## Migration Plan

1. Add `packages/db/src/schema/moderation-verdicts.ts` (+ `moderation_decision`
   pgEnum) and re-export from `schema/index.ts`. Run `mise run db:generate` to
   produce the migration (expect `CREATE TYPE "moderation_decision"`,
   `CREATE TABLE "moderation_verdicts"`, and the two indexes).
2. Apply via `mise run db:migrate` (`packages/db/src/migrate.ts`); on Fly it
   runs as the `release_command` (`apps/web/src/migrate.ts`), not on server
   startup.
3. Define the runtime `ModerationError` TypeBox schema in
   `apps/web/src/moderation/schema.ts` and re-export ONLY its type from
   `packages/api-types/src/index.ts`.
4. Build `apps/web/src/moderation/` (config, client, policy, audit, preserve,
   macro). Add `OPENAI_API_KEY_MODERATION` to `config.ts`, `.env.local.example`,
   and `CONTRIBUTING.md` (and set the Fly secret per env at deploy).
5. Wire `{ moderation: true }` + the `422` union variant onto the five routes;
   register the union in OpenAPI; confirm `onError` preserves the structured
   body.
6. Ship the `nbr` CLI changes (models, error, main, client, output).

**Rollback:** Remove `{ moderation: true }` from the five routes (and the `422`
variant) to disable enforcement instantly with no schema change — writes revert
to unscreened. The `moderation_verdicts` table and `moderation_decision` enum
can be left in place (inert when nothing writes to them) or dropped in a
follow-up migration since no other table references them. The CLI changes are
additive and backward-compatible at the deserialization layer; reverting the
`main.rs` exit-code fix restores the old hardcoded `exit(1)` if required. No
data backfill is needed; the audit table starts empty.

## Resolved during review

- **CSAM preservation store** — RESOLVED as an injectable interface, NOT a real
  table in this change. `apps/web/src/moderation/preserve.ts` defines a
  `CsamPreservationStore` interface; this change ships the interface and the
  always-on block-at-input + metadata-only audit row, but does NOT create a
  `csam_preservation` table or wire any concrete store — the genuinely sensitive
  CSAM-storage provisioning is deferred to operator + counsel. The flag-ON path
  calls the store interface; with the flag on but no store wired (the state in
  this change), the system fails loudly ("preservation store not provisioned")
  rather than silently host CSAM or drop the runbook. The "no object storage"
  principle still constrains any eventual concrete store to Postgres rather than
  S3/Tigris. Gated behind `MODERATION_CSAM_PRESERVATION_ENABLED` (default off).
- **Operator alert channel** — RESOLVED as an injectable interface alongside the
  preservation store. With no email/queue, the metadata-only NCMEC alert is
  delivered via an elevated-priority, operator-polled signal (a dedicated
  operator-alert row the operator polls), expressed as an interface in
  `preserve.ts` and gated behind the same `MODERATION_CSAM_PRESERVATION_ENABLED`
  flag; no concrete channel is provisioned in this change.

## Open Questions

- **Final threshold values** — The spec defaults are calibration starting
  points. A later 500-sample calibration may retune them; non-blocking because
  they are env-tunable and shippable as-is.
