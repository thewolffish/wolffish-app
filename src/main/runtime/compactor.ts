import { type ChatMessage, type Thalamus } from '@main/runtime/thalamus'

// ---------------------------------------------------------------------------
// Smart Context Compaction
// ---------------------------------------------------------------------------
// When the accumulated messages[] would overflow the active model's context
// window, this module compacts messages in-place to fit. It targets content
// in priority order:
//
//   1. Tool results — largest first, skip errors + 3 most recent
//   2. Older assistant messages — oldest first, skip the most recent 2
//   3. Older user messages — oldest first, skip the most recent 2
//
// Each target is LLM-summarized in parallel via the cheapest provider. When
// the LLM call fails, a deterministic head+tail truncation is used instead.
//
// The messages[] array IS mutated in-place. This is safe because persistence
// works through broca segments, hippocampus only sees episode summaries, and
// the messages array is local to the current turn. In-place mutation ensures
// subsequent iterations don't re-compact the same content.
// ---------------------------------------------------------------------------

// JSON-heavy tool results tokenize at ~2-2.5 chars/token. We use chars/2
// because the cost of underestimation (context overflow → hard 400) vastly
// exceeds overestimation (unnecessary compaction).
const CHARS_PER_TOKEN = 2

/** Metadata about a single compacted message. */
export type CompactionTarget = {
  /** Index in the messages array. */
  index: number
  /** Original char length of the content. */
  originalChars: number
  /** Estimated tokens of the original content. */
  originalTokens: number
  /** The tool name (for tool results), or role label. */
  toolName?: string
}

/** Result of a compaction pass. */
export type CompactionResult = {
  /** Per-target metadata for the compaction card. */
  targets: Array<
    CompactionTarget & {
      /** Chars after compaction. */
      compactedChars: number
      /** Which model performed the compaction (or 'truncate'). */
      compactedBy: string
    }
  >
  /** Total tokens saved. */
  tokensSaved: number
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

export function estimatePayloadTokens(systemPrompt: string, messages: ChatMessage[]): number {
  let chars = systemPrompt.length
  for (const m of messages) {
    switch (m.role) {
      case 'system':
        chars += m.content.length
        break
      case 'user':
        if (typeof m.content === 'string') {
          chars += m.content.length
        } else {
          for (const block of m.content) {
            if (block.type === 'text') chars += block.text.length
            else if (block.type === 'image' || block.type === 'document')
              chars += block.data.length * 0.75
          }
        }
        break
      case 'assistant':
        chars += m.content.length
        if (m.reasoningContent) chars += m.reasoningContent.length
        if (m.toolUses) {
          for (const tu of m.toolUses) {
            chars += tu.name.length + JSON.stringify(tu.args).length
          }
        }
        break
      case 'tool':
        chars += m.content.length
        if (m.images) {
          for (const img of m.images) chars += img.data.length * 0.75
        }
        break
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

/** Get the text content length of a message (for candidate sizing). */
function messageContentLength(m: ChatMessage): number {
  switch (m.role) {
    case 'user':
      if (typeof m.content === 'string') return m.content.length
      return m.content.reduce((sum, b) => sum + (b.type === 'text' ? b.text.length : 0), 0)
    case 'assistant':
      return m.content.length + (m.reasoningContent?.length ?? 0)
    case 'tool':
      return m.content.length
    default:
      return 0
  }
}

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------

/** Number of most-recent tool results to protect from compaction. */
const PROTECT_TOOL_RESULTS = 3
/** Number of most-recent assistant/user messages to protect. */
const PROTECT_RECENT_MESSAGES = 2
/** Minimum content size worth compacting (chars). */
const MIN_COMPACTION_SIZE = 500

/**
 * Select messages for compaction in priority order:
 *   1. Tool results (largest first, skip errors + 3 most recent)
 *   2. Older assistant messages (oldest first, skip 2 most recent)
 *   3. Older user messages (oldest first, skip 2 most recent)
 *
 * Picks greedily until projected savings cover the excess.
 */
export function selectCompactionTargets(
  messages: ChatMessage[],
  currentTokens: number,
  inputBudget: number
): CompactionTarget[] {
  const buffer = Math.floor(inputBudget * 0.1)
  const targetBudget = inputBudget - buffer
  const excess = currentTokens - targetBudget
  if (excess <= 0) return []

  const COMPACTION_RATIO = 0.15 // compacted ≈ 15% of original

  // --- Pass 1: tool results (largest first) ---
  const protectedTools = new Set<number>()
  let toolCount = 0
  for (let i = messages.length - 1; i >= 0 && toolCount < PROTECT_TOOL_RESULTS; i--) {
    if (messages[i].role === 'tool') {
      protectedTools.add(i)
      toolCount++
    }
  }

  const toolCandidates: CompactionTarget[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'tool') continue
    if (m.isError) continue
    if (protectedTools.has(i)) continue
    if (m.content.length <= MIN_COMPACTION_SIZE) continue
    toolCandidates.push({
      index: i,
      originalChars: m.content.length,
      originalTokens: Math.ceil(m.content.length / CHARS_PER_TOKEN),
      toolName: m.toolName
    })
  }
  toolCandidates.sort((a, b) => b.originalTokens - a.originalTokens)

  const selected: CompactionTarget[] = []
  let projectedSavings = 0

  for (const c of toolCandidates) {
    if (projectedSavings >= excess) break
    selected.push(c)
    projectedSavings += Math.floor(c.originalTokens * (1 - COMPACTION_RATIO))
  }

  if (projectedSavings >= excess) return selected

  // --- Pass 2: older assistant messages (oldest first) ---
  const protectedRecent = new Set<number>()
  let assistantCount = 0
  for (let i = messages.length - 1; i >= 0 && assistantCount < PROTECT_RECENT_MESSAGES; i--) {
    if (messages[i].role === 'assistant') {
      protectedRecent.add(i)
      assistantCount++
    }
  }

  for (let i = 0; i < messages.length; i++) {
    if (projectedSavings >= excess) break
    const m = messages[i]
    if (m.role !== 'assistant') continue
    if (protectedRecent.has(i)) continue
    const len = messageContentLength(m)
    if (len <= MIN_COMPACTION_SIZE) continue
    const tokens = Math.ceil(len / CHARS_PER_TOKEN)
    selected.push({
      index: i,
      originalChars: len,
      originalTokens: tokens,
      toolName: 'assistant'
    })
    projectedSavings += Math.floor(tokens * (1 - COMPACTION_RATIO))
  }

  if (projectedSavings >= excess) return selected

  // --- Pass 3: older user messages (oldest first) ---
  let userCount = 0
  for (let i = messages.length - 1; i >= 0 && userCount < PROTECT_RECENT_MESSAGES; i--) {
    if (messages[i].role === 'user') {
      protectedRecent.add(i)
      userCount++
    }
  }

  for (let i = 0; i < messages.length; i++) {
    if (projectedSavings >= excess) break
    const m = messages[i]
    if (m.role !== 'user') continue
    if (protectedRecent.has(i)) continue
    const len = messageContentLength(m)
    if (len <= MIN_COMPACTION_SIZE) continue
    const tokens = Math.ceil(len / CHARS_PER_TOKEN)
    selected.push({
      index: i,
      originalChars: len,
      originalTokens: tokens,
      toolName: 'user'
    })
    projectedSavings += Math.floor(tokens * (1 - COMPACTION_RATIO))
  }

  return selected
}

// ---------------------------------------------------------------------------
// Deterministic truncation fallback
// ---------------------------------------------------------------------------

/** First 500 tokens (~2000 chars) + last 200 tokens (~800 chars). */
export function truncateFallback(content: string): string {
  const headChars = 2000
  const tailChars = 800

  if (content.length <= headChars + tailChars + 100) return content

  const head = content.slice(0, headChars)
  const tail = content.slice(-tailChars)
  const omitted = content.length - headChars - tailChars
  return (
    head + `\n\n[…${omitted} chars compacted — summary unavailable, showing head+tail]\n\n` + tail
  )
}

// ---------------------------------------------------------------------------
// Per-message compaction (in-place mutation)
// ---------------------------------------------------------------------------

/**
 * Compact a single message in-place. Handles tool, assistant, and user roles.
 */
async function compactMessage(
  thalamus: Thalamus,
  messages: ChatMessage[],
  target: CompactionTarget,
  signal?: AbortSignal
): Promise<CompactionTarget & { compactedChars: number; compactedBy: string }> {
  const m = messages[target.index]

  // Extract the text to compact
  let content: string
  if (m.role === 'tool') {
    content = m.content
  } else if (m.role === 'assistant') {
    content = m.content
  } else if (m.role === 'user') {
    content = typeof m.content === 'string' ? m.content : ''
  } else {
    return { ...target, compactedChars: target.originalChars, compactedBy: 'skip' }
  }

  if (!content || content.length <= MIN_COMPACTION_SIZE) {
    return { ...target, compactedChars: target.originalChars, compactedBy: 'skip' }
  }

  try {
    if (signal?.aborted) throw new Error('aborted')
    const compacted = await thalamus.compactContent(content, signal)
    const summary =
      `[Compacted by ${compacted.provider} — original ${target.originalChars} chars]\n\n` +
      compacted.text

    if (m.role === 'tool') {
      messages[target.index] = { ...m, content: summary } as ChatMessage
    } else if (m.role === 'assistant') {
      // Preserve toolUses but replace content text + clear reasoning
      messages[target.index] = {
        ...m,
        content: summary,
        reasoningContent: undefined
      } as ChatMessage
    } else if (m.role === 'user') {
      messages[target.index] = { ...m, content: summary } as ChatMessage
    }

    return { ...target, compactedChars: summary.length, compactedBy: compacted.model }
  } catch {
    const truncated = truncateFallback(content)

    if (m.role === 'tool') {
      messages[target.index] = { ...m, content: truncated } as ChatMessage
    } else if (m.role === 'assistant') {
      messages[target.index] = {
        ...m,
        content: truncated,
        reasoningContent: undefined
      } as ChatMessage
    } else if (m.role === 'user') {
      messages[target.index] = { ...m, content: truncated } as ChatMessage
    }

    return { ...target, compactedChars: truncated.length, compactedBy: 'truncate' }
  }
}

// ---------------------------------------------------------------------------
// Main compaction orchestrator
// ---------------------------------------------------------------------------

/**
 * If the system prompt + messages exceed the model's input budget,
 * compact messages **in-place** using LLM-generated summaries.
 *
 * Targets are selected in priority order: tool results first, then
 * older assistant messages, then older user messages. All targets
 * are compacted in parallel for speed.
 *
 * Returns null when no compaction is needed (payload fits).
 */
export async function compactOverflow(
  thalamus: Thalamus,
  systemPrompt: string,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<CompactionResult | null> {
  const inputBudget = thalamus.getContextBudget()

  const currentTokens = estimatePayloadTokens(systemPrompt, messages)
  console.log(
    `[compactor] estimate=${currentTokens} budget=${inputBudget} ` +
      `messages=${messages.length} sysChars=${systemPrompt.length} ` +
      `needsCompaction=${currentTokens > inputBudget}`
  )
  if (currentTokens <= inputBudget) return null

  const targets = selectCompactionTargets(messages, currentTokens, inputBudget)
  if (targets.length === 0) return null

  const tokensBefore = currentTokens

  // Compact all targets in parallel — mutating messages[] in-place
  const results = await Promise.all(
    targets.map((target) => compactMessage(thalamus, messages, target, signal))
  )

  // Strip images from all tool results to reclaim space
  for (const m of messages) {
    if (m.role === 'tool' && m.images && m.images.length > 0) {
      ;(m as { images: undefined }).images = undefined
      if (!m.content.startsWith('[Screenshot')) {
        m.content = `[Screenshot analyzed — image omitted from context]\n${m.content}`
      }
    }
  }

  const tokensAfter = estimatePayloadTokens(systemPrompt, messages)
  const tokensSaved = Math.max(0, tokensBefore - tokensAfter)

  return {
    targets: results,
    tokensSaved
  }
}
