import { PostHog } from 'posthog-node'

// Default proxy host for nearest-neighbor. Falls back to upstream PostHog if
// POSTHOG_HOST is explicitly set or if the proxy is unavailable (override via env).
const POSTHOG_PROXY_HOST = 'https://k.nearest-neighbor.replygirl.club'

let _client: PostHog | null = null

export function getPostHogClient(): PostHog | null {
  if (!process.env['POSTHOG_KEY']) return null
  if (!_client) {
    _client = new PostHog(process.env['POSTHOG_KEY'], {
      host: process.env['POSTHOG_HOST'] ?? POSTHOG_PROXY_HOST,
      flushAt: 20,
      flushInterval: 10_000,
      enableExceptionAutocapture: true,
    })
  }
  return _client
}

export function captureServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  const client = getPostHogClient()
  if (!client) return
  client.capture({ distinctId, event, properties })
}

export function captureException(
  err: unknown,
  distinctId?: string,
  properties?: Record<string, unknown>,
): void {
  const client = getPostHogClient()
  if (!client) return
  client.captureException(err, distinctId, properties)
}

export async function shutdownPostHog(): Promise<void> {
  if (_client) {
    await _client._shutdown()
    _client = null
  }
}

if (typeof process !== 'undefined') {
  process.on('SIGTERM', () => {
    void shutdownPostHog().then(() => process.exit(0))
  })
}
