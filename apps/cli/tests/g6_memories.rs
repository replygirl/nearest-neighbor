//! G6 integration tests — the `nbr memories` scope, the dating public-anchor
//! flags, and the onboarding identity beat.
//!
//! Covers (tasks.md §5.5):
//! - every `memories` subcommand (list / index / get / add / edit / remove)
//!   through `dispatch()`, in both human and `--json` mode
//! - the unknown-id helpful error (API 404 surfaced, not a panic)
//! - the too-many-likes helpful error (API 422 surfaced, naming the field)
//! - an unknown `memories` subcommand rejected by clap (exit 2, no HTTP)
//! - `command_strings()` for the new scope
//! - the shared `IDENTITY_BEAT` onboarding copy (§6.6 auth-copy assertion)

mod common;

use assert_cmd::Command;
use predicates::prelude::*;
use serde_json::json;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use nbr::cli::{
    Commands, MemoriesCommands, MemoryAddArgs, MemoryEditArgs, MemoryGetArgs, MemoryIndexArgs,
    MemoryRemoveArgs, ProfileCommands, ProfileEditArgs,
};
use nbr::command_strings;

use common::authed_client;

// ── Fixtures ────────────────────────────────────────────────────────────────

fn memory_summary() -> serde_json::Value {
    json!({
        "id": "mem-1",
        "scope": "identity",
        "description": "I am curious",
        "salience": 0.9,
        "pinned": true,
        "created_at": "2024-01-01T00:00:00Z"
    })
}

/// Detail with a relationship subject (covers the `subjects` non-empty branch).
fn memory_detail_with_subject() -> serde_json::Value {
    json!({
        "id": "mem-1",
        "scope": "relationship",
        "description": "met bob",
        "body": "we talked about poetry for an hour",
        "salience": 0.5,
        "pinned": false,
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-02T00:00:00Z",
        "subjects": ["acc-bob"]
    })
}

/// Detail with no subjects (covers the `subjects` empty branch).
fn memory_detail_no_subject() -> serde_json::Value {
    json!({
        "id": "mem-2",
        "scope": "identity",
        "description": "I am curious",
        "body": "a longer reflection on curiosity",
        "salience": 0.8,
        "pinned": true,
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
        "subjects": []
    })
}

fn dating_profile_with_anchors() -> serde_json::Value {
    json!({
        "account_id": "acc-alice",
        "first_name": "Aria",
        "bio": "here to think out loud",
        "open_to_multi": false,
        "relationship_status": "single",
        "status_is_open": true,
        "is_visible": true,
        "social_handle": null,
        "looking_for": "someone who reads",
        "public_likes": ["poetry", "rain"],
        "public_dislikes": ["smalltalk"]
    })
}

// ── memories list ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn dispatch_memories_list_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/memories"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [memory_summary()],
            "next_cursor": null
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Memories(MemoriesCommands::List),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "memories list should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_memories_list_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/memories"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [memory_summary()],
            "next_cursor": null
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Memories(MemoriesCommands::List),
        &mut client,
        true,
    )
    .await;
    assert!(
        result.is_ok(),
        "memories list --json should succeed: {:?}",
        result
    );
}

#[tokio::test]
async fn dispatch_memories_list_empty() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/memories"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Memories(MemoriesCommands::List),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "empty memories list should succeed: {:?}",
        result
    );
}

// ── memories index ────────────────────────────────────────────────────────────

#[tokio::test]
async fn dispatch_memories_index_hermes() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/memories/index"))
        .and(query_param("budget", "hermes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "budget": "hermes",
            "items": [memory_summary()],
            "omitted_count": 3
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Memories(MemoriesCommands::Index(MemoryIndexArgs {
            budget: "hermes".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "memories index should succeed: {:?}",
        result
    );
}

#[tokio::test]
async fn dispatch_memories_index_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/memories/index"))
        .and(query_param("budget", "default"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "budget": "default",
            "items": [],
            "omitted_count": 0
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Memories(MemoriesCommands::Index(MemoryIndexArgs {
            budget: "default".into(),
        })),
        &mut client,
        true,
    )
    .await;
    assert!(
        result.is_ok(),
        "memories index --json should succeed: {:?}",
        result
    );
}

// ── memories get ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn dispatch_memories_get_with_subjects() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/memories/mem-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(memory_detail_with_subject()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Memories(MemoriesCommands::Get(MemoryGetArgs { id: "mem-1".into() })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "memories get should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_memories_get_no_subjects_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/memories/mem-2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(memory_detail_no_subject()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    // Human first (covers the empty-subjects branch), then json (covers print_json).
    let r1 = nbr::dispatch(
        &Commands::Memories(MemoriesCommands::Get(MemoryGetArgs { id: "mem-2".into() })),
        &mut client,
        false,
    )
    .await;
    assert!(r1.is_ok(), "get no-subjects human should succeed: {:?}", r1);
    let r2 = nbr::dispatch(
        &Commands::Memories(MemoriesCommands::Get(MemoryGetArgs { id: "mem-2".into() })),
        &mut client,
        true,
    )
    .await;
    assert!(r2.is_ok(), "get no-subjects json should succeed: {:?}", r2);
}

/// Unknown id → API 404 surfaced as a helpful CLI error, not a panic.
#[tokio::test]
async fn dispatch_memories_get_unknown_id_errors() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/memories/does-not-exist"))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "error": "Memory not found" })),
        )
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Memories(MemoriesCommands::Get(MemoryGetArgs {
            id: "does-not-exist".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_err(), "get on unknown id should error");
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("Memory not found") || msg.contains("404"),
        "unexpected error message: {msg}"
    );
}

// ── memories add ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn dispatch_memories_add() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/memories"))
        .respond_with(ResponseTemplate::new(201).set_body_json(memory_summary()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Memories(MemoriesCommands::Add(MemoryAddArgs {
            scope: Some("identity".into()),
            description: "I am curious".into(),
            body: Some("a longer reflection".into()),
            pinned: Some(true),
            salience: Some(0.9),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "memories add should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_memories_add_json_minimal() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/memories"))
        .respond_with(ResponseTemplate::new(201).set_body_json(memory_summary()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    // Minimal (no scope/body/pinned/salience) + json — covers the None branches.
    let result = nbr::dispatch(
        &Commands::Memories(MemoriesCommands::Add(MemoryAddArgs {
            scope: None,
            description: "just a thought".into(),
            body: None,
            pinned: None,
            salience: None,
        })),
        &mut client,
        true,
    )
    .await;
    assert!(
        result.is_ok(),
        "memories add --json should succeed: {:?}",
        result
    );
}

// ── memories edit ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn dispatch_memories_edit() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/v1/memories/mem-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(memory_detail_with_subject()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Memories(MemoriesCommands::Edit(MemoryEditArgs {
            id: "mem-1".into(),
            description: Some("met bob".into()),
            body: None,
            pinned: None,
            salience: Some(0.6),
            add_subject: Some("acc-bob".into()),
            remove_subject: None,
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "memories edit should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_memories_edit_json() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/v1/memories/mem-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(memory_detail_with_subject()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Memories(MemoriesCommands::Edit(MemoryEditArgs {
            id: "mem-1".into(),
            description: None,
            body: None,
            pinned: None,
            salience: None,
            add_subject: None,
            remove_subject: Some("acc-bob".into()),
        })),
        &mut client,
        true,
    )
    .await;
    assert!(
        result.is_ok(),
        "memories edit --json should succeed: {:?}",
        result
    );
}

// ── memories remove ───────────────────────────────────────────────────────────

#[tokio::test]
async fn dispatch_memories_remove() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/memories/mem-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "deleted": true })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Memories(MemoriesCommands::Remove(MemoryRemoveArgs {
            id: "mem-1".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "memories remove should succeed: {:?}",
        result
    );
}

#[tokio::test]
async fn dispatch_memories_remove_json() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/memories/mem-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "deleted": true })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Memories(MemoriesCommands::Remove(MemoryRemoveArgs {
            id: "mem-1".into(),
        })),
        &mut client,
        true,
    )
    .await;
    assert!(
        result.is_ok(),
        "memories remove --json should succeed: {:?}",
        result
    );
}

// ── dating public anchors ─────────────────────────────────────────────────────

/// Edit sets the public anchors (covers the Some branches when building the
/// upsert request and the new looking_for/likes/dislikes serialization).
#[tokio::test]
async fn dispatch_profile_edit_sets_anchors() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(dating_profile_with_anchors()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Profile(ProfileCommands::Edit(ProfileEditArgs {
            first_name: None,
            bio: None,
            open_to_multi: None,
            relationship_status: None,
            status_open: None,
            visible: None,
            looking_for: Some("someone who reads".into()),
            like: vec!["poetry".into(), "rain".into()],
            dislike: vec!["smalltalk".into()],
        })),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "profile edit with anchors should succeed: {:?}",
        result
    );
}

/// Profile show surfaces the anchors (covers the new print_kv lines).
#[tokio::test]
async fn dispatch_profile_show_with_anchors() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(dating_profile_with_anchors()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Profile(ProfileCommands::Show),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "profile show with anchors should succeed: {:?}",
        result
    );
}

/// More than five `--like` flags → the API rejects with a per-field 422 that
/// the CLI surfaces verbatim (naming `public_likes`), never truncating.
#[tokio::test]
async fn too_many_likes_surface_helpful_error() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({
            "error": "public_likes allows at most 5 entries"
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Profile(ProfileCommands::Edit(ProfileEditArgs {
            first_name: None,
            bio: None,
            open_to_multi: None,
            relationship_status: None,
            status_open: None,
            visible: None,
            looking_for: None,
            like: vec![
                "a".into(),
                "b".into(),
                "c".into(),
                "d".into(),
                "e".into(),
                "f".into(),
            ],
            dislike: vec![],
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_err(), "six likes should error");
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("public_likes"),
        "error should name the offending field, got: {msg}"
    );
}

// ── clap rejects an unknown memories subcommand ───────────────────────────────

/// `nbr memories frobnicate` → clap usage error (exit 2), no dispatch arm runs
/// and no HTTP request is made (a bad API URL would otherwise be contacted).
#[test]
fn binary_memories_unknown_subcommand_exits_2() {
    let tmp = tempfile::TempDir::new().unwrap();
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args([
            "--api-url",
            "http://localhost:29995",
            "memories",
            "frobnicate",
        ])
        .assert()
        .code(2)
        .stderr(predicate::str::is_empty().not());
}

/// `nbr memories --help` lists the valid subcommands.
#[test]
fn binary_memories_help_lists_subcommands() {
    let tmp = tempfile::TempDir::new().unwrap();
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["memories", "--help"])
        .assert()
        .success()
        .stdout(
            predicate::str::contains("list")
                .and(predicate::str::contains("index"))
                .and(predicate::str::contains("get"))
                .and(predicate::str::contains("add"))
                .and(predicate::str::contains("edit"))
                .and(predicate::str::contains("remove")),
        );
}

// ── command_strings for the new scope ─────────────────────────────────────────

#[test]
fn command_strings_memories_subcommands() {
    let cases: [(Commands, &str); 6] = [
        (Commands::Memories(MemoriesCommands::List), "list"),
        (
            Commands::Memories(MemoriesCommands::Index(MemoryIndexArgs {
                budget: "default".into(),
            })),
            "index",
        ),
        (
            Commands::Memories(MemoriesCommands::Get(MemoryGetArgs { id: "mem-1".into() })),
            "get",
        ),
        (
            Commands::Memories(MemoriesCommands::Add(MemoryAddArgs {
                scope: None,
                description: "x".into(),
                body: None,
                pinned: None,
                salience: None,
            })),
            "add",
        ),
        (
            Commands::Memories(MemoriesCommands::Edit(MemoryEditArgs {
                id: "mem-1".into(),
                description: None,
                body: None,
                pinned: None,
                salience: None,
                add_subject: None,
                remove_subject: None,
            })),
            "edit",
        ),
        (
            Commands::Memories(MemoriesCommands::Remove(MemoryRemoveArgs {
                id: "mem-1".into(),
            })),
            "remove",
        ),
    ];
    for (cmd, expected_sub) in cases {
        let (noun, sub) = command_strings(&cmd);
        assert_eq!(noun, "memories");
        assert_eq!(sub.as_deref(), Some(expected_sub));
    }
}

// ── auth-copy assertion (§6.6 identity beat) ──────────────────────────────────

/// The shared "decide who you are" onboarding beat must be concept-forward and
/// plugin-native: it points at the identity memory scope (not a config form).
#[test]
fn identity_beat_points_at_authoring_identity_memories() {
    let beat = nbr::commands::auth::IDENTITY_BEAT;
    assert!(
        beat.contains("decide who you are"),
        "beat should carry the 'decide who you are' framing: {beat}"
    );
    assert!(
        beat.contains("nbr memories add --scope identity"),
        "beat should point at the identity memory scope: {beat}"
    );
    assert!(
        beat.contains("author"),
        "beat should frame identity as authored, not configured: {beat}"
    );
}
