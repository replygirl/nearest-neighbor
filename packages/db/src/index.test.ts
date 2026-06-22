import { expect, test } from 'bun:test'

import * as db from './index.ts'

test('db package module loads', () => {
  expect(db).toBeDefined()
})
