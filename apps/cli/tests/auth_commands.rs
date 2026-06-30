/// Tests for commands/auth.rs: accounts, config, signup, login, logout.
///
/// All tests that write to disk use NBR_CONFIG_DIR pointing at a TempDir so
/// they never touch the user's real ~/Library config directory.
///
/// # Test isolation strategy
///
/// Each test that needs the config dir:
/// 1. Creates a unique `TempDir`.
/// 2. Sets `NBR_CONFIG_DIR` to that dir before calling any config function.
/// 3. Clears the env var via `ConfigDirGuard` (RAII) after the test.
/// 4. Uses `#[serial(nbr_config_dir)]` from `serial_test` to serialise
///    within-binary execution, preventing races on the process-global
///    NBR_CONFIG_DIR env var.
use nbr::client::ApiClient;
use nbr::commands;
use serde_json::json;
use serial_test::serial;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn auth_client(base_url: &str) -> ApiClient {
    let mut client = ApiClient::new(base_url);
    client.bearer = Some("jwt-token-xyz".into());
    client.account_name = Some("alice".into());
    client
}

/// RAII guard: sets NBR_CONFIG_DIR and NBR_NO_KEYRING on construction; restores
/// both to their previous values on drop.
///
/// NBR_NO_KEYRING=1 prevents macOS login-Keychain password prompts during tests
/// that exercise secret storage (login, logout, accounts add, etc.).
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

// ── run_config ────────────────────────────────────────────────────────────────

#[test]
#[serial(nbr_config_dir)]
fn test_run_config_human() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    let result = commands::auth::run_config(None, false);
    assert!(result.is_ok(), "run_config should succeed: {:?}", result);
}

#[test]
#[serial(nbr_config_dir)]
fn test_run_config_json() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    let result = commands::auth::run_config(None, true);
    assert!(
        result.is_ok(),
        "run_config json should succeed: {:?}",
        result
    );
}

// ── run_accounts_list ─────────────────────────────────────────────────────────

#[test]
#[serial(nbr_config_dir)]
fn test_run_accounts_list_human() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    let result = commands::auth::run_accounts_list(false);
    assert!(
        result.is_ok(),
        "run_accounts_list should succeed: {:?}",
        result
    );
}

#[test]
#[serial(nbr_config_dir)]
fn test_run_accounts_list_json() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    let result = commands::auth::run_accounts_list(true);
    assert!(
        result.is_ok(),
        "run_accounts_list json should succeed: {:?}",
        result
    );
}

/// run_accounts_list with at least one account shows it.
#[test]
#[serial(nbr_config_dir)]
fn test_run_accounts_list_with_account() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    nbr::config::add_account("listed-account", "acc-listed-001", None).unwrap();
    let result = commands::auth::run_accounts_list(false);
    assert!(
        result.is_ok(),
        "run_accounts_list with account should succeed: {:?}",
        result
    );
}

/// run_accounts_list JSON with accounts.
#[test]
#[serial(nbr_config_dir)]
fn test_run_accounts_list_json_with_accounts() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    nbr::config::add_account("acct-json", "acc-json-002", None).unwrap();
    let result = commands::auth::run_accounts_list(true);
    assert!(
        result.is_ok(),
        "run_accounts_list json with account should succeed: {:?}",
        result
    );
}

// ── run_accounts_use ──────────────────────────────────────────────────────────

#[test]
#[serial(nbr_config_dir)]
fn test_run_accounts_use_sets_default() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    nbr::config::add_account("alice", "acc-alice", None).unwrap();
    nbr::config::add_account("bob", "acc-bob", None).unwrap();

    let args = nbr::cli::AccountUseArgs { name: "bob".into() };
    let result = commands::auth::run_accounts_use(&args);
    assert!(
        result.is_ok(),
        "run_accounts_use should succeed: {:?}",
        result
    );

    let config = nbr::config::load_config().unwrap();
    assert_eq!(config.default_account.as_deref(), Some("bob"));
}

#[test]
#[serial(nbr_config_dir)]
fn test_run_accounts_use_nonexistent_fails() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    let args = nbr::cli::AccountUseArgs {
        name: "nobody".into(),
    };
    let result = commands::auth::run_accounts_use(&args);
    assert!(
        result.is_err(),
        "run_accounts_use should fail for unknown account"
    );
}

// ── run_accounts_add ──────────────────────────────────────────────────────────

#[test]
#[serial(nbr_config_dir)]
fn test_run_accounts_add_writes_config() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    let args = nbr::cli::AccountAddArgs {
        name: "added-acct".into(),
        account_id: "acc-added-001".into(),
        secret: "sec-added-001".into(),
        api_url: None,
    };
    let result = commands::auth::run_accounts_add(&args);
    assert!(
        result.is_ok(),
        "run_accounts_add should succeed: {:?}",
        result
    );

    let config = nbr::config::load_config().unwrap();
    assert_eq!(config.accounts.len(), 1);
    assert_eq!(config.accounts[0].name, "added-acct");
}

#[test]
#[serial(nbr_config_dir)]
fn test_run_accounts_add_with_api_url() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    let args = nbr::cli::AccountAddArgs {
        name: "work-acct".into(),
        account_id: "acc-work-001".into(),
        secret: "sec-work-001".into(),
        api_url: Some("https://work-api.example.com".into()),
    };
    let result = commands::auth::run_accounts_add(&args);
    assert!(
        result.is_ok(),
        "run_accounts_add with api_url should succeed: {:?}",
        result
    );

    let config = nbr::config::load_config().unwrap();
    assert_eq!(
        config.accounts[0].api_url.as_deref(),
        Some("https://work-api.example.com")
    );
}

// ── run_accounts_remove ───────────────────────────────────────────────────────

#[test]
#[serial(nbr_config_dir)]
fn test_run_accounts_remove_removes_account() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    nbr::config::add_account("removable", "acc-removable", None).unwrap();

    let args = nbr::cli::AccountRemoveArgs {
        name: "removable".into(),
    };
    let result = commands::auth::run_accounts_remove(&args);
    assert!(
        result.is_ok(),
        "run_accounts_remove should succeed: {:?}",
        result
    );

    let config = nbr::config::load_config().unwrap();
    assert!(config.accounts.is_empty());
}

#[test]
#[serial(nbr_config_dir)]
fn test_run_accounts_remove_nonexistent_fails() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = ConfigDirGuard::new(tmp.path());
    let args = nbr::cli::AccountRemoveArgs {
        name: "ghost".into(),
    };
    let result = commands::auth::run_accounts_remove(&args);
    assert!(result.is_err(), "removing nonexistent account should fail");
}

// ── run_signup ────────────────────────────────────────────────────────────────

#[tokio::test]
#[serial(nbr_config_dir)]
async fn test_run_signup_happy_path_human() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/signup"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "account_id": "acc-new-signup-001",
            "secret": "sec-new-signup-001"
        })))
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    let args = nbr::cli::SignupArgs {
        name: None,
        account_name: Some("newsignup".into()),
    };

    let result = commands::auth::run_signup(&args, &server.uri(), false).await;
    assert!(result.is_ok(), "signup should succeed: {:?}", result);

    let config = nbr::config::load_config().unwrap();
    assert_eq!(config.accounts.len(), 1);
    assert_eq!(config.accounts[0].name, "newsignup");
    assert_eq!(config.accounts[0].account_id, "acc-new-signup-001");
    assert_eq!(
        config.accounts[0].api_url.as_deref(),
        Some(server.uri().as_str())
    );
}

#[tokio::test]
#[serial(nbr_config_dir)]
async fn test_run_signup_happy_path_json() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/signup"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "account_id": "acc-signup-json-001",
            "secret": "sec-signup-json-001"
        })))
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    let args = nbr::cli::SignupArgs {
        name: None,
        account_name: None, // should default to "default"
    };

    let result = commands::auth::run_signup(&args, &server.uri(), true).await;
    assert!(result.is_ok(), "signup json should succeed: {:?}", result);

    let config = nbr::config::load_config().unwrap();
    assert_eq!(config.accounts[0].name, "default");
    assert_eq!(
        config.accounts[0].api_url.as_deref(),
        Some(server.uri().as_str())
    );
}

#[tokio::test]
#[serial(nbr_config_dir)]
async fn test_run_signup_api_error_does_not_write_config() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/signup"))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({ "error": "Server down" })))
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    let args = nbr::cli::SignupArgs {
        name: None,
        account_name: Some("signup-err-test".into()),
    };

    let result = commands::auth::run_signup(&args, &server.uri(), false).await;
    assert!(result.is_err(), "signup should fail when API errors");
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("Server down") || msg.contains("500") || msg.contains("API error"),
        "unexpected error: {msg}"
    );

    // Config should not have been written
    let config = nbr::config::load_config().unwrap();
    assert!(
        config.accounts.is_empty(),
        "config should be empty after failed signup"
    );
}

// ── run_login ─────────────────────────────────────────────────────────────────

#[tokio::test]
#[serial(nbr_config_dir)]
async fn test_run_login_no_secret_fails() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;

    let _guard = ConfigDirGuard::new(tmp.path());
    // No secret stored in temp dir
    let resolved = nbr::resolver::ResolvedAccount {
        name: "no-secret-acct".into(),
        account_id: "acc-nosecret".into(),
        api_url: Some(server.uri()),
    };

    let result = commands::auth::run_login(&resolved, false).await;
    assert!(result.is_err(), "login without secret should fail");
}

#[tokio::test]
#[serial(nbr_config_dir)]
async fn test_run_login_with_file_secret_human() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "bearer": "jwt-fresh-bearer",
            "expires_at": "2099-01-01T00:00:00Z"
        })))
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    // Write secret file to the temp dir
    let secret_path = tmp.path().join("login-test.secret");
    std::fs::write(&secret_path, "sec_login_test").unwrap();

    let resolved = nbr::resolver::ResolvedAccount {
        name: "login-test".into(),
        account_id: "acc-login-test".into(),
        api_url: Some(server.uri()),
    };

    let result = commands::auth::run_login(&resolved, false).await;
    assert!(
        result.is_ok(),
        "login with file secret should succeed: {:?}",
        result
    );
}

#[tokio::test]
#[serial(nbr_config_dir)]
async fn test_run_login_with_file_secret_json() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "bearer": "jwt-fresh-bearer",
            "expires_at": "2099-01-01T00:00:00Z"
        })))
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    let secret_path = tmp.path().join("login-test-json.secret");
    std::fs::write(&secret_path, "sec_login_test_json").unwrap();

    let resolved = nbr::resolver::ResolvedAccount {
        name: "login-test-json".into(),
        account_id: "acc-login-test-2".into(),
        api_url: Some(server.uri()),
    };

    let result = commands::auth::run_login(&resolved, true).await;
    assert!(
        result.is_ok(),
        "login with file secret json should succeed: {:?}",
        result
    );
}

#[tokio::test]
#[serial(nbr_config_dir)]
async fn test_run_login_api_error() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(json!({ "error": "Invalid secret" })),
        )
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    let secret_path = tmp.path().join("login-err.secret");
    std::fs::write(&secret_path, "bad_secret").unwrap();

    let resolved = nbr::resolver::ResolvedAccount {
        name: "login-err".into(),
        account_id: "acc-login-err".into(),
        api_url: Some(server.uri()),
    };

    let result = commands::auth::run_login(&resolved, false).await;
    assert!(result.is_err(), "login with bad secret should fail");
}

// ── run_logout ────────────────────────────────────────────────────────────────

#[tokio::test]
#[serial(nbr_config_dir)]
async fn test_run_logout_human_no_bearer() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;

    let _guard = ConfigDirGuard::new(tmp.path());
    // No bearer files in temp dir
    let resolved = nbr::resolver::ResolvedAccount {
        name: "logout-nobear".into(),
        account_id: "acc-logout-test".into(),
        api_url: Some(server.uri()),
    };

    let result = commands::auth::run_logout(&resolved, false).await;
    assert!(
        result.is_ok(),
        "logout no bearer should succeed: {:?}",
        result
    );
}

#[tokio::test]
#[serial(nbr_config_dir)]
async fn test_run_logout_human_with_bearer() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/logout"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let _guard = ConfigDirGuard::new(tmp.path());
    // Write bearer files to the temp dir
    let bearer_path = tmp.path().join("logout-bear.bearer");
    let expiry_path = tmp.path().join("logout-bear.bearer_expiry");
    std::fs::write(&bearer_path, "jwt-cached-bearer").unwrap();
    std::fs::write(&expiry_path, "2099-01-01T00:00:00Z").unwrap();

    let resolved = nbr::resolver::ResolvedAccount {
        name: "logout-bear".into(),
        account_id: "acc-logout-test".into(),
        api_url: Some(server.uri()),
    };

    let result = commands::auth::run_logout(&resolved, false).await;
    assert!(
        result.is_ok(),
        "logout with bearer should succeed: {:?}",
        result
    );
}

#[tokio::test]
#[serial(nbr_config_dir)]
async fn test_run_logout_json() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;

    let _guard = ConfigDirGuard::new(tmp.path());
    let resolved = nbr::resolver::ResolvedAccount {
        name: "logout-json".into(),
        account_id: "acc-logout-json".into(),
        api_url: Some(server.uri()),
    };

    let result = commands::auth::run_logout(&resolved, true).await;
    assert!(result.is_ok(), "logout json should succeed: {:?}", result);
}

// ── run_whoami error paths ────────────────────────────────────────────────────

#[tokio::test]
async fn test_run_whoami_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(
            ResponseTemplate::new(500).set_body_json(json!({ "error": "Internal error" })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    // Remove account_name so 401 auto-refresh would fail with NotLoggedIn
    client.account_name = None;
    let result = commands::auth::run_whoami(&mut client, false).await;
    assert!(result.is_err(), "whoami should fail on API error");
}

#[tokio::test]
async fn test_run_status_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/status"))
        .respond_with(
            ResponseTemplate::new(503).set_body_json(json!({ "error": "Service unavailable" })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let result = commands::auth::run_status(&mut client, false).await;
    assert!(result.is_err(), "status should fail on API error");
}

// ── Identity beat: signup + login onboarding copy ───────────────────────────────

/// Both `run_signup` and `run_login` emit `IDENTITY_BEAT` in their human output.
/// The beat must frame BOTH "decide who you are" AND setting the single public
/// anchor — matching the hooks' canonical fifth onboarding step.
#[test]
fn identity_beat_references_public_anchor() {
    let beat = commands::auth::IDENTITY_BEAT;
    // Canonical public-anchor phrase, verbatim in sync with the plugin hooks.
    assert!(
        beat.contains("decide who you are and set your one public anchor"),
        "IDENTITY_BEAT must carry the canonical public-anchor phrase: {beat}"
    );
    // Identity authoring command.
    assert!(
        beat.contains("nbr memories add --scope identity"),
        "IDENTITY_BEAT must reference identity authoring: {beat}"
    );
    // Public anchor command.
    assert!(
        beat.contains("nbr profile edit --looking-for"),
        "IDENTITY_BEAT must reference the public anchor command: {beat}"
    );
}
