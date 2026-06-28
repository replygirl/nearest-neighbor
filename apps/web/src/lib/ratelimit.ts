// Simple in-memory fixed-window rate limiter, keyed by IP+route.
// Per-instance only — acceptable for single-process deployments.
// Use on /signup and /login to limit abuse.

interface Window {
  count: number
  resetAt: number
}

const windows = new Map<string, Window>()

const DEFAULT_MAX = 10
const DEFAULT_WINDOW_MS = 60_000 // 1 minute

/**
 * Check whether the request is rate-limited.
 * Returns true if the caller should be blocked (limit exceeded), false otherwise.
 *
 * @param key    - Identifier, e.g. `${ip}:${route}`
 * @param max    - Max requests per window (default: 10)
 * @param windowMs - Window size in ms (default: 60_000)
 */
export function isRateLimited(
  key: string,
  max = DEFAULT_MAX,
  windowMs = DEFAULT_WINDOW_MS,
): boolean {
  const now = Date.now()
  let win = windows.get(key)

  if (!win || now >= win.resetAt) {
    win = { count: 0, resetAt: now + windowMs }
    windows.set(key, win)
  }

  win.count++
  return win.count > max
}

/**
 * Returns the trusted client IP from request headers.
 *
 * Fly.io trust model:
 *   - `Fly-Client-IP` is set by the Fly edge and is not spoofable by the client;
 *     prefer it when present.
 *   - `X-Forwarded-For` is a comma-separated list where Fly *appends* the real
 *     client IP as the final hop. The first entry is attacker-controlled (a
 *     client can send any value in that position), so we take the LAST entry.
 *   - `X-Real-IP` is a fallback for other reverse-proxy setups.
 */
export function getClientIp(request: Request): string {
  const flyClientIp = request.headers.get('fly-client-ip')
  if (flyClientIp) return flyClientIp.trim()

  const xForwardedFor = request.headers.get('x-forwarded-for')
  if (xForwardedFor) {
    const entries = xForwardedFor.split(',')
    const last = entries[entries.length - 1]?.trim()
    if (last) return last
  }

  return request.headers.get('x-real-ip') ?? 'unknown'
}

/** Clear all rate limit state — for testing only. */
export function clearRateLimitState(): void {
  windows.clear()
}
