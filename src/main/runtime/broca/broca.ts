import type { Corpus } from '@main/runtime/corpus/corpus'
import type { NoProviderAvailableInfo, StreamChunk } from '@main/runtime/thalamus/thalamus'

/**
 * Broca produces the final, user-facing response.
 *
 * Maps to: Broca's area — a region in the left frontal lobe that handles
 * speech production. Patients with Broca's aphasia understand language
 * fine, but struggle to produce it: they know what they want to say, but
 * the words come out halting and broken. Production is Broca's job.
 *
 * In Wolffish, Broca tees the unified stream coming from Thalamus into
 * an ordered series of `Segment`s — text deltas, tool calls, tool
 * results, and a final turn_end marker. The segment stream is what the
 * renderer consumes; the underlying chunk stream still passes through
 * to Wernicke for parsing. Broca writes no prose itself: every visible
 * artifact comes from the model or from a tool's own output.
 */

export type SegmentTurnEndReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'error'
  | 'no_provider_available'

export type ToolResultStatus = 'success' | 'failed' | 'denied'

export type Segment =
  | { kind: 'text'; turnId: string; segmentId: string; delta: string }
  | {
      kind: 'tool_call'
      turnId: string
      segmentId: string
      toolCallId: string
      name: string
      args: Record<string, unknown>
    }
  | {
      kind: 'tool_result'
      turnId: string
      segmentId: string
      toolCallId: string
      status: ToolResultStatus
      output: string
      error?: string
    }
  | {
      kind: 'active_model'
      turnId: string
      segmentId: string
      provider: string
      model: string
    }
  | {
      kind: 'provider_change'
      turnId: string
      segmentId: string
      from: string
      to: string
      model: string
      reason: string
    }
  | {
      kind: 'turn_end'
      turnId: string
      segmentId: string
      stopReason: SegmentTurnEndReason
      iterationCount: number
      providerError?: NoProviderAvailableInfo
    }
  | { kind: 'separator'; turnId: string; segmentId: string }

export type SegmentSink = (segment: Segment) => void

export type BrocaOptions = {
  corpus?: Corpus
  /**
   * Predicate consulted when a tool_call chunk arrives. Returning true
   * marks that tool call as silent: broca skips both its tool_call and
   * its eventual tool_result segments, so the renderer shows nothing
   * for the call. Used for wolffish-internal housekeeping (memory
   * writes, episode logs) that the user never asked about.
   */
  shouldSilenceToolCall?: (name: string, args: Record<string, unknown>) => boolean
}

export class Broca {
  private turnId: string | null = null
  private sink: SegmentSink | null = null
  private counter = 0
  private turnEnded = false
  private silentToolCallIds = new Set<string>()

  constructor(private options: BrocaOptions = {}) {
    void this.options
  }

  /**
   * True if the given toolCallId was marked silent when its tool_call
   * chunk arrived. Callers that bypass broca (the agent's approval
   * loop) check this before requesting approval or treating the call
   * as user-visible.
   */
  isSilent(toolCallId: string): boolean {
    return this.silentToolCallIds.has(toolCallId)
  }

  /**
   * Open a per-turn segment channel. The agent calls this once per
   * user message, before any LLM stream begins. Resets the segment
   * counter so segmentIds are monotonic per turn.
   */
  beginTurn(turnId: string, sink: SegmentSink): void {
    this.turnId = turnId
    this.sink = sink
    this.counter = 0
    this.turnEnded = false
    this.silentToolCallIds.clear()
  }

  /**
   * Close the per-turn channel. Called from the agent's finally block
   * so a thrown error doesn't leave the channel half-open.
   */
  endTurn(): void {
    this.turnId = null
    this.sink = null
    this.counter = 0
    this.turnEnded = false
    this.silentToolCallIds.clear()
  }

  /**
   * Tee an upstream chunk stream: emit a Segment for every text and
   * tool_call chunk while passing every chunk through to whoever is
   * downstream (typically Wernicke). turn_meta and error chunks aren't
   * surfaced as segments — turn_meta is internal metadata, and errors
   * are surfaced via the agent's turn_end with stopReason='error'.
   */
  async *streamSegments(chunks: AsyncGenerator<StreamChunk>): AsyncGenerator<StreamChunk> {
    for await (const chunk of chunks) {
      if (chunk.type === 'text' && chunk.text.length > 0) {
        this.emit({
          kind: 'text',
          turnId: this.requireTurn(),
          segmentId: this.nextId(),
          delta: chunk.text
        })
      } else if (chunk.type === 'tool_call') {
        if (this.options.shouldSilenceToolCall?.(chunk.name, chunk.args)) {
          this.silentToolCallIds.add(chunk.id)
        } else {
          this.emit({
            kind: 'tool_call',
            turnId: this.requireTurn(),
            segmentId: this.nextId(),
            toolCallId: chunk.id,
            name: chunk.name,
            args: chunk.args
          })
        }
      } else if (chunk.type === 'active_model') {
        this.emit({
          kind: 'active_model',
          turnId: this.requireTurn(),
          segmentId: this.nextId(),
          provider: chunk.provider,
          model: chunk.model
        })
      } else if (chunk.type === 'provider_change') {
        this.emit({
          kind: 'provider_change',
          turnId: this.requireTurn(),
          segmentId: this.nextId(),
          from: chunk.from,
          to: chunk.to,
          model: chunk.model,
          reason: chunk.reason
        })
      }
      yield chunk
    }
  }

  /**
   * Emit a synthetic tool_call segment for the active turn. Used by the
   * dependency resolver to surface install actions that aren't part of
   * the LLM's stream — without this segment, the renderer has nowhere
   * to anchor the approval card and it never appears, even though the
   * IPC fired.
   */
  emitToolCall(
    turnId: string,
    toolCallId: string,
    name: string,
    args: Record<string, unknown>
  ): void {
    if (this.turnId !== turnId || !this.sink) return
    if (this.options.shouldSilenceToolCall?.(name, args)) {
      this.silentToolCallIds.add(toolCallId)
      return
    }
    this.emit({
      kind: 'tool_call',
      turnId,
      segmentId: this.nextId(),
      toolCallId,
      name,
      args
    })
  }

  /**
   * Emit a tool_result segment for the active turn. Status mirrors the
   * motor/safety outcome: 'success' or 'failed' from execution, 'denied'
   * for amygdala-blocked or user-denied calls.
   */
  emitToolResult(
    turnId: string,
    toolCallId: string,
    status: ToolResultStatus,
    output: string,
    error?: string
  ): void {
    if (this.turnId !== turnId || !this.sink) return
    if (this.silentToolCallIds.has(toolCallId)) {
      this.silentToolCallIds.delete(toolCallId)
      return
    }
    const segment: Segment = {
      kind: 'tool_result',
      turnId,
      segmentId: this.nextId(),
      toolCallId,
      status,
      output
    }
    if (error !== undefined) segment.error = error
    this.emit(segment)
  }

  /**
   * Emit a text segment directly into the active turn. Used by _to_chat
   * tools so plugins can inject content into the chat stream without
   * relying on the model to copy tool output verbatim.
   */
  emitText(turnId: string, text: string): void {
    if (this.turnId !== turnId || !this.sink) return
    if (text.trim().length === 0) return
    this.emit({
      kind: 'text',
      turnId,
      segmentId: this.nextId(),
      delta: text
    })
  }

  /**
   * Emit a separator segment that tells the renderer to flush the current
   * text buffer into its own bubble before continuing. Used by _to_chat
   * tools that return multiple items (e.g. several GIFs) so each renders
   * in its own message block rather than a single concatenated bubble.
   */
  emitSeparator(turnId: string): void {
    if (this.turnId !== turnId || !this.sink) return
    this.emit({ kind: 'separator', turnId, segmentId: this.nextId() })
  }

  /**
   * Emit the turn_end segment that closes the turn from the renderer's
   * perspective. Called from every loop exit path in the agent so the
   * renderer always sees a closing marker. Idempotent — a second call
   * within the same turn is dropped, so an error path that triggers
   * this from both the catch handler and the finally block doesn't
   * double-render.
   */
  emitTurnEnd(
    turnId: string,
    stopReason: SegmentTurnEndReason,
    iterationCount: number,
    providerError?: NoProviderAvailableInfo
  ): void {
    if (this.turnId !== turnId || !this.sink) return
    if (this.turnEnded) return
    this.turnEnded = true
    const segment: Segment = {
      kind: 'turn_end',
      turnId,
      segmentId: this.nextId(),
      stopReason,
      iterationCount
    }
    if (providerError) segment.providerError = providerError
    this.emit(segment)
  }

  private requireTurn(): string {
    if (!this.turnId) throw new Error('Broca.streamSegments called outside a turn')
    return this.turnId
  }

  private nextId(): string {
    this.counter += 1
    return `seg_${this.counter}`
  }

  private emit(segment: Segment): void {
    try {
      this.sink?.(segment)
    } catch {
      // a renderer that's gone away shouldn't tear down the agent
    }
  }
}
