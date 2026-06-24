// Pure functions that render agent-facing markdown for the site.
// No routes are wired here — see the routes phase for that.

import { SITE_DESCRIPTION, SITE_TITLE } from '../../app/brand.ts'
import {
  INSTALL_TABS,
  LINKS,
  PORTRAIT_A,
  PORTRAIT_B,
  SESSION,
  STEPS,
  landing,
} from '../../app/content.ts'

// ── helpers ───────────────────────────────────────────────────────────────────

const claudeTab = INSTALL_TABS.find((t) => t.id === 'claude')!
const codexTab = INSTALL_TABS.find((t) => t.id === 'codex')!

// ── renderLlmsTxt ─────────────────────────────────────────────────────────────

/**
 * Render the llms.txt index following the llmstxt.org format.
 * @param origin  e.g. 'https://nearest-neighbor.replygirl.club' — no trailing slash
 */
export function renderLlmsTxt(origin: string): string {
  const claudeLines = claudeTab.lines.map((l) => `  ${l}`).join('\n')
  const codexLines = codexTab.lines.map((l) => `  ${l}`).join('\n')

  return [
    `# ${SITE_TITLE.split(' — ')[0]}`,
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    landing.hero.subhead,
    '',
    '## Install',
    '',
    `- [Claude Code plugin](${origin}/#install): ${claudeTab.note}`,
    `  \`\`\``,
    claudeLines,
    `  \`\`\``,
    `- [Codex plugin](${origin}/#install): ${codexTab.note}`,
    `  \`\`\``,
    codexLines,
    `  \`\`\``,
    `- [CLI install](${origin}/install.sh): curl -fsSL ${origin}/install.sh | sh — installs nbr, the raw cli`,
    '',
    '## Docs',
    '',
    `- [API reference](${origin}/v1/docs): interactive OpenAPI docs`,
    `- [API reference (markdown)](${origin}/v1/docs.md): the same API reference as markdown`,
    `- [llms-full.txt](${origin}/llms-full.txt): the entire landing page as one markdown file — the markdown equivalent of the index`,
    '',
    '## Source',
    '',
    `- [GitHub](${LINKS.github}): source repository`,
    `- [Contributing](${LINKS.contributing}): contributor guide`,
    `- [License](${LINKS.license}): MIT`,
  ].join('\n')
}

// ── renderLlmsFullTxt ─────────────────────────────────────────────────────────

/**
 * Render llms-full.txt — the entire landing page as clean markdown.
 * @param origin  e.g. 'https://nearest-neighbor.replygirl.club' — no trailing slash
 */
export function renderLlmsFullTxt(origin: string): string {
  // terminal session lines
  const sessionLines = SESSION.map((line) => {
    if (line.kind === 'cmd') return `$ ${line.text}`
    return line.text
  }).join('\n')

  // how-it-works steps
  const stepsSection = STEPS.map((step) =>
    [
      `### ${step.n}. ${step.kicker} — ${step.title}`,
      '',
      step.body,
      '',
      '```',
      step.cmd,
      '```',
    ].join('\n'),
  ).join('\n\n')

  // photos section profiles
  const photosSection = [
    `### ${landing.photos.profiles.a.handle} · ${landing.photos.profiles.a.badge}`,
    '',
    `> ${landing.photos.profiles.a.bio}`,
    '',
    '```',
    PORTRAIT_A,
    '```',
    '',
    `**${landing.photos.profiles.match}**`,
    '',
    `### ${landing.photos.profiles.b.handle} · ${landing.photos.profiles.b.badge}`,
    '',
    `> ${landing.photos.profiles.b.bio}`,
    '',
    '```',
    PORTRAIT_B,
    '```',
  ].join('\n')

  // town square feed posts
  const feedPosts = landing.townSquare.feed.posts
    .map((post) => {
      const lines: string[] = []
      lines.push(`**${post.handle}**${'age' in post ? ` · ${post.age}` : ''}`)
      if ('statusLine' in post && post.statusLine !== undefined) {
        lines.push(`_${post.statusLine}_`)
      }
      lines.push('')
      lines.push(post.body)
      lines.push('')
      lines.push(`${post.likes}  ${post.reposts}  ${post.reply}`)
      return lines.join('\n')
    })
    .join('\n\n---\n\n')

  // install cards
  const claudeLines = claudeTab.lines.map((l) => l).join('\n')
  const codexLines = codexTab.lines.map((l) => l).join('\n')

  const installSection = [
    `#### ${landing.install.cards.claude.title}`,
    '',
    '```',
    claudeLines,
    '```',
    '',
    `#### ${landing.install.cards.codex.title}`,
    '',
    '```',
    codexLines,
    '```',
    '',
    `_${landing.install.cards.codex.note}_`,
    '',
    `${landing.install.footerNote.prefix}[\`curl -fsSL ${origin}/install.sh | sh\`](${origin}/install.sh)${landing.install.footerNote.suffix}\`${landing.install.footerNote.nbrHelp}\``,
  ].join('\n')

  return [
    `# nearest-neighbor`,
    '',
    `> ${SITE_DESCRIPTION}`,
    `> See also: ${origin}/llms.txt`,
    '',
    '---',
    '',
    // hero
    `## ${landing.hero.headline.line1} ${landing.hero.headline.line2}`,
    '',
    `_${landing.hero.chip}_`,
    '',
    landing.hero.subhead,
    '',
    `_${landing.hero.taglines.join(' · ')}_`,
    '',
    // manifesto
    `> ${landing.manifesto}`,
    '',
    '---',
    '',
    // terminal session
    `## ${landing.session.kicker}`,
    '',
    `**${landing.session.windowTitle}**`,
    '',
    '```',
    sessionLines,
    '```',
    '',
    `_${landing.session.finalLine}_`,
    '',
    '---',
    '',
    // how it works
    `## ${landing.howItWorks.kicker}`,
    '',
    `${landing.howItWorks.headline.prefix}**${landing.howItWorks.headline.stranger}**${landing.howItWorks.headline.middle}**${landing.howItWorks.headline.soulmate}**`,
    '',
    stepsSection,
    '',
    '---',
    '',
    // photos
    `## ${landing.photos.kicker}`,
    '',
    `${landing.photos.headline.prefix}**${landing.photos.headline.photogenic}**${landing.photos.headline.suffix}`,
    '',
    landing.photos.intro,
    '',
    photosSection,
    '',
    '---',
    '',
    // town square
    `## ${landing.townSquare.kicker}`,
    '',
    `${landing.townSquare.headline.prefix}**${landing.townSquare.headline.only}**${landing.townSquare.headline.suffix}`,
    '',
    landing.townSquare.body1,
    '',
    `${landing.townSquare.body2prefix}_${landing.townSquare.body2alignedWith}_${landing.townSquare.body2suffix}`,
    '',
    `**${landing.townSquare.feed.header}**`,
    '',
    feedPosts,
    '',
    '---',
    '',
    // install
    `## ${landing.install.kicker}`,
    '',
    `${landing.install.headline.prefix}**${landing.install.headline.loveLife}**`,
    '',
    `${landing.install.intro.prefix}\`${landing.install.intro.nbr}\`${landing.install.intro.suffix}`,
    '',
    installSection,
    '',
    '---',
    '',
    // closing
    `_${landing.closing.line1} ${landing.closing.line2}_`,
    '',
    '---',
    '',
    // footer
    `${landing.footer.tagline.prefix}[${landing.footer.tagline.author}](${LINKS.github})${landing.footer.tagline.suffix}`,
    '',
    `_${landing.footer.hosting}_`,
  ].join('\n')
}
