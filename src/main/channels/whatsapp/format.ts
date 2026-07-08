/**
 * WhatsApp-specific text helpers.
 *
 * There is deliberately NO Markdown→WhatsApp converter here. The model
 * is taught to write WhatsApp's own formatting directly (CHANNEL_PROMPTS
 * in runtime/prefrontal.ts) and its prose is sent verbatim — the model
 * is the formatter, not this module. What remains is one helper for the
 * channel's CODE-composed surfaces.
 */

/**
 * Strip inline markup markers, keep the text. Used for model-authored
 * strings the channel embeds inside its own WhatsApp `*bold*` wrapper
 * (ask-card questions and option labels) — a stray asterisk or
 * underscore inside the span would break the wrapper or fight it, so
 * the label is flattened to plain text first. Links collapse to
 * "label (url)".
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
 * Validate a message against WhatsApp's own formatting WITHOUT sending it —
 * the engine behind the `whatsapp_check_format` tool. WhatsApp never
 * rejects a message, so this does NOT rewrite anything (the model is the
 * formatter); it flags leaked Markdown that WhatsApp would show as raw,
 * ugly syntax so the model can fix its own text before whatsapp_send.
 * WhatsApp's real syntax is single-char: *bold* _italic_ ~strike~
 * `code` ```block``` , "- "/"1. " lists, "> " quotes — those are fine.
 */
export function validateWhatsAppFormat(message: string): { ok: boolean; issues: string[] } {
  const issues: string[] = []

  if (/\*\*[^*\n]+\*\*/.test(message)) {
    issues.push(
      'Markdown **bold** (double asterisks) — WhatsApp bold is a SINGLE *asterisk*: *bold*.'
    )
  }
  if (/__[^_\n]+__/.test(message)) {
    issues.push(
      'Markdown __bold__ (double underscores) — WhatsApp italic is a SINGLE _underscore_: _italic_.'
    )
  }
  if (/^\s{0,3}#{1,6}\s+\S/m.test(message)) {
    issues.push('Markdown "# heading" — WhatsApp has no headings. Use a short *bold* line instead.')
  }
  // [text](url) links — but NOT the allowed ![alt](wolffish-media://…) image marker.
  if (/!?\[[^\]\n]*\]\((?!wolffish-media:\/\/)[^)\s]+\)/.test(message)) {
    issues.push(
      'Markdown [text](url) link — WhatsApp shows it raw. Paste the bare URL; WhatsApp auto-links it.'
    )
  }
  if (/^\s*\|.*\|.*$/m.test(message) || /\|\s*:?-{2,}/.test(message)) {
    issues.push(
      'Markdown | table | — WhatsApp has no tables. Write one "*Label:* value" line per fact.'
    )
  }
  if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/m.test(message)) {
    issues.push(
      'Markdown "---" horizontal rule — WhatsApp shows it raw. Use a blank line to separate sections.'
    )
  }
  if (/```[^\s`]+/.test(message)) {
    issues.push(
      'A language tag after ``` — WhatsApp shows the tag as text. Use a bare ``` fence with no language.'
    )
  }

  return { ok: issues.length === 0, issues }
}
