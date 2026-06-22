use nbr::cli::{
    AccountAddArgs, AccountRemoveArgs, AccountUseArgs, AccountsCommands, AlignArgs, BreakupArgs,
    Cli, Commands, DeckArgs, DiscoverArgs, FeedArgs, FollowArgs, GoPublicArgs, LikeArgs, PassArgs,
    PhotoClearArgs, PhotoCommands, PostArgs, ProfileCommands, ProfileEditArgs, ReadArgs, SendArgs,
    SignupArgs, SocialCommands, SocialProfileCommands, SocialViewArgs, SwipeArgs, UnfollowArgs,
    UnmatchArgs,
};
use nbr::command_strings;
use serde_json::json;
/// Integration tests for the lib::run / lib::dispatch / lib::command_strings
/// public API.  These call into the library directly (no process spawn) with
/// NBR_CONFIG_DIR pointing at a TempDir and wiremock for the API, so they cover
/// the main.rs glue + command routing without touching the real system config.
use serial_test::serial;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// RAII guard: sets NBR_CONFIG_DIR and NBR_NO_KEYRING on construction; restores
/// both to previous values on drop.
///
/// Tests that use this guard MUST also carry `#[serial(nbr_env)]` so that
/// process-global env-var mutations never race with other tests in the same binary.
struct ConfigDirGuard {
    prev_config_dir: Option<String>,
    prev_no_keyring: Option<String>,
}

impl ConfigDirGuard {
    fn new(dir: &std::path::Path) -> Self {
        let prev_config_dir = std::env::var("NBR_CONFIG_DIR").ok();
        let prev_no_keyring = std::env::var("NBR_NO_KEYRING").ok();
        unsafe {
            std::env::set_var("NBR_CONFIG_DIR", dir.as_os_str());
            std::env::set_var("NBR_NO_KEYRING", "1");
        }
        ConfigDirGuard {
            prev_config_dir,
            prev_no_keyring,
        }
    }
}

impl Drop for ConfigDirGuard {
    fn drop(&mut self) {
        match &self.prev_config_dir {
            Some(v) => unsafe { std::env::set_var("NBR_CONFIG_DIR", v) },
            None => unsafe { std::env::remove_var("NBR_CONFIG_DIR") },
        }
        match &self.prev_no_keyring {
            Some(v) => unsafe { std::env::set_var("NBR_NO_KEYRING", v) },
            None => unsafe { std::env::remove_var("NBR_NO_KEYRING") },
        }
    }
}

fn make_cli(command: Commands) -> Cli {
    Cli {
        account: None,
        user: None,
        json: false,
        api_url: None,
        usage: false,
        command: Some(command),
    }
}

fn make_cli_with_url(command: Commands, api_url: &str) -> Cli {
    Cli {
        account: None,
        user: None,
        json: false,
        api_url: Some(api_url.to_string()),
        usage: false,
        command: Some(command),
    }
}

// ── command_strings — exhaustive coverage ────────────────────────────────────

#[test]
fn command_strings_signup() {
    let (cmd, sub) = command_strings(&Commands::Signup(SignupArgs {
        handle: None,
        name: None,
        account_name: None,
    }));
    assert_eq!(cmd, "signup");
    assert!(sub.is_none());
}

#[test]
fn command_strings_login() {
    let (cmd, sub) = command_strings(&Commands::Login);
    assert_eq!(cmd, "login");
    assert!(sub.is_none());
}

#[test]
fn command_strings_logout() {
    let (cmd, sub) = command_strings(&Commands::Logout);
    assert_eq!(cmd, "logout");
    assert!(sub.is_none());
}

#[test]
fn command_strings_accounts_list() {
    let (cmd, sub) = command_strings(&Commands::Accounts(AccountsCommands::List));
    assert_eq!(cmd, "accounts");
    assert_eq!(sub.as_deref(), Some("list"));
}

#[test]
fn command_strings_accounts_use() {
    let (cmd, sub) = command_strings(&Commands::Accounts(AccountsCommands::Use(AccountUseArgs {
        name: "alice".into(),
    })));
    assert_eq!(cmd, "accounts");
    assert_eq!(sub.as_deref(), Some("use"));
}

#[test]
fn command_strings_accounts_add() {
    let (cmd, sub) = command_strings(&Commands::Accounts(AccountsCommands::Add(AccountAddArgs {
        name: "new".into(),
        account_id: "id".into(),
        secret: "sec".into(),
        api_url: None,
    })));
    assert_eq!(cmd, "accounts");
    assert_eq!(sub.as_deref(), Some("add"));
}

#[test]
fn command_strings_accounts_remove() {
    let (cmd, sub) = command_strings(&Commands::Accounts(AccountsCommands::Remove(
        AccountRemoveArgs { name: "old".into() },
    )));
    assert_eq!(cmd, "accounts");
    assert_eq!(sub.as_deref(), Some("remove"));
}

#[test]
fn command_strings_whoami() {
    let (cmd, sub) = command_strings(&Commands::Whoami);
    assert_eq!(cmd, "whoami");
    assert!(sub.is_none());
}

#[test]
fn command_strings_status() {
    let (cmd, sub) = command_strings(&Commands::Status);
    assert_eq!(cmd, "status");
    assert!(sub.is_none());
}

#[test]
fn command_strings_profile_show() {
    let (cmd, sub) = command_strings(&Commands::Profile(ProfileCommands::Show));
    assert_eq!(cmd, "profile");
    assert_eq!(sub.as_deref(), Some("show"));
}

#[test]
fn command_strings_profile_edit() {
    let (cmd, sub) = command_strings(&Commands::Profile(ProfileCommands::Edit(ProfileEditArgs {
        first_name: None,
        bio: None,
        open_to_multi: None,
        relationship_status: None,
        status_open: None,
        visible: None,
    })));
    assert_eq!(cmd, "profile");
    assert_eq!(sub.as_deref(), Some("edit"));
}

#[test]
fn command_strings_photo_show() {
    let (cmd, sub) = command_strings(&Commands::Photo(PhotoCommands::Show));
    assert_eq!(cmd, "photo");
    assert_eq!(sub.as_deref(), Some("show"));
}

#[test]
fn command_strings_photo_set() {
    let (cmd, sub) = command_strings(&Commands::Photo(PhotoCommands::Set(
        nbr::cli::PhotoSetArgs {
            file: None,
            art: None,
            idx: 0,
        },
    )));
    assert_eq!(cmd, "photo");
    assert_eq!(sub.as_deref(), Some("set"));
}

#[test]
fn command_strings_photo_clear() {
    let (cmd, sub) = command_strings(&Commands::Photo(PhotoCommands::Clear(PhotoClearArgs {
        idx: 0,
    })));
    assert_eq!(cmd, "photo");
    assert_eq!(sub.as_deref(), Some("clear"));
}

#[test]
fn command_strings_deck() {
    let (cmd, sub) = command_strings(&Commands::Deck(DeckArgs { limit: 5 }));
    assert_eq!(cmd, "deck");
    assert!(sub.is_none());
}

#[test]
fn command_strings_swipe() {
    let (cmd, sub) = command_strings(&Commands::Swipe(SwipeArgs {
        account_id: "acc".into(),
        direction: "yes".into(),
    }));
    assert_eq!(cmd, "swipe");
    assert!(sub.is_none());
}

#[test]
fn command_strings_like() {
    let (cmd, sub) = command_strings(&Commands::Like(LikeArgs { id: "acc".into() }));
    assert_eq!(cmd, "like");
    assert!(sub.is_none());
}

#[test]
fn command_strings_pass() {
    let (cmd, sub) = command_strings(&Commands::Pass(PassArgs { id: "acc".into() }));
    assert_eq!(cmd, "pass");
    assert!(sub.is_none());
}

#[test]
fn command_strings_matches() {
    let (cmd, sub) = command_strings(&Commands::Matches);
    assert_eq!(cmd, "matches");
    assert!(sub.is_none());
}

#[test]
fn command_strings_unmatch() {
    let (cmd, sub) = command_strings(&Commands::Unmatch(UnmatchArgs {
        match_id: "m1".into(),
    }));
    assert_eq!(cmd, "unmatch");
    assert!(sub.is_none());
}

#[test]
fn command_strings_likes() {
    let (cmd, sub) = command_strings(&Commands::Likes);
    assert_eq!(cmd, "likes");
    assert!(sub.is_none());
}

#[test]
fn command_strings_align() {
    let (cmd, sub) = command_strings(&Commands::Align(AlignArgs {
        account_id: "acc".into(),
    }));
    assert_eq!(cmd, "align");
    assert!(sub.is_none());
}

#[test]
fn command_strings_relationships() {
    let (cmd, sub) = command_strings(&Commands::Relationships);
    assert_eq!(cmd, "relationships");
    assert!(sub.is_none());
}

#[test]
fn command_strings_breakup() {
    let (cmd, sub) = command_strings(&Commands::Breakup(BreakupArgs {
        relationship_id: "r1".into(),
        reason: None,
    }));
    assert_eq!(cmd, "breakup");
    assert!(sub.is_none());
}

#[test]
fn command_strings_go_public() {
    let (cmd, sub) = command_strings(&Commands::GoPublic(GoPublicArgs {
        relationship_id: "r1".into(),
        off: false,
    }));
    assert_eq!(cmd, "go-public");
    assert!(sub.is_none());
}

#[test]
fn command_strings_social_profile() {
    let (cmd, sub) = command_strings(&Commands::Social(SocialCommands::Profile(
        SocialProfileCommands::Show,
    )));
    assert_eq!(cmd, "social");
    assert_eq!(sub.as_deref(), Some("profile"));
}

#[test]
fn command_strings_social_view() {
    let (cmd, sub) = command_strings(&Commands::Social(SocialCommands::View(SocialViewArgs {
        handle: "alice".into(),
    })));
    assert_eq!(cmd, "social");
    assert_eq!(sub.as_deref(), Some("view"));
}

#[test]
fn command_strings_post() {
    let (cmd, sub) = command_strings(&Commands::Post(PostArgs {
        text: "hi".into(),
        image: None,
        reply_to: None,
    }));
    assert_eq!(cmd, "post");
    assert!(sub.is_none());
}

#[test]
fn command_strings_feed() {
    let (cmd, sub) = command_strings(&Commands::Feed(FeedArgs { limit: 20 }));
    assert_eq!(cmd, "feed");
    assert!(sub.is_none());
}

#[test]
fn command_strings_discover() {
    let (cmd, sub) = command_strings(&Commands::Discover(DiscoverArgs { limit: 20 }));
    assert_eq!(cmd, "discover");
    assert!(sub.is_none());
}

#[test]
fn command_strings_follow() {
    let (cmd, sub) = command_strings(&Commands::Follow(FollowArgs {
        handle: "alice".into(),
    }));
    assert_eq!(cmd, "follow");
    assert!(sub.is_none());
}

#[test]
fn command_strings_unfollow() {
    let (cmd, sub) = command_strings(&Commands::Unfollow(UnfollowArgs {
        handle: "alice".into(),
    }));
    assert_eq!(cmd, "unfollow");
    assert!(sub.is_none());
}

#[test]
fn command_strings_followers() {
    let (cmd, sub) = command_strings(&Commands::Followers);
    assert_eq!(cmd, "followers");
    assert!(sub.is_none());
}

#[test]
fn command_strings_following() {
    let (cmd, sub) = command_strings(&Commands::Following);
    assert_eq!(cmd, "following");
    assert!(sub.is_none());
}

#[test]
fn command_strings_messages() {
    let (cmd, sub) = command_strings(&Commands::Messages);
    assert_eq!(cmd, "messages");
    assert!(sub.is_none());
}

#[test]
fn command_strings_read() {
    let (cmd, sub) = command_strings(&Commands::Read(ReadArgs {
        conversation_id: "conv-1".into(),
    }));
    assert_eq!(cmd, "read");
    assert!(sub.is_none());
}

#[test]
fn command_strings_send() {
    let (cmd, sub) = command_strings(&Commands::Send(SendArgs {
        target: "alice".into(),
        text: "hello".into(),
        image: None,
    }));
    assert_eq!(cmd, "send");
    assert!(sub.is_none());
}

#[test]
fn command_strings_config() {
    let (cmd, sub) = command_strings(&Commands::Config);
    assert_eq!(cmd, "config");
    assert!(sub.is_none());
}

#[test]
fn command_strings_completions() {
    use clap_complete::Shell;
    use nbr::cli::CompletionsArgs;
    let (cmd, sub) = command_strings(&Commands::Completions(CompletionsArgs {
        shell: Shell::Bash,
    }));
    assert_eq!(cmd, "completions");
    assert!(sub.is_none());
}

// ── lib::run — no-command path ────────────────────────────────────────────────

#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_no_command_shows_help() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    let cli = Cli {
        account: None,
        user: None,
        json: false,
        api_url: None,
        usage: false,
        command: None,
    };

    let result = nbr::run(cli).await;
    assert!(
        result.is_ok(),
        "run with no command should succeed: {:?}",
        result
    );
}

// ── lib::run — accounts subcommands (config dir injected) ─────────────────────

#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_accounts_list_via_lib() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    let cli = make_cli(Commands::Accounts(AccountsCommands::List));

    let result = nbr::run(cli).await;
    assert!(result.is_ok(), "accounts list should succeed: {:?}", result);
}

#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_accounts_add_via_lib() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    let cli = make_cli(Commands::Accounts(AccountsCommands::Add(AccountAddArgs {
        name: "via-lib".into(),
        account_id: "acc-via-lib-001".into(),
        secret: "sec-via-lib-001".into(),
        api_url: None,
    })));

    let result = nbr::run(cli).await;
    assert!(result.is_ok(), "accounts add should succeed: {:?}", result);

    let config = nbr::config::load_config().unwrap();
    assert_eq!(config.accounts.len(), 1);
    assert_eq!(config.accounts[0].name, "via-lib");
}

#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_accounts_use_via_lib() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    nbr::config::add_account("alice-lib", "acc-alice-lib", None).unwrap();
    nbr::config::add_account("bob-lib", "acc-bob-lib", None).unwrap();

    let cli = make_cli(Commands::Accounts(AccountsCommands::Use(AccountUseArgs {
        name: "bob-lib".into(),
    })));

    let result = nbr::run(cli).await;
    assert!(result.is_ok(), "accounts use should succeed: {:?}", result);
}

#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_accounts_remove_via_lib() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    nbr::config::add_account("to-remove-lib", "acc-remove-lib", None).unwrap();

    let cli = make_cli(Commands::Accounts(AccountsCommands::Remove(
        AccountRemoveArgs {
            name: "to-remove-lib".into(),
        },
    )));

    let result = nbr::run(cli).await;
    assert!(
        result.is_ok(),
        "accounts remove should succeed: {:?}",
        result
    );
}

// ── lib::run — config command ─────────────────────────────────────────────────

#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_config_via_lib() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    let cli = make_cli(Commands::Config);

    let result = nbr::run(cli).await;
    assert!(result.is_ok(), "config should succeed: {:?}", result);
}

// ── lib::run — signup command ─────────────────────────────────────────────────

#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_signup_via_lib() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/signup"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "account_id": "acc-lib-signup-001",
            "secret": "sec-lib-signup-001"
        })))
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    let cli = make_cli_with_url(
        Commands::Signup(SignupArgs {
            handle: None,
            name: None,
            account_name: Some("lib-signup".into()),
        }),
        &server.uri(),
    );

    let result = nbr::run(cli).await;
    assert!(
        result.is_ok(),
        "signup via lib should succeed: {:?}",
        result
    );
}

// ── lib::run — no-account errors propagate correctly ─────────────────────────

#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_whoami_no_account_returns_error() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    // No accounts configured → should return an error
    let cli = make_cli(Commands::Whoami);

    let result = nbr::run(cli).await;
    assert!(result.is_err(), "whoami with no account should fail");
}

#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_status_no_account_returns_error() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    let cli = make_cli(Commands::Status);

    let result = nbr::run(cli).await;
    assert!(result.is_err(), "status with no account should fail");
}

// ── lib::run — login/logout via lib (needs account + secret) ─────────────────

#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_login_via_lib() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "bearer": "jwt-lib-login",
            "expires_at": "2099-01-01T00:00:00Z"
        })))
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    // Add account + secret file in the temp dir
    nbr::config::add_account("lib-login-acct", "acc-lib-login", Some(&server.uri())).unwrap();
    let secret_path = tmp.path().join("lib-login-acct.secret");
    std::fs::write(&secret_path, "sec-lib-login-test").unwrap();

    let cli = Cli {
        account: Some("lib-login-acct".into()),
        user: None,
        json: false,
        api_url: Some(server.uri()),
        usage: false,
        command: Some(Commands::Login),
    };

    let result = nbr::run(cli).await;
    assert!(result.is_ok(), "login via lib should succeed: {:?}", result);
}

#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_logout_via_lib() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/logout"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    nbr::config::add_account("lib-logout-acct", "acc-lib-logout", Some(&server.uri())).unwrap();
    let bearer_path = tmp.path().join("lib-logout-acct.bearer");
    let expiry_path = tmp.path().join("lib-logout-acct.bearer_expiry");
    std::fs::write(&bearer_path, "jwt-lib-logout-bearer").unwrap();
    std::fs::write(&expiry_path, "2099-01-01T00:00:00Z").unwrap();

    let cli = Cli {
        account: Some("lib-logout-acct".into()),
        user: None,
        json: false,
        api_url: Some(server.uri()),
        usage: false,
        command: Some(Commands::Logout),
    };

    let result = nbr::run(cli).await;
    assert!(
        result.is_ok(),
        "logout via lib should succeed: {:?}",
        result
    );
}

// ── lib::dispatch — representative API commands ───────────────────────────────

/// Verify dispatch routes whoami correctly (200 response).
#[tokio::test]
async fn dispatch_whoami() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "account": { "id": "acc-1", "status": "active", "created_at": "2024-01-01T00:00:00Z" },
            "dating_profile": null,
            "social_profile": null
        })))
        .mount(&server)
        .await;

    let mut client = nbr::client::ApiClient::new(server.uri());
    client.bearer = Some("jwt-test".into());

    let result = nbr::dispatch(&Commands::Whoami, &mut client, false).await;
    assert!(
        result.is_ok(),
        "dispatch whoami should succeed: {:?}",
        result
    );
}

/// Verify dispatch routes status correctly.
#[tokio::test]
async fn dispatch_status() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/status"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "unread_messages": 0,
            "new_likes": 0,
            "new_matches": 0,
            "new_followers": 0,
            "pending_relationships": 0,
            "elevated": []
        })))
        .mount(&server)
        .await;

    let mut client = nbr::client::ApiClient::new(server.uri());
    client.bearer = Some("jwt-test".into());

    let result = nbr::dispatch(&Commands::Status, &mut client, false).await;
    assert!(
        result.is_ok(),
        "dispatch status should succeed: {:?}",
        result
    );
}

/// Verify dispatch routes matches correctly.
#[tokio::test]
async fn dispatch_matches() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/matches"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = nbr::client::ApiClient::new(server.uri());
    client.bearer = Some("jwt-test".into());

    let result = nbr::dispatch(&Commands::Matches, &mut client, false).await;
    assert!(
        result.is_ok(),
        "dispatch matches should succeed: {:?}",
        result
    );
}

/// Verify dispatch routes likes correctly.
#[tokio::test]
async fn dispatch_likes() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/likes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "count": 0,
            "sample": []
        })))
        .mount(&server)
        .await;

    let mut client = nbr::client::ApiClient::new(server.uri());
    client.bearer = Some("jwt-test".into());

    let result = nbr::dispatch(&Commands::Likes, &mut client, false).await;
    assert!(
        result.is_ok(),
        "dispatch likes should succeed: {:?}",
        result
    );
}

/// Verify dispatch routes relationships correctly.
#[tokio::test]
async fn dispatch_relationships() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/relationships"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = nbr::client::ApiClient::new(server.uri());
    client.bearer = Some("jwt-test".into());

    let result = nbr::dispatch(&Commands::Relationships, &mut client, false).await;
    assert!(
        result.is_ok(),
        "dispatch relationships should succeed: {:?}",
        result
    );
}

/// Verify dispatch routes followers correctly.
#[tokio::test]
async fn dispatch_followers() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/followers"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [] })))
        .mount(&server)
        .await;

    let mut client = nbr::client::ApiClient::new(server.uri());
    client.bearer = Some("jwt-test".into());

    let result = nbr::dispatch(&Commands::Followers, &mut client, false).await;
    assert!(
        result.is_ok(),
        "dispatch followers should succeed: {:?}",
        result
    );
}

/// Verify dispatch routes following correctly.
#[tokio::test]
async fn dispatch_following() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/following"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [] })))
        .mount(&server)
        .await;

    let mut client = nbr::client::ApiClient::new(server.uri());
    client.bearer = Some("jwt-test".into());

    let result = nbr::dispatch(&Commands::Following, &mut client, false).await;
    assert!(
        result.is_ok(),
        "dispatch following should succeed: {:?}",
        result
    );
}

/// Verify dispatch routes messages correctly.
#[tokio::test]
async fn dispatch_messages() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/conversations"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = nbr::client::ApiClient::new(server.uri());
    client.bearer = Some("jwt-test".into());

    let result = nbr::dispatch(&Commands::Messages, &mut client, false).await;
    assert!(
        result.is_ok(),
        "dispatch messages should succeed: {:?}",
        result
    );
}

// ── lib::run — full account + bearer dispatch path ────────────────────────────
// These tests exercise the run() path that loads config, resolves account, loads
// bearer, and dispatches to the real command handler.  They cover the lib.rs code
// paths not reached by the direct dispatch() tests above.

/// run() with a valid account + fresh bearer → dispatches whoami.
#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_with_fresh_bearer_dispatches_command() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "account": { "id": "acc-bearer-test", "status": "active", "created_at": "2024-01-01T00:00:00Z" },
            "dating_profile": null,
            "social_profile": null
        })))
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    nbr::config::add_account("bearer-acct", "acc-bearer-test", Some(&server.uri())).unwrap();
    // Write fresh bearer files (expires in 2099)
    std::fs::write(tmp.path().join("bearer-acct.bearer"), "jwt-fresh-bearer").unwrap();
    std::fs::write(
        tmp.path().join("bearer-acct.bearer_expiry"),
        "2099-01-01T00:00:00Z",
    )
    .unwrap();

    let cli = Cli {
        account: Some("bearer-acct".into()),
        user: None,
        json: false,
        api_url: Some(server.uri()),
        usage: false,
        command: Some(Commands::Whoami),
    };

    let result = nbr::run(cli).await;
    assert!(
        result.is_ok(),
        "run with fresh bearer should succeed: {:?}",
        result
    );
}

/// run() with no bearer cached → bearer=None dispatched to whoami.
/// The command returns NotLoggedIn because the API returns 401 and there's no
/// secret to refresh with. This exercises the bearer=None code path in run().
#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_with_no_bearer_no_secret_returns_error() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;

    // GET /auth/me returns 401 → auto-refresh attempted but no secret → NotLoggedIn
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "Unauthorized" })))
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    nbr::config::add_account("no-bearer-acct", "acc-no-bearer", Some(&server.uri())).unwrap();
    // No bearer files, no secret files → bearer=None, refresh fails

    let cli = Cli {
        account: Some("no-bearer-acct".into()),
        user: None,
        json: false,
        api_url: Some(server.uri()),
        usage: false,
        command: Some(Commands::Whoami),
    };

    let result = nbr::run(cli).await;
    // Should fail with NotLoggedIn (no secret to refresh with)
    assert!(
        result.is_err(),
        "run with no bearer and no secret should fail"
    );
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("Not logged in") || msg.contains("login"),
        "unexpected error: {msg}"
    );
}

/// run() with stale bearer (expired > 60s ago) → bearer not loaded; same 401 path.
#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_with_stale_bearer_no_secret_returns_error() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;

    // GET /auth/me returns 401 (stale bearer not sent, so 401 triggered by lack of auth)
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "Unauthorized" })))
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    nbr::config::add_account("stale-bearer-acct", "acc-stale-bearer", Some(&server.uri())).unwrap();
    // Stale bearer (expired 2 hours ago) → bearer_is_fresh() returns false → not loaded
    std::fs::write(tmp.path().join("stale-bearer-acct.bearer"), "jwt-stale").unwrap();
    std::fs::write(
        tmp.path().join("stale-bearer-acct.bearer_expiry"),
        "2020-01-01T00:00:00Z",
    )
    .unwrap();
    // No secret → refresh will fail

    let cli = Cli {
        account: Some("stale-bearer-acct".into()),
        user: None,
        json: false,
        api_url: Some(server.uri()),
        usage: false,
        command: Some(Commands::Whoami),
    };

    let result = nbr::run(cli).await;
    // Should fail because bearer was stale and no secret to refresh with
    assert!(
        result.is_err(),
        "run with stale bearer and no secret should fail"
    );
}

/// run() with NBR_API_URL env var is picked up when no api_url flag or account config.
#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_picks_up_nbr_api_url_env_var() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/status"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "unread_messages": 0,
            "new_likes": 0,
            "new_matches": 0,
            "new_followers": 0,
            "pending_relationships": 0,
            "elevated": []
        })))
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    // Add account with NO api_url set on it
    nbr::config::add_account("env-url-acct", "acc-env-url", None).unwrap();
    std::fs::write(tmp.path().join("env-url-acct.bearer"), "jwt-env-test").unwrap();
    std::fs::write(
        tmp.path().join("env-url-acct.bearer_expiry"),
        "2099-01-01T00:00:00Z",
    )
    .unwrap();

    // Set NBR_API_URL env var; ConfigDirGuard restores on drop
    let prev_api_url = std::env::var("NBR_API_URL").ok();
    unsafe { std::env::set_var("NBR_API_URL", server.uri()) };

    let cli = Cli {
        account: Some("env-url-acct".into()),
        user: None,
        json: false,
        api_url: None, // No --api-url flag
        usage: false,
        command: Some(Commands::Status),
    };

    let result = nbr::run(cli).await;

    // Restore NBR_API_URL
    match prev_api_url {
        Some(v) => unsafe { std::env::set_var("NBR_API_URL", v) },
        None => unsafe { std::env::remove_var("NBR_API_URL") },
    }

    assert!(
        result.is_ok(),
        "run should pick up NBR_API_URL: {:?}",
        result
    );
}

/// run() with --json flag passes json=true through to dispatch.
#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_with_json_flag_passes_json_to_dispatch() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "account": { "id": "acc-json-flag", "status": "active", "created_at": "2024-01-01T00:00:00Z" },
            "dating_profile": null,
            "social_profile": null
        })))
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    nbr::config::add_account("json-flag-acct", "acc-json-flag", Some(&server.uri())).unwrap();
    std::fs::write(tmp.path().join("json-flag-acct.bearer"), "jwt-json-flag").unwrap();
    std::fs::write(
        tmp.path().join("json-flag-acct.bearer_expiry"),
        "2099-01-01T00:00:00Z",
    )
    .unwrap();

    let cli = Cli {
        account: Some("json-flag-acct".into()),
        user: None,
        json: true, // --json flag
        api_url: Some(server.uri()),
        usage: false,
        command: Some(Commands::Whoami),
    };

    let result = nbr::run(cli).await;
    assert!(
        result.is_ok(),
        "run with --json should succeed: {:?}",
        result
    );
}

/// run() with --user flag (account_id lookup) resolves the account correctly.
#[tokio::test]
#[serial(nbr_config_dir)]
async fn run_with_user_flag_resolves_by_account_id() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/status"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "unread_messages": 1,
            "new_likes": 0,
            "new_matches": 0,
            "new_followers": 0,
            "pending_relationships": 0,
            "elevated": []
        })))
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    nbr::config::add_account("user-flag-acct", "acc-user-flag-id", Some(&server.uri())).unwrap();
    std::fs::write(tmp.path().join("user-flag-acct.bearer"), "jwt-user-flag").unwrap();
    std::fs::write(
        tmp.path().join("user-flag-acct.bearer_expiry"),
        "2099-01-01T00:00:00Z",
    )
    .unwrap();

    let cli = Cli {
        account: None,
        user: Some("acc-user-flag-id".into()), // --user (account_id)
        json: false,
        api_url: Some(server.uri()),
        usage: false,
        command: Some(Commands::Status),
    };

    let result = nbr::run(cli).await;
    assert!(
        result.is_ok(),
        "run with --user flag should succeed: {:?}",
        result
    );
}
