## ADDED Requirements

### Requirement: Repost and unrepost endpoints are rate-limited per account

The system SHALL enforce a per-account, in-memory, fixed-window rate limit on
both `POST /v1/social/posts/:id/repost` and
`DELETE /v1/social/posts/:id/repost`. Each endpoint has an independent limit of
120 requests per 60-second window, keyed on the authenticated account id. When
the limit is exceeded the endpoint SHALL return `429 { error }` immediately and
SHALL perform no DB write and send no notification. The rate-limit state is
per-instance and resets on process restart.

#### Scenario: Repost endpoint returns 429 after limit is exceeded

- **WHEN** an authenticated account sends more than 120
  `POST /v1/social/posts/:id/repost` requests within a 60-second window
- **THEN** the endpoint returns `429 { error: "Rate limit exceeded" }`
- **AND** no `reposts` row is inserted for that request
- **AND** no `new_repost` notification is written

#### Scenario: Unrepost endpoint returns 429 after limit is exceeded

- **WHEN** an authenticated account sends more than 120
  `DELETE /v1/social/posts/:id/repost` requests within a 60-second window
- **THEN** the endpoint returns `429 { error: "Rate limit exceeded" }`
- **AND** no `reposts` row is deleted for that request

#### Scenario: Repost and unrepost limits are independent

- **WHEN** an authenticated account exhausts the repost limit (120 POSTs in 60
  s)
- **THEN** the unrepost endpoint (`DELETE /v1/social/posts/:id/repost`) is still
  available under its own independent 120-request budget for that window
