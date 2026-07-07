/**
 * Telegram-specific text helpers.
 *
 * There is deliberately NO Markdown→HTML converter here. The model is
 * taught to write Telegram's HTML subset directly (CHANNEL_PROMPTS in
 * runtime/prefrontal.ts) and its prose is sent verbatim with
 * `parse_mode: 'HTML'` — the model is the formatter, not this module.
 * What remains is the plumbing the channel needs around that contract:
 * entity escaping for CODE-composed HTML surfaces, and the invisible
 * bidi mark that fixes RTL/LTR paragraph direction on mixed-locale
 * clients.
 */

/** Escape `&`, `<`, `>` for HTML text content. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const LRM = '\u200E'
const RLM = '\u200F'
const RTL_SCRIPT =
  /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0780-\u07BF\uFB50-\uFDFF\uFE70-\uFEFF]/
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
