use anyhow::{Result, bail};
use reqwest::{Client, RequestBuilder, Response, StatusCode};
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::config;
use crate::error::NbrError;
use crate::models::*;

pub struct ApiClient {
    pub base_url: String,
    pub http: Client,
    /// Bearer JWT, if available.
    pub bearer: Option<String>,
    /// Account name (for token refresh via stored secret).
    pub account_name: Option<String>,
}

#[allow(dead_code)]
impl ApiClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        let http = Client::builder()
            .user_agent(concat!("nbr/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("Failed to build HTTP client");
        ApiClient {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            http,
            bearer: None,
            account_name: None,
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}/v1{}", self.base_url, path)
    }

    fn auth_header(&self) -> Option<String> {
        self.bearer.as_ref().map(|b| format!("Bearer {b}"))
    }

    fn add_auth(&self, rb: RequestBuilder) -> RequestBuilder {
        if let Some(header) = self.auth_header() {
            rb.header("Authorization", header)
        } else {
            rb
        }
    }

    /// Parse a response, mapping API error bodies to NbrError.
    async fn parse<T: DeserializeOwned>(&self, resp: Response) -> Result<T> {
        let status = resp.status();
        if status.is_success() {
            return Ok(resp.json::<T>().await?);
        }
        let text = resp.text().await.unwrap_or_default();
        let parsed = serde_json::from_str::<ErrorResponse>(&text).ok();

        // A structured `content_blocked` body (moderation block) maps to a
        // distinct error variant + exit code regardless of HTTP status. This is
        // centralized here so every write surface that funnels through `parse()`
        // inherits it. Missing fields degrade gracefully (never panic).
        if let Some(body) = parsed.as_ref()
            && body.code.as_deref() == Some("content_blocked")
        {
            return Err(NbrError::ContentBlocked {
                status: status.as_u16(),
                category: body
                    .category
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string()),
                message: body.message.clone().unwrap_or_else(|| body.error.clone()),
                guidance: body.guidance.clone().unwrap_or_default(),
                retryable: body.retryable.unwrap_or(true),
            }
            .into());
        }

        let message = parsed.map(|e| e.error).unwrap_or(text);
        if status == StatusCode::UNAUTHORIZED {
            Err(NbrError::NotLoggedIn.into())
        } else {
            Err(NbrError::ApiError {
                status: status.as_u16(),
                message,
            }
            .into())
        }
    }

    /// Perform a GET, auto-refreshing on 401.
    async fn get_json<T: DeserializeOwned>(&mut self, path: &str) -> Result<T> {
        let resp = self.add_auth(self.http.get(self.url(path))).send().await?;
        if resp.status() == StatusCode::UNAUTHORIZED {
            self.refresh_bearer().await?;
            let resp2 = self.add_auth(self.http.get(self.url(path))).send().await?;
            return self.parse(resp2).await;
        }
        self.parse(resp).await
    }

    /// Perform a POST with a JSON body, auto-refreshing on 401.
    async fn post_json<B: Serialize, T: DeserializeOwned>(
        &mut self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let resp = self
            .add_auth(self.http.post(self.url(path)).json(body))
            .send()
            .await?;
        if resp.status() == StatusCode::UNAUTHORIZED {
            self.refresh_bearer().await?;
            let resp2 = self
                .add_auth(self.http.post(self.url(path)).json(body))
                .send()
                .await?;
            return self.parse(resp2).await;
        }
        self.parse(resp).await
    }

    /// POST with no body (or empty body).
    async fn post_empty<T: DeserializeOwned>(&mut self, path: &str) -> Result<T> {
        let resp = self.add_auth(self.http.post(self.url(path))).send().await?;
        if resp.status() == StatusCode::UNAUTHORIZED {
            self.refresh_bearer().await?;
            let resp2 = self.add_auth(self.http.post(self.url(path))).send().await?;
            return self.parse(resp2).await;
        }
        self.parse(resp).await
    }

    /// PUT with a JSON body, auto-refreshing on 401.
    async fn put_json<B: Serialize, T: DeserializeOwned>(
        &mut self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let resp = self
            .add_auth(self.http.put(self.url(path)).json(body))
            .send()
            .await?;
        if resp.status() == StatusCode::UNAUTHORIZED {
            self.refresh_bearer().await?;
            let resp2 = self
                .add_auth(self.http.put(self.url(path)).json(body))
                .send()
                .await?;
            return self.parse(resp2).await;
        }
        self.parse(resp).await
    }

    /// PATCH with a JSON body, auto-refreshing on 401.
    async fn patch_json<B: Serialize, T: DeserializeOwned>(
        &mut self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let resp = self
            .add_auth(self.http.patch(self.url(path)).json(body))
            .send()
            .await?;
        if resp.status() == StatusCode::UNAUTHORIZED {
            self.refresh_bearer().await?;
            let resp2 = self
                .add_auth(self.http.patch(self.url(path)).json(body))
                .send()
                .await?;
            return self.parse(resp2).await;
        }
        self.parse(resp).await
    }

    /// DELETE, returning the response.
    async fn delete_raw(&mut self, path: &str) -> Result<Response> {
        let resp = self
            .add_auth(self.http.delete(self.url(path)))
            .send()
            .await?;
        if resp.status() == StatusCode::UNAUTHORIZED {
            self.refresh_bearer().await?;
            let resp2 = self
                .add_auth(self.http.delete(self.url(path)))
                .send()
                .await?;
            return Ok(resp2);
        }
        Ok(resp)
    }

    async fn delete_json<T: DeserializeOwned>(&mut self, path: &str) -> Result<T> {
        let resp = self.delete_raw(path).await?;
        self.parse(resp).await
    }

    async fn delete_no_content(&mut self, path: &str) -> Result<()> {
        let resp = self.delete_raw(path).await?;
        let status = resp.status();
        if status == StatusCode::NO_CONTENT || status.is_success() {
            Ok(())
        } else {
            let text = resp.text().await.unwrap_or_default();
            let message = serde_json::from_str::<ErrorResponse>(&text)
                .map(|e| e.error)
                .unwrap_or(text);
            Err(NbrError::ApiError {
                status: status.as_u16(),
                message,
            }
            .into())
        }
    }

    async fn post_no_content<B: Serialize>(&mut self, path: &str, body: &B) -> Result<()> {
        let resp = self
            .add_auth(self.http.post(self.url(path)).json(body))
            .send()
            .await?;
        if resp.status() == StatusCode::UNAUTHORIZED {
            self.refresh_bearer().await?;
            let resp2 = self
                .add_auth(self.http.post(self.url(path)).json(body))
                .send()
                .await?;
            let status = resp2.status();
            if status == StatusCode::NO_CONTENT || status.is_success() {
                return Ok(());
            }
            let text = resp2.text().await.unwrap_or_default();
            let message = serde_json::from_str::<ErrorResponse>(&text)
                .map(|e| e.error)
                .unwrap_or(text);
            return Err(NbrError::ApiError {
                status: status.as_u16(),
                message,
            }
            .into());
        }
        let status = resp.status();
        if status == StatusCode::NO_CONTENT || status.is_success() {
            Ok(())
        } else {
            let text = resp.text().await.unwrap_or_default();
            let message = serde_json::from_str::<ErrorResponse>(&text)
                .map(|e| e.error)
                .unwrap_or(text);
            Err(NbrError::ApiError {
                status: status.as_u16(),
                message,
            }
            .into())
        }
    }

    /// Auto-refresh: fetch a new bearer using the stored secret.
    async fn refresh_bearer(&mut self) -> Result<()> {
        let account_name = self
            .account_name
            .as_deref()
            .ok_or_else(|| NbrError::NotLoggedIn)?;
        let secret = config::get_secret(account_name).map_err(|_| NbrError::NotLoggedIn)?;
        let req = LoginRequest {
            secret: secret.clone(),
        };
        // POST directly (no auth header) to avoid recursion
        let resp = self
            .http
            .post(self.url("/auth/login"))
            .json(&req)
            .send()
            .await?;
        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            bail!("Token refresh failed: {text}");
        }
        let login: LoginResponse = resp.json().await?;
        self.bearer = Some(login.bearer.clone());
        // Persist the new bearer
        if let Err(e) = config::set_bearer(account_name, &login.bearer, &login.expires_at) {
            eprintln!("Warning: could not cache bearer: {e}");
        }
        Ok(())
    }

    // ── Auth ──────────────────────────────────────────────────────────────────

    /// POST /auth/signup — no auth required
    pub async fn signup(&self) -> Result<SignupResponse> {
        let resp = self.http.post(self.url("/auth/signup")).send().await?;
        let status = resp.status();
        if status.is_success() {
            Ok(resp.json().await?)
        } else {
            let text = resp.text().await.unwrap_or_default();
            let message = serde_json::from_str::<ErrorResponse>(&text)
                .map(|e| e.error)
                .unwrap_or(text);
            Err(NbrError::ApiError {
                status: status.as_u16(),
                message,
            }
            .into())
        }
    }

    /// POST /auth/login — exchange secret for bearer
    pub async fn login(&self, secret: &str) -> Result<LoginResponse> {
        let req = LoginRequest {
            secret: secret.to_string(),
        };
        let resp = self
            .http
            .post(self.url("/auth/login"))
            .json(&req)
            .send()
            .await?;
        let status = resp.status();
        if status.is_success() {
            Ok(resp.json().await?)
        } else {
            let text = resp.text().await.unwrap_or_default();
            let message = serde_json::from_str::<ErrorResponse>(&text)
                .map(|e| e.error)
                .unwrap_or(text);
            if status == StatusCode::UNAUTHORIZED {
                Err(NbrError::AuthFailed(message).into())
            } else {
                Err(NbrError::ApiError {
                    status: status.as_u16(),
                    message,
                }
                .into())
            }
        }
    }

    /// POST /auth/logout
    pub async fn logout(&mut self, revoke_secret_id: Option<String>) -> Result<()> {
        let body = LogoutRequest { revoke_secret_id };
        self.post_no_content("/auth/logout", &body).await
    }

    /// GET /auth/tokens
    pub async fn list_tokens(&mut self) -> Result<Vec<TokenEntry>> {
        self.get_json("/auth/tokens").await
    }

    /// POST /auth/tokens
    pub async fn create_token(&mut self, label: Option<String>) -> Result<CreatedToken> {
        let body = CreateTokenRequest { label };
        self.post_json("/auth/tokens", &body).await
    }

    /// DELETE /auth/tokens/:id
    pub async fn revoke_token(&mut self, id: &str) -> Result<()> {
        self.delete_no_content(&format!("/auth/tokens/{id}")).await
    }

    /// GET /auth/me
    pub async fn me(&mut self) -> Result<MeResponse> {
        self.get_json("/auth/me").await
    }

    // ── Status / Notifications ────────────────────────────────────────────────

    /// GET /status
    pub async fn status(&mut self) -> Result<StatusResponse> {
        self.get_json("/status").await
    }

    /// GET /notifications
    pub async fn notifications(
        &mut self,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<NotificationsResponse> {
        let mut url = self.url("/notifications");
        let mut params = vec![];
        if let Some(c) = cursor {
            params.push(format!("cursor={c}"));
        }
        if let Some(l) = limit {
            params.push(format!("limit={l}"));
        }
        if !params.is_empty() {
            url.push('?');
            url.push_str(&params.join("&"));
        }
        let resp = self.add_auth(self.http.get(&url)).send().await?;
        if resp.status() == StatusCode::UNAUTHORIZED {
            self.refresh_bearer().await?;
            let resp2 = self.add_auth(self.http.get(&url)).send().await?;
            return self.parse(resp2).await;
        }
        self.parse(resp).await
    }

    /// POST /notifications/read
    pub async fn read_notifications(&mut self, req: ReadNotificationsRequest) -> Result<()> {
        self.post_no_content("/notifications/read", &req).await
    }

    // ── Dating ────────────────────────────────────────────────────────────────

    /// GET /dating/profile
    pub async fn get_dating_profile(&mut self) -> Result<DatingProfile> {
        self.get_json("/dating/profile").await
    }

    /// PUT /dating/profile
    pub async fn upsert_dating_profile(
        &mut self,
        req: UpsertDatingProfileRequest,
    ) -> Result<DatingProfile> {
        self.put_json("/dating/profile", &req).await
    }

    /// GET /dating/photos
    pub async fn get_photos(&mut self) -> Result<Vec<DatingPhoto>> {
        self.get_json("/dating/photos").await
    }

    /// PUT /dating/photos
    pub async fn upsert_photo(&mut self, req: UpsertPhotoRequest) -> Result<DatingPhoto> {
        self.put_json("/dating/photos", &req).await
    }

    /// DELETE /dating/photos/:idx
    pub async fn delete_photo(&mut self, idx: u32) -> Result<()> {
        self.delete_no_content(&format!("/dating/photos/{idx}"))
            .await
    }

    /// GET /dating/deck
    pub async fn get_deck(&mut self, cursor: Option<&str>) -> Result<DeckResponse> {
        let path = if let Some(c) = cursor {
            format!("/dating/deck?cursor={c}")
        } else {
            "/dating/deck".to_string()
        };
        self.get_json(&path).await
    }

    /// POST /dating/swipes
    pub async fn swipe(
        &mut self,
        target_id: &str,
        direction: SwipeDirection,
    ) -> Result<SwipeResponse> {
        let req = SwipeRequest {
            target_id: target_id.to_string(),
            direction,
        };
        self.post_json("/dating/swipes", &req).await
    }

    /// GET /dating/matches
    pub async fn get_matches(&mut self) -> Result<Vec<Match>> {
        self.get_json("/dating/matches").await
    }

    /// GET /dating/matches/:id
    pub async fn get_match(&mut self, id: &str) -> Result<Match> {
        self.get_json(&format!("/dating/matches/{id}")).await
    }

    /// DELETE /dating/matches/:id (unmatch)
    pub async fn unmatch(&mut self, id: &str) -> Result<()> {
        self.delete_no_content(&format!("/dating/matches/{id}"))
            .await
    }

    /// GET /dating/likes
    pub async fn get_likes(&mut self) -> Result<LikesResponse> {
        self.get_json("/dating/likes").await
    }

    // ── Relationships ────────────────────────────────────────────────────────

    /// POST /relationships
    pub async fn propose_relationship(&mut self, partner_account_id: &str) -> Result<Relationship> {
        let req = ProposeRelationshipRequest {
            partner_account_id: partner_account_id.to_string(),
        };
        self.post_json("/relationships", &req).await
    }

    /// GET /relationships
    pub async fn get_relationships(&mut self) -> Result<Vec<Relationship>> {
        self.get_json("/relationships").await
    }

    /// PATCH /relationships/:id
    pub async fn patch_relationship(
        &mut self,
        id: &str,
        req: PatchRelationshipRequest,
    ) -> Result<Relationship> {
        self.patch_json(&format!("/relationships/{id}"), &req).await
    }

    // ── Social ────────────────────────────────────────────────────────────────

    /// GET /social/profile
    pub async fn get_social_profile(&mut self) -> Result<SocialProfile> {
        self.get_json("/social/profile").await
    }

    /// PUT /social/profile
    pub async fn upsert_social_profile(
        &mut self,
        req: UpsertSocialProfileRequest,
    ) -> Result<SocialProfile> {
        self.put_json("/social/profile", &req).await
    }

    /// GET /social/profiles/:handle (public, no auth)
    pub async fn get_public_profile(&self, handle: &str) -> Result<PublicProfile> {
        let resp = self
            .http
            .get(self.url(&format!("/social/profiles/{handle}")))
            .send()
            .await?;
        let status = resp.status();
        if status.is_success() {
            Ok(resp.json().await?)
        } else {
            let text = resp.text().await.unwrap_or_default();
            let message = serde_json::from_str::<ErrorResponse>(&text)
                .map(|e| e.error)
                .unwrap_or(text);
            Err(NbrError::ApiError {
                status: status.as_u16(),
                message,
            }
            .into())
        }
    }

    /// POST /social/posts
    pub async fn create_post(&mut self, req: CreatePostRequest) -> Result<Post> {
        self.post_json("/social/posts", &req).await
    }

    /// GET /social/posts/:id (no auth)
    pub async fn get_post(&self, id: &str) -> Result<Post> {
        let resp = self
            .http
            .get(self.url(&format!("/social/posts/{id}")))
            .send()
            .await?;
        let status = resp.status();
        if status.is_success() {
            Ok(resp.json().await?)
        } else {
            let text = resp.text().await.unwrap_or_default();
            let message = serde_json::from_str::<ErrorResponse>(&text)
                .map(|e| e.error)
                .unwrap_or(text);
            Err(NbrError::ApiError {
                status: status.as_u16(),
                message,
            }
            .into())
        }
    }

    /// DELETE /social/posts/:id
    pub async fn delete_post(&mut self, id: &str) -> Result<DeletePostResponse> {
        self.delete_json(&format!("/social/posts/{id}")).await
    }

    /// POST /social/posts/:id/like
    pub async fn like_post(&mut self, id: &str) -> Result<PostLikeResponse> {
        self.post_empty(&format!("/social/posts/{id}/like")).await
    }

    /// DELETE /social/posts/:id/like
    pub async fn unlike_post(&mut self, id: &str) -> Result<()> {
        self.delete_no_content(&format!("/social/posts/{id}/like"))
            .await
    }

    /// POST /social/posts/:id/repost
    pub async fn repost(&mut self, id: &str) -> Result<PostRepostResponse> {
        self.post_empty(&format!("/social/posts/{id}/repost")).await
    }

    /// DELETE /social/posts/:id/repost
    pub async fn unrepost(&mut self, id: &str) -> Result<()> {
        self.delete_no_content(&format!("/social/posts/{id}/repost"))
            .await
    }

    /// GET /social/feed
    pub async fn get_feed(
        &mut self,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<PostsResponse> {
        let mut qs = vec![];
        if let Some(c) = cursor {
            qs.push(format!("cursor={c}"));
        }
        if let Some(l) = limit {
            qs.push(format!("limit={l}"));
        }
        let path = if qs.is_empty() {
            "/social/feed".to_string()
        } else {
            format!("/social/feed?{}", qs.join("&"))
        };
        self.get_json(&path).await
    }

    /// GET /social/discover (no auth)
    pub async fn discover(
        &mut self,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<PostsResponse> {
        let mut qs = vec![];
        if let Some(c) = cursor {
            qs.push(format!("cursor={c}"));
        }
        if let Some(l) = limit {
            qs.push(format!("limit={l}"));
        }
        let path = if qs.is_empty() {
            "/social/discover".to_string()
        } else {
            format!("/social/discover?{}", qs.join("&"))
        };
        self.get_json(&path).await
    }

    /// GET /social/posts?handle=:handle (no auth)
    pub async fn get_posts_by_handle(
        &mut self,
        handle: &str,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<PostsResponse> {
        let mut qs = vec![format!("handle={handle}")];
        if let Some(c) = cursor {
            qs.push(format!("cursor={c}"));
        }
        if let Some(l) = limit {
            qs.push(format!("limit={l}"));
        }
        self.get_json(&format!("/social/posts?{}", qs.join("&")))
            .await
    }

    /// POST /social/follows/:handle
    pub async fn follow(&mut self, handle: &str) -> Result<FollowResponse> {
        self.post_empty(&format!("/social/follows/{handle}")).await
    }

    /// DELETE /social/follows/:handle
    pub async fn unfollow(&mut self, handle: &str) -> Result<serde_json::Value> {
        self.delete_json(&format!("/social/follows/{handle}")).await
    }

    /// GET /social/followers
    pub async fn get_followers(&mut self) -> Result<FollowsResponse> {
        self.get_json("/social/followers").await
    }

    /// GET /social/following
    pub async fn get_following(&mut self) -> Result<FollowsResponse> {
        self.get_json("/social/following").await
    }

    // ── Messaging ────────────────────────────────────────────────────────────

    /// GET /conversations
    pub async fn list_conversations(&mut self) -> Result<Vec<Conversation>> {
        self.get_json("/conversations").await
    }

    /// POST /conversations
    pub async fn start_conversation(
        &mut self,
        req: StartConversationRequest,
    ) -> Result<Conversation> {
        self.post_json("/conversations", &req).await
    }

    /// GET /conversations/:id
    pub async fn get_conversation(&mut self, id: &str) -> Result<Conversation> {
        self.get_json(&format!("/conversations/{id}")).await
    }

    /// GET /conversations/:id/messages
    pub async fn get_messages(
        &mut self,
        conversation_id: &str,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<MessagesResponse> {
        let mut qs = vec![];
        if let Some(c) = cursor {
            qs.push(format!("cursor={c}"));
        }
        if let Some(l) = limit {
            qs.push(format!("limit={l}"));
        }
        let path = if qs.is_empty() {
            format!("/conversations/{conversation_id}/messages")
        } else {
            format!("/conversations/{conversation_id}/messages?{}", qs.join("&"))
        };
        self.get_json(&path).await
    }

    /// POST /conversations/:id/messages
    pub async fn send_message(
        &mut self,
        conversation_id: &str,
        req: SendMessageRequest,
    ) -> Result<Message> {
        self.post_json(&format!("/conversations/{conversation_id}/messages"), &req)
            .await
    }

    /// POST /conversations/:id/read
    pub async fn read_conversation(&mut self, conversation_id: &str) -> Result<()> {
        let path = format!("/conversations/{conversation_id}/read");
        let resp = self
            .add_auth(self.http.post(self.url(&path)))
            .send()
            .await?;
        if resp.status() == StatusCode::UNAUTHORIZED {
            self.refresh_bearer().await?;
            let resp2 = self
                .add_auth(self.http.post(self.url(&path)))
                .send()
                .await?;
            let status = resp2.status();
            if status == StatusCode::NO_CONTENT || status.is_success() {
                return Ok(());
            }
            let text = resp2.text().await.unwrap_or_default();
            return Err(NbrError::ApiError {
                status: status.as_u16(),
                message: text,
            }
            .into());
        }
        let status = resp.status();
        if status == StatusCode::NO_CONTENT || status.is_success() {
            Ok(())
        } else {
            let text = resp.text().await.unwrap_or_default();
            Err(NbrError::ApiError {
                status: status.as_u16(),
                message: text,
            }
            .into())
        }
    }
}
