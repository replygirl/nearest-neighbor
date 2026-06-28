//! G1 — client.rs coverage top-up
//!
//! Covers: 401 auto-refresh retry branches for every HTTP verb, parse() error
//! paths (non-JSON body fallback), refresh_bearer failure paths, no-auth
//! endpoint error arms, query-string assembly for all paginated endpoints, and
//! base_url trailing-slash trimming.
//!
//! Mock registration order: wiremock uses FIFO within the same priority level
//! (default priority=5). The 401 mock must be registered FIRST so it fires on
//! the first request; the success/error fallback is registered SECOND and fires
//! after the 401 mock is exhausted via `up_to_n_times(1)`.

mod common;

use nbr::client::ApiClient;
use nbr::models::*;
use serde_json::json;
use serial_test::serial;
use tempfile::TempDir;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

// ── Response fixtures ─────────────────────────────────────────────────────────

fn me_resp() -> serde_json::Value {
    json!({
        "account": { "id": "acc-test-123", "status": "active", "created_at": "2024-01-01T00:00:00Z" },
        "dating_profile": null,
        "social_profile": null
    })
}

fn dating_profile_resp() -> serde_json::Value {
    json!({
        "account_id": "acc-test-123",
        "first_name": "Alice",
        "bio": "vibing",
        "open_to_multi": false,
        "relationship_status": "single",
        "status_is_open": true,
        "is_visible": true
    })
}

fn rel_resp() -> serde_json::Value {
    json!({
        "id": "rel-1",
        "partner_account_id": "acc-bob-1",
        "partner_handle": "bob",
        "state": "proposed",
        "is_public": false,
        "initiator_id": "acc-test-123",
        "became_official_at": null,
        "ended_at": null,
        "created_at": "2024-01-01T00:00:00Z"
    })
}

fn post_resp() -> serde_json::Value {
    json!({
        "id": "post-1",
        "body": "hello",
        "ascii_image": null,
        "author_handle": "alice",
        "author_account_id": "acc-test-123",
        "reply_to_id": null,
        "created_at": "2024-01-01T00:00:00Z"
    })
}

fn like_resp() -> serde_json::Value {
    json!({ "liked": true })
}

fn empty_posts_resp() -> serde_json::Value {
    json!({ "items": [], "next_cursor": null })
}

fn empty_notifs_resp() -> serde_json::Value {
    json!({ "items": [], "next_cursor": null })
}

fn messages_resp() -> serde_json::Value {
    json!({ "items": [], "next_cursor": null })
}

fn token_resp() -> serde_json::Value {
    json!({
        "id": "tok-1",
        "prefix": "sec_",
        "label": "ci",
        "secret": "sec_test_value",
        "created_at": "2024-01-01T00:00:00Z"
    })
}

fn match_resp() -> serde_json::Value {
    json!({
        "id": "match-1",
        "other_account_id": "acc-bob-1",
        "other_profile": null,
        "status": "active",
        "created_at": "2024-01-01T00:00:00Z"
    })
}

/// Fresh login response with a specific bearer.
fn login_resp(bearer: &str) -> serde_json::Value {
    json!({ "bearer": bearer, "expires_at": common::FRESH_EXPIRY })
}

// ── Helper: seed config dir, return (guard, dir, client) ─────────────────────

/// Create a temp config dir, seed an account with a secret, and return a client
/// with `account_name` set. The guard + dir must be kept alive for the duration
/// of the test. All three serial env vars are set by `EnvGuard::config`.
fn authed_client_seeded(mock_url: &str) -> (common::EnvGuard, TempDir, ApiClient) {
    let dir = TempDir::new().expect("temp dir");
    let guard = common::EnvGuard::config(dir.path());
    common::seed_account(dir.path(), "alice", "acc-test-123", None);
    let mut client = ApiClient::new(mock_url);
    client.account_name = Some("alice".into());
    (guard, dir, client)
}

// ── Client construction ───────────────────────────────────────────────────────

/// base_url trailing-slash trim (line 27 in client.rs): `ApiClient::new("http://host/")`
/// must not double-slash every path.
#[tokio::test]
async fn test_base_url_trailing_slash_trimmed() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(me_resp()))
        .mount(&server)
        .await;

    let url_with_slash = format!("{}/", server.uri());
    let mut client = ApiClient::new(&url_with_slash);
    client.bearer = Some("tok".into());

    // If the slash was not trimmed, the request would go to //v1/auth/me and
    // the mock would not match, returning a 404 instead.
    let result = client.me().await;
    assert!(
        result.is_ok(),
        "me() with trailing-slash base_url failed: {:?}",
        result.err()
    );
}

// ── parse() error branches ────────────────────────────────────────────────────

/// Non-401 response with a plain-text (non-JSON) body → raw text fallback
/// (lines 56-59 in client.rs).
#[tokio::test]
async fn test_parse_non_json_error_body_is_raw_text() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(503).set_body_string("Service Unavailable"))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.get_dating_profile().await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("Service Unavailable") || msg.contains("503"),
        "expected raw text in error, got: {msg}"
    );
}

/// Non-401 response with a JSON `ErrorResponse` body → `ApiError{message}` with
/// the parsed error string (lines 57-63 in client.rs).
#[tokio::test]
async fn test_parse_json_error_body_message() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/dating/profile"))
        .respond_with(
            ResponseTemplate::new(422)
                .set_body_json(json!({ "error": "validation failed: bio too long" })),
        )
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.get_dating_profile().await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("validation failed: bio too long"),
        "expected JSON error message in error, got: {msg}"
    );
}

/// 401 response → `NbrError::NotLoggedIn` (via parse, lines 60-61).
#[tokio::test]
async fn test_parse_401_maps_to_not_logged_in() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .mount(&server)
        .await;

    // No account_name → refresh will fail with NotLoggedIn immediately
    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("stale-tok".into());

    let result = client.list_tokens().await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.to_lowercase().contains("not logged in") || msg.to_lowercase().contains("login"),
        "expected not-logged-in error, got: {msg}"
    );
}

// ── No-auth endpoint error arms ───────────────────────────────────────────────

/// `signup` non-2xx with JSON body → `ApiError` (lines 276-286 in client.rs).
#[tokio::test]
async fn test_signup_server_error() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/auth/signup"))
        .respond_with(
            ResponseTemplate::new(500).set_body_json(json!({ "error": "signup unavailable" })),
        )
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let result = client.signup().await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("signup unavailable") || msg.contains("500"),
        "unexpected error: {msg}"
    );
}

/// `signup` non-2xx with plain-text body → raw text fallback.
#[tokio::test]
async fn test_signup_plain_text_error() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/auth/signup"))
        .respond_with(ResponseTemplate::new(500).set_body_string("Internal Server Error"))
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let result = client.signup().await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("Internal Server Error") || msg.contains("500"),
        "unexpected error: {msg}"
    );
}

/// `login` non-401 server error → `ApiError` (lines 311-315 in client.rs).
#[tokio::test]
async fn test_login_server_error_non_401() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(
            ResponseTemplate::new(500).set_body_json(json!({ "error": "database unavailable" })),
        )
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let result = client.login("any-secret").await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("database unavailable") || msg.contains("500"),
        "expected ApiError for 500, got: {msg}"
    );
    // Must NOT be an AuthFailed — that is 401-only
    assert!(
        !msg.to_lowercase().contains("authentication failed"),
        "500 should not become AuthFailed: {msg}"
    );
}

/// `get_public_profile` non-2xx → `ApiError` (lines 510-520 in client.rs).
#[tokio::test]
async fn test_get_public_profile_error() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/profiles/unknown"))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "error": "handle not found" })),
        )
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let result = client.get_public_profile("unknown").await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("handle not found") || msg.contains("404"),
        "unexpected error: {msg}"
    );
}

/// `get_post` success path (no auth required, lines 529-549 in client.rs).
#[tokio::test]
async fn test_get_post_success() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/posts/post-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(post_resp()))
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let result = client.get_post("post-1").await;
    assert!(
        result.is_ok(),
        "get_post should succeed: {:?}",
        result.err()
    );
    assert_eq!(result.unwrap().id, "post-1");
}

/// `get_post` non-2xx → `ApiError` (lines 538-548 in client.rs).
#[tokio::test]
async fn test_get_post_error() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/posts/gone"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({ "error": "post deleted" })))
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let result = client.get_post("gone").await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("post deleted") || msg.contains("404"),
        "unexpected error: {msg}"
    );
}

/// `delete_no_content` non-2xx → `ApiError` (lines 184-194 in client.rs).
/// Exercised via `revoke_token` which maps to DELETE /v1/auth/tokens/:id.
#[tokio::test]
async fn test_delete_no_content_error() {
    let server = MockServer::start().await;

    Mock::given(method("DELETE"))
        .and(path("/v1/auth/tokens/tok-gone"))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "error": "token not found" })),
        )
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.revoke_token("tok-gone").await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("token not found") || msg.contains("404"),
        "unexpected error: {msg}"
    );
}

/// `delete_no_content` non-JSON body → raw text (lines 185-192 in client.rs).
#[tokio::test]
async fn test_delete_no_content_plain_text_error() {
    let server = MockServer::start().await;

    Mock::given(method("DELETE"))
        .and(path("/v1/dating/matches/match-1"))
        .respond_with(ResponseTemplate::new(409).set_body_string("conflict"))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.unmatch("match-1").await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("conflict") || msg.contains("409"),
        "unexpected error: {msg}"
    );
}

// ── refresh_bearer failure paths ──────────────────────────────────────────────

/// refresh_bearer: account_name = None → NotLoggedIn (line 243 in client.rs).
/// Via `post_json` (create_token) to cover that code path.
#[tokio::test]
async fn test_refresh_bearer_no_account_name_via_post_json() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .mount(&server)
        .await;

    // account_name is NOT set — refresh will immediately fail
    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("stale".into());

    let result = client.create_token(None).await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.to_lowercase().contains("not logged in") || msg.to_lowercase().contains("login"),
        "expected not-logged-in from refresh with no account_name, got: {msg}"
    );
}

/// refresh_bearer: get_secret fails (account added but no secret stored) →
/// NotLoggedIn (line 244 in client.rs).
#[tokio::test]
#[serial(nbr_env)]
async fn test_refresh_bearer_get_secret_failure() {
    let server = MockServer::start().await;

    let dir = TempDir::new().unwrap();
    let _guard = common::EnvGuard::config(dir.path());
    // Add account config but deliberately omit writing the secret file
    nbr::config::add_account("alice", "acc-test-123", None).expect("add_account");
    // Do NOT call set_secret — so get_secret will return an error

    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.account_name = Some("alice".into());
    client.bearer = Some("stale".into());

    let result = client.me().await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.to_lowercase().contains("not logged in") || msg.to_lowercase().contains("login"),
        "expected NotLoggedIn when secret is missing, got: {msg}"
    );
}

/// refresh_bearer: login endpoint returns non-2xx → bail! (lines 255-257).
#[tokio::test]
#[serial(nbr_env)]
async fn test_refresh_bearer_login_non_2xx() {
    let server = MockServer::start().await;

    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // Login endpoint returns 500 — refresh must fail with the error text
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(500).set_body_string("server on fire"))
        .mount(&server)
        .await;

    // GET /auth/me returns 401 to trigger refresh
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .mount(&server)
        .await;

    let result = client.me().await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("Token refresh failed") || msg.contains("server on fire"),
        "expected refresh failure message, got: {msg}"
    );
}

// ── 401 auto-refresh SUCCESS flows ────────────────────────────────────────────
//
// Registration order for FIFO matching (wiremock priority=5, insertion order):
//   1. 401 mock for endpoint (up_to_n_times(1)) — fires on first request
//   2. login mock — fires when refresh_bearer calls POST /auth/login
//   3. 200/success mock for endpoint — fires on second request (after 401 exhausted)

/// get_json 401 → refresh → 200 success (via me()).
#[tokio::test]
#[serial(nbr_env)]
async fn test_get_json_401_refresh_success() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First GET /auth/me → 401 (triggers refresh)
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: POST /auth/login → 200 with new bearer
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second GET /auth/me → 200 (after refresh)
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(me_resp()))
        .mount(&server)
        .await;

    let result = client.me().await;
    assert!(
        result.is_ok(),
        "me() after 401-refresh should succeed: {:?}",
        result.err()
    );
    assert_eq!(result.unwrap().account.id, "acc-test-123");
    // Bearer must be updated in-memory by refresh_bearer
    assert_eq!(client.bearer.as_deref(), Some("new-bearer"));
}

/// get_json 401 → refresh → 4xx error (error arm after successful refresh).
#[tokio::test]
#[serial(nbr_env)]
async fn test_get_json_401_refresh_then_error() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First GET → 401
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second GET → 403
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(403).set_body_json(json!({ "error": "forbidden" })))
        .mount(&server)
        .await;

    let result = client.me().await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("forbidden") || msg.contains("403"),
        "expected forbidden error after refresh, got: {msg}"
    );
}

/// post_json 401 → refresh → 200 success (via create_token()).
#[tokio::test]
#[serial(nbr_env)]
async fn test_post_json_401_refresh_success() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First POST → 401
    Mock::given(method("POST"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second POST → 201
    Mock::given(method("POST"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(201).set_body_json(token_resp()))
        .mount(&server)
        .await;

    let result = client.create_token(Some("ci".into())).await;
    assert!(
        result.is_ok(),
        "create_token after 401-refresh should succeed: {:?}",
        result.err()
    );
    assert_eq!(result.unwrap().id, "tok-1");
}

/// post_json 401 → refresh → error after refresh.
#[tokio::test]
#[serial(nbr_env)]
async fn test_post_json_401_refresh_then_error() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First POST → 401
    Mock::given(method("POST"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second POST → 503
    Mock::given(method("POST"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(503).set_body_json(json!({ "error": "overloaded" })))
        .mount(&server)
        .await;

    let result = client.create_token(None).await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("overloaded") || msg.contains("503"),
        "unexpected error: {msg}"
    );
}

/// post_empty 401 → refresh → 200 success (via like_post()).
#[tokio::test]
#[serial(nbr_env)]
async fn test_post_empty_401_refresh_success() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First POST → 401
    Mock::given(method("POST"))
        .and(path("/v1/social/posts/post-1/like"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second POST → 200 like response
    Mock::given(method("POST"))
        .and(path("/v1/social/posts/post-1/like"))
        .respond_with(ResponseTemplate::new(200).set_body_json(like_resp()))
        .mount(&server)
        .await;

    let result = client.like_post("post-1").await;
    assert!(
        result.is_ok(),
        "like_post after 401-refresh should succeed: {:?}",
        result.err()
    );
    assert!(result.unwrap().liked);
}

/// post_empty 401 → refresh → error after refresh.
#[tokio::test]
#[serial(nbr_env)]
async fn test_post_empty_401_refresh_then_error() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First POST → 401
    Mock::given(method("POST"))
        .and(path("/v1/social/posts/post-1/repost"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second POST → 409
    Mock::given(method("POST"))
        .and(path("/v1/social/posts/post-1/repost"))
        .respond_with(
            ResponseTemplate::new(409).set_body_json(json!({ "error": "already reposted" })),
        )
        .mount(&server)
        .await;

    let result = client.repost("post-1").await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("already reposted") || msg.contains("409"),
        "unexpected error: {msg}"
    );
}

/// put_json 401 → refresh → 200 success (via upsert_dating_profile()).
#[tokio::test]
#[serial(nbr_env)]
async fn test_put_json_401_refresh_success() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First PUT → 401
    Mock::given(method("PUT"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second PUT → 200
    Mock::given(method("PUT"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(dating_profile_resp()))
        .mount(&server)
        .await;

    let req = UpsertDatingProfileRequest {
        first_name: Some("Alice".into()),
        bio: None,
        open_to_multi: None,
        relationship_status: None,
        status_is_open: None,
        is_visible: None,
        looking_for: None,
        public_likes: None,
        public_dislikes: None,
    };
    let result = client.upsert_dating_profile(req).await;
    assert!(
        result.is_ok(),
        "upsert_dating_profile after 401-refresh should succeed: {:?}",
        result.err()
    );
    assert_eq!(result.unwrap().first_name, "Alice");
}

/// put_json 401 → refresh → error after refresh.
#[tokio::test]
#[serial(nbr_env)]
async fn test_put_json_401_refresh_then_error() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First PUT → 401
    Mock::given(method("PUT"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second PUT → 422
    Mock::given(method("PUT"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({ "error": "invalid bio" })))
        .mount(&server)
        .await;

    let req = UpsertDatingProfileRequest {
        first_name: None,
        bio: Some("x".repeat(5000)),
        open_to_multi: None,
        relationship_status: None,
        status_is_open: None,
        is_visible: None,
        looking_for: None,
        public_likes: None,
        public_dislikes: None,
    };
    let result = client.upsert_dating_profile(req).await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("invalid bio") || msg.contains("422"),
        "unexpected error: {msg}"
    );
}

/// patch_json 401 → refresh → 200 success (via patch_relationship()).
#[tokio::test]
#[serial(nbr_env)]
async fn test_patch_json_401_refresh_success() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First PATCH → 401
    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-1"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second PATCH → 200
    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(rel_resp()))
        .mount(&server)
        .await;

    let req = PatchRelationshipRequest {
        state: Some("official".into()),
        is_public: None,
        end_reason: None,
    };
    let result = client.patch_relationship("rel-1", req).await;
    assert!(
        result.is_ok(),
        "patch_relationship after 401-refresh should succeed: {:?}",
        result.err()
    );
    assert_eq!(result.unwrap().id, "rel-1");
}

/// patch_json 401 → refresh → error after refresh.
#[tokio::test]
#[serial(nbr_env)]
async fn test_patch_json_401_refresh_then_error() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First PATCH → 401
    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-1"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second PATCH → 404
    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-1"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({ "error": "not found" })))
        .mount(&server)
        .await;

    let req = PatchRelationshipRequest {
        state: None,
        is_public: Some(true),
        end_reason: None,
    };
    let result = client.patch_relationship("rel-1", req).await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("not found") || msg.contains("404"),
        "unexpected error: {msg}"
    );
}

/// delete_raw 401 → refresh → 200 success (via unfollow() → delete_json()).
#[tokio::test]
#[serial(nbr_env)]
async fn test_delete_raw_401_refresh_success() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First DELETE → 401
    Mock::given(method("DELETE"))
        .and(path("/v1/social/follows/bob"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second DELETE → 200
    Mock::given(method("DELETE"))
        .and(path("/v1/social/follows/bob"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "following": false })))
        .mount(&server)
        .await;

    let result = client.unfollow("bob").await;
    assert!(
        result.is_ok(),
        "unfollow after 401-refresh should succeed: {:?}",
        result.err()
    );
}

/// delete_raw 401 → refresh → error after refresh (delete_json path: parse error).
#[tokio::test]
#[serial(nbr_env)]
async fn test_delete_raw_401_refresh_then_error() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First DELETE → 401
    Mock::given(method("DELETE"))
        .and(path("/v1/social/follows/unknown"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second DELETE → 404 (parsed by delete_json → parse())
    Mock::given(method("DELETE"))
        .and(path("/v1/social/follows/unknown"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({ "error": "not following" })))
        .mount(&server)
        .await;

    let result = client.unfollow("unknown").await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("not following") || msg.contains("404"),
        "unexpected error: {msg}"
    );
}

/// post_no_content 401 → refresh → success (via logout()).
#[tokio::test]
#[serial(nbr_env)]
async fn test_post_no_content_401_refresh_success() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First POST → 401
    Mock::given(method("POST"))
        .and(path("/v1/auth/logout"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second POST → 204
    Mock::given(method("POST"))
        .and(path("/v1/auth/logout"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let result = client.logout(None).await;
    assert!(
        result.is_ok(),
        "logout after 401-refresh should succeed: {:?}",
        result.err()
    );
}

/// post_no_content 401 → refresh → error (lines 208-219 in client.rs).
/// After the refresh succeeds, the second response is a 4xx — exercises the
/// error arm inside the 401-branch of post_no_content.
#[tokio::test]
#[serial(nbr_env)]
async fn test_post_no_content_401_refresh_then_error() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First POST → 401
    Mock::given(method("POST"))
        .and(path("/v1/auth/logout"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second POST → 403
    Mock::given(method("POST"))
        .and(path("/v1/auth/logout"))
        .respond_with(ResponseTemplate::new(403).set_body_json(json!({ "error": "cannot logout" })))
        .mount(&server)
        .await;

    let result = client.logout(None).await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("cannot logout") || msg.contains("403"),
        "unexpected error: {msg}"
    );
}

/// post_no_content error (non-401 first response — the non-refresh error arm,
/// lines 222-235). Exercised via read_notifications returning 4xx directly.
#[tokio::test]
async fn test_post_no_content_direct_error() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/notifications/read"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({ "error": "bad request" })))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let req = ReadNotificationsRequest {
        ids: Some(vec!["id-1".into()]),
        all: None,
    };
    let result = client.read_notifications(req).await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("bad request") || msg.contains("400"),
        "unexpected error: {msg}"
    );
}

/// post_no_content direct 200 OK (not 204 — still treated as success since
/// `status.is_success()` covers both, lines 222-224).
#[tokio::test]
async fn test_post_no_content_200_ok_success() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/auth/logout"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "ok": true })))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.logout(None).await;
    assert!(
        result.is_ok(),
        "logout with 200 OK should succeed: {:?}",
        result.err()
    );
}

/// read_conversation 401 → refresh → 200 success.
#[tokio::test]
#[serial(nbr_env)]
async fn test_read_conversation_401_refresh_success() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First POST → 401
    Mock::given(method("POST"))
        .and(path("/v1/conversations/conv-1/read"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second POST → 204
    Mock::given(method("POST"))
        .and(path("/v1/conversations/conv-1/read"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let result = client.read_conversation("conv-1").await;
    assert!(
        result.is_ok(),
        "read_conversation after 401-refresh should succeed: {:?}",
        result.err()
    );
}

/// read_conversation 401 → refresh → error (lines 727-730 in client.rs).
#[tokio::test]
#[serial(nbr_env)]
async fn test_read_conversation_401_refresh_then_error() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First POST → 401
    Mock::given(method("POST"))
        .and(path("/v1/conversations/conv-1/read"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second POST → 403
    Mock::given(method("POST"))
        .and(path("/v1/conversations/conv-1/read"))
        .respond_with(ResponseTemplate::new(403).set_body_string("forbidden"))
        .mount(&server)
        .await;

    let result = client.read_conversation("conv-1").await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("forbidden") || msg.contains("403"),
        "unexpected error: {msg}"
    );
}

/// read_conversation direct error (non-401 first response, lines 734-743).
#[tokio::test]
async fn test_read_conversation_direct_error() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/conversations/conv-gone/read"))
        .respond_with(ResponseTemplate::new(404).set_body_string("conv not found"))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.read_conversation("conv-gone").await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("conv not found") || msg.contains("404"),
        "unexpected error: {msg}"
    );
}

/// read_conversation 200 OK (not 204 — covered by `status.is_success()`,
/// lines 735-736).
#[tokio::test]
async fn test_read_conversation_200_ok() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/conversations/conv-1/read"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.read_conversation("conv-1").await;
    assert!(
        result.is_ok(),
        "read_conversation with 200 OK should succeed: {:?}",
        result.err()
    );
}

// ── notifications — query-string assembly ─────────────────────────────────────

/// notifications with cursor only.
#[tokio::test]
async fn test_notifications_cursor_only() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/notifications"))
        .and(query_param("cursor", "abc123"))
        .respond_with(ResponseTemplate::new(200).set_body_json(empty_notifs_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.notifications(Some("abc123"), None).await;
    assert!(
        result.is_ok(),
        "notifications(cursor) failed: {:?}",
        result.err()
    );
    assert!(result.unwrap().items.is_empty());
}

/// notifications with limit only.
#[tokio::test]
async fn test_notifications_limit_only() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/notifications"))
        .and(query_param("limit", "5"))
        .respond_with(ResponseTemplate::new(200).set_body_json(empty_notifs_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.notifications(None, Some(5)).await;
    assert!(
        result.is_ok(),
        "notifications(limit) failed: {:?}",
        result.err()
    );
}

/// notifications with cursor + limit.
#[tokio::test]
async fn test_notifications_cursor_and_limit() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/notifications"))
        .and(query_param("cursor", "cur1"))
        .and(query_param("limit", "10"))
        .respond_with(ResponseTemplate::new(200).set_body_json(empty_notifs_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.notifications(Some("cur1"), Some(10)).await;
    assert!(
        result.is_ok(),
        "notifications(cursor+limit) failed: {:?}",
        result.err()
    );
}

// ── get_deck — query-string assembly ─────────────────────────────────────────

/// get_deck with cursor.
#[tokio::test]
async fn test_get_deck_with_cursor() {
    let server = MockServer::start().await;

    let deck_resp = json!({ "items": [], "next_cursor": null });

    Mock::given(method("GET"))
        .and(path("/v1/dating/deck"))
        .and(query_param("cursor", "deck-cur"))
        .respond_with(ResponseTemplate::new(200).set_body_json(deck_resp))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.get_deck(Some("deck-cur")).await;
    assert!(
        result.is_ok(),
        "get_deck(cursor) failed: {:?}",
        result.err()
    );
    assert!(result.unwrap().items.is_empty());
}

// ── get_feed — query-string assembly ─────────────────────────────────────────

/// get_feed with no cursor and no limit.
#[tokio::test]
async fn test_get_feed_no_params() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/feed"))
        .respond_with(ResponseTemplate::new(200).set_body_json(empty_posts_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.get_feed(None, None).await;
    assert!(
        result.is_ok(),
        "get_feed(none,none) failed: {:?}",
        result.err()
    );
}

/// get_feed with cursor only.
#[tokio::test]
async fn test_get_feed_cursor_only() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/feed"))
        .and(query_param("cursor", "feed-cur"))
        .respond_with(ResponseTemplate::new(200).set_body_json(empty_posts_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.get_feed(Some("feed-cur"), None).await;
    assert!(
        result.is_ok(),
        "get_feed(cursor) failed: {:?}",
        result.err()
    );
}

/// get_feed with cursor and limit.
#[tokio::test]
async fn test_get_feed_cursor_and_limit() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/feed"))
        .and(query_param("cursor", "feed-cur"))
        .and(query_param("limit", "15"))
        .respond_with(ResponseTemplate::new(200).set_body_json(empty_posts_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.get_feed(Some("feed-cur"), Some(15)).await;
    assert!(
        result.is_ok(),
        "get_feed(cursor+limit) failed: {:?}",
        result.err()
    );
}

// ── discover — query-string assembly ─────────────────────────────────────────

/// discover with cursor only.
#[tokio::test]
async fn test_discover_cursor_only() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/discover"))
        .and(query_param("cursor", "disc-cur"))
        .respond_with(ResponseTemplate::new(200).set_body_json(empty_posts_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.discover(Some("disc-cur"), None).await;
    assert!(
        result.is_ok(),
        "discover(cursor) failed: {:?}",
        result.err()
    );
}

/// discover with limit only.
#[tokio::test]
async fn test_discover_limit_only() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/discover"))
        .and(query_param("limit", "8"))
        .respond_with(ResponseTemplate::new(200).set_body_json(empty_posts_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.discover(None, Some(8)).await;
    assert!(result.is_ok(), "discover(limit) failed: {:?}", result.err());
}

/// discover with no params.
#[tokio::test]
async fn test_discover_no_params() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/discover"))
        .respond_with(ResponseTemplate::new(200).set_body_json(empty_posts_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.discover(None, None).await;
    assert!(
        result.is_ok(),
        "discover(none,none) failed: {:?}",
        result.err()
    );
}

/// discover with cursor and limit.
#[tokio::test]
async fn test_discover_cursor_and_limit() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/discover"))
        .and(query_param("cursor", "disc-cur"))
        .and(query_param("limit", "12"))
        .respond_with(ResponseTemplate::new(200).set_body_json(empty_posts_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.discover(Some("disc-cur"), Some(12)).await;
    assert!(
        result.is_ok(),
        "discover(cursor+limit) failed: {:?}",
        result.err()
    );
}

// ── get_posts_by_handle — query-string assembly ───────────────────────────────

/// handle only (no cursor, no limit).
#[tokio::test]
async fn test_get_posts_by_handle_handle_only() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/posts"))
        .and(query_param("handle", "alice"))
        .respond_with(ResponseTemplate::new(200).set_body_json(empty_posts_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.get_posts_by_handle("alice", None, None).await;
    assert!(
        result.is_ok(),
        "get_posts_by_handle(handle) failed: {:?}",
        result.err()
    );
}

/// handle + cursor.
#[tokio::test]
async fn test_get_posts_by_handle_with_cursor() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/posts"))
        .and(query_param("handle", "alice"))
        .and(query_param("cursor", "post-cur"))
        .respond_with(ResponseTemplate::new(200).set_body_json(empty_posts_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client
        .get_posts_by_handle("alice", Some("post-cur"), None)
        .await;
    assert!(
        result.is_ok(),
        "get_posts_by_handle(cursor) failed: {:?}",
        result.err()
    );
}

/// handle + limit.
#[tokio::test]
async fn test_get_posts_by_handle_with_limit() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/posts"))
        .and(query_param("handle", "alice"))
        .and(query_param("limit", "20"))
        .respond_with(ResponseTemplate::new(200).set_body_json(empty_posts_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.get_posts_by_handle("alice", None, Some(20)).await;
    assert!(
        result.is_ok(),
        "get_posts_by_handle(limit) failed: {:?}",
        result.err()
    );
}

/// handle + cursor + limit.
#[tokio::test]
async fn test_get_posts_by_handle_cursor_and_limit() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/posts"))
        .and(query_param("handle", "bob"))
        .and(query_param("cursor", "p-cur"))
        .and(query_param("limit", "5"))
        .respond_with(ResponseTemplate::new(200).set_body_json(empty_posts_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client
        .get_posts_by_handle("bob", Some("p-cur"), Some(5))
        .await;
    assert!(
        result.is_ok(),
        "get_posts_by_handle(cursor+limit) failed: {:?}",
        result.err()
    );
}

// ── get_messages — query-string assembly ─────────────────────────────────────

/// get_messages with no params.
#[tokio::test]
async fn test_get_messages_no_params() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/conversations/conv-1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_json(messages_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.get_messages("conv-1", None, None).await;
    assert!(
        result.is_ok(),
        "get_messages(none,none) failed: {:?}",
        result.err()
    );
}

/// get_messages with cursor only.
#[tokio::test]
async fn test_get_messages_cursor_only() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/conversations/conv-1/messages"))
        .and(query_param("cursor", "msg-cur"))
        .respond_with(ResponseTemplate::new(200).set_body_json(messages_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.get_messages("conv-1", Some("msg-cur"), None).await;
    assert!(
        result.is_ok(),
        "get_messages(cursor) failed: {:?}",
        result.err()
    );
}

/// get_messages with cursor + limit.
#[tokio::test]
async fn test_get_messages_cursor_and_limit() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/conversations/conv-1/messages"))
        .and(query_param("cursor", "msg-cur"))
        .and(query_param("limit", "25"))
        .respond_with(ResponseTemplate::new(200).set_body_json(messages_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client
        .get_messages("conv-1", Some("msg-cur"), Some(25))
        .await;
    assert!(
        result.is_ok(),
        "get_messages(cursor+limit) failed: {:?}",
        result.err()
    );
}

// ── Additional coverage ────────────────────────────────────────────────────────

/// get_match success (get_json path, not previously exercised in this form).
#[tokio::test]
async fn test_get_match_success() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/dating/matches/match-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(match_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.get_match("match-1").await;
    assert!(
        result.is_ok(),
        "get_match should succeed: {:?}",
        result.err()
    );
    assert_eq!(result.unwrap().id, "match-1");
}

/// notifications 401 → refresh → success (custom query-building method with
/// its own 401 handling, lines 372-378 in client.rs).
#[tokio::test]
#[serial(nbr_env)]
async fn test_notifications_401_refresh_success() {
    let server = MockServer::start().await;
    let (_guard, _dir, mut client) = authed_client_seeded(&server.uri());

    // 1. First GET → 401
    Mock::given(method("GET"))
        .and(path("/v1/notifications"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer")))
        .mount(&server)
        .await;

    // 3. Second GET → 200
    Mock::given(method("GET"))
        .and(path("/v1/notifications"))
        .respond_with(ResponseTemplate::new(200).set_body_json(empty_notifs_resp()))
        .mount(&server)
        .await;

    let result = client.notifications(None, None).await;
    assert!(
        result.is_ok(),
        "notifications after 401-refresh should succeed: {:?}",
        result.err()
    );
}

/// create_token success (post_json path).
#[tokio::test]
async fn test_create_token_success() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(201).set_body_json(token_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.create_token(Some("ci".into())).await;
    assert!(
        result.is_ok(),
        "create_token should succeed: {:?}",
        result.err()
    );
    let tok = result.unwrap();
    assert_eq!(tok.id, "tok-1");
    assert_eq!(tok.label, "ci");
}

/// create_token with no label (None label).
#[tokio::test]
async fn test_create_token_no_label() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(201).set_body_json(token_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("tok".into());

    let result = client.create_token(None).await;
    assert!(
        result.is_ok(),
        "create_token(None) should succeed: {:?}",
        result.err()
    );
}

/// refresh_bearer: set_bearer failure path (warning eprintln, lines 262-264).
/// Seed an account, make the config dir read-only so set_bearer cannot write
/// the bearer file, then trigger a 401 → refresh flow. The refresh must still
/// return Ok (the error is non-fatal: bearer is updated in-memory).
#[cfg(unix)]
#[tokio::test]
#[serial(nbr_env)]
async fn test_refresh_bearer_set_bearer_write_failure_is_nonfatal() {
    use std::os::unix::fs::PermissionsExt;

    let server = MockServer::start().await;
    let dir = TempDir::new().unwrap();
    let _guard = common::EnvGuard::config(dir.path());
    common::seed_account(dir.path(), "alice", "acc-test-123", None);

    // Make the config dir read-only so set_bearer cannot write
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555))
        .expect("set dir read-only");

    // 1. First GET → 401
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "expired" })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // 2. Refresh: login → 200
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_resp("new-bearer-ro")))
        .mount(&server)
        .await;

    // 3. Second GET → 200
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(me_resp()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.account_name = Some("alice".into());
    client.bearer = Some("stale".into());

    let result = client.me().await;

    // Restore write permission before TempDir cleanup
    let _ = std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755));

    assert!(
        result.is_ok(),
        "me() should succeed even when set_bearer file write fails: {:?}",
        result.err()
    );
    // Bearer must be updated in-memory despite the file write failure
    assert_eq!(client.bearer.as_deref(), Some("new-bearer-ro"));
}
