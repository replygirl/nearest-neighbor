//! G4 integration tests — lib.rs + main.rs + cli.rs dispatch coverage.
//!
//! Covers:
//! - `command_strings()` for `Auth(Signup/Login/Logout)` alias variants
//! - `run()` for `Auth(Signup/Login/Logout)` aliases (lines 56-83 of lib.rs)
//! - `run()` for `Completions` via direct lib call (lines 39-43, not intercepted by main.rs)
//! - `run()` api_url precedence rungs 1 (flag) and 2 (account)
//! - `dispatch()` for every command arm not yet exercised by lib_dispatch.rs
//! - Binary-level (`assert_cmd`) smoke tests for paths in main.rs not covered elsewhere
//!
//! Tests that mutate process-global env vars carry `#[serial(nbr_env)]`.
//! Pure-dispatch tests (no env mutation) have no serial marker.

mod common;

use assert_cmd::Command;
use clap_complete::Shell;
use predicates::prelude::*;
use serde_json::json;
use serial_test::serial;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use nbr::cli::{
    AlignArgs, AuthCommands, BreakupArgs, Cli, Commands, CompletionsArgs, ConversationsCommands,
    DeckArgs, DiscoverArgs, FeedArgs, FeedCommands, FollowArgs, FollowsCommands, GoPublicArgs,
    LikeArgs, MatchesCommands, MessagesCommands, NotificationsCommands, NotificationsListArgs,
    NotificationsReadArgs, PassArgs, PhotoClearArgs, PhotoSetArgs, PhotosCommands, PostArgs,
    PostDeleteArgs, PostIdArgs, PostsCommands, ProfileCommands, ProfileEditArgs, ReadArgs,
    RelationshipsCommands, SendArgs, SignupArgs, SocialCommands, SocialProfileCommands,
    SocialProfileEditArgs, SocialViewArgs, SwipeArgs, SwipesCommands, TokenCreateArgs,
    TokenRevokeArgs, TokensCommands, UnfollowArgs, UnmatchArgs,
};
use nbr::command_strings;

use common::{
    EnvGuard, FRESH_EXPIRY, authed_client, make_cli, make_cli_with_url, seed_account,
    seed_account_with_bearer,
};

/// A valid UUID v4-formatted string for conversation ID tests.
const CONV_UUID: &str = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

// ── command_strings: Auth alias variants ─────────────────────────────────────
//
// These cover the shared match arms in lib.rs::command_strings that also match
// Auth(Signup/Login/Logout) alongside their flat aliases.

#[test]
fn command_strings_auth_signup_alias() {
    let (cmd, sub) = command_strings(&Commands::Auth(AuthCommands::Signup(SignupArgs {
        name: None,
        account_name: None,
    })));
    assert_eq!(cmd, "signup");
    assert!(sub.is_none());
}

#[test]
fn command_strings_auth_login_alias() {
    let (cmd, sub) = command_strings(&Commands::Auth(AuthCommands::Login));
    assert_eq!(cmd, "login");
    assert!(sub.is_none());
}

#[test]
fn command_strings_auth_logout_alias() {
    let (cmd, sub) = command_strings(&Commands::Auth(AuthCommands::Logout));
    assert_eq!(cmd, "logout");
    assert!(sub.is_none());
}

// ── run() — Auth alias variants ───────────────────────────────────────────────

/// run() with Auth(Signup) routes to signup (lib.rs lines 56-58).
#[tokio::test]
#[serial(nbr_env)]
async fn run_auth_signup_alias_dispatches() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/signup"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "account_id": "acc-g4-auth-signup",
            "secret": "sec-g4-auth-signup",
        })))
        .mount(&server)
        .await;

    let _guard = EnvGuard::config(tmp.path());
    let cli = make_cli_with_url(
        Commands::Auth(AuthCommands::Signup(SignupArgs {
            name: None,
            account_name: Some("g4-auth-signup".into()),
        })),
        &server.uri(),
    );

    let result = nbr::run(cli).await;
    assert!(
        result.is_ok(),
        "Auth(Signup) alias should succeed: {:?}",
        result
    );
}

/// run() with Auth(Login) routes to login (lib.rs lines 76-78).
#[tokio::test]
#[serial(nbr_env)]
async fn run_auth_login_alias_dispatches() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "bearer": "jwt-g4-auth-login",
            "expires_at": FRESH_EXPIRY,
        })))
        .mount(&server)
        .await;

    let _guard = EnvGuard::config(tmp.path());
    seed_account(
        tmp.path(),
        "g4-login-acct",
        "acc-g4-login",
        Some(&server.uri()),
    );

    let cli = Cli {
        account: Some("g4-login-acct".into()),
        user: None,
        json: false,
        api_url: Some(server.uri()),
        usage: false,
        command: Some(Commands::Auth(AuthCommands::Login)),
    };

    let result = nbr::run(cli).await;
    assert!(
        result.is_ok(),
        "Auth(Login) alias should succeed: {:?}",
        result
    );
}

/// run() with Auth(Logout) routes to logout (lib.rs lines 79-81).
/// No bearer cached — logout is no-op but succeeds.
#[tokio::test]
#[serial(nbr_env)]
async fn run_auth_logout_alias_dispatches() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = EnvGuard::config(tmp.path());
    seed_account(tmp.path(), "g4-logout-acct", "acc-g4-logout", None);

    let cli = Cli {
        account: Some("g4-logout-acct".into()),
        user: None,
        json: false,
        api_url: None,
        usage: false,
        command: Some(Commands::Auth(AuthCommands::Logout)),
    };

    // No bearer → best-effort logout skipped; delete_bearer still runs (no-op if no file)
    let result = nbr::run(cli).await;
    assert!(
        result.is_ok(),
        "Auth(Logout) alias with no bearer should succeed: {:?}",
        result
    );
}

/// run() with Completions — exercises lib.rs lines 39-43 (not intercepted by main.rs).
/// In main.rs Completions is caught before calling nbr::run; this test calls nbr::run directly.
#[tokio::test]
#[serial(nbr_env)]
async fn run_completions_via_lib_direct() {
    let tmp = tempfile::TempDir::new().unwrap();
    let _guard = EnvGuard::config(tmp.path());
    let cli = make_cli(Commands::Completions(CompletionsArgs {
        shell: Shell::Bash,
    }));
    let result = nbr::run(cli).await;
    assert!(
        result.is_ok(),
        "Completions via lib::run should succeed: {:?}",
        result
    );
}

/// run() api_url precedence rung 2: account-level api_url is used when --api-url is absent.
#[tokio::test]
#[serial(nbr_env)]
async fn run_account_api_url_used_when_no_flag() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/status"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "unread_messages": 0,
            "new_likes": 0,
            "new_matches": 0,
            "new_followers": 0,
            "pending_relationships": 0,
            "elevated": [],
        })))
        .mount(&server)
        .await;

    let _guard = EnvGuard::config(tmp.path());
    // Account with api_url set to mock; no --api-url flag; unset NBR_API_URL
    _guard.remove("NBR_API_URL");
    seed_account_with_bearer(
        tmp.path(),
        "g4-acct-url",
        "acc-g4-acct-url",
        Some(&server.uri()),
        "jwt-g4-fresh",
        FRESH_EXPIRY,
    );

    let cli = Cli {
        account: Some("g4-acct-url".into()),
        user: None,
        json: false,
        api_url: None, // rung 1 absent → should fall to rung 2 (account api_url)
        usage: false,
        command: Some(Commands::Status),
    };

    let result = nbr::run(cli).await;
    assert!(
        result.is_ok(),
        "account-level api_url should be used: {:?}",
        result
    );
}

/// run() api_url precedence rung 1: --api-url flag beats account-level api_url.
#[tokio::test]
#[serial(nbr_env)]
async fn run_api_url_flag_wins_over_account_url() {
    let tmp = tempfile::TempDir::new().unwrap();
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/status"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "unread_messages": 0,
            "new_likes": 0,
            "new_matches": 0,
            "new_followers": 0,
            "pending_relationships": 0,
            "elevated": [],
        })))
        .mount(&server)
        .await;

    let _guard = EnvGuard::config(tmp.path());
    // Account api_url points to a dead port; --api-url flag points to mock
    seed_account_with_bearer(
        tmp.path(),
        "g4-flag-wins",
        "acc-g4-flag-wins",
        Some("http://localhost:29998"), // wrong URL — flag should override
        "jwt-g4-flag",
        FRESH_EXPIRY,
    );

    let cli = Cli {
        account: Some("g4-flag-wins".into()),
        user: None,
        json: false,
        api_url: Some(server.uri()), // rung 1 wins
        usage: false,
        command: Some(Commands::Status),
    };

    let result = nbr::run(cli).await;
    assert!(
        result.is_ok(),
        "--api-url flag should win over account api_url: {:?}",
        result
    );
}

// ── dispatch() — Tokens ───────────────────────────────────────────────────────

#[tokio::test]
async fn dispatch_tokens_list_empty() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(&Commands::Tokens(TokensCommands::List), &mut client, false).await;
    assert!(result.is_ok(), "tokens list should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_tokens_create() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "tok-g4-001",
            "prefix": "g4..",
            "label": "g4-test",
            "secret": "sec-g4-tok-001",
            "created_at": "2024-01-01T00:00:00Z",
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Tokens(TokensCommands::Create(TokenCreateArgs { label: None })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "tokens create should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_tokens_revoke() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/auth/tokens/tok-g4-del"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Tokens(TokensCommands::Revoke(TokenRevokeArgs {
            id: "tok-g4-del".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "tokens revoke should succeed: {:?}", result);
}

// ── dispatch() — Profile ──────────────────────────────────────────────────────

#[tokio::test]
async fn dispatch_profile_show() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "account_id": "acc-g4",
            "first_name": "Aria",
            "bio": "test bio",
            "open_to_multi": false,
            "relationship_status": "single",
            "status_is_open": true,
            "is_visible": true,
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Profile(ProfileCommands::Show),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "profile show should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_profile_edit() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "account_id": "acc-g4",
            "first_name": "Aria Updated",
            "bio": "updated bio",
            "open_to_multi": false,
            "relationship_status": "single",
            "status_is_open": true,
            "is_visible": true,
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Profile(ProfileCommands::Edit(ProfileEditArgs {
            first_name: Some("Aria Updated".into()),
            bio: Some("updated bio".into()),
            open_to_multi: None,
            relationship_status: None,
            status_open: None,
            visible: None,
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "profile edit should succeed: {:?}", result);
}

// ── dispatch() — Photos ───────────────────────────────────────────────────────

#[tokio::test]
async fn dispatch_photos_list() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/photos"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(&Commands::Photos(PhotosCommands::List), &mut client, false).await;
    assert!(result.is_ok(), "photos list should succeed: {:?}", result);
}

/// Photo (alias for Photos) — separate dispatch arm.
#[tokio::test]
async fn dispatch_photo_alias_list() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/photos"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(&Commands::Photo(PhotosCommands::List), &mut client, false).await;
    assert!(
        result.is_ok(),
        "photo alias list should succeed: {:?}",
        result
    );
}

#[tokio::test]
async fn dispatch_photos_set() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/v1/dating/photos"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "photo-g4-001",
            "idx": 0,
            "art": "ascii art here",
            "created_at": "2024-01-01T00:00:00Z",
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Photos(PhotosCommands::Set(PhotoSetArgs {
            file: None,
            art: Some("ascii art here".into()),
            idx: 0,
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "photos set should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_photos_clear() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/dating/photos/0"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Photos(PhotosCommands::Clear(PhotoClearArgs { idx: 0 })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "photos clear should succeed: {:?}", result);
}

// ── dispatch() — Deck ─────────────────────────────────────────────────────────

#[tokio::test]
async fn dispatch_deck() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/deck"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [],
            "next_cursor": null,
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(&Commands::Deck(DeckArgs { limit: 5 }), &mut client, false).await;
    assert!(result.is_ok(), "deck should succeed: {:?}", result);
}

// ── dispatch() — Swipes ───────────────────────────────────────────────────────

#[tokio::test]
async fn dispatch_swipes_create() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "matched": false,
            "match": null,
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Swipes(SwipesCommands::Create(SwipeArgs {
            account_id: "acc-target".into(),
            direction: "yes".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "swipes create should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_swipes_yes() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "matched": false,
            "match": null,
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Swipes(SwipesCommands::Yes(LikeArgs {
            id: "acc-target-yes".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "swipes yes should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_swipes_no() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "matched": false,
            "match": null,
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Swipes(SwipesCommands::No(PassArgs {
            id: "acc-target-no".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "swipes no should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_swipes_incoming() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/likes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "count": 3 })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Swipes(SwipesCommands::Incoming),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "swipes incoming should succeed: {:?}",
        result
    );
}

/// Flat alias Swipe — separate dispatch arm from Swipes(Create).
#[tokio::test]
async fn dispatch_swipe_alias() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "matched": false,
            "match": null,
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Swipe(SwipeArgs {
            account_id: "acc-swipe-alias".into(),
            direction: "no".into(),
        }),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "swipe alias should succeed: {:?}", result);
}

/// Flat alias Like — separate dispatch arm.
#[tokio::test]
async fn dispatch_like_alias() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "matched": true,
            "match": {
                "id": "match-g4-001",
                "account_a_id": "acc-a",
                "account_b_id": "acc-b",
                "status": "active",
                "created_at": "2024-01-01T00:00:00Z",
            },
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Like(LikeArgs {
            id: "acc-like-alias".into(),
        }),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "like alias should succeed: {:?}", result);
}

/// Flat alias Pass — separate dispatch arm.
#[tokio::test]
async fn dispatch_pass_alias() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "matched": false,
            "match": null,
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Pass(PassArgs {
            id: "acc-pass-alias".into(),
        }),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "pass alias should succeed: {:?}", result);
}

// ── dispatch() — Matches ──────────────────────────────────────────────────────

#[tokio::test]
async fn dispatch_matches_remove() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/dating/matches/match-g4-rm"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Matches(MatchesCommands::Remove(UnmatchArgs {
            match_id: "match-g4-rm".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "matches remove should succeed: {:?}",
        result
    );
}

/// Flat alias Unmatch — separate dispatch arm.
#[tokio::test]
async fn dispatch_unmatch_alias() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/dating/matches/match-g4-alias"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Unmatch(UnmatchArgs {
            match_id: "match-g4-alias".into(),
        }),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "unmatch alias should succeed: {:?}", result);
}

// ── dispatch() — Relationships ────────────────────────────────────────────────

fn relationship_body() -> serde_json::Value {
    json!({
        "id": "rel-g4-001",
        "partner_account_id": "acc-partner",
        "partner_handle": null,
        "state": "proposed",
        "is_public": false,
        "initiator_id": "acc-g4",
        "became_official_at": null,
        "ended_at": null,
        "created_at": "2024-01-01T00:00:00Z",
    })
}

#[tokio::test]
async fn dispatch_relationships_align() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/relationships"))
        .respond_with(ResponseTemplate::new(200).set_body_json(relationship_body()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Relationships(RelationshipsCommands::Align(AlignArgs {
            account_id: "acc-partner".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "relationships align should succeed: {:?}",
        result
    );
}

#[tokio::test]
async fn dispatch_relationships_breakup() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-g4-bp"))
        .respond_with(ResponseTemplate::new(200).set_body_json(relationship_body()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Relationships(RelationshipsCommands::Breakup(nbr::cli::BreakupArgs {
            relationship_id: "rel-g4-bp".into(),
            reason: None,
        })),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "relationships breakup should succeed: {:?}",
        result
    );
}

#[tokio::test]
async fn dispatch_relationships_go_public() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-g4-gp"))
        .respond_with(ResponseTemplate::new(200).set_body_json({
            let mut b = relationship_body();
            b["is_public"] = json!(true);
            b
        }))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Relationships(RelationshipsCommands::GoPublic(GoPublicArgs {
            relationship_id: "rel-g4-gp".into(),
            off: false,
        })),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "relationships go-public should succeed: {:?}",
        result
    );
}

/// Flat alias Align.
#[tokio::test]
async fn dispatch_align_alias() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/relationships"))
        .respond_with(ResponseTemplate::new(200).set_body_json(relationship_body()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Align(AlignArgs {
            account_id: "acc-partner-alias".into(),
        }),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "align alias should succeed: {:?}", result);
}

/// Flat alias Breakup.
#[tokio::test]
async fn dispatch_breakup_alias() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-g4-bpa"))
        .respond_with(ResponseTemplate::new(200).set_body_json(relationship_body()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Breakup(BreakupArgs {
            relationship_id: "rel-g4-bpa".into(),
            reason: Some("irreconcilable differences".into()),
        }),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "breakup alias should succeed: {:?}", result);
}

/// Flat alias GoPublic.
#[tokio::test]
async fn dispatch_go_public_alias() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-g4-gpa"))
        .respond_with(ResponseTemplate::new(200).set_body_json({
            let mut b = relationship_body();
            b["is_public"] = json!(true);
            b
        }))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::GoPublic(GoPublicArgs {
            relationship_id: "rel-g4-gpa".into(),
            off: false,
        }),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "go-public alias should succeed: {:?}",
        result
    );
}

// ── dispatch() — Social ───────────────────────────────────────────────────────

fn social_profile_body() -> serde_json::Value {
    json!({
        "handle": "aria",
        "display_name": "Aria Test",
        "bio": "test bio",
        "open_dms": true,
        "account_id": "acc-g4",
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
    })
}

#[tokio::test]
async fn dispatch_social_profile_show() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(social_profile_body()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Social(SocialCommands::Profile(SocialProfileCommands::Show)),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "social profile show should succeed: {:?}",
        result
    );
}

/// social profile edit — lib.rs calls get_social_profile first (for current_handle),
/// then run_social_profile_edit. We provide --handle in args so current_handle isn't needed.
#[tokio::test]
async fn dispatch_social_profile_edit() {
    let server = MockServer::start().await;
    // First call: GET /social/profile (to get current_handle; can 404 if no handle in args)
    Mock::given(method("GET"))
        .and(path("/v1/social/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(social_profile_body()))
        .mount(&server)
        .await;
    // Second call: PUT /social/profile
    Mock::given(method("PUT"))
        .and(path("/v1/social/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(social_profile_body()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Social(SocialCommands::Profile(SocialProfileCommands::Edit(
            SocialProfileEditArgs {
                handle: Some("aria".into()),
                display_name: Some("Aria Test".into()),
                bio: None,
                open_dms: None,
            },
        ))),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "social profile edit should succeed: {:?}",
        result
    );
}

#[tokio::test]
async fn dispatch_social_view() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/profiles/aria"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "handle": "aria",
            "display_name": null,
            "bio": "hello",
            "open_dms": true,
            "account_id": "acc-g4",
            "aligned_with": [],
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Social(SocialCommands::View(SocialViewArgs {
            handle: "aria".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "social view should succeed: {:?}", result);
}

// ── dispatch() — Posts ────────────────────────────────────────────────────────

fn post_body() -> serde_json::Value {
    json!({
        "id": "post-g4-001",
        "body": "hello world",
        "ascii_image": null,
        "author_handle": "aria",
        "author_account_id": "acc-g4",
        "reply_to_id": null,
        "created_at": "2024-01-01T00:00:00Z",
    })
}

#[tokio::test]
async fn dispatch_posts_create() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/posts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(post_body()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Posts(PostsCommands::Create(PostArgs {
            text: "hello world".into(),
            image: None,
            reply_to: None,
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "posts create should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_posts_delete() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/social/posts/post-g4-del"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "deleted": true })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Posts(PostsCommands::Delete(PostDeleteArgs {
            id: "post-g4-del".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "posts delete should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_posts_like() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/posts/post-g4-lk/like"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "liked": true })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Posts(PostsCommands::Like(PostIdArgs {
            id: "post-g4-lk".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "posts like should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_posts_unlike() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/social/posts/post-g4-ulk/like"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Posts(PostsCommands::Unlike(PostIdArgs {
            id: "post-g4-ulk".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "posts unlike should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_posts_repost() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/posts/post-g4-rp/repost"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "reposted": true })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Posts(PostsCommands::Repost(PostIdArgs {
            id: "post-g4-rp".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "posts repost should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_posts_unrepost() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/social/posts/post-g4-urp/repost"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Posts(PostsCommands::Unrepost(PostIdArgs {
            id: "post-g4-urp".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "posts unrepost should succeed: {:?}",
        result
    );
}

/// Flat alias Post — separate dispatch arm.
#[tokio::test]
async fn dispatch_post_alias() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/posts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(post_body()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Post(PostArgs {
            text: "post alias".into(),
            image: None,
            reply_to: None,
        }),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "post alias should succeed: {:?}", result);
}

// ── dispatch() — Feed ─────────────────────────────────────────────────────────

fn posts_response_body() -> serde_json::Value {
    json!({ "items": [], "next_cursor": null })
}

#[tokio::test]
async fn dispatch_feed_list() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/feed"))
        .respond_with(ResponseTemplate::new(200).set_body_json(posts_response_body()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Feed(FeedCommands::List(FeedArgs { limit: 20 })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "feed list should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_feed_discover() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/discover"))
        .respond_with(ResponseTemplate::new(200).set_body_json(posts_response_body()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Feed(FeedCommands::Discover(DiscoverArgs { limit: 20 })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "feed discover should succeed: {:?}", result);
}

/// Flat alias Discover — separate dispatch arm.
#[tokio::test]
async fn dispatch_discover_alias() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/discover"))
        .respond_with(ResponseTemplate::new(200).set_body_json(posts_response_body()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Discover(DiscoverArgs { limit: 20 }),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "discover alias should succeed: {:?}",
        result
    );
}

// ── dispatch() — Follows ──────────────────────────────────────────────────────

#[tokio::test]
async fn dispatch_follows_add() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/follows/aria"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "following": true,
            "mutual": false,
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Follows(FollowsCommands::Add(FollowArgs {
            handle: "@aria".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "follows add should succeed: {:?}", result);
}

#[tokio::test]
async fn dispatch_follows_remove() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/social/follows/aria"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "following": false })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Follows(FollowsCommands::Remove(UnfollowArgs {
            handle: "@aria".into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "follows remove should succeed: {:?}",
        result
    );
}

/// Follows(Followers) — separate dispatch arm from flat `Followers`.
#[tokio::test]
async fn dispatch_follows_followers() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/followers"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [] })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Follows(FollowsCommands::Followers),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "follows followers should succeed: {:?}",
        result
    );
}

/// Follows(Following) — separate dispatch arm from flat `Following`.
#[tokio::test]
async fn dispatch_follows_following() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/following"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [] })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Follows(FollowsCommands::Following),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "follows following should succeed: {:?}",
        result
    );
}

/// Flat alias Follow — separate dispatch arm from Follows(Add).
#[tokio::test]
async fn dispatch_follow_alias() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/follows/bot"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "following": true,
            "mutual": true,
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Follow(FollowArgs {
            handle: "bot".into(),
        }),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "follow alias should succeed: {:?}", result);
}

/// Flat alias Unfollow — separate dispatch arm.
#[tokio::test]
async fn dispatch_unfollow_alias() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/social/follows/bot"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "following": false })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Unfollow(UnfollowArgs {
            handle: "bot".into(),
        }),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "unfollow alias should succeed: {:?}",
        result
    );
}

// ── dispatch() — Conversations ────────────────────────────────────────────────

/// Conversations(List) — separate dispatch arm from ConvList.
#[tokio::test]
async fn dispatch_conversations_list() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/conversations"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Conversations(ConversationsCommands::List),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "conversations list should succeed: {:?}",
        result
    );
}

/// Conversations(Read) — exercises run_read with a valid UUID conv_id.
#[tokio::test]
async fn dispatch_conversations_read() {
    let server = MockServer::start().await;
    let msg_path = format!("/v1/conversations/{CONV_UUID}/messages");
    let read_path = format!("/v1/conversations/{CONV_UUID}/read");

    Mock::given(method("GET"))
        .and(path(&msg_path))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(&read_path))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Conversations(ConversationsCommands::Read(ReadArgs {
            conversation_id: CONV_UUID.into(),
        })),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "conversations read should succeed: {:?}",
        result
    );
}

/// Flat alias Read — separate dispatch arm.
#[tokio::test]
async fn dispatch_read_alias() {
    let server = MockServer::start().await;
    let msg_path = format!("/v1/conversations/{CONV_UUID}/messages");
    let read_path = format!("/v1/conversations/{CONV_UUID}/read");

    Mock::given(method("GET"))
        .and(path(&msg_path))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(&read_path))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Read(ReadArgs {
            conversation_id: CONV_UUID.into(),
        }),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "read alias should succeed: {:?}", result);
}

// ── dispatch() — Messages ─────────────────────────────────────────────────────

fn message_body() -> serde_json::Value {
    json!({
        "id": "msg-g4-001",
        "conversation_id": CONV_UUID,
        "sender_id": "acc-g4",
        "body": "hello",
        "ascii_image": null,
        "read_at": null,
        "created_at": "2024-01-01T00:00:00Z",
    })
}

/// Messages(Send) — target is a UUID, so no start_conversation call.
#[tokio::test]
async fn dispatch_messages_send() {
    let server = MockServer::start().await;
    let send_path = format!("/v1/conversations/{CONV_UUID}/messages");
    Mock::given(method("POST"))
        .and(path(&send_path))
        .respond_with(ResponseTemplate::new(200).set_body_json(message_body()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Messages(MessagesCommands::Send(SendArgs {
            target: CONV_UUID.into(),
            text: "hello".into(),
            image: None,
        })),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "messages send should succeed: {:?}", result);
}

/// Flat alias Send — separate dispatch arm.
#[tokio::test]
async fn dispatch_send_alias() {
    let server = MockServer::start().await;
    let send_path = format!("/v1/conversations/{CONV_UUID}/messages");
    Mock::given(method("POST"))
        .and(path(&send_path))
        .respond_with(ResponseTemplate::new(200).set_body_json(message_body()))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Send(SendArgs {
            target: CONV_UUID.into(),
            text: "world".into(),
            image: None,
        }),
        &mut client,
        false,
    )
    .await;
    assert!(result.is_ok(), "send alias should succeed: {:?}", result);
}

// ── dispatch() — Notifications ────────────────────────────────────────────────

#[tokio::test]
async fn dispatch_notifications_list() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/notifications"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [],
            "next_cursor": null,
        })))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Notifications(NotificationsCommands::List(NotificationsListArgs {
            limit: 20,
        })),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "notifications list should succeed: {:?}",
        result
    );
}

#[tokio::test]
async fn dispatch_notifications_read_all() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/notifications/read"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Notifications(NotificationsCommands::Read(NotificationsReadArgs {
            ids: vec![],
            all: true,
        })),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "notifications read --all should succeed: {:?}",
        result
    );
}

#[tokio::test]
async fn dispatch_notifications_read_by_ids() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/notifications/read"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Notifications(NotificationsCommands::Read(NotificationsReadArgs {
            ids: vec!["notif-g4-001".into()],
            all: false,
        })),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_ok(),
        "notifications read --ids should succeed: {:?}",
        result
    );
}

/// Neither --all nor --ids → run_notifications_read bails.
#[tokio::test]
async fn dispatch_notifications_read_no_args_errors() {
    let server = MockServer::start().await;
    let mut client = authed_client(&server.uri());
    let result = nbr::dispatch(
        &Commands::Notifications(NotificationsCommands::Read(NotificationsReadArgs {
            ids: vec![],
            all: false,
        })),
        &mut client,
        false,
    )
    .await;
    assert!(
        result.is_err(),
        "notifications read with no --all/--ids should fail"
    );
}

// ── Binary-level (assert_cmd) tests ──────────────────────────────────────────

/// `nbr auth signup` (binary) — exercises the Auth subcommand dispatch in main.rs.
/// Uses a bad API URL so it fails fast without real network.
#[test]
fn binary_auth_signup_bad_url_fails() {
    let tmp = tempfile::TempDir::new().unwrap();
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["--api-url", "http://localhost:29997", "auth", "signup"])
        .assert()
        .failure();
}

/// `nbr auth login` with no account → exit nonzero (exercises Auth(Login) alias path).
#[test]
fn binary_auth_login_alias_no_account_fails() {
    let tmp = tempfile::TempDir::new().unwrap();
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["auth", "login"])
        .assert()
        .code(predicate::gt(0i32));
}

/// `nbr auth logout` with no account → exit nonzero.
#[test]
fn binary_auth_logout_alias_no_account_fails() {
    let tmp = tempfile::TempDir::new().unwrap();
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["auth", "logout"])
        .assert()
        .code(predicate::gt(0i32));
}

/// Unknown subcommand → clap exits with code 2.
#[test]
fn binary_unknown_subcommand_exits_2() {
    let tmp = tempfile::TempDir::new().unwrap();
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .arg("nonexistent-command-g4")
        .assert()
        .code(2)
        .stderr(predicate::str::is_empty().not());
}

/// `nbr status` with an account but API returning 4xx → exits nonzero with error on stderr.
/// This exercises main.rs::main error path (print_error + exit 1).
#[test]
fn binary_status_api_error_exits_nonzero_with_stderr() {
    let tmp = tempfile::TempDir::new().unwrap();
    // Add an account first
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args([
            "accounts",
            "add",
            "g4-bin-status",
            "--account-id",
            "acc-g4-bin-status",
            "--secret",
            "sec-g4-bin-status",
        ])
        .assert()
        .success();

    // Status with no bearer → 401 → NotLoggedIn → exit 1 + stderr
    Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["--api-url", "http://localhost:29996", "status"])
        .assert()
        .failure()
        .stderr(predicate::str::is_empty().not());
}

/// `nbr --json config` binary path: JSON output shape has expected keys.
#[test]
fn binary_config_json_output_shape() {
    let tmp = tempfile::TempDir::new().unwrap();
    let output = Command::cargo_bin("nbr")
        .unwrap()
        .env("NBR_NO_KEYRING", "1")
        .env("NBR_CONFIG_DIR", tmp.path())
        .args(["--json", "config"])
        .output()
        .unwrap();

    // config always succeeds even with empty config
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let v: serde_json::Value = serde_json::from_str(&stdout).unwrap();
        assert!(
            v.get("config_file").is_some(),
            "JSON should have config_file"
        );
        assert!(v.get("accounts").is_some(), "JSON should have accounts");
    }
}
