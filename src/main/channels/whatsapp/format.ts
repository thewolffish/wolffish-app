/**
 * Convert the model's Markdown prose into WhatsApp's own text formatting.
 * WhatsApp renders a small fixed set of markers — *bold*, _italic_,
 * ~strikethrough~, `inline code`, ```monospace blocks```, "- " bullets,
 * "1. " numbered items, and "> " quotes — and shows everything else as
 * literal text. Markdown that leaks through (## headings, **bold**,
 * | tables |, [text](url)) surfaces as raw syntax in the user's chat.
 *
 * Mirrors the shape of the Telegram converter (telegram/format.ts): a
 * conservative pass list over the patterns frontier LLMs reliably produce,
 * with verbatim regions stashed first so no later pass can touch them.
 *
 *  - fenced code blocks → ``` blocks (language hint dropped)
 *  - inline backticks → kept verbatim
 *  - links/images [text](url) → "text (url)" (WhatsApp auto-links URLs)
 *  - tables → "*Label:* value" lines (see convertTables)
 *  - headings (ATX #..######, incl. inside "> " quotes, and setext
 *    underlines) → a *bold* line
 *  - bold (** / __) → *single asterisks*; nested *italic* inside becomes
 *    _italic_
 *  - strikethrough (~~) → ~single tildes~
 *  - bullets "* " / "+ " → "- " (native bullet, no bold ambiguity)
 *  - task lists "- [ ]" / "- [x]" → ☐ / ☑
 *  - horizontal rules → dropped
 *
 * Deliberately NOT converted (accepted tradeoffs):
 *  - single-asterisk / single-underscore spans. In Markdown `*x*` means
 *    italic, but in WhatsApp it means bold — and the system prompt teaches
 *    the model to write WhatsApp formatting natively, so a single-marker
 *    span is far more likely intentional WhatsApp formatting than Markdown
 *    italic. Leaving it alone is what makes the converter idempotent:
 *    already-correct WhatsApp text passes through byte-identical, so the
 *    same text can safely be converted more than once.
 *  - ***bold-italic*** triple markers, and **bold spanning\nlines** (a
 *    WhatsApp marker can't cross a newline anyway).
 *  - single-line ```x``` fences (already valid WhatsApp monospace).
 *  - tables without a |---| separator row, and overflow cells in ragged
 *    rows (the conservative header+separator gate trades those for never
 *    mistaking prose pipes for tables).
 */

// Stash delimiters: Unicode private-use code points that never occur in
// model or user text (the input is sanitized of them up front). They are
// deliberately NOT whitespace — an earlier design used space-delimited
// placeholders and every trim in the pipeline (heading tails, table cells)
// destroyed them, shipping raw sentinel text to the user's chat.
const STASH_OPEN = '\uE000'
const STASH_CLOSE = '\uE001'

/** Convert Markdown text into WhatsApp formatting. Idempotent for text
 *  that is already WhatsApp-formatted — it falls through untouched. */
export function markdownToWhatsApp(input: string): string {
  // Verbatim regions (code, and every emitted single-asterisk bold span)
  // are stashed behind sentinels so later passes can't re-interpret them.
  // Restored — recursively, since a stashed span can itself contain an
  // earlier sentinel — at the end.
  const stashed: string[] = []
  const stash = (formatted: string): string => {
    const placeholder = `${STASH_OPEN}${stashed.length}${STASH_CLOSE}`
    stashed.push(formatted)
    return placeholder
  }

  // Strip any pre-existing sentinel code points so crafted/echoed input
  // can never collide with a real stash slot (substituting or deleting
  // user text).
  let text = input.replace(/[\uE000\uE001]/g, '')

  // Fenced code blocks (```lang\n...```): keep the fence, drop the
  // language hint (WhatsApp shows it as literal text on the first line).
  // The \n is required — a single-line ```x``` is already valid WhatsApp
  // monospace and must pass through untouched.
  text = text.replace(/```([A-Za-z0-9_+-]*)[ \t]*\n([\s\S]*?)```/g, (_, _lang, code) =>
    stash('```\n' + stripTrailingNewline(code) + '\n```')
  )

  // Inline code spans — verbatim in WhatsApp too; protect the contents.
  text = text.replace(/`([^`\n]+)`/g, (span) => stash(span))

  // Images → "alt (url)". WhatsApp can't inline an image from text; the
  // URL at least previews. Before the link pass (same bracket syntax).
  // Both run before headings/tables so bracket syntax inside those is
  // converted rather than frozen verbatim inside a stashed bold span.
  text = text.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (_, alt, url) =>
    alt ? `${alt} (${url})` : url
  )

  // Links → "text (url)" — WhatsApp has no hyperlink syntax but
  // auto-links bare URLs. A self-link keeps just the URL.
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, url) =>
    label === url ? url : `${label} (${url})`
  )

  // Tables — WhatsApp has no table rendering at all; rewrite as
  // "*Label:* value" lines before any inline pass touches the cells.
  text = convertTables(text, stash)

  // Setext headings ("Title" underlined with === or ---). Must run before
  // the horizontal-rule pass, which would otherwise delete a --- underline
  // and silently demote the heading. The title line must look like prose
  // (not a list/quote/heading/table line) to avoid misreading a genuine
  // rule after structured content.
  text = text.replace(/^([ \t]*[^\s#>*+|-][^\n]*)\n[ \t]*(?:={3,}|-{3,})[ \t]*$/gm, (_, title) =>
    stash(`*${stripInlineMarkup(title)}*`)
  )

  // ATX headings — WhatsApp has no headings; a bold line is the closest
  // visual mapping. An optional "> " quote prefix is preserved so quoted
  // headings convert too. Inline markers inside the heading are stripped
  // (the whole line is already bold). Stashed so the emitted single
  // asterisks survive the remaining passes.
  text = text.replace(
    /^([ \t]*(?:>[ \t]*)*)#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm,
    (_, prefix, heading) => `${prefix}${stash(`*${stripInlineMarkup(heading)}*`)}`
  )

  // Horizontal rules — nothing to map to; drop the line.
  text = text.replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')

  // Bold: Markdown ** and __ → WhatsApp single *. Stashed — the emitted
  // single asterisks must not be re-read by anything downstream.
  // The opener/closer boundary guards reject intra-word ** (so Python
  // exponents like 2**8 never cross-pair into a bogus bold span), and the
  // inner alternation admits lone asterisks so nested emphasis
  // (**really *very* important**) converts instead of leaking raw ** —
  // the nested Markdown italic becomes WhatsApp _italic_.
  text = text.replace(
    /(?<![\w*])\*\*(?!\s)((?:[^*\n]|\*(?!\*))+?)(?<!\s)\*\*(?![\w*])/g,
    (_, inner: string) => stash(`*${inner.replace(/\*([^*\n]+)\*/g, '_$1_')}*`)
  )
  text = text.replace(/(?<![\w_])__([^_\n][^_\n]*?)__(?![\w_])/g, (_, inner) => stash(`*${inner}*`))

  // Strikethrough: ~~x~~ → ~x~.
  text = text.replace(/~~([^~\n]+)~~/g, '~$1~')

  // Task lists — before the bullet rewrite (the marker is part of the match).
  text = text.replace(/^([ \t]*)[-*+][ \t]+\[ \][ \t]+/gm, '$1- ☐ ')
  text = text.replace(/^([ \t]*)[-*+][ \t]+\[[xX]\][ \t]+/gm, '$1- ☑ ')

  // Bullets: "* " and "+ " → "- ". WhatsApp accepts "* " as a bullet too,
  // but normalizing to "- " removes any ambiguity with bold asterisks.
  text = text.replace(/^([ \t]*)[*+][ \t]+/gm, '$1- ')

  // Restore verbatim regions. Looped because a stashed span can contain a
  // sentinel from an earlier pass (e.g. a heading around `code`); each
  // round resolves one level of nesting. Bounded — nesting is shallow.
  for (let round = 0; round < 8 && text.includes(STASH_OPEN); round++) {
    text = text.replace(
      new RegExp(`${STASH_OPEN}(\\d+)${STASH_CLOSE}`, 'g'),
      (_, idx) => stashed[Number(idx)] ?? ''
    )
  }

  return text
}

/**
 * Strip inline Markdown markers, keep the text. Used for content that is
 * being embedded inside a WhatsApp bold span (headings, table labels,
 * ask-card labels) — the wrapper is already bold, so inner markers would
 * only render as literal asterisks or fight the wrapper. Links collapse
 * to "label (url)".
 */
export function stripInlineMarkup(s: string): string {
  return s
    .replace(/!?\[([^\]\n]*)\]\(([^)\s]+)\)/g, (_, label, url) =>
      label && label !== url ? `${label} (${url})` : url
    )
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, '$1')
    .replace(/(?<![_\w])_([^_\n]+)_(?![_\w])/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .trim()
}

/**
 * Rewrite Markdown tables as WhatsApp-readable lines. A table block is a
 * row line (≥2 cells), a separator line (---|--- style), then data rows.
 *
 *  - 2 columns → one "*first:* second" line per row. The header row is
 *    dropped: it's typically generic ("Detail | Value") and the key/value
 *    lines carry the meaning on their own.
 *  - 3+ columns → one block per row: the first cell as a *bold* title,
 *    then "Header: value" lines for the remaining cells; blank line
 *    between rows.
 *
 * Anything that doesn't match the header+separator shape passes through
 * untouched — a stray "|" in prose is never mistaken for a table. When
 * the header row is pipe-framed (starts with "|", as LLM tables are),
 * data rows must be pipe-framed too, so a prose sentence containing " | "
 * directly under a table is never swallowed as a row.
 */
function convertTables(text: string, stash: (s: string) => string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const header = parseTableRow(lines[i])
    if (header && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const piped = lines[i].trim().startsWith('|')
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length) {
        if (piped && !lines[j].trim().startsWith('|')) break
        const cells = parseTableRow(lines[j])
        if (!cells) break
        rows.push(cells)
        j++
      }
      out.push(renderTable(header, rows, stash))
      i = j
      continue
    }
    out.push(lines[i])
    i++
  }
  return out.join('\n')
}

/** Split a table line into trimmed cells, or null if it isn't one. */
function parseTableRow(line: string): string[] | null {
  if (!line.includes('|')) return null
  let s = line.trim()
  if (s.length === 0) return null
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  const cells = s.split('|').map((c) => c.trim())
  return cells.length >= 2 ? cells : null
}

/** True for the |---|:---:| alignment row under a table header. */
function isSeparatorRow(line: string): boolean {
  const cells = parseTableRow(line)
  return cells !== null && cells.every((c) => /^:?-+:?$/.test(c))
}

function renderTable(header: string[], rows: string[][], stash: (s: string) => string): string {
  if (rows.length === 0) {
    return stash(`*${header.map(stripInlineMarkup).join(' — ')}*`)
  }

  if (header.length === 2) {
    return rows
      .map((r) => {
        const key = stripInlineMarkup(r[0] ?? '')
        const value = (r[1] ?? '').trim()
        if (!key) return value
        return value ? `${stash(`*${key}:*`)} ${value}` : stash(`*${key}:*`)
      })
      .filter((l) => l.length > 0)
      .join('\n')
  }

  return rows
    .map((r) => {
      const parts: string[] = []
      const title = stripInlineMarkup(r[0] ?? '')
      if (title) parts.push(stash(`*${title}*`))
      for (let c = 1; c < header.length; c++) {
        const value = (r[c] ?? '').trim()
        if (value) parts.push(`${stripInlineMarkup(header[c] ?? '')}: ${value}`)
      }
      return parts.join('\n')
    })
    .filter((b) => b.length > 0)
    .join('\n\n')
}

function stripTrailingNewline(s: string): string {
  return s.replace(/\n+$/, '')
}
