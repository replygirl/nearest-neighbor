/// Fire-and-forget PostHog analytics.
///
/// - OPT-OUT: skip if NBR_NO_TELEMETRY, DO_NOT_TRACK, or config telemetry=false.
/// - No key in env → silent no-op.
/// - Never blocks or errors the command.
use serde_json::json;

const DEFAULT_POSTHOG_HOST: &str = "https://k.nearest-neighbor.replygirl.club";

pub struct AnalyticsContext {
    pub account_id: Option<String>,
    pub command: String,
    pub subcommand: Option<String>,
    pub telemetry_enabled: Option<bool>,
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

    // Spawn a detached task — we don't await it
    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build();
        let Ok(client) = client else { return };
        let url = format!("{host}/capture/");
        let _ = client.post(&url).json(&payload).send().await;
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
