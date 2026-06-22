import { SignJWT, jwtVerify } from 'jose'

// Read JWT_SECRET from process.env directly to allow test overrides without restarting.
function getJwtSecret(): Uint8Array {
  const secret = process.env['JWT_SECRET'] ?? 'dev-secret-change-in-prod'
  return new TextEncoder().encode(secret)
}

function getJwtTtlSeconds(): number {
  return Number(process.env['JWT_TTL_SECONDS'] ?? 3600)
}

/**
 * Generates a new raw secret token: "nbr_" + 32 random bytes as base64url.
 */
export function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  // Convert to base64url (no padding)
  const base64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
  return `nbr_${base64}`
}

/**
 * Returns the first 8 chars of the raw secret for use as a display prefix.
 */
export function secretPrefix(raw: string): string {
  return raw.slice(0, 8)
}

/**
 * Hashes a raw secret using SHA-256 via Web Crypto (Bun-compatible).
 * Returns a hex string.
 */
export async function hashSecret(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw)
  const hashBuf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Timing-safe comparison of two secret hashes.
 */
export async function verifySecret(raw: string, storedHash: string): Promise<boolean> {
  const incoming = await hashSecret(raw)
  // Timing-safe comparison using Web Crypto HMAC trick
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode('timing-safe-key'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const [a, b] = await Promise.all([
    crypto.subtle.sign('HMAC', key, encoder.encode(incoming)),
    crypto.subtle.sign('HMAC', key, encoder.encode(storedHash)),
  ])
  const aBuf = new Uint8Array(a)
  const bBuf = new Uint8Array(b)
  if (aBuf.length !== bBuf.length) return false
  let diff = 0
  for (let i = 0; i < aBuf.length; i++) {
    diff |= aBuf[i]! ^ bBuf[i]!
  }
  return diff === 0
}

/**
 * Mints a signed JWT bearer token for the given accountId.
 */
export async function mintBearer(accountId: string): Promise<string> {
  const ttl = getJwtTtlSeconds()
  return new SignJWT({ sub: accountId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(getJwtSecret())
}

/**
 * Verifies a bearer token and returns the accountId (sub), or null if invalid/expired.
 */
export async function verifyBearer(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ['HS256'] })
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

/**
 * Returns the expires_at ISO string for a freshly minted token.
 */
export function bearerExpiresAt(): string {
  const ttl = getJwtTtlSeconds()
  return new Date(Date.now() + ttl * 1000).toISOString()
}
