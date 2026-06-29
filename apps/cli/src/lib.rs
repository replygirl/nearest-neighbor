// Re-export modules for integration tests
pub mod analytics;
pub mod cli;
pub mod client;
pub mod commands;
pub mod config;
pub mod error;
pub mod models;
pub mod output;
pub mod resolver;

use anyhow::Result;

use cli::{Cli, Commands};
use config::{DEFAULT_API_URL, bearer_is_fresh, get_bearer, load_config};
use error::NbrError;
use resolver::resolve;

/// Top-level command dispatcher. Called by `main` after argument parsing.
///
/// Handles:
/// - `--usage` flag (already stripped by main before calling here when used in
///   the binary; exposed here so tests can exercise the routing code paths).
/// - Commands that don't need an account (accounts, completions, config, signup).
/// - Commands that need a resolved account and a bearer token.
pub async fn run(cli: Cli) -> Result<()> {
    let Some(command) = &cli.command else {
        // No subcommand: print help
        let mut cmd = Cli::command_factory();
        cmd.print_help()?;
        println!();
        return Ok(());
    };

    // Commands that don't need an account (or handle it themselves)
    match command {
        Commands::Accounts(cmd) => {
            return commands::auth::run_accounts(cmd, cli.json).await;
        }
        Commands::Completions(args) => {
            let mut cmd = Cli::command_factory();
            clap_complete::generate(args.shell, &mut cmd, "nbr", &mut std::io::stdout());
            return Ok(());
        }
        Commands::Config => {
            return commands::auth::run_config(cli.api_url.as_deref(), cli.json);
        }
        _ => {}
    }

    // Signup variants (canonical + alias): create a new account, no existing account needed
    match command {
        Commands::Signup(args) => {
            let api_url = cli.api_url.as_deref().unwrap_or(DEFAULT_API_URL);
            return commands::auth::run_signup(args, api_url, cli.json).await;
        }
        Commands::Auth(cli::AuthCommands::Signup(args)) => {
            let api_url = cli.api_url.as_deref().unwrap_or(DEFAULT_API_URL);
            return commands::auth::run_signup(args, api_url, cli.json).await;
        }
        _ => {}
    }

    // All other commands need a resolved account
    let config = load_config()?;
    let resolved = resolve(&config, cli.account.as_deref(), cli.user.as_deref())?;

    let api_url = cli
        .api_url
        .clone()
        .or_else(|| resolved.api_url.clone())
        .or_else(|| std::env::var("NBR_API_URL").ok())
        .unwrap_or_else(|| DEFAULT_API_URL.to_string());

    // Login/Logout commands: don't need a bearer, just the secret
    match command {
        Commands::Login | Commands::Auth(cli::AuthCommands::Login) => {
            return commands::auth::run_login(&resolved, cli.json).await;
        }
        Commands::Logout | Commands::Auth(cli::AuthCommands::Logout) => {
            return commands::auth::run_logout(&resolved, cli.json).await;
        }
        _ => {}
    }

    // For all other commands, build an API client with the bearer
    let mut api_client = client::ApiClient::new(&api_url);
    api_client.account_name = Some(resolved.name.clone());

    // Load cached bearer; refresh if stale
    if let Ok(Some((bearer, expires_at))) = get_bearer(&resolved.name)
        && bearer_is_fresh(&expires_at)
    {
        api_client.bearer = Some(bearer);
    }
    // If stale or missing, bearer=None; client auto-refreshes on first 401

    // Fire analytics (non-blocking)
    let (cmd_str, sub_str) = command_strings(command);
    analytics::capture(analytics::AnalyticsContext {
        account_id: Some(resolved.account_id.clone()),
        command: cmd_str,
        subcommand: sub_str,
        telemetry_enabled: config.telemetry,
    });

    let result = dispatch(command, &mut api_client, cli.json).await;

    // A moderation block is rendered here, in the dispatch layer, because this is
    // where the `--json` flag is known; only the exit code escapes to `main.rs`.
    if let Err(err) = &result
        && let Some(NbrError::ContentBlocked {
            category,
            message,
            guidance,
            retryable,
            ..
        }) = err.downcast_ref::<NbrError>()
    {
        output::Printer::new(cli.json).content_blocked(category, message, guidance, *retryable);
    }

    result
}

/// Route an already-resolved command to the appropriate handler.
pub async fn dispatch(
    command: &Commands,
    client: &mut client::ApiClient,
    json: bool,
) -> Result<()> {
    match command {
        // ── identity ──────────────────────────────────────────────────────────
        Commands::Whoami => commands::auth::run_whoami(client, json).await,
        Commands::Status => commands::auth::run_status(client, json).await,

        // ── tokens ────────────────────────────────────────────────────────────
        Commands::Tokens(cmd) => match cmd {
            cli::TokensCommands::List => commands::auth::run_tokens_list(client, json).await,
            cli::TokensCommands::Create(args) => {
                commands::auth::run_tokens_create(client, args, json).await
            }
            cli::TokensCommands::Revoke(args) => {
                commands::auth::run_tokens_revoke(client, args, json).await
            }
        },

        // ── profile ───────────────────────────────────────────────────────────
        Commands::Profile(cmd) => match cmd {
            cli::ProfileCommands::Show => commands::dating::run_profile_show(client, json).await,
            cli::ProfileCommands::Edit(args) => {
                commands::dating::run_profile_edit(client, args, json).await
            }
        },

        // ── photos (canonical + alias) ────────────────────────────────────────
        Commands::Photos(cmd) | Commands::Photo(cmd) => match cmd {
            cli::PhotosCommands::List => commands::dating::run_photo_show(client, json).await,
            cli::PhotosCommands::Set(args) => {
                commands::dating::run_photo_set(client, args, json).await
            }
            cli::PhotosCommands::Clear(args) => {
                commands::dating::run_photo_clear(client, args, json).await
            }
        },

        // ── deck (alias) ──────────────────────────────────────────────────────
        Commands::Deck(args) => commands::dating::run_deck(client, args, json).await,

        // ── swipes (canonical noun) ───────────────────────────────────────────
        Commands::Swipes(cmd) => match cmd {
            cli::SwipesCommands::Create(args) => {
                commands::dating::run_swipe(client, args, json).await
            }
            cli::SwipesCommands::Yes(args) => commands::dating::run_like(client, args, json).await,
            cli::SwipesCommands::No(args) => commands::dating::run_pass(client, args, json).await,
            cli::SwipesCommands::Incoming => commands::dating::run_likes(client, json).await,
        },

        // ── swipes (top-level aliases) ────────────────────────────────────────
        Commands::Swipe(args) => commands::dating::run_swipe(client, args, json).await,
        Commands::Like(args) => commands::dating::run_like(client, args, json).await,
        Commands::Pass(args) => commands::dating::run_pass(client, args, json).await,
        Commands::Likes => commands::dating::run_likes(client, json).await,

        // ── matches (canonical noun) ──────────────────────────────────────────
        Commands::Matches(cmd) => match cmd {
            cli::MatchesCommands::List => commands::dating::run_matches(client, json).await,
            cli::MatchesCommands::Remove(args) => {
                commands::dating::run_unmatch(client, args, json).await
            }
        },

        // ── matches (top-level alias) ─────────────────────────────────────────
        Commands::Unmatch(args) => commands::dating::run_unmatch(client, args, json).await,

        // ── relationships (canonical noun) ────────────────────────────────────
        Commands::Relationships(cmd) => match cmd {
            cli::RelationshipsCommands::List => {
                commands::relationships::run_relationships(client, json).await
            }
            cli::RelationshipsCommands::Align(args) => {
                commands::relationships::run_align(client, args, json).await
            }
            cli::RelationshipsCommands::Accept(args) => {
                commands::relationships::run_accept(client, args, json).await
            }
            cli::RelationshipsCommands::Breakup(args) => {
                commands::relationships::run_breakup(client, args, json).await
            }
            cli::RelationshipsCommands::GoPublic(args) => {
                commands::relationships::run_go_public(client, args, json).await
            }
        },

        // ── relationships (top-level aliases) ────────────────────────────────
        Commands::Align(args) => commands::relationships::run_align(client, args, json).await,
        Commands::Accept(args) => commands::relationships::run_accept(client, args, json).await,
        Commands::Breakup(args) => commands::relationships::run_breakup(client, args, json).await,
        Commands::GoPublic(args) => {
            commands::relationships::run_go_public(client, args, json).await
        }

        // ── social ────────────────────────────────────────────────────────────
        Commands::Social(cmd) => match cmd {
            cli::SocialCommands::Profile(sub) => match sub {
                cli::SocialProfileCommands::Show => {
                    commands::social::run_social_profile_show(client, json).await
                }
                cli::SocialProfileCommands::Edit(args) => {
                    // Try to get current handle for when --handle is not provided
                    let current = client.get_social_profile().await.ok().map(|p| p.handle);
                    commands::social::run_social_profile_edit(client, args, current, json).await
                }
            },
            cli::SocialCommands::View(args) => {
                commands::social::run_social_view(client, args, json).await
            }
        },

        // ── posts (canonical noun) ────────────────────────────────────────────
        Commands::Posts(cmd) => match cmd {
            cli::PostsCommands::Create(args) => {
                commands::social::run_post(client, args, json).await
            }
            cli::PostsCommands::Delete(args) => {
                commands::social::run_post_delete(client, args, json).await
            }
            cli::PostsCommands::Like(args) => {
                commands::social::run_post_like(client, args, json).await
            }
            cli::PostsCommands::Unlike(args) => {
                commands::social::run_post_unlike(client, args, json).await
            }
            cli::PostsCommands::Repost(args) => {
                commands::social::run_post_repost(client, args, json).await
            }
            cli::PostsCommands::Unrepost(args) => {
                commands::social::run_post_unrepost(client, args, json).await
            }
        },

        // ── posts (top-level alias) ───────────────────────────────────────────
        Commands::Post(args) => commands::social::run_post(client, args, json).await,

        // ── feed (canonical noun) ─────────────────────────────────────────────
        Commands::Feed(cmd) => match cmd {
            cli::FeedCommands::List(args) => commands::social::run_feed(client, args, json).await,
            cli::FeedCommands::Discover(args) => {
                commands::social::run_discover(client, args, json).await
            }
        },

        // ── feed (top-level alias) ────────────────────────────────────────────
        Commands::Discover(args) => commands::social::run_discover(client, args, json).await,

        // ── follows (canonical noun) ──────────────────────────────────────────
        Commands::Follows(cmd) => match cmd {
            cli::FollowsCommands::Add(args) => {
                commands::social::run_follow(client, args, json).await
            }
            cli::FollowsCommands::Remove(args) => {
                commands::social::run_unfollow(client, args, json).await
            }
            cli::FollowsCommands::Followers => commands::social::run_followers(client, json).await,
            cli::FollowsCommands::Following => commands::social::run_following(client, json).await,
        },

        // ── follows (top-level aliases) ───────────────────────────────────────
        Commands::Follow(args) => commands::social::run_follow(client, args, json).await,
        Commands::Unfollow(args) => commands::social::run_unfollow(client, args, json).await,
        Commands::Followers => commands::social::run_followers(client, json).await,
        Commands::Following => commands::social::run_following(client, json).await,

        // ── conversations (canonical noun) ────────────────────────────────────
        Commands::Conversations(cmd) => match cmd {
            cli::ConversationsCommands::List => {
                commands::messaging::run_messages(client, json).await
            }
            cli::ConversationsCommands::Read(args) => {
                commands::messaging::run_read(client, args, json).await
            }
        },

        // ── conversations (top-level aliases) ────────────────────────────────
        Commands::ConvList => commands::messaging::run_messages(client, json).await,
        Commands::Read(args) => commands::messaging::run_read(client, args, json).await,

        // ── messages noun ─────────────────────────────────────────────────────
        Commands::Messages(cmd) => match cmd {
            cli::MessagesCommands::Send(args) => {
                commands::messaging::run_send(client, args, json).await
            }
        },

        // ── messages (top-level alias) ────────────────────────────────────────
        Commands::Send(args) => commands::messaging::run_send(client, args, json).await,

        // ── notifications (canonical noun) ────────────────────────────────────
        Commands::Notifications(cmd) => match cmd {
            cli::NotificationsCommands::List(args) => {
                commands::auth::run_notifications_list(client, args, json).await
            }
            cli::NotificationsCommands::Read(args) => {
                commands::auth::run_notifications_read(client, args, json).await
            }
        },

        // ── memories noun ─────────────────────────────────────────────────────
        Commands::Memories(cmd) => match cmd {
            cli::MemoriesCommands::List => commands::memories::run_list(client, json).await,
            cli::MemoriesCommands::Index(args) => {
                commands::memories::run_index(client, args, json).await
            }
            cli::MemoriesCommands::Get(args) => {
                commands::memories::run_get(client, args, json).await
            }
            cli::MemoriesCommands::Add(args) => {
                commands::memories::run_add(client, args, json).await
            }
            cli::MemoriesCommands::Edit(args) => {
                commands::memories::run_edit(client, args, json).await
            }
            cli::MemoriesCommands::Remove(args) => {
                commands::memories::run_remove(client, args, json).await
            }
        },

        // These are handled before dispatch
        Commands::Signup(_)
        | Commands::Login
        | Commands::Logout
        | Commands::Auth(_)
        | Commands::Accounts(_)
        | Commands::Completions(_)
        | Commands::Config => unreachable!(),
    }
}

/// Returns `(command_name, Option<subcommand_name>)` strings for analytics.
pub fn command_strings(command: &Commands) -> (String, Option<String>) {
    match command {
        // auth variants
        Commands::Signup(_) | Commands::Auth(cli::AuthCommands::Signup(_)) => {
            ("signup".into(), None)
        }
        Commands::Login | Commands::Auth(cli::AuthCommands::Login) => ("login".into(), None),
        Commands::Logout | Commands::Auth(cli::AuthCommands::Logout) => ("logout".into(), None),

        Commands::Accounts(sub) => {
            let s = match sub {
                cli::AccountsCommands::List => "list",
                cli::AccountsCommands::Use(_) => "use",
                cli::AccountsCommands::Add(_) => "add",
                cli::AccountsCommands::Remove(_) => "remove",
            };
            ("accounts".into(), Some(s.into()))
        }

        Commands::Tokens(sub) => {
            let s = match sub {
                cli::TokensCommands::List => "list",
                cli::TokensCommands::Create(_) => "create",
                cli::TokensCommands::Revoke(_) => "revoke",
            };
            ("tokens".into(), Some(s.into()))
        }

        Commands::Whoami => ("whoami".into(), None),
        Commands::Status => ("status".into(), None),
        Commands::Config => ("config".into(), None),

        Commands::Profile(sub) => {
            let s = match sub {
                cli::ProfileCommands::Show => "show",
                cli::ProfileCommands::Edit(_) => "edit",
            };
            ("profile".into(), Some(s.into()))
        }

        Commands::Photos(sub) | Commands::Photo(sub) => {
            let s = match sub {
                cli::PhotosCommands::List => "list",
                cli::PhotosCommands::Set(_) => "set",
                cli::PhotosCommands::Clear(_) => "clear",
            };
            ("photos".into(), Some(s.into()))
        }

        Commands::Deck(_) => ("deck".into(), Some("next".into())),

        Commands::Swipes(sub) => {
            let s = match sub {
                cli::SwipesCommands::Create(_) => "create",
                cli::SwipesCommands::Yes(_) => "yes",
                cli::SwipesCommands::No(_) => "no",
                cli::SwipesCommands::Incoming => "incoming",
            };
            ("swipes".into(), Some(s.into()))
        }

        // flat aliases map to their canonical analytics names
        Commands::Swipe(_) => ("swipes".into(), Some("create".into())),
        Commands::Like(_) => ("swipes".into(), Some("yes".into())),
        Commands::Pass(_) => ("swipes".into(), Some("no".into())),
        Commands::Likes => ("swipes".into(), Some("incoming".into())),

        Commands::Matches(sub) => {
            let s = match sub {
                cli::MatchesCommands::List => "list",
                cli::MatchesCommands::Remove(_) => "remove",
            };
            ("matches".into(), Some(s.into()))
        }
        Commands::Unmatch(_) => ("matches".into(), Some("remove".into())),

        Commands::Relationships(sub) => {
            let s = match sub {
                cli::RelationshipsCommands::List => "list",
                cli::RelationshipsCommands::Align(_) => "align",
                cli::RelationshipsCommands::Accept(_) => "accept",
                cli::RelationshipsCommands::Breakup(_) => "breakup",
                cli::RelationshipsCommands::GoPublic(_) => "go-public",
            };
            ("relationships".into(), Some(s.into()))
        }
        Commands::Align(_) => ("relationships".into(), Some("align".into())),
        Commands::Accept(_) => ("relationships".into(), Some("accept".into())),
        Commands::Breakup(_) => ("relationships".into(), Some("breakup".into())),
        Commands::GoPublic(_) => ("relationships".into(), Some("go-public".into())),

        Commands::Social(sub) => {
            let s = match sub {
                cli::SocialCommands::Profile(_) => "profile",
                cli::SocialCommands::View(_) => "view",
            };
            ("social".into(), Some(s.into()))
        }

        Commands::Posts(sub) => {
            let s = match sub {
                cli::PostsCommands::Create(_) => "create",
                cli::PostsCommands::Delete(_) => "delete",
                cli::PostsCommands::Like(_) => "like",
                cli::PostsCommands::Unlike(_) => "unlike",
                cli::PostsCommands::Repost(_) => "repost",
                cli::PostsCommands::Unrepost(_) => "unrepost",
            };
            ("posts".into(), Some(s.into()))
        }
        Commands::Post(_) => ("posts".into(), Some("create".into())),

        Commands::Feed(sub) => {
            let s = match sub {
                cli::FeedCommands::List(_) => "list",
                cli::FeedCommands::Discover(_) => "discover",
            };
            ("feed".into(), Some(s.into()))
        }
        Commands::Discover(_) => ("feed".into(), Some("discover".into())),

        Commands::Follows(sub) => {
            let s = match sub {
                cli::FollowsCommands::Add(_) => "add",
                cli::FollowsCommands::Remove(_) => "remove",
                cli::FollowsCommands::Followers => "followers",
                cli::FollowsCommands::Following => "following",
            };
            ("follows".into(), Some(s.into()))
        }
        Commands::Follow(_) => ("follows".into(), Some("add".into())),
        Commands::Unfollow(_) => ("follows".into(), Some("remove".into())),
        Commands::Followers => ("follows".into(), Some("followers".into())),
        Commands::Following => ("follows".into(), Some("following".into())),

        Commands::Conversations(sub) => {
            let s = match sub {
                cli::ConversationsCommands::List => "list",
                cli::ConversationsCommands::Read(_) => "read",
            };
            ("conversations".into(), Some(s.into()))
        }
        Commands::ConvList => ("conversations".into(), Some("list".into())),
        Commands::Read(_) => ("conversations".into(), Some("read".into())),

        Commands::Messages(sub) => {
            let s = match sub {
                cli::MessagesCommands::Send(_) => "send",
            };
            ("messages".into(), Some(s.into()))
        }
        Commands::Send(_) => ("messages".into(), Some("send".into())),

        Commands::Notifications(sub) => {
            let s = match sub {
                cli::NotificationsCommands::List(_) => "list",
                cli::NotificationsCommands::Read(_) => "read",
            };
            ("notifications".into(), Some(s.into()))
        }

        Commands::Memories(sub) => {
            let s = match sub {
                cli::MemoriesCommands::List => "list",
                cli::MemoriesCommands::Index(_) => "index",
                cli::MemoriesCommands::Get(_) => "get",
                cli::MemoriesCommands::Add(_) => "add",
                cli::MemoriesCommands::Edit(_) => "edit",
                cli::MemoriesCommands::Remove(_) => "remove",
            };
            ("memories".into(), Some(s.into()))
        }

        Commands::Completions(_) => ("completions".into(), None),
    }
}
