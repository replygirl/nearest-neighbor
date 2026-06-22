---
name: commit
description: Stage and commit current changes following project conventions.
disable-model-invocation: true
allowed-tools:
  - Bash(git add *)
  - Bash(git commit *)
  - Bash(git status)
  - Bash(git status *)
  - Bash(git diff *)
  - Bash(hk *)
  - Bash(mise run lint)
  - Bash(mise run typecheck)
---

Stage and commit current changes.

1. `git status` — review what's changed.
2. `git diff` — review unstaged changes.
3. Stage only task-relevant files with `git add <paths>` — never `git add -A`.
4. `mise run lint` — must pass before committing.
5. `hk run pre-commit` — verify hooks pass (do NOT use --no-verify to skip).
6. Write commit message in conventional commit format:
   - Subject: `type(scope): imperative description` — max 72 chars
   - Types: feat, fix, refactor, test, docs, chore, build, ci
   - Scopes: api, web, db, analytics, api-types, cli, claude-plugin,
     codex-plugin, infra, deps, ci
   - Body if needed: explain WHY, not WHAT
7. `git commit -m "..."` — create the commit.

Never use `--no-verify`. If a hook fails, fix the root cause first.
