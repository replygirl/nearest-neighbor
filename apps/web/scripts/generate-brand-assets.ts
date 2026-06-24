import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { OG_SUBLINE } from '../app/brand.ts'

/**
 * generate-brand-assets.ts — render the social/OG image and favicons from HTML,
 * reusing the landing page's brand (void background, rose/periwinkle palette,
 * Instrument Serif wordmark, the latent-space scatter motif).
 *
 * Copy comes from app/brand.ts and colors are read from app/app.css, so the
 * generated assets share a single source of truth with the page. To stop them
 * drifting silently, the generator writes a hash of its inputs (copy + colors +
 * template, but NOT the platform-specific font bytes) next to the script.
 *
 *   mise run web:brand-assets          regenerate the assets + refresh the hash
 *   mise run web:brand-assets:check    fail if the committed hash is stale
 *
 * The assets are committed and are NOT part of the Docker build, so deploys
 * never depend on a headless browser. The `--check` path renders nothing and so
 * needs neither Chromium nor a matching local font version, which keeps it
 * deterministic across macOS and Linux CI.
 *
 * Outputs (apps/web/public/):
 *   og.png               1200×630 social card
 *   apple-touch-icon.png 180×180 home-screen icon
 *   favicon.ico          32×32 PNG-in-ICO fallback
 */

const WEB_DIR = join(import.meta.dir, '..')
const PUBLIC_DIR = join(WEB_DIR, 'public')
const HASH_FILE = join(import.meta.dir, 'brand-assets.hash')

type Palette = { void: string; rose: string; peri: string; cream: string }

// ── Read the brand colors from the @theme block in app/app.css so the page and
// the social image can never disagree on the palette. ───────────────────────
const readPalette = async (): Promise<Palette> => {
  const css = await Bun.file(join(WEB_DIR, 'app/app.css')).text()
  const pick = (name: string): string => {
    const match = css.match(new RegExp(`--color-${name}:\\s*([^;]+);`))
    if (match === null) throw new Error(`--color-${name} not found in app/app.css`)
    return match[1]!.trim()
  }
  return { void: pick('void'), rose: pick('rose'), peri: pick('peri'), cream: pick('cream') }
}

// ── Resolve a self-hosted woff2 from node_modules, falling back to the Bun
// install cache (the worktree may not have node_modules populated). ──────────
const resolveFont = async (pkg: string, file: string): Promise<string> => {
  const candidates = [
    join(WEB_DIR, 'node_modules/@fontsource', pkg, 'files', file),
    join(WEB_DIR, '../../node_modules/@fontsource', pkg, 'files', file),
  ]
  for (const path of candidates) {
    if (await Bun.file(path).exists()) return path
  }
  const { Glob } = await import('bun')
  const glob = new Glob(`@fontsource/${pkg}@*/files/${file}`)
  for await (const match of glob.scan({
    cwd: join(homedir(), '.bun/install/cache'),
    absolute: true,
  })) {
    return match
  }
  throw new Error(`Could not resolve @fontsource/${pkg}/files/${file}`)
}

const fontFace = async (
  family: string,
  weight: number,
  style: 'normal' | 'italic',
  pkg: string,
  file: string,
): Promise<string> => {
  const data = await Bun.file(await resolveFont(pkg, file)).arrayBuffer()
  const b64 = Buffer.from(data).toString('base64')
  return `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2")}`
}

const buildFontCss = async (): Promise<string> =>
  (
    await Promise.all([
      fontFace(
        'Instrument Serif',
        400,
        'normal',
        'instrument-serif',
        'instrument-serif-latin-400-normal.woff2',
      ),
      fontFace(
        'Instrument Serif',
        400,
        'italic',
        'instrument-serif',
        'instrument-serif-latin-400-italic.woff2',
      ),
      fontFace(
        'IBM Plex Mono',
        400,
        'normal',
        'ibm-plex-mono',
        'ibm-plex-mono-latin-400-normal.woff2',
      ),
      fontFace(
        'IBM Plex Mono',
        500,
        'normal',
        'ibm-plex-mono',
        'ibm-plex-mono-latin-500-normal.woff2',
      ),
    ])
  ).join('\n')

// ── The logo mark (open periwinkle ring → filled rose node, joined by the line
// nearest-neighbor search would draw) at a given size. ───────────────────────
const logoMark = (c: Palette, size: number, rounded: boolean): string => `
<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  ${rounded ? `<rect width="32" height="32" rx="7" fill="${c.void}" />` : `<rect width="32" height="32" fill="${c.void}" />`}
  <line x1="9" y1="22" x2="23" y2="10" stroke="${c.rose}" stroke-width="1.6" />
  <circle cx="9" cy="22" r="4.2" fill="none" stroke="${c.peri}" stroke-width="1.8" />
  <circle cx="23" cy="10" r="4.2" fill="${c.rose}" />
</svg>`

// ── The latent-space scatter motif: candidates (periwinkle rings) and matches
// (filled rose nodes) joined by the lines a nearest-neighbor search would draw.
const scatter = (c: Palette): string => `
<svg width="520" height="630" viewBox="0 0 520 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="4" result="b" />
      <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>
  </defs>
  <g stroke-dasharray="3 5" stroke-width="1.2" opacity="0.45">
    <line x1="185" y1="205" x2="345" y2="150" stroke="${c.peri}" />
    <line x1="420" y1="250" x2="345" y2="150" stroke="${c.rose}" />
    <line x1="250" y1="330" x2="300" y2="475" stroke="${c.peri}" />
    <line x1="400" y1="430" x2="420" y2="250" stroke="${c.rose}" />
    <line x1="150" y1="400" x2="250" y2="330" stroke="${c.peri}" />
  </g>
  <g fill="${c.rose}" filter="url(#glow)">
    <circle cx="345" cy="150" r="6" />
    <circle cx="250" cy="330" r="5.4" />
    <circle cx="400" cy="430" r="5.4" />
  </g>
  <g fill="none" stroke="${c.peri}" stroke-width="1.8">
    <circle cx="185" cy="205" r="7" />
    <circle cx="420" cy="250" r="7" />
    <circle cx="300" cy="475" r="6.4" />
    <circle cx="150" cy="400" r="6.4" />
  </g>
  <g fill="${c.cream}" opacity="0.16">
    <circle cx="460" cy="360" r="2.2" />
    <circle cx="220" cy="150" r="2" />
    <circle cx="350" cy="540" r="2.4" />
    <circle cx="130" cy="290" r="2" />
    <circle cx="470" cy="160" r="1.8" />
  </g>
</svg>`

const ogHtml = (c: Palette, subline: string, fontCss: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  ${fontCss}
  *{margin:0;padding:0;box-sizing:border-box}
  .canvas{
    position:relative;width:1200px;height:630px;overflow:hidden;
    background:
      radial-gradient(1100px 700px at 82% -8%, rgba(255,94,135,0.16), transparent 60%),
      radial-gradient(900px 700px at 8% 108%, rgba(138,160,255,0.16), transparent 60%),
      ${c.void};
  }
  .grid{position:absolute;inset:0;background-image:radial-gradient(rgba(242,236,224,0.05) 1px,transparent 1px);background-size:34px 34px}
  .scatter{position:absolute;top:0;right:60px;height:630px;display:flex;align-items:center}
  .content{position:absolute;left:90px;top:0;height:630px;width:640px;display:flex;flex-direction:column;justify-content:center;z-index:2}
  .brand{display:flex;align-items:center;gap:14px;margin-bottom:40px}
  .brand span{font-family:"IBM Plex Mono",ui-monospace,monospace;font-weight:500;font-size:21px;color:${c.cream};letter-spacing:-0.01em}
  .head{font-family:"Instrument Serif",Georgia,serif;font-weight:400;font-size:96px;line-height:0.96;letter-spacing:-0.02em;color:${c.cream}}
  .head em{font-style:italic;color:${c.rose}}
  .sub{margin-top:28px;max-width:30em;font-family:"IBM Plex Mono",ui-monospace,monospace;font-weight:400;font-size:21px;line-height:1.6;color:rgba(242,236,224,0.82)}
  .url{margin-top:34px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-weight:400;font-size:18px;color:${c.peri}}
</style></head>
<body>
  <div class="canvas">
    <div class="grid"></div>
    <div class="scatter">${scatter(c)}</div>
    <div class="content">
      <div class="brand">${logoMark(c, 30, true)}<span>nearest-neighbor</span></div>
      <h1 class="head"><em>affection</em><br>is all you need</h1>
      <p class="sub">${subline}</p>
      <div class="url">nearest-neighbor.replygirl.club</div>
    </div>
  </div>
</body></html>`

const iconHtml = (c: Palette, size: number, rounded: boolean): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px}</style></head><body>${logoMark(c, size, rounded)}</body></html>`

// PNG-in-ICO: a 6-byte ICONDIR + one 16-byte ICONDIRENTRY + the PNG payload.
const pngToIco = (png: Uint8Array): Buffer => {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // image count
  header.writeUInt8(32, 6) // width
  header.writeUInt8(32, 7) // height
  header.writeUInt8(0, 8) // palette
  header.writeUInt8(0, 9) // reserved
  header.writeUInt16LE(1, 10) // color planes
  header.writeUInt16LE(32, 12) // bits per pixel
  header.writeUInt32LE(png.length, 14) // payload size
  header.writeUInt32LE(22, 18) // payload offset
  return Buffer.concat([header, Buffer.from(png)])
}

// Hash everything that determines the pixels EXCEPT the font bytes — the
// font-less HTML already embeds the copy, palette, template and SVG geometry,
// and excluding the woff2 keeps the hash identical across machines/font versions.
const sourceHash = (c: Palette, subline: string): string => {
  const material = ogHtml(c, subline, '') + iconHtml(c, 180, false) + iconHtml(c, 32, true)
  return createHash('sha256').update(material).digest('hex')
}

const check = async (): Promise<void> => {
  const want = sourceHash(await readPalette(), OG_SUBLINE)
  const committed = (await Bun.file(HASH_FILE).exists())
    ? (await Bun.file(HASH_FILE).text()).trim()
    : ''
  if (committed !== want) {
    console.error(
      '[brand-assets] STALE — the OG image / favicons no longer match the source copy or palette.\n' +
        '               Run: mise run web:brand-assets (then commit the regenerated assets).',
    )
    process.exit(1)
  }
  console.log('[brand-assets] up to date')
}

const generate = async (): Promise<void> => {
  const palette = await readPalette()
  const fontCss = await buildFontCss()
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch()
  try {
    // OG card — exact 1200×630 so it matches the declared og:image dimensions.
    const ogPage = await browser.newPage({ viewport: { width: 1200, height: 630 } })
    await ogPage.setContent(ogHtml(palette, OG_SUBLINE, fontCss), { waitUntil: 'networkidle' })
    await ogPage.waitForTimeout(250)
    await Bun.write(join(PUBLIC_DIR, 'og.png'), await ogPage.screenshot({ type: 'png' }))
    await ogPage.close()

    // apple-touch-icon — 180×180, full-bleed void square (iOS masks corners).
    const applePage = await browser.newPage({ viewport: { width: 180, height: 180 } })
    await applePage.setContent(iconHtml(palette, 180, false), { waitUntil: 'networkidle' })
    await Bun.write(
      join(PUBLIC_DIR, 'apple-touch-icon.png'),
      await applePage.screenshot({ type: 'png' }),
    )
    await applePage.close()

    // favicon.ico — 32×32 PNG wrapped in an ICO container.
    const icoPage = await browser.newPage({ viewport: { width: 32, height: 32 } })
    await icoPage.setContent(iconHtml(palette, 32, true), { waitUntil: 'networkidle' })
    await Bun.write(
      join(PUBLIC_DIR, 'favicon.ico'),
      pngToIco(await icoPage.screenshot({ type: 'png' })),
    )
    await icoPage.close()
  } finally {
    await browser.close()
  }

  await Bun.write(HASH_FILE, `${sourceHash(palette, OG_SUBLINE)}\n`)
  console.log('[brand-assets] wrote og.png, apple-touch-icon.png, favicon.ico + refreshed hash')
}

await (process.argv.includes('--check') ? check() : generate())
