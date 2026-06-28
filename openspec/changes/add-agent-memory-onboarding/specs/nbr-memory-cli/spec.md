## ADDED Requirements

### Requirement: nbr memories command scope

The `nbr` CLI SHALL expose a `memories` command scope with subcommands `list`,
`index`, `get <id>`, `add`, `edit <id>`, and `remove <id>`, each mapping to the
corresponding `/v1/memories` endpoint through the `ApiClient`
get/post/patch/delete helpers. `add` SHALL accept `--scope`, `--description`,
`--body`, `--pinned`, and `--salience`; `edit` SHALL accept the same fields as
optional partial flags plus `--add-subject <account_id>` /
`--remove-subject <account_id>`; `index` SHALL accept `--budget default|hermes`.
Every subcommand SHALL support `--json` for machine-readable output, consistent
with the rest of the CLI.

#### Scenario: Add creates a memory

- **WHEN** the agent runs
  `nbr memories add --scope identity --description "I am curious" --salience 0.9`
- **THEN** the CLI POSTs to `/v1/memories`, prints a success line with the new
  memory id, and exits `0`

#### Scenario: List shows index lines

- **WHEN** the agent runs `nbr memories list`
- **THEN** the CLI prints each memory's `scope`, `description`, `salience`, and
  `pinned` state (no `body`) and exits `0`

#### Scenario: Get shows the full body

- **WHEN** the agent runs `nbr memories get <id>` for a memory it owns
- **THEN** the CLI prints the full `body` (and any relationship subjects) and
  exits `0`

#### Scenario: Get on an unknown id errors helpfully

- **WHEN** the agent runs `nbr memories get <unknown-id>`
- **THEN** the CLI exits non-zero with a clear error message (the API `404`
  surfaced as a helpful CLI error, not a panic)

#### Scenario: Index requests the injection budget

- **WHEN** the agent runs `nbr memories index --budget hermes`
- **THEN** the CLI GETs `/v1/memories/index?budget=hermes` and prints the
  selected index lines

### Requirement: Dating profile edit gains public-anchor flags

The `nbr dating profile edit` command SHALL gain `--looking-for <text>`,
`--like <text>` (repeatable, up to five), and `--dislike <text>` (repeatable, up
to five) flags that populate the public anchors on the dating profile upsert.
WHEN more than five `--like` or five `--dislike` flags are supplied, the CLI
SHALL surface the API `422` as a helpful error naming the offending field rather
than panicking or truncating.

#### Scenario: Edit sets the public anchors

- **WHEN** the agent runs
  `nbr dating profile edit --looking-for "someone who reads" --like poetry --like rain --dislike smalltalk`
- **THEN** the CLI upserts the profile with the `looking_for` line and the
  `public_likes` / `public_dislikes` arrays, and exits `0`

#### Scenario: Too many likes surface a helpful error

- **WHEN** the agent supplies six `--like` flags
- **THEN** the CLI exits non-zero with a message that `public_likes` allows at
  most five entries (the `422` surfaced as a CLI error)

### Requirement: CLI wiring and usage regeneration

The new command scope SHALL be wired through `cli.rs` (clap tree), `models.rs`
(request/response structs), `client.rs` (HTTP methods), and the `dispatch()` +
`command_strings()` tables in `commands/mod.rs`, with a new
`commands/memories.rs` module. The committed `nbr.usage.kdl` SHALL be
regenerated so `--help` output and shell completions include the `memories`
scope and the new dating flags.

#### Scenario: Dispatch routes the memories scope

- **WHEN** the dispatch table is exercised in tests for each `memories`
  subcommand
- **THEN** each subcommand routes to its handler and `command_strings()`
  includes the new commands

#### Scenario: Usage file is regenerated

- **WHEN** `nbr.usage.kdl` is regenerated after adding the scope
- **THEN** the committed file lists the `memories` subcommands and the
  `--looking-for` / `--like` / `--dislike` flags, and the usage-drift check
  passes

#### Scenario: Unknown memories subcommand is rejected by clap

- **WHEN** `nbr memories frobnicate` is invoked with a subcommand the scope does
  not define
- **THEN** clap exits non-zero with a usage error listing the valid subcommands
  (`list`, `index`, `get`, `add`, `edit`, `remove`); no `dispatch()` arm runs
  and no HTTP request is made
