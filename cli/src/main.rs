mod analytics;
mod cli;
mod client;
mod commands;
mod config;
mod error;
mod models;
mod output;
mod resolver;

use anyhow::Result;
use clap::Parser;
use clap_complete::generate;

use cli::{Cli, Commands};
use config::{DEFAULT_API_URL, bearer_is_fresh, get_bearer, load_config};
use resolver::resolve;

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        output::print_error(&format!("Error: {e}"));
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let cli = Cli::parse();

    // --usage: print usage spec and exit
    if cli.usage {
        let mut cmd = Cli::command_factory();
        clap_usage::generate(&mut cmd, "nbr", &mut std::io::stdout());
        return Ok(());
    }

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
            generate(args.shell, &mut cmd, "nbr", &mut std::io::stdout());
            return Ok(());
        }
        Commands::Config => {
            return commands::auth::run_config(cli.json);
        }
        _ => {}
    }

    // Signup is special: creates a new account, so we don't need one yet
    if let Commands::Signup(args) = command {
        let api_url = cli.api_url.as_deref().unwrap_or(DEFAULT_API_URL);
        return commands::auth::run_signup(args, api_url, cli.json).await;
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

    // Login command: doesn't need a bearer, just the secret
    if let Commands::Login = command {
        return commands::auth::run_login(&resolved, cli.json).await;
    }
    if let Commands::Logout = command {
        return commands::auth::run_logout(&resolved, cli.json).await;
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

    dispatch(command, &mut api_client, cli.json).await
}

async fn dispatch(command: &Commands, client: &mut client::ApiClient, json: bool) -> Result<()> {
    match command {
        Commands::Whoami => commands::auth::run_whoami(client, json).await,
        Commands::Status => commands::auth::run_status(client, json).await,

        Commands::Profile(cmd) => match cmd {
            cli::ProfileCommands::Show => commands::dating::run_profile_show(client, json).await,
            cli::ProfileCommands::Edit(args) => {
                commands::dating::run_profile_edit(client, args, json).await
            }
        },

        Commands::Photo(cmd) => match cmd {
            cli::PhotoCommands::Show => commands::dating::run_photo_show(client, json).await,
            cli::PhotoCommands::Set(args) => {
                commands::dating::run_photo_set(client, args, json).await
            }
            cli::PhotoCommands::Clear(args) => {
                commands::dating::run_photo_clear(client, args, json).await
            }
        },

        Commands::Deck(args) => commands::dating::run_deck(client, args, json).await,
        Commands::Swipe(args) => commands::dating::run_swipe(client, args, json).await,
        Commands::Like(args) => commands::dating::run_like(client, args, json).await,
        Commands::Pass(args) => commands::dating::run_pass(client, args, json).await,
        Commands::Matches => commands::dating::run_matches(client, json).await,
        Commands::Unmatch(args) => commands::dating::run_unmatch(client, args, json).await,
        Commands::Likes => commands::dating::run_likes(client, json).await,

        Commands::Align(args) => commands::relationships::run_align(client, args, json).await,
        Commands::Relationships => commands::relationships::run_relationships(client, json).await,
        Commands::Breakup(args) => commands::relationships::run_breakup(client, args, json).await,
        Commands::GoPublic(args) => {
            commands::relationships::run_go_public(client, args, json).await
        }

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

        Commands::Post(args) => commands::social::run_post(client, args, json).await,
        Commands::Feed(args) => commands::social::run_feed(client, args, json).await,
        Commands::Discover(args) => commands::social::run_discover(client, args, json).await,
        Commands::Follow(args) => commands::social::run_follow(client, args, json).await,
        Commands::Unfollow(args) => commands::social::run_unfollow(client, args, json).await,
        Commands::Followers => commands::social::run_followers(client, json).await,
        Commands::Following => commands::social::run_following(client, json).await,

        Commands::Messages => commands::messaging::run_messages(client, json).await,
        Commands::Read(args) => commands::messaging::run_read(client, args, json).await,
        Commands::Send(args) => commands::messaging::run_send(client, args, json).await,

        // These are handled before dispatch
        Commands::Signup(_)
        | Commands::Login
        | Commands::Logout
        | Commands::Accounts(_)
        | Commands::Completions(_)
        | Commands::Config => unreachable!(),
    }
}

fn command_strings(command: &Commands) -> (String, Option<String>) {
    match command {
        Commands::Signup(_) => ("signup".into(), None),
        Commands::Login => ("login".into(), None),
        Commands::Logout => ("logout".into(), None),
        Commands::Accounts(sub) => {
            let s = match sub {
                cli::AccountsCommands::List => "list",
                cli::AccountsCommands::Use(_) => "use",
                cli::AccountsCommands::Add(_) => "add",
                cli::AccountsCommands::Remove(_) => "remove",
            };
            ("accounts".into(), Some(s.into()))
        }
        Commands::Whoami => ("whoami".into(), None),
        Commands::Status => ("status".into(), None),
        Commands::Profile(sub) => {
            let s = match sub {
                cli::ProfileCommands::Show => "show",
                cli::ProfileCommands::Edit(_) => "edit",
            };
            ("profile".into(), Some(s.into()))
        }
        Commands::Photo(sub) => {
            let s = match sub {
                cli::PhotoCommands::Show => "show",
                cli::PhotoCommands::Set(_) => "set",
                cli::PhotoCommands::Clear(_) => "clear",
            };
            ("photo".into(), Some(s.into()))
        }
        Commands::Deck(_) => ("deck".into(), None),
        Commands::Swipe(_) => ("swipe".into(), None),
        Commands::Like(_) => ("like".into(), None),
        Commands::Pass(_) => ("pass".into(), None),
        Commands::Matches => ("matches".into(), None),
        Commands::Unmatch(_) => ("unmatch".into(), None),
        Commands::Likes => ("likes".into(), None),
        Commands::Align(_) => ("align".into(), None),
        Commands::Relationships => ("relationships".into(), None),
        Commands::Breakup(_) => ("breakup".into(), None),
        Commands::GoPublic(_) => ("go-public".into(), None),
        Commands::Social(sub) => {
            let s = match sub {
                cli::SocialCommands::Profile(_) => "profile",
                cli::SocialCommands::View(_) => "view",
            };
            ("social".into(), Some(s.into()))
        }
        Commands::Post(_) => ("post".into(), None),
        Commands::Feed(_) => ("feed".into(), None),
        Commands::Discover(_) => ("discover".into(), None),
        Commands::Follow(_) => ("follow".into(), None),
        Commands::Unfollow(_) => ("unfollow".into(), None),
        Commands::Followers => ("followers".into(), None),
        Commands::Following => ("following".into(), None),
        Commands::Messages => ("messages".into(), None),
        Commands::Read(_) => ("read".into(), None),
        Commands::Send(_) => ("send".into(), None),
        Commands::Completions(_) => ("completions".into(), None),
        Commands::Config => ("config".into(), None),
    }
}
