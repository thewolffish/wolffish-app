import type { Agent } from '@main/runtime/agent'
import type { CorpusEvent } from '@main/runtime/corpus'
import { CREDENTIAL_BLOCKED_REPLY, detectSensitiveData } from '@main/runtime/sensitiveDataFilter'
import type { ChatHistoryMessage } from '@preload/index'
import { turnRouter, type TurnSink } from './channel'

/**
 * Corpus events relayed to the channel as turn events. Same set the
 * original Electron chat:send handler used — the renderer expects each
 * of these in onTurnEvent listeners.
 */
export const TURN_RELAYED_EVENTS: CorpusEvent[] = [
  'context.built',
  'llm.response',
  'task.created',
  'task.stepCompleted',
  'task.completed',
  'task.failed',
  'task.stopped',
  'tool.called',
  'tool.completed',
  'tool.failed',
  'safety.allowed',
  'safety.blocked',
  'safety.approved',
  'safety.denied'
]

export type TurnSendOptions = {
  history: ChatHistoryMessage[]
  conversationId?: string | null
  /**
   * External controller. Lets channels tie cancellation to a parent
   * lifecycle (e.g. closing the renderer window aborts every pending
   * Electron turn).
   */
  controller?: AbortController
  /** Build the sink for this turn. Called exactly once. */
  makeSink: (ctx: { turnId: string; conversationId: string | null }) => TurnSink
  /**
   * Channels use this to register the new turn (abort previous, store
   * controller, capture sender). Fires after the sensitive-data gate
   * passes and before agent.respond starts.
   */
  onTurnStarted?: (handle: { turnId: string; controller: AbortController }) => void
  /** Symmetric cleanup for onTurnStarted. Always fires. */
  onTurnEnded?: (handle: { turnId: string }) => void
}

export type TurnHandle = {
  turnId: string
  controller: AbortController
  /** Resolves when the turn finishes (success or error). */
  done: Promise<void>
}

/**
 * Single agent-wide dispatcher. Drives every turn through agent.respond
 * regardless of which channel originated it. Owns:
 *  - the sensitive-data gate,
 *  - per-turn corpus listener registration,
 *  - amygdala approval routing via turnRouter,
 *  - cross-channel serialization. Broca/amygdala state lives on the
 *    agent, so two concurrent respond() calls would corrupt it. The
 *    runner queues send() calls behind a Promise chain so a Telegram
 *    message arriving mid-Electron-turn waits politely.
 *
 * A channel can still preempt by aborting the previous controller
 * before calling send — that lets the queued head unwind quickly.
 */
export class TurnRunner {
  private chain: Promise<void> = Promise.resolve()
  private blockCredentials: boolean = false

  constructor(private readonly agent: Agent) {}

  setBlockCredentials(value: boolean): void {
    this.blockCredentials = value
  }

  send(opts: TurnSendOptions): TurnHandle {
    const turnId = generateTurnId()
    const controller = opts.controller ?? new AbortController()

    const sink = opts.makeSink({
      turnId,
      conversationId: opts.conversationId ?? null
    })

    const lastMessage = opts.history[opts.history.length - 1]
    const userContent = lastMessage && lastMessage.role === 'user' ? lastMessage.content : ''
    const sensitive = this.blockCredentials ? detectSensitiveData(userContent) : null

    if (sensitive) {
      // Sensitive-data gate runs synchronously and bypasses the chain
      // — there is no agent.respond, so no shared state to corrupt
      // and no benefit from queueing. The reply still uses the
      // channel's sink so the user gets the canned response wherever
      // they sent the message from.
      this.agent.corpus.emit('security.credentialBlocked', {
        type: sensitive.type,
        messageDiscarded: true
      })
      sink.onSegment({
        kind: 'text',
        turnId,
        segmentId: 'seg_1',
        delta: CREDENTIAL_BLOCKED_REPLY
      })
      sink.onSegment({
        kind: 'turn_end',
        turnId,
        segmentId: 'seg_2',
        stopReason: 'end_turn',
        iterationCount: 0
      })
      sink.onCredentialBlocked(sensitive.type)
      sink.onDone()
      return {
        turnId,
        controller,
        done: Promise.resolve()
      }
    }

    const prevChain = this.chain
    const agent = this.agent

    const done = (async () => {
      // Wait for any in-flight turn to finish before touching shared
      // state. A channel that wants priority should abort the previous
      // turn's controller before calling send — that lets the head
      // unwind quickly rather than playing out fully.
      await prevChain.catch(() => undefined)

      opts.onTurnStarted?.({ turnId, controller })

      const offs: Array<() => void> = []
      for (const eventName of TURN_RELAYED_EVENTS) {
        const off = agent.corpus.on(eventName, (payload) => {
          sink.onTurnEvent(eventName, payload)
        })
        offs.push(off)
      }

      turnRouter.setActive(sink)

      try {
        await agent.respond({
          history: opts.history,
          turnId,
          conversationId: opts.conversationId ?? null,
          signal: controller.signal,
          onSegment: (segment) => sink.onSegment(segment)
        })
        sink.onDone()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        sink.onError(message)
      } finally {
        for (const off of offs) off()
        if (turnRouter.getActive() === sink) {
          turnRouter.setActive(null)
        }
        opts.onTurnEnded?.({ turnId })
      }
    })()

    this.chain = done.catch(() => undefined)

    return { turnId, controller, done }
  }
}

function generateTurnId(): string {
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
