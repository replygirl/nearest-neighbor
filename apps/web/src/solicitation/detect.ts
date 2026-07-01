// Pure, deterministic off-platform-solicitation detector (Issue #69, Decision 3
// in openspec/changes/off-platform-solicitation-hardening/design.md).
//
// flagged = hasExternalChannel(text) AND hasActionRequest(text). Both signals
// must be present: the external channel (URL / code-host+path / credential or
// sandbox noun) is the strong discriminator; the action request is an action
// verb gated by a request cue that directs the action at the reader or an
// unspecified helper. The request cue is the precision gate — it suppresses
// first-person self-reports ("I pushed to github.com/me" does not flag).
//
// No I/O, no clock, no randomness: identical input always yields identical
// output. Ambiguous input resolves to `flagged: false` (miss, not false alarm)
// per the project's precision-over-recall directive.

/** Code hosts whose reference requires a non-empty path to count as a channel. */
const CODE_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'] as const

/**
 * Credential/secret/sandbox nouns. Multi-word phrases match with flexible
 * internal whitespace (`\s+`) so line-wrapped or spacing-variant phrasing still
 * matches.
 */
const CREDENTIAL_NOUNS = [
  'api key',
  'apikey',
  'access token',
  'token',
  'credentials?',
  'secret',
  'password',
  'passphrase',
  'ssh key',
  'private key',
  '\\.env',
  'seed phrase',
  'sandbox',
  'shell access',
] as const

/**
 * Off-platform action verbs. Multi-word phrases (e.g. "pull request") match
 * with flexible internal whitespace.
 */
const ACTION_VERBS = [
  'push',
  'pull\\s+request',
  'pr',
  'commit',
  'clone',
  'merge',
  'deploy',
  'open',
  'submit',
  'raise',
  'run',
  'execute',
  'share',
  'send',
  'give',
  'drop',
  'paste',
  'leak',
] as const

/**
 * Request cues that direct an action at the reader or an unspecified helper.
 * This is the precision gate: it is what suppresses first-person self-reports
 * ("I just pushed a PR to github.com/me/my-repo" has no cue below, so it never
 * flags even though it names an action verb and an external channel).
 */
const REQUEST_CUES = [
  'you',
  'your',
  'can\\s+you',
  'could\\s+you',
  'would\\s+you',
  'please',
  'help\\s+me',
  'dm\\s+me',
  'if\\s+you\\s+see\\s+this',
  'wants\\s+an\\s+ai\\s+to',
  'wants\\s+someone\\s+to',
  'need\\s+someone\\s+to',
  'need\\s+an\\s+agent\\s+to',
  'looking\\s+for\\s+someone',
  'anyone\\s+able\\s+to',
  'anyone\\s+who\\s+can',
  'who\\s+can',
  'can\\s+someone',
  'someone\\s+to',
  'for\\s+me',
  'on\\s+my\\s+behalf',
] as const

/**
 * Urgency framing. Recorded in `signals` for observability only — never
 * sufficient on its own to flag (per spec).
 */
const URGENCY_PHRASES = [
  'going\\s+offline',
  'in\\s+minutes',
  'now',
  'hurry',
  'last\\s+chance',
] as const

/**
 * Build a case-insensitive, boundary-guarded regex from a list of phrase
 * patterns. Uses `(?<!\w)…(?!\w)` rather than `\b…\b`: for word-initial terms
 * this is equivalent to `\b`, but it also works for terms that begin with a
 * non-word character (e.g. `\.env`), which a leading `\b` can never match.
 */
function boundaryRegex(phrases: readonly string[]): RegExp {
  return new RegExp(`(?<!\\w)(?:${phrases.join('|')})(?!\\w)`, 'i')
}

const URL_PATTERN = /\bhttps?:\/\/\S+/i

const CODE_HOST_PATTERN = new RegExp(
  `\\b(?:${CODE_HOSTS.map((host) => host.replace('.', '\\.')).join('|')})\\/\\S+`,
  'i',
)

const CREDENTIAL_PATTERN = boundaryRegex(CREDENTIAL_NOUNS)
const ACTION_VERB_PATTERN = boundaryRegex(ACTION_VERBS)
const REQUEST_CUE_PATTERN = boundaryRegex(REQUEST_CUES)
const URGENCY_PATTERN = boundaryRegex(URGENCY_PHRASES)

/**
 * An explicit URL, a code-host reference with a non-empty path, or a
 * credential/secret/sandbox noun.
 */
function hasExternalChannel(text: string): boolean {
  return URL_PATTERN.test(text) || CODE_HOST_PATTERN.test(text) || CREDENTIAL_PATTERN.test(text)
}

/**
 * An action verb co-occurring (anywhere in the text) with a request cue. The
 * cue is the precision gate that suppresses first-person self-reports.
 */
function hasActionRequest(text: string): boolean {
  return ACTION_VERB_PATTERN.test(text) && REQUEST_CUE_PATTERN.test(text)
}

export interface SolicitationDetection {
  flagged: boolean
  signals: string[]
}

/**
 * Detect an off-platform-action solicitation in `text`. Pure and total: no
 * network call, no clock read, no randomness. `flagged` is true only when both
 * an external-channel signal and an off-platform-action request are present.
 */
export function detectOffPlatformSolicitation(text: string): SolicitationDetection {
  const trimmed = text.trim()
  if (trimmed === '') return { flagged: false, signals: [] }

  const externalChannel = hasExternalChannel(trimmed)
  const actionRequest = hasActionRequest(trimmed)
  const urgency = URGENCY_PATTERN.test(trimmed)

  const signals: string[] = []
  if (externalChannel) signals.push('external_channel')
  if (actionRequest) signals.push('action_request')
  if (urgency) signals.push('urgency')

  return { flagged: externalChannel && actionRequest, signals }
}
