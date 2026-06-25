/**
 * Renders an OpenAPI 3 JSON document into clean human/agent-readable markdown.
 *
 * Pure function — no fetching, no side effects. Route wiring happens in a
 * separate phase that fetches /v1/openapi.json and calls this.
 */

// ---------------------------------------------------------------------------
// Narrow helpers — guard every access against an unknown/malformed spec
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderInfo(spec: Record<string, unknown>): string {
  const info = isObject(spec['info']) ? spec['info'] : {}
  const title = str(info['title']) ?? 'API'
  const description = str(info['description'])
  const version = str(info['version']) ?? ''

  const lines: string[] = []
  lines.push(`# ${title}`)
  lines.push('')
  if (description) {
    lines.push(description)
    lines.push('')
  }
  if (version) {
    lines.push(`Version: ${version}`)
    lines.push('')
  }
  lines.push(
    'Interactive docs: [/v1/docs](/v1/docs) · Raw spec: [/v1/openapi.json](/v1/openapi.json)',
  )
  return lines.join('\n')
}

function renderParameters(parameters: unknown[]): string {
  if (parameters.length === 0) return ''
  const lines: string[] = ['**Parameters:**']
  for (const p of parameters) {
    if (!isObject(p)) continue
    const name = str(p['name'])
    const location = str(p['in'])
    const required = p['required'] === true
    const description = str(p['description'])
    if (!name) continue
    const parts = [
      `\`${name}\``,
      location ? `(${location})` : undefined,
      required ? '★' : undefined,
    ]
    const label = parts.filter(Boolean).join(' ')
    lines.push(`- ${label}${description ? ` — ${description}` : ''}`)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

function renderContentTypes(mediaTypeMap: unknown): string {
  if (!isObject(mediaTypeMap)) return ''
  const types = Object.keys(mediaTypeMap)
  return types.length > 0 ? types.join(', ') : ''
}

function renderRequestBody(requestBody: unknown): string {
  if (!isObject(requestBody)) return ''
  const content = requestBody['content']
  const types = renderContentTypes(content)
  if (!types) return ''
  const required = requestBody['required'] === true
  return `**Request body** (${types})${required ? ' ★ required' : ''}`
}

function renderResponses(responses: unknown): string {
  if (!isObject(responses)) return ''
  const lines: string[] = ['**Responses:**']
  for (const [status, resp] of Object.entries(responses)) {
    if (!isObject(resp)) continue
    const description = str(resp['description'])
    const content = resp['content']
    const types = renderContentTypes(content)
    const typePart = types ? ` \`${types}\`` : ''
    lines.push(`- \`${status}\`${typePart}${description ? ` — ${description}` : ''}`)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

function renderOperation(method: string, path: string, operation: unknown): string {
  if (!isObject(operation)) return ''
  const lines: string[] = []

  lines.push(`## ${method.toUpperCase()} ${path}`)
  lines.push('')

  const summary = str(operation['summary'])
  const description = str(operation['description'])

  if (summary) {
    lines.push(`**${summary}**`)
    lines.push('')
  }
  if (description && description !== summary) {
    lines.push(description)
    lines.push('')
  }

  // Auth
  const security = operation['security']
  const hasAuth = Array.isArray(security) ? security.length > 0 : false
  lines.push(hasAuth ? '🔒 Requires authentication (Bearer JWT)' : '🔓 No authentication required')
  lines.push('')

  // Parameters
  const parameters = arr(operation['parameters'])
  const paramSection = renderParameters(parameters)
  if (paramSection) {
    lines.push(paramSection)
    lines.push('')
  }

  // Request body
  const bodySection = renderRequestBody(operation['requestBody'])
  if (bodySection) {
    lines.push(bodySection)
    lines.push('')
  }

  // Responses
  const respSection = renderResponses(operation['responses'])
  if (respSection) {
    lines.push(respSection)
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

// Stable HTTP method order for consistent output
const METHOD_ORDER = ['get', 'head', 'post', 'put', 'patch', 'delete', 'options', 'trace']

function sortedPaths(paths: unknown): [string, Record<string, unknown>][] {
  if (!isObject(paths)) return []
  return Object.entries(paths)
    .filter((entry): entry is [string, Record<string, unknown>] => isObject(entry[1]))
    .toSorted(([a], [b]) => a.localeCompare(b))
}

function sortedMethods(pathItem: Record<string, unknown>): [string, unknown][] {
  const pairs: [string, unknown][] = []
  for (const method of METHOD_ORDER) {
    if (method in pathItem) {
      pairs.push([method, pathItem[method]])
    }
  }
  // Append any non-standard methods not in the list above
  for (const [key, val] of Object.entries(pathItem)) {
    if (!METHOD_ORDER.includes(key)) {
      pairs.push([key, val])
    }
  }
  return pairs
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render an OpenAPI 3 document object into human/agent-readable markdown.
 *
 * Defensive: guards every field access, never throws on a malformed or empty
 * spec. Input is typed as `unknown` — callers may pass the raw JSON.parse
 * result without casting.
 */
export function renderOpenapiMarkdown(spec: unknown): string {
  if (!isObject(spec)) {
    return '# API\n\nNo spec available.\n'
  }

  const sections: string[] = [renderInfo(spec)]

  const paths = sortedPaths(spec['paths'])
  for (const [path, pathItem] of paths) {
    for (const [method, operation] of sortedMethods(pathItem)) {
      const rendered = renderOperation(method, path, operation)
      if (rendered) sections.push(rendered)
    }
  }

  return sections.join('\n\n') + '\n'
}
