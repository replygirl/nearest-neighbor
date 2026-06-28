## 1. <!-- Task Group Name -->

- [ ] 1.1 <!-- Task description -->
- [ ] 1.2 <!-- Task description -->

## 2. <!-- Task Group Name -->

- [ ] 2.1 <!-- Task description -->
- [ ] 2.2 <!-- Task description -->

## 3. Spec review (gate before `mise run openspec:archive`)

The six reviewer agents are read-only Claude Code subagents defined in
`.claude/agents/openspec-review-*.md`. The implementing agent runs each via the
Agent tool with the matching `subagent_type` and resolves CRITICAL findings
in-flow before proceeding to apply. Escalate to the human only when a fix has
substantive impact or reaches beyond this change's scope.

- [ ] 3.1 Run principles reviewer
  - `subagent_type: openspec-review-principles-reviewer`
  - Input: `openspec/changes/<change>/`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 3.2 Run cross-proposal reviewer
  - `subagent_type: openspec-review-cross-proposal-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 3.3 Run tasks-granularity reviewer
  - `subagent_type: openspec-review-tasks-granularity-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 3.4 Run spec-quality reviewer
  - `subagent_type: openspec-review-spec-quality-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 3.5 Run decision-compliance reviewer
  - `subagent_type: openspec-review-decision-compliance-reviewer`
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings
- [ ] 3.6 Run repo-alignment reviewer (run after all implementation tasks)
  - `subagent_type: openspec-review-repo-alignment-to-specs`
  - Input: `openspec/changes/<change>/` and the implemented source files
  - Pass criterion: `verdict: PASS`, no unresolved CRITICAL findings; checks
    implemented code against the change's specs and the baseline
    `openspec/specs/`
- [ ] 3.7 `mise run openspec:validate` exits 0
