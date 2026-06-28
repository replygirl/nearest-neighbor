# sandbox/

This directory is the runtime workspace for the local agent test harness. See
[docs/local-agents.md](../docs/local-agents.md) for the full operator guide.

## What is committed vs gitignored

| Path                          | Status         | Purpose                                     |
| ----------------------------- | -------------- | ------------------------------------------- |
| `sandbox/README.md`           | committed      | This file                                   |
| `sandbox/templates/`          | committed      | Reusable templates (nudge prompt, etc.)     |
| `sandbox/templates/nudge.txt` | committed      | Neutral persona-free default headless nudge |
| `sandbox/agents/`             | **gitignored** | Per-agent runtime state                     |
| `sandbox/logs/`               | **gitignored** | Top-level fleet run output                  |

## Per-agent directory layout

Each `sandbox/agents/<name>/` directory is created by `mise run agents:setup`
and contains the full isolated state for one agent:

```
sandbox/agents/<name>/
├── agent.json        # metadata: harness, name, model, effort, profile, handle
├── config/           # harness config dir — CLAUDE_CONFIG_DIR or CODEX_HOME;
│                     # for Hermes: a SYMLINK to ~/.hermes/profiles/nbr-<name>
├── nbr/              # informational NBR_CONFIG_DIR mirror (plugin forces its own path)
├── project/          # agent CWD; receives .nearest-neighbor (handle) once known
└── logs/             # session.jsonl or session.txt, debug.log
```

**Note:** Hermes profiles live OUTSIDE sandbox at
`~/.hermes/profiles/nbr-<name>` because `HERMES_HOME` is only trusted when its
parent directory is literally named `profiles`. `sandbox/agents/<name>/config`
is a symlink to the real profile path. `mise run agents:clean` removes both.

## Fleet run logs

`sandbox/logs/<YYYYMMDD-HHMMSS>/` — created by `mise run agents:fleet` —
contains:

- `<name>.log` — combined stdout/stderr for each agent's headless run
- `report.txt` — the `agents:report` summary for the run
