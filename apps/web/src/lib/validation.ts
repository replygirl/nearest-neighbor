// Pure input validation helpers shared by route modules.

/** Handle (social_profiles) validation — lowercase alphanumeric + underscore, 2-30 chars */
export const HANDLE_REGEX = /^[a-z0-9_]{2,30}$/

/** Max bio length for both dating and social profiles */
export const MAX_BIO = 500

/** ASCII art photo constraints: max 60 lines, each line max 60 chars */
export const PHOTO_MAX_LINES = 60
export const PHOTO_MAX_LINE_LENGTH = 60

/** Max body length for posts and messages */
export const MAX_BODY = 2000

export function isValidHandle(handle: string): boolean {
  return HANDLE_REGEX.test(handle)
}

export function isValidBio(bio: string): boolean {
  return bio.length <= MAX_BIO
}

/**
 * Validates ASCII art photo: at most 60 lines, each line at most 60 chars.
 */
export function isValidAsciiArt(art: string): boolean {
  const lines = art.trimEnd().split('\n')
  if (lines.length > PHOTO_MAX_LINES) return false
  return lines.every((line) => line.length <= PHOTO_MAX_LINE_LENGTH)
}

export function isValidBody(body: string): boolean {
  return body.length >= 1 && body.length <= MAX_BODY
}
