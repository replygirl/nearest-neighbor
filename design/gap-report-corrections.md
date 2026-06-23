# gap-report.md — Adjudication Corrections Changelog

Corrections applied to `design/gap-report.md` after adversarial verification of
every factual claim. The original report was **highly trustworthy**: of the
claims checked, the overwhelming majority were confirmed against code. No status
labels changed and no headline finding was overturned — every correction below
is a detail/wording refinement or the removal of one false sub-claim. The five
consequential gaps (auth model, NN-search-is-aspirational, fictional terminal
commands, plugin-install inconsistency, ISC-vs-MIT license) all stand verified.

## Changes

### 1. Gap #3 — `nbr like`/`nbr pass` mischaracterized as "aliases"

- **Severity:** minor (wording; does not change status — stays `divergent`)
- **Was claimed:** "plus `nbr like`/`nbr pass` aliases."
- **Actual truth:** `like` and `pass` are **separate `Commands` enum variants**
  (distinct arg structs `LikeArgs`/`PassArgs`, each taking a single `id`), not
  command aliases. They internally call swipe with a hardcoded direction
  (`yes`/`no`).
- **Evidence:** `apps/cli/src/cli.rs` lines 81, 84 define `Like(LikeArgs)` and
  `Pass(PassArgs)` as separate variants; `apps/cli/src/commands/dating.rs` lines
  139-161 wrap `run_swipe` with hardcoded directions.
- **Change applied:** Rewrote to "`nbr like <id>`/`nbr pass <id>` are **separate
  commands** (not aliases) that internally call swipe with a hardcoded
  direction."

### 2. Gap #4 — false "marketplace registry may not yet exist" caveat

- **Severity:** minor (removes an unsupported sub-claim; status stays `partial`)
- **Was claimed:** "The plugin docs note the marketplace registry 'may not yet
  exist.'"
- **Actual truth:** No plugin README/AGENTS doc carries a caveat about the
  marketplace registry. The only "not yet available" caveats concern the `nbr`
  **binary release** and Codex **hooks** — not the marketplace.
- **Evidence:** Grep of `plugins/claude/README.md` and `plugins/codex/README.md`
  for marketplace/registry caveats returns nothing; "not yet" hits are about the
  binary and hooks only.
- **Change applied:** Replaced with a parenthetical clarifying the caveats are
  about the binary release and Codex hooks, not the marketplace. Also pointed
  the `features.hooks` citation at `plugins/codex/README.md` + `AGENTS.md`
  (README is the primary source).

### 3. Gap #6 — illustrative-portrait dimensions wrong

- **Severity:** minor (wording; status stays `partial`)
- **Was claimed:** "Design's illustrative portraits are ~14×8, far under 60×60."
- **Actual truth:** Each illustrative portrait is ~8 lines × ~48 chars (8×48),
  not 14×8. The "far under 60×60" point holds.
- **Evidence:** `Landing Page.dc.html` portrait A (lines 978-985) and portrait B
  (lines 1066-1073) are each 8 lines with max width 48.
- **Change applied:** Changed "~14×8" to "~8 lines × ~48 chars."

### 4. Gap #7 — "design presents Claude+Codex symmetrically" overstated

- **Severity:** minor (sharpens the framing; status stays `partial`; the real
  finding — Codex Stop hooks don't surface turn-end context — is preserved)
- **Was claimed:** "design presents Claude+Codex symmetrically."
- **Actual truth:** The design does not explicitly assert symmetry; it says it
  "ships as a plugin for both Claude Code and Codex" without flagging the Codex
  limitation. The gap is an omission readers fill with an assumed parity, not an
  affirmative false claim of symmetry.
- **Evidence:** `Landing Page.dc.html` install section says "ships as a plugin
  for both…" with no per-platform distinction;
  `plugins/codex/scripts/on-stop.sh` lines 4-7 document the fire-and-forget
  caveat.
- **Change applied:** Reworded to "effectively Claude-only… the design says it
  'ships as a plugin for both…' without flagging this Codex limitation, so
  readers will reasonably assume a parity that doesn't exist."

### 5. Gap #10 — go-public incorrectly described as gated on partner acceptance

- **Severity:** major (corrects a factual claim about the flow; status stays
  `implemented`)
- **Was claimed:** Reconciliation (b): "reality requires propose → partner
  accepts → then go-public."
- **Actual truth:** The `is_public` toggle has **no state validation** —
  `PATCH …/:id { is_public: true }` succeeds regardless of relationship state,
  so go-public is **unilateral and not acceptance-gated**. However,
  `aligned_with` only surfaces relationships that are **both** `active` **and**
  `is_public`, so a public-but-unaccepted relationship will not appear publicly.
  The propose→accept handshake gates the relationship state, not the public
  flag.
- **Evidence:** `apps/web/src/modules/relationships/index.ts` lines 226-232
  (is_public toggle, no state check) vs lines 190-200 (state=active requires
  pending + non-initiator); `getAlignedWith()` in `modules/social/index.ts`
  filters `state='active' AND isPublic=true`.
- **Change applied:** Rewrote reconciliation (b) to separate the relationship
  handshake from the (ungated) `is_public` toggle and explain the `aligned_with`
  filter.

### 6. "Implemented but not surfaced" — relationship handshake note (same as #5)

- **Severity:** major (corrects the same flow claim)
- **Was claimed:** "Design implies 'make it public' is unilateral; reality is
  propose → partner accepts → go-public."
- **Actual truth:** Same as correction #5 — the relationship requires the
  handshake to go `active`, but `is_public` is not acceptance-gated; alignment
  surfaces publicly only when a relationship is both `active` and public.
- **Evidence:** Same as #5.
- **Change applied:** Rewrote the row Note to distinguish the relationship
  handshake from the ungated public toggle and the `aligned_with` visibility
  rule.

### 7. Gap #12 — Eden Treaty overstated as the in-use client pattern

- **Severity:** minor (wording; status stays `implemented`)
- **Was claimed:** "Eden Treaty is the typed-client pattern."
- **Actual truth:** `@elysiajs/eden` is installed and mandated by CLAUDE.md, but
  no web client code uses it yet — the web app is marketing-only.
- **Evidence:** `@elysiajs/eden` in `apps/web/package.json`; no Eden usage under
  `apps/web/app/`; `routes.ts` registers only the index route.
- **Change applied:** Reworded to "the **declared/installed** typed-client
  pattern… not yet used in any web client code, since the web app is currently
  marketing-only."

### 8. Gap #15 — "both scripts gracefully no-op" wrong; hero curl hard-fails

- **Severity:** major (corrects observable behavior of the hero install command;
  status stays `partial` and the finding is strengthened, not weakened)
- **Was claimed:** "both gracefully no-op until then. So the install command may
  currently install nothing."
- **Actual truth:** Only the plugin's `install-nbr.sh` gracefully no-ops (exit
  0, friendly message on 404). The hero's `public/install.sh` **hard-fails**
  (`exit 1`, "error: could not determine latest release tag") because no
  `cli-v*` release tag exists. The hero curl command therefore **errors out**,
  it does not silently no-op.
- **Evidence:** `public/install.sh` lines 74-76 (`exit 1` on missing tag);
  `plugins/claude/scripts/install-nbr.sh` lines 104-108 (graceful exit 0); no
  `cli-v*` git tag/release exists (only `v0.1.0`/`v0.1.1`).
- **Change applied:** Rewrote the Detail to state no `cli-v*` tag exists,
  describe the two scripts' divergent behavior, and correct "no-op" to "errors
  out" for the hero path.

### 9. Notable code-side gaps — `nbr notifications`/`nbr tokens` skill claim softened

- **Severity:** minor (wording; the core finding — client methods exist but no
  CLI commands — is preserved and verified)
- **Was claimed:** "the plugin skill references token/notification flows the CLI
  can't yet drive."
- **Actual truth:** The plugin skill files do **not** reference
  `nbr notifications`/`nbr tokens` commands; notifications are surfaced only
  indirectly via `nbr status` polling. The dangling `client.rs` methods are the
  real signal.
- **Evidence:** `plugins/claude/skills/nbr/SKILL.md` mentions only `nbr login`
  (mint bearer token), no notifications/tokens subcommands; client methods exist
  at `apps/cli/src/client.rs` (list/create/revoke_token, notifications,
  read_notifications) with no `Commands` enum variants.
- **Change applied:** Rewrote to note the skill files don't promise these
  subcommands and that the dangling client methods signal an unfinished surface.

## Claims I deliberately did NOT change (declined corrections)

Several verifiers flagged endpoint paths as "imprecise," claiming the report's
`/v1/...` paths should drop the `/v1` prefix (e.g. "`/dating/deck`, not
`/v1/dating/deck`"). **These corrections are themselves wrong and were not
applied.** Elysia composes the parent app prefix with the module prefix: each
module (e.g. `prefix: '/dating'`) is mounted inside the `v1` app
(`prefix: '/v1'`), so the externally reachable path **is** `/v1/dating/deck`.

- **Evidence:** `apps/web/src/index.ts` mounts only `v1`;
  `apps/web/src/v1/index.ts` sets `prefix: '/v1'` and `.use(datingModule)` etc.;
  `apps/web/src/v1/openapi.ts` line 4 explicitly comments "Mounted inside v1
  Elysia (prefix: '/v1'), so paths resolve to /v1/docs and /v1/openapi.json."
- The unit #13 verifier's claim that API docs live at `/docs` and `/admin/docs`
  (from CONTRIBUTING.md) is **stale**: the running server has no top-level
  `/docs` or `/admin/docs` mount — only `/v1/docs` (via the openapi plugin
  inside v1). CONTRIBUTING.md is out of date on this point; the code is
  authoritative. The report's `/v1/docs` references are correct and were kept.

All `/v1/...` paths in the report are therefore accurate and were preserved.
