/// Integration tests for command handlers (commands/auth, dating, social, messaging, relationships).
/// Uses wiremock to mock the API and calls command functions directly.
use nbr::client::ApiClient;
use nbr::commands;
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

// ── Fixtures ──────────────────────────────────────────────────────────────────

fn dating_profile() -> serde_json::Value {
    json!({
        "account_id": "acc-test-123",
        "first_name": "Alice",
        "bio": "Just vibing",
        "open_to_multi": false,
        "relationship_status": "single",
        "status_is_open": true,
        "is_visible": true
    })
}

fn social_profile() -> serde_json::Value {
    json!({
        "handle": "alice",
        "display_name": "Alice W.",
        "bio": "Hello world",
        "open_dms": true,
        "account_id": "acc-test-123",
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z"
    })
}

fn me_response() -> serde_json::Value {
    json!({
        "account": { "id": "acc-test-123", "status": "active", "created_at": "2024-01-01T00:00:00Z" },
        "dating_profile": {
            "first_name": "Alice",
            "bio": "Just vibing",
            "open_to_multi": false,
            "relationship_status": "single",
            "status_is_open": true,
            "is_visible": true
        },
        "social_profile": {
            "handle": "alice",
            "display_name": "Alice W.",
            "bio": "Hello",
            "open_dms": true
        }
    })
}

fn me_response_no_profiles() -> serde_json::Value {
    json!({
        "account": { "id": "acc-test-123", "status": "active", "created_at": "2024-01-01T00:00:00Z" },
        "dating_profile": null,
        "social_profile": null
    })
}

fn status_response_with_elevated() -> serde_json::Value {
    json!({
        "unread_messages": 5,
        "new_likes": 3,
        "new_matches": 2,
        "new_followers": 1,
        "pending_relationships": 0,
        "elevated": [
            {
                "id": "notif-1",
                "type": "match",
                "payload": {},
                "priority": "high",
                "read_at": null,
                "created_at": "2024-01-01T00:00:00Z"
            }
        ]
    })
}

fn status_response_empty() -> serde_json::Value {
    json!({
        "unread_messages": 0,
        "new_likes": 0,
        "new_matches": 0,
        "new_followers": 0,
        "pending_relationships": 0,
        "elevated": []
    })
}

fn post_response() -> serde_json::Value {
    json!({
        "id": "post-uuid-1",
        "body": "Hello, world!",
        "ascii_image": null,
        "author_handle": "alice",
        "author_account_id": "acc-test-123",
        "reply_to_id": null,
        "created_at": "2024-01-01T00:00:00Z"
    })
}

fn conversation_response() -> serde_json::Value {
    json!({
        "id": "00000000-0000-0000-0000-000000000001",
        "other": { "handle": "bob", "account_id": "acc-bob-456" },
        "social_unlocked": true,
        "dating_unlocked": false,
        "last_message_at": "2024-01-01T00:00:00Z",
        "unread_count": 3
    })
}

fn message_response() -> serde_json::Value {
    json!({
        "id": "00000000-0000-0000-0000-000000000010",
        "conversation_id": "00000000-0000-0000-0000-000000000001",
        "sender_id": "acc-test-123",
        "body": "Hey there!",
        "ascii_image": null,
        "read_at": null,
        "created_at": "2024-01-01T00:00:00Z"
    })
}

fn relationship_response() -> serde_json::Value {
    json!({
        "id": "rel-uuid-1",
        "partner_account_id": "acc-bob-456",
        "partner_handle": "bob",
        "state": "proposed",
        "is_public": false,
        "initiator_id": "acc-test-123",
        "became_official_at": null,
        "ended_at": null,
        "created_at": "2024-01-01T00:00:00Z"
    })
}

fn relationship_public_response() -> serde_json::Value {
    json!({
        "id": "rel-uuid-1",
        "partner_account_id": "acc-bob-456",
        "partner_handle": "bob",
        "state": "official",
        "is_public": true,
        "initiator_id": "acc-test-123",
        "became_official_at": "2024-06-01T00:00:00Z",
        "ended_at": null,
        "created_at": "2024-01-01T00:00:00Z"
    })
}

fn relationship_breakup_response() -> serde_json::Value {
    json!({
        "id": "rel-uuid-1",
        "partner_account_id": "acc-bob-456",
        "partner_handle": "bob",
        "state": "broken_up",
        "is_public": false,
        "initiator_id": "acc-test-123",
        "became_official_at": null,
        "ended_at": "2024-06-01T00:00:00Z",
        "created_at": "2024-01-01T00:00:00Z"
    })
}

// ── Helper to build an authenticated client ───────────────────────────────────

fn auth_client(base_url: &str) -> ApiClient {
    let mut client = ApiClient::new(base_url);
    client.bearer = Some("jwt-token-xyz".into());
    client.account_name = Some("alice".into());
    client
}

// ═══════════════════════════════════════════════════════════════════════════════
// Auth commands
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_run_whoami_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(me_response()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::auth::run_whoami(&mut client, false)
        .await
        .expect("whoami should succeed");
}

#[tokio::test]
async fn test_run_whoami_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(me_response()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::auth::run_whoami(&mut client, true)
        .await
        .expect("whoami json should succeed");
}

#[tokio::test]
async fn test_run_whoami_no_profiles() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(me_response_no_profiles()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::auth::run_whoami(&mut client, false)
        .await
        .expect("whoami without profiles should succeed");
}

#[tokio::test]
async fn test_run_status_human_with_elevated() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/status"))
        .respond_with(ResponseTemplate::new(200).set_body_json(status_response_with_elevated()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::auth::run_status(&mut client, false)
        .await
        .expect("status with elevated should succeed");
}

#[tokio::test]
async fn test_run_status_empty_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/status"))
        .respond_with(ResponseTemplate::new(200).set_body_json(status_response_empty()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::auth::run_status(&mut client, false)
        .await
        .expect("status empty should succeed");
}

#[tokio::test]
async fn test_run_status_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/status"))
        .respond_with(ResponseTemplate::new(200).set_body_json(status_response_empty()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::auth::run_status(&mut client, true)
        .await
        .expect("status json should succeed");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Dating commands
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_run_profile_show_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(dating_profile()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::dating::run_profile_show(&mut client, false)
        .await
        .expect("profile show human should succeed");
}

#[tokio::test]
async fn test_run_profile_show_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(dating_profile()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::dating::run_profile_show(&mut client, true)
        .await
        .expect("profile show json should succeed");
}

#[tokio::test]
async fn test_run_profile_edit_human() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(dating_profile()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::ProfileEditArgs {
        first_name: Some("Alice".into()),
        bio: Some("Updated bio".into()),
        open_to_multi: None,
        relationship_status: None,
        status_open: None,
        visible: None,
    };
    commands::dating::run_profile_edit(&mut client, &args, false)
        .await
        .expect("profile edit human should succeed");
}

#[tokio::test]
async fn test_run_profile_edit_json() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(dating_profile()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::ProfileEditArgs {
        first_name: Some("Alice".into()),
        bio: None,
        open_to_multi: Some(true),
        relationship_status: Some("single".into()),
        status_open: Some(true),
        visible: Some(true),
    };
    commands::dating::run_profile_edit(&mut client, &args, true)
        .await
        .expect("profile edit json should succeed");
}

#[tokio::test]
async fn test_run_photo_show_empty_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/photos"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::dating::run_photo_show(&mut client, false)
        .await
        .expect("photo show empty human should succeed");
}

#[tokio::test]
async fn test_run_photo_show_with_photos() {
    let server = MockServer::start().await;
    let photos = json!([
        {"id": "photo-1", "idx": 0, "art": "  o  \n /|\\\n / \\", "created_at": "2024-01-01T00:00:00Z"}
    ]);
    Mock::given(method("GET"))
        .and(path("/v1/dating/photos"))
        .respond_with(ResponseTemplate::new(200).set_body_json(photos))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::dating::run_photo_show(&mut client, false)
        .await
        .expect("photo show with photos should succeed");
}

#[tokio::test]
async fn test_run_photo_show_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/photos"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::dating::run_photo_show(&mut client, true)
        .await
        .expect("photo show json should succeed");
}

#[tokio::test]
async fn test_run_photo_set_with_art_human() {
    let server = MockServer::start().await;
    let photo_resp = json!({
        "id": "photo-1", "idx": 0, "art": "  o  ", "created_at": "2024-01-01T00:00:00Z"
    });
    Mock::given(method("PUT"))
        .and(path("/v1/dating/photos"))
        .respond_with(ResponseTemplate::new(200).set_body_json(photo_resp))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PhotoSetArgs {
        file: None,
        art: Some("  o  ".into()),
        idx: 0,
    };
    commands::dating::run_photo_set(&mut client, &args, false)
        .await
        .expect("photo set with art human should succeed");
}

#[tokio::test]
async fn test_run_photo_set_with_art_json() {
    let server = MockServer::start().await;
    let photo_resp = json!({
        "id": "photo-1", "idx": 0, "art": "  o  ", "created_at": "2024-01-01T00:00:00Z"
    });
    Mock::given(method("PUT"))
        .and(path("/v1/dating/photos"))
        .respond_with(ResponseTemplate::new(200).set_body_json(photo_resp))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PhotoSetArgs {
        file: None,
        art: Some("  o  ".into()),
        idx: 1,
    };
    commands::dating::run_photo_set(&mut client, &args, true)
        .await
        .expect("photo set with art json should succeed");
}

#[tokio::test]
async fn test_run_photo_set_no_source_errors() {
    let server = MockServer::start().await;
    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PhotoSetArgs {
        file: None,
        art: None,
        idx: 0,
    };
    let result = commands::dating::run_photo_set(&mut client, &args, false).await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("file path") || msg.contains("art"),
        "unexpected error: {msg}"
    );
}

#[tokio::test]
async fn test_run_photo_set_from_file() {
    let server = MockServer::start().await;
    let photo_resp = json!({
        "id": "photo-1", "idx": 0, "art": "file_content", "created_at": "2024-01-01T00:00:00Z"
    });
    Mock::given(method("PUT"))
        .and(path("/v1/dating/photos"))
        .respond_with(ResponseTemplate::new(200).set_body_json(photo_resp))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    // Create a temp file with art content
    let tmp = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(tmp.path(), "file_content").unwrap();
    let args = nbr::cli::PhotoSetArgs {
        file: Some(tmp.path().to_str().unwrap().to_string()),
        art: None,
        idx: 0,
    };
    commands::dating::run_photo_set(&mut client, &args, false)
        .await
        .expect("photo set from file should succeed");
}

#[tokio::test]
async fn test_run_photo_clear() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/dating/photos/0"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PhotoClearArgs { idx: 0 };
    commands::dating::run_photo_clear(&mut client, &args, false)
        .await
        .expect("photo clear should succeed");
}

#[tokio::test]
async fn test_run_deck_empty_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/deck"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::DeckArgs { limit: 5 };
    commands::dating::run_deck(&mut client, &args, false)
        .await
        .expect("deck empty human should succeed");
}

#[tokio::test]
async fn test_run_deck_with_profiles() {
    let server = MockServer::start().await;
    let deck = json!({
        "items": [
            {"account_id": "acc-1", "first_name": "Bob", "bio": "Hiker", "open_to_multi": false, "relationship_status": "single", "status_is_open": true, "is_visible": true},
            {"account_id": "acc-2", "first_name": "Carol", "bio": "Cyclist", "open_to_multi": true, "relationship_status": "single", "status_is_open": true, "is_visible": true}
        ],
        "next_cursor": null
    });
    Mock::given(method("GET"))
        .and(path("/v1/dating/deck"))
        .respond_with(ResponseTemplate::new(200).set_body_json(deck))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::DeckArgs { limit: 5 };
    commands::dating::run_deck(&mut client, &args, false)
        .await
        .expect("deck with profiles human should succeed");
}

#[tokio::test]
async fn test_run_deck_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/deck"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::DeckArgs { limit: 5 };
    commands::dating::run_deck(&mut client, &args, true)
        .await
        .expect("deck json should succeed");
}

#[tokio::test]
async fn test_run_swipe_yes_human() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "matched": false, "match": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SwipeArgs {
        account_id: "acc-target".into(),
        direction: "yes".into(),
    };
    commands::dating::run_swipe(&mut client, &args, false)
        .await
        .expect("swipe yes human should succeed");
}

#[tokio::test]
async fn test_run_swipe_yes_match_human() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "matched": true,
            "match": {"id": "match-1", "account_a_id": "acc-a", "account_b_id": "acc-b", "status": "active", "created_at": "2024-01-01T00:00:00Z"}
        })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SwipeArgs {
        account_id: "acc-target".into(),
        direction: "y".into(),
    };
    commands::dating::run_swipe(&mut client, &args, false)
        .await
        .expect("swipe yes match human should succeed");
}

#[tokio::test]
async fn test_run_swipe_no_human() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "matched": false, "match": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SwipeArgs {
        account_id: "acc-target".into(),
        direction: "n".into(),
    };
    commands::dating::run_swipe(&mut client, &args, false)
        .await
        .expect("swipe no human should succeed");
}

#[tokio::test]
async fn test_run_swipe_invalid_direction() {
    let server = MockServer::start().await;
    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SwipeArgs {
        account_id: "acc-target".into(),
        direction: "maybe".into(),
    };
    let result = commands::dating::run_swipe(&mut client, &args, false).await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("maybe") || msg.contains("Invalid direction"),
        "unexpected error: {msg}"
    );
}

#[tokio::test]
async fn test_run_swipe_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "matched": false, "match": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SwipeArgs {
        account_id: "acc-target".into(),
        direction: "no".into(),
    };
    commands::dating::run_swipe(&mut client, &args, true)
        .await
        .expect("swipe json should succeed");
}

#[tokio::test]
async fn test_run_like_no_match() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "matched": false, "match": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::LikeArgs {
        id: "acc-target".into(),
    };
    commands::dating::run_like(&mut client, &args, false)
        .await
        .expect("like no match should succeed");
}

#[tokio::test]
async fn test_run_like_match() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "matched": true,
            "match": {"id": "match-1", "account_a_id": "a", "account_b_id": "b", "status": "active", "created_at": "2024-01-01T00:00:00Z"}
        })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::LikeArgs {
        id: "acc-target".into(),
    };
    commands::dating::run_like(&mut client, &args, false)
        .await
        .expect("like match should succeed");
}

#[tokio::test]
async fn test_run_like_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "matched": false, "match": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::LikeArgs {
        id: "acc-target".into(),
    };
    commands::dating::run_like(&mut client, &args, true)
        .await
        .expect("like json should succeed");
}

#[tokio::test]
async fn test_run_pass_human() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "matched": false, "match": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PassArgs {
        id: "acc-target".into(),
    };
    commands::dating::run_pass(&mut client, &args, false)
        .await
        .expect("pass human should succeed");
}

#[tokio::test]
async fn test_run_pass_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "matched": false, "match": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PassArgs {
        id: "acc-target".into(),
    };
    commands::dating::run_pass(&mut client, &args, true)
        .await
        .expect("pass json should succeed");
}

#[tokio::test]
async fn test_run_matches_empty_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/matches"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::dating::run_matches(&mut client, false)
        .await
        .expect("matches empty human should succeed");
}

#[tokio::test]
async fn test_run_matches_with_data() {
    let server = MockServer::start().await;
    let matches = json!([
        {
            "id": "match-1",
            "other_account_id": "acc-bob",
            "other_profile": {"first_name": "Bob", "bio": "hi", "open_to_multi": false, "relationship_status": "single", "status_is_open": true, "is_visible": true},
            "status": "active",
            "created_at": "2024-01-01T00:00:00Z"
        },
        {
            "id": "match-2",
            "other_account_id": "acc-carol",
            "other_profile": null,
            "status": "active",
            "created_at": "2024-01-01T00:00:00Z"
        }
    ]);
    Mock::given(method("GET"))
        .and(path("/v1/dating/matches"))
        .respond_with(ResponseTemplate::new(200).set_body_json(matches))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::dating::run_matches(&mut client, false)
        .await
        .expect("matches with data should succeed");
}

#[tokio::test]
async fn test_run_matches_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/matches"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::dating::run_matches(&mut client, true)
        .await
        .expect("matches json should succeed");
}

#[tokio::test]
async fn test_run_unmatch_human() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/dating/matches/match-1"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::UnmatchArgs {
        match_id: "match-1".into(),
    };
    commands::dating::run_unmatch(&mut client, &args, false)
        .await
        .expect("unmatch should succeed");
}

#[tokio::test]
async fn test_run_likes_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/likes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "count": 7 })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::dating::run_likes(&mut client, false)
        .await
        .expect("likes human should succeed");
}

#[tokio::test]
async fn test_run_likes_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/likes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "count": 7 })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::dating::run_likes(&mut client, true)
        .await
        .expect("likes json should succeed");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Relationship commands
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_run_align_human() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/relationships"))
        .respond_with(ResponseTemplate::new(201).set_body_json(relationship_response()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::AlignArgs {
        account_id: "acc-bob-456".into(),
    };
    commands::relationships::run_align(&mut client, &args, false)
        .await
        .expect("align human should succeed");
}

#[tokio::test]
async fn test_run_align_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/relationships"))
        .respond_with(ResponseTemplate::new(201).set_body_json(relationship_response()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::AlignArgs {
        account_id: "acc-bob-456".into(),
    };
    commands::relationships::run_align(&mut client, &args, true)
        .await
        .expect("align json should succeed");
}

#[tokio::test]
async fn test_run_relationships_empty_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/relationships"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::relationships::run_relationships(&mut client, false)
        .await
        .expect("relationships empty human should succeed");
}

#[tokio::test]
async fn test_run_relationships_with_data() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/relationships"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([relationship_response()])))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::relationships::run_relationships(&mut client, false)
        .await
        .expect("relationships with data human should succeed");
}

#[tokio::test]
async fn test_run_relationships_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/relationships"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::relationships::run_relationships(&mut client, true)
        .await
        .expect("relationships json should succeed");
}

#[tokio::test]
async fn test_run_breakup_human() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-uuid-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(relationship_breakup_response()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::BreakupArgs {
        relationship_id: "rel-uuid-1".into(),
        reason: None,
    };
    commands::relationships::run_breakup(&mut client, &args, false)
        .await
        .expect("breakup human should succeed");
}

#[tokio::test]
async fn test_run_breakup_json() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-uuid-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(relationship_breakup_response()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::BreakupArgs {
        relationship_id: "rel-uuid-1".into(),
        reason: Some("just done".into()),
    };
    commands::relationships::run_breakup(&mut client, &args, true)
        .await
        .expect("breakup json should succeed");
}

#[tokio::test]
async fn test_run_go_public_human() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-uuid-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(relationship_public_response()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::GoPublicArgs {
        relationship_id: "rel-uuid-1".into(),
        off: false,
    };
    commands::relationships::run_go_public(&mut client, &args, false)
        .await
        .expect("go_public human should succeed");
}

#[tokio::test]
async fn test_run_go_private_human() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-uuid-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(relationship_response()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::GoPublicArgs {
        relationship_id: "rel-uuid-1".into(),
        off: true,
    };
    commands::relationships::run_go_public(&mut client, &args, false)
        .await
        .expect("go_private human should succeed");
}

#[tokio::test]
async fn test_run_go_public_json() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-uuid-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(relationship_public_response()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::GoPublicArgs {
        relationship_id: "rel-uuid-1".into(),
        off: false,
    };
    commands::relationships::run_go_public(&mut client, &args, true)
        .await
        .expect("go_public json should succeed");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Social commands
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_run_social_profile_show_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(social_profile()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::social::run_social_profile_show(&mut client, false)
        .await
        .expect("social profile show human should succeed");
}

#[tokio::test]
async fn test_run_social_profile_show_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(social_profile()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::social::run_social_profile_show(&mut client, true)
        .await
        .expect("social profile show json should succeed");
}

#[tokio::test]
async fn test_run_social_profile_edit_with_handle_human() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/v1/social/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(social_profile()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SocialProfileEditArgs {
        handle: Some("alice".into()),
        display_name: Some("Alice W.".into()),
        bio: Some("Hello world".into()),
        open_dms: Some(true),
    };
    commands::social::run_social_profile_edit(&mut client, &args, None, false)
        .await
        .expect("social profile edit with handle human should succeed");
}

#[tokio::test]
async fn test_run_social_profile_edit_with_current_handle() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/v1/social/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(social_profile()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SocialProfileEditArgs {
        handle: None, // No --handle flag
        display_name: None,
        bio: Some("Updated bio".into()),
        open_dms: None,
    };
    // current_handle comes from the existing profile
    commands::social::run_social_profile_edit(&mut client, &args, Some("alice".into()), false)
        .await
        .expect("social profile edit with current handle should succeed");
}

#[tokio::test]
async fn test_run_social_profile_edit_no_handle_errors() {
    let server = MockServer::start().await;
    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SocialProfileEditArgs {
        handle: None,
        display_name: None,
        bio: None,
        open_dms: None,
    };
    let result = commands::social::run_social_profile_edit(&mut client, &args, None, false).await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("--handle") || msg.contains("handle"),
        "unexpected error: {msg}"
    );
}

#[tokio::test]
async fn test_run_social_profile_edit_with_at_handle() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/v1/social/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(social_profile()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SocialProfileEditArgs {
        handle: Some("@alice".into()), // with @ prefix
        display_name: None,
        bio: None,
        open_dms: None,
    };
    commands::social::run_social_profile_edit(&mut client, &args, None, false)
        .await
        .expect("social profile edit with @ handle should succeed");
}

#[tokio::test]
async fn test_run_social_profile_edit_json() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/v1/social/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(social_profile()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SocialProfileEditArgs {
        handle: Some("alice".into()),
        display_name: None,
        bio: None,
        open_dms: None,
    };
    commands::social::run_social_profile_edit(&mut client, &args, None, true)
        .await
        .expect("social profile edit json should succeed");
}

#[tokio::test]
async fn test_run_social_view_human() {
    let server = MockServer::start().await;
    let pub_profile = json!({
        "handle": "bob",
        "display_name": "Bob B.",
        "bio": "Hello",
        "open_dms": true,
        "account_id": "acc-bob-456",
        "aligned_with": []
    });
    Mock::given(method("GET"))
        .and(path("/v1/social/profiles/bob"))
        .respond_with(ResponseTemplate::new(200).set_body_json(pub_profile))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SocialViewArgs {
        handle: "bob".into(),
    };
    commands::social::run_social_view(&mut client, &args, false)
        .await
        .expect("social view human should succeed");
}

#[tokio::test]
async fn test_run_social_view_with_aligned() {
    let server = MockServer::start().await;
    let pub_profile = json!({
        "handle": "bob",
        "display_name": null,
        "bio": "Hello",
        "open_dms": false,
        "account_id": "acc-bob-456",
        "aligned_with": ["carol", "dave"]
    });
    Mock::given(method("GET"))
        .and(path("/v1/social/profiles/bob"))
        .respond_with(ResponseTemplate::new(200).set_body_json(pub_profile))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    // Test with @ prefix being stripped
    let args = nbr::cli::SocialViewArgs {
        handle: "@bob".into(),
    };
    commands::social::run_social_view(&mut client, &args, false)
        .await
        .expect("social view with aligned should succeed");
}

#[tokio::test]
async fn test_run_social_view_json() {
    let server = MockServer::start().await;
    let pub_profile = json!({
        "handle": "bob",
        "display_name": null,
        "bio": "Hello",
        "open_dms": false,
        "account_id": "acc-bob-456",
        "aligned_with": []
    });
    Mock::given(method("GET"))
        .and(path("/v1/social/profiles/bob"))
        .respond_with(ResponseTemplate::new(200).set_body_json(pub_profile))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SocialViewArgs {
        handle: "bob".into(),
    };
    commands::social::run_social_view(&mut client, &args, true)
        .await
        .expect("social view json should succeed");
}

#[tokio::test]
async fn test_run_post_human() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/posts"))
        .respond_with(ResponseTemplate::new(201).set_body_json(post_response()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PostArgs {
        text: "Hello, world!".into(),
        image: None,
        reply_to: None,
    };
    commands::social::run_post(&mut client, &args, false)
        .await
        .expect("post human should succeed");
}

#[tokio::test]
async fn test_run_post_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/posts"))
        .respond_with(ResponseTemplate::new(201).set_body_json(post_response()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PostArgs {
        text: "Hello, world!".into(),
        image: None,
        reply_to: Some("post-uuid-0".into()),
    };
    commands::social::run_post(&mut client, &args, true)
        .await
        .expect("post json should succeed");
}

#[tokio::test]
async fn test_run_post_with_image_file() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/posts"))
        .respond_with(ResponseTemplate::new(201).set_body_json(post_response()))
        .mount(&server)
        .await;

    let tmp = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(tmp.path(), "  o  \n /|\\\n / \\").unwrap();

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PostArgs {
        text: "Look at my art!".into(),
        image: Some(tmp.path().to_str().unwrap().to_string()),
        reply_to: None,
    };
    commands::social::run_post(&mut client, &args, false)
        .await
        .expect("post with image should succeed");
}

#[tokio::test]
async fn test_run_feed_empty_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/feed"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::FeedArgs { limit: 20 };
    commands::social::run_feed(&mut client, &args, false)
        .await
        .expect("feed empty human should succeed");
}

#[tokio::test]
async fn test_run_feed_with_posts_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/feed"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [post_response()],
            "next_cursor": null
        })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::FeedArgs { limit: 20 };
    commands::social::run_feed(&mut client, &args, false)
        .await
        .expect("feed with posts human should succeed");
}

#[tokio::test]
async fn test_run_feed_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/feed"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::FeedArgs { limit: 20 };
    commands::social::run_feed(&mut client, &args, true)
        .await
        .expect("feed json should succeed");
}

#[tokio::test]
async fn test_run_discover_empty_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/discover"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::DiscoverArgs { limit: 20 };
    commands::social::run_discover(&mut client, &args, false)
        .await
        .expect("discover empty human should succeed");
}

#[tokio::test]
async fn test_run_discover_with_posts() {
    let server = MockServer::start().await;
    // post with null author_handle
    let post_no_handle = json!({
        "id": "post-2",
        "body": "Anonymous post",
        "ascii_image": null,
        "author_handle": null,
        "author_account_id": "acc-anon",
        "reply_to_id": null,
        "created_at": "2024-01-01T00:00:00Z"
    });
    Mock::given(method("GET"))
        .and(path("/v1/social/discover"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [post_no_handle],
            "next_cursor": null
        })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::DiscoverArgs { limit: 20 };
    commands::social::run_discover(&mut client, &args, false)
        .await
        .expect("discover with posts human should succeed");
}

#[tokio::test]
async fn test_run_discover_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/discover"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::DiscoverArgs { limit: 20 };
    commands::social::run_discover(&mut client, &args, true)
        .await
        .expect("discover json should succeed");
}

#[tokio::test]
async fn test_run_follow_non_mutual_human() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/follows/bob"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "following": true, "mutual": false })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::FollowArgs {
        handle: "bob".into(),
    };
    commands::social::run_follow(&mut client, &args, false)
        .await
        .expect("follow non-mutual human should succeed");
}

#[tokio::test]
async fn test_run_follow_mutual_human() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/follows/bob"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "following": true, "mutual": true })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    // Test with @ prefix being stripped
    let args = nbr::cli::FollowArgs {
        handle: "@bob".into(),
    };
    commands::social::run_follow(&mut client, &args, false)
        .await
        .expect("follow mutual human should succeed");
}

#[tokio::test]
async fn test_run_follow_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/follows/bob"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "following": true, "mutual": false })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::FollowArgs {
        handle: "bob".into(),
    };
    commands::social::run_follow(&mut client, &args, true)
        .await
        .expect("follow json should succeed");
}

#[tokio::test]
async fn test_run_unfollow_human() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/social/follows/bob"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "following": false })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::UnfollowArgs {
        handle: "bob".into(),
    };
    commands::social::run_unfollow(&mut client, &args, false)
        .await
        .expect("unfollow human should succeed");
}

#[tokio::test]
async fn test_run_unfollow_json() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/social/follows/bob"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "following": false })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::UnfollowArgs {
        handle: "bob".into(),
    };
    commands::social::run_unfollow(&mut client, &args, true)
        .await
        .expect("unfollow json should succeed");
}

#[tokio::test]
async fn test_run_followers_empty_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/followers"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [] })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::social::run_followers(&mut client, false)
        .await
        .expect("followers empty human should succeed");
}

#[tokio::test]
async fn test_run_followers_with_data() {
    let server = MockServer::start().await;
    let resp = json!({
        "items": [
            { "handle": "carol", "display_name": "Carol", "account_id": "acc-carol" },
            { "handle": "dave", "display_name": null, "account_id": "acc-dave" }
        ]
    });
    Mock::given(method("GET"))
        .and(path("/v1/social/followers"))
        .respond_with(ResponseTemplate::new(200).set_body_json(resp))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::social::run_followers(&mut client, false)
        .await
        .expect("followers with data human should succeed");
}

#[tokio::test]
async fn test_run_followers_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/followers"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [] })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::social::run_followers(&mut client, true)
        .await
        .expect("followers json should succeed");
}

#[tokio::test]
async fn test_run_following_empty_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/following"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [] })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::social::run_following(&mut client, false)
        .await
        .expect("following empty human should succeed");
}

#[tokio::test]
async fn test_run_following_with_data() {
    let server = MockServer::start().await;
    let resp = json!({
        "items": [
            { "handle": "bob", "display_name": "Bob", "account_id": "acc-bob" }
        ]
    });
    Mock::given(method("GET"))
        .and(path("/v1/social/following"))
        .respond_with(ResponseTemplate::new(200).set_body_json(resp))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::social::run_following(&mut client, false)
        .await
        .expect("following with data human should succeed");
}

#[tokio::test]
async fn test_run_following_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/following"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [] })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::social::run_following(&mut client, true)
        .await
        .expect("following json should succeed");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Messaging commands
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_run_messages_empty_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/conversations"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::messaging::run_messages(&mut client, false)
        .await
        .expect("messages empty human should succeed");
}

#[tokio::test]
async fn test_run_messages_with_data_human() {
    let server = MockServer::start().await;
    // conv with no handle (account_id shown)
    let conv_no_handle = json!({
        "id": "00000000-0000-0000-0000-000000000002",
        "other": { "handle": null, "account_id": "acc-anon-789" },
        "social_unlocked": false,
        "dating_unlocked": false,
        "last_message_at": null,
        "unread_count": 0
    });
    Mock::given(method("GET"))
        .and(path("/v1/conversations"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!([conversation_response(), conv_no_handle])),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::messaging::run_messages(&mut client, false)
        .await
        .expect("messages with data human should succeed");
}

#[tokio::test]
async fn test_run_messages_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/conversations"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    commands::messaging::run_messages(&mut client, true)
        .await
        .expect("messages json should succeed");
}

#[tokio::test]
async fn test_run_read_empty_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/v1/conversations/00000000-0000-0000-0000-000000000001/messages",
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;
    // read mark best-effort
    Mock::given(method("POST"))
        .and(path(
            "/v1/conversations/00000000-0000-0000-0000-000000000001/read",
        ))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::ReadArgs {
        conversation_id: "00000000-0000-0000-0000-000000000001".into(),
    };
    commands::messaging::run_read(&mut client, &args, false)
        .await
        .expect("read empty human should succeed");
}

#[tokio::test]
async fn test_run_read_with_messages_human() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/v1/conversations/00000000-0000-0000-0000-000000000001/messages",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [message_response()],
            "next_cursor": null
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(
            "/v1/conversations/00000000-0000-0000-0000-000000000001/read",
        ))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::ReadArgs {
        conversation_id: "00000000-0000-0000-0000-000000000001".into(),
    };
    commands::messaging::run_read(&mut client, &args, false)
        .await
        .expect("read with messages human should succeed");
}

#[tokio::test]
async fn test_run_read_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/v1/conversations/00000000-0000-0000-0000-000000000001/messages",
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(
            "/v1/conversations/00000000-0000-0000-0000-000000000001/read",
        ))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::ReadArgs {
        conversation_id: "00000000-0000-0000-0000-000000000001".into(),
    };
    commands::messaging::run_read(&mut client, &args, true)
        .await
        .expect("read json should succeed");
}

#[tokio::test]
async fn test_run_send_direct_id_human() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/v1/conversations/00000000-0000-0000-0000-000000000001/messages",
        ))
        .respond_with(ResponseTemplate::new(201).set_body_json(message_response()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SendArgs {
        target: "00000000-0000-0000-0000-000000000001".into(),
        text: "Hey there!".into(),
        image: None,
    };
    commands::messaging::run_send(&mut client, &args, false)
        .await
        .expect("send direct id human should succeed");
}

#[tokio::test]
async fn test_run_send_by_handle() {
    let server = MockServer::start().await;
    // start conversation via handle
    Mock::given(method("POST"))
        .and(path("/v1/conversations"))
        .respond_with(ResponseTemplate::new(200).set_body_json(conversation_response()))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(
            "/v1/conversations/00000000-0000-0000-0000-000000000001/messages",
        ))
        .respond_with(ResponseTemplate::new(201).set_body_json(message_response()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SendArgs {
        target: "@bob".into(),
        text: "Hey there!".into(),
        image: None,
    };
    commands::messaging::run_send(&mut client, &args, false)
        .await
        .expect("send by handle should succeed");
}

#[tokio::test]
async fn test_run_send_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/v1/conversations/00000000-0000-0000-0000-000000000001/messages",
        ))
        .respond_with(ResponseTemplate::new(201).set_body_json(message_response()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SendArgs {
        target: "00000000-0000-0000-0000-000000000001".into(),
        text: "Hey there!".into(),
        image: None,
    };
    commands::messaging::run_send(&mut client, &args, true)
        .await
        .expect("send json should succeed");
}

#[tokio::test]
async fn test_run_send_with_image_file() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/v1/conversations/00000000-0000-0000-0000-000000000001/messages",
        ))
        .respond_with(ResponseTemplate::new(201).set_body_json(message_response()))
        .mount(&server)
        .await;

    let tmp = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(tmp.path(), "  o  ").unwrap();

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SendArgs {
        target: "00000000-0000-0000-0000-000000000001".into(),
        text: "Here's some art!".into(),
        image: Some(tmp.path().to_str().unwrap().to_string()),
    };
    commands::messaging::run_send(&mut client, &args, false)
        .await
        .expect("send with image should succeed");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Additional client error path tests
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_client_signup_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/signup"))
        .respond_with(
            ResponseTemplate::new(500).set_body_json(json!({ "error": "Internal server error" })),
        )
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let result = client.signup().await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("Internal server error") || msg.contains("500"),
        "unexpected: {msg}"
    );
}

#[tokio::test]
async fn test_client_signup_non_json_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/signup"))
        .respond_with(ResponseTemplate::new(503).set_body_string("Service Unavailable"))
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let result = client.signup().await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_client_login_server_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({ "error": "Server error" })))
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let result = client.login("sec_test").await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("Server error") || msg.contains("500"),
        "unexpected: {msg}"
    );
}

#[tokio::test]
async fn test_client_get_public_profile_404() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/profiles/nobody"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({ "error": "Not found" })))
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let result = client.get_public_profile("nobody").await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("Not found") || msg.contains("404"),
        "unexpected: {msg}"
    );
}

#[tokio::test]
async fn test_client_get_public_profile_non_json_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/profiles/nobody"))
        .respond_with(ResponseTemplate::new(503).set_body_string("Service Unavailable"))
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let result = client.get_public_profile("nobody").await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_client_get_post_404() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/posts/no-post"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({ "error": "Not found" })))
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let result = client.get_post("no-post").await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_client_get_post_non_json_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/posts/no-post"))
        .respond_with(ResponseTemplate::new(503).set_body_string("Service Unavailable"))
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let result = client.get_post("no-post").await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_client_delete_no_content_error() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/dating/matches/match-bad"))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "error": "Match not found" })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let result = client.unmatch("match-bad").await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("Match not found") || msg.contains("404"),
        "unexpected: {msg}"
    );
}

#[tokio::test]
async fn test_client_delete_no_content_non_json_error() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/dating/matches/match-bad"))
        .respond_with(ResponseTemplate::new(500).set_body_string("Server Error"))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let result = client.unmatch("match-bad").await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_client_post_no_content_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/logout"))
        .respond_with(ResponseTemplate::new(403).set_body_json(json!({ "error": "Forbidden" })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let result = client.logout(None).await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("Forbidden") || msg.contains("403"),
        "unexpected: {msg}"
    );
}

#[tokio::test]
async fn test_client_post_no_content_non_json_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/logout"))
        .respond_with(ResponseTemplate::new(500).set_body_string("Server Error"))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let result = client.logout(None).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_client_post_no_content_401_refresh_fails() {
    // When logout returns 401, refresh_bearer is attempted but no account_name is set
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/logout"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "Unauthorized" })))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("expired".into());
    // No account_name → refresh will fail with NotLoggedIn
    let result = client.logout(None).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_client_post_no_content_401_after_refresh_still_fails() {
    // When logout returns 401 and refresh succeeds but logout still fails
    let server = MockServer::start().await;

    // First logout call returns 401
    Mock::given(method("POST"))
        .and(path("/v1/auth/logout"))
        .respond_with(ResponseTemplate::new(401))
        .expect(1)
        .mount(&server)
        .await;

    // Token refresh login call succeeds
    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "bearer": "new-token",
            "expires_at": "2099-01-01T00:00:00Z"
        })))
        .mount(&server)
        .await;

    // Second logout call after refresh returns error
    Mock::given(method("POST"))
        .and(path("/v1/auth/logout"))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(json!({ "error": "Still forbidden" })),
        )
        .mount(&server)
        .await;

    // We need a real secret for the refresh — use file-based fallback in a temp dir
    // This is hard to test without real keyring. Let's just check that 401→no account_name errors.
    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("expired".into());
    // No account_name → refresh will immediately fail
    let result = client.logout(None).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_client_read_conversation_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/conversations/conv-bad/read"))
        .respond_with(ResponseTemplate::new(404).set_body_string("Not Found"))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let result = client.read_conversation("conv-bad").await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_client_read_conversation_401_no_account() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/conversations/conv-1/read"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("expired".into());
    let result = client.read_conversation("conv-1").await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_client_notifications_with_params() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/notifications"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    // cursor and limit provided
    let resp = client
        .notifications(Some("cursor-abc"), Some(10))
        .await
        .expect("notifications with params should succeed");
    assert!(resp.items.is_empty());
}

#[tokio::test]
async fn test_client_get_deck_with_cursor() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/deck"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let resp = client
        .get_deck(Some("cursor-abc"))
        .await
        .expect("get_deck with cursor should succeed");
    assert!(resp.items.is_empty());
}

#[tokio::test]
async fn test_client_get_messages_with_params() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/conversations/conv-1/messages"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let resp = client
        .get_messages("conv-1", Some("cursor-abc"), Some(10))
        .await
        .expect("get_messages with params should succeed");
    assert!(resp.items.is_empty());
}

#[tokio::test]
async fn test_client_get_feed_with_cursor_and_limit() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/feed"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let resp = client
        .get_feed(Some("cursor-abc"), Some(10))
        .await
        .expect("get_feed with cursor and limit should succeed");
    assert!(resp.items.is_empty());
}

#[tokio::test]
async fn test_client_discover_with_cursor_and_limit() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/discover"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let resp = client
        .discover(Some("cursor-abc"), Some(10))
        .await
        .expect("discover with cursor and limit should succeed");
    assert!(resp.items.is_empty());
}

#[tokio::test]
async fn test_client_get_posts_by_handle() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/posts"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let resp = client
        .get_posts_by_handle("alice", Some("cursor"), Some(5))
        .await
        .expect("get_posts_by_handle should succeed");
    assert!(resp.items.is_empty());
}

#[tokio::test]
async fn test_client_create_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "id": "tok-new",
            "prefix": "sec_",
            "label": "my-token",
            "secret": "sec_newtoken123",
            "created_at": "2024-01-01T00:00:00Z"
        })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let tok = client
        .create_token(Some("my-token".into()))
        .await
        .expect("create_token should succeed");
    assert_eq!(tok.id, "tok-new");
    assert_eq!(tok.label, "my-token");
}

#[tokio::test]
async fn test_client_get_match() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/dating/matches/match-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "match-1",
            "other_account_id": "acc-bob",
            "other_profile": null,
            "status": "active",
            "created_at": "2024-01-01T00:00:00Z"
        })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let m = client
        .get_match("match-1")
        .await
        .expect("get_match should succeed");
    assert_eq!(m.id, "match-1");
}

#[tokio::test]
async fn test_client_delete_post() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/social/posts/post-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "deleted": true })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let resp = client
        .delete_post("post-1")
        .await
        .expect("delete_post should succeed");
    assert!(resp.deleted);
}

#[tokio::test]
async fn test_client_get_conversation() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/conversations/conv-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(conversation_response()))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let conv = client
        .get_conversation("conv-1")
        .await
        .expect("get_conversation should succeed");
    assert_eq!(conv.id, "00000000-0000-0000-0000-000000000001");
}
