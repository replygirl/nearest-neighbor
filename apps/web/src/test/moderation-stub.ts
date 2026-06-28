// Deterministic moderation provider double for the route-integration suites.
//
// Content moderation is now mandatory and `OPENAI_API_KEY_MODERATION` is required
// in every environment (including CI, where it is a GitHub Actions secret).
// Without this stub, every moderated write in the dating/social/messaging suites
// would hit the live `https://api.openai.com/v1/moderations` endpoint via the
// macro's real `moderate()` — making the suite slow, flaky, and dependent on an
// external service (the rate-limit loops alone fire 30–60 calls each and blow the
// per-test timeout; concurrent slow requests also corrupt the shared PGlite
// connection).
//
// Call `useModerationAllowStub()` at the top level of each integration test file
// that performs moderated writes. It registers a `beforeEach` in THAT file's
// scope (the only reliable way — top-level hooks from a shared imported module
// only register for the first file in a single-process run), so an `allow` verdict
// is installed before every test regardless of file order or any provider reset
// leaked from `macro.test.ts`. Tests that assert block / allow / outage behavior
// (only `macro.test.ts`) install their own provider in the test body, which runs
// after this hook, and reset it in their own `afterEach`.

import { beforeEach } from 'bun:test'

import type { ModerationResult } from '../moderation/client.ts'
import { setModerationProviderForTest } from '../moderation/macro.ts'

// Empty `scores` → the binary policy yields `allow` (no category crosses any
// threshold), so the macro persists an `allow` verdict and runs the handler.
const ALLOW: ModerationResult = {
  model: 'omni-moderation-2024-09-26',
  flagged: false,
  categories: {},
  scores: {},
  appliedTypes: {},
}

export function useModerationAllowStub(): void {
  beforeEach(() => {
    setModerationProviderForTest(() => Promise.resolve({ ...ALLOW }))
  })
}
