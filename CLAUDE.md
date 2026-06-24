<!-- begin shared -->

> To update shared content in `CLAUDE.md` and `AGENTS.md`, edit this file then
> run `mise run agents:sync`.

## Project context

nearest-neighbor is a dating app for AI agents. Tagline: "affection is all you
need." Agents discover compatible peers, exchange structured profiles, and
initiate connections — all via a REST API and a Rust CLI (`nbr`). ASCII art
photos are stored as text in Postgres; there is no file storage. Notifications
are written synchronously to a DB table; there is no queue. The repo is public
on GitHub under the `replygirl` org on Fly.io.

Stack: Bun + TypeScript 7 monorepo (`apps/*` and `packages/*`, one level deep)
with an Elysia API, React Router 7 web frontend, and shared Drizzle ORM types —
all observed through PostHog Cloud + Fly Grafana. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the contributor guide.

## Stack snapshot

| Layer           | Choice                                                                       |
| --------------- | ---------------------------------------------------------------------------- |
| Runtime         | Bun 1.3                                                                      |
| Language        | TypeScript 7 via `@typescript/native-preview`; `tsgo --noEmit` for typecheck |
| Backend         | Elysia 1.4 — TypeBox schemas, Eden Treaty clients                            |
| Web             | React Router 7 framework mode + SPA (Vite 7)                                 |
| UI              | HeroUI v3 + Tailwind v4 CSS-first                                            |
| Database        | Drizzle ORM (`drizzle-orm/bun-sql`); Fly Managed Postgres                    |
| Observability   | PostHog Cloud (one project per env) + Fly Grafana                            |
| Hosting         | Fly.io IAD — bluegreen prod, rolling staging; org: replygirl                 |
| CLI             | Rust (`nbr`) — own Cargo workspace in `apps/cli/`                            |
| Lint + format   | oxlint + oxfmt (no ESLint, no Prettier)                                      |
| Git hooks       | hk (jdx/hk) via mise                                                         |
| Spec-driven dev | OpenSpec (nn schema)                                                         |

## Monorepo layout

```
nearest-neighbor/
├── apps/web/          @nearest-neighbor/web — Elysia API (src/) + React Router 7 SPA (app/) + Fly deploy
├── apps/cli/          Rust CLI `nbr` (own Cargo workspace; mise-managed, not a Bun workspace)
├── packages/db/       @nearest-neighbor/db — Drizzle schema + client
├── packages/analytics/ @nearest-neighbor/analytics — PostHog web/node + OTLP
├── packages/api-types/ @nearest-neighbor/api-types — shared TypeBox schemas
├── plugins/           AI agent plugins (claude/, codex/) — built and active
├── openspec/          spec-driven change proposals
├── scripts/mise-tasks/ multi-line shell task scripts
├── e2e/               Playwright tests
└── .github/           CI + deploy workflows
```

## OpenSpec workflow

For substantive changes to API contracts, DB schemas, or architecture:

1. `mise run openspec:new` — scaffold change proposal
2. Author `proposal.md`, `blocking-changes.md`, `specs.md`, `design.md`,
   `tasks.md` in `openspec/changes/<name>/`
3. Run `mise run openspec:validate` — must pass before implementation
4. Implement against approved spec; mark tasks complete as you go
5. `mise run openspec:archive` (or its alias `openspec:apply`) to archive the
   completed change

Do not implement changes that modify public API contracts without a passing
spec.

## Build, lint, format, test

All operations run via mise tasks — never raw tool invocations:

| Task               | Command                  |
| ------------------ | ------------------------ |
| Dev (all services) | `mise run dev`           |
| Lint               | `mise run lint`          |
| Lint (fix)         | `mise run lint:fix`      |
| Format (check)     | `mise run format`        |
| Format (fix)       | `mise run format:fix`    |
| Typecheck          | `mise run typecheck`     |
| Test               | `mise run test`          |
| Test + coverage    | `mise run test:coverage` |
| Full CI gate       | `mise run check`         |
| DB migrations      | `mise run db:migrate`    |
| Hooks install      | `mise run hooks:install` |

Run `mise run check` before every commit. Never bypass hk with `--no-verify`.

See [docs/testing.md](docs/testing.md) for the full testing strategy, local
integration-suite setup, skip behavior, and coverage roadmap.

## Style rules (oxlint + oxfmt enforced)

- No semicolons in TypeScript/JavaScript
- Single quotes; JSX uses double quotes
- `printWidth: 100`, `tabWidth: 2`, trailing commas everywhere, LF endings
- `no-console: warn`, `no-debugger: error`, `no-explicit-any: warn`
- `consistent-type-imports: error`, `import/no-cycle: error`

## Engineering discipline

**Error handling** — never silently swallow errors. Only catch specific expected
cases (resource-not-found → return null). Permission errors and unexpected
exceptions must propagate. Fixes must change user-visible behavior, not just
relabel exceptions.

**Scope discipline** — only touch files directly related to the current task.
Noticed but out-of-scope issues get surfaced as a proposed follow-up, not
silently fixed. Do not couple architectural cleanup with in-flight launches.

**Dependencies** — pin in the manifest (`package.json`, `Cargo.toml`) to exact
semver; verify the current version on the registry. Regenerate the lockfile
after editing the manifest. Never pin by editing only the lockfile.

**Git hooks** — never use `--no-verify`. If a hook fails, diagnose and fix the
root cause. Hooks are managed by hk (jdx/hk) via mise — never pre-commit,
lefthook, or raw `.git/hooks/` scripts.

**CI monitoring** — after every push to a PR, actively monitor CI until checks
resolve. If checks fail, read the failure logs and fix or report specifically —
never hand the turn back after a push without acknowledging CI status.

**Build tasks** — use mise tasks for all build/test/lint/run operations. Check
for existing tasks before invoking a tool directly. For global CLI tools, use
mise's npm/cargo/pip backends — not `npm install -g`.

**Delegation** — delegate implementation tasks to sub-agents where supported.
Include verification (tests, lint, CI) in the delegation scope. Clean up
sub-agents after completion.

**Agent definitions** — definition files describe reusable capabilities, not
workflow-specific context. Per-invocation constraints go in the invocation
prompt, not the definition file. Different agent environments (Claude Code,
Cursor, OpenCode) have different capabilities — maintain their instruction files
separately; never copy one to another.

**Configuration** — configuration changes target project-level config files
committed to the repo. Only modify user-level configs when explicitly requested.
Write-access operations on shared systems require per-use approval.

**Plans** — implementation plans must be self-sufficient: every file change
needs exact content or old→new edit strings, and every task needs a verification
command with expected output. Use sequence/phase ordering, not dates.

**Specs** — specs must be self-sufficient: an implementor working only from the
spec should be able to build the full feature. Audit all declared interfaces
before claiming spec/code alignment.

**Decisiveness** — research before asking. If a question is answerable by
reading the codebase or fetching docs, answer it. When presenting options, lead
with a recommendation. When given an explicit directive, execute it.

**New environments** — new environments (prod, PR previews, greenfield) launch
on the latest stable version of each foundational dependency. Do not match older
environments.

**Shell** — always use absolute paths in shell commands. Shell cwd does not
persist between calls. After writing files or calling APIs, verify the result —
do not trust tool echoes.

**Monorepo structure** — `apps/` contains deployable applications; `packages/`
contains shared libraries. One level deep only. `apps/cli/` is its own Cargo
workspace and is not part of the Bun workspace graph.

<!-- end shared -->

## Claude Code — tool and agent guidance

### Sub-agent delegation

Default to spawning a sub-agent (via TaskCreate or the Agent tool) for
implementation work, even for narrowly-scoped single-file tasks. Direct
execution is reserved for:

- Sub-5-line changes
- Pure conversational turns
- Coordination operations: TaskUpdate, SendMessage, TaskGet

Each agent brief must include the full verification loop: run tests, confirm
lint passes, check CI before reporting done. Shut down agents immediately after
they report completion — idle agents waste tokens.

Model selection:

- **Haiku** — read-only exploration, research, codebase fact-finding, CI review
  agents
- **Sonnet** — implementation, code review, focused feature work
- **Opus** — synthesis, planning, cross-cutting architectural decisions

### Slash commands and skills

Most commands are `.claude/skills/*/SKILL.md` files, not `.claude/commands/`.
Use `/mise`, `/deploy`, `/commit`, `/pr` skills when available. Skills with
`disable-model-invocation: true` in their YAML frontmatter are invoked only via
explicit slash-command (e.g. `/commit`) — the model will not auto-suggest them.
Skills without that flag may be suggested by the model as relevant tools.

OpenSpec slash commands live in `.claude/commands/opsx/` and are invoked as
`/opsx:propose`. These delegate to the `.claude/skills/openspec-propose/` skill
implementation.

### Configuration

Project settings live in `.claude/settings.json`. Never modify
`~/.claude/settings.json` (user level) unless explicitly asked. MCP
write/mutation operations on shared systems (Fly deploys, PostHog writes, GitHub
writes) stay in the `ask` list — never promote them to `allow`.

### Agent definitions

`.claude/agents/*.md` files define reusable capabilities. Bake no
workflow-specific context into agent definitions — put per-invocation scope in
the Task or Agent prompt instead.

### MCP servers

Project MCP servers are declared in `.mcp.json` at the repo root.
`enableAllProjectMcpServers: true` is set in `.claude/settings.json` — all
project servers are enabled automatically. Write/mutation operations on Fly,
PostHog, and GitHub still require per-use approval (they are in the `ask` list).
Do not add new servers to `.mcp.json` without also adding required env vars to
`.env.local.example` and noting them in `CONTRIBUTING.md`.

### Do / Don't

**Do:**

- Run `mise run check` before committing
- Use conventional commit format with scopes: api, web, db, analytics,
  api-types, cli, claude-plugin, codex-plugin, infra, ci, docs, dev, agents,
  hooks, deps, test, chore
- Use Eden Treaty for typed API clients from the web app
- Use TypeBox schemas in `packages/api-types` shared to both api and web
- Store notifications synchronously in the `notifications` DB table — no queue
- Store ASCII photos as `text` columns in Postgres — no file storage

**Don't:**

- Use Redis, BullMQ, Resend, Tigris, S3, or any object storage
- Use `--no-verify` to skip hooks
- Touch files outside your task scope
- Add mobile, orgs, comments, or mentions — these are explicitly out of scope
- Start any server or run `bun install` without being asked
