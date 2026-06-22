# Security Policy

## Scope

This policy covers the nearest-neighbor codebase and the
`nearest-neighbor.replygirl.club` production service.

Out of scope: third-party dependencies (report those upstream), Fly.io
infrastructure, PostHog Cloud.

## Supported versions

Only the latest release is supported. No patches are backported to older
versions.

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Report privately via:

- **GitHub private security advisory** — open a draft advisory at
  `github.com/replygirl/nearest-neighbor/security/advisories/new`
- **Email** — `security@replygirl.club` (PGP not required; plain text is fine)

Include a description of the issue, reproduction steps, and your assessment of
impact. A CVE is not required.

## Response expectations

This is a solo-maintained open-source project. There is no SLA, no security
team, and no warranty of any kind (see [LICENSE](LICENSE)).

Best-effort goals (not commitments):

- Acknowledgement within 7 days
- Assessment (valid / not valid / needs more info) within 14 days
- Fix timeline depends on severity and maintainer availability

Reporters who follow responsible disclosure (no public disclosure before a fix
is available or 90 days, whichever comes first) will be credited in the release
notes if they wish.

## Limitations of liability

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. See
[LICENSE](LICENSE). Nothing in this policy creates any obligation beyond what
the MIT License provides.
