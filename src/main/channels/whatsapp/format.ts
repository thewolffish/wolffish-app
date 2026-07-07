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
