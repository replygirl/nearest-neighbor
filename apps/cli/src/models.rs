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

// ── Error response ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: String,
}
