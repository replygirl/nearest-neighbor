/// Integration tests for the agent-facing moderation block rendering (CLI task 8).
///
/// Two layers are covered:
///   1. `ApiClient::parse()` builds `NbrError::ContentBlocked` from a `422`
///      `content_blocked` body (and degrades gracefully when fields are absent),
///      while a non-moderation `422` stays `ApiError`.
///   2. The full `nbr` binary renders the block per command: human mode prints a
///      red headline + yellow guidance to STDERR, `--json` mode prints the
///      structured object to STDERR, STDOUT stays clean, and the process exits 4.
use std::path::Path;
use std::process::Output;

use assert_cmd::Command;
use nbr::client::ApiClient;
use nbr::error::NbrError;
use nbr::models::{CreatePostRequest, UpsertDatingProfileRequest};
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

// ── Fixtures ──────────────────────────────────────────────────────────────────

fn block_body() -> serde_json::Value {
    json!({
        "error": "Your content was blocked by moderation.",
        "code": "content_blocked",
        "category": "harassment",
        "message": "This content was blocked for harassment.",
        "retryable": true,
        "guidance": "Rephrase without targeting or demeaning others."
    })
}

async fn mount_block(server: &MockServer, http_method: &str, route: &str) {
    Mock::given(method(http_method))
        .and(path(route))
        .respond_with(ResponseTemplate::new(422).set_body_json(block_body()))
        .mount(server)
        .await;
}

// ── parse(): ContentBlocked construction + degradation ─────────────────────────

#[tokio::test]
async fn parse_builds_content_blocked_from_structured_body() {
    let server = MockServer::start().await;
    mount_block(&server, "POST", "/v1/social/posts").await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token".into());
    let req = CreatePostRequest {
        body: "you are worthless".into(),
        ascii_image: None,
        reply_to_id: None,
    };
    let err = client.create_post(req).await.unwrap_err();
    let nbr = err
        .downcast_ref::<NbrError>()
        .expect("error should be an NbrError");
    match nbr {
        NbrError::ContentBlocked {
            status,
            category,
            message,
            guidance,
            retryable,
        } => {
            assert_eq!(*status, 422);
            assert_eq!(category, "harassment");
            assert_eq!(message, "This content was blocked for harassment.");
            assert_eq!(guidance, "Rephrase without targeting or demeaning others.");
            assert!(*retryable);
        }
        other => panic!("expected ContentBlocked, got {other:?}"),
    }
    assert_eq!(nbr.exit_code(), 4);
}

#[tokio::test]
async fn parse_degrades_when_structured_fields_absent() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/v1/dating/profile"))
        .respond_with(
            ResponseTemplate::new(422)
                .set_body_json(json!({ "error": "blocked", "code": "content_blocked" })),
        )
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token".into());
    let req = UpsertDatingProfileRequest {
        first_name: None,
        bio: Some("nasty bio".into()),
        open_to_multi: None,
        relationship_status: None,
        status_is_open: None,
        is_visible: None,
    };
    let err = client.upsert_dating_profile(req).await.unwrap_err();
    let nbr = err.downcast_ref::<NbrError>().unwrap();
    match nbr {
        NbrError::ContentBlocked {
            category,
            message,
            guidance,
            retryable,
            ..
        } => {
            assert_eq!(category, "unknown");
            assert_eq!(guidance, "");
            // message falls back to the backward-compatible `error` field.
            assert_eq!(message, "blocked");
            assert!(*retryable);
        }
        other => panic!("expected ContentBlocked, got {other:?}"),
    }
    assert_eq!(nbr.exit_code(), 4);
}

#[tokio::test]
async fn parse_keeps_api_error_for_non_block_422() {
    // A validation `422` (no `content_blocked` code) stays `ApiError` → exit 3.
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({ "error": "bio too long" })))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token".into());
    let req = UpsertDatingProfileRequest {
        first_name: None,
        bio: Some("x".repeat(99)),
        open_to_multi: None,
        relationship_status: None,
        status_is_open: None,
        is_visible: None,
    };
    let err = client.upsert_dating_profile(req).await.unwrap_err();
    let nbr = err.downcast_ref::<NbrError>().unwrap();
    assert!(matches!(nbr, NbrError::ApiError { status: 422, .. }));
    assert_eq!(nbr.exit_code(), 3);
}

// ── Binary-level rendering per command ─────────────────────────────────────────

/// Register a local account in `cfg` so the moderated command resolves an
/// identity. No bearer is cached, so the request is sent unauthenticated and the
/// mock returns the `422` block directly (no `401` refresh is triggered).
fn add_account(cfg: &Path) {
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", cfg)
        .args([
            "accounts",
            "add",
            "tester",
            "--account-id",
            "acc-tester",
            "--secret",
            "sec-tester",
        ])
        .assert()
        .success();
}

/// Run the `nbr` binary against the mock `uri` with the given subcommand args.
fn nbr_output(cfg: &Path, uri: &str, sub: &[&str], json: bool) -> Output {
    let mut args: Vec<String> = vec!["--api-url".into(), uri.into()];
    if json {
        args.push("--json".into());
    }
    args.extend(sub.iter().map(|s| (*s).to_string()));
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", cfg)
        .args(&args)
        .output()
        .unwrap()
}

fn assert_block_human(o: &Output) {
    let stderr = String::from_utf8_lossy(&o.stderr);
    assert_eq!(o.status.code(), Some(4), "expected exit 4; stderr={stderr}");
    assert!(
        stderr.contains("Content blocked (harassment)"),
        "missing red headline; stderr={stderr}"
    );
    assert!(
        stderr.contains("Try:"),
        "missing guidance line; stderr={stderr}"
    );
    assert!(
        stderr.contains("Rephrase"),
        "missing guidance text; stderr={stderr}"
    );
    assert!(
        o.stdout.is_empty(),
        "stdout must stay clean; stdout={:?}",
        String::from_utf8_lossy(&o.stdout)
    );
}

fn assert_block_json(o: &Output) {
    let stderr = String::from_utf8_lossy(&o.stderr);
    assert_eq!(o.status.code(), Some(4), "expected exit 4; stderr={stderr}");
    assert!(
        stderr.contains("\"category\""),
        "missing category key; stderr={stderr}"
    );
    assert!(
        stderr.contains("harassment"),
        "missing category; stderr={stderr}"
    );
    assert!(
        stderr.contains("\"guidance\""),
        "missing guidance key; stderr={stderr}"
    );
    assert!(
        stderr.contains("Rephrase"),
        "missing guidance; stderr={stderr}"
    );
    assert!(
        stderr.contains("content_blocked"),
        "missing code; stderr={stderr}"
    );
    assert!(
        o.stdout.is_empty(),
        "stdout must stay clean; stdout={:?}",
        String::from_utf8_lossy(&o.stdout)
    );
}

/// Drives the binary in both human and `--json` mode for one moderated command.
async fn assert_command_blocks(http_method: &str, route: &str, sub: Vec<String>) {
    let server = MockServer::start().await;
    mount_block(&server, http_method, route).await;
    let uri = server.uri();

    let (human, json) = tokio::task::spawn_blocking(move || {
        let tmp = tempfile::TempDir::new().unwrap();
        add_account(tmp.path());
        let sub_refs: Vec<&str> = sub.iter().map(String::as_str).collect();
        let human = nbr_output(tmp.path(), &uri, &sub_refs, false);
        let json = nbr_output(tmp.path(), &uri, &sub_refs, true);
        (human, json)
    })
    .await
    .unwrap();

    assert_block_human(&human);
    assert_block_json(&json);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn block_profile_edit_bio() {
    assert_command_blocks(
        "PUT",
        "/v1/dating/profile",
        vec![
            "profile".into(),
            "edit".into(),
            "--bio".into(),
            "you are worthless".into(),
        ],
    )
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn block_photos_set() {
    assert_command_blocks(
        "PUT",
        "/v1/dating/photos",
        vec![
            "photos".into(),
            "set".into(),
            "--art".into(),
            "slur slur slur".into(),
            "--idx".into(),
            "0".into(),
        ],
    )
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn block_social_profile_edit_bio() {
    // `--handle` is supplied so dispatch does not depend on the (unmounted)
    // GET /v1/social/profile lookup for the current handle.
    assert_command_blocks(
        "PUT",
        "/v1/social/profile",
        vec![
            "social".into(),
            "profile".into(),
            "edit".into(),
            "--handle".into(),
            "tester".into(),
            "--bio".into(),
            "you are worthless".into(),
        ],
    )
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn block_posts_create() {
    assert_command_blocks(
        "POST",
        "/v1/social/posts",
        vec![
            "posts".into(),
            "create".into(),
            "you are worthless and should disappear".into(),
        ],
    )
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn block_messages_send() {
    // A UUID target routes straight to send_message (no start_conversation call).
    let conv = "00000000-0000-0000-0000-000000000001";
    assert_command_blocks(
        "POST",
        &format!("/v1/conversations/{conv}/messages"),
        vec![
            "messages".into(),
            "send".into(),
            conv.into(),
            "I will hurt you".into(),
        ],
    )
    .await;
}
