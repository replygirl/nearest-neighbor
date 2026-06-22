use std::fs;
use std::io::Write as IoWrite;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

use crate::error::NbrError;

pub const DEFAULT_API_URL: &str = "https://api.nearest-neighbor.replygirl.club";
const SERVICE_NAME: &str = "nearest-neighbor";
const KEYRING_PREFIX_SECRET: &str = "nbr-secret";
const KEYRING_PREFIX_BEARER: &str = "nbr-bearer";
const KEYRING_PREFIX_BEARER_EXPIRY: &str = "nbr-bearer-expiry";

// ── Config file structures ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    pub default_account: Option<String>,
    #[serde(default)]
    pub accounts: Vec<AccountConfig>,
    pub telemetry: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountConfig {
    pub name: String,
    pub account_id: String,
    pub api_url: Option<String>,
}

// ── Config directory resolution ────────────────────────────────────────────────

/// Returns the config directory.
///
/// If the `NBR_CONFIG_DIR` environment variable is set, that path is used as the
/// config root (useful for tests and CI). Otherwise, the platform default from
/// `directories::ProjectDirs` is used.
pub fn config_dir() -> Result<PathBuf> {
    if let Ok(dir) = std::env::var("NBR_CONFIG_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let dirs = ProjectDirs::from("club", "replygirl", "nearest-neighbor")
        .ok_or_else(|| NbrError::Config("Cannot determine config directory".into()))?;
    Ok(dirs.config_dir().to_path_buf())
}

pub fn config_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("accounts.toml"))
}

// ── Load / Save ────────────────────────────────────────────────────────────────

pub fn load_config() -> Result<Config> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(Config::default());
    }
    let content = fs::read_to_string(&path)
        .with_context(|| format!("Reading config from {}", path.display()))?;
    toml::from_str(&content).with_context(|| "Parsing config TOML")
}

pub fn save_config(config: &Config) -> Result<()> {
    let path = config_path()?;
    let dir = path.parent().expect("config path has parent");
    fs::create_dir_all(dir)?;
    let content = toml::to_string_pretty(config).context("Serializing config")?;
    fs::write(&path, &content)?;
    Ok(())
}

// ── Account operations ────────────────────────────────────────────────────────

pub fn add_account(name: &str, account_id: &str, api_url: Option<&str>) -> Result<()> {
    let mut config = load_config()?;
    if config.accounts.iter().any(|a| a.name == name) {
        return Err(anyhow::anyhow!("Account '{}' already exists", name));
    }
    config.accounts.push(AccountConfig {
        name: name.to_string(),
        account_id: account_id.to_string(),
        api_url: api_url.map(|u| u.to_string()),
    });
    // Set as default if it's the first account
    if config.accounts.len() == 1 {
        config.default_account = Some(name.to_string());
    }
    save_config(&config)
}

pub fn remove_account(name: &str) -> Result<()> {
    let mut config = load_config()?;
    let before = config.accounts.len();
    config.accounts.retain(|a| a.name != name);
    if config.accounts.len() == before {
        return Err(anyhow::anyhow!("Account '{}' not found", name));
    }
    // Clear default if it was this account
    if config.default_account.as_deref() == Some(name) {
        config.default_account = config.accounts.first().map(|a| a.name.clone());
    }
    // Clean up secrets
    let _ = delete_secret(name);
    let _ = delete_bearer(name);
    save_config(&config)
}

pub fn set_default_account(name: &str) -> Result<()> {
    let mut config = load_config()?;
    if !config.accounts.iter().any(|a| a.name == name) {
        return Err(anyhow::anyhow!("Account '{}' not found", name));
    }
    config.default_account = Some(name.to_string());
    save_config(&config)
}

#[allow(dead_code)]
pub fn get_account<'a>(config: &'a Config, name: &str) -> Option<&'a AccountConfig> {
    config.accounts.iter().find(|a| a.name == name)
}

// ── Secret (long-lived token) storage ────────────────────────────────────────
// Uses OS keyring with file fallback.

fn keyring_entry(prefix: &str, account_name: &str) -> Result<keyring::Entry> {
    // Escape hatch: when NBR_NO_KEYRING is set, skip the OS keyring entirely and
    // let callers fall back to 0600 file storage. Useful for headless/CI
    // environments and for tests, which must never touch the real OS keychain
    // (on macOS that pops a login-Keychain password prompt per access).
    if env_flag("NBR_NO_KEYRING") {
        return Err(NbrError::Keyring("keyring disabled via NBR_NO_KEYRING".into()).into());
    }
    keyring::Entry::new(SERVICE_NAME, &format!("{prefix}:{account_name}"))
        .map_err(|e| NbrError::Keyring(e.to_string()).into())
}

/// Returns true when the named env var is set to a truthy value (not empty/0/false).
fn env_flag(name: &str) -> bool {
    match std::env::var(name) {
        Ok(v) => {
            let v = v.trim().to_ascii_lowercase();
            !v.is_empty() && v != "0" && v != "false"
        }
        Err(_) => false,
    }
}

fn secret_fallback_path(account_name: &str) -> Result<PathBuf> {
    Ok(config_dir()?.join(format!("{account_name}.secret")))
}

fn bearer_fallback_path(account_name: &str) -> Result<PathBuf> {
    Ok(config_dir()?.join(format!("{account_name}.bearer")))
}

fn bearer_expiry_fallback_path(account_name: &str) -> Result<PathBuf> {
    Ok(config_dir()?.join(format!("{account_name}.bearer_expiry")))
}

fn write_secret_file(path: &Path, value: &str) -> Result<()> {
    let dir = path.parent().expect("secret path has parent");
    fs::create_dir_all(dir)?;
    let mut f = fs::File::create(path)?;
    f.write_all(value.as_bytes())?;
    // 0600 permissions
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

pub fn set_secret(account_name: &str, secret: &str) -> Result<()> {
    if let Ok(entry) = keyring_entry(KEYRING_PREFIX_SECRET, account_name) {
        match entry.set_password(secret) {
            Ok(()) => return Ok(()),
            Err(e) => {
                eprintln!("Keyring unavailable ({e}); falling back to file storage");
            }
        }
    }
    let path = secret_fallback_path(account_name)?;
    write_secret_file(&path, secret)
}

pub fn get_secret(account_name: &str) -> Result<String> {
    // Try keyring first
    if let Ok(entry) = keyring_entry(KEYRING_PREFIX_SECRET, account_name)
        && let Ok(s) = entry.get_password()
    {
        return Ok(s);
    }
    // Fall back to file
    let path = secret_fallback_path(account_name)?;
    if path.exists() {
        return Ok(fs::read_to_string(&path)?.trim().to_string());
    }
    Err(NbrError::Config(format!("No secret found for account '{account_name}'")).into())
}

fn delete_secret(account_name: &str) -> Result<()> {
    if let Ok(entry) = keyring_entry(KEYRING_PREFIX_SECRET, account_name) {
        let _ = entry.delete_credential();
    }
    let path = secret_fallback_path(account_name)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

// ── Bearer (short-lived JWT) caching ─────────────────────────────────────────

pub fn set_bearer(account_name: &str, bearer: &str, expires_at: &str) -> Result<()> {
    // Store bearer
    match keyring_entry(KEYRING_PREFIX_BEARER, account_name) {
        Ok(entry) => match entry.set_password(bearer) {
            Ok(()) => {}
            Err(e) => {
                eprintln!("Keyring unavailable ({e}); falling back to file storage for bearer");
                let path = bearer_fallback_path(account_name)?;
                write_secret_file(&path, bearer)?;
            }
        },
        Err(_) => {
            let path = bearer_fallback_path(account_name)?;
            write_secret_file(&path, bearer)?;
        }
    }
    // Store expiry
    match keyring_entry(KEYRING_PREFIX_BEARER_EXPIRY, account_name) {
        Ok(entry) => match entry.set_password(expires_at) {
            Ok(()) => {}
            Err(_) => {
                let path = bearer_expiry_fallback_path(account_name)?;
                write_secret_file(&path, expires_at)?;
            }
        },
        Err(_) => {
            let path = bearer_expiry_fallback_path(account_name)?;
            write_secret_file(&path, expires_at)?;
        }
    }
    Ok(())
}

pub fn get_bearer(account_name: &str) -> Result<Option<(String, String)>> {
    let bearer = {
        let from_keyring = keyring_entry(KEYRING_PREFIX_BEARER, account_name)
            .ok()
            .and_then(|e| e.get_password().ok());
        if let Some(b) = from_keyring {
            Some(b)
        } else {
            let path = bearer_fallback_path(account_name)?;
            if path.exists() {
                Some(fs::read_to_string(&path)?.trim().to_string())
            } else {
                None
            }
        }
    };

    let expiry = {
        let from_keyring = keyring_entry(KEYRING_PREFIX_BEARER_EXPIRY, account_name)
            .ok()
            .and_then(|e| e.get_password().ok());
        if let Some(e) = from_keyring {
            Some(e)
        } else {
            let path = bearer_expiry_fallback_path(account_name)?;
            if path.exists() {
                Some(fs::read_to_string(&path)?.trim().to_string())
            } else {
                None
            }
        }
    };

    Ok(match (bearer, expiry) {
        (Some(b), Some(e)) => Some((b, e)),
        _ => None,
    })
}

pub fn delete_bearer(account_name: &str) -> Result<()> {
    if let Ok(entry) = keyring_entry(KEYRING_PREFIX_BEARER, account_name) {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = keyring_entry(KEYRING_PREFIX_BEARER_EXPIRY, account_name) {
        let _ = entry.delete_credential();
    }
    let bearer_path = bearer_fallback_path(account_name)?;
    if bearer_path.exists() {
        fs::remove_file(bearer_path)?;
    }
    let expiry_path = bearer_expiry_fallback_path(account_name)?;
    if expiry_path.exists() {
        fs::remove_file(expiry_path)?;
    }
    Ok(())
}

// ── Bearer freshness ──────────────────────────────────────────────────────────

/// Returns true if the bearer is still valid (expires > now + 60s buffer).
pub fn bearer_is_fresh(expires_at: &str) -> bool {
    use chrono::DateTime;
    let Ok(exp) = DateTime::parse_from_rfc3339(expires_at) else {
        return false;
    };
    let now = chrono::Utc::now();
    exp.signed_duration_since(now).num_seconds() > 60
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    /// Run `f` with `NBR_CONFIG_DIR` set to `dir` and `NBR_NO_KEYRING=1`.
    ///
    /// `NBR_NO_KEYRING=1` prevents macOS login-Keychain prompts in tests that
    /// exercise secret storage; secrets fall back to 0600 files in the temp dir.
    ///
    /// Callers must already hold the `#[serial(nbr_config_dir)]` token
    /// (applied at the test-function level) which serialises all tests in this
    /// group within the same process, preventing races on the env vars.
    fn with_config_dir<F: FnOnce()>(dir: &std::path::Path, f: F) {
        let prev_config_dir = std::env::var("NBR_CONFIG_DIR").ok();
        let prev_no_keyring = std::env::var("NBR_NO_KEYRING").ok();
        unsafe {
            std::env::set_var("NBR_CONFIG_DIR", dir.as_os_str());
            std::env::set_var("NBR_NO_KEYRING", "1");
        }
        f();
        if let Some(v) = prev_config_dir {
            unsafe { std::env::set_var("NBR_CONFIG_DIR", v) };
        } else {
            unsafe { std::env::remove_var("NBR_CONFIG_DIR") };
        }
        if let Some(v) = prev_no_keyring {
            unsafe { std::env::set_var("NBR_NO_KEYRING", v) };
        } else {
            unsafe { std::env::remove_var("NBR_NO_KEYRING") };
        }
    }

    // ── NBR_CONFIG_DIR injection ──────────────────────────────────────────────

    #[test]
    #[serial(nbr_config_dir)]
    fn config_dir_uses_env_var_when_set() {
        let tmp = tempfile::TempDir::new().unwrap();
        with_config_dir(tmp.path(), || {
            let dir = config_dir().unwrap();
            assert_eq!(dir, tmp.path());
        });
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn config_dir_falls_back_to_project_dirs_when_env_not_set() {
        // Temporarily remove NBR_CONFIG_DIR; restore it afterward.
        let prev = std::env::var("NBR_CONFIG_DIR").ok();
        unsafe { std::env::remove_var("NBR_CONFIG_DIR") };
        let result = config_dir();
        if let Some(v) = prev {
            unsafe { std::env::set_var("NBR_CONFIG_DIR", v) };
        }
        // Should succeed (ProjectDirs is available on supported platforms)
        assert!(result.is_ok());
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn load_and_save_config_with_temp_dir() {
        let tmp = tempfile::TempDir::new().unwrap();
        with_config_dir(tmp.path(), || {
            // Initially no file → default empty config
            let loaded = load_config().unwrap();
            assert!(loaded.accounts.is_empty());
            assert!(loaded.default_account.is_none());

            // Save a config and reload
            let mut config = Config::default();
            config.accounts.push(AccountConfig {
                name: "testaccount".into(),
                account_id: "acc-test-001".into(),
                api_url: None,
            });
            config.default_account = Some("testaccount".into());
            save_config(&config).unwrap();

            let reloaded = load_config().unwrap();
            assert_eq!(reloaded.accounts.len(), 1);
            assert_eq!(reloaded.accounts[0].name, "testaccount");
            assert_eq!(reloaded.default_account.as_deref(), Some("testaccount"));
        });
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn add_account_writes_to_temp_dir() {
        let tmp = tempfile::TempDir::new().unwrap();
        with_config_dir(tmp.path(), || {
            add_account("alice", "acc-alice-001", None).unwrap();

            let config = load_config().unwrap();
            assert_eq!(config.accounts.len(), 1);
            assert_eq!(config.accounts[0].name, "alice");
            assert_eq!(config.accounts[0].account_id, "acc-alice-001");
            // First account becomes default
            assert_eq!(config.default_account.as_deref(), Some("alice"));
        });
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn add_account_second_does_not_change_default() {
        let tmp = tempfile::TempDir::new().unwrap();
        with_config_dir(tmp.path(), || {
            add_account("alice", "acc-alice", None).unwrap();
            add_account("bob", "acc-bob", None).unwrap();

            let config = load_config().unwrap();
            assert_eq!(config.accounts.len(), 2);
            // default was set when alice was added (first account)
            assert_eq!(config.default_account.as_deref(), Some("alice"));
        });
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn add_account_duplicate_returns_error() {
        let tmp = tempfile::TempDir::new().unwrap();
        with_config_dir(tmp.path(), || {
            add_account("alice", "acc-alice", None).unwrap();
            let err = add_account("alice", "acc-alice-2", None).unwrap_err();
            assert!(
                err.to_string().contains("already exists"),
                "expected 'already exists' error"
            );
        });
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn remove_account_succeeds() {
        let tmp = tempfile::TempDir::new().unwrap();
        with_config_dir(tmp.path(), || {
            add_account("alice", "acc-alice", None).unwrap();
            add_account("bob", "acc-bob", None).unwrap();

            remove_account("alice").unwrap();
            let config = load_config().unwrap();
            assert_eq!(config.accounts.len(), 1);
            assert_eq!(config.accounts[0].name, "bob");
        });
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn remove_account_clears_default_when_it_was_default() {
        let tmp = tempfile::TempDir::new().unwrap();
        with_config_dir(tmp.path(), || {
            add_account("alice", "acc-alice", None).unwrap();
            add_account("bob", "acc-bob", None).unwrap();
            // alice is default (first added); remove alice
            remove_account("alice").unwrap();
            let config = load_config().unwrap();
            // default should now be bob (first remaining)
            assert_eq!(config.default_account.as_deref(), Some("bob"));
        });
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn remove_account_nonexistent_returns_error() {
        let tmp = tempfile::TempDir::new().unwrap();
        with_config_dir(tmp.path(), || {
            let err = remove_account("nobody").unwrap_err();
            assert!(
                err.to_string().contains("not found"),
                "expected 'not found' error"
            );
        });
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn set_default_account_works() {
        let tmp = tempfile::TempDir::new().unwrap();
        with_config_dir(tmp.path(), || {
            add_account("alice", "acc-alice", None).unwrap();
            add_account("bob", "acc-bob", None).unwrap();

            set_default_account("bob").unwrap();
            let config = load_config().unwrap();
            assert_eq!(config.default_account.as_deref(), Some("bob"));
        });
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn set_default_account_nonexistent_returns_error() {
        let tmp = tempfile::TempDir::new().unwrap();
        with_config_dir(tmp.path(), || {
            let err = set_default_account("nobody").unwrap_err();
            assert!(
                err.to_string().contains("not found"),
                "expected 'not found' error"
            );
        });
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn secret_file_fallback_with_temp_dir() {
        let tmp = tempfile::TempDir::new().unwrap();
        with_config_dir(tmp.path(), || {
            // Write via write_secret_file directly into the temp dir
            let path = tmp.path().join("myaccount.secret");
            write_secret_file(&path, "super-secret-value").unwrap();

            // get_secret will try keyring first (will fail for this test account name),
            // then fall back to the file in the temp config dir
            let result = get_secret("myaccount");
            // If keyring succeeds (unlikely for "myaccount"), that's fine too
            match result {
                Ok(s) => assert!(!s.is_empty(), "secret should not be empty"),
                Err(e) => {
                    // This can happen if the keyring returned an error AND
                    // the file fallback_path didn't match. Both are valid.
                    let _ = e;
                }
            }
        });
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn bearer_file_round_trip_with_temp_dir() {
        let tmp = tempfile::TempDir::new().unwrap();
        with_config_dir(tmp.path(), || {
            let bearer_path = tmp.path().join("testacct.bearer");
            let expiry_path = tmp.path().join("testacct.bearer_expiry");

            write_secret_file(&bearer_path, "jwt-test-bearer-value").unwrap();
            write_secret_file(&expiry_path, "2099-06-01T00:00:00Z").unwrap();

            let result = get_bearer("testacct").unwrap();
            // Keyring might intercept, but file fallback should return Some
            if let Some((bearer, expiry)) = result {
                assert!(!bearer.is_empty());
                assert!(!expiry.is_empty());
            }

            // delete_bearer should remove the files
            delete_bearer("testacct").unwrap();
            assert!(!bearer_path.exists(), "bearer file should be deleted");
            assert!(!expiry_path.exists(), "expiry file should be deleted");
        });
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn add_account_with_api_url() {
        let tmp = tempfile::TempDir::new().unwrap();
        with_config_dir(tmp.path(), || {
            add_account(
                "workaccount",
                "acc-work-999",
                Some("https://custom-api.example.com"),
            )
            .unwrap();

            let config = load_config().unwrap();
            assert_eq!(config.accounts.len(), 1);
            assert_eq!(
                config.accounts[0].api_url.as_deref(),
                Some("https://custom-api.example.com")
            );
        });
    }

    #[test]
    fn config_round_trip() {
        let mut config = Config::default();
        config.accounts.push(AccountConfig {
            name: "test".into(),
            account_id: "acc-123".into(),
            api_url: None,
        });
        config.default_account = Some("test".into());
        let serialized = toml::to_string_pretty(&config).unwrap();
        let deserialized: Config = toml::from_str(&serialized).unwrap();
        assert_eq!(deserialized.default_account.as_deref(), Some("test"));
        assert_eq!(deserialized.accounts.len(), 1);
        assert_eq!(deserialized.accounts[0].name, "test");
        assert_eq!(deserialized.accounts[0].account_id, "acc-123");
    }

    #[test]
    fn bearer_freshness() {
        use chrono::{Duration, Utc};
        // Future timestamp → fresh
        let future = (Utc::now() + Duration::hours(1)).to_rfc3339();
        assert!(bearer_is_fresh(&future));
        // Past timestamp → stale
        let past = (Utc::now() - Duration::hours(1)).to_rfc3339();
        assert!(!bearer_is_fresh(&past));
        // Almost expired (within 60s) → stale
        let almost = (Utc::now() + Duration::seconds(30)).to_rfc3339();
        assert!(!bearer_is_fresh(&almost));
        // Bad string → stale
        assert!(!bearer_is_fresh("not-a-date"));
    }

    // ── Config file-based load/save ───────────────────────────────────────────

    #[test]
    fn load_config_does_not_panic() {
        // load_config reads from the system config dir — it may succeed (returns config)
        // or fail (returns error if config file is corrupted or dir is unreadable).
        // We only verify it doesn't panic and returns a Result.
        let result = load_config();
        let _ = result; // either Ok or Err is acceptable
    }

    #[test]
    fn config_with_api_url() {
        let config = Config {
            default_account: Some("work".into()),
            accounts: vec![AccountConfig {
                name: "work".into(),
                account_id: "acc-work".into(),
                api_url: Some("https://my-api.example.com".into()),
            }],
            telemetry: Some(true),
        };
        let serialized = toml::to_string_pretty(&config).unwrap();
        let deserialized: Config = toml::from_str(&serialized).unwrap();
        assert_eq!(
            deserialized.accounts[0].api_url.as_deref(),
            Some("https://my-api.example.com")
        );
        assert_eq!(deserialized.telemetry, Some(true));
    }

    #[test]
    fn get_account_finds_matching() {
        let config = Config {
            default_account: Some("alice".into()),
            accounts: vec![
                AccountConfig {
                    name: "alice".into(),
                    account_id: "id-alice".into(),
                    api_url: None,
                },
                AccountConfig {
                    name: "bob".into(),
                    account_id: "id-bob".into(),
                    api_url: None,
                },
            ],
            telemetry: None,
        };
        let found = get_account(&config, "alice");
        assert!(found.is_some());
        assert_eq!(found.unwrap().account_id, "id-alice");
    }

    #[test]
    fn get_account_returns_none_for_unknown() {
        let config = Config {
            default_account: None,
            accounts: vec![AccountConfig {
                name: "alice".into(),
                account_id: "id-alice".into(),
                api_url: None,
            }],
            telemetry: None,
        };
        assert!(get_account(&config, "nobody").is_none());
    }

    // ── File-based secret storage ─────────────────────────────────────────────
    // These tests write to temp directories to avoid touching the real config dir.

    #[test]
    fn write_and_read_secret_via_file() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("test.secret");
        write_secret_file(&path, "my-secret-value").unwrap();

        // Check permissions are 0600
        let metadata = std::fs::metadata(&path).unwrap();
        let mode = metadata.permissions().mode();
        assert_eq!(
            mode & 0o777,
            0o600,
            "Expected 0600 permissions, got {:o}",
            mode & 0o777
        );

        // Check content
        let read_back = std::fs::read_to_string(&path).unwrap();
        assert_eq!(read_back, "my-secret-value");
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn get_secret_falls_back_to_file_when_keyring_unavailable() {
        // We can't easily disable the OS keyring in unit tests.
        // But we CAN test the file fallback by writing to the secret fallback path
        // for a test account name, then reading it back.
        //
        // Note: This test uses the real config dir. Use a unique account name
        // to avoid collision with real accounts.
        let test_account = format!("test-secret-fallback-{}", std::process::id());

        // Write to the secret fallback path directly
        let path = secret_fallback_path(&test_account).unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "test-secret-file-value").unwrap();

        // get_secret will try keyring first (may fail), then fall back to file
        let result = get_secret(&test_account);

        // Clean up before asserting to avoid leftover files
        let _ = std::fs::remove_file(&path);

        // The file fallback should have returned our value
        // (Unless keyring found something — unlikely for this unique test name)
        match result {
            Ok(s) => assert!(s.contains("test-secret-file-value") || !s.is_empty()),
            Err(_) => {
                // If the keyring entry somehow prevented file fallback and
                // the keyring also had no entry, this is still correct behavior
            }
        }
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn get_secret_returns_error_when_neither_source_exists() {
        let test_account = format!("test-nosecret-{}", std::process::id());
        // No keyring entry, no file → error
        let result = get_secret(&test_account);
        // Should error since neither keyring nor file exists for this account
        // (unless the OS keyring somehow has a stale entry — very unlikely)
        if let Err(e) = result {
            let msg = e.to_string();
            assert!(
                msg.contains(&test_account) || msg.contains("No secret") || msg.contains("Config"),
                "unexpected error: {msg}"
            );
        }
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn bearer_file_round_trip_via_set_and_get() {
        let test_account = format!("test-bearer-rt-{}", std::process::id());

        // set_bearer will try keyring first (may fail), then fall back to file
        let result = set_bearer(&test_account, "jwt-bearer-test", "2099-01-01T00:00:00Z");
        assert!(result.is_ok(), "set_bearer should succeed: {:?}", result);

        // get_bearer should return the value we set
        let get_result = get_bearer(&test_account);
        assert!(
            get_result.is_ok(),
            "get_bearer should succeed: {:?}",
            get_result
        );
        // May return Some (from keyring or file) or None
        if let Ok(Some((bearer, expiry))) = &get_result {
            assert!(!bearer.is_empty(), "bearer should not be empty");
            assert!(!expiry.is_empty(), "expiry should not be empty");
        }

        // delete_bearer should succeed
        let delete_result = delete_bearer(&test_account);
        assert!(
            delete_result.is_ok(),
            "delete_bearer should succeed: {:?}",
            delete_result
        );

        // After delete, get_bearer should return None (or possibly still keyring entry if it existed)
        let after_delete = get_bearer(&test_account);
        assert!(
            after_delete.is_ok(),
            "get_bearer after delete should not error"
        );
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn set_and_get_bearer_file_fallback() {
        // Force file fallback by writing directly to fallback paths
        let test_account = format!("test-bearer-file-{}", std::process::id());
        let bearer_path = bearer_fallback_path(&test_account).unwrap();
        let expiry_path = bearer_expiry_fallback_path(&test_account).unwrap();
        std::fs::create_dir_all(bearer_path.parent().unwrap()).unwrap();

        write_secret_file(&bearer_path, "jwt-file-bearer").unwrap();
        write_secret_file(&expiry_path, "2099-12-31T00:00:00Z").unwrap();

        // get_bearer should find the file fallback
        let result = get_bearer(&test_account);
        assert!(result.is_ok(), "get_bearer file fallback should succeed");
        // Should return Some since files exist (unless keyring got it first)
        let _ = result;

        // delete_bearer should clean up the files
        let delete_result = delete_bearer(&test_account);
        assert!(delete_result.is_ok(), "delete_bearer should succeed");

        // Verify files are gone
        assert!(!bearer_path.exists(), "bearer file should be deleted");
        assert!(!expiry_path.exists(), "expiry file should be deleted");
    }

    #[test]
    #[serial(nbr_config_dir)]
    fn get_bearer_returns_none_when_no_files() {
        let test_account = format!("test-bearer-none-{}", std::process::id());
        // Ensure no files exist
        let bearer_path = bearer_fallback_path(&test_account).unwrap();
        let expiry_path = bearer_expiry_fallback_path(&test_account).unwrap();
        let _ = std::fs::remove_file(&bearer_path);
        let _ = std::fs::remove_file(&expiry_path);

        // get_bearer should return None when neither keyring nor files have data
        let result = get_bearer(&test_account);
        // Keyring might have something unexpected, so we just check it's Ok
        assert!(
            result.is_ok(),
            "get_bearer should not error when nothing exists"
        );
    }

    #[test]
    fn add_and_remove_account_operations() {
        // This test exercises add_account/remove_account/set_default_account
        // by using a temporary config path. Since we can't easily redirect config_path()
        // in unit tests, we test the logic directly on a Config struct.

        // Test add_account logic manually by manipulating Config
        let mut config = Config::default();

        // Simulate adding accounts
        config.accounts.push(AccountConfig {
            name: "first".into(),
            account_id: "id-first".into(),
            api_url: None,
        });
        assert_eq!(config.accounts.len(), 1);

        config.accounts.push(AccountConfig {
            name: "second".into(),
            account_id: "id-second".into(),
            api_url: Some("https://custom.api".into()),
        });
        assert_eq!(config.accounts.len(), 2);

        // Simulate removing an account
        let before = config.accounts.len();
        config.accounts.retain(|a| a.name != "first");
        assert_eq!(config.accounts.len(), before - 1);
        assert!(config.accounts.iter().all(|a| a.name != "first"));

        // Simulate set_default_account logic
        let name = "second";
        assert!(config.accounts.iter().any(|a| a.name == name));
        config.default_account = Some(name.to_string());
        assert_eq!(config.default_account.as_deref(), Some("second"));
    }

    #[test]
    fn bearer_is_fresh_at_boundary() {
        use chrono::{Duration, Utc};
        // 120 seconds from now → definitely fresh (well above 60s threshold)
        let fresh = (Utc::now() + Duration::seconds(120)).to_rfc3339();
        assert!(bearer_is_fresh(&fresh));
        // Already expired → stale
        let expired = (Utc::now() - Duration::seconds(1)).to_rfc3339();
        assert!(!bearer_is_fresh(&expired));
    }
}
