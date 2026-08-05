import {
  buildAssistantMessage,
  type AssistantAccumulator,
  type MirrorMessageListener,
  type TurnSink
} from '@main/channels/channel'
import type { TurnRunner, TurnSendOptions } from '@main/channels/turn-runner'
import { mintMessageId } from '@main/conversations'
import type { Agent } from '@main/runtime/agent'
import type { ApprovalDecision, ApprovalRequest } from '@main/runtime/amygdala'
import { upsertTaskSegment, upsertWorkflowSegment } from '@main/runtime/broca'
import type { AskUserRequest, AskUserResponse } from '@main/runtime/cerebellum'
import { turnScope, type CorpusEvents } from '@main/runtime/corpus'
import type { ChatHistoryMessage } from '@preload/index'
import type { WebContents } from 'electron'

/**
 * Min gap between live mirror snapshots of an in-flight in-app turn — same
 * budget as the Telegram/WhatsApp mirrors, for the same reason: a fast text
 * stream must not emit (and make the phone re-render) per token.
 */
const MIRROR_THROTTLE_MS = 500

/**
 * The Electron renderer channel. Wraps the existing chat:* IPC surface —
 * every event the renderer receives arrives on the same channel name, in
 * the same order, now stamped with BOTH turnId and conversationId so the
 * renderer can demux concurrent conversations.
 *
 * The channel owns, PER TURN (turns for different conversations run
 * concurrently through the per-conversation TurnRunner lanes):
 *  - the turn's AbortController (chat:cancel(conversationId) aborts it),
 *  - the turn's task id (cancel forwards the stop request to motor),
 *  - the pending approval/ask resolvers scoped to that turn,
 *  - the WebContents sender captured at send-time (a window close
 *    mid-stream makes the IPC sends silent rather than throwing).
 *
 * A new chat:send for a conversation that ALREADY has a turn in flight
 * aborts that turn first (same-conversation preemption, exactly the old
 * behavior) — sends for other conversations are left alone.
 */
export class ElectronChannel {
  private readonly pendingApprovals = new Map<
    string,
    { turnId: string; resolve: (decision: ApprovalDecision) => void }
  >()
  private readonly pendingAsks = new Map<
    string,
    { turnId: string; resolve: (response: AskUserResponse) => void }
  >()
  /** Live turns keyed by turnId. */
  private readonly turns = new Map<
    string,
    { controller: AbortController; conversationId: string | null; taskId: string | null }
  >()
  /** conversationId → live turnId, for same-conversation preemption/cancel. */
  private readonly byConversation = new Map<string, string>()

  /**
   * Live out-of-window mirror for in-app turns — the missing quarter of the
   * mirror matrix. Telegram/WhatsApp turns mirror INTO the renderer (and the
   * phone); phone turns stream through the mobile channel's own sink; but an
   * in-app turn only ever streamed to its renderer, so a paired phone showed
   * nothing until the end-of-turn save landed. index.ts points this at the
   * mobile channel; the renderer itself never consumes it (chat:segment is
   * its live feed already).
   */
  private mirrorListener: MirrorMessageListener | null = null

  setMessageMirror(listener: MirrorMessageListener | null): void {
    this.mirrorListener = listener
  }

  constructor(
    private readonly agent: Agent,
    private readonly runner: TurnRunner
  ) {}

  /** chat:send IPC handler. Returns the turnId synchronously. */
  send(
    sender: WebContents,
    payload: {
      history: ChatHistoryMessage[]
      conversationId?: string | null
      /** Feed id of this turn's user message — the titler shell stamps it (see TurnSendOptions). */
      userMessageId?: string
      workingFolders?: string[]
      thinkingMode?: string
      modeOverride?: 'single' | 'workflow'
      projectId?: string | null
    }
  ): { turnId: string; ok: true } {
    const conversationId = payload.conversationId ?? null
    // Same-conversation preemption only: a resend into a streaming
    // conversation aborts ITS turn; every other conversation keeps running.
    if (conversationId) {
      const previousTurnId = this.byConversation.get(conversationId)
      if (previousTurnId) this.turns.get(previousTurnId)?.controller.abort()
    }

    const handle = this.runner.send({
      history: payload.history,
      conversationId,
      userMessageId: payload.userMessageId,
      workingFolders: payload.workingFolders,
      projectId: payload.projectId,
      thinkingMode: (payload.thinkingMode as TurnSendOptions['thinkingMode']) ?? undefined,
      modeOverride: payload.modeOverride,
      makeSink: ({ turnId, conversationId: cid }) => this.createSink(turnId, cid, sender)
    })

    // Register at SEND time (not lane start) so a turn queued behind its
    // conversation's in-flight predecessor is cancelable immediately.
    this.turns.set(handle.turnId, {
      controller: handle.controller,
      conversationId,
      taskId: null
    })
    if (conversationId) this.byConversation.set(conversationId, handle.turnId)

    // Cleanup on EVERY exit path — including the sensitive-data gate, which
    // resolves `done` without ever entering the runner lane.
    void handle.done.catch(() => undefined).finally(() => this.releaseTurn(handle.turnId))

    return { turnId: handle.turnId, ok: true as const }
  }

  /**
   * Drop a finished turn's registration and resolve any approval/ask still
   * pending FOR THAT TURN (the renderer's cards are gone once the turn
   * closes). Sibling turns' pending resolvers are left untouched — draining
   * them here would force-deny a concurrent conversation's open approval.
   */
  private releaseTurn(turnId: string): void {
    const turn = this.turns.get(turnId)
    this.turns.delete(turnId)
    if (turn?.conversationId && this.byConversation.get(turn.conversationId) === turnId) {
      this.byConversation.delete(turn.conversationId)
    }
    for (const [id, entry] of this.pendingApprovals.entries()) {
      if (entry.turnId !== turnId) continue
      this.pendingApprovals.delete(id)
      entry.resolve('denied')
    }
    for (const [id, entry] of this.pendingAsks.entries()) {
      if (entry.turnId !== turnId) continue
      this.pendingAsks.delete(id)
      entry.resolve({ kind: 'canceled' })
    }
  }

  /**
   * chat:cancel IPC handler. With a conversationId, aborts that
   * conversation's turn only; without one (legacy callers), aborts every
   * live turn — the old single-turn semantics degrade safely.
   */
  async cancel(conversationId?: string | null): Promise<{ canceled: boolean }> {
    const targets: string[] = []
    if (conversationId) {
      const turnId = this.byConversation.get(conversationId)
      if (turnId) targets.push(turnId)
    } else {
      targets.push(...this.turns.keys())
    }
    let canceled = false
    for (const turnId of targets) {
      const turn = this.turns.get(turnId)
      if (!turn) continue
      canceled = true
      turn.controller.abort()
      if (turn.taskId) {
        // Scope the stop to the target turn: motor.stopTask emits
        // task.stopped synchronously, and a scope-less emit would fan out to
        // every live turn's relay (fail-open), polluting other
        // conversations' timelines.
        const taskId = turn.taskId
        await turnScope
          .run({ turnId, conversationId: turn.conversationId, autonomous: false }, () =>
            this.agent.motor.stopTask(taskId)
          )
          .catch(() => undefined)
      }
    }
    return { canceled }
  }

  /** chat:approvalRespond IPC handler. */
  respondApproval(payload: {
    id: string
    decision: ApprovalDecision
  }): { ok: true } | { ok: false } {
    const entry = this.pendingApprovals.get(payload.id)
    if (!entry) return { ok: false as const }
    this.pendingApprovals.delete(payload.id)
    entry.resolve(payload.decision)
    return { ok: true as const }
  }

  /** chat:askRespond IPC handler — the user answered a question card. */
  respondAsk(payload: { id: string; response: AskUserResponse }): { ok: true } | { ok: false } {
    const entry = this.pendingAsks.get(payload.id)
    if (!entry) return { ok: false as const }
    this.pendingAsks.delete(payload.id)
    entry.resolve(payload.response)
    return { ok: true as const }
  }

  /** Currently running any turn? Used by the quit-drain logic. */
  hasActiveTurn(): boolean {
    return this.turns.size > 0
  }

  /** True while this conversation has a turn in flight. */
  isConversationActive(conversationId: string): boolean {
    return this.byConversation.has(conversationId)
  }

  /** Force-stop everything (called from app shutdown). */
  abort(): void {
    for (const turn of this.turns.values()) turn.controller.abort()
    this.turns.clear()
    this.byConversation.clear()
  }

  private createSink(turnId: string, conversationId: string | null, sender: WebContents): TurnSink {
    const safeSend = (channel: string, payload: unknown): void => {
      if (sender && !sender.isDestroyed()) {
        sender.send(channel, payload)
      }
    }
    // Phone-mirror accumulator: the same message the renderer will persist at
    // end of turn, built segment by segment with the SAME stable id, so the
    // phone upserts by id and the mid-turn snapshot is replaced — never
    // duplicated — by the saved message the post-turn refetch pulls.
    const acc: AssistantAccumulator = {
      assistantMessageId: mintMessageId(),
      assistantTimestamp: Date.now(),
      assistantContent: '',
      segments: [],
      approvals: new Map(),
      toolTimings: new Map(),
      stopReason: null
    }
    let lastMirrorAt = 0
    let mirrorTimer: NodeJS.Timeout | null = null
    const emitMirror = (): void => {
      if (!this.mirrorListener || !conversationId) return
      // A late trailing tick from an already-released turn must not push a
      // stale snapshot over the persisted final message.
      if (!this.turns.has(turnId)) return
      const message = buildAssistantMessage(acc)
      if (!message) return
      lastMirrorAt = Date.now()
      this.mirrorListener(conversationId, message)
    }
    const scheduleMirror = (immediate: boolean): void => {
      if (!this.mirrorListener || !conversationId) return
      const sinceLast = Date.now() - lastMirrorAt
      if (immediate || sinceLast >= MIRROR_THROTTLE_MS) {
        if (mirrorTimer) {
          clearTimeout(mirrorTimer)
          mirrorTimer = null
        }
        emitMirror()
        return
      }
      if (mirrorTimer) return
      mirrorTimer = setTimeout(() => {
        mirrorTimer = null
        emitMirror()
      }, MIRROR_THROTTLE_MS - sinceLast)
      mirrorTimer.unref?.()
    }
    return {
      channelId: 'electron',
      turnId,
      conversationId,
      onSegment: (segment) => {
        safeSend('chat:segment', { ...segment, conversationId })
        // Fold into the phone mirror with the same rules every other
        // accumulator applies (worker segments never speak as the
        // assistant; workflow/task snapshots upsert by id). Task snapshots
        // flush immediately — a card flipping to running/succeeded should
        // not wait out the text throttle.
        if (!this.mirrorListener || !conversationId) return
        if ('worker' in segment && segment.worker) return
        if (segment.kind === 'workflow') upsertWorkflowSegment(acc.segments, segment)
        else if (segment.kind === 'task') upsertTaskSegment(acc.segments, segment)
        else acc.segments.push(segment)
        if (segment.kind === 'turn_end') acc.stopReason = segment.stopReason
        if (segment.kind === 'text') acc.assistantContent += segment.delta
        scheduleMirror(segment.kind === 'task')
      },
      onTurnEvent: <E extends keyof CorpusEvents>(type: E, payload: CorpusEvents[E]): void => {
        if (type === 'task.created') {
          const task = payload as CorpusEvents['task.created']
          const turn = this.turns.get(turnId)
          if (task.taskId && turn) turn.taskId = task.taskId
        }
        safeSend('chat:turnEvent', { turnId, conversationId, type, payload })
      },
      onApprovalRequest: (req: ApprovalRequest & { id: string }) => {
        return new Promise<ApprovalDecision>((resolve) => {
          if (!sender || sender.isDestroyed()) {
            resolve('denied')
            return
          }
          this.pendingApprovals.set(req.id, { turnId, resolve })
          safeSend('chat:approvalRequest', {
            turnId,
            conversationId,
            id: req.id,
            toolCallId: req.toolCall.id,
            tool: req.toolCall.name,
            args: req.toolCall.args,
            level: req.level,
            reason: req.reason,
            description: req.description
          })
        })
      },
      onAskUserRequest: (req: AskUserRequest & { id: string }) => {
        return new Promise<AskUserResponse>((resolve) => {
          if (!sender || sender.isDestroyed()) {
            resolve({ kind: 'canceled' })
            return
          }
          this.pendingAsks.set(req.id, { turnId, resolve })
          safeSend('chat:askRequest', {
            turnId,
            conversationId,
            id: req.id,
            toolCallId: req.toolCallId,
            questions: req.questions
          })
        })
      },
      onDone: () => {
        safeSend('chat:done', { turnId, conversationId })
      },
      onError: (error) => {
        safeSend('chat:error', { turnId, conversationId, error })
      },
      onCredentialBlocked: (type) => {
        safeSend('chat:credentialBlocked', { turnId, conversationId, type })
      }
    }
  }
}
