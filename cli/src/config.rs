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

pub fn config_dir() -> Result<PathBuf> {
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
    keyring::Entry::new(SERVICE_NAME, &format!("{prefix}:{account_name}"))
        .map_err(|e| NbrError::Keyring(e.to_string()).into())
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
        // Bad string → stale
        assert!(!bearer_is_fresh("not-a-date"));
    }
}
