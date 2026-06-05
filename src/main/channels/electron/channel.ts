import type { TurnSink } from '@main/channels/channel'
import type { TurnRunner, TurnSendOptions } from '@main/channels/turn-runner'
import type { Agent } from '@main/runtime/agent'
import type { ApprovalDecision, ApprovalRequest } from '@main/runtime/amygdala'
import type { CorpusEvents } from '@main/runtime/corpus'
import type { ChatHistoryMessage } from '@preload/index'
import type { WebContents } from 'electron'

/**
 * The Electron renderer channel. Wraps the existing chat:* IPC surface
 * exactly — every event the renderer used to receive still arrives,
 * with the same shape, on the same channel name, in the same order.
 *
 * The channel owns:
 *  - the active turn's AbortController (chat:cancel aborts it),
 *  - the active task id (chat:cancel forwards the stop request to motor),
 *  - the pending-approvals map (chat:approvalRespond resolves them),
 *  - the WebContents sender for the active turn.
 *
 * Multiple windows are not supported in flight: a new chat:send aborts
 * the previous turn, exactly as before. The sink is created with the
 * sender captured at send-time so a window close mid-stream just makes
 * the IPC sends silent rather than throwing.
 */
export class ElectronChannel {
  private readonly pendingApprovals = new Map<string, (decision: ApprovalDecision) => void>()
  private activeController: AbortController | null = null
  private activeTurnId: string | null = null
  private activeTaskId: string | null = null

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
      thinkingMode?: string
    }
  ): { turnId: string; ok: true } {
    if (this.activeController) this.activeController.abort()

    const handle = this.runner.send({
      history: payload.history,
      conversationId: payload.conversationId ?? null,
      thinkingMode: (payload.thinkingMode as TurnSendOptions['thinkingMode']) ?? undefined,
      makeSink: ({ turnId, conversationId }) => this.createSink(turnId, conversationId, sender),
      onTurnStarted: ({ turnId, controller }) => {
        this.activeController = controller
        this.activeTurnId = turnId
        this.activeTaskId = null
      },
      onTurnEnded: () => {
        this.activeController = null
        this.activeTurnId = null
        this.activeTaskId = null
        // Any approval still pending at end-of-turn is dead — the
        // renderer's view is gone. Resolve them denied so resolvers
        // fire once and the map drains. Same behavior the inline
        // chat:send handler had.
        for (const [id, resolve] of this.pendingApprovals.entries()) {
          resolve('denied')
          this.pendingApprovals.delete(id)
        }
      }
    })

    return { turnId: handle.turnId, ok: true as const }
  }

  /** chat:cancel IPC handler. */
  async cancel(): Promise<{ canceled: boolean }> {
    const had = !!this.activeController
    this.activeController?.abort()
    if (this.activeTaskId) {
      await this.agent.motor.stopTask(this.activeTaskId).catch(() => undefined)
    }
    return { canceled: had }
  }

  /** chat:approvalRespond IPC handler. */
  respondApproval(payload: {
    id: string
    decision: ApprovalDecision
  }): { ok: true } | { ok: false } {
    const resolve = this.pendingApprovals.get(payload.id)
    if (!resolve) return { ok: false as const }
    this.pendingApprovals.delete(payload.id)
    resolve(payload.decision)
    return { ok: true as const }
  }

  /** Currently running a turn? Used by the quit-drain logic. */
  hasActiveTurn(): boolean {
    return !!this.activeController
  }

  /** Force-stop everything (called from app shutdown). */
  abort(): void {
    this.activeController?.abort()
    this.activeController = null
    this.activeTurnId = null
    this.activeTaskId = null
  }

  private createSink(turnId: string, conversationId: string | null, sender: WebContents): TurnSink {
    const safeSend = (channel: string, payload: unknown): void => {
      if (sender && !sender.isDestroyed()) {
        sender.send(channel, payload)
      }
    }
    return {
      channelId: 'electron',
      turnId,
      conversationId,
      onSegment: (segment) => {
        safeSend('chat:segment', segment)
      },
      onTurnEvent: <E extends keyof CorpusEvents>(type: E, payload: CorpusEvents[E]): void => {
        if (type === 'task.created') {
          const task = payload as CorpusEvents['task.created']
          if (task.taskId) this.activeTaskId = task.taskId
        }
        safeSend('chat:turnEvent', { turnId, type, payload })
      },
      onApprovalRequest: (req: ApprovalRequest & { id: string }) => {
        return new Promise<ApprovalDecision>((resolve) => {
          if (!sender || sender.isDestroyed()) {
            resolve('denied')
            return
          }
          this.pendingApprovals.set(req.id, resolve)
          safeSend('chat:approvalRequest', {
            turnId: this.activeTurnId,
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
      onDone: () => {
        safeSend('chat:done', { turnId })
      },
      onError: (error) => {
        safeSend('chat:error', { turnId, error })
      },
      onCredentialBlocked: (type) => {
        safeSend('chat:credentialBlocked', { turnId, type })
      }
    }
  }
}
