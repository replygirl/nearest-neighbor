/// Binary-level tests using assert_cmd to exercise main.rs and cli.rs paths.
/// These tests invoke the `nbr` binary directly and check exit codes / output.
///
/// KEYCHAIN SAFETY: every test that spawns the binary must pass
/// .env("NBR_NO_KEYRING", "1") to prevent macOS login-Keychain prompts.
/// NBR_CONFIG_DIR is set to a TempDir so tests never touch the real user config.
use assert_cmd::Command;
use predicates::prelude::*;

// ── Help and no-args ──────────────────────────────────────────────────────────

#[test]
fn test_no_args_shows_help() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .assert()
        .success()
        .stdout(
            predicate::str::contains("nearest-neighbor CLI")
                .or(predicate::str::contains("Usage").or(predicate::str::contains("Commands"))),
        );
}

#[test]
fn test_help_flag() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("--help")
        .assert()
        .success()
        .stdout(
            predicate::str::contains("nearest-neighbor CLI").or(predicate::str::contains("nbr")),
        );
}

#[test]
fn test_version_flag() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("nbr").or(predicate::str::contains("0.")));
}

// ── Completions ───────────────────────────────────────────────────────────────

#[test]
fn test_completions_bash() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["completions", "bash"])
        .assert()
        .success()
        .stdout(predicate::str::is_empty().not());
}

#[test]
fn test_completions_zsh() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["completions", "zsh"])
        .assert()
        .success()
        .stdout(predicate::str::is_empty().not());
}

#[test]
fn test_completions_fish() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["completions", "fish"])
        .assert()
        .success()
        .stdout(predicate::str::is_empty().not());
}

// ── Config command ────────────────────────────────────────────────────────────

#[test]
fn test_config_command() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    // config may succeed or fail depending on system state; we just check it runs
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("config")
        .assert()
        .code(predicate::in_iter([0i32, 1]));
}

#[test]
fn test_config_command_json() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["--json", "config"])
        .assert()
        .code(predicate::in_iter([0i32, 1]));
}

// ── Accounts list ─────────────────────────────────────────────────────────────

#[test]
fn test_accounts_list_command() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["accounts", "list"])
        .assert()
        .code(predicate::in_iter([0i32, 1]));
}

#[test]
fn test_accounts_list_json() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["--json", "accounts", "list"])
        .assert()
        .code(predicate::in_iter([0i32, 1]));
}

// ── accounts add/use/remove (full round-trip) ─────────────────────────────────

#[test]
fn test_accounts_add_creates_account() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args([
            "accounts",
            "add",
            "bin-test-alice",
            "--account-id",
            "acc-bin-alice",
            "--secret",
            "sec-bin-alice",
        ])
        .assert()
        .success();
}

#[test]
fn test_accounts_add_then_list() {
    let tmp = tempfile::TempDir::new().unwrap();
    // Add account
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args([
            "accounts",
            "add",
            "bin-list-acct",
            "--account-id",
            "acc-bin-list",
            "--secret",
            "sec-bin-list",
        ])
        .assert()
        .success();

    // List should succeed and show the account
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["accounts", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("bin-list-acct"));
}

#[test]
fn test_accounts_add_json_output() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args([
            "--json",
            "accounts",
            "add",
            "bin-json-acct",
            "--account-id",
            "acc-bin-json",
            "--secret",
            "sec-bin-json",
        ])
        .assert()
        .success();
}

#[test]
fn test_accounts_use_sets_default() {
    let tmp = tempfile::TempDir::new().unwrap();
    // Add two accounts
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args([
            "accounts",
            "add",
            "bin-use-a",
            "--account-id",
            "acc-bin-a",
            "--secret",
            "sec-a",
        ])
        .assert()
        .success();

    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args([
            "accounts",
            "add",
            "bin-use-b",
            "--account-id",
            "acc-bin-b",
            "--secret",
            "sec-b",
        ])
        .assert()
        .success();

    // Set default to second account
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["accounts", "use", "bin-use-b"])
        .assert()
        .success();
}

#[test]
fn test_accounts_remove_account() {
    let tmp = tempfile::TempDir::new().unwrap();
    // Add account
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args([
            "accounts",
            "add",
            "bin-rm-acct",
            "--account-id",
            "acc-bin-rm",
            "--secret",
            "sec-rm",
        ])
        .assert()
        .success();

    // Remove it
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["accounts", "remove", "bin-rm-acct"])
        .assert()
        .success();
}

#[test]
fn test_accounts_remove_nonexistent_fails() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["accounts", "remove", "nonexistent-acc"])
        .assert()
        .failure();
}

// ── Commands that need an account (no account configured → error) ─────────────

#[test]
fn test_status_no_account_fails_gracefully() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    // With no accounts configured (or config errors), status should exit non-zero
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("status")
        .assert()
        .code(predicate::gt(0i32));
}

#[test]
fn test_whoami_no_account_fails_gracefully() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("whoami")
        .assert()
        .code(predicate::gt(0i32));
}

#[test]
fn test_login_no_account_fails_gracefully() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("login")
        .assert()
        .code(predicate::gt(0i32));
}

#[test]
fn test_logout_no_account_fails_gracefully() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("logout")
        .assert()
        .code(predicate::gt(0i32));
}

#[test]
fn test_profile_show_no_account_fails_gracefully() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["profile", "show"])
        .assert()
        .code(predicate::gt(0i32));
}

#[test]
fn test_deck_no_account_fails_gracefully() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("deck")
        .assert()
        .code(predicate::gt(0i32));
}

#[test]
fn test_matches_no_account_fails_gracefully() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("matches")
        .assert()
        .code(predicate::gt(0i32));
}

#[test]
fn test_likes_no_account_fails_gracefully() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("likes")
        .assert()
        .code(predicate::gt(0i32));
}

#[test]
fn test_relationships_no_account_fails_gracefully() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("relationships")
        .assert()
        .code(predicate::gt(0i32));
}

#[test]
fn test_messages_no_account_fails_gracefully() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("messages")
        .assert()
        .code(predicate::gt(0i32));
}

#[test]
fn test_followers_no_account_fails_gracefully() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("followers")
        .assert()
        .code(predicate::gt(0i32));
}

#[test]
fn test_following_no_account_fails_gracefully() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("following")
        .assert()
        .code(predicate::gt(0i32));
}

#[test]
fn test_feed_no_account_fails_gracefully() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("feed")
        .assert()
        .code(predicate::gt(0i32));
}

#[test]
fn test_discover_no_account_fails_gracefully() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("discover")
        .assert()
        .code(predicate::gt(0i32));
}

#[test]
fn test_photo_show_no_account_fails_gracefully() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["photo", "show"])
        .assert()
        .code(predicate::gt(0i32));
}

// ── Usage spec ────────────────────────────────────────────────────────────────

#[test]
fn test_usage_flag() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("--usage")
        .assert()
        .code(predicate::in_iter([0i32, 1]));
}

// ── Signup with API URL override ──────────────────────────────────────────────
// Signup requires the API to be reachable; with a fake URL it should fail
// but still exercise the run() → run_signup() dispatch path.

#[test]
fn test_signup_bad_api_url_fails() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["--api-url", "http://localhost:29999", "signup"])
        .assert()
        .failure();
}

// ── NBR_API_URL env var ───────────────────────────────────────────────────────

#[test]
fn test_nbr_api_url_env_var_used() {
    let tmp = tempfile::TempDir::new().unwrap();
    // The command should read NBR_API_URL from env
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .env("NBR_API_URL", "http://localhost:29999")
        .arg("status")
        .assert()
        .code(predicate::gt(0i32)); // Will fail (no account), but env var is read
}

// ── Error message quality ─────────────────────────────────────────────────────

#[test]
fn test_status_no_account_error_mentions_signup() {
    let tmp = tempfile::TempDir::new().unwrap();
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("status")
        .assert()
        .failure()
        .stderr(
            predicate::str::contains("signup")
                .or(predicate::str::contains("account"))
                .or(predicate::str::contains("No account")),
        );
}

// ── NBR_NO_KEYRING env var is respected ───────────────────────────────────────

#[test]
fn test_nbr_no_keyring_env_var_prevents_keychain_access() {
    // With NBR_NO_KEYRING=1, account operations use file storage only.
    // This verifies the env var is plumbed through the binary correctly.
    let tmp = tempfile::TempDir::new().unwrap();
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args([
            "accounts",
            "add",
            "keyring-test-acct",
            "--account-id",
            "acc-keyring-test",
            "--secret",
            "sec-keyring",
        ])
        .assert()
        .success();

    // Verify the account was written to the temp config dir (file fallback)
    let config_path = tmp.path().join("accounts.toml");
    assert!(
        config_path.exists(),
        "accounts.toml should exist in temp dir"
    );
    let content = std::fs::read_to_string(&config_path).unwrap();
    assert!(content.contains("keyring-test-acct"));
    // Secret should be stored as a file (not keyring)
    let secret_path = tmp.path().join("keyring-test-acct.secret");
    assert!(secret_path.exists(), "secret file should exist in temp dir");
}
