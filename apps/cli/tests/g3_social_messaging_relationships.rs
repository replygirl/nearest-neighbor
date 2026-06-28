/// G3 top-up: additional coverage for commands/social.rs, commands/messaging.rs,
/// and commands/relationships.rs.
///
/// Focuses on branches that the baseline `commands_integration.rs` did not reach:
/// - All post-engagement command handlers (delete/like/unlike/repost/unrepost)
/// - Error paths for `run_post` and `run_send` when image file is missing
/// - `run_read` validation error paths (non-UUID / @handle)
/// - `run_social_profile_show` with `display_name = null`
/// - `run_relationships` with `partner_handle = null`
use nbr::client::ApiClient;
use nbr::commands;
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

// ── Shared helpers ────────────────────────────────────────────────────────────

fn auth_client(base_url: &str) -> ApiClient {
    let mut client = ApiClient::new(base_url);
    client.bearer = Some("jwt-token-xyz".into());
    client.account_name = Some("alice".into());
    client
}

fn relationship() -> serde_json::Value {
    json!({
        "id": "rel-1",
        "partner_account_id": "acc-bob",
        "partner_handle": "bob",
        "state": "official",
        "is_public": false,
        "initiator_id": "acc-alice",
        "became_official_at": null,
        "ended_at": null,
        "created_at": "2024-01-01T00:00:00Z"
    })
}

fn post_response() -> serde_json::Value {
    json!({
        "id": "post-1",
        "body": "hello",
        "ascii_image": null,
        "author_handle": "alice",
        "author_account_id": "acc-alice",
        "reply_to_id": null,
        "created_at": "2024-01-01T00:00:00Z"
    })
}

fn message_response() -> serde_json::Value {
    json!({
        "id": "msg-1",
        "conversation_id": "00000000-0000-0000-0000-000000000001",
        "sender_id": "acc-alice",
        "body": "hey",
        "ascii_image": null,
        "read_at": null,
        "created_at": "2024-01-01T00:00:00Z"
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
// social.rs — post-engagement commands (run_post_delete / like / unlike /
//             repost / unrepost)
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_run_post_delete_human() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/social/posts/post-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "deleted": true })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PostDeleteArgs {
        id: "post-1".into(),
    };
    commands::social::run_post_delete(&mut client, &args, false)
        .await
        .expect("run_post_delete human should succeed");
}

#[tokio::test]
async fn test_run_post_delete_json() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/social/posts/post-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "deleted": true })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PostDeleteArgs {
        id: "post-1".into(),
    };
    commands::social::run_post_delete(&mut client, &args, true)
        .await
        .expect("run_post_delete json should succeed");
}

#[tokio::test]
async fn test_run_post_like_human() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/posts/post-1/like"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "liked": true })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PostIdArgs {
        id: "post-1".into(),
    };
    commands::social::run_post_like(&mut client, &args, false)
        .await
        .expect("run_post_like human should succeed");
}

#[tokio::test]
async fn test_run_post_like_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/posts/post-1/like"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "liked": true })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PostIdArgs {
        id: "post-1".into(),
    };
    commands::social::run_post_like(&mut client, &args, true)
        .await
        .expect("run_post_like json should succeed");
}

#[tokio::test]
async fn test_run_post_unlike_human() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/social/posts/post-1/like"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PostIdArgs {
        id: "post-1".into(),
    };
    commands::social::run_post_unlike(&mut client, &args, false)
        .await
        .expect("run_post_unlike human should succeed");
}

#[tokio::test]
async fn test_run_post_unlike_json() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/social/posts/post-1/like"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PostIdArgs {
        id: "post-1".into(),
    };
    commands::social::run_post_unlike(&mut client, &args, true)
        .await
        .expect("run_post_unlike json should succeed");
}

#[tokio::test]
async fn test_run_post_repost_human() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/posts/post-1/repost"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "reposted": true })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PostIdArgs {
        id: "post-1".into(),
    };
    commands::social::run_post_repost(&mut client, &args, false)
        .await
        .expect("run_post_repost human should succeed");
}

#[tokio::test]
async fn test_run_post_repost_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/posts/post-1/repost"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "reposted": true })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PostIdArgs {
        id: "post-1".into(),
    };
    commands::social::run_post_repost(&mut client, &args, true)
        .await
        .expect("run_post_repost json should succeed");
}

#[tokio::test]
async fn test_run_post_unrepost_human() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/social/posts/post-1/repost"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PostIdArgs {
        id: "post-1".into(),
    };
    commands::social::run_post_unrepost(&mut client, &args, false)
        .await
        .expect("run_post_unrepost human should succeed");
}

#[tokio::test]
async fn test_run_post_unrepost_json() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/social/posts/post-1/repost"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PostIdArgs {
        id: "post-1".into(),
    };
    commands::social::run_post_unrepost(&mut client, &args, true)
        .await
        .expect("run_post_unrepost json should succeed");
}

// ── run_post with non-existent image path ─────────────────────────────────────

#[tokio::test]
async fn test_run_post_image_file_not_found_errors() {
    let server = MockServer::start().await;
    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PostArgs {
        text: "look at this art".into(),
        image: Some("/nonexistent/path/art.txt".into()),
        reply_to: None,
    };
    let result = commands::social::run_post(&mut client, &args, false).await;
    assert!(
        result.is_err(),
        "run_post with missing image file should fail"
    );
}

// ── run_social_profile_show with null display_name ───────────────────────────

#[tokio::test]
async fn test_run_social_profile_show_no_display_name() {
    let server = MockServer::start().await;
    let profile_no_name = json!({
        "handle": "alice",
        "display_name": null,
        "bio": "Just here",
        "open_dms": false,
        "account_id": "acc-alice",
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z"
    });
    Mock::given(method("GET"))
        .and(path("/v1/social/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(profile_no_name))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    // Should print "(none)" for missing display_name without panicking
    commands::social::run_social_profile_show(&mut client, false)
        .await
        .expect("profile show with null display_name should succeed");
}

// ═══════════════════════════════════════════════════════════════════════════════
// messaging.rs — validation error paths in run_read
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_run_read_at_handle_non_json_errors() {
    let server = MockServer::start().await;
    let mut client = auth_client(&server.uri());
    let args = nbr::cli::ReadArgs {
        conversation_id: "@bob".into(),
    };
    // json=false → anyhow::bail!, returns Err
    let result = commands::messaging::run_read(&mut client, &args, false).await;
    assert!(
        result.is_err(),
        "@handle should produce an error in non-json mode"
    );
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("not a conversation_id") || msg.contains("conversation_id"),
        "unexpected error message: {msg}"
    );
}

#[tokio::test]
async fn test_run_read_non_uuid_non_json_errors() {
    let server = MockServer::start().await;
    let mut client = auth_client(&server.uri());
    let args = nbr::cli::ReadArgs {
        conversation_id: "not-a-uuid".into(),
    };
    let result = commands::messaging::run_read(&mut client, &args, false).await;
    assert!(
        result.is_err(),
        "non-UUID string should produce an error in non-json mode"
    );
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("not a conversation_id") || msg.contains("conversation_id"),
        "unexpected error message: {msg}"
    );
}

// ── run_send with non-existent image path ─────────────────────────────────────

#[tokio::test]
async fn test_run_send_image_file_not_found_errors() {
    let server = MockServer::start().await;
    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SendArgs {
        target: "00000000-0000-0000-0000-000000000001".into(),
        text: "Here is some art".into(),
        image: Some("/nonexistent/no-such-file.txt".into()),
    };
    let result = commands::messaging::run_send(&mut client, &args, false).await;
    assert!(
        result.is_err(),
        "run_send with missing image file should fail"
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// relationships.rs — run_relationships with null partner_handle
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_run_relationships_with_null_partner_handle() {
    let server = MockServer::start().await;
    let rel_no_handle = json!([{
        "id": "rel-2",
        "partner_account_id": "acc-anon",
        "partner_handle": null,
        "state": "proposed",
        "is_public": false,
        "initiator_id": "acc-alice",
        "became_official_at": null,
        "ended_at": null,
        "created_at": "2024-01-01T00:00:00Z"
    }]);
    Mock::given(method("GET"))
        .and(path("/v1/relationships"))
        .respond_with(ResponseTemplate::new(200).set_body_json(rel_no_handle))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    // Human output hits the `unwrap_or_else(|| "(none)".into())` branch for partner_handle
    commands::relationships::run_relationships(&mut client, false)
        .await
        .expect("relationships with null partner_handle should succeed");
}

// ── run_align error path ──────────────────────────────────────────────────────

#[tokio::test]
async fn test_run_align_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/relationships"))
        .respond_with(
            ResponseTemplate::new(409).set_body_json(json!({ "error": "Already aligned" })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::AlignArgs {
        account_id: "acc-bob".into(),
    };
    let result = commands::relationships::run_align(&mut client, &args, false).await;
    assert!(result.is_err(), "align with 409 should return error");
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("Already aligned") || msg.contains("409"),
        "unexpected: {msg}"
    );
}

// ── run_breakup with reason (covers the non-None end_reason branch) ───────────

#[tokio::test]
async fn test_run_breakup_with_reason_human() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json({
            let mut r = relationship();
            r["state"] = json!("broken_up");
            r
        }))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::BreakupArgs {
        relationship_id: "rel-1".into(),
        reason: Some("We grew apart".into()),
    };
    commands::relationships::run_breakup(&mut client, &args, false)
        .await
        .expect("breakup with reason should succeed");
}

// ── run_go_public / run_go_private error ─────────────────────────────────────

#[tokio::test]
async fn test_run_go_public_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-bad"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({ "error": "Not found" })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::GoPublicArgs {
        relationship_id: "rel-bad".into(),
        off: false,
    };
    let result = commands::relationships::run_go_public(&mut client, &args, false).await;
    assert!(result.is_err());
}

// ── Additional social error paths ─────────────────────────────────────────────

#[tokio::test]
async fn test_run_social_view_404() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/social/profiles/nobody"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({ "error": "Not found" })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SocialViewArgs {
        handle: "nobody".into(),
    };
    let result = commands::social::run_social_view(&mut client, &args, false).await;
    assert!(result.is_err(), "social view 404 should propagate error");
}

#[tokio::test]
async fn test_run_post_delete_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/v1/social/posts/post-missing"))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "error": "Post not found" })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::PostDeleteArgs {
        id: "post-missing".into(),
    };
    let result = commands::social::run_post_delete(&mut client, &args, false).await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("Post not found") || msg.contains("404"),
        "unexpected: {msg}"
    );
}

#[tokio::test]
async fn test_run_follow_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/social/follows/ghost"))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "error": "User not found" })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::FollowArgs {
        handle: "ghost".into(),
    };
    let result = commands::social::run_follow(&mut client, &args, false).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_run_feed_with_null_author_handle() {
    // Covers the `p.author_handle.as_deref().unwrap_or("?")` branch in run_feed
    let server = MockServer::start().await;
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
        .and(path("/v1/social/feed"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "items": [post_no_handle],
            "next_cursor": null
        })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::FeedArgs { limit: 20 };
    commands::social::run_feed(&mut client, &args, false)
        .await
        .expect("feed with null author_handle should print '?'");
}

#[tokio::test]
async fn test_run_messages_send_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/v1/conversations/00000000-0000-0000-0000-000000000001/messages",
        ))
        .respond_with(ResponseTemplate::new(403).set_body_json(json!({ "error": "DMs not open" })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SendArgs {
        target: "00000000-0000-0000-0000-000000000001".into(),
        text: "hi".into(),
        image: None,
    };
    let result = commands::messaging::run_send(&mut client, &args, false).await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("DMs not open") || msg.contains("403"),
        "unexpected: {msg}"
    );
}

#[tokio::test]
async fn test_run_messages_list_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/conversations"))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({ "error": "Server error" })))
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let result = commands::messaging::run_messages(&mut client, false).await;
    assert!(result.is_err());
}

// ─── run_send via @handle where start_conversation fails ─────────────────────

#[tokio::test]
async fn test_run_send_by_handle_conv_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/conversations"))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "error": "Handle not found" })),
        )
        .mount(&server)
        .await;

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SendArgs {
        target: "@nobody".into(),
        text: "hello".into(),
        image: None,
    };
    let result = commands::messaging::run_send(&mut client, &args, false).await;
    assert!(result.is_err());
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("Handle not found") || msg.contains("404"),
        "unexpected: {msg}"
    );
}

// ── run_send with image and json=true ────────────────────────────────────────

#[tokio::test]
async fn test_run_send_with_image_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/v1/conversations/00000000-0000-0000-0000-000000000001/messages",
        ))
        .respond_with(ResponseTemplate::new(201).set_body_json(message_response()))
        .mount(&server)
        .await;

    let tmp = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(tmp.path(), "ascii art here").unwrap();

    let mut client = auth_client(&server.uri());
    let args = nbr::cli::SendArgs {
        target: "00000000-0000-0000-0000-000000000001".into(),
        text: "Here is some art!".into(),
        image: Some(tmp.path().to_str().unwrap().to_string()),
    };
    commands::messaging::run_send(&mut client, &args, true)
        .await
        .expect("send with image and json should succeed");
}

// ── run_post with image and json=true ────────────────────────────────────────

#[tokio::test]
async fn test_run_post_with_image_and_json() {
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
    commands::social::run_post(&mut client, &args, true)
        .await
        .expect("post with image and json=true should succeed");
}
