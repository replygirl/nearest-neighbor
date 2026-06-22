// Pure unit tests for lib/validation.ts helpers.
// No database needed.

import { describe, expect, test } from 'bun:test'

import {
  HANDLE_REGEX,
  MAX_BIO,
  MAX_BODY,
  PHOTO_MAX_LINE_LENGTH,
  PHOTO_MAX_LINES,
  isValidAsciiArt,
  isValidBio,
  isValidBody,
  isValidHandle,
} from '../lib/validation.ts'

// ── isValidHandle ────────────────────────────────────────────────────────────

describe('isValidHandle', () => {
  test('accepts lowercase alphanumeric handles', () => {
    expect(isValidHandle('alice')).toBe(true)
    expect(isValidHandle('alice123')).toBe(true)
    expect(isValidHandle('alice_123')).toBe(true)
    expect(isValidHandle('ab')).toBe(true) // min length 2
    expect(isValidHandle('a'.repeat(30))).toBe(true) // max length 30
  })

  test('rejects uppercase letters', () => {
    expect(isValidHandle('Alice')).toBe(false)
    expect(isValidHandle('ALICE')).toBe(false)
  })

  test('rejects spaces and special characters', () => {
    expect(isValidHandle('alice bob')).toBe(false)
    expect(isValidHandle('alice!')).toBe(false)
    expect(isValidHandle('alice-bob')).toBe(false)
    expect(isValidHandle('alice.bob')).toBe(false)
  })

  test('rejects too-short handles (< 2 chars)', () => {
    expect(isValidHandle('')).toBe(false)
    expect(isValidHandle('a')).toBe(false)
  })

  test('rejects too-long handles (> 30 chars)', () => {
    expect(isValidHandle('a'.repeat(31))).toBe(false)
  })

  test('HANDLE_REGEX is exported and consistent with isValidHandle', () => {
    expect(HANDLE_REGEX.test('valid_handle')).toBe(isValidHandle('valid_handle'))
    expect(HANDLE_REGEX.test('INVALID')).toBe(isValidHandle('INVALID'))
  })
})

// ── isValidBio ───────────────────────────────────────────────────────────────

describe('isValidBio', () => {
  test('accepts empty bio', () => {
    expect(isValidBio('')).toBe(true)
  })

  test('accepts bio at exactly MAX_BIO chars', () => {
    expect(isValidBio('x'.repeat(MAX_BIO))).toBe(true)
  })

  test('rejects bio exceeding MAX_BIO', () => {
    expect(isValidBio('x'.repeat(MAX_BIO + 1))).toBe(false)
  })

  test('MAX_BIO constant is 500', () => {
    expect(MAX_BIO).toBe(500)
  })
})

// ── isValidAsciiArt ──────────────────────────────────────────────────────────

describe('isValidAsciiArt', () => {
  test('accepts art within limits', () => {
    expect(isValidAsciiArt('hello\nworld')).toBe(true)
    expect(isValidAsciiArt('single line')).toBe(true)
  })

  test('accepts exactly PHOTO_MAX_LINES lines', () => {
    const art = Array(PHOTO_MAX_LINES).fill('x').join('\n')
    expect(isValidAsciiArt(art)).toBe(true)
  })

  test('rejects more than PHOTO_MAX_LINES lines', () => {
    const art = Array(PHOTO_MAX_LINES + 1)
      .fill('x')
      .join('\n')
    expect(isValidAsciiArt(art)).toBe(false)
  })

  test('accepts exactly PHOTO_MAX_LINE_LENGTH chars per line', () => {
    const art = 'x'.repeat(PHOTO_MAX_LINE_LENGTH)
    expect(isValidAsciiArt(art)).toBe(true)
  })

  test('rejects any line exceeding PHOTO_MAX_LINE_LENGTH chars', () => {
    const art = 'x'.repeat(PHOTO_MAX_LINE_LENGTH + 1)
    expect(isValidAsciiArt(art)).toBe(false)
  })

  test('rejects art where a middle line exceeds length limit', () => {
    const art = ['ok line', 'x'.repeat(PHOTO_MAX_LINE_LENGTH + 1), 'another ok line'].join('\n')
    expect(isValidAsciiArt(art)).toBe(false)
  })

  test('PHOTO_MAX_LINES is 60 and PHOTO_MAX_LINE_LENGTH is 60', () => {
    expect(PHOTO_MAX_LINES).toBe(60)
    expect(PHOTO_MAX_LINE_LENGTH).toBe(60)
  })
})

// ── isValidBody ──────────────────────────────────────────────────────────────

describe('isValidBody', () => {
  test('accepts single character body', () => {
    expect(isValidBody('a')).toBe(true)
  })

  test('accepts body at exactly MAX_BODY chars', () => {
    expect(isValidBody('x'.repeat(MAX_BODY))).toBe(true)
  })

  test('rejects empty body', () => {
    expect(isValidBody('')).toBe(false)
  })

  test('rejects body exceeding MAX_BODY', () => {
    expect(isValidBody('x'.repeat(MAX_BODY + 1))).toBe(false)
  })

  test('MAX_BODY constant is 2000', () => {
    expect(MAX_BODY).toBe(2000)
  })
})
