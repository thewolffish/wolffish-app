/**
 * Convert the model's Markdown prose into the subset of HTML Telegram
 * accepts with `parse_mode: 'HTML'`. We pick HTML over MarkdownV2 for
 * one reason: MarkdownV2 demands every `.`, `-`, `(`, `)`, `!`, etc.
 * be backslash-escaped, even in plain prose. One missed escape and
 * Telegram rejects the whole message. HTML only needs `<`, `>`, `&`
 * escaped in text content — far less brittle.
 *
 * The converter is intentionally conservative. It handles the patterns
 * frontier LLMs reliably produce:
 *
 *  - fenced code blocks (with optional language hint)
 *  - inline backticks
 *  - bold (`**` and `__`)
 *  - italic (`*` and `_`)
 *  - inline links `[text](url)`
 *  - headings (`#`..`######`) → bold (Telegram has no h1)
 *  - bullets (`-`, `*`, `+` at line start) → `• `
 *  - block quotes (`> `)
 *
 * Anything else passes through as text. Tables, footnotes, images, raw
 * HTML, etc. fall through. This is a pragmatic mapping, not a full
 * Markdown spec.
 */

const PLACEHOLDER_PREFIX = ' WOLFFISH_CODE_'
const PLACEHOLDER_SUFFIX = ' '

/** Convert Markdown text into Telegram-flavored HTML. Idempotent for
 *  prose that contains no Markdown markup — plain sentences fall
 *  through untouched aside from HTML-entity escaping. */
export function markdownToTelegramHtml(input: string): string {
  // Stash code blocks BEFORE any other rewriting. Their contents must
  // not be touched by the bold/italic/link passes — fenced code is a
  // verbatim region.
  const stashed: string[] = []
  const stash = (html: string): string => {
    const placeholder = `${PLACEHOLDER_PREFIX}${stashed.length}${PLACEHOLDER_SUFFIX}`
    stashed.push(html)
    return placeholder
  }

  let text = input

  // Fenced code blocks (```lang ... ```). Trim a single trailing
  // newline inside the fence so the rendered <pre> doesn't ship with
  // a blank tail line.
  text = text.replace(/```([A-Za-z0-9_+-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = escapeHtml(stripTrailingNewline(code))
    if (lang) {
      return stash(`<pre><code class="language-${escapeAttr(lang)}">${escaped}</code></pre>`)
    }
    return stash(`<pre>${escaped}</pre>`)
  })

  // Inline code spans. `\`x\`` — the contents must be escaped but no
  // further markup processed.
  text = text.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`))

  // Now safe to escape the rest of the text — code regions are
  // already represented as opaque placeholders.
  text = escapeHtml(text)

  // Inline links. Run before bold/italic so a link's label can't be
  // accidentally picked up as italic. Prevent the URL from inheriting
  // any reserved chars by escaping it as an attribute.
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    if (!isSafeUrl(url)) return `${label} (${url})`
    return `<a href="${escapeAttr(url)}">${label}</a>`
  })

  // Headings — Telegram has no h1; bold is the closest visual mapping.
  text = text.replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/gm, '<b>$1</b>')

  // Bullets. Triple asterisk `***` is treated as bold-italic later, so
  // we only translate single `* `, `- `, `+ ` at line start.
  text = text.replace(/^([ \t]*)[*+-][ \t]+/gm, '$1• ')

  // Block quotes. Stack consecutive `> ` lines into a single
  // <blockquote> so Telegram renders one quoted region rather than a
  // chain of one-line quotes.
  text = text.replace(/(?:^>[ \t]?.*(?:\n|$))+?/gm, (block) => {
    const inner = block
      .split('\n')
      .map((line) => line.replace(/^>[ \t]?/, ''))
      .filter((line, idx, arr) => !(idx === arr.length - 1 && line === ''))
      .join('\n')
    return `<blockquote>${inner}</blockquote>\n`
  })

  // Bold (`**...**` and `__...__`). Run before italic so single-`*`
  // markers don't steal the inner content.
  text = text.replace(/\*\*([^*\n][^*\n]*?)\*\*/g, '<b>$1</b>')
  text = text.replace(/__([^_\n][^_\n]*?)__/g, '<b>$1</b>')

  // Italic — single `*` or `_`, with word-boundary checks so we don't
  // grab snake_case identifiers or arithmetic like `2*3`.
  text = text.replace(/(?<![*\w])\*([^*\n][^*\n]*?)\*(?![*\w])/g, '<i>$1</i>')
  text = text.replace(/(?<![_\w])_([^_\n][^_\n]*?)_(?![_\w])/g, '<i>$1</i>')

  // Restore code regions.
  text = text.replace(
    new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g'),
    (_, idx) => stashed[Number(idx)] ?? ''
  )

  return text
}

/** Escape `&`, `<`, `>` for HTML text content. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Escape for use inside a double-quoted HTML attribute. */
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

function stripTrailingNewline(s: string): string {
  return s.replace(/\n+$/, '')
}

const LRM = '\u200E'
const RLM = '\u200F'
const RTL_SCRIPT = /[֐-׿؀-ۿ܀-ݏހ-޿ﭐ-﷿ﹰ-\uFEFF]/
const LTR_SCRIPT = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u1E00-\u1EFF]/

/**
 * Return a zero-width Unicode directional mark matching the first
 * strong character in `text`. Prepending this to a Telegram message
 * forces the correct paragraph direction regardless of the client's
 * UI locale — without it, RTL clients can reorder LTR text around
 * punctuation (e.g. "Hey! What's up?" → "! What's up?Hey").
 *
 * ⚠️ BREAKING CHANGE RISK: the invisible mark becomes the first
 * character of every outgoing message. Anything downstream that
 * compares, hashes, or parses the raw message text (e.g. reply
 * matching, dedup, or Telegram's own /command detection) may break
 * if it doesn't expect a leading zero-width char.
 */
export function bidiMark(text: string): string {
  for (const ch of text) {
    if (RTL_SCRIPT.test(ch)) return RLM
    if (LTR_SCRIPT.test(ch)) return LRM
  }
  return ''
}

/** Allow http(s), tg, mailto. Block javascript: and data: schemes. */
function isSafeUrl(url: string): boolean {
  return /^(?:https?:\/\/|tg:\/\/|mailto:)/i.test(url) || /^[/#?]/.test(url)
}

/**
 * Strip Markdown markup, keep the underlying text. Used for tool
 * results before we wrap them in <pre> — Telegram's code blocks
 * render every byte literally, so leaving `**bold**` and `## heading`
 * intact would surface the raw syntax in the user's chat. Plain
 * shell/data output without markup passes through unchanged.
 */
export function markdownToPlain(text: string): string {
  return text
    .replace(/```[A-Za-z0-9_+-]*\n?([\s\S]*?)```/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/gm, '$1')
    .replace(/^([ \t]*)[*+-][ \t]+/gm, '$1• ')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, '$1')
    .replace(/(?<![_\w])_([^_\n]+)_(?![_\w])/g, '$1')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/^>[ \t]?/gm, '')
}
