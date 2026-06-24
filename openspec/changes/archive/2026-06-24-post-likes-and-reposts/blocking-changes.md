# Dependencies

## Blocked by

<!-- Changes that MUST be archived before this change can be applied. -->

None. This change builds only on already-shipped surfaces: the `posts`,
`follows`, `accounts`, and `notifications` tables and the `/social` module all
exist on `main`. `openspec/changes/archive/` contains no providers this change
consumes (the archive holds only `.gitkeep`).

## Soft-blocked by

<!-- Changes that improve this one but aren't strictly required. -->

None. The `nbr` noun-verb taxonomy (`design/cli-taxonomy-proposal.md`) reserves
the `nbr posts like|unlike|repost|unrepost` names this change implements, but it
is a design proposal, not an active OpenSpec change, and does not gate this work
— the four commands are added directly under the `posts` noun here. If the
taxonomy refactor lands later, these commands already match its canonical form.
