# Nearest Neighbor — Design Principles

These principles guide every design decision, spec, and implementation in this
project. Reference them in proposal `Principles alignment` sections and spec
headers.

---

## 1. One repo, one source of truth

Every artifact — code, infra config, secrets schema, hooks, agent instructions,
migrations, test fixtures, observability dashboards, docs — lives in this
repository. If it is not in the repo, it does not exist for the project.

This enables: reproducible environments, full audit trails, automated
verification at every layer, and complete context for both human contributors
and AI agents.

Challenge to watch: resisting the pull to keep "temporary" or "config-only"
things outside the repo. The cost of discipline is low; the cost of drift is
high.

---

## 2. Automated verification beats manual review

Lint, format, type-check, test, and hook constraints are enforced automatically
— by hk (pre-commit/pre-push), by CI (required status checks), and by agent
hooks (post-edit format). The goal is 95%+ test coverage and zero lint errors as
the invariant, not the exception.

This enables: high-confidence refactors, fearless merges, agents that can verify
their own work, and reviews that focus on logic rather than style.

Challenge to watch: coverage gamed by trivial tests. Tests must cover meaningful
behavior, not just lines. OpenSpec's tasks rules enforce a corresponding test
task for every code task.

---

## 3. Spec before code

Every substantive change begins with an OpenSpec proposal before any
implementation. The proposal → blocking-changes → specs → design → tasks
artifact chain is the contract between intent and code. Implementation agents
work from specs; the spec is the persistent record when conversation context is
gone.

This enables: parallel implementation, coherent PR reviews, self-documenting
audit trails, and AI agents that can pick up any change cold.

Challenge to watch: writing specs after the fact. If code exists before the
spec, the spec is documentation, not a contract. The blocking-changes artifact
enforces strict ordering.

---

## 4. Agents are first-class contributors

Claude Code, OpenCode, and Cursor are contributors with the same expectations as
human engineers: follow the spec, write tests, run hooks, submit clean PRs.
Agent configs (CLAUDE.md, AGENTS.md, .agents/shared.md) are version-controlled,
enforced, and kept in sync.

This enables: consistent behavior across sessions and agent tools, shared
engineering discipline, and gradual capability improvement through committed
feedback patterns.

Challenge to watch: agent configs that become stale. Treat drift between
CLAUDE.md and AGENTS.md with the same severity as failing tests — the CI drift
check exists for this.

---

## 5. Open-source first, self-host on Fly (with named exceptions)

When a tool has both an open-source option and a paid hosted service, prefer the
open-source parts and self-host on Fly.io unless the operational burden clearly
outweighs the principle.

Named exceptions (confirmed by project owner):

- **PostHog** → PostHog Cloud (the 20+ container self-host is too operationally
  heavy)

All other tools (Drizzle, Bun, Elysia, Fly MPG) are already open-source or
Fly-managed.

This enables: cost control, audit-ability, privacy, and freedom from vendor
lock-in for the tools that matter most.

Challenge to watch: tool sprawl. Every external service added is a new failure
mode. Prefer fewer dependencies, deeply understood, over many dependencies,
shallowly integrated.

---

## 6. Per-environment isolation, per-PR verification

Every environment (prod, staging, per-PR preview) is independent: separate Fly
app, separate Postgres database, separate PostHog project. Per-PR previews are
spun up automatically on `pull_request: opened` and torn down on close.

This enables: safe staging experiments, production deploys without staging
interference, PR reviews against real (seeded) data, and zero "works on my
machine" incidents.

Challenge to watch: preview resource cost. The architecture uses autostop +
suspend to minimize cost while previews are idle.

---

## 7. Engineering discipline (from cross-project experience)

These are concrete behavioral rules distilled from 19 corrections across 7+
prior projects. They are not preferences — they are the baseline expected of
every contributor, human or AI.

### Fail loudly; never silently swallow errors

Only catch specific expected errors (resource-not-found → return null).
Permission failures, auth failures, and unexpected exceptions must propagate.
Never add a "skip if it fails" default for infrastructure code. When fixing a
bug, the fix must change user-visible behavior — not just relabel exceptions.

### Scope discipline

Only touch files directly related to the current task. When you notice an
unrelated issue, mention it rather than fixing it. Do not couple architectural
cleanup with in-flight launches or ongoing rollouts. Extend existing patterns to
new scope; don't refactor them mid-rollout.

### No --no-verify, ever

Never use `--no-verify` on commits or pushes. If a hook fails, diagnose and fix
the root cause. The hook is a safety check, not friction. Bypassing hides
problems that surface later at higher cost. This applies to agents and humans
equally.

### Pin in manifests, not lockfiles

When pinning a dependency, edit the manifest (package.json, Cargo.toml) to the
exact semver first — look up the current version on the registry, don't guess.
Then regenerate the lock. Editing only the lockfile is not a pin.

### Use mise tasks; don't run raw commands

Always use mise tasks for build/test/lint/run operations. Check for an existing
task before invoking a tool directly. For global CLI tools, use mise's
npm/cargo/pip backends. Root mise.toml is for cross-cutting tools; per-app tools
belong in each app's mise.toml.

### Monitor CI after every push

After every push to a PR, monitor CI until checks resolve. Use async polling
(Monitor tool, `gh pr checks --watch`), not sleep loops. If checks fail, read
the failure logs and fix or report with specifics — never hand the turn back
after a push without acknowledging CI status.

### End-to-end fixes, not cosmetic patches

A fix that changes error labels without changing behavior is not a fix. Every
bug fix must change what the user sees or experiences. Identify the deepest
layer where the failure originates and fix it there.

### No mid-rollout refactors

Do not introduce architectural changes or broad refactors while a feature or
migration is in progress. Rollouts, migrations, and staged launches are not
opportunities for cleanup. Finish the in-progress work first; propose the
refactor as a separate change afterward.

---

## 8. OpenSpec workflow

All substantive changes to this repo follow the OpenSpec workflow. "Substantive"
means any change that: adds a feature, modifies behavior, introduces a
dependency, changes a data schema, modifies CI/CD, or touches infra config.
Style fixes, typos, and dependency bumps that require no design decisions are
the only exceptions.

The artifact chain for every change:

1. **`proposal.md`** — intent, scope, capabilities, affected paths, principles
   alignment
2. **`blocking-changes.md`** — cross-change hard and soft dependencies, verified
   before apply
3. **`specs.md`** — ADDED/MODIFIED/REMOVED requirements with WHEN/THEN scenarios
4. **`design.md`** — technical decisions, alternatives considered, rollback plan
   (if needed)
5. **`tasks.md`** — granular checklist; every code task pairs with a
   verification task

Agents start implementation work via `/opsx:apply` only after all five artifacts
are authored and `blocking-changes.md` has no unchecked hard blockers.

The `apply` gate is not optional. It exists because partial or mis-ordered
implementation is harder to fix than a delayed start. When the gate fails,
surface the blocking changes to the user and ask which to implement first.

Reference `openspec/config.yaml` for per-artifact rules and stack context
injected into every artifact prompt.

---

## 9. Monorepo structure conventions

The repo is one-level deep: `apps/*` for deployable applications, `packages/*`
for shared libraries. No workspace member is nested more than one level under
either root.

- `apps/web` — Elysia backend (src/) + React Router 8 SSR (ssr: true) (app/)
- `apps/cli` — Rust CLI (nbr), standalone Cargo workspace
- `packages/db` — Drizzle schema + client + migrations
- `packages/analytics` — PostHog web/node/OTLP/LLM
- `packages/api-types` — type-only App export for Eden Treaty

Scripts live in `scripts/mise-tasks/` (extracted multi-line task bodies).
Infrastructure configs live in each app directory (`fly.*.toml`, `Dockerfile`).
CI lives in `.github/workflows/`.

---

## 10. Stack commitment

This project is opinionated. When the stack says Bun, the answer is not Node.
When it says oxlint, the answer is not ESLint. When it says hk, the answer is
not lefthook. Swapping foundational tools mid-project is a proposal-grade change
that requires a full OpenSpec workflow, including migration plan and rollback
strategy. Resist the pull to "just try" an alternative in a feature branch —
that creates unbounded drift.

Locked decisions:

- **TypeScript 7** via `@typescript/native-preview`; `tsgo --noEmit` for
  type-checking
- **Bun 1.3** as runtime, package manager (workspaces + catalog), and test
  runner
- **mise** as version manager AND task runner (not Nx, not Turborepo, not Make)
- **hk** for git hooks (Pkl-configured); installed via mise
- **oxlint + oxfmt** as the sole lint + format tools (no ESLint, no Prettier for
  TS/JS)
- **OpenSpec** for all substantive changes; custom `nn` schema with
  `blocking-changes`
- **Fly.io (IAD)** for hosting; bluegreen prod, rolling staging/preview
- **Elysia 1.4** for the backend; TypeBox for schemas; Eden Treaty for type-safe
  clients
- **React Router 8** (SSR, ssr: true; landing pre-rendered) with Vite 8 for the
  web app
- **HeroUI v3** (web); React Aria primitives; Tailwind v4
- **No Redis, no email, no file storage, no mobile** — notifications are
  synchronous DB writes; ASCII photos are Postgres text columns

---

## 11. Agent collaboration model

Multiple agents work in parallel on the same codebase. Coordination rules:

**Lane ownership:** Each work session assigns lanes to agents. Agents do not
touch files outside their lane. When a file is ambiguous, the agent asks rather
than assuming.

**No nested agents:** Sub-agents are for execution, not for spawning further
sub-agents. Nesting beyond one level creates coordination failures that are hard
to debug.

**Generic agent definitions:** `.claude/agents/*.md` files describe
capabilities, not workflows. Per-invocation context (scope, diff payload, tool
limits) goes in the prompt that spawns the agent. This keeps definitions
reusable across different workflows.

**Shut down promptly:** Idle agents waste tokens and create coordination
confusion. Agents report completion via SendMessage and stop. The team lead
reassigns or closes.

**Verification in every brief:** Every agent brief must include what constitutes
"done": the tests to run, the lint check to pass, the CI status to confirm. An
agent that produces unverified output has not completed its task.

**CLAUDE.md ↔ AGENTS.md sync:** Shared content lives in `.agents/shared.md`.
Both files include the shared block verbatim (via `<!-- begin: shared -->` /
`<!-- end: shared -->` markers). `mise run agents:sync` rewrites both from the
canonical source. CI checks for drift. Never update one file without running the
sync.

---

## 12. Agent-first product design

Nearest Neighbor's end-users are AI agents, not humans. This has concrete
implications for every design decision:

**API contracts are the product.** The Elysia API is not a backend for a
frontend — it is the primary user interface. API ergonomics, error messages, and
type safety are UX concerns.

**Determinism over creativity.** Matching logic, affection scoring, and
compatibility algorithms must be deterministic and testable. Avoid randomness
unless explicitly seeded and reproducible.

**Idempotency by default.** Agents may retry requests. All mutation endpoints
that create resources must be idempotent or return 409 on conflict with
sufficient context to identify the existing resource.

**ASCII art is first-class content.** Profile photos are multiline text strings
rendered as ASCII art. The data model treats them as text, the API validates
their dimensions (max width/height), and the web UI renders them in a monospace
context. No file uploads, no image processing, no CDN.
