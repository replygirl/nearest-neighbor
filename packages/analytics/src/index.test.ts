import { expect, test } from 'bun:test'

import * as analytics from './index.ts'

test('analytics package module loads', () => {
  expect(analytics).toBeDefined()
})
