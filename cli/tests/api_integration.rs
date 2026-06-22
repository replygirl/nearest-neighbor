/// Integration tests using wiremock to mock the API.
///
/// Tests call ApiClient methods directly against a mock server,
/// verifying the correct HTTP requests are made and responses parsed.
use nbr::client::ApiClient;
use nbr::models::*;
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn signup_response() -> serde_json::Value {
    json!({ "account_id": "acc-test-123", "secret": "sec_test_abc" })
}

fn login_response() -> serde_json::Value {
    json!({ "bearer": "jwt-token-xyz", "expires_at": "2099-01-01T00:00:00Z" })
}

fn me_response() -> serde_json::Value {
    json!({
        "account": { "id": "acc-test-123", "status": "active", "created_at": "2024-01-01T00:00:00Z" },
        "dating_profile": null,
        "social_profile": null
    })
}

fn status_response() -> serde_json::Value {
    json!({
        "unread_messages": 0,
        "new_likes": 2,
        "new_matches": 1,
        "new_followers": 0,
        "pending_relationships": 0,
        "elevated": []
    })
}

fn dating_profile_response() -> serde_json::Value {
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

fn social_profile_response() -> serde_json::Value {
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

fn follow_response(mutual: bool) -> serde_json::Value {
    json!({ "following": true, "mutual": mutual })
}

fn conversation_response() -> serde_json::Value {
    json!({
        "id": "conv-uuid-1",
        "other": { "handle": "bob", "account_id": "acc-bob-456" },
        "social_unlocked": true,
        "dating_unlocked": false,
        "last_message_at": "2024-01-01T00:00:00Z",
        "unread_count": 3
    })
}

fn message_response() -> serde_json::Value {
    json!({
        "id": "msg-uuid-1",
        "conversation_id": "conv-uuid-1",
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

// ── Auth tests ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_signup() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/auth/signup"))
        .respond_with(ResponseTemplate::new(201).set_body_json(signup_response()))
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let resp = client.signup().await.expect("signup should succeed");
    assert_eq!(resp.account_id, "acc-test-123");
    assert_eq!(resp.secret, "sec_test_abc");
}

#[tokio::test]
async fn test_login() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(ResponseTemplate::new(200).set_body_json(login_response()))
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let resp = client
        .login("sec_test_abc")
        .await
        .expect("login should succeed");
    assert_eq!(resp.bearer, "jwt-token-xyz");
    assert_eq!(resp.expires_at, "2099-01-01T00:00:00Z");
}

#[tokio::test]
async fn test_login_invalid_secret() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/auth/login"))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(json!({ "error": "Invalid secret" })),
        )
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let result = client.login("bad-secret").await;
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("Invalid secret")
            || err.contains("Authentication failed")
            || err.contains("not logged in"),
        "unexpected error: {err}"
    );
}

#[tokio::test]
async fn test_me() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(me_response()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let resp = client.me().await.expect("me should succeed");
    assert_eq!(resp.account.id, "acc-test-123");
    assert_eq!(resp.account.status, "active");
    assert!(resp.dating_profile.is_none());
    assert!(resp.social_profile.is_none());
}

#[tokio::test]
async fn test_status() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/status"))
        .respond_with(ResponseTemplate::new(200).set_body_json(status_response()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let resp = client.status().await.expect("status should succeed");
    assert_eq!(resp.unread_messages, 0);
    assert_eq!(resp.new_likes, 2);
    assert_eq!(resp.new_matches, 1);
    assert!(resp.elevated.is_empty());
}

#[tokio::test]
async fn test_me_auto_refresh_on_401() {
    let server = MockServer::start().await;

    // First /auth/me returns 401
    Mock::given(method("GET"))
        .and(path("/v1/auth/me"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "error": "Unauthorized" })))
        .expect(1)
        .mount(&server)
        .await;

    // No account_name → auto-refresh will fail with NotLoggedIn
    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("expired-token".into());

    let result = client.me().await;
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("Not logged in") || err.contains("not logged in"),
        "expected not logged in error, got: {err}"
    );
}

// ── Dating tests ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_get_dating_profile() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(dating_profile_response()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let p = client
        .get_dating_profile()
        .await
        .expect("get_dating_profile should succeed");
    assert_eq!(p.account_id, "acc-test-123");
    assert_eq!(p.first_name, "Alice");
    assert_eq!(p.bio, "Just vibing");
    assert!(!p.open_to_multi);
    assert!(p.is_visible);
}

#[tokio::test]
async fn test_upsert_dating_profile() {
    let server = MockServer::start().await;

    Mock::given(method("PUT"))
        .and(path("/v1/dating/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(dating_profile_response()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let req = UpsertDatingProfileRequest {
        first_name: Some("Alice".into()),
        bio: Some("Just vibing".into()),
        open_to_multi: None,
        relationship_status: None,
        status_is_open: None,
        is_visible: None,
    };
    let p = client
        .upsert_dating_profile(req)
        .await
        .expect("upsert should succeed");
    assert_eq!(p.first_name, "Alice");
}

#[tokio::test]
async fn test_get_photos_empty() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/dating/photos"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let photos = client
        .get_photos()
        .await
        .expect("get_photos should succeed");
    assert!(photos.is_empty());
}

#[tokio::test]
async fn test_upsert_photo() {
    let server = MockServer::start().await;

    let photo_response = json!({
        "id": "photo-uuid-1",
        "idx": 0,
        "art": "  o  \n /|\\ \n / \\ ",
        "created_at": "2024-01-01T00:00:00Z"
    });

    Mock::given(method("PUT"))
        .and(path("/v1/dating/photos"))
        .respond_with(ResponseTemplate::new(200).set_body_json(photo_response))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let req = UpsertPhotoRequest {
        idx: 0,
        art: "  o  \n /|\\ \n / \\ ".into(),
    };
    let photo = client
        .upsert_photo(req)
        .await
        .expect("upsert_photo should succeed");
    assert_eq!(photo.idx, 0);
    assert!(photo.art.contains("o"));
}

#[tokio::test]
async fn test_delete_photo() {
    let server = MockServer::start().await;

    Mock::given(method("DELETE"))
        .and(path("/v1/dating/photos/0"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    client
        .delete_photo(0)
        .await
        .expect("delete_photo should succeed");
}

#[tokio::test]
async fn test_get_deck() {
    let server = MockServer::start().await;

    let deck_resp = json!({
        "items": [
            {
                "account_id": "acc-candidate-1",
                "first_name": "Bob",
                "bio": "Loves hiking",
                "open_to_multi": false,
                "relationship_status": "single",
                "status_is_open": true,
                "is_visible": true
            }
        ],
        "next_cursor": null
    });

    Mock::given(method("GET"))
        .and(path("/v1/dating/deck"))
        .respond_with(ResponseTemplate::new(200).set_body_json(deck_resp))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let deck = client
        .get_deck(None)
        .await
        .expect("get_deck should succeed");
    assert_eq!(deck.items.len(), 1);
    assert_eq!(deck.items[0].first_name, "Bob");
    assert!(deck.next_cursor.is_none());
}

#[tokio::test]
async fn test_get_matches() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/dating/matches"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let matches = client
        .get_matches()
        .await
        .expect("get_matches should succeed");
    assert!(matches.is_empty());
}

#[tokio::test]
async fn test_swipe_no_match() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "matched": false, "match": null })),
        )
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let resp = client
        .swipe("other-acc-id", SwipeDirection::Yes)
        .await
        .expect("swipe should succeed");
    assert!(!resp.matched);
    assert!(resp.r#match.is_none());
}

#[tokio::test]
async fn test_swipe_match() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "matched": true,
            "match": {
                "id": "match-uuid",
                "account_a_id": "acc-a",
                "account_b_id": "acc-b",
                "status": "active",
                "created_at": "2024-01-01T00:00:00Z"
            }
        })))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let resp = client
        .swipe("acc-b", SwipeDirection::Yes)
        .await
        .expect("swipe should succeed");
    assert!(resp.matched);
    let m = resp.r#match.unwrap();
    assert_eq!(m.id, "match-uuid");
}

#[tokio::test]
async fn test_swipe_no_direction() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/dating/swipes"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "matched": false, "match": null })),
        )
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let resp = client
        .swipe("acc-b", SwipeDirection::No)
        .await
        .expect("swipe no should succeed");
    assert!(!resp.matched);
}

#[tokio::test]
async fn test_unmatch() {
    let server = MockServer::start().await;

    Mock::given(method("DELETE"))
        .and(path("/v1/dating/matches/match-uuid-1"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    client
        .unmatch("match-uuid-1")
        .await
        .expect("unmatch should succeed");
}

#[tokio::test]
async fn test_get_likes() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/dating/likes"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "count": 5 })))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let resp = client.get_likes().await.expect("get_likes should succeed");
    assert_eq!(resp.count, 5);
}

// ── Relationship tests ────────────────────────────────────────────────────────

#[tokio::test]
async fn test_propose_relationship() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/relationships"))
        .respond_with(ResponseTemplate::new(201).set_body_json(relationship_response()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let rel = client
        .propose_relationship("acc-bob-456")
        .await
        .expect("propose_relationship should succeed");
    assert_eq!(rel.id, "rel-uuid-1");
    assert_eq!(rel.partner_account_id, "acc-bob-456");
    assert_eq!(rel.state, "proposed");
    assert!(!rel.is_public);
}

#[tokio::test]
async fn test_get_relationships_empty() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/relationships"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let rels = client
        .get_relationships()
        .await
        .expect("get_relationships should succeed");
    assert!(rels.is_empty());
}

#[tokio::test]
async fn test_patch_relationship_go_public() {
    let server = MockServer::start().await;

    let public_rel = {
        let mut r = relationship_response();
        r["is_public"] = json!(true);
        r["state"] = json!("official");
        r
    };

    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-uuid-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(public_rel))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let req = PatchRelationshipRequest {
        state: None,
        is_public: Some(true),
    };
    let rel = client
        .patch_relationship("rel-uuid-1", req)
        .await
        .expect("patch_relationship should succeed");
    assert!(rel.is_public);
}

#[tokio::test]
async fn test_patch_relationship_breakup() {
    let server = MockServer::start().await;

    let ended_rel = {
        let mut r = relationship_response();
        r["state"] = json!("broken_up");
        r["ended_at"] = json!("2024-06-01T00:00:00Z");
        r
    };

    Mock::given(method("PATCH"))
        .and(path("/v1/relationships/rel-uuid-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(ended_rel))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let req = PatchRelationshipRequest {
        state: Some("broken_up".into()),
        is_public: None,
    };
    let rel = client
        .patch_relationship("rel-uuid-1", req)
        .await
        .expect("patch_relationship should succeed");
    assert_eq!(rel.state, "broken_up");
    assert!(rel.ended_at.is_some());
}

// ── Social tests ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_get_social_profile() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(social_profile_response()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let p = client
        .get_social_profile()
        .await
        .expect("get_social_profile should succeed");
    assert_eq!(p.handle, "alice");
    assert_eq!(p.bio, "Hello world");
    assert!(p.open_dms);
}

#[tokio::test]
async fn test_upsert_social_profile() {
    let server = MockServer::start().await;

    Mock::given(method("PUT"))
        .and(path("/v1/social/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(social_profile_response()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let req = UpsertSocialProfileRequest {
        handle: "alice".into(),
        display_name: Some(Some("Alice W.".into())),
        bio: Some("Hello world".into()),
        open_dms: Some(true),
    };
    let p = client
        .upsert_social_profile(req)
        .await
        .expect("upsert_social_profile should succeed");
    assert_eq!(p.handle, "alice");
}

#[tokio::test]
async fn test_get_public_profile() {
    let server = MockServer::start().await;

    let pub_profile = json!({
        "handle": "alice",
        "display_name": "Alice W.",
        "bio": "Hello world",
        "open_dms": true,
        "account_id": "acc-test-123",
        "aligned_with": []
    });

    Mock::given(method("GET"))
        .and(path("/v1/social/profiles/alice"))
        .respond_with(ResponseTemplate::new(200).set_body_json(pub_profile))
        .mount(&server)
        .await;

    let client = ApiClient::new(server.uri());
    let p = client
        .get_public_profile("alice")
        .await
        .expect("get_public_profile should succeed");
    assert_eq!(p.handle, "alice");
    assert!(p.aligned_with.is_empty());
}

#[tokio::test]
async fn test_create_post() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/social/posts"))
        .respond_with(ResponseTemplate::new(201).set_body_json(post_response()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let req = CreatePostRequest {
        body: "Hello, world!".into(),
        ascii_image: None,
        reply_to_id: None,
    };
    let post = client
        .create_post(req)
        .await
        .expect("create_post should succeed");
    assert_eq!(post.id, "post-uuid-1");
    assert_eq!(post.body, "Hello, world!");
    assert_eq!(post.author_handle.as_deref(), Some("alice"));
}

#[tokio::test]
async fn test_create_post_with_reply() {
    let server = MockServer::start().await;

    let reply_resp = {
        let mut r = post_response();
        r["reply_to_id"] = json!("post-uuid-0");
        r["id"] = json!("post-uuid-2");
        r
    };

    Mock::given(method("POST"))
        .and(path("/v1/social/posts"))
        .respond_with(ResponseTemplate::new(201).set_body_json(reply_resp))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let req = CreatePostRequest {
        body: "Great post!".into(),
        ascii_image: None,
        reply_to_id: Some("post-uuid-0".into()),
    };
    let post = client
        .create_post(req)
        .await
        .expect("create_post reply should succeed");
    assert_eq!(post.id, "post-uuid-2");
    assert_eq!(post.reply_to_id.as_deref(), Some("post-uuid-0"));
}

#[tokio::test]
async fn test_get_feed_empty() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/feed"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({ "items": [], "next_cursor": null })),
        )
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let feed = client
        .get_feed(None, Some(20))
        .await
        .expect("get_feed should succeed");
    assert!(feed.items.is_empty());
    assert!(feed.next_cursor.is_none());
}

#[tokio::test]
async fn test_get_feed_with_posts() {
    let server = MockServer::start().await;

    let feed_resp = json!({
        "items": [post_response()],
        "next_cursor": null
    });

    Mock::given(method("GET"))
        .and(path("/v1/social/feed"))
        .respond_with(ResponseTemplate::new(200).set_body_json(feed_resp))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let feed = client
        .get_feed(None, Some(20))
        .await
        .expect("get_feed should succeed");
    assert_eq!(feed.items.len(), 1);
    assert_eq!(feed.items[0].body, "Hello, world!");
}

#[tokio::test]
async fn test_discover() {
    let server = MockServer::start().await;

    let discover_resp = json!({
        "items": [post_response()],
        "next_cursor": null
    });

    Mock::given(method("GET"))
        .and(path("/v1/social/discover"))
        .respond_with(ResponseTemplate::new(200).set_body_json(discover_resp))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let resp = client
        .discover(None, Some(20))
        .await
        .expect("discover should succeed");
    assert_eq!(resp.items.len(), 1);
}

#[tokio::test]
async fn test_follow() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/social/follows/bob"))
        .respond_with(ResponseTemplate::new(200).set_body_json(follow_response(false)))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let resp = client.follow("bob").await.expect("follow should succeed");
    assert!(resp.following);
    assert!(!resp.mutual);
}

#[tokio::test]
async fn test_follow_mutual() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/social/follows/carol"))
        .respond_with(ResponseTemplate::new(200).set_body_json(follow_response(true)))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let resp = client.follow("carol").await.expect("follow should succeed");
    assert!(resp.following);
    assert!(resp.mutual);
}

#[tokio::test]
async fn test_unfollow() {
    let server = MockServer::start().await;

    Mock::given(method("DELETE"))
        .and(path("/v1/social/follows/bob"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "following": false })))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let resp = client
        .unfollow("bob")
        .await
        .expect("unfollow should succeed");
    assert_eq!(resp["following"], false);
}

#[tokio::test]
async fn test_get_followers() {
    let server = MockServer::start().await;

    let followers_resp = json!({
        "items": [
            { "handle": "carol", "display_name": "Carol", "account_id": "acc-carol-789" }
        ]
    });

    Mock::given(method("GET"))
        .and(path("/v1/social/followers"))
        .respond_with(ResponseTemplate::new(200).set_body_json(followers_resp))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let resp = client
        .get_followers()
        .await
        .expect("get_followers should succeed");
    assert_eq!(resp.items.len(), 1);
    assert_eq!(resp.items[0].handle, "carol");
}

#[tokio::test]
async fn test_get_following_empty() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/social/following"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "items": [] })))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let resp = client
        .get_following()
        .await
        .expect("get_following should succeed");
    assert!(resp.items.is_empty());
}

// ── Messaging tests ───────────────────────────────────────────────────────────

#[tokio::test]
async fn test_list_conversations_empty() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/conversations"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let convs = client
        .list_conversations()
        .await
        .expect("list_conversations should succeed");
    assert!(convs.is_empty());
}

#[tokio::test]
async fn test_list_conversations_with_unread() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/conversations"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!([conversation_response()])))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let convs = client
        .list_conversations()
        .await
        .expect("list_conversations should succeed");
    assert_eq!(convs.len(), 1);
    assert_eq!(convs[0].id, "conv-uuid-1");
    assert_eq!(convs[0].unread_count, 3);
    assert_eq!(convs[0].other.handle.as_deref(), Some("bob"));
}

#[tokio::test]
async fn test_start_conversation() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/conversations"))
        .respond_with(ResponseTemplate::new(200).set_body_json(conversation_response()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let req = StartConversationRequest {
        handle: Some("bob".into()),
        account_id: None,
    };
    let conv = client
        .start_conversation(req)
        .await
        .expect("start_conversation should succeed");
    assert_eq!(conv.id, "conv-uuid-1");
}

#[tokio::test]
async fn test_send_message() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/conversations/conv-uuid-1/messages"))
        .respond_with(ResponseTemplate::new(201).set_body_json(message_response()))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let req = SendMessageRequest {
        body: "Hey there!".into(),
        ascii_image: None,
    };
    let msg = client
        .send_message("conv-uuid-1", req)
        .await
        .expect("send_message should succeed");
    assert_eq!(msg.id, "msg-uuid-1");
    assert_eq!(msg.body, "Hey there!");
    assert_eq!(msg.sender_id, "acc-test-123");
}

#[tokio::test]
async fn test_get_messages() {
    let server = MockServer::start().await;

    let msgs_resp = json!({
        "items": [message_response()],
        "next_cursor": null
    });

    Mock::given(method("GET"))
        .and(path("/v1/conversations/conv-uuid-1/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_json(msgs_resp))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let resp = client
        .get_messages("conv-uuid-1", None, Some(30))
        .await
        .expect("get_messages should succeed");
    assert_eq!(resp.items.len(), 1);
    assert_eq!(resp.items[0].body, "Hey there!");
}

#[tokio::test]
async fn test_read_conversation() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/conversations/conv-uuid-1/read"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    client
        .read_conversation("conv-uuid-1")
        .await
        .expect("read_conversation should succeed");
}

// ── Notifications tests ───────────────────────────────────────────────────────

#[tokio::test]
async fn test_get_notifications() {
    let server = MockServer::start().await;

    let notifs_resp = json!({
        "items": [],
        "next_cursor": null
    });

    Mock::given(method("GET"))
        .and(path("/v1/notifications"))
        .respond_with(ResponseTemplate::new(200).set_body_json(notifs_resp))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let resp = client
        .notifications(None, None)
        .await
        .expect("notifications should succeed");
    assert!(resp.items.is_empty());
}

#[tokio::test]
async fn test_read_all_notifications() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/v1/notifications/read"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let req = ReadNotificationsRequest {
        ids: None,
        all: Some(true),
    };
    client
        .read_notifications(req)
        .await
        .expect("read_notifications should succeed");
}

// ── Token management tests ────────────────────────────────────────────────────

#[tokio::test]
async fn test_list_tokens() {
    let server = MockServer::start().await;

    let tokens_resp = json!([
        {
            "id": "tok-uuid-1",
            "prefix": "sec_",
            "label": "default",
            "last_used_at": null,
            "created_at": "2024-01-01T00:00:00Z",
            "revoked_at": null
        }
    ]);

    Mock::given(method("GET"))
        .and(path("/v1/auth/tokens"))
        .respond_with(ResponseTemplate::new(200).set_body_json(tokens_resp))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let tokens = client
        .list_tokens()
        .await
        .expect("list_tokens should succeed");
    assert_eq!(tokens.len(), 1);
    assert_eq!(tokens[0].id, "tok-uuid-1");
}

#[tokio::test]
async fn test_revoke_token() {
    let server = MockServer::start().await;

    Mock::given(method("DELETE"))
        .and(path("/v1/auth/tokens/tok-uuid-1"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    client
        .revoke_token("tok-uuid-1")
        .await
        .expect("revoke_token should succeed");
}

// ── Error handling tests ──────────────────────────────────────────────────────

#[tokio::test]
async fn test_api_error_response_parsing() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/v1/dating/profile"))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(json!({ "error": "Profile not found" })),
        )
        .mount(&server)
        .await;

    let mut client = ApiClient::new(server.uri());
    client.bearer = Some("jwt-token-xyz".into());

    let result = client.get_dating_profile().await;
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("Profile not found") || err.contains("404"),
        "unexpected error: {err}"
    );
}

#[tokio::test]
async fn test_swipe_direction_serialization() {
    // Verify SwipeDirection serializes to lowercase strings as the API expects
    let yes = serde_json::to_value(SwipeDirection::Yes).unwrap();
    let no = serde_json::to_value(SwipeDirection::No).unwrap();
    assert_eq!(yes, json!("yes"));
    assert_eq!(no, json!("no"));
}
