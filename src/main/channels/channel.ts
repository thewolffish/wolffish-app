import type { ApprovalDecision, ApprovalRequest } from '@main/runtime/amygdala'
import type { Segment } from '@main/runtime/broca'
import type { CorpusEvent, CorpusEvents } from '@main/runtime/corpus'

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
 * Singleton router that connects amygdala's global approval bridge to
 * whichever channel currently owns the active turn. The agent runs one
 * turn at a time — the runner sets the active sink before agent.respond
 * and clears it in the finally block.
 */
class TurnRouter {
  private active: TurnSink | null = null

  setActive(sink: TurnSink | null): void {
    this.active = sink
  }

  getActive(): TurnSink | null {
    return this.active
  }

  async dispatchApproval(req: ApprovalRequest & { id: string }): Promise<ApprovalDecision> {
    if (!this.active) return 'denied'
    return this.active.onApprovalRequest(req)
  }
}

export const turnRouter = new TurnRouter()
