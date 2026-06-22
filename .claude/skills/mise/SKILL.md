---
name: mise
description: >
  Mise task runner and version manager for this monorepo. Auto-loaded as
  context. Use when running tasks, checking tool versions, or adding new mise
  tasks.
user-invocable: false
---

## Task inventory

All development operations use `mise run <task>`:

| Category  | Task                | What it does                                   |
| --------- | ------------------- | ---------------------------------------------- |
| Dev       | `dev`               | Start all services (api + web)                 |
| Build     | `build`             | Build all packages                             |
| Lint      | `lint`              | oxlint across all workspaces                   |
| Lint      | `lint:fix`          | Auto-fix lint issues                           |
| Lint      | `lint:ci`           | GitHub Actions annotations format              |
| Format    | `format`            | Check formatting (oxfmt)                       |
| Format    | `format:fix`        | Auto-format all files                          |
| Typecheck | `typecheck`         | `tsgo --noEmit` (TS7)                          |
| Test      | `test`              | Full test suite                                |
| Test      | `test:coverage`     | With coverage report                           |
| Test      | `test:affected`     | Changed files only                             |
| OpenSpec  | `openspec:validate` | Validate all proposals                         |
| OpenSpec  | `openspec:new`      | Scaffold new proposal                          |
| OpenSpec  | `openspec:apply`    | Apply approved proposal                        |
| OpenSpec  | `openspec:check`    | Spec/code alignment check                      |
| Agents    | `agents:sync`       | Sync .agents/shared.md → CLAUDE.md + AGENTS.md |
| Agents    | `agents:check`      | CI drift check for shared blocks               |
| DB        | `db:generate`       | Generate Drizzle migrations                    |
| DB        | `db:migrate`        | Apply migrations                               |
| DB        | `db:seed`           | Seed dev fixtures                              |
| Hooks     | `hooks:install`     | Install git hooks via hk                       |
| Hooks     | `hooks:check`       | Run pre-commit checks manually                 |
| Hooks     | `hooks:check:slow`  | Run all checks including slow profile          |

## Tool versions

Declared in `mise.toml` `[tools]` section. Run `mise install` once after
cloning; `mise trust` if prompted. Never use `nvm`, `rbenv`, `pyenv` directly —
mise manages all runtimes.

## Adding tasks

Define in `mise.toml` inline (`[tasks.<name>]`) for short single-line tasks. For
multi-line scripts, create `scripts/mise-tasks/<name>` and add
`task_config.includes = ["scripts/mise-tasks"]`.

## Monorepo task dispatch

Per-app tasks: `mise run //apps/web:test`, `mise run //apps/web:build`,
`mise run //apps/cli:clippy`, etc. Root tasks orchestrate via
`depends = ["//apps/web:test", "//apps/cli:test"]`.
