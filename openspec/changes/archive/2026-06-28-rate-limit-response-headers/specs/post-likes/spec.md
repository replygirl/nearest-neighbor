## ADDED Requirements

### Requirement: Rate-limited responses carry standard RateLimit headers

The system SHALL set `RateLimit-Limit`, `RateLimit-Remaining`, and
`RateLimit-Reset` (delta-seconds until window reset) on every response from
`POST /v1/social/posts/:id/like` and `DELETE /v1/social/posts/:id/like`,
regardless of whether the rate limit has been exceeded. When a request is
rejected with `429`, the response SHALL additionally set `Retry-After` equal to
`RateLimit-Reset`. Header format follows IETF draft-polli-ratelimit-headers-02.

#### Scenario: Successful like carries rate-limit headers

- **WHEN** an authenticated account POSTs to `/v1/social/posts/:id/like` and the
  per-account rate limit has not been exceeded
- **THEN** the response is `200 { liked: true, like_count }`
- **AND** the response carries `RateLimit-Limit` indicating the maximum allowed
  requests per window
- **AND** the response carries `RateLimit-Remaining` indicating the number of
  requests remaining in the current window
- **AND** the response carries `RateLimit-Reset` indicating the number of
  seconds until the window resets

#### Scenario: Rate-limited like carries Retry-After equal to RateLimit-Reset

- **WHEN** an authenticated account POSTs to `/v1/social/posts/:id/like` and the
  per-account rate limit has been exceeded
- **THEN** the response is `429 { error: "Rate limit exceeded" }`
- **AND** the response carries `RateLimit-Limit`, `RateLimit-Remaining`, and
  `RateLimit-Reset`
- **AND** the response additionally carries `Retry-After` with a value equal to
  `RateLimit-Reset`

#### Scenario: Successful unlike carries rate-limit headers

- **WHEN** an authenticated account DELETEs `/v1/social/posts/:id/like` and the
  per-account rate limit has not been exceeded
- **THEN** the response is `200 { liked: false, like_count }`
- **AND** the response carries `RateLimit-Limit`, `RateLimit-Remaining`, and
  `RateLimit-Reset`

#### Scenario: Rate-limited unlike carries Retry-After equal to RateLimit-Reset

- **WHEN** an authenticated account DELETEs `/v1/social/posts/:id/like` and the
  per-account rate limit has been exceeded
- **THEN** the response is `429 { error: "Rate limit exceeded" }`
- **AND** the response carries `Retry-After` with a value equal to
  `RateLimit-Reset`
