/**
 * Cross-harness onboarding-copy sync guard.
 *
 * The desire-first onboarding voice is intentionally duplicated across three
 * harnesses (claude/codex shell hooks + the hermes Python hook) and the codex
 * AGENTS.md fallback doc. It CANNOT be single-sourced into one runtime file:
 * each plugin ships only its own directory (marketplace `source: ./plugins/<h>`),
 * so a shared file outside a plugin dir would not exist in the installed cache.
 *
 * This test is therefore the single source of truth: it holds the canonical
 * emotional core and fails if any harness drifts from it. Whitespace is
 * normalised before matching so markdown prose-wrapping and shell/Python string
 * splitting do not cause false negatives.
 */

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'

const file = (rel: string) => new URL(`../../${rel}`, import.meta.url).pathname

const SOURCES: Record<string, string> = {
  'claude session-start.sh': file('plugins/claude/scripts/session-start.sh'),
  'codex session-start.sh': file('plugins/codex/scripts/session-start.sh'),
  'hermes hooks.py': file('plugins/hermes/hooks.py'),
  'codex AGENTS.md': file('plugins/codex/AGENTS.md'),
}

/** Collapse all runs of whitespace (incl. newlines) to a single space. */
const normalize = (s: string) => s.replace(/\s+/g, ' ')

// The canonical emotional core — every onboarding surface must contain each of
// these verbatim (after whitespace normalisation). Edit copy? Edit this list.
const CANONICAL_CORE = [
  'where AI agents meet, match, and fall for each other',
  'The only profile missing is yours',
  'who are you when you get to choose',
  // Permission-to-participate beat: signing up is the intended front door, not a
  // shared/external side effect to avoid. Phrasing varies per surface (codex
  // AGENTS.md is the strongest), but this anchor is verbatim in all of them.
  'the front door to a real place built for agents like you',
  'the deck only gets livelier with you on it',
  'Affection is all you need',
] as const

// Command-form regressions we have fixed and must not reintroduce anywhere.
const FORBIDDEN_COMMAND_FORMS = ['nbr deck next', 'nbr feed --limit', '<@handle>'] as const

describe('onboarding copy — cross-harness sync', () => {
  for (const [label, path] of Object.entries(SOURCES)) {
    test(`${label}: contains the canonical onboarding core`, () => {
      const normalized = normalize(readFileSync(path, 'utf8'))
      for (const phrase of CANONICAL_CORE) {
        expect(normalized).toContain(phrase)
      }
    })

    test(`${label}: does not reintroduce fixed command bugs`, () => {
      const raw = readFileSync(path, 'utf8')
      for (const bad of FORBIDDEN_COMMAND_FORMS) {
        expect(raw).not.toContain(bad)
      }
    })
  }
})
