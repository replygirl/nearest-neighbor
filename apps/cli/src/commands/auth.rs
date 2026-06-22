/// Fully implemented: signup, login, logout, accounts, whoami/me, status, config.
use anyhow::Result;
use owo_colors::OwoColorize;

use crate::cli::{AccountAddArgs, AccountRemoveArgs, AccountUseArgs, AccountsCommands, SignupArgs};
use crate::client::ApiClient;
use crate::config::{
    self, DEFAULT_API_URL, add_account, config_path, delete_bearer, get_bearer, load_config,
    remove_account, set_bearer, set_default_account, set_secret,
};
use crate::output::{print_kv, print_success, print_table};
use crate::resolver::ResolvedAccount;

fn effective_api_url(resolved: &ResolvedAccount) -> String {
    resolved
        .api_url
        .clone()
        .or_else(|| std::env::var("NBR_API_URL").ok())
        .unwrap_or_else(|| DEFAULT_API_URL.to_string())
}

// ── Signup ────────────────────────────────────────────────────────────────────

pub async fn run_signup(args: &SignupArgs, api_url: &str, json: bool) -> Result<()> {
    let client = ApiClient::new(api_url);
    let resp = client.signup().await?;

    let account_name = args
        .account_name
        .clone()
        .unwrap_or_else(|| "default".to_string());

    add_account(&account_name, &resp.account_id, None)?;
    set_secret(&account_name, &resp.secret)?;

    if json {
        crate::output::print_json(&serde_json::json!({
            "account_name": account_name,
            "account_id": resp.account_id,
            "secret": resp.secret,
        }));
    } else {
        print_success("Account created!");
        print_kv(&[
            ("account name", account_name.clone()),
            ("account_id", resp.account_id.clone()),
        ]);
        eprintln!();
        eprintln!(
            "Your secret key has been saved to the keyring (or a file with 0600 permissions)."
        );
        eprintln!("Run `nbr login` to mint a bearer token.");
        if args.handle.is_some() || args.name.is_some() {
            eprintln!();
            eprintln!(
                "Hint: run `nbr login` first, then `nbr profile edit` and `nbr social profile edit` to set up your profiles."
            );
        }
    }

    Ok(())
}

// ── Login ─────────────────────────────────────────────────────────────────────

pub async fn run_login(resolved: &ResolvedAccount, json: bool) -> Result<()> {
    let api_url = effective_api_url(resolved);
    let secret = config::get_secret(&resolved.name)?;
    let client = ApiClient::new(&api_url);
    let resp = client.login(&secret).await?;

    set_bearer(&resolved.name, &resp.bearer, &resp.expires_at)?;

    if json {
        crate::output::print_json(&serde_json::json!({
            "account": resolved.name,
            "expires_at": resp.expires_at,
        }));
    } else {
        print_success(&format!("Logged in as '{}'.", resolved.name));
        print_kv(&[("expires_at", resp.expires_at)]);
    }

    Ok(())
}

// ── Logout ────────────────────────────────────────────────────────────────────

pub async fn run_logout(resolved: &ResolvedAccount, json: bool) -> Result<()> {
    let api_url = effective_api_url(resolved);

    if let Ok(Some((bearer, _expiry))) = get_bearer(&resolved.name) {
        let mut client = ApiClient::new(&api_url);
        client.bearer = Some(bearer);
        client.account_name = Some(resolved.name.clone());
        let _ = client.logout(None).await; // best-effort
    }

    delete_bearer(&resolved.name)?;

    if json {
        crate::output::print_json(&serde_json::json!({ "logged_out": true }));
    } else {
        print_success(&format!("Logged out '{}'.", resolved.name));
    }

    Ok(())
}

// ── Accounts ──────────────────────────────────────────────────────────────────

pub fn run_accounts_list(json: bool) -> Result<()> {
    let config = load_config()?;
    let default = config.default_account.as_deref().unwrap_or("");

    if json {
        crate::output::print_json(&config.accounts);
        return Ok(());
    }

    if config.accounts.is_empty() {
        println!("No accounts configured. Run `nbr signup` to get started.");
        return Ok(());
    }

    let rows = config
        .accounts
        .iter()
        .map(|a| {
            let marker = if a.name == default { "*" } else { " " };
            vec![
                marker.to_string(),
                a.name.clone(),
                a.account_id.clone(),
                a.api_url
                    .clone()
                    .unwrap_or_else(|| DEFAULT_API_URL.to_string()),
            ]
        })
        .collect();

    print_table(&["", "Name", "Account ID", "API URL"], rows);
    Ok(())
}

pub fn run_accounts_use(args: &AccountUseArgs) -> Result<()> {
    set_default_account(&args.name)?;
    print_success(&format!("Default account set to '{}'.", args.name));
    Ok(())
}

pub fn run_accounts_add(args: &AccountAddArgs) -> Result<()> {
    add_account(&args.name, &args.account_id, args.api_url.as_deref())?;
    set_secret(&args.name, &args.secret)?;
    print_success(&format!("Account '{}' added.", args.name));
    Ok(())
}

pub fn run_accounts_remove(args: &AccountRemoveArgs) -> Result<()> {
    remove_account(&args.name)?;
    print_success(&format!("Account '{}' removed.", args.name));
    Ok(())
}

pub async fn run_accounts(cmd: &AccountsCommands, json: bool) -> Result<()> {
    match cmd {
        AccountsCommands::List => run_accounts_list(json),
        AccountsCommands::Use(args) => run_accounts_use(args),
        AccountsCommands::Add(args) => run_accounts_add(args),
        AccountsCommands::Remove(args) => run_accounts_remove(args),
    }
}

// ── Whoami / Me ───────────────────────────────────────────────────────────────

pub async fn run_whoami(client: &mut ApiClient, json: bool) -> Result<()> {
    let me = client.me().await?;

    if json {
        crate::output::print_json(&me);
        return Ok(());
    }

    print_kv(&[
        ("account_id", me.account.id.clone()),
        ("status", me.account.status.clone()),
        ("joined", me.account.created_at.clone()),
    ]);

    if let Some(dp) = &me.dating_profile {
        println!();
        println!("{}", "Dating profile:".bold());
        print_kv(&[
            ("name", dp.first_name.clone()),
            ("bio", dp.bio.clone()),
            ("relationship_status", dp.relationship_status.clone()),
            ("open_to_multi", dp.open_to_multi.to_string()),
            ("status_is_open", dp.status_is_open.to_string()),
            ("visible", dp.is_visible.to_string()),
        ]);
    } else {
        println!();
        println!(
            "No dating profile set up. Run `nbr profile edit --first-name <name>` to create one."
        );
    }

    if let Some(sp) = &me.social_profile {
        println!();
        println!("{}", "Social profile:".bold());
        print_kv(&[
            ("handle", format!("@{}", sp.handle)),
            (
                "display_name",
                sp.display_name
                    .clone()
                    .unwrap_or_else(|| "(none)".to_string()),
            ),
            ("bio", sp.bio.clone()),
            ("open_dms", sp.open_dms.to_string()),
        ]);
    } else {
        println!();
        println!(
            "No social profile set up. Run `nbr social profile edit --handle <h>` to create one."
        );
    }

    Ok(())
}

// ── Status ────────────────────────────────────────────────────────────────────

pub async fn run_status(client: &mut ApiClient, json: bool) -> Result<()> {
    let status = client.status().await?;

    if json {
        crate::output::print_json(&status);
        return Ok(());
    }

    println!("{}", "Status:".bold());
    print_kv(&[
        ("unread_messages", status.unread_messages.to_string()),
        ("new_likes", status.new_likes.to_string()),
        ("new_matches", status.new_matches.to_string()),
        ("new_followers", status.new_followers.to_string()),
        (
            "pending_relationships",
            status.pending_relationships.to_string(),
        ),
    ]);

    if !status.elevated.is_empty() {
        println!();
        println!(
            "{} elevated notification{}:",
            status.elevated.len(),
            if status.elevated.len() == 1 { "" } else { "s" }
        );
        for n in &status.elevated {
            println!("  [{}] {}", n.kind, n.id);
        }
    }

    Ok(())
}

// ── Config ────────────────────────────────────────────────────────────────────

pub fn run_config(json: bool) -> Result<()> {
    let config_file = config_path()?;
    let config = load_config()?;

    if json {
        crate::output::print_json(&serde_json::json!({
            "config_file": config_file.display().to_string(),
            "default_account": config.default_account,
            "accounts": config.accounts.len(),
            "telemetry": config.telemetry,
        }));
    } else {
        print_kv(&[
            ("config_file", config_file.display().to_string()),
            (
                "default_account",
                config
                    .default_account
                    .unwrap_or_else(|| "(none)".to_string()),
            ),
            ("accounts", config.accounts.len().to_string()),
            (
                "telemetry",
                config
                    .telemetry
                    .map(|t| t.to_string())
                    .unwrap_or_else(|| "enabled".to_string()),
            ),
        ]);
    }

    Ok(())
}
