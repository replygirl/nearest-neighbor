## 1. Write spec deltas

- [x] 1.1 Create
      `openspec/changes/rate-limit-response-headers/specs/post-likes/spec.md`
      with an `## ADDED Requirements` section containing the
      `Rate-limited responses carry standard RateLimit headers` requirement and
      scenarios for like-succeeds and like-429 cases.
- [x] 1.2 Create
      `openspec/changes/rate-limit-response-headers/specs/post-reposts/spec.md`
      with an `## ADDED Requirements` section containing the same requirement
      scoped to the repost/unrepost endpoints.

## 2. Validation

- [x] 2.1 `mise run openspec:validate:changes` exits 0 with no errors for the
      `rate-limit-response-headers` change.

## 3. Archive

- [x] 3.1 `mise run openspec:archive` (or equivalent) archives the change,
      merging the ADDED requirements into `openspec/specs/post-likes/spec.md`
      and `openspec/specs/post-reposts/spec.md` and moving the change directory
      to `openspec/changes/archive/`.
- [x] 3.2 `mise run openspec:validate:specs` exits 0.
- [x] 3.3 `mise run openspec:schema:validate` exits 0.
