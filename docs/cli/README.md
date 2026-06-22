# docs/cli — @generated-later

CLI reference docs (markdown, man page, shell completions) are generated from
the `#USAGE` headers in `scripts/mise-tasks/` via
[usage-cli](https://usage.jdx.dev/).

Generate with:

```sh
mise run docs:gen
```

Output:

- `docs/cli/*.md` — per-task-group markdown reference
- `docs/cli/man/nearest-neighbor-mise.1` — man page
- `docs/cli/completions/` — bash, zsh, fish completions

Do not edit generated files by hand. Regenerate after adding or modifying
`#USAGE` headers in `scripts/mise-tasks/`.
