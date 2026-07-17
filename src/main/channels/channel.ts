import type { ApprovalDecision, ApprovalRequest } from '@main/runtime/amygdala'
import type { AskUserRequest, AskUserResponse } from '@main/runtime/cerebellum'
import type { Segment } from '@main/runtime/broca'
import { turnScope, type CorpusEvent, type CorpusEvents } from '@main/runtime/corpus'
import {
  resolveSummaryMarkIndex,
  type ConversationFile,
  type ConversationMessage
} from '@main/conversations'
import type { ChatHistoryMessage } from '@preload/index'

/**
 * A channel is one mouth wolffish can speak through. The Electron renderer
 * is the original channel; Telegram is the second. Both run the same agent
 * pipeline — the only difference is how segments, approvals, and turn
 * events get rendered to the user.
 *
 * Concretely, a channel receives a user message, calls into the shared
 * turn runner with a TurnSink describing how to render output, and the
 * runner drives agent.respond. Approval requests are routed to the
 * channel via the singleton TurnRouter so amygdala doesn't need to know
 * which channel a turn belongs to.
 */
export type ChannelId = 'electron' | 'telegram' | 'whatsapp'

/**
 * The set of callbacks the agent uses to render an active turn. The
 * channel owns the implementation — IPC sends for Electron, formatted
 * bot messages for Telegram. Methods may be invoked from any pipeline
 * region; implementations must handle being called after the turn ends
 * (e.g. a stale segment from a slow stream) without throwing.
 */
export interface TurnSink {
  readonly channelId: ChannelId
  readonly turnId: string
  readonly conversationId: string | null

  /** Streams text deltas, tool calls, tool results, turn_end. */
  onSegment(segment: Segment): void

  /** Tagged corpus events relayed to the channel. */
  onTurnEvent<E extends CorpusEvent>(type: E, payload: CorpusEvents[E]): void

  /**
   * Amygdala-flagged tool call. Resolve with the user's decision. The
   * channel is responsible for showing the request to the user and
   * waiting for their reply. Returns 'denied' on timeout / channel
   * close so a hung approval never wedges the pipeline.
   */
  onApprovalRequest(req: ApprovalRequest & { id: string }): Promise<ApprovalDecision>

  /**
   * Ask the user a multiple-choice question and resolve with their answer.
   * Optional: only channels with an interactive surface (the Electron
   * renderer) implement it. When absent, dispatchAskUser resolves
   * `unsupported` so the `ask` tool degrades to a plain-text prompt rather
   * than wedging the pipeline. Like onApprovalRequest, the channel must
   * resolve (not hang) on timeout / channel close.
   */
  onAskUserRequest?(req: AskUserRequest & { id: string }): Promise<AskUserResponse>

  /** Turn finished cleanly. */
  onDone(): void

  /** Turn threw. The channel should surface the error to the user. */
  onError(error: string): void

  /**
   * Sensitive-data filter discarded the message before it reached the
   * pipeline. Channels that log sensitive content (e.g. by echoing
   * messages back) should observe this to stay quiet.
   */
  onCredentialBlocked(type: string): void
}

/**
 * Singleton router that connects amygdala's global approval bridge (and the
 * ask_user bridge) to the channel sink that owns the REQUESTING turn. Turns
 * run concurrently, so there is no single "active" sink — the runner
 * registers each turn's sink under its turnId, and dispatch resolves the
 * caller's turn through the turn-identity AsyncLocalStorage (approval/ask
 * requests are awaited inside the turn's async call tree, so getStore()
 * names the right turn). An unresolvable request fails closed: approvals
 * deny, ask_user degrades to 'unsupported' — a sealed background run
 * (autonomous scope, no registered sink) lands here by design.
 */
class TurnRouter {
  private readonly sinks = new Map<string, TurnSink>()

  register(turnId: string, sink: TurnSink): void {
    this.sinks.set(turnId, sink)
  }

  unregister(turnId: string): void {
    this.sinks.delete(turnId)
  }

  /** Number of live registered turns (quit-drain diagnostics). */
  activeCount(): number {
    return this.sinks.size
  }

  private resolveSink(): TurnSink | null {
    const scope = turnScope.getStore()
    if (!scope || scope.autonomous || !scope.turnId) return null
    return this.sinks.get(scope.turnId) ?? null
  }

  async dispatchApproval(req: ApprovalRequest & { id: string }): Promise<ApprovalDecision> {
    const sink = this.resolveSink()
    if (!sink) return 'denied'
    return sink.onApprovalRequest(req)
  }

  async dispatchAskUser(req: AskUserRequest & { id: string }): Promise<AskUserResponse> {
    const sink = this.resolveSink()
    if (!sink || !sink.onAskUserRequest) return { kind: 'unsupported' }
    return sink.onAskUserRequest(req)
  }
}

export const turnRouter = new TurnRouter()

/**
 * The replay window for a persisted conversation: when a rolling prefix
 * summary exists (written by the post-turn summarizer), replay
 * `summary preamble + messages from the mark` instead of the whole
 * transcript. The summarized turns stay on disk and indexed —
 * conversation_read retrieves them verbatim, and the preamble says so.
 */
export function replayWindow(
  conversation: Pick<
    ConversationFile,
    'id' | 'messages' | 'summary' | 'summarizedThroughMessage' | 'summarizedThroughMessageId'
  >
): { messages: ConversationMessage[]; preamble: ChatHistoryMessage[] } {
  // Id form first — it survives merges that insert before the boundary —
  // numeric mark as the fallback; the range guard below is unchanged (a
  // stale/corrupt mark degrades to full replay, never everything-skipped).
  const mark = resolveSummaryMarkIndex(
    conversation.messages,
    conversation.summarizedThroughMessage,
    conversation.summarizedThroughMessageId
  )
  const summary = conversation.summary?.trim()
  if (!summary || mark <= 0 || mark >= conversation.messages.length) {
    return { messages: conversation.messages, preamble: [] }
  }
  return {
    messages: conversation.messages.slice(mark),
    preamble: [
      {
        role: 'user',
        content:
          `[Conversation summary — the first ${mark} messages of this conversation were compressed; ` +
          `conversation_read("${conversation.id}") retrieves any of them verbatim]\n\n${summary}`
      },
      { role: 'assistant', content: 'Understood — continuing with that context.' }
    ]
  }
}

/** Tool results older than this many chars get stubbed once stale. */
const STALE_TOOL_RESULT_MIN_CHARS = 2_000
/** The last N user exchanges keep their tool results verbatim. */
const STALE_TOOL_PROTECT_EXCHANGES = 2

/**
 * Replace large tool-result payloads from OLDER exchanges with a
 * self-describing recovery stub. The full bytes stay persisted and indexed —
 * the stub names the retrieval call — so replay cost stops growing with
 * every old page-dump while nothing is ever actually lost. Mirrors the
 * outbound stub-with-recovery-pointer contract.
 */
export function stubStaleToolResults(
  history: ChatHistoryMessage[],
  conversationId: string
): ChatHistoryMessage[] {
  // Everything from the Nth-from-last user message onward is protected.
  let protectFrom = history.length
  let usersSeen = 0
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') {
      usersSeen++
      protectFrom = i
      if (usersSeen >= STALE_TOOL_PROTECT_EXCHANGES) break
    }
  }
  // Degenerate history with no user messages: exchange boundaries can't be
  // established, so nothing is provably stale — protect everything.
  if (usersSeen === 0) return history
  return history.map((entry, i) => {
    if (i >= protectFrom) return entry
    if (entry.role !== 'tool') return entry
    if (typeof entry.content !== 'string' || entry.content.length < STALE_TOOL_RESULT_MIN_CHARS) {
      return entry
    }
    return {
      ...entry,
      content: `[${entry.toolName} result from earlier in this conversation, ${entry.content.length} chars — memory_search or conversation_read("${conversationId}") retrieves it verbatim]`
    }
  })
}

/**
 * Reconstruct the full message history from a conversation's stored messages,
 * preserving tool calls and tool results from assistant segments. This gives
 * the model access to its prior tool interactions across turns.
 *
 * Worker-tagged segments (LEGACY, from the removed Orchestrator mode) are
 * excluded — mirrors the renderer's textHistory. The master's real context
 * received subagent output through its own await tool results (main
 * segments); replaying the forwarded worker segments too would interleave
 * subagent prose into the assistant's text and present subagent tool calls
 * as the master's own. Workflow-mode `workflow` snapshot segments fall
 * through the kind dispatch below untouched — display-only by design.
 */
export function assistantSegmentsToHistory(msg: ConversationMessage): ChatHistoryMessage[] {
  const segments = msg.segments?.filter((s) => !('worker' in s && s.worker))
  if (!segments || segments.length === 0) {
    return [{ role: 'assistant', content: msg.content }]
  }

  const out: ChatHistoryMessage[] = []
  const toolCallNames = new Map<string, string>()
  for (const s of segments) {
    if (s.kind === 'tool_call') toolCallNames.set(s.toolCallId, s.name)
  }

  let iterText = ''
  let iterToolUses: Array<{ id: string; name: string; args: Record<string, unknown> }> = []
  let iterToolResults: ChatHistoryMessage[] = []
  let hasContent = false

  const flush = (): void => {
    if (!hasContent) return
    const assistantMsg: ChatHistoryMessage = { role: 'assistant', content: iterText }
    if (iterToolUses.length > 0) assistantMsg.toolUses = iterToolUses
    out.push(assistantMsg)
    for (const tr of iterToolResults) out.push(tr)
    // Backfill canceled results for any tool_call segment left without a
    // matching tool_result (a run stopped mid-tool). Providers reject an
    // assistant tool_calls message that isn't answered for every id, so the
    // next turn on this chat would 400 without this. Mirrors the renderer's
    // textHistory and the agent's Broca.closeOpenToolCalls.
    const resultIds = new Set(
      iterToolResults
        .filter((r): r is Extract<ChatHistoryMessage, { role: 'tool' }> => r.role === 'tool')
        .map((r) => r.toolUseId)
    )
    for (const use of iterToolUses) {
      if (resultIds.has(use.id)) continue
      out.push({
        role: 'tool',
        toolUseId: use.id,
        toolName: use.name,
        content: 'Tool execution was canceled by the user before it completed.',
        isError: true
      })
    }
    iterText = ''
    iterToolUses = []
    iterToolResults = []
    hasContent = false
  }

  let iterCount = 0
  for (const s of segments) {
    if (s.kind === 'active_model') {
      if (iterCount > 0) flush()
      iterCount++
    } else if (s.kind === 'text') {
      iterText += s.delta
      hasContent = true
    } else if (s.kind === 'tool_call') {
      iterToolUses.push({ id: s.toolCallId, name: s.name, args: s.args })
      hasContent = true
    } else if (s.kind === 'tool_result') {
      iterToolResults.push({
        role: 'tool',
        toolUseId: s.toolCallId,
        toolName: toolCallNames.get(s.toolCallId) ?? 'unknown',
        content: s.output,
        isError: s.status === 'failed' || undefined
      })
      hasContent = true
    }
  }
  flush()

  if (out.length === 0) {
    return [{ role: 'assistant', content: msg.content }]
  }

  const turnEnd = segments.find((s) => s.kind === 'turn_end')
  if (turnEnd && 'reasoningContent' in turnEnd && turnEnd.reasoningContent) {
    const first = out[0]
    if (first.role === 'assistant') {
      first.reasoningContent = turnEnd.reasoningContent as string
    }
  }

  return out
}
