import {
  createConversation,
  loadConversation,
  updateConversation,
  type ConversationChannel,
  type ConversationFile
} from '@main/conversations'
import { runDetached } from '@main/runtime/corpus'

/**
 * The minimal LLM surface the titler needs: a dedicated TITLING call — a
 * titling system prompt plus the user's message as the user turn (NOT a
 * summarize). `Thalamus.title` satisfies this: it calls the active model with
 * the system prompt and emits its spend as role:'summary', so titling cost
 * lands on the ledger but never feeds a conversation's context meter.
 */
export interface TitlerLLM {
  title(userMessage: string, systemPrompt: string, signal?: AbortSignal): Promise<{ text: string }>
}

const TITLE_MAX_CHARS = 80

/** How many chars of the opening message the model sees — enough to grasp the topic. */
const TITLE_INPUT_MAX_CHARS = 2000

/**
 * The titling instructions live in the SYSTEM prompt (this is a titling call,
 * not a summarize): the model is told to NAME the conversation, and the user's
 * own message rides in the user turn. Criteria: based on the message, unique
 * and memorable, and neither too long nor too short.
 */
const TITLE_SYSTEM =
  `You generate the title for a conversation, shown in a sidebar list of chats. ` +
  `Read the user's opening message and write ONE title that:\n` +
  `- captures the specific topic or intent of that message — concrete, never generic\n` +
  `- is unique and memorable, not vague or interchangeable ` +
  `(avoid "General Question", "Help Request", "New Chat", "Assistance Needed")\n` +
  `- is neither too long nor too short: aim for 3 to 6 words, up to ~60 characters\n` +
  `- uses Title Case, with no surrounding quotes, no trailing punctuation, and no emoji\n` +
  `Reply with ONLY the title text — nothing else.`

/**
 * The title must reflect the user's OWN words, not the delivery metadata the
 * channels wrap around a turn. The composed history content the titler receives
 * can carry an `<attachments>` / `<video_instructions>` block (filename, mime,
 * size, absolute path — load-bearing for the agent's file tools) and a leading
 * `<voice_note …>` opener (carries the reply-language hint). Those are stripped
 * from the TITLE's copy ONLY — never from the history/wire content the model
 * sees, so file tools and reply-language behaviour are untouched. A caption-less
 * attachment strips to '' → titles as 'Untitled', which a later captioned turn
 * re-titles (the same self-healing path an aborted title takes). Anchored to the
 * exact sentinels so ordinary prose containing `<` or `>` is left intact.
 */
function titleSource(message: string): string {
  return message
    .replace(/^\s*<voice_note\b[^>]*>/i, '')
    .replace(/<attachments>[\s\S]*?<\/attachments>/gi, '')
    .replace(/<video_instructions>[\s\S]*?<\/video_instructions>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Title a conversation from its first user message with a PURE LLM call to the
 * chosen model — no heuristics. The message is first reduced to the user's own
 * words via titleSource() (delivery markup is stripped so a caption-less media
 * turn doesn't get titled from `<attachments>` metadata). Falls back to a plain
 * trimmed slice only if the model is UNREACHABLE, so titling can never block a
 * turn. The single title() call is itself resilient — Thalamus retries it 5×
 * with escalating backoff (abort-aware) before it throws — so the titler adds no
 * retry loop of its own; a second layer would only compound latency on the
 * title-first critical path. Returns '' when the call was ABORTED (a
 * same-conversation resend, or the caller's titling deadline) — abort is NOT
 * unreachability, so we must NOT persist a degraded fallback that would
 * permanently suppress the real title; the caller leaves the conversation
 * 'Untitled' and a later turn re-titles it. The call runs in a sealed background
 * scope so its usage event isn't relayed into any live turn's meter (the ledger
 * still records it).
 */
export async function titleFromMessage(
  userMessage: string,
  llm: TitlerLLM,
  signal?: AbortSignal
): Promise<string> {
  const trimmed = titleSource(userMessage)
  if (!trimmed) return 'Untitled'
  if (signal?.aborted) return ''
  try {
    const { text } = await runDetached(() =>
      llm.title(trimmed.slice(0, TITLE_INPUT_MAX_CHARS), TITLE_SYSTEM, signal)
    )
    return cleanTitle(text) || fallbackTitle(trimmed)
  } catch {
    // Abort takes the same throw path as a provider failure — tell them apart
    // so an aborted titling never lands a raw-slice fallback on disk/in cache.
    if (signal?.aborted) return ''
    return fallbackTitle(trimmed)
  }
}

/**
 * Ensure `conversationId` has a real (non-'Untitled') title, producing one via
 * the LLM and PERSISTING it if it doesn't yet — the caller runs this BEFORE
 * the turn processes, so the conversation is saved with its title first.
 *
 * Idempotent: a conversation already titled (a follow-up turn, a resumed chat)
 * returns its existing title with no LLM call. For an in-app conversation whose
 * file doesn't exist yet (the renderer persists only at end of turn), a titled
 * shell carrying the first user message is written now; the renderer's
 * end-of-turn save merges its messages in and keeps this title
 * (mergeConversationOnto prefers a real on-disk title over 'Untitled').
 *
 * Returns the resolved title, or undefined when there's nothing to title (no
 * conversation id / empty message) so the caller passes no title downstream.
 */
export async function ensureConversationTitle(
  conversationId: string | null,
  userMessage: string,
  channel: ConversationChannel | undefined,
  llm: TitlerLLM,
  signal?: AbortSignal
): Promise<string | undefined> {
  const trimmed = userMessage.trim()
  if (!conversationId) {
    // No persisted conversation (a null-id / subagent turn) — a display title
    // only, no save.
    return trimmed ? titleFromMessage(trimmed, llm, signal) : undefined
  }

  const existing = await loadConversation(conversationId).catch(() => null)
  if (existing?.title && existing.title !== 'Untitled') return existing.title
  if (!trimmed) return existing?.title ?? undefined

  const title = await titleFromMessage(trimmed, llm, signal)
  // Aborted (empty) — leave the conversation Untitled and UNwritten so the
  // titledCache isn't poisoned; the next turn on this conversation re-titles.
  if (!title) return existing?.title ?? undefined

  await updateConversation(conversationId, (disk) => {
    if (disk) {
      // Another writer may have titled it while the LLM ran — keep theirs.
      if (disk.title && disk.title !== 'Untitled') return null
      disk.title = title
      return disk
    }
    // In-app first turn: no file yet. Write a titled shell carrying the user's
    // message so the conversation appears (correctly titled) immediately and
    // survives even if the turn is abandoned before the renderer's save.
    const shell: ConversationFile = {
      ...createConversation(null),
      id: conversationId,
      title,
      messages: [{ role: 'user', content: trimmed, timestamp: Date.now() }]
    }
    if (channel) shell.channel = channel
    return shell
  }).catch(() => undefined)

  return title
}

/** Strip the model's framing (quotes, "Title:", trailing punctuation, extra lines). */
function cleanTitle(raw: string): string {
  let t = raw.trim()
  t = t.split(/\r?\n/)[0].trim()
  t = t.replace(/^title\s*[:\-–—]\s*/i, '').trim()
  t = t.replace(/^["'`“”]+|["'`“”]+$/g, '').trim()
  t = t.replace(/[.!?,;:]+$/, '').trim()
  if (t.length > TITLE_MAX_CHARS) t = t.slice(0, TITLE_MAX_CHARS).trim()
  return t
}

/** Plain trimmed slice — the only fallback when the model is unreachable. */
function fallbackTitle(message: string): string {
  const t = message.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX_CHARS).trim()
  return t || 'Untitled'
}
