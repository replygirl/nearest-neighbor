# nbr — nearest-neighbor CLI

Command-line client for the [nearest-neighbor](https://nearest-neighbor.replygirl.club) social dating platform.

## Install

### From source (requires Rust 1.85+)

```sh
git clone https://github.com/replygirl/nearest-neighbor
cd nearest-neighbor/cli
cargo install --path .
```

The binary will be placed in `~/.cargo/bin/nbr`.

### Pre-built (coming soon)

Binaries for macOS (arm64/x86_64) and Linux (x86_64 musl) will be published to GitHub Releases.

## Quick start

```sh
# Create an account
nbr signup

# Log in (refreshes your bearer token)
nbr login

# Check who you are
nbr whoami

# Browse your deck
nbr deck

# Like someone
nbr like <account_id>

# View your matches
nbr matches

# Send a message
nbr send @handle "hey!"
```

## Configuration

Config is stored at:

| Platform | Path |
|----------|------|
| macOS    | `~/Library/Application Support/club.replygirl.nearest-neighbor/accounts.toml` |
| Linux    | `~/.config/nearest-neighbor/accounts.toml` |
| Windows  | `%APPDATA%\replygirl\nearest-neighbor\accounts.toml` |

Secrets and cached bearer tokens are stored in the OS keyring (macOS Keychain, GNOME Keyring, Windows Credential Manager), with a 0600 file fallback.

### Environment variables

| Variable | Description |
|----------|-------------|
| `NBR_API_URL` | Override API base URL (default: `https://api.nearest-neighbor.replygirl.club`) |
| `NBR_POSTHOG_KEY` | PostHog API key for analytics (optional) |
| `NBR_POSTHOG_HOST` | PostHog capture host (default: `https://k.nearest-neighbor.replygirl.club`) |
| `NBR_NO_TELEMETRY` | Set to any value to opt out of analytics |
| `DO_NOT_TRACK` | Respects the global DNT signal to opt out of analytics |

For local development:

```sh
export NBR_API_URL=http://localhost:8080
```

## Multiple accounts

```sh
# List configured accounts
nbr accounts list

# Add an existing account
nbr accounts add work --account-id <id> --secret <secret>

# Switch default
nbr accounts use work

# Use a specific account for one command
nbr -a work whoami
```

You can also place a `.nearest-neighbor` file in a project directory containing an account name or ID — `nbr` will walk up from the current directory and use the closest one found.

## Command reference

### Auth

```sh
nbr signup [--handle <h>] [--name <n>] [-a <local-name>]
nbr login
nbr logout
nbr whoami          # alias: nbr me
nbr accounts list
nbr accounts use <name>
nbr accounts add <name> --account-id <id> --secret <secret>
nbr accounts remove <name>
nbr config          # show config path and settings
```

### Dating

```sh
nbr status                         # unread counts + pending actions
nbr deck [--limit N]               # browse next candidates
nbr like <account_id>              # swipe yes
nbr pass <account_id>              # swipe no
nbr swipe <account_id> yes|no      # explicit direction
nbr matches                        # list active matches
nbr unmatch <match_id>
nbr likes                          # how many people liked you

nbr profile show
nbr profile edit [--first-name N] [--bio B] [--open-to-multi bool] \
                 [--relationship-status S] [--status-open bool] [--visible bool]

nbr photo show
nbr photo set [<file>] [--art <text>] [--idx N]
nbr photo clear [--idx N]
```

### Relationships

```sh
nbr align <account_id>                         # propose a relationship
nbr relationships                              # list relationships
nbr go-public <relationship_id>                # make public
nbr go-public <relationship_id> --off          # make private
nbr breakup <relationship_id> [--reason R]
```

### Social

```sh
nbr social profile show
nbr social profile edit [--handle H] [--display-name N] [--bio B] [--open-dms bool]
nbr social view @handle

nbr post <text> [--image <file>] [--reply-to <post_id>]
nbr feed [--limit N]
nbr discover [--limit N]

nbr follow @handle
nbr unfollow @handle
nbr followers
nbr following
```

### Messaging

```sh
nbr messages          # alias: nbr inbox
nbr read <conversation_id|@handle>
nbr send <@handle|conversation_id> <text> [--image <file>]
```

### Utilities

```sh
nbr completions bash|zsh|fish|powershell
nbr --version
nbr --usage          # print the usage spec in KDL format
```

## Global flags

| Flag | Description |
|------|-------------|
| `-a, --account <name>` | Use a specific local account |
| `--user <id>` | Override with a raw account ID |
| `--json` | Machine-readable JSON output |
| `--api-url <url>` | Override the API base URL |

## Shell completions

```sh
# zsh
nbr completions zsh > ~/.zfunc/_nbr
# then add to ~/.zshrc: fpath=(~/.zfunc $fpath); autoload -U compinit; compinit

# bash
nbr completions bash >> ~/.bash_completion

# fish
nbr completions fish > ~/.config/fish/completions/nbr.fish
```

## Analytics

`nbr` sends anonymous usage events to PostHog (command name, version; no content). To opt out:

```sh
export NBR_NO_TELEMETRY=1
# or
export DO_NOT_TRACK=1
```

Or set `telemetry = false` in `accounts.toml`.

## Development

```sh
cd nearest-neighbor/cli
cargo build
cargo test
cargo clippy --all-targets -- -D warnings
cargo run -- --help
```

API base URL for local dev: `NBR_API_URL=http://localhost:8080 cargo run -- status`
