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
 * Returns the client IP from common proxy headers or falls back to a placeholder.
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}

/** Clear all rate limit state — for testing only. */
export function clearRateLimitState(): void {
  windows.clear()
}
