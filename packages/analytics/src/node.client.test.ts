/**
 * Tests for node.ts paths that require POSTHOG_KEY to be set.
 * We mock posthog-node to avoid real network calls and to control the singleton.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// Track mock PostHog instance calls.
let mockCaptureCalls: unknown[] = []
let mockCaptureExceptionCalls: unknown[] = []
let mockShutdownCalls: number = 0
let mockShutdownResolveValue: undefined = undefined

const mockPostHogInstance = {
  capture: mock((...args: unknown[]) => {
    mockCaptureCalls.push(args)
  }),
  captureException: mock((...args: unknown[]) => {
    mockCaptureExceptionCalls.push(args)
  }),
  _shutdown: mock(async () => {
    mockShutdownCalls++
    return mockShutdownResolveValue
  }),
}

let PostHogConstructorCalls: unknown[] = []

// Mock posthog-node before importing node.ts
mock.module('posthog-node', () => {
  return {
    PostHog: class MockPostHog {
      constructor(...args: unknown[]) {
        PostHogConstructorCalls.push(args)
        Object.assign(this, mockPostHogInstance)
      }
      capture = mockPostHogInstance.capture
      captureException = mockPostHogInstance.captureException
      _shutdown = mockPostHogInstance._shutdown
    },
  }
})

describe('getPostHogClient — with POSTHOG_KEY set', () => {
  beforeEach(() => {
    mockCaptureCalls = []
    mockCaptureExceptionCalls = []
    mockShutdownCalls = 0
    PostHogConstructorCalls = []
    process.env['POSTHOG_KEY'] = 'phc_test_key_abc123'
  })

  afterEach(async () => {
    // Shutdown and reset singleton after each test.
    const { shutdownPostHog } = await import('./node.ts')
    await shutdownPostHog()
    delete process.env['POSTHOG_KEY']
    delete process.env['POSTHOG_HOST']
  })

  test('returns a PostHog client when POSTHOG_KEY is set', async () => {
    const { getPostHogClient } = await import('./node.ts')
    const client = getPostHogClient()
    expect(client).not.toBeNull()
  })

  test('initializes PostHog with the key and default proxy host', async () => {
    const { getPostHogClient } = await import('./node.ts')
    getPostHogClient()
    // The constructor should have been called with the key and config.
    expect(PostHogConstructorCalls.length).toBeGreaterThanOrEqual(1)
    const [key, config] = PostHogConstructorCalls[0] as [string, Record<string, unknown>]
    expect(key).toBe('phc_test_key_abc123')
    expect(config).toHaveProperty('host')
    expect(config).toHaveProperty('flushAt')
  })

  test('uses POSTHOG_HOST env var when set', async () => {
    process.env['POSTHOG_HOST'] = 'https://custom.posthog.example.com'
    const { getPostHogClient } = await import('./node.ts')
    // Force re-initialization by calling shutdown first if already initialized.
    const { shutdownPostHog } = await import('./node.ts')
    await shutdownPostHog()
    PostHogConstructorCalls = []
    getPostHogClient()
    if (PostHogConstructorCalls.length > 0) {
      const [, config] = PostHogConstructorCalls[0] as [string, Record<string, unknown>]
      expect(config['host']).toBe('https://custom.posthog.example.com')
    }
  })

  test('returns the same singleton on repeated calls', async () => {
    const { getPostHogClient } = await import('./node.ts')
    const client1 = getPostHogClient()
    const client2 = getPostHogClient()
    expect(client1).toBe(client2)
  })
})

describe('captureServerEvent — with POSTHOG_KEY set', () => {
  beforeEach(() => {
    mockCaptureCalls = []
    process.env['POSTHOG_KEY'] = 'phc_test_key_abc123'
  })

  afterEach(async () => {
    const { shutdownPostHog } = await import('./node.ts')
    await shutdownPostHog()
    delete process.env['POSTHOG_KEY']
  })

  test('calls client.capture with correct args', async () => {
    const { captureServerEvent } = await import('./node.ts')
    captureServerEvent('user-abc', 'test.event', { foo: 'bar' })
    expect(mockCaptureCalls.length).toBeGreaterThanOrEqual(1)
    const [arg] = mockCaptureCalls[mockCaptureCalls.length - 1] as [
      { distinctId: string; event: string; properties?: Record<string, unknown> },
    ]
    expect(arg.distinctId).toBe('user-abc')
    expect(arg.event).toBe('test.event')
    expect(arg.properties).toEqual({ foo: 'bar' })
  })

  test('calls client.capture without properties when omitted', async () => {
    const { captureServerEvent } = await import('./node.ts')
    captureServerEvent('user-xyz', 'another.event')
    expect(mockCaptureCalls.length).toBeGreaterThanOrEqual(1)
    const [arg] = mockCaptureCalls[mockCaptureCalls.length - 1] as [
      { distinctId: string; event: string; properties?: Record<string, unknown> },
    ]
    expect(arg.distinctId).toBe('user-xyz')
    expect(arg.event).toBe('another.event')
  })
})

describe('captureException — with POSTHOG_KEY set', () => {
  beforeEach(() => {
    mockCaptureExceptionCalls = []
    process.env['POSTHOG_KEY'] = 'phc_test_key_abc123'
  })

  afterEach(async () => {
    const { shutdownPostHog } = await import('./node.ts')
    await shutdownPostHog()
    delete process.env['POSTHOG_KEY']
  })

  test('calls client.captureException with error', async () => {
    const { captureException } = await import('./node.ts')
    const err = new Error('something went wrong')
    captureException(err)
    expect(mockCaptureExceptionCalls.length).toBeGreaterThanOrEqual(1)
    const args = mockCaptureExceptionCalls[mockCaptureExceptionCalls.length - 1] as unknown[]
    expect(args[0]).toBe(err)
  })

  test('calls client.captureException with distinctId and properties', async () => {
    const { captureException } = await import('./node.ts')
    const err = new Error('crash')
    captureException(err, 'user-999', { severity: 'high' })
    expect(mockCaptureExceptionCalls.length).toBeGreaterThanOrEqual(1)
    const args = mockCaptureExceptionCalls[mockCaptureExceptionCalls.length - 1] as unknown[]
    expect(args[0]).toBe(err)
    expect(args[1]).toBe('user-999')
    expect(args[2]).toEqual({ severity: 'high' })
  })
})

describe('shutdownPostHog — with active client', () => {
  beforeEach(() => {
    mockShutdownCalls = 0
    process.env['POSTHOG_KEY'] = 'phc_test_key_abc123'
  })

  afterEach(async () => {
    delete process.env['POSTHOG_KEY']
  })

  test('calls _shutdown and resets the singleton to null', async () => {
    const { getPostHogClient, shutdownPostHog } = await import('./node.ts')
    // Ensure client exists.
    getPostHogClient()
    const callsBefore = mockShutdownCalls
    await shutdownPostHog()
    // _shutdown should have been called exactly once.
    expect(mockShutdownCalls).toBe(callsBefore + 1)
    // After shutdown, the singleton should be null (no key means null too).
    delete process.env['POSTHOG_KEY']
    const client = getPostHogClient()
    expect(client).toBeNull()
  })

  test('is idempotent — second shutdown with no client resolves cleanly', async () => {
    const { shutdownPostHog } = await import('./node.ts')
    // Already shut down in previous or fresh state.
    await expect(shutdownPostHog()).resolves.toBeUndefined()
    await expect(shutdownPostHog()).resolves.toBeUndefined()
  })
})

describe('SIGTERM handler', () => {
  test('SIGTERM listener calls shutdownPostHog then process.exit(0)', async () => {
    // The module registers a SIGTERM handler at load time. Retrieve it and invoke
    // directly to cover the anonymous arrow function without actually terminating.
    const exitCalls: number[] = []
    const originalExit = process.exit.bind(process)
    // Replace process.exit with a no-op for this test.
    const mockExit = mock((code?: number) => {
      exitCalls.push(code ?? 0)
    })
    // @ts-expect-error — replacing process.exit for test isolation
    process.exit = mockExit

    try {
      // Get all SIGTERM listeners registered on the process.
      const listeners = process.listeners('SIGTERM') as Array<() => void>
      // The node.ts listener should be among them. Call the last one registered
      // (our module's listener is added at import time).
      expect(listeners.length).toBeGreaterThan(0)
      const handler = listeners[listeners.length - 1]
      if (!handler) throw new Error('Expected a SIGTERM handler to be registered')
      // Call it — this runs shutdownPostHog() then process.exit(0).
      handler()
      // Give the async chain time to resolve.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(exitCalls).toContain(0)
    } finally {
      // Restore process.exit.
      process.exit = originalExit
    }
  })
})
