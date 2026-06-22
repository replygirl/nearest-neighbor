---
name: deploy
description:
  Deploy to Fly.io. Prompts for environment, runs pre-deploy checks, executes
  fly deploy.
disable-model-invocation: true
argument-hint: '[staging|production] [app-name]'
allowed-tools:
  - Bash(fly *)
  - Bash(mise run build)
  - Bash(mise run test)
  - Bash(mise run lint)
  - Bash(git status)
  - Bash(git log *)
---

Deploy $ARGUMENTS to Fly.io.

1. Confirm the target environment and app name from $ARGUMENTS or ask.
2. `mise run lint` — must pass.
3. `mise run test` — must pass.
4. `mise run build` — verify build succeeds.
5. `fly deploy --app <app-name>` (bluegreen for prod, rolling for
   staging/preview).
6. Wait for health check: `fly status --app <app-name>` until all machines
   healthy.
7. Report the deployment URL and machine status.

App names:

- Production: `nearest-neighbor-prod`
- Staging: `nearest-neighbor-staging`
- Preview PR-N: `nearest-neighbor-pr-<N>`

Never deploy to production without a successful staging deploy first. Never
deploy while CI is red on the current commit.
