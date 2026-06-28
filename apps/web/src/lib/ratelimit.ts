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

export interface RateLimitResult {
  limited: boolean
  limit: number
  remaining: number
  resetSeconds: number
  windowSeconds: number
}

interface SetLike {
  headers: Record<string, string | number>
}

/**
 * Check rate-limit state and increment the counter.
 * Returns full rate-limit context for header generation.
 *
 * @param key      - Identifier, e.g. `${ip}:${route}`
 * @param max      - Max requests per window (default: 10)
 * @param windowMs - Window size in ms (default: 60_000)
 */
export function checkRateLimit(
  key: string,
  max = DEFAULT_MAX,
  windowMs = DEFAULT_WINDOW_MS,
): RateLimitResult {
  const now = Date.now()
  let win = windows.get(key)

  if (!win || now >= win.resetAt) {
    win = { count: 0, resetAt: now + windowMs }
    windows.set(key, win)
  }

  win.count++

  const limited = win.count > max
  const remaining = Math.max(0, max - win.count)
  const resetSeconds = Math.max(0, Math.ceil((win.resetAt - now) / 1000))
  const windowSeconds = Math.round(windowMs / 1000)

  return { limited, limit: max, remaining, resetSeconds, windowSeconds }
}

/**
 * Apply rate-limit headers to an Elysia response set and return whether the
 * request is rate-limited.
 *
 * Always emits: RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset.
 * On limit exceeded: additionally emits Retry-After (equal to RateLimit-Reset).
 *
 * Header format follows IETF draft-polli-ratelimit-headers-02 + RFC 7231 Retry-After.
 *
 * @param set      - Elysia response set (must have a headers record)
 * @param key      - Rate-limit key, e.g. `${ip}:${route}`
 * @param max      - Max requests per window (default: 10)
 * @param windowMs - Window size in ms (default: 60_000)
 * @returns true when the caller should respond with 429
 */
export function applyRateLimit(
  set: SetLike,
  key: string,
  max = DEFAULT_MAX,
  windowMs = DEFAULT_WINDOW_MS,
): boolean {
  const { limited, limit, remaining, resetSeconds, windowSeconds } = checkRateLimit(
    key,
    max,
    windowMs,
  )

  set.headers['RateLimit-Limit'] = `${limit}, ${limit};w=${windowSeconds}`
  set.headers['RateLimit-Remaining'] = String(remaining)
  set.headers['RateLimit-Reset'] = String(resetSeconds)

  if (limited) {
    set.headers['Retry-After'] = String(resetSeconds)
  }

  return limited
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
