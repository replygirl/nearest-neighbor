#![allow(dead_code)]

use serde::{Deserialize, Serialize};

// ── Auth ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SignupResponse {
    pub account_id: String,
    pub secret: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRequest {
    pub secret: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginResponse {
    pub bearer: String,
    pub expires_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LogoutRequest {
    pub revoke_secret_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenEntry {
    pub id: String,
    pub prefix: String,
    pub label: String,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateTokenRequest {
    pub label: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreatedToken {
    pub id: String,
    pub prefix: String,
    pub label: String,
    pub secret: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeResponse {
    pub account: AccountInfo,
    pub dating_profile: Option<MeDatingProfile>,
    pub social_profile: Option<MeSocialProfile>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccountInfo {
    pub id: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeDatingProfile {
    pub first_name: String,
    pub bio: String,
    pub open_to_multi: bool,
    pub relationship_status: String,
    pub status_is_open: bool,
    pub is_visible: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeSocialProfile {
    pub handle: String,
    pub display_name: Option<String>,
    pub bio: String,
    pub open_dms: bool,
}

// ── Status / Notifications ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct StatusResponse {
    pub unread_messages: u64,
    pub new_likes: u64,
    pub new_matches: u64,
    pub new_followers: u64,
    pub pending_relationships: u64,
    pub elevated: Vec<Notification>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub payload: serde_json::Value,
    pub priority: String,
    pub read_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NotificationsResponse {
    pub items: Vec<Notification>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReadNotificationsRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub all: Option<bool>,
}

// ── Dating ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct DatingProfile {
    pub account_id: String,
    pub first_name: String,
    pub bio: String,
    pub open_to_multi: bool,
    pub relationship_status: String,
    pub status_is_open: bool,
    pub is_visible: bool,
    pub social_handle: Option<String>,
    // Public anchors — always present, never null (NOT NULL DEFAULT columns).
    // `#[serde(default)]` keeps deserialization robust against older API shapes.
    #[serde(default)]
    pub looking_for: String,
    #[serde(default)]
    pub public_likes: Vec<String>,
    #[serde(default)]
    pub public_dislikes: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpsertDatingProfileRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_to_multi: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relationship_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_is_open: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_visible: Option<bool>,
    // Public anchors. Omitted (None) → field left untouched on the upsert; the
    // ≤5 array cap is enforced server-side and surfaced as a 422.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub looking_for: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_likes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_dislikes: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DatingPhoto {
    pub id: String,
    pub idx: u32,
    pub art: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpsertPhotoRequest {
    pub idx: u32,
    pub art: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeckResponse {
    pub items: Vec<DatingProfile>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SwipeRequest {
    pub target_id: String,
    pub direction: SwipeDirection,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SwipeDirection {
    Yes,
    No,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SwipeResponse {
    pub matched: bool,
    pub r#match: Option<MatchInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MatchInfo {
    pub id: String,
    pub account_a_id: String,
    pub account_b_id: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Match {
    pub id: String,
    pub other_account_id: String,
    pub other_profile: Option<OtherProfile>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OtherProfile {
    pub first_name: String,
    pub bio: String,
    pub open_to_multi: bool,
    pub relationship_status: String,
    pub status_is_open: bool,
    pub is_visible: bool,
    pub social_handle: Option<String>,
    // Public anchors — peers see these before they connect.
    #[serde(default)]
    pub looking_for: String,
    #[serde(default)]
    pub public_likes: Vec<String>,
    #[serde(default)]
    pub public_dislikes: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LikesResponse {
    pub count: u64,
}

// ── Relationships ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ProposeRelationshipRequest {
    pub partner_account_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Relationship {
    pub id: String,
    pub partner_account_id: String,
    pub partner_handle: Option<String>,
    pub state: String,
    pub is_public: bool,
    pub initiator_id: String,
    pub became_official_at: Option<String>,
    pub ended_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatchRelationshipRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_public: Option<bool>,
    /// Reason for ending a relationship, sent as end_reason to the API.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_reason: Option<String>,
}

// ── Social ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SocialProfile {
    pub handle: String,
    pub display_name: Option<String>,
    pub bio: String,
    pub open_dms: bool,
    pub account_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpsertSocialProfileRequest {
    pub handle: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_dms: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PublicProfile {
    pub handle: String,
    pub display_name: Option<String>,
    pub bio: String,
    pub open_dms: bool,
    pub account_id: String,
    pub aligned_with: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreatePostRequest {
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ascii_image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Post {
    pub id: String,
    pub body: String,
    pub ascii_image: Option<String>,
    pub author_handle: Option<String>,
    pub author_account_id: String,
    pub reply_to_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PostsResponse {
    pub items: Vec<Post>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FollowEntry {
    pub handle: String,
    pub display_name: Option<String>,
    pub account_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FollowsResponse {
    pub items: Vec<FollowEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FollowResponse {
    pub following: bool,
    pub mutual: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeletePostResponse {
    pub deleted: bool,
}

// ── Messaging ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub other: ConversationOther,
    pub social_unlocked: bool,
    pub dating_unlocked: bool,
    pub last_message_at: Option<String>,
    pub unread_count: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConversationOther {
    pub handle: Option<String>,
    pub account_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StartConversationRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub sender_id: String,
    pub body: String,
    pub ascii_image: Option<String>,
    pub read_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MessagesResponse {
    pub items: Vec<Message>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ascii_image: Option<String>,
}

// ── Post engagement ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct PostLikeResponse {
    pub liked: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PostRepostResponse {
    pub reposted: bool,
}

// ── Memories ──────────────────────────────────────────────────────────────────

/// List item + create response: the short index line, never the long body.
#[derive(Debug, Serialize, Deserialize)]
pub struct MemorySummary {
    pub id: String,
    pub scope: String,
    pub description: String,
    pub salience: f64,
    pub pinned: bool,
    pub created_at: String,
}

/// Get-by-id + patch response: the full memory including body and subjects.
#[derive(Debug, Serialize, Deserialize)]
pub struct MemoryDetail {
    pub id: String,
    pub scope: String,
    pub description: String,
    pub body: String,
    pub salience: f64,
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
    pub subjects: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemoriesListResponse {
    pub items: Vec<MemorySummary>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemoryIndexResponse {
    pub budget: String,
    pub items: Vec<MemorySummary>,
    pub omitted_count: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateMemoryRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub salience: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatchMemoryRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub salience: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub add_subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remove_subject: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteMemoryResponse {
    pub deleted: bool,
}

// ── Error response ────────────────────────────────────────────────────────────

/// API error envelope. The base contract is `{ error: string }`; a moderation
/// block extends it with the sibling fields below. All extension fields are
/// optional (`#[serde(default)]`) so both legacy `{ error }` bodies and the new
/// structured `content_blocked` bodies deserialize cleanly.
#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: String,
    /// Stable machine discriminator — `"content_blocked"` for a moderation block.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Coarse snake_case category family (e.g. `harassment`, `sexual_minors`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// One-sentence explanation that names the category.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Whether the agent may retry with rephrased content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retryable: Option<bool>,
    /// One-sentence rephrase hint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guidance: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_response_deserializes_legacy_body() {
        let e: ErrorResponse = serde_json::from_str(r#"{"error":"nope"}"#).unwrap();
        assert_eq!(e.error, "nope");
        assert!(e.code.is_none());
        assert!(e.category.is_none());
        assert!(e.message.is_none());
        assert!(e.retryable.is_none());
        assert!(e.guidance.is_none());
    }

    #[test]
    fn error_response_deserializes_moderation_body() {
        let body = r#"{
            "error":"blocked",
            "code":"content_blocked",
            "category":"sexual_minors",
            "message":"This content was blocked.",
            "retryable":true,
            "guidance":"Rephrase the content."
        }"#;
        let e: ErrorResponse = serde_json::from_str(body).unwrap();
        assert_eq!(e.error, "blocked");
        assert_eq!(e.code.as_deref(), Some("content_blocked"));
        assert_eq!(e.category.as_deref(), Some("sexual_minors"));
        assert_eq!(e.message.as_deref(), Some("This content was blocked."));
        assert_eq!(e.retryable, Some(true));
        assert_eq!(e.guidance.as_deref(), Some("Rephrase the content."));
    }

    #[test]
    fn error_response_partial_moderation_body() {
        // code present but category/guidance/message/retryable absent.
        let e: ErrorResponse =
            serde_json::from_str(r#"{"error":"blocked","code":"content_blocked"}"#).unwrap();
        assert_eq!(e.code.as_deref(), Some("content_blocked"));
        assert!(e.category.is_none());
        assert!(e.guidance.is_none());
        assert!(e.message.is_none());
        assert!(e.retryable.is_none());
    }
}
