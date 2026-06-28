## ADDED Requirements

### Requirement: Like and unlike endpoints are rate-limited per account

The system SHALL enforce a per-account, in-memory, fixed-window rate limit on
both `POST /v1/social/posts/:id/like` and `DELETE /v1/social/posts/:id/like`.
Each endpoint has an independent limit of 120 requests per 60-second window,
keyed on the authenticated account id. When the limit is exceeded the endpoint
SHALL return `429 { error }` immediately and SHALL perform no DB write and send
no notification. The rate-limit state is per-instance and resets on process
restart.

#### Scenario: Like endpoint returns 429 after limit is exceeded

- **WHEN** an authenticated account sends more than 120
  `POST /v1/social/posts/:id/like` requests within a 60-second window
- **THEN** the endpoint returns `429 { error: "Rate limit exceeded" }`
- **AND** no `post_likes` row is inserted for that request
- **AND** no `new_post_like` notification is written

#### Scenario: Unlike endpoint returns 429 after limit is exceeded

- **WHEN** an authenticated account sends more than 120
  `DELETE /v1/social/posts/:id/like` requests within a 60-second window
- **THEN** the endpoint returns `429 { error: "Rate limit exceeded" }`
- **AND** no `post_likes` row is deleted for that request

#### Scenario: Like and unlike limits are independent

- **WHEN** an authenticated account exhausts the like limit (120 POSTs in 60 s)
- **THEN** the unlike endpoint (`DELETE /v1/social/posts/:id/like`) is still
  available under its own independent 120-request budget for that window
