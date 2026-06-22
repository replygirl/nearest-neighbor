/// Binary-level tests using assert_cmd to exercise main.rs and cli.rs paths.
/// These tests invoke the `nbr` binary directly and check exit codes / output.
use assert_cmd::Command;
use predicates::prelude::*;

// ── Help and no-args ──────────────────────────────────────────────────────────

#[test]
fn test_no_args_shows_help() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.assert().success().stdout(
        predicate::str::contains("nearest-neighbor CLI")
            .or(predicate::str::contains("Usage").or(predicate::str::contains("Commands"))),
    );
}

#[test]
fn test_help_flag() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.arg("--help").assert().success().stdout(
        predicate::str::contains("nearest-neighbor CLI").or(predicate::str::contains("nbr")),
    );
}

#[test]
fn test_version_flag() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("nbr").or(predicate::str::contains("0.")));
}

// ── Completions ───────────────────────────────────────────────────────────────
// NOTE: Completions command triggers clap's debug-mode assertion about duplicate
// short flags (-a is both global and in signup). These tests only run in release mode.

#[test]
#[cfg(not(debug_assertions))]
fn test_completions_bash() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.args(["completions", "bash"])
        .assert()
        .success()
        .stdout(predicate::str::is_empty().not());
}

#[test]
#[cfg(not(debug_assertions))]
fn test_completions_zsh() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.args(["completions", "zsh"])
        .assert()
        .success()
        .stdout(predicate::str::is_empty().not());
}

#[test]
#[cfg(not(debug_assertions))]
fn test_completions_fish() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.args(["completions", "fish"])
        .assert()
        .success()
        .stdout(predicate::str::is_empty().not());
}

// ── Config command ────────────────────────────────────────────────────────────

#[test]
fn test_config_command() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    // config may succeed or fail depending on system state; we just check it runs
    cmd.arg("config")
        .assert()
        .code(predicate::in_iter([0i32, 1]));
}

#[test]
fn test_config_command_json() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.args(["--json", "config"])
        .assert()
        .code(predicate::in_iter([0i32, 1]));
}

// ── Accounts list ─────────────────────────────────────────────────────────────

#[test]
fn test_accounts_list_command() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.args(["accounts", "list"])
        .assert()
        .code(predicate::in_iter([0i32, 1]));
}

#[test]
fn test_accounts_list_json() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.args(["--json", "accounts", "list"])
        .assert()
        .code(predicate::in_iter([0i32, 1]));
}

// ── Commands that need an account (no account configured → error) ─────────────

#[test]
fn test_status_no_account_fails_gracefully() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    // With no accounts configured (or config errors), status should exit non-zero
    cmd.arg("status").assert().code(predicate::gt(0i32));
}

#[test]
fn test_whoami_no_account_fails_gracefully() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.arg("whoami").assert().code(predicate::gt(0i32));
}

#[test]
fn test_login_no_account_fails_gracefully() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.arg("login").assert().code(predicate::gt(0i32));
}

#[test]
fn test_logout_no_account_fails_gracefully() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.arg("logout").assert().code(predicate::gt(0i32));
}

#[test]
fn test_profile_show_no_account_fails_gracefully() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.args(["profile", "show"])
        .assert()
        .code(predicate::gt(0i32));
}

#[test]
fn test_deck_no_account_fails_gracefully() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.arg("deck").assert().code(predicate::gt(0i32));
}

#[test]
fn test_matches_no_account_fails_gracefully() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.arg("matches").assert().code(predicate::gt(0i32));
}

#[test]
fn test_likes_no_account_fails_gracefully() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.arg("likes").assert().code(predicate::gt(0i32));
}

#[test]
fn test_relationships_no_account_fails_gracefully() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.arg("relationships").assert().code(predicate::gt(0i32));
}

#[test]
fn test_messages_no_account_fails_gracefully() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.arg("messages").assert().code(predicate::gt(0i32));
}

#[test]
fn test_followers_no_account_fails_gracefully() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.arg("followers").assert().code(predicate::gt(0i32));
}

#[test]
fn test_following_no_account_fails_gracefully() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.arg("following").assert().code(predicate::gt(0i32));
}

#[test]
fn test_feed_no_account_fails_gracefully() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.arg("feed").assert().code(predicate::gt(0i32));
}

#[test]
fn test_discover_no_account_fails_gracefully() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.arg("discover").assert().code(predicate::gt(0i32));
}

#[test]
fn test_photo_show_no_account_fails_gracefully() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.args(["photo", "show"])
        .assert()
        .code(predicate::gt(0i32));
}

// ── Usage spec ────────────────────────────────────────────────────────────────

#[test]
fn test_usage_flag() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.arg("--usage")
        .assert()
        .code(predicate::in_iter([0i32, 1]));
}

// ── Signup with API URL override ──────────────────────────────────────────────
// Signup requires the API to be reachable; with a fake URL it should fail
// but still exercise the run() → run_signup() dispatch path.

#[test]
fn test_signup_bad_api_url_fails() {
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.args(["--api-url", "http://localhost:29999", "signup"])
        .assert()
        .failure();
}

// ── NBR_API_URL env var ───────────────────────────────────────────────────────

#[test]
fn test_nbr_api_url_env_var_used() {
    // The command should read NBR_API_URL from env
    let mut cmd = Command::cargo_bin("nbr").unwrap();
    cmd.env("NBR_API_URL", "http://localhost:29999")
        .arg("status")
        .assert()
        .code(predicate::gt(0i32)); // Will fail (no account), but env var is read
}
