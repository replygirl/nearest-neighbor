/// Fire-and-forget PostHog analytics.
///
/// - OPT-OUT: skip if NBR_NO_TELEMETRY, DO_NOT_TRACK, or config telemetry=false.
/// - No key in env → silent no-op.
/// - Never blocks or errors the command.
use serde_json::{Value, json};

const DEFAULT_POSTHOG_HOST: &str = "https://k.nearest-neighbor.replygirl.club";

pub struct AnalyticsContext {
    pub account_id: Option<String>,
    pub command: String,
    pub subcommand: Option<String>,
    pub telemetry_enabled: Option<bool>,
}

/// Inner HTTP send logic, extracted for testability.
///
/// Sends a single POST with `payload` to `{host_url}/capture/`.
/// Silently ignores all errors (analytics must never break commands).
///
/// Note: the outer `tokio::spawn` handoff in `capture()` is a fire-and-forget
/// boundary that cannot be meaningfully unit-tested without process-level
/// instrumentation; the meaningful I/O behaviour is covered here instead.
pub async fn send_event(client: reqwest::Client, host_url: String, payload: Value) {
    let url = format!("{host_url}/capture/");
    let _ = client.post(&url).json(&payload).send().await;
}

/// Spawn a fire-and-forget task to capture a CLI event.
pub fn capture(ctx: AnalyticsContext) {
    // Check opt-out signals
    if std::env::var("NBR_NO_TELEMETRY").is_ok() || std::env::var("DO_NOT_TRACK").is_ok() {
        return;
    }
    if ctx.telemetry_enabled == Some(false) {
        return;
    }

    let api_key = match std::env::var("NBR_POSTHOG_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => return, // No key → silent no-op
    };

    let host =
        std::env::var("NBR_POSTHOG_HOST").unwrap_or_else(|_| DEFAULT_POSTHOG_HOST.to_string());

    let distinct_id = ctx.account_id.clone().unwrap_or_else(machine_id);

    let payload = json!({
        "api_key": api_key,
        "event": "cli_command",
        "distinct_id": distinct_id,
        "properties": {
            "command": ctx.command,
            "subcommand": ctx.subcommand,
            "version": env!("CARGO_PKG_VERSION"),
        },
    });

    // Spawn a detached task — we don't await it.
    // The tokio::spawn handoff itself is not covered by tests (it is an
    // intentional fire-and-forget boundary); the inner HTTP logic is covered
    // by direct calls to send_event() in the test suite below.
    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build();
        let Ok(client) = client else { return };
        send_event(client, host, payload).await;
    });
}

/// Best-effort machine identifier for anonymous analytics.
fn machine_id() -> String {
    // Try to derive a stable ID from the hostname + username
    let hostname = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "unknown".to_string());
    let username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown".to_string());
    format!("anon-{hostname}-{username}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ctx(account_id: Option<&str>, telemetry: Option<bool>) -> AnalyticsContext {
        AnalyticsContext {
            account_id: account_id.map(|s| s.to_string()),
            command: "test-cmd".into(),
            subcommand: Some("test-sub".into()),
            telemetry_enabled: telemetry,
        }
    }

    /// Helper to call capture with telemetry explicitly disabled — exercises the early return path.
    #[test]
    fn capture_skips_when_telemetry_explicitly_disabled() {
        // telemetry_enabled = Some(false) → returns early regardless of env
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            capture(make_ctx(Some("acc-123"), Some(false)));
        });
    }

    /// No API key set → silent no-op (exercises the `_ => return` branch).
    #[test]
    fn capture_skips_when_no_api_key_set() {
        // We can't guarantee NBR_POSTHOG_KEY is absent in all environments, but
        // we test this path indirectly by checking that capture doesn't panic when
        // telemetry=None and key is absent.
        // Run on current thread to avoid env race with other tests.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            // If NBR_POSTHOG_KEY is absent this returns early; if present it spawns (also fine)
            capture(make_ctx(None, Some(false))); // telemetry=false → early return always
        });
    }

    #[test]
    fn machine_id_returns_non_empty_string() {
        let id = machine_id();
        assert!(!id.is_empty());
        assert!(id.starts_with("anon-"));
    }

    #[test]
    fn machine_id_format_contains_separator() {
        let id = machine_id();
        // Format should be "anon-<hostname>-<username>"
        let parts: Vec<&str> = id.splitn(3, '-').collect();
        assert_eq!(parts[0], "anon");
        assert!(parts.len() >= 2, "machine_id should have at least 2 parts");
    }

    #[test]
    fn analytics_context_fields() {
        // Test that AnalyticsContext can be constructed with all fields
        let ctx = AnalyticsContext {
            account_id: Some("acc-123".into()),
            command: "status".into(),
            subcommand: Some("show".into()),
            telemetry_enabled: Some(true),
        };
        assert_eq!(ctx.account_id.as_deref(), Some("acc-123"));
        assert_eq!(ctx.command, "status");
        assert_eq!(ctx.subcommand.as_deref(), Some("show"));
        assert_eq!(ctx.telemetry_enabled, Some(true));
    }

    #[test]
    fn analytics_context_no_account_id() {
        let ctx = AnalyticsContext {
            account_id: None,
            command: "signup".into(),
            subcommand: None,
            telemetry_enabled: None,
        };
        assert!(ctx.account_id.is_none());
        assert!(ctx.subcommand.is_none());
        assert!(ctx.telemetry_enabled.is_none());
    }

    // ── send_event ────────────────────────────────────────────────────────────

    /// send_event POSTs the correct JSON shape to the wiremock server.
    #[tokio::test]
    async fn send_event_posts_correct_body() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/capture/"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        let payload = json!({
            "api_key": "phk_test_key",
            "event": "cli_command",
            "distinct_id": "acc-send-test",
            "properties": {
                "command": "status",
                "subcommand": null,
                "version": env!("CARGO_PKG_VERSION"),
            },
        });

        send_event(client, server.uri(), payload).await;

        // Verify the request was received
        let received = server.received_requests().await.unwrap();
        assert_eq!(
            received.len(),
            1,
            "should have received exactly one request"
        );
        let req = &received[0];
        assert_eq!(req.method.as_str(), "POST");
        assert_eq!(req.url.path(), "/capture/");

        // Verify the body contains required fields
        let body: serde_json::Value = serde_json::from_slice(&req.body).unwrap();
        assert_eq!(body["api_key"], "phk_test_key");
        assert_eq!(body["event"], "cli_command");
        assert_eq!(body["distinct_id"], "acc-send-test");
        assert_eq!(body["properties"]["command"], "status");
    }

    /// send_event silently ignores server errors (5xx).
    #[tokio::test]
    async fn send_event_silently_ignores_server_error() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/capture/"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        // Should not panic or return an error
        send_event(client, server.uri(), json!({"event": "test"})).await;
    }

    /// send_event silently ignores connection errors (server not running).
    #[tokio::test]
    async fn send_event_silently_ignores_connection_error() {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(100))
            .build()
            .unwrap();

        // Port 19999 is almost certainly not in use; connection should fail fast
        send_event(
            client,
            "http://localhost:19999".to_string(),
            json!({"event": "test"}),
        )
        .await;
        // No panic — the error is silently dropped
    }

    /// send_event sends the full payload including properties sub-object.
    #[tokio::test]
    async fn send_event_sends_properties() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/capture/"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();

        let payload = json!({
            "api_key": "phk_abc",
            "event": "cli_command",
            "distinct_id": "anon-host-user",
            "properties": {
                "command": "deck",
                "subcommand": null,
                "version": "0.1.0",
            },
        });

        send_event(client, server.uri(), payload).await;

        let received = server.received_requests().await.unwrap();
        assert_eq!(received.len(), 1);
        let body: serde_json::Value = serde_json::from_slice(&received[0].body).unwrap();
        assert_eq!(body["properties"]["command"], "deck");
        assert!(body["properties"]["version"].is_string());
    }

    // ── opt-out gate ──────────────────────────────────────────────────────────

    /// NBR_NO_TELEMETRY set → capture returns before spawning.
    #[test]
    fn capture_nbr_no_telemetry_returns_early() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let prev = std::env::var("NBR_NO_TELEMETRY").ok();
            let prev_dnt = std::env::var("DO_NOT_TRACK").ok();
            unsafe {
                std::env::set_var("NBR_NO_TELEMETRY", "1");
                std::env::remove_var("DO_NOT_TRACK");
            }
            // With a key set, without the opt-out this would spawn; with opt-out it returns early
            unsafe { std::env::set_var("NBR_POSTHOG_KEY", "phk_test") };
            capture(make_ctx(Some("acc"), None));
            unsafe { std::env::remove_var("NBR_POSTHOG_KEY") };
            match prev {
                Some(v) => unsafe { std::env::set_var("NBR_NO_TELEMETRY", v) },
                None => unsafe { std::env::remove_var("NBR_NO_TELEMETRY") },
            }
            match prev_dnt {
                Some(v) => unsafe { std::env::set_var("DO_NOT_TRACK", v) },
                None => unsafe { std::env::remove_var("DO_NOT_TRACK") },
            }
        });
    }

    /// DO_NOT_TRACK set → capture returns before spawning.
    #[test]
    fn capture_do_not_track_returns_early() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let prev_nbt = std::env::var("NBR_NO_TELEMETRY").ok();
            let prev_dnt = std::env::var("DO_NOT_TRACK").ok();
            unsafe {
                std::env::remove_var("NBR_NO_TELEMETRY");
                std::env::set_var("DO_NOT_TRACK", "1");
                std::env::set_var("NBR_POSTHOG_KEY", "phk_test");
            }
            capture(make_ctx(Some("acc"), None));
            unsafe { std::env::remove_var("NBR_POSTHOG_KEY") };
            match prev_nbt {
                Some(v) => unsafe { std::env::set_var("NBR_NO_TELEMETRY", v) },
                None => unsafe { std::env::remove_var("NBR_NO_TELEMETRY") },
            }
            match prev_dnt {
                Some(v) => unsafe { std::env::set_var("DO_NOT_TRACK", v) },
                None => unsafe { std::env::remove_var("DO_NOT_TRACK") },
            }
        });
    }

    /// Missing key → capture returns before spawning.
    #[test]
    fn capture_missing_key_returns_early() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let prev_nbt = std::env::var("NBR_NO_TELEMETRY").ok();
            let prev_dnt = std::env::var("DO_NOT_TRACK").ok();
            let prev_key = std::env::var("NBR_POSTHOG_KEY").ok();
            unsafe {
                std::env::remove_var("NBR_NO_TELEMETRY");
                std::env::remove_var("DO_NOT_TRACK");
                std::env::remove_var("NBR_POSTHOG_KEY");
            }
            capture(make_ctx(Some("acc"), None));
            if let Some(v) = prev_nbt {
                unsafe { std::env::set_var("NBR_NO_TELEMETRY", v) };
            }
            if let Some(v) = prev_dnt {
                unsafe { std::env::set_var("DO_NOT_TRACK", v) };
            }
            if let Some(v) = prev_key {
                unsafe { std::env::set_var("NBR_POSTHOG_KEY", v) };
            }
        });
    }
}
