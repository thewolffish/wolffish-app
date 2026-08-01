import { rateConversationTurn, type ConversationRating } from '@main/conversations'
import type { ReflectionConfig } from '@main/workspace/workspace'

/**
 * Channel turn scoring — the WhatsApp/Telegram equivalent of the in-app
 * rating bar. A reply that is nothing but a number 0-10 is the user's score
 * for the last completed turn, captured silently instead of dispatched as a
 * message; anything else stays an ordinary message. Per-channel toggles live
 * in Settings → Knowledge → Reflection (scoring a numeric answer would be
 * swallowed, so the escape hatch is one switch away).
 *
 * Ordering contract at the call sites: the vote check runs AFTER pending
 * picker selections and pending ask_user questions — a "3" answering a
 * numbered picker or question card must keep meaning option 3.
 */

// Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits normalize to
// ASCII so a vote typed on an Arabic keyboard registers the same.
const DIGIT_MAP: Record<string, string> = {}
for (let i = 0; i <= 9; i++) {
  DIGIT_MAP[String.fromCharCode(0x0660 + i)] = String(i)
  DIGIT_MAP[String.fromCharCode(0x06f0 + i)] = String(i)
}

function normalizeDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (ch) => DIGIT_MAP[ch] ?? ch)
}

/** Parse a bare 0-10 reply; null for anything that is not ONLY a score. */
export function parseTurnScore(text: string): number | null {
  const t = normalizeDigits(text.trim())
  if (!/^(?:10|[0-9])$/.test(t)) return null
  return Number(t)
}

/**
 * Capture a channel vote when everything lines up: the text is a bare score,
 * the channel's scoring toggle is on, the chat is bound to a conversation,
 * and that conversation has a completed assistant turn to score. Returns the
 * applied rating, or null — in which case the caller lets the message fall
 * through the normal dispatch path (a "7" opener to an empty chat becomes a
 * message, not a lost vote).
 */
export async function tryCaptureChannelScore(
  channel: 'telegram' | 'whatsapp',
  conversationId: string | null | undefined,
  text: string,
  // Injected (only a type is imported from workspace.ts): a value import of
  // workspace.ts would drag electron-toolkit into this module at load, and
  // the parse half must stay loadable in plain-node tests.
  getConfig: () => Promise<ReflectionConfig>
): Promise<ConversationRating | null> {
  const score = parseTurnScore(text)
  if (score === null) return null
  if (!conversationId) return null
  try {
    const cfg = await getConfig()
    if (!cfg.scoring[channel]) return null
    return await rateConversationTurn(conversationId, null, score, channel)
  } catch {
    return null
  }
}
