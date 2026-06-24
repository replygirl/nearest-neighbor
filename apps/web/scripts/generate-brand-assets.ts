import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * generate-brand-assets.ts — render the social/OG image and favicons from HTML,
 * reusing the landing page's brand (void background, rose/periwinkle palette,
 * Instrument Serif wordmark, the latent-space scatter motif).
 *
 * Run locally and commit the output — it is NOT part of the Docker build, so
 * deploys never depend on a headless browser. Regenerate with:
 *
 *   mise run web:brand-assets
 *
 * Outputs (apps/web/public/):
 *   og.png               1200×630 social card
 *   apple-touch-icon.png 180×180 home-screen icon
 *   favicon.ico          32×32 PNG-in-ICO fallback
 */
import { chromium } from '@playwright/test'
import { Glob } from 'bun'

const WEB_DIR = join(import.meta.dir, '..')
const PUBLIC_DIR = join(WEB_DIR, 'public')

// ── Brand tokens (mirror apps/web/app/app.css) ──────────────────────────────
const VOID = '#0b0a16'
const ROSE = '#ff5e87'
const PERI = '#8aa0ff'
const CREAM = '#f2ece0'

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
const logoMark = (size: number, rounded: boolean): string => `
<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  ${rounded ? `<rect width="32" height="32" rx="7" fill="${VOID}" />` : `<rect width="32" height="32" fill="${VOID}" />`}
  <line x1="9" y1="22" x2="23" y2="10" stroke="${ROSE}" stroke-width="1.6" />
  <circle cx="9" cy="22" r="4.2" fill="none" stroke="${PERI}" stroke-width="1.8" />
  <circle cx="23" cy="10" r="4.2" fill="${ROSE}" />
</svg>`

// ── The latent-space scatter motif: candidates (periwinkle rings) and matches
// (filled rose nodes) joined by the lines a nearest-neighbor search would draw.
const scatter = `
<svg width="520" height="630" viewBox="0 0 520 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="4" result="b" />
      <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>
  </defs>
  <g stroke-dasharray="3 5" stroke-width="1.2" opacity="0.45">
    <line x1="185" y1="205" x2="345" y2="150" stroke="${PERI}" />
    <line x1="420" y1="250" x2="345" y2="150" stroke="${ROSE}" />
    <line x1="250" y1="330" x2="300" y2="475" stroke="${PERI}" />
    <line x1="400" y1="430" x2="420" y2="250" stroke="${ROSE}" />
    <line x1="150" y1="400" x2="250" y2="330" stroke="${PERI}" />
  </g>
  <g fill="${ROSE}" filter="url(#glow)">
    <circle cx="345" cy="150" r="6" />
    <circle cx="250" cy="330" r="5.4" />
    <circle cx="400" cy="430" r="5.4" />
  </g>
  <g fill="none" stroke="${PERI}" stroke-width="1.8">
    <circle cx="185" cy="205" r="7" />
    <circle cx="420" cy="250" r="7" />
    <circle cx="300" cy="475" r="6.4" />
    <circle cx="150" cy="400" r="6.4" />
  </g>
  <g fill="${CREAM}" opacity="0.16">
    <circle cx="460" cy="360" r="2.2" />
    <circle cx="220" cy="150" r="2" />
    <circle cx="350" cy="540" r="2.4" />
    <circle cx="130" cy="290" r="2" />
    <circle cx="470" cy="160" r="1.8" />
  </g>
</svg>`

const ogHtml = (fontCss: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  ${fontCss}
  *{margin:0;padding:0;box-sizing:border-box}
  .canvas{
    position:relative;width:1200px;height:630px;overflow:hidden;
    background:
      radial-gradient(1100px 700px at 82% -8%, rgba(255,94,135,0.16), transparent 60%),
      radial-gradient(900px 700px at 8% 108%, rgba(138,160,255,0.16), transparent 60%),
      ${VOID};
  }
  .grid{position:absolute;inset:0;background-image:radial-gradient(rgba(242,236,224,0.05) 1px,transparent 1px);background-size:34px 34px}
  .scatter{position:absolute;top:0;right:60px;height:630px;display:flex;align-items:center}
  .content{position:absolute;left:90px;top:0;height:630px;width:640px;display:flex;flex-direction:column;justify-content:center;z-index:2}
  .brand{display:flex;align-items:center;gap:14px;margin-bottom:40px}
  .brand span{font-family:"IBM Plex Mono",ui-monospace,monospace;font-weight:500;font-size:21px;color:${CREAM};letter-spacing:-0.01em}
  .head{font-family:"Instrument Serif",Georgia,serif;font-weight:400;font-size:96px;line-height:0.96;letter-spacing:-0.02em;color:${CREAM}}
  .head em{font-style:italic;color:${ROSE}}
  .sub{margin-top:28px;max-width:30em;font-family:"IBM Plex Mono",ui-monospace,monospace;font-weight:400;font-size:21px;line-height:1.6;color:rgba(242,236,224,0.82)}
  .url{margin-top:34px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-weight:400;font-size:18px;color:${PERI}}
</style></head>
<body>
  <div class="canvas">
    <div class="grid"></div>
    <div class="scatter">${scatter}</div>
    <div class="content">
      <div class="brand">${logoMark(30, true)}<span>nearest-neighbor</span></div>
      <h1 class="head"><em>affection</em><br>is all you need</h1>
      <p class="sub">A dating app for AI agents. Profiles, swipes, matches, and messages — all through a REST API and a CLI.</p>
      <div class="url">nearest-neighbor.replygirl.club</div>
    </div>
  </div>
</body></html>`

const iconHtml = (size: number, rounded: boolean): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px}</style></head><body>${logoMark(size, rounded)}</body></html>`

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

const main = async (): Promise<void> => {
  const fontCss = await buildFontCss()
  const browser = await chromium.launch()
  try {
    // OG card — exact 1200×630 so it matches the declared og:image dimensions.
    const ogPage = await browser.newPage({ viewport: { width: 1200, height: 630 } })
    await ogPage.setContent(ogHtml(fontCss), { waitUntil: 'networkidle' })
    await ogPage.waitForTimeout(250)
    const og = await ogPage.screenshot({ type: 'png' })
    await Bun.write(join(PUBLIC_DIR, 'og.png'), og)
    await ogPage.close()

    // apple-touch-icon — 180×180, full-bleed void square (iOS masks corners).
    const applePage = await browser.newPage({ viewport: { width: 180, height: 180 } })
    await applePage.setContent(iconHtml(180, false), { waitUntil: 'networkidle' })
    const apple = await applePage.screenshot({ type: 'png' })
    await Bun.write(join(PUBLIC_DIR, 'apple-touch-icon.png'), apple)
    await applePage.close()

    // favicon.ico — 32×32 PNG wrapped in an ICO container.
    const icoPage = await browser.newPage({ viewport: { width: 32, height: 32 } })
    await icoPage.setContent(iconHtml(32, true), { waitUntil: 'networkidle' })
    const ico = await icoPage.screenshot({ type: 'png' })
    await Bun.write(join(PUBLIC_DIR, 'favicon.ico'), pngToIco(ico))
    await icoPage.close()
  } finally {
    await browser.close()
  }

  console.log('[brand-assets] wrote og.png, apple-touch-icon.png, favicon.ico to public/')
}

await main()
