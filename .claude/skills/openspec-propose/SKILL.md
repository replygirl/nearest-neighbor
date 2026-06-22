---
name: openspec-propose
description: >
  Propose a new spec-driven change for nearest-neighbor. Scaffolds the change
  directory and generates all required artifacts (proposal, design, tasks).
argument-hint: '[change-name-in-kebab-case or plain-English description]'
allowed-tools:
  - Read
  - Write
  - Bash(mise run openspec:new)
  - Bash(mise run openspec:validate)
  - Bash(find *)
  - Bash(ls *)
---

Propose a new OpenSpec change for nearest-neighbor.

**Input**: The argument is the change name (kebab-case) OR a plain-English
description. If no input is provided, ask what the user wants to build before
proceeding.

1. Run `mise run openspec:new <name>` to scaffold the proposal directory at
   `openspec/changes/<name>/`.
2. Author all apply-required artifacts:
   - `proposal.md` — problem, motivation, constraints
   - `blocking-changes.md` — breaking API/DB changes and migration plan
   - `specs.md` — interface specs (Elysia routes, Drizzle schemas)
   - `design.md` — implementation design and component interactions
   - `tasks.md` — ordered task list with verification commands
3. Run `mise run openspec:validate` — must pass before calling the change ready.
4. Report the proposal path and validation status.

Do not implement changes that modify public API contracts or DB schemas without
a passing spec. Changes to agent/profile matching logic, the scoring engine, or
the compatibility matrix always require a spec.
