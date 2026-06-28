/// G2 integration tests — commands/auth.rs (auth flows; lowest function coverage).
///
/// Covers:
/// - `effective_api_url` precedence (via run_login/run_logout with varying api_url)
/// - `run_tokens_list` / `run_tokens_create` / `run_tokens_revoke` (all missing)
/// - `run_whoami` with only one profile present (hit each `else` branch independently)
/// - `run_status` with exactly two elevated notifications (the plural "s" branch)
/// - `run_config` with default_account set and telemetry = Some(false)
/// - `run_notifications_list` and `run_notifications_read` (all missing)
/// - `run_accounts` async dispatcher (all four arms)
///
/// Isolation: every test that touches process-global env vars holds an
/// `EnvGuard` and carries `#[serial(nbr_env)]`.
mod common;

use nbr::cli::{
    AccountAddArgs, AccountRemoveArgs, AccountUseArgs, AccountsCommands, NotificationsListArgs,
    NotificationsReadArgs, TokenCreateArgs, TokenRevokeArgs,
};
use nbr::client::ApiClient;
use nbr::commands;
use serde_json::json;
use serial_test::serial;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

// ── Local helpers ─────────────────────────────────────────────────────────────

fn auth_client(base_url: &str) -> ApiClient {
    let mut client = ApiClient::new(base_url);
    client.bearer = Some("jwt-token-xyz".into());
    client.account_name = Some("alice".into());
    client
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

fn token_entry() -> serde_json::Value {
    json!({
        "id": "tok-uuid-001",
        "prefix": "nbr_tok",
        "label": "my-token",
        "last_used_at": null,
        "created_at": "2024-01-01T00:00:00Z",
        "revoked_at": null
    })
}

fn created_token() -> serde_json::Value {
    json!({
        "id": "tok-new-001",
        "prefix": "nbr_new",
        "label": "fresh-token",
        "secret": "sec_fresh_token_value",
        "created_at": "2024-01-01T00:00:00Z"
    })
}

fn notification_read() -> serde_json::Value {
    json!({
        "id": "notif-read-1",
        "type": "match",
        "payload": {},
        "priority": "normal",
        "read_at": "2024-01-02T00:00:00Z",
        "created_at": "2024-01-01T00:00:00Z"
    })
}

fn notification_unread() -> serde_json::Value {
    json!({
        "id": "notif-unread-1",
        "type": "like",
        "payload": {},
        "priority": "normal",
        "read_at": null,
        "created_at": "2024-01-01T00:00:00Z"
    })
}

fn notifications_response_empty() -> serde_json::Value {
    json!({ "items": [], "next_cursor": null })
}

fn notifications_response_mixed() -> serde_json::Value {
    json!({
        "items": [notification_unread(), notification_read()],
        "next_cursor": null
    })
}

fn me_with_dating_only() -> serde_json::Value {
    json!({
        "account": { "id": "acc-test-123", "status": "active", "created_at": "2024-01-01T00:00:00Z" },
        "dating_profile": {
            "first_name": "Alice",
            "bio": "Just vibing",
            "open_to_multi": false,
            "relationship_status": "single",
            "status_is_open": true,
            "is_visible": true
        },
        "social_profile": null
    })
}

fn me_with_social_only() -> serde_json::Value {
    json!({
        "account": { "id": "acc-test-123", "status": "active", "created_at": "2024-01-01T00:00:00Z" },
        "dating_profile": null,
        "social_profile": {
            "handle": "alice",
            "display_name": null,
            "bio": "Hello world",
            "open_dms": true
        }
    })
}

fn status_response_two_elevated() -> serde_json::Value {
    json!({
        "unread_messages": 1,
        "new_likes": 2,
        "new_matches": 0,
        "new_followers": 0,
        "pending_relationships": 0,
        "elevated": [
            {
                "id": "notif-e1",
                "type": "match",
                "payload": {},
                "priority": "high",
                "read_at": null,
                "created_at": "2024-01-01T00:00:00Z"
            },
            {
                "id": "notif-e2",
                "type": "like",
                "payload": {},
                "priority": "high",
                "read_at": null,
                "created_at": "2024-01-01T00:00:00Z"
            }
        ]
    })
}

// ══════════════════════════════════════════════════════════════════════════════
// effective_api_url — via run_login (uses effective_api_url internally)
// ══════════════════════════════════════════════════════════════════════════════

/// `effective_api_url` second branch: `resolved.api_url = None`, `NBR_API_URL` set.
/// Call run_login with `api_url: None` and `NBR_API_URL` pointing at the mock.
#[tokio::test]
#[serial(nbr_env)]
async fn test_effective_api_url_via_env_var() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "bearer": "jwt-env-bearer",
            "expires_at": "2099-01-01T00:00:00Z"
        })))
        .mount(&server)
        .await;

    let _guard = common::EnvGuard::config(tmp.path());
    _guard.set("NBR_API_URL", &server.uri());

    let secret_path = tmp.path().join("env-acct.secret");
    std::fs::write(&secret_path, "env-secret-value").unwrap();

    // resolved.api_url = None → effective_api_url falls back to NBR_API_URL
    let resolved = nbr::resolver::ResolvedAccount {
        name: "env-acct".into(),
        account_id: "acc-env".into(),
        api_url: None,
    };

    let result = commands::auth::run_login(&resolved, false).await;
    assert!(
        result.is_ok(),
        "login via NBR_API_URL env var should succeed: {result:?}"
    );
}

/// `effective_api_url` third branch: both `resolved.api_url` and `NBR_API_URL` absent
/// — falls back to DEFAULT_API_URL. Run logout (best-effort, no bearer) to exercise
/// the path without needing a live server.
#[tokio::test]
#[serial(nbr_env)]
async fn test_effective_api_url_falls_back_to_default() {
    let tmp = tempfile::TempDir::new().unwrap();

    let _guard = common::EnvGuard::config(tmp.path());
    _guard.remove("NBR_API_URL");

    // resolved.api_url = None, NBR_API_URL unset → defaults to DEFAULT_API_URL
    // run_logout with no bearer is best-effort and won't actually call the API
    let resolved = nbr::resolver::ResolvedAccount {
        name: "default-url-acct".into(),
        account_id: "acc-def".into(),
        api_url: None,
    };

    // This will succeed because logout without a cached bearer is a no-op (best-effort)
    let result = commands::auth::run_logout(&resolved, false).await;
    assert!(
        result.is_ok(),
        "logout (no bearer) with DEFAULT_API_URL should succeed: {result:?}"
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// run_tokens_list
// ══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_run_tokens_list_empty() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let result = commands::auth::run_tokens_list(&mut client, false).await;
    assert!(
        result.is_ok(),
        "tokens list empty should succeed: {result:?}"
    );
}

#[tokio::test]
async fn test_run_tokens_list_populated() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([token_entry()])))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let result = commands::auth::run_tokens_list(&mut client, false).await;
    assert!(
        result.is_ok(),
        "tokens list populated should succeed: {result:?}"
    );
}

#[tokio::test]
async fn test_run_tokens_list_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([token_entry()])))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let result = commands::auth::run_tokens_list(&mut client, true).await;
    assert!(
        result.is_ok(),
        "tokens list json should succeed: {result:?}"
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// run_tokens_create
// ══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_run_tokens_create_human() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(200).set_body_json(created_token()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = TokenCreateArgs {
        label: Some("fresh-token".into()),
    };
    let result = commands::auth::run_tokens_create(&mut client, &args, false).await;
    assert!(
        result.is_ok(),
        "tokens create human should succeed: {result:?}"
    );
}

#[tokio::test]
async fn test_run_tokens_create_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(200).set_body_json(created_token()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = TokenCreateArgs { label: None };
    let result = commands::auth::run_tokens_create(&mut client, &args, true).await;
    assert!(
        result.is_ok(),
        "tokens create json should succeed: {result:?}"
    );
}

#[tokio::test]
async fn test_run_tokens_create_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(403).set_body_json(json!({ "error": "Forbidden" })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    // Detach account_name so 401-refresh loop won't fire
    client.account_name = None;
    let args = TokenCreateArgs {
        label: Some("blocked".into()),
    };
    let result = commands::auth::run_tokens_create(&mut client, &args, false).await;
    assert!(result.is_err(), "tokens create should fail on API error");
}

// ══════════════════════════════════════════════════════════════════════════════
// run_tokens_revoke
// ══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_run_tokens_revoke_human() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/auth/tokens/tok-uuid-001"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = TokenRevokeArgs {
        id: "tok-uuid-001".into(),
    };
    let result = commands::auth::run_tokens_revoke(&mut client, &args, false).await;
    assert!(
        result.is_ok(),
        "tokens revoke human should succeed: {result:?}"
    );
}

#[tokio::test]
async fn test_run_tokens_revoke_json() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/auth/tokens/tok-uuid-002"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = TokenRevokeArgs {
        id: "tok-uuid-002".into(),
    };
    let result = commands::auth::run_tokens_revoke(&mut client, &args, true).await;
    assert!(
        result.is_ok(),
        "tokens revoke json should succeed: {result:?}"
    );
}

#[tokio::test]
async fn test_run_tokens_revoke_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/auth/tokens/tok-bad"))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "error": "Token not found" })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    client.account_name = None;
    let args = TokenRevokeArgs {
        id: "tok-bad".into(),
    };
    let result = commands::auth::run_tokens_revoke(&mut client, &args, false).await;
    assert!(result.is_err(), "tokens revoke should fail on 404");
}

// ══════════════════════════════════════════════════════════════════════════════
// run_whoami — individual `else` branches
// ══════════════════════════════════════════════════════════════════════════════

/// Only dating_profile present; social_profile is None → hits `else { println!("social_profile: none") }`
#[tokio::test]
async fn test_run_whoami_dating_only() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(me_with_dating_only()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let result = commands::auth::run_whoami(&mut client, false).await;
    assert!(
        result.is_ok(),
        "whoami with dating only should succeed: {result:?}"
    );
}

/// Only social_profile present; dating_profile is None → hits `else { println!("dating_profile: none") }`
#[tokio::test]
async fn test_run_whoami_social_only() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(me_with_social_only()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let result = commands::auth::run_whoami(&mut client, false).await;
    assert!(
        result.is_ok(),
        "whoami with social only should succeed: {result:?}"
    );
}

/// social_profile has `display_name: null` → the `unwrap_or("(none)")` arm
#[tokio::test]
async fn test_run_whoami_social_no_display_name() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(me_with_social_only()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let result = commands::auth::run_whoami(&mut client, false).await;
    assert!(
        result.is_ok(),
        "whoami with null display_name should succeed: {result:?}"
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// run_status — plural elevated branch
// ══════════════════════════════════════════════════════════════════════════════

/// Two elevated notifications → prints "2 elevated notifications:" (plural "s")
#[tokio::test]
async fn test_run_status_plural_elevated() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/status"))
        .respond_with(ResponseTemplate::new(200).set_body_json(status_response_two_elevated()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let result = commands::auth::run_status(&mut client, false).await;
    assert!(
        result.is_ok(),
        "status with two elevated should succeed: {result:?}"
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// run_config — additional branches
// ══════════════════════════════════════════════════════════════════════════════

/// `default_account` is set — covers the `unwrap_or("(none)")` Some arm.
#[test]
#[serial(nbr_env)]
fn test_run_config_with_default_account() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = common::EnvGuard::config(tmp.path());
    nbr::config::add_account("main-acct", "acc-main", None).unwrap();
    // add_account sets default if it's the first account
    let result = commands::auth::run_config(None, false);
    assert!(
        result.is_ok(),
        "run_config with default_account set should succeed: {result:?}"
    );
}

/// `telemetry = Some(false)` — covers the `map(|t| t.to_string())` arm (not "enabled").
#[test]
#[serial(nbr_env)]
fn test_run_config_telemetry_disabled() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = common::EnvGuard::config(tmp.path());

    // Save a config with telemetry=false
    let config = nbr::config::Config {
        default_account: None,
        accounts: vec![],
        telemetry: Some(false),
    };
    nbr::config::save_config(&config).unwrap();

    let result = commands::auth::run_config(None, false);
    assert!(
        result.is_ok(),
        "run_config with telemetry=false should succeed: {result:?}"
    );
}

/// `telemetry = Some(false)` json mode — same branch in json path.
#[test]
#[serial(nbr_env)]
fn test_run_config_json_with_telemetry_set() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = common::EnvGuard::config(tmp.path());

    let config = nbr::config::Config {
        default_account: Some("alice".into()),
        accounts: vec![nbr::config::AccountConfig {
            name: "alice".into(),
            account_id: "acc-alice".into(),
            api_url: None,
        }],
        telemetry: Some(true),
    };
    nbr::config::save_config(&config).unwrap();

    let result = commands::auth::run_config(None, true);
    assert!(
        result.is_ok(),
        "run_config json with default_account + telemetry should succeed: {result:?}"
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// run_notifications_list
// ══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_run_notifications_list_empty() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/notifications"))
        .respond_with(ResponseTemplate::new(200).set_body_json(notifications_response_empty()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = NotificationsListArgs { limit: 20 };
    let result = commands::auth::run_notifications_list(&mut client, &args, false).await;
    assert!(
        result.is_ok(),
        "notifications list empty should succeed: {result:?}"
    );
}

/// Items present: one unread (read_at=None → "* " marker) and one read (read_at=Some → "  " marker).
#[tokio::test]
async fn test_run_notifications_list_mixed_read_status() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/notifications"))
        .respond_with(ResponseTemplate::new(200).set_body_json(notifications_response_mixed()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = NotificationsListArgs { limit: 20 };
    let result = commands::auth::run_notifications_list(&mut client, &args, false).await;
    assert!(
        result.is_ok(),
        "notifications list mixed should succeed: {result:?}"
    );
}

#[tokio::test]
async fn test_run_notifications_list_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/notifications"))
        .respond_with(ResponseTemplate::new(200).set_body_json(notifications_response_mixed()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = NotificationsListArgs { limit: 20 };
    let result = commands::auth::run_notifications_list(&mut client, &args, true).await;
    assert!(
        result.is_ok(),
        "notifications list json should succeed: {result:?}"
    );
}

#[tokio::test]
async fn test_run_notifications_list_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/notifications"))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({ "error": "Server error" })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    client.account_name = None;
    let args = NotificationsListArgs { limit: 20 };
    let result = commands::auth::run_notifications_list(&mut client, &args, false).await;
    assert!(
        result.is_err(),
        "notifications list should fail on API error"
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// run_notifications_read
// ══════════════════════════════════════════════════════════════════════════════

/// `args.all = true` → `ReadNotificationsRequest { ids: None, all: Some(true) }`
#[tokio::test]
async fn test_run_notifications_read_all_human() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/notifications/read"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = NotificationsReadArgs {
        ids: vec![],
        all: true,
    };
    let result = commands::auth::run_notifications_read(&mut client, &args, false).await;
    assert!(
        result.is_ok(),
        "notifications read --all human should succeed: {result:?}"
    );
}

/// `args.all = true` json mode.
#[tokio::test]
async fn test_run_notifications_read_all_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/notifications/read"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = NotificationsReadArgs {
        ids: vec![],
        all: true,
    };
    let result = commands::auth::run_notifications_read(&mut client, &args, true).await;
    assert!(
        result.is_ok(),
        "notifications read --all json should succeed: {result:?}"
    );
}

/// `args.ids` non-empty, `args.all = false` → `ReadNotificationsRequest { ids: Some([...]), all: None }`
#[tokio::test]
async fn test_run_notifications_read_by_ids_human() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/notifications/read"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = NotificationsReadArgs {
        ids: vec!["notif-1".into(), "notif-2".into()],
        all: false,
    };
    let result = commands::auth::run_notifications_read(&mut client, &args, false).await;
    assert!(
        result.is_ok(),
        "notifications read --ids human should succeed: {result:?}"
    );
}

/// `args.ids` non-empty json mode.
#[tokio::test]
async fn test_run_notifications_read_by_ids_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/notifications/read"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = NotificationsReadArgs {
        ids: vec!["notif-xyz".into()],
        all: false,
    };
    let result = commands::auth::run_notifications_read(&mut client, &args, true).await;
    assert!(
        result.is_ok(),
        "notifications read --ids json should succeed: {result:?}"
    );
}

/// Neither `--all` nor `--ids` → `anyhow::bail!` error.
#[tokio::test]
async fn test_run_notifications_read_neither_errors() {
    let server = MockServer::start().await;

    let mut client = auth_client(&server.uri());
    let args = NotificationsReadArgs {
        ids: vec![],
        all: false,
    };
    let result = commands::auth::run_notifications_read(&mut client, &args, false).await;
    assert!(
        result.is_err(),
        "notifications read with neither --all nor --ids should fail"
    );
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("--all") || msg.contains("--ids"),
        "error should mention --all or --ids, got: {msg}"
    );
}

/// API error on read_notifications.
#[tokio::test]
async fn test_run_notifications_read_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/notifications/read"))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({ "error": "Server error" })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    client.account_name = None;
    let args = NotificationsReadArgs {
        ids: vec![],
        all: true,
    };
    let result = commands::auth::run_notifications_read(&mut client, &args, false).await;
    assert!(
        result.is_err(),
        "notifications read should fail on API error"
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// run_accounts async dispatcher — all four arms
// ══════════════════════════════════════════════════════════════════════════════

#[test]
#[serial(nbr_env)]
fn test_run_accounts_dispatcher_list() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = common::EnvGuard::config(tmp.path());

    let rt = tokio::runtime::Runtime::new().unwrap();
    let result = rt.block_on(commands::auth::run_accounts(&AccountsCommands::List, false));
    assert!(
        result.is_ok(),
        "run_accounts List should succeed: {result:?}"
    );
}

#[test]
#[serial(nbr_env)]
fn test_run_accounts_dispatcher_use() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = common::EnvGuard::config(tmp.path());
    nbr::config::add_account("disp-acct", "acc-disp", None).unwrap();

    let rt = tokio::runtime::Runtime::new().unwrap();
    let result = rt.block_on(commands::auth::run_accounts(
        &AccountsCommands::Use(AccountUseArgs {
            name: "disp-acct".into(),
        }),
        false,
    ));
    assert!(
        result.is_ok(),
        "run_accounts Use should succeed: {result:?}"
    );
}

#[test]
#[serial(nbr_env)]
fn test_run_accounts_dispatcher_add() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = common::EnvGuard::config(tmp.path());

    let rt = tokio::runtime::Runtime::new().unwrap();
    let result = rt.block_on(commands::auth::run_accounts(
        &AccountsCommands::Add(AccountAddArgs {
            name: "disp-add".into(),
            account_id: "acc-add-001".into(),
            secret: "sec-add-001".into(),
            api_url: None,
        }),
        false,
    ));
    assert!(
        result.is_ok(),
        "run_accounts Add should succeed: {result:?}"
    );
    let config = nbr::config::load_config().unwrap();
    assert_eq!(config.accounts[0].name, "disp-add");
}

#[test]
#[serial(nbr_env)]
fn test_run_accounts_dispatcher_remove() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = common::EnvGuard::config(tmp.path());
    nbr::config::add_account("disp-rm", "acc-rm", None).unwrap();

    let rt = tokio::runtime::Runtime::new().unwrap();
    let result = rt.block_on(commands::auth::run_accounts(
        &AccountsCommands::Remove(AccountRemoveArgs {
            name: "disp-rm".into(),
        }),
        false,
    ));
    assert!(
        result.is_ok(),
        "run_accounts Remove should succeed: {result:?}"
    );
    let config = nbr::config::load_config().unwrap();
    assert!(config.accounts.is_empty());
}

/// run_accounts json=true on List path.
#[test]
#[serial(nbr_env)]
fn test_run_accounts_dispatcher_list_json() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = common::EnvGuard::config(tmp.path());
    nbr::config::add_account("json-acct", "acc-json", None).unwrap();

    let rt = tokio::runtime::Runtime::new().unwrap();
    let result = rt.block_on(commands::auth::run_accounts(&AccountsCommands::List, true));
    assert!(
        result.is_ok(),
        "run_accounts List json should succeed: {result:?}"
    );
}
