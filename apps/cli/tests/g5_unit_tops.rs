/// G5 integration tests: analytics.rs + config.rs + resolver.rs + output.rs + error.rs
///
/// Primary goal: cover the `tokio::spawn` closure body in `analytics::capture()`
/// (analytics.rs lines 65-71) by routing a real request through a wiremock mock
/// server.  Supporting edge-case coverage is handled inline in the source files;
/// this file owns only the analytics HTTP-delivery scenarios.
///
/// All tests that touch process-global env vars carry `#[serial(nbr_env)]` so
/// parallel invocations within this binary cannot race.
mod common;

use nbr::analytics::{AnalyticsContext, capture, capture_and_flush};
use serial_test::serial;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

// ── helpers ───────────────────────────────────────────────────────────────────

fn make_ctx(account_id: Option<&str>, telemetry: Option<bool>) -> AnalyticsContext {
    AnalyticsContext {
        account_id: account_id.map(|s| s.to_string()),
        command: "g5-test".into(),
        subcommand: Some("run".into()),
        telemetry_enabled: telemetry,
    }
}

/// Poll the wiremock server for up to `timeout_secs` seconds.
/// Returns when at least one request is received, or the deadline expires.
async fn wait_for_requests(server: &MockServer, timeout_secs: u64) {
    let start = std::time::Instant::now();
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        let reqs = server.received_requests().await.unwrap_or_default();
        if !reqs.is_empty() {
            break;
        }
        if start.elapsed().as_secs() >= timeout_secs {
            break;
        }
    }
}

// ── analytics.rs spawn-closure coverage ──────────────────────────────────────

/// Verifies that `capture()` executes the `tokio::spawn` closure body
/// (analytics.rs lines 65-71) and sends a POST /capture/ request to the
/// configured host.
///
/// Uses a multi-thread runtime so the spawned task progresses while the test
/// awaits the polling loop.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial(nbr_env)]
async fn capture_fires_post_via_spawn_body() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/capture/"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    let _guard = common::EnvGuard::new();
    _guard.remove("NBR_NO_TELEMETRY");
    _guard.remove("DO_NOT_TRACK");
    _guard.set("NBR_POSTHOG_KEY", "phk_g5_spawn_test");
    _guard.set("NBR_POSTHOG_HOST", &server.uri());

    // This call spawns the analytics task (lines 65-71 in analytics.rs)
    capture(AnalyticsContext {
        account_id: Some("g5-spawn-acc".into()),
        command: "profile".into(),
        subcommand: Some("view".into()),
        telemetry_enabled: None,
    });

    wait_for_requests(&server, 5).await;

    let reqs = server.received_requests().await.unwrap();
    assert!(
        !reqs.is_empty(),
        "capture() spawn body should have POSTed to mock server"
    );

    let body: serde_json::Value = serde_json::from_slice(&reqs[0].body).unwrap();
    assert_eq!(
        body["api_key"].as_str(),
        Some("phk_g5_spawn_test"),
        "api_key should match NBR_POSTHOG_KEY"
    );
    assert_eq!(
        body["distinct_id"].as_str(),
        Some("g5-spawn-acc"),
        "distinct_id should be the provided account_id"
    );
    assert_eq!(body["event"].as_str(), Some("cli_command"));
    // properties sub-object
    assert_eq!(body["properties"]["command"].as_str(), Some("profile"));
    assert_eq!(body["properties"]["subcommand"].as_str(), Some("view"));
    assert!(
        body["properties"]["version"].is_string(),
        "version should be present"
    );
}

/// Verifies that when `account_id` is `None`, the spawn body calls `machine_id()`
/// and uses it as `distinct_id` (analytics.rs line 48).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial(nbr_env)]
async fn capture_uses_machine_id_when_account_id_is_none() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/capture/"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    let _guard = common::EnvGuard::new();
    _guard.remove("NBR_NO_TELEMETRY");
    _guard.remove("DO_NOT_TRACK");
    _guard.set("NBR_POSTHOG_KEY", "phk_g5_machine_id");
    _guard.set("NBR_POSTHOG_HOST", &server.uri());

    capture(AnalyticsContext {
        account_id: None, // forces machine_id() fallback (analytics.rs line 48)
        command: "deck".into(),
        subcommand: None,
        telemetry_enabled: None,
    });

    wait_for_requests(&server, 5).await;

    let reqs = server.received_requests().await.unwrap();
    assert!(
        !reqs.is_empty(),
        "capture() should POST even when account_id is None"
    );

    let body: serde_json::Value = serde_json::from_slice(&reqs[0].body).unwrap();
    let distinct_id = body["distinct_id"].as_str().unwrap_or("");
    assert!(
        distinct_id.starts_with("anon-"),
        "distinct_id should use machine_id() fallback (starts with 'anon-'), got: {distinct_id}"
    );
}

/// Verifies that `NBR_POSTHOG_HOST` env var customises the endpoint and
/// the default host is NOT used when the env var is set (analytics.rs line 46).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial(nbr_env)]
async fn capture_uses_nbr_posthog_host_env_var() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/capture/"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    let _guard = common::EnvGuard::new();
    _guard.remove("NBR_NO_TELEMETRY");
    _guard.remove("DO_NOT_TRACK");
    _guard.set("NBR_POSTHOG_KEY", "phk_g5_host_env");
    // Point at mock server — if the code used the DEFAULT_POSTHOG_HOST the
    // request would never reach this server.
    _guard.set("NBR_POSTHOG_HOST", &server.uri());

    capture(make_ctx(Some("g5-host-test"), None));

    wait_for_requests(&server, 5).await;

    let reqs = server.received_requests().await.unwrap();
    assert!(
        !reqs.is_empty(),
        "NBR_POSTHOG_HOST env var should route the request to the mock server"
    );
}

/// Verifies that `capture_and_flush()` AWAITS delivery: the POST has completed
/// by the time the call returns (no polling needed), which is what makes it safe
/// to call right before the self-update binary swap.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial(nbr_env)]
async fn capture_and_flush_awaits_delivery() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/capture/"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    let _guard = common::EnvGuard::new();
    _guard.remove("NBR_NO_TELEMETRY");
    _guard.remove("DO_NOT_TRACK");
    _guard.set("NBR_POSTHOG_KEY", "phk_flush_test");
    _guard.set("NBR_POSTHOG_HOST", &server.uri());

    capture_and_flush(AnalyticsContext {
        account_id: Some("flush-acc".into()),
        command: "self-update".into(),
        subcommand: None,
        telemetry_enabled: None,
    })
    .await;

    // No wait_for_requests poll: the await above must have flushed the POST.
    let reqs = server.received_requests().await.unwrap();
    assert_eq!(
        reqs.len(),
        1,
        "capture_and_flush must deliver before returning"
    );
    let body: serde_json::Value = serde_json::from_slice(&reqs[0].body).unwrap();
    assert_eq!(body["distinct_id"].as_str(), Some("flush-acc"));
    assert_eq!(body["properties"]["command"].as_str(), Some("self-update"));
}

/// Verifies that `capture_and_flush()` is a silent no-op when telemetry is
/// opted out — no request is sent.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial(nbr_env)]
async fn capture_and_flush_opt_out_sends_nothing() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/capture/"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    let _guard = common::EnvGuard::new();
    _guard.set("NBR_NO_TELEMETRY", "1");
    _guard.set("NBR_POSTHOG_KEY", "phk_should_not_send");
    _guard.set("NBR_POSTHOG_HOST", &server.uri());

    capture_and_flush(make_ctx(Some("acc"), None)).await;

    let reqs = server.received_requests().await.unwrap();
    assert!(reqs.is_empty(), "opt-out must suppress the request");
}

/// Verifies that `capture()` sends `subcommand: null` when subcommand is None.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[serial(nbr_env)]
async fn capture_sends_null_subcommand_when_none() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/capture/"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    let _guard = common::EnvGuard::new();
    _guard.remove("NBR_NO_TELEMETRY");
    _guard.remove("DO_NOT_TRACK");
    _guard.set("NBR_POSTHOG_KEY", "phk_g5_null_sub");
    _guard.set("NBR_POSTHOG_HOST", &server.uri());

    capture(AnalyticsContext {
        account_id: Some("g5-null-sub".into()),
        command: "feed".into(),
        subcommand: None, // should serialise as null in properties
        telemetry_enabled: None,
    });

    wait_for_requests(&server, 5).await;

    let reqs = server.received_requests().await.unwrap();
    assert!(!reqs.is_empty(), "should have received a request");

    let body: serde_json::Value = serde_json::from_slice(&reqs[0].body).unwrap();
    assert!(
        body["properties"]["subcommand"].is_null(),
        "subcommand: None should serialise as null"
    );
}
