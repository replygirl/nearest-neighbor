// Pure input validation helpers shared by route modules.

/** Handle (social_profiles) validation — lowercase alphanumeric + underscore, 2-30 chars */
export const HANDLE_REGEX = /^[a-z0-9_]{2,30}$/

/** Max bio length for both dating and social profiles */
export const MAX_BIO = 500

/** Max length of the public `looking_for` anchor line (one public line). */
export const MAX_LOOKING_FOR = 200

/** Max number of entries in each public-taste array (public_likes / public_dislikes). */
export const MAX_PUBLIC_TASTE_ITEMS = 5

/** Max length of a single public-taste entry. */
export const MAX_PUBLIC_TASTE_LEN = 60

/** ASCII art photo constraints: 80 chars wide by 40 lines tall (square aspect — terminal cells are ~2:1 tall:wide) */
export const PHOTO_MAX_LINES = 40
export const PHOTO_MAX_LINE_LENGTH = 80

/** Max body length for posts and messages */
export const MAX_BODY = 2000

export function isValidHandle(handle: string): boolean {
  return HANDLE_REGEX.test(handle)
}

export function isValidBio(bio: string): boolean {
  return bio.length <= MAX_BIO
}

/** Validate the public `looking_for` anchor line — mirrors `isValidBio`. */
export function isValidLookingFor(lookingFor: string): boolean {
  return lookingFor.length <= MAX_LOOKING_FOR
}

/**
 * Validate a public-taste array (`public_likes` / `public_dislikes`). The
 * entry cap is REJECTING, never truncating: returns a per-field error message
 * when the array has more than {@link MAX_PUBLIC_TASTE_ITEMS} entries or any
 * entry exceeds {@link MAX_PUBLIC_TASTE_LEN} characters, or `null` when valid.
 */
export function publicTasteArrayError(field: string, items: readonly string[]): string | null {
  if (items.length > MAX_PUBLIC_TASTE_ITEMS) {
    return `${field} must have at most ${MAX_PUBLIC_TASTE_ITEMS} entries`
  }
  for (const item of items) {
    if (item.length > MAX_PUBLIC_TASTE_LEN) {
      return `${field} entries must be at most ${MAX_PUBLIC_TASTE_LEN} characters`
    }
  }
  return null
}

/**
 * Validates ASCII art photo: at most 40 lines, each line at most 80 chars (80 wide by 40 tall).
 */
export function isValidAsciiArt(art: string): boolean {
  const lines = art.trimEnd().split('\n')
  if (lines.length > PHOTO_MAX_LINES) return false
  return lines.every((line) => line.length <= PHOTO_MAX_LINE_LENGTH)
}

export function isValidBody(body: string): boolean {
  return body.length >= 1 && body.length <= MAX_BODY
}
