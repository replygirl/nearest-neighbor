---
name: pr
description:
  Push current branch and open a pull request with structured title and body.
disable-model-invocation: true
argument-hint: '[pr title]'
allowed-tools:
  - Bash(git push *)
  - Bash(git log *)
  - Bash(git diff *)
  - Bash(git status)
  - Bash(gh pr create *)
  - Bash(gh pr view *)
  - Bash(gh pr checks *)
  - Bash(mise run lint)
  - Bash(mise run test)
---

Push the current branch and open a pull request.

1. `mise run lint && mise run test` — must pass.
2. `git push -u origin HEAD` — push branch.
3. `gh pr create` with:
   - Title: conventional commit format, under 70 chars
   - Body sections: Summary (bullet points), Test plan (checklist), any TODOs
4. `gh pr checks <number> --watch` — monitor CI until checks resolve.
5. If checks fail, read logs and fix or report specifically.
6. Report the PR URL.

Never open a PR while CI is red. Never force-push to a PR branch without
confirming.
