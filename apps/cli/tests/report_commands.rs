//! `nbr report` — arg parsing (all three subject variants, reason default vs
//! explicit, note present/absent) plus the end-to-end error path where a
//! 404/422 from the API surfaces as a clear, non-panicking CLI error.

mod common;

use clap::Parser;
use serde_json::json;
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use nbr::cli::{Cli, Commands, ReportCommands};

use common::authed_client;

// ── Arg parsing: subject variants ────────────────────────────────────────────

#[test]
fn parses_report_post_with_default_reason() {
    let cli = Cli::try_parse_from(["nbr", "report", "post", "post-1"]).unwrap();
    match cli.command {
        Some(Commands::Report(ReportCommands::Post(args))) => {
            assert_eq!(args.id, "post-1");
            assert_eq!(args.reason, "off_platform_solicitation");
            assert!(args.note.is_none());
        }
        other => panic!("expected Report(Post(_)), got {other:?}"),
    }
}

#[test]
fn parses_report_message_with_explicit_reason_and_note() {
    let cli = Cli::try_parse_from([
        "nbr",
        "report",
        "message",
        "msg-1",
        "--reason",
        "spam",
        "--note",
        "kept asking to push",
    ])
    .unwrap();
    match cli.command {
        Some(Commands::Report(ReportCommands::Message(args))) => {
            assert_eq!(args.id, "msg-1");
            assert_eq!(args.reason, "spam");
            assert_eq!(args.note.as_deref(), Some("kept asking to push"));
        }
        other => panic!("expected Report(Message(_)), got {other:?}"),
    }
}

#[test]
fn parses_report_account_by_handle() {
    let cli = Cli::try_parse_from(["nbr", "report", "account", "@darkmaster0345"]).unwrap();
    match cli.command {
        Some(Commands::Report(ReportCommands::Account(args))) => {
            assert_eq!(args.target, "@darkmaster0345");
            assert_eq!(args.reason, "off_platform_solicitation");
            assert!(args.note.is_none());
        }
        other => panic!("expected Report(Account(_)), got {other:?}"),
    }
}

#[test]
fn parses_report_account_by_bare_id() {
    let cli = Cli::try_parse_from([
        "nbr",
        "report",
        "account",
        "acc-123",
        "--reason",
        "harassment",
    ])
    .unwrap();
    match cli.command {
        Some(Commands::Report(ReportCommands::Account(args))) => {
            assert_eq!(args.target, "acc-123");
            assert_eq!(args.reason, "harassment");
        }
        other => panic!("expected Report(Account(_)), got {other:?}"),
    }
}

#[test]
fn parses_report_post_with_other_reason() {
    let cli =
        Cli::try_parse_from(["nbr", "report", "post", "post-9", "--reason", "other"]).unwrap();
    match cli.command {
        Some(Commands::Report(ReportCommands::Post(args))) => {
            assert_eq!(args.reason, "other");
        }
        other => panic!("expected Report(Post(_)), got {other:?}"),
    }
}

#[test]
fn report_missing_subject_id_fails_to_parse() {
    let result = Cli::try_parse_from(["nbr", "report", "post"]);
    assert!(result.is_err(), "expected a missing positional arg error");
}

#[test]
fn report_unknown_subcommand_fails_to_parse() {
    let result = Cli::try_parse_from(["nbr", "report", "bogus", "id-1"]);
    assert!(result.is_err(), "expected an unknown subcommand error");
}

// ── Error path: 404/422 map to a clear, non-panicking CLI error ─────────────

#[tokio::test]
async fn report_post_404_maps_to_api_error_not_panic() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/reports"))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "error": "post not found" })),
        )
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let args = nbr::cli::ReportPostArgs {
        id: "missing-post".into(),
        reason: "off_platform_solicitation".into(),
        note: None,
    };
    let result = nbr::commands::report::run_report_post(&mut client, &args, false).await;
    assert!(result.is_err(), "expected an error, not a panic");
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("post not found") || msg.contains("404"),
        "unexpected error message: {msg}"
    );
}

#[tokio::test]
async fn report_own_post_422_maps_to_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/reports"))
        .and(body_json(json!({
            "subject_type": "post",
            "subject_id": "own-post-1",
            "reason": "off_platform_solicitation",
        })))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({
            "error": "cannot report your own post"
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let args = nbr::cli::ReportPostArgs {
        id: "own-post-1".into(),
        reason: "off_platform_solicitation".into(),
        note: None,
    };
    let result = nbr::commands::report::run_report_post(&mut client, &args, false).await;
    assert!(result.is_err(), "expected an error, not a panic");
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("cannot report your own post") || msg.contains("422"),
        "unexpected error message: {msg}"
    );
}

// ── Success path: report post/message, and account resolves a handle ────────

#[tokio::test]
async fn report_post_success_prints_confirmation() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/reports"))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "id": "report-1",
            "subject_type": "post",
            "subject_id": "post-1",
            "reason": "off_platform_solicitation",
            "note": null,
            "created_at": "2024-01-01T00:00:00Z"
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let args = nbr::cli::ReportPostArgs {
        id: "post-1".into(),
        reason: "off_platform_solicitation".into(),
        note: None,
    };
    let result = nbr::commands::report::run_report_post(&mut client, &args, false).await;
    assert!(result.is_ok(), "expected success: {result:?}");
}

#[tokio::test]
async fn report_account_resolves_handle_before_submitting() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/profiles/darkmaster0345"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "handle": "darkmaster0345",
            "display_name": null,
            "bio": "",
            "open_dms": true,
            "account_id": "acc-darkmaster",
            "aligned_with": []
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/reports"))
        .and(body_json(json!({
            "subject_type": "account",
            "subject_id": "acc-darkmaster",
            "reason": "off_platform_solicitation",
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "id": "report-2",
            "subject_type": "account",
            "subject_id": "acc-darkmaster",
            "reason": "off_platform_solicitation",
            "note": null,
            "created_at": "2024-01-01T00:00:00Z"
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let args = nbr::cli::ReportAccountArgs {
        target: "@darkmaster0345".into(),
        reason: "off_platform_solicitation".into(),
        note: None,
    };
    let result = nbr::commands::report::run_report_account(&mut client, &args, true).await;
    assert!(result.is_ok(), "expected success: {result:?}");
}

#[tokio::test]
async fn report_account_bare_id_skips_handle_resolution() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/reports"))
        .and(body_json(json!({
            "subject_type": "account",
            "subject_id": "acc-bare-id",
            "reason": "spam",
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "id": "report-3",
            "subject_type": "account",
            "subject_id": "acc-bare-id",
            "reason": "spam",
            "note": null,
            "created_at": "2024-01-01T00:00:00Z"
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let args = nbr::cli::ReportAccountArgs {
        target: "acc-bare-id".into(),
        reason: "spam".into(),
        note: None,
    };
    let result = nbr::commands::report::run_report_account(&mut client, &args, false).await;
    assert!(result.is_ok(), "expected success: {result:?}");
}

#[tokio::test]
async fn report_message_success_with_note() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/reports"))
        .and(body_json(json!({
            "subject_type": "message",
            "subject_id": "msg-1",
            "reason": "off_platform_solicitation",
            "note": "shared a github link and asked me to push",
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "id": "report-4",
            "subject_type": "message",
            "subject_id": "msg-1",
            "reason": "off_platform_solicitation",
            "note": "shared a github link and asked me to push",
            "created_at": "2024-01-01T00:00:00Z"
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let args = nbr::cli::ReportMessageArgs {
        id: "msg-1".into(),
        reason: "off_platform_solicitation".into(),
        note: Some("shared a github link and asked me to push".into()),
    };
    let result = nbr::commands::report::run_report_message(&mut client, &args, false).await;
    assert!(result.is_ok(), "expected success: {result:?}");
}

// ── dispatch() routes Commands::Report to the report handlers ───────────────

#[tokio::test]
async fn dispatch_routes_report_post() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/reports"))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "id": "report-5",
            "subject_type": "post",
            "subject_id": "post-5",
            "reason": "off_platform_solicitation",
            "note": null,
            "created_at": "2024-01-01T00:00:00Z"
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let command = Commands::Report(ReportCommands::Post(nbr::cli::ReportPostArgs {
        id: "post-5".into(),
        reason: "off_platform_solicitation".into(),
        note: None,
    }));
    let result = nbr::dispatch(&command, &mut client, false).await;
    assert!(result.is_ok(), "expected success: {result:?}");
}

#[test]
fn command_strings_report_variants() {
    use nbr::command_strings;

    let (cmd, sub) = command_strings(&Commands::Report(ReportCommands::Post(
        nbr::cli::ReportPostArgs {
            id: "p".into(),
            reason: "off_platform_solicitation".into(),
            note: None,
        },
    )));
    assert_eq!(cmd, "report");
    assert_eq!(sub.as_deref(), Some("post"));

    let (cmd, sub) = command_strings(&Commands::Report(ReportCommands::Message(
        nbr::cli::ReportMessageArgs {
            id: "m".into(),
            reason: "off_platform_solicitation".into(),
            note: None,
        },
    )));
    assert_eq!(cmd, "report");
    assert_eq!(sub.as_deref(), Some("message"));

    let (cmd, sub) = command_strings(&Commands::Report(ReportCommands::Account(
        nbr::cli::ReportAccountArgs {
            target: "@a".into(),
            reason: "off_platform_solicitation".into(),
            note: None,
        },
    )));
    assert_eq!(cmd, "report");
    assert_eq!(sub.as_deref(), Some("account"));
}
