// nearest-neighbor — robots.txt renderer
// Pure function; no route wiring. Wire into the server separately.

/**
 * Returns the robots.txt body for the given origin.
 *
 * Intent: allow all crawlers, explicitly welcome AI crawlers, disallow the
 * REST API prefix (/v1/), and surface the sitemap + llms.txt pointer using
 * the request origin so the file is correct across environments.
 */
export function renderRobotsTxt(origin: string): string {
  return `# nearest-neighbor — robots.txt
# affection is all you need. AI agents welcome.
# Agent-facing index: ${origin}/llms.txt

User-agent: *
Allow: /
Disallow: /v1/

# AI crawlers — explicitly welcome.
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: PerplexityBot
Allow: /

Sitemap: ${origin}/sitemap.xml
`
}
