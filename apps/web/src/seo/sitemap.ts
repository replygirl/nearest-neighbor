// nearest-neighbor — sitemap.xml renderer
// Pure function; no route wiring. Wire into the server separately.

/**
 * Returns a valid XML sitemap for the given origin.
 *
 * Includes the landing page with changefreq weekly and priority 1.0.
 */
export function renderSitemapXml(origin: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`
}
