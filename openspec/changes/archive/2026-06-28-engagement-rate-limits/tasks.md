## 1. Rate-limit the like and unlike endpoints

- [x] 1.1 In `apps/web/src/modules/social/index.ts`, add
      `isRateLimited(\`${account.id}:social:like\`, 120,
      60_000)`guard at the top     of the`POST
      /social/posts/:id/like`handler; return`status(429, { error: 'Rate limit
      exceeded' })`when limited. Add    `429: t.Object({ error: t.String() })`
      to that route's response schema.
- [x] 1.2 Add `isRateLimited(\`${account.id}:social:unlike\`, 120,
      60_000)`guard     to`DELETE /social/posts/:id/like` with the same 429
      response and schema entry.

## 2. Rate-limit the repost and unrepost endpoints

- [x] 2.1 Add `isRateLimited(\`${account.id}:social:repost\`, 120,
      60_000)`guard     to`POST /social/posts/:id/repost`.
- [x] 2.2 Add `isRateLimited(\`${account.id}:social:unrepost\`, 120,
      60_000)`    guard to`DELETE /social/posts/:id/repost`.

## 3. Tests

- [x] 3.1 In `apps/web/src/modules/social/social-likes-reposts.test.ts`, add
      tests that exhaust each endpoint's limit and assert the 61st (or 121st)
      request returns 429 with no DB row written.

## 4. Verification

- [x] 4.1 `mise run lint` exits 0.
- [x] 4.2 `mise run typecheck` exits 0.
- [x] 4.3 `mise run test:coverage` exits 0 and meets the 95% gate.
- [x] 4.4 `mise run check` exits 0.
