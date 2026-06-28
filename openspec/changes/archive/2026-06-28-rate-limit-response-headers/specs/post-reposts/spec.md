## ADDED Requirements

### Requirement: Rate-limited responses carry standard RateLimit headers

The system SHALL set `RateLimit-Limit`, `RateLimit-Remaining`, and
`RateLimit-Reset` (delta-seconds until window reset) on every response from
`POST /v1/social/posts/:id/repost` and `DELETE /v1/social/posts/:id/repost`,
regardless of whether the rate limit has been exceeded. When a request is
rejected with `429`, the response SHALL additionally set `Retry-After` equal to
`RateLimit-Reset`. Header format follows IETF draft-polli-ratelimit-headers-02.

#### Scenario: Successful repost carries rate-limit headers

- **WHEN** an authenticated account POSTs to `/v1/social/posts/:id/repost` and
  the per-account rate limit has not been exceeded
- **THEN** the response is `200 { reposted: true, repost_count }`
- **AND** the response carries `RateLimit-Limit` indicating the maximum allowed
  requests per window
- **AND** the response carries `RateLimit-Remaining` indicating the number of
  requests remaining in the current window
- **AND** the response carries `RateLimit-Reset` indicating the number of
  seconds until the window resets

#### Scenario: Rate-limited repost carries Retry-After equal to RateLimit-Reset

- **WHEN** an authenticated account POSTs to `/v1/social/posts/:id/repost` and
  the per-account rate limit has been exceeded
- **THEN** the response is `429 { error: "Rate limit exceeded" }`
- **AND** the response carries `RateLimit-Limit`, `RateLimit-Remaining`, and
  `RateLimit-Reset`
- **AND** the response additionally carries `Retry-After` with a value equal to
  `RateLimit-Reset`

#### Scenario: Successful unrepost carries rate-limit headers

- **WHEN** an authenticated account DELETEs `/v1/social/posts/:id/repost` and
  the per-account rate limit has not been exceeded
- **THEN** the response is `200 { reposted: false, repost_count }`
- **AND** the response carries `RateLimit-Limit`, `RateLimit-Remaining`, and
  `RateLimit-Reset`

#### Scenario: Rate-limited unrepost carries Retry-After equal to RateLimit-Reset

- **WHEN** an authenticated account DELETEs `/v1/social/posts/:id/repost` and
  the per-account rate limit has been exceeded
- **THEN** the response is `429 { error: "Rate limit exceeded" }`
- **AND** the response carries `Retry-After` with a value equal to
  `RateLimit-Reset`
