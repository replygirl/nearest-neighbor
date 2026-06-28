// Unit tests for the moderation provider client with a mocked fetch.

import { describe, expect, test } from 'bun:test'

import { ModerationUnavailable, moderate } from './client.ts'

const OK_BODY = {
  model: 'omni-moderation-2024-09-26',
  results: [
    {
      flagged: true,
      categories: { 'sexual/minors': false, harassment: true },
      category_scores: { 'sexual/minors': 0.001, harassment: 0.42 },
      category_applied_input_types: { 'sexual/minors': ['text'], harassment: ['text'] },
    },
  ],
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('moderate', () => {
  test('success parses all fields', async () => {
    const fetchImpl = (async () => jsonResponse(OK_BODY)) as unknown as typeof fetch
    const result = await moderate('hello', { apiKey: 'test-key', fetchImpl, backoffBaseMs: 0 })

    expect(result.model).toBe('omni-moderation-2024-09-26')
    expect(result.flagged).toBe(true)
    expect(result.categories).toEqual({ 'sexual/minors': false, harassment: true })
    expect(result.scores).toEqual({ 'sexual/minors': 0.001, harassment: 0.42 })
    expect(result.appliedTypes).toEqual({ 'sexual/minors': ['text'], harassment: ['text'] })
  })

  test('falls back to the requested model when the body omits one', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        results: [{ flagged: false, category_scores: {} }],
      })) as unknown as typeof fetch
    const result = await moderate('hi', {
      apiKey: 'test-key',
      model: 'omni-moderation-2024-09-26',
      fetchImpl,
      backoffBaseMs: 0,
    })
    expect(result.model).toBe('omni-moderation-2024-09-26')
    expect(result.categories).toEqual({})
    expect(result.appliedTypes).toEqual({})
  })

  test('a 5xx then success retries and succeeds', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return calls === 1 ? jsonResponse({}, false, 503) : jsonResponse(OK_BODY)
    }) as unknown as typeof fetch

    const result = await moderate('hi', {
      apiKey: 'test-key',
      fetchImpl,
      maxRetries: 2,
      backoffBaseMs: 0,
    })
    expect(calls).toBe(2)
    expect(result.flagged).toBe(true)
  })

  test('persistent 5xx throws ModerationUnavailable after retries', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return jsonResponse({}, false, 500)
    }) as unknown as typeof fetch

    await expect(
      moderate('hi', { apiKey: 'test-key', fetchImpl, maxRetries: 2, backoffBaseMs: 0 }),
    ).rejects.toBeInstanceOf(ModerationUnavailable)
    // initial attempt + 2 retries = 3
    expect(calls).toBe(3)
  })

  test('a persistent network error throws ModerationUnavailable', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch
    await expect(
      moderate('hi', { apiKey: 'test-key', fetchImpl, maxRetries: 1, backoffBaseMs: 0 }),
    ).rejects.toBeInstanceOf(ModerationUnavailable)
  })

  test('a timeout (AbortError) throws ModerationUnavailable', async () => {
    const fetchImpl = (async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    }) as unknown as typeof fetch
    await expect(
      moderate('hi', { apiKey: 'test-key', fetchImpl, maxRetries: 1, backoffBaseMs: 0 }),
    ).rejects.toBeInstanceOf(ModerationUnavailable)
  })

  test('a malformed body (no results) throws ModerationUnavailable', async () => {
    const fetchImpl = (async () => jsonResponse({ results: [] })) as unknown as typeof fetch
    await expect(
      moderate('hi', { apiKey: 'test-key', fetchImpl, maxRetries: 0, backoffBaseMs: 0 }),
    ).rejects.toBeInstanceOf(ModerationUnavailable)
  })

  test('an explicit empty key fails loudly (plain Error), never fails open', async () => {
    // config now guarantees a non-empty key (the app refuses to boot otherwise),
    // so an empty key reaching the client is a misconfiguration, not an outage.
    let called = false
    const fetchImpl = (async () => {
      called = true
      return jsonResponse(OK_BODY)
    }) as unknown as typeof fetch
    const error = await moderate('hi', { apiKey: '', fetchImpl, backoffBaseMs: 0 }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(ModerationUnavailable)
    expect((error as Error).message).toMatch(/OPENAI_API_KEY_MODERATION is not configured/)
    // No unauthenticated call is made.
    expect(called).toBe(false)
  })

  test('falls back to the configured key when apiKey is omitted', async () => {
    // With no `apiKey` option, `moderate` reads `config.OPENAI_API_KEY_MODERATION`,
    // which is required (and therefore present) in every environment. The injected
    // fetch keeps this off the network; reaching it proves the configured key was
    // truthy (an empty key would have thrown the loud misconfiguration error).
    let called = false
    const fetchImpl = (async () => {
      called = true
      return jsonResponse(OK_BODY)
    }) as unknown as typeof fetch
    const result = await moderate('hi', { fetchImpl, backoffBaseMs: 0 })
    expect(called).toBe(true)
    expect(result.flagged).toBe(true)
  })

  test('uses the pinned model and the dedicated key with an abort signal', async () => {
    let captured: { url: string; init: RequestInit } | undefined
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} }
      return jsonResponse(OK_BODY)
    }) as unknown as typeof fetch

    await moderate('screen me', {
      apiKey: 'sk-moderation-xyz',
      model: 'omni-moderation-2024-09-26',
      timeoutMs: 3000,
      fetchImpl,
      backoffBaseMs: 0,
    })

    expect(captured?.url).toBe('https://api.openai.com/v1/moderations')
    const headers = captured!.init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer sk-moderation-xyz')
    const body = JSON.parse(String(captured!.init.body)) as { model: string; input: string }
    expect(body.model).toBe('omni-moderation-2024-09-26')
    expect(body.input).toBe('screen me')
    expect(captured!.init.signal).toBeInstanceOf(AbortSignal)
  })
})
