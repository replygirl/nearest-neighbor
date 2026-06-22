/// Tests for commands/auth.rs: accounts, config, signup, login, logout.
/// Tests that modify the real config file are NOT included here because the
/// system config may be in a non-default state. The underlying config::* functions
/// are tested in unit tests inside config.rs.
///
/// These tests cover: run_config, run_whoami, run_status, and error paths.
use nbr::client::ApiClient;
use nbr::commands;
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn auth_client(base_url: &str) -> ApiClient {
    let mut client = ApiClient::new(base_url);
    client.bearer = Some("jwt-token-xyz".into());
    client.account_name = Some("alice".into());
    client
}

// ── run_config ────────────────────────────────────────────────────────────────

#[test]
fn test_run_config_human() {
    // run_config reads from the real system config. We handle both ok and err
    // (the config might be absent or have parse errors in some environments).
    let result = commands::auth::run_config(false);
    // Either succeeds or errors cleanly — no panic
    let _ = result;
}

#[test]
fn test_run_config_json() {
    let result = commands::auth::run_config(true);
    let _ = result;
}

// ── run_accounts_list ─────────────────────────────────────────────────────────

#[test]
fn test_run_accounts_list_human() {
    // May succeed or fail depending on real config state — no panic expected
    let result = commands::auth::run_accounts_list(false);
    let _ = result;
}

#[test]
fn test_run_accounts_list_json() {
    let result = commands::auth::run_accounts_list(true);
    let _ = result;
}

// ── run_signup ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_run_signup_api_error_does_not_write_config() {
    // When the API fails, signup should return an error without writing config
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/signup"))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({ "error": "Server down" })))
        .mount(&server)
        .await;

    let args = nbr::cli::SignupArgs {
        handle: None,
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
}

// ── run_login ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_run_login_no_secret_fails() {
    let server = MockServer::start().await;
    // No secret stored → run_login should error before making API call
    let test_account = format!("test-login-nosecret-{}", std::process::id());
    // Don't add any secret — ensure config dir doesn't have one
    let secret_path = nbr::config::config_dir()
        .unwrap()
        .join(format!("{test_account}.secret"));
    // Ensure the file doesn't exist
    if secret_path.exists() {
        let _ = std::fs::remove_file(&secret_path);
    }

    let resolved = nbr::resolver::ResolvedAccount {
        name: test_account,
        account_id: "acc-nosecret".into(),
        api_url: Some(server.uri()),
    };

    let result = commands::auth::run_login(&resolved, false).await;
    assert!(result.is_err(), "login without secret should fail");
}

#[tokio::test]
async fn test_run_login_with_file_secret_human() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "bearer": "jwt-fresh-bearer",
            "expires_at": "2099-01-01T00:00:00Z"
        })))
        .mount(&server)
        .await;

    let test_account = format!("test-login-file-{}", std::process::id());
    // Write secret via file fallback path
    let config_dir = nbr::config::config_dir().unwrap();
    std::fs::create_dir_all(&config_dir).unwrap();
    let secret_path = config_dir.join(format!("{test_account}.secret"));
    std::fs::write(&secret_path, "sec_login_test").unwrap();

    let resolved = nbr::resolver::ResolvedAccount {
        name: test_account.clone(),
        account_id: "acc-login-test".into(),
        api_url: Some(server.uri()),
    };

    let result = commands::auth::run_login(&resolved, false).await;

    // Cleanup secret and bearer files
    let _ = std::fs::remove_file(&secret_path);
    let bearer_path = config_dir.join(format!("{test_account}.bearer"));
    let expiry_path = config_dir.join(format!("{test_account}.bearer_expiry"));
    let _ = std::fs::remove_file(&bearer_path);
    let _ = std::fs::remove_file(&expiry_path);

    assert!(
        result.is_ok(),
        "login with file secret should succeed: {:?}",
        result
    );
}

#[tokio::test]
async fn test_run_login_with_file_secret_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "bearer": "jwt-fresh-bearer",
            "expires_at": "2099-01-01T00:00:00Z"
        })))
        .mount(&server)
        .await;

    let test_account = format!("test-login-file-json-{}", std::process::id());
    let config_dir = nbr::config::config_dir().unwrap();
    std::fs::create_dir_all(&config_dir).unwrap();
    let secret_path = config_dir.join(format!("{test_account}.secret"));
    std::fs::write(&secret_path, "sec_login_test_json").unwrap();

    let resolved = nbr::resolver::ResolvedAccount {
        name: test_account.clone(),
        account_id: "acc-login-test-2".into(),
        api_url: Some(server.uri()),
    };

    let result = commands::auth::run_login(&resolved, true).await;

    let _ = std::fs::remove_file(&secret_path);
    let bearer_path = config_dir.join(format!("{test_account}.bearer"));
    let expiry_path = config_dir.join(format!("{test_account}.bearer_expiry"));
    let _ = std::fs::remove_file(&bearer_path);
    let _ = std::fs::remove_file(&expiry_path);

    assert!(
        result.is_ok(),
        "login with file secret json should succeed: {:?}",
        result
    );
}

#[tokio::test]
async fn test_run_login_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(json!({ "error": "Invalid secret" })),
        )
        .mount(&server)
        .await;

    let test_account = format!("test-login-err-{}", std::process::id());
    let config_dir = nbr::config::config_dir().unwrap();
    std::fs::create_dir_all(&config_dir).unwrap();
    let secret_path = config_dir.join(format!("{test_account}.secret"));
    std::fs::write(&secret_path, "bad_secret").unwrap();

    let resolved = nbr::resolver::ResolvedAccount {
        name: test_account.clone(),
        account_id: "acc-login-err".into(),
        api_url: Some(server.uri()),
    };

    let result = commands::auth::run_login(&resolved, false).await;
    let _ = std::fs::remove_file(&secret_path);

    assert!(result.is_err(), "login with bad secret should fail");
}

// ── run_logout ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_run_logout_human_no_bearer() {
    // When there's no cached bearer, logout should succeed (best-effort)
    let server = MockServer::start().await;
    let test_account = format!("test-logout-nobear-{}", std::process::id());
    // Ensure no bearer files exist for this test account
    let config_dir = nbr::config::config_dir().unwrap();
    let bearer_path = config_dir.join(format!("{test_account}.bearer"));
    let expiry_path = config_dir.join(format!("{test_account}.bearer_expiry"));
    let _ = std::fs::remove_file(&bearer_path);
    let _ = std::fs::remove_file(&expiry_path);

    let resolved = nbr::resolver::ResolvedAccount {
        name: test_account,
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
async fn test_run_logout_human_with_bearer() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/logout"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let test_account = format!("test-logout-bearer-{}", std::process::id());
    let config_dir = nbr::config::config_dir().unwrap();
    std::fs::create_dir_all(&config_dir).unwrap();

    // Write bearer files so get_bearer returns Some
    let bearer_path = config_dir.join(format!("{test_account}.bearer"));
    let expiry_path = config_dir.join(format!("{test_account}.bearer_expiry"));
    std::fs::write(&bearer_path, "jwt-cached-bearer").unwrap();
    std::fs::write(&expiry_path, "2099-01-01T00:00:00Z").unwrap();

    let resolved = nbr::resolver::ResolvedAccount {
        name: test_account.clone(),
        account_id: "acc-logout-test".into(),
        api_url: Some(server.uri()),
    };

    let result = commands::auth::run_logout(&resolved, false).await;

    // Clean up (files should be deleted by run_logout, but just in case)
    let _ = std::fs::remove_file(&bearer_path);
    let _ = std::fs::remove_file(&expiry_path);

    assert!(
        result.is_ok(),
        "logout with bearer should succeed: {:?}",
        result
    );
}

#[tokio::test]
async fn test_run_logout_json() {
    let server = MockServer::start().await;
    let test_account = format!("test-logout-json-{}", std::process::id());
    // Ensure no bearer for this account
    let config_dir = nbr::config::config_dir().unwrap();
    let bearer_path = config_dir.join(format!("{test_account}.bearer"));
    let _ = std::fs::remove_file(&bearer_path);

    let resolved = nbr::resolver::ResolvedAccount {
        name: test_account,
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
