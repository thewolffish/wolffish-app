/**
 * Channel-shared plain-text helpers.
 *
 * The model writes channel-native formatting itself (see CHANNEL_PROMPTS
 * in runtime/prefrontal.ts) and its prose is sent verbatim — there is no
 * Markdown converter between the model and any channel. What remains here
 * is for CODE-composed surfaces only: tool output and system reports that
 * are themselves Markdown and need to be flattened to readable plain text
 * before a channel embeds them (Telegram wraps tool results in <pre>,
 * which renders every byte literally; WhatsApp has no renderer at all).
 */

/**
 * Strip Markdown markup, keep the underlying text. Used for tool
 * results and system reports (e.g. insula /status) whose output is
 * itself Markdown — leaving `**bold**` and `## heading` intact would
 * surface the raw syntax in the user's chat. Plain shell/data output
 * without markup passes through unchanged.
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
