/// Account resolver.
///
/// Precedence (highest to lowest):
/// 1. `--account/-a` flag or `--user` flag (command-line override)
/// 2. The closest `.nearest-neighbor` file found by walking from cwd upward
///    (first found going up wins — it's closest to cwd)
/// 3. The `default_account` in the config file
///
/// If nothing resolves AND multiple accounts exist → error.
use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::config::{AccountConfig, Config};
use crate::error::NbrError;

/// The result of resolving which account to use.
#[derive(Debug, Clone)]
pub struct ResolvedAccount {
    pub name: String,
    pub account_id: String,
    pub api_url: Option<String>,
}

impl ResolvedAccount {
    fn from_config(acc: &AccountConfig) -> Self {
        ResolvedAccount {
            name: acc.name.clone(),
            account_id: acc.account_id.clone(),
            api_url: acc.api_url.clone(),
        }
    }
}

/// Walk cwd upward and return the contents of the first `.nearest-neighbor` found.
///
/// The file may contain an account name or an account_id — callers disambiguate.
pub fn find_nearest_neighbor_file(start: &Path) -> Option<(PathBuf, String)> {
    let mut dir = start.to_path_buf();
    loop {
        let candidate = dir.join(".nearest-neighbor");
        if candidate.exists()
            && let Ok(content) = std::fs::read_to_string(&candidate)
        {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() {
                return Some((candidate, trimmed));
            }
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => return None,
        }
    }
}

/// Main resolver.
/// - `flag_account`: value of `--account/-a`
/// - `flag_user`: value of `--user`
pub fn resolve(
    config: &Config,
    flag_account: Option<&str>,
    flag_user: Option<&str>,
) -> Result<ResolvedAccount> {
    // 1. Explicit --account or --user flag
    if let Some(name) = flag_account {
        return find_by_name(config, name);
    }
    if let Some(id) = flag_user {
        return find_by_id(config, id);
    }

    // 2. Walk cwd upward for .nearest-neighbor
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if let Some((_path, token)) = find_nearest_neighbor_file(&cwd) {
        // Try by name first, then by account_id
        if let Ok(acc) = find_by_name(config, &token) {
            return Ok(acc);
        }
        if let Ok(acc) = find_by_id(config, &token) {
            return Ok(acc);
        }
        // File had a value but we couldn't match it — warn and fall through
        eprintln!(
            "Warning: .nearest-neighbor file contains '{}' which does not match any account; ignoring",
            token
        );
    }

    // 3. Default account from config
    if let Some(default_name) = &config.default_account {
        return find_by_name(config, default_name);
    }

    // No resolution possible
    match config.accounts.len() {
        0 => Err(NbrError::NoAccountConfigured.into()),
        1 => Ok(ResolvedAccount::from_config(&config.accounts[0])),
        _ => Err(NbrError::MultipleAccountsNoDefault.into()),
    }
}

fn find_by_name(config: &Config, name: &str) -> Result<ResolvedAccount> {
    config
        .accounts
        .iter()
        .find(|a| a.name == name)
        .map(ResolvedAccount::from_config)
        .ok_or_else(|| NbrError::AccountNotFound(name.to_string()).into())
}

fn find_by_id(config: &Config, id: &str) -> Result<ResolvedAccount> {
    config
        .accounts
        .iter()
        .find(|a| a.account_id == id)
        .map(ResolvedAccount::from_config)
        .ok_or_else(|| NbrError::AccountNotFound(id.to_string()).into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AccountConfig, Config};
    use tempfile::TempDir;

    fn make_config(accounts: &[(&str, &str)], default: Option<&str>) -> Config {
        Config {
            default_account: default.map(|s| s.to_string()),
            accounts: accounts
                .iter()
                .map(|(name, id)| AccountConfig {
                    name: name.to_string(),
                    account_id: id.to_string(),
                    api_url: None,
                })
                .collect(),
            telemetry: None,
        }
    }

    // ── find_nearest_neighbor_file ────────────────────────────────────────────

    #[test]
    fn finds_file_in_cwd() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join(".nearest-neighbor");
        std::fs::write(&file, "myaccount").unwrap();

        let result = find_nearest_neighbor_file(tmp.path());
        assert!(result.is_some());
        let (_, content) = result.unwrap();
        assert_eq!(content, "myaccount");
    }

    #[test]
    fn finds_file_in_ancestor() {
        let tmp = TempDir::new().unwrap();
        // Place file in root of tmp
        let file = tmp.path().join(".nearest-neighbor");
        std::fs::write(&file, "root-account").unwrap();

        // Start searching from a subdirectory 3 levels deep
        let deep = tmp.path().join("a").join("b").join("c");
        std::fs::create_dir_all(&deep).unwrap();

        let result = find_nearest_neighbor_file(&deep);
        assert!(result.is_some());
        let (_, content) = result.unwrap();
        assert_eq!(content, "root-account");
    }

    #[test]
    fn closest_wins_over_ancestor() {
        let tmp = TempDir::new().unwrap();

        // Ancestor file
        let ancestor_file = tmp.path().join(".nearest-neighbor");
        std::fs::write(&ancestor_file, "ancestor-account").unwrap();

        // Closer file in subdir
        let sub = tmp.path().join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let sub_file = sub.join(".nearest-neighbor");
        std::fs::write(&sub_file, "closer-account").unwrap();

        // Start from sub — should find the sub file first
        let result = find_nearest_neighbor_file(&sub);
        assert!(result.is_some());
        let (_, content) = result.unwrap();
        assert_eq!(content, "closer-account");
    }

    #[test]
    fn returns_none_when_no_file_exists() {
        let tmp = TempDir::new().unwrap();
        // Make a nested dir but no .nearest-neighbor
        let deep = tmp.path().join("x").join("y");
        std::fs::create_dir_all(&deep).unwrap();
        assert!(find_nearest_neighbor_file(&deep).is_none());
    }

    #[test]
    fn ignores_empty_file() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join(".nearest-neighbor");
        std::fs::write(&file, "   \n").unwrap();
        assert!(find_nearest_neighbor_file(tmp.path()).is_none());
    }

    // ── resolve: flag precedence ──────────────────────────────────────────────

    #[test]
    fn flag_account_wins() {
        let config = make_config(&[("alice", "id-alice"), ("bob", "id-bob")], Some("alice"));
        let result = resolve(&config, Some("bob"), None).unwrap();
        assert_eq!(result.name, "bob");
    }

    #[test]
    fn flag_user_wins_when_no_account_flag() {
        let config = make_config(&[("alice", "id-alice"), ("bob", "id-bob")], Some("alice"));
        let result = resolve(&config, None, Some("id-bob")).unwrap();
        assert_eq!(result.account_id, "id-bob");
    }

    #[test]
    fn flag_account_beats_flag_user() {
        let config = make_config(&[("alice", "id-alice"), ("bob", "id-bob")], Some("alice"));
        // both flags: --account wins
        let result = resolve(&config, Some("alice"), Some("id-bob")).unwrap();
        assert_eq!(result.name, "alice");
    }

    // ── resolve: default fallback ─────────────────────────────────────────────

    #[test]
    fn uses_default_account_when_no_flags() {
        let config = make_config(&[("alice", "id-alice"), ("bob", "id-bob")], Some("bob"));
        let result = resolve(&config, None, None).unwrap();
        assert_eq!(result.name, "bob");
    }

    #[test]
    fn single_account_no_default_still_resolves() {
        let config = make_config(&[("solo", "id-solo")], None);
        let result = resolve(&config, None, None).unwrap();
        assert_eq!(result.name, "solo");
    }

    // ── resolve: error cases ──────────────────────────────────────────────────

    #[test]
    fn multiple_accounts_no_default_requires_flag() {
        let config = make_config(&[("alice", "id-alice"), ("bob", "id-bob")], None);
        let err = resolve(&config, None, None).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("Multiple accounts") || msg.contains("Pass -a"),
            "unexpected error: {msg}"
        );
    }

    #[test]
    fn no_accounts_returns_not_configured() {
        let config = make_config(&[], None);
        let err = resolve(&config, None, None).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("No account configured") || msg.contains("nbr signup"),
            "unexpected error: {msg}"
        );
    }

    #[test]
    fn unknown_account_name_returns_error() {
        let config = make_config(&[("alice", "id-alice")], Some("alice"));
        let err = resolve(&config, Some("nobody"), None).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("nobody"), "unexpected error: {msg}");
    }

    // ── resolve: .nearest-neighbor file ──────────────────────────────────────

    #[test]
    fn resolves_by_name_from_file() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join(".nearest-neighbor");
        std::fs::write(&file, "bob").unwrap();

        let config = make_config(&[("alice", "id-alice"), ("bob", "id-bob")], Some("alice"));

        // We can't easily set cwd in a test, so test the helper directly
        let (_, content) = find_nearest_neighbor_file(tmp.path()).unwrap();
        // Simulate the resolve logic: look up by name
        let found = config.accounts.iter().find(|a| a.name == content);
        assert!(found.is_some());
        assert_eq!(found.unwrap().name, "bob");
    }

    #[test]
    fn resolves_by_account_id_from_file() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join(".nearest-neighbor");
        std::fs::write(&file, "id-bob").unwrap();

        let config = make_config(&[("alice", "id-alice"), ("bob", "id-bob")], Some("alice"));

        let (_, content) = find_nearest_neighbor_file(tmp.path()).unwrap();
        // Simulate: try by name (fails), then by id
        let by_name = config.accounts.iter().find(|a| a.name == content);
        assert!(by_name.is_none());
        let by_id = config.accounts.iter().find(|a| a.account_id == content);
        assert!(by_id.is_some());
        assert_eq!(by_id.unwrap().name, "bob");
    }
}
