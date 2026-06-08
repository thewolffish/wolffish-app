import { turnRouter, type TurnSink } from '@main/channels/channel'
import { generateTitle } from '@main/conversations'
import type { Agent } from '@main/runtime/agent'
import type { CorpusEvent } from '@main/runtime/corpus'
import { CREDENTIAL_BLOCKED_REPLY, detectSensitiveData } from '@main/runtime/sensitiveDataFilter'
import type { ChatHistoryMessage } from '@preload/index'

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
  conversationTitle?: string | null
  thinkingMode?: 'none' | 'basic' | 'extended' | 'max' | 'fast' | 'budget'
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
  private locale: 'en' | 'ar' = 'en'

  constructor(private readonly agent: Agent) {}

  setBlockCredentials(value: boolean): void {
    this.blockCredentials = value
  }

  setLocale(value: 'en' | 'ar'): void {
    this.locale = value
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
        let title = opts.conversationTitle
        if (!title) {
          const firstUser = opts.history.find((m) => m.role === 'user')
          if (firstUser) {
            title = generateTitle({
              id: '',
              title: 'Untitled',
              model: null,
              messages: [{ role: 'user', content: firstUser.content, timestamp: 0 }],
              createdAt: 0,
              updatedAt: 0
            })
          }
        }

        await agent.respond({
          history: opts.history,
          turnId,
          conversationId: opts.conversationId ?? null,
          conversationTitle: title,
          signal: controller.signal,
          onSegment: (segment) => sink.onSegment(segment),
          thinkingMode: opts.thinkingMode
        })
        sink.onDone()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        sink.onError(humanizeProviderError(message, this.locale))
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

type ErrorKey =
  | 'invalidKey'
  | 'modelNotFound'
  | 'rateLimited'
  | 'serverError'
  | 'offline'
  | 'badRequest'

const ERROR_MESSAGES: Record<ErrorKey, Record<'en' | 'ar', string>> = {
  invalidKey: {
    en: 'The model API key appears to be invalid or expired. Update it in Settings.',
    ar: 'يبدو أن مفتاح API للنموذج غير صالح أو منتهي الصلاحية. حدّثه من الإعدادات.'
  },
  modelNotFound: {
    en: 'The configured model was not found. It may have been renamed or retired by the provider.',
    ar: 'لم يُعثر على النموذج المحدد. ربما تم تغيير اسمه أو إيقافه من قبل المزوّد.'
  },
  rateLimited: {
    en: 'Rate-limited by the model provider. Try again in a moment.',
    ar: 'تم تقييد الطلبات من المزوّد. حاول مجدداً بعد قليل.'
  },
  serverError: {
    en: 'The model provider is temporarily unavailable. Try again shortly.',
    ar: 'مزوّد النموذج غير متاح مؤقتاً. حاول مجدداً بعد قليل.'
  },
  offline: {
    en: 'You appear to be offline. Check your internet connection.',
    ar: 'يبدو أنك غير متصل بالإنترنت. تحقق من اتصالك.'
  },
  badRequest: {
    en: 'The provider rejected the request. Try a different model or check your configuration.',
    ar: 'رفض المزوّد الطلب. جرّب نموذجاً آخر أو تحقق من الإعدادات.'
  }
}

function humanizeProviderError(raw: string, locale: 'en' | 'ar'): string {
  // Reason-key strings from thalamus STATUS_REASON_LABEL (no_provider_available path)
  if (raw === 'authentication failed' || raw === 'forbidden')
    return ERROR_MESSAGES.invalidKey[locale]
  if (raw === 'model not found') return ERROR_MESSAGES.modelNotFound[locale]
  if (raw === 'rate-limited') return ERROR_MESSAGES.rateLimited[locale]
  if (raw === 'bad request') return ERROR_MESSAGES.badRequest[locale]
  if (
    raw === 'unavailable' ||
    raw === 'server error' ||
    raw === 'gateway error' ||
    raw === 'timeout' ||
    raw === 'overloaded'
  ) {
    return ERROR_MESSAGES.serverError[locale]
  }
  if (raw === 'offline') return ERROR_MESSAGES.offline[locale]

  // Raw HTTP errors from committed-error path (provider threw mid-stream)
  if (/HTTP\s+400/i.test(raw)) {
    const provider = extractProviderName(raw)
    const base = ERROR_MESSAGES.badRequest[locale]
    return provider ? `${provider}: ${base}` : base
  }
  if (/HTTP\s+40[13]/i.test(raw)) {
    const provider = extractProviderName(raw)
    const base = ERROR_MESSAGES.invalidKey[locale]
    return provider ? `${provider}: ${base}` : base
  }
  if (/HTTP\s+404/i.test(raw)) return ERROR_MESSAGES.modelNotFound[locale]
  if (/HTTP\s+429/i.test(raw)) return ERROR_MESSAGES.rateLimited[locale]
  if (/HTTP\s+5\d\d/i.test(raw) || /overloaded/i.test(raw))
    return ERROR_MESSAGES.serverError[locale]
  return raw
}

function extractProviderName(error: string): string | null {
  const match = /^(anthropic|openai|deepseek|mimo|kimi|minimax)\b/i.exec(error)
  return match ? match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase() : null
}

function generateTurnId(): string {
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
