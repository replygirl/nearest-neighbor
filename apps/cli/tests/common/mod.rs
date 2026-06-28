/// Shared test harness for nbr integration tests.
///
/// This module is included by each integration test file via `mod common;`.
/// Because it lives in a `common/` subdirectory, cargo does NOT compile it as
/// its own test binary — it is only compiled when a sibling file declares
/// `mod common;`.
///
/// All items are annotated `#[allow(dead_code)]` so files that use only a
/// subset stay clippy-clean under `-D warnings`.
use std::path::Path;

use nbr::cli::{Cli, Commands};
use nbr::client::ApiClient;
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

// ── Expiry constants ──────────────────────────────────────────────────────────

/// A bearer expiry timestamp well in the future — `bearer_is_fresh` returns true.
#[allow(dead_code)]
pub const FRESH_EXPIRY: &str = "2099-01-01T00:00:00Z";

/// A bearer expiry timestamp in the past — `bearer_is_fresh` returns false.
#[allow(dead_code)]
pub const STALE_EXPIRY: &str = "2000-01-01T00:00:00Z";

// ── EnvGuard ──────────────────────────────────────────────────────────────────

/// RAII guard that snapshots a set of environment variables on construction and
/// restores them (or removes them) on drop.
///
/// Tests that mutate process-global env vars must:
/// 1. Hold an `EnvGuard` for the lifetime of the test.
/// 2. Carry `#[serial(nbr_env)]` so tests in the same binary do not race.
#[allow(dead_code)]
pub struct EnvGuard {
    saved: Vec<(String, Option<String>)>,
}

#[allow(dead_code)]
impl EnvGuard {
    const TRACKED: &'static [&'static str] = &[
        "NBR_CONFIG_DIR",
        "NBR_NO_KEYRING",
        "NBR_API_URL",
        "NBR_POSTHOG_KEY",
        "NBR_POSTHOG_HOST",
        "NBR_NO_TELEMETRY",
        "DO_NOT_TRACK",
    ];

    /// Snapshot all tracked env vars; do not change any of them yet.
    pub fn new() -> Self {
        let saved = Self::TRACKED
            .iter()
            .map(|k| (k.to_string(), std::env::var(k).ok()))
            .collect();
        EnvGuard { saved }
    }

    /// Convenience constructor: snapshot tracked vars, then set `NBR_CONFIG_DIR`
    /// to `dir` and `NBR_NO_KEYRING=1`.
    ///
    /// Use for any test that needs an isolated config directory. Prevents macOS
    /// login-Keychain password prompts during tests that exercise secret storage.
    pub fn config(dir: &Path) -> Self {
        let guard = Self::new();
        unsafe {
            std::env::set_var("NBR_CONFIG_DIR", dir.as_os_str());
            std::env::set_var("NBR_NO_KEYRING", "1");
        }
        guard
    }

    /// Set (or remove when `value` is `None`) an env var tracked by this guard.
    pub fn set(&self, key: &str, value: &str) {
        unsafe { std::env::set_var(key, value) };
    }

    /// Remove an env var.
    pub fn remove(&self, key: &str) {
        unsafe { std::env::remove_var(key) };
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        for (key, value) in &self.saved {
            match value {
                Some(v) => unsafe { std::env::set_var(key, v) },
                None => unsafe { std::env::remove_var(key) },
            }
        }
    }
}

// ── Mock server helpers ───────────────────────────────────────────────────────

/// Start a fresh wiremock `MockServer`.
#[allow(dead_code)]
pub async fn start_mock() -> MockServer {
    MockServer::start().await
}

/// Mount `POST /v1/auth/login` → 200 with `{ bearer, expires_at }`.
///
/// Used to satisfy the auto-refresh flow in `refresh_bearer` as well as
/// direct `login` command tests.
#[allow(dead_code)]
pub async fn mount_login(server: &MockServer, bearer: &str, expires_at: &str) {
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "bearer": bearer,
            "expires_at": expires_at,
        })))
        .mount(server)
        .await;
}

// ── Client helpers ────────────────────────────────────────────────────────────

/// Build an `ApiClient` already loaded with a bearer and account name.
///
/// `base_url` should be the wiremock server URI (e.g. `server.uri()`).
#[allow(dead_code)]
pub fn authed_client(base_url: &str) -> ApiClient {
    let mut client = ApiClient::new(base_url);
    client.bearer = Some("jwt-token-xyz".into());
    client.account_name = Some("alice".into());
    client
}

// ── Config / account seeding ──────────────────────────────────────────────────

/// Seed an account into `NBR_CONFIG_DIR` so that `nbr::run()` and
/// `assert_cmd`-spawned binaries can resolve an account without prompting.
///
/// Writes `accounts.toml` (via `nbr::config::add_account`) and a `.secret`
/// file (via `nbr::config::set_secret`) under `dir`. Also writes a `.bearer`
/// and `.bearer_expiry` file when `bearer` is `Some`.
///
/// # Panics
/// Panics if any config operation fails (indicates a test setup error).
///
/// # Env precondition
/// `NBR_CONFIG_DIR` must already be set to `dir.to_str()` and `NBR_NO_KEYRING=1`
/// must be set before calling this function (e.g. via `EnvGuard::config`).
#[allow(dead_code)]
pub fn seed_account(_dir: &Path, name: &str, account_id: &str, api_url: Option<&str>) {
    nbr::config::add_account(name, account_id, api_url)
        .unwrap_or_else(|e| panic!("seed_account: add_account failed: {e}"));
    nbr::config::set_secret(name, "test-secret-value")
        .unwrap_or_else(|e| panic!("seed_account: set_secret failed: {e}"));
}

/// Seed an account and write a fresh bearer token so `bearer_is_fresh` returns true.
#[allow(dead_code)]
pub fn seed_account_with_bearer(
    _dir: &Path,
    name: &str,
    account_id: &str,
    api_url: Option<&str>,
    bearer: &str,
    expires_at: &str,
) {
    seed_account(_dir, name, account_id, api_url);
    nbr::config::set_bearer(name, bearer, expires_at)
        .unwrap_or_else(|e| panic!("seed_account_with_bearer: set_bearer failed: {e}"));
}

// ── Cli construction helpers ──────────────────────────────────────────────────

/// Build a `Cli` with the given subcommand and no other flags set.
#[allow(dead_code)]
pub fn make_cli(command: Commands) -> Cli {
    Cli {
        account: None,
        user: None,
        json: false,
        api_url: None,
        usage: false,
        command: Some(command),
    }
}

/// Build a `Cli` with the given subcommand and a specific `--api-url`.
#[allow(dead_code)]
pub fn make_cli_with_url(command: Commands, api_url: &str) -> Cli {
    Cli {
        account: None,
        user: None,
        json: false,
        api_url: Some(api_url.to_string()),
        usage: false,
        command: Some(command),
    }
}

/// Build a `Cli` with `--json` set.
#[allow(dead_code)]
pub fn make_cli_json(command: Commands) -> Cli {
    Cli {
        account: None,
        user: None,
        json: true,
        api_url: None,
        usage: false,
        command: Some(command),
    }
}

/// Build a `Cli` with both `--json` and `--api-url`.
#[allow(dead_code)]
pub fn make_cli_json_url(command: Commands, api_url: &str) -> Cli {
    Cli {
        account: None,
        user: None,
        json: true,
        api_url: Some(api_url.to_string()),
        usage: false,
        command: Some(command),
    }
}
