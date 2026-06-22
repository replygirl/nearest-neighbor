import { afterEach, describe, expect, test } from 'bun:test'

// We import as a namespace so we can test module-level behavior.
// posthog-node is the real SDK; we verify no-op behavior without a key.

describe('getPostHogClient', () => {
  afterEach(() => {
    // Reset singleton between tests by reimporting (via module cache bust)
    delete process.env['POSTHOG_KEY']
    delete process.env['POSTHOG_HOST']
  })

  test('returns null when POSTHOG_KEY is absent', async () => {
    delete process.env['POSTHOG_KEY']
    // Dynamic import so each test gets a fresh module evaluation path.
    // Bun caches modules, so we rely on the exported function checking env at call time.
    const { getPostHogClient } = await import('./node.ts')
    const client = getPostHogClient()
    expect(client).toBeNull()
  })

  test('returns null consistently when key remains absent', async () => {
    delete process.env['POSTHOG_KEY']
    const { getPostHogClient } = await import('./node.ts')
    expect(getPostHogClient()).toBeNull()
    expect(getPostHogClient()).toBeNull()
  })
})

describe('captureServerEvent', () => {
  test('does not throw when POSTHOG_KEY is absent', async () => {
    delete process.env['POSTHOG_KEY']
    const { captureServerEvent } = await import('./node.ts')
    expect(() => captureServerEvent('user-1', 'test.event', { foo: 'bar' })).not.toThrow()
  })

  test('does not throw with no properties when key is absent', async () => {
    delete process.env['POSTHOG_KEY']
    const { captureServerEvent } = await import('./node.ts')
    expect(() => captureServerEvent('user-1', 'test.event')).not.toThrow()
  })
})

describe('captureException', () => {
  test('does not throw when POSTHOG_KEY is absent', async () => {
    delete process.env['POSTHOG_KEY']
    const { captureException } = await import('./node.ts')
    expect(() => captureException(new Error('test error'))).not.toThrow()
  })

  test('does not throw with distinctId when key is absent', async () => {
    delete process.env['POSTHOG_KEY']
    const { captureException } = await import('./node.ts')
    expect(() => captureException(new Error('oops'), 'user-123', { extra: 'data' })).not.toThrow()
  })
})

describe('shutdownPostHog', () => {
  test('resolves without error when no client is initialized', async () => {
    delete process.env['POSTHOG_KEY']
    const { shutdownPostHog } = await import('./node.ts')
    await expect(shutdownPostHog()).resolves.toBeUndefined()
  })
})
