// Relative (not @main): outbound stays electron-free / tsx-testable, and its
// other @main imports are type-only (erased). A value import must resolve at
// runtime for the standalone tests, so it goes through the relative path.
import { deliveredFilesReminder } from './agent/delivered-files'
import type { RuntimeContext } from '@main/runtime/prefrontal'
import type { ChatMessage, ProviderStreamOptions } from '@main/runtime/thalamus'

/**
 * Outbound request shaping — the structural clone boundary.
 *
 * Everything here operates on a copy of the request right before provider
 * dispatch. The internal full-fidelity messages array is never mutated and
 * never sees any of these transformations; they exist only on the wire.
 * This module is deliberately pure and electron-free so it stays unit-
 * testable.
 *
 * Cardinal rule: only content that is provably obsolete (superseded by
 * newer state of the same context), provably duplicated (byte-equal), or
 * provably inert is replaced — and always with a self-describing stub, so
 * the model knows something existed, what it was, and how to get it back.
 * Anything requiring judgment stays.
 */

/**
 * Tools whose successful result is a snapshot of live page state for one
 * browser session. A newer successful read of the same tool+session
 * provably supersedes older ones — the old text described a page that no
 * longer looks like that, and the model already acted on it. These two
 * tools carried 96% (2026-06-11 run) and 68% (2026-06-12 run) of all
 * tool-result bytes.
 */
const PAGE_STATE_TOOLS = new Set(['browser_page_content', 'ext_read_page'])

/**
 * Results smaller than this stay untouched. Stubbing tiny content saves
 * nothing and costs clarity — and the stub itself is ~60 tokens.
 */
const MIN_STUB_CHARS = 2_000

/**
 * Live runtime context, injected at the tail of the outbound clone each
 * iteration instead of into the system prompt. Two kinds of volatile fact
 * ride here: the host clock (current date/time, UTC offset, and IANA zone
 * — a coarse location hint, all useful to any agent) and the loop-position
 * counters. Keeping them out of the prompt is what lets the entire prompt
 * prefix-match in provider caches; keeping them at the very end means only
 * these ~90 tokens are ever re-billed — and the volatile tail renders
 * strictly after every cache breakpoint (see anthropic.ts), so its
 * per-iteration churn never perturbs a prefix hash.
 *
 * The clock is sampled fresh per call (`now` is injectable for tests), so
 * unlike the once-per-turn `<device>` block it stays accurate even across
 * a long tool loop.
 *
 * The wording matters: as the most recent message in the request, this
 * line is highly salient. The 2026-06-12 run showed a model reading the
 * bare counter at a frustrating moment, deciding to "close this turn and
 * continue next turn", and ending the task — so the line must declare
 * itself non-conversational and restate the loop mechanic (no tool calls
 * = task over) without overriding the model's judgment to stop when a
 * task is truly complete or hopeless.
 */
export function formatRuntimeStatus(runtime: RuntimeContext, now: Date = new Date()): string {
  // Files a tool already auto-attached this turn ride here (after every cache
  // breakpoint) rather than in a tool-result message — so reminding the model
  // not to re-send them via send_file never perturbs the cached history prefix.
  const delivered = deliveredFilesReminder(runtime.deliveredFiles ?? [])
  return (
    `[runtime] Current date/time: ${formatClock(now)}. ` +
    `Tool iteration this turn: ${runtime.iteration}. Tools called this turn: ${runtime.toolsCalled}. ` +
    (delivered ? `${delivered} ` : '') +
    `(Automated telemetry, not a user message — do not reply to it or summarize progress because of it. ` +
    `If the task is unfinished, keep calling tools: a response without tool calls ends the task; there is no next turn.)`
  )
}

/**
 * Compact, unambiguous local timestamp for the runtime tail — weekday,
 * ISO date, 24h time, UTC offset, and IANA zone, e.g.
 * "Mon 2026-06-15 14:34 (GMT+03:00, Asia/Riyadh)". Pure given
 * (now, timeZone) so it unit-tests deterministically; the live caller lets
 * `timeZone` resolve to the host zone. Defensive by contract: this runs on
 * every iteration and a throw here would break the tool loop, so any
 * ICU/option gap degrades to a bare UTC ISO instant rather than throwing.
 */
export function formatClock(now: Date, timeZone: string = resolveHostTimeZone()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset'
    }).formatToParts(now)
    const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
    if (!part('year') || !part('hour')) throw new Error('incomplete parts')
    const date = `${part('year')}-${part('month')}-${part('day')}`
    const time = `${part('hour')}:${part('minute')}`
    return `${part('weekday')} ${date} ${time} (${part('timeZoneName')}, ${timeZone})`
  } catch {
    return `${now.toISOString()} (UTC, ${timeZone})`
  }
}

function resolveHostTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Assemble the outbound clone: deterministic truncation of provably
 * superseded/duplicated payloads (when enabled), then the volatile
 * runtime tail. Returns the original options object untouched when there
 * is nothing to do.
 */
export function shapeOutbound(options: ProviderStreamOptions): ProviderStreamOptions {
  let messages = options.messages
  if (options.truncateOutbound) {
    messages = truncateSuperseded(messages)
  }
  if (options.volatileStatus) {
    const tail: ChatMessage = { role: 'user', content: options.volatileStatus, volatile: true }
    messages = [...messages, tail]
  }
  return messages === options.messages ? options : { ...options, messages }
}

/**
 * Build the outbound structural clone with only the volatile tail.
 * Retained for callers/tests that exercise the tail in isolation;
 * shapeOutbound is the full pipeline.
 */
export function withVolatileTail(options: ProviderStreamOptions): ProviderStreamOptions {
  return shapeOutbound({ ...options, truncateOutbound: false })
}

/**
 * Deterministic outbound truncation. Three passes, all keyed on provable
 * facts, all producing new message objects (originals are never touched):
 *
 * 1. Superseded page state — older successful page-state reads of the
 *    same tool+browser-session collapse to a stub once a newer successful
 *    read exists. The newest read of each session always stays full, and
 *    failed reads always stay full (failures are evidence).
 * 2. Byte-equal duplicates — a later result identical to an earlier one
 *    collapses to a backward pointer. The earliest full copy is kept
 *    (not the latest) deliberately: pointing backward never invalidates
 *    the provider cache prefix, while rewriting an old message to favor
 *    a recent copy would re-bill everything after it. The information is
 *    identical either way — it exists in full earlier in context.
 * 3. Screenshots — only the most recent image-bearing tool result keeps
 *    its images; older ones keep their text but drop the pixels. The
 *    message carrying the newest screenshot is immune to every pass:
 *    the latest visual state is always load-bearing.
 *
 * Stub texts are pure functions of (tool, original size), so once a
 * message is stubbed its outbound bytes never change again — the cache
 * pays for each stub transition exactly once.
 */
export function truncateSuperseded(messages: ChatMessage[]): ChatMessage[] {
  // tool_use id → args, for browser-session keying. Reads from different
  // sessions never supersede each other.
  const argsById = new Map<string, Record<string, unknown>>()
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolUses) {
      for (const tu of m.toolUses) argsById.set(tu.id, tu.args)
    }
  }

  // Latest successful page-state read per (tool, session).
  const latestPageState = new Map<string, number>()
  // Latest image-bearing tool result — immune to all stubbing.
  let latestImagesIdx = -1
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'tool') continue
    if (!m.isError && PAGE_STATE_TOOLS.has(m.toolName)) {
      latestPageState.set(pageStateKey(m.toolName, m.toolUseId, argsById), i)
    }
    if (m.images && m.images.length > 0) latestImagesIdx = i
  }

  // First occurrence of each full (tool, content) pair, for dedup.
  const firstSeen = new Map<string, number>()
  let changed = false

  const out = messages.map((m, i) => {
    if (m.role !== 'tool') return m
    if (i === latestImagesIdx) return m

    let next = m

    if (
      !m.isError &&
      PAGE_STATE_TOOLS.has(m.toolName) &&
      m.content.length >= MIN_STUB_CHARS &&
      latestPageState.get(pageStateKey(m.toolName, m.toolUseId, argsById)) !== i
    ) {
      next = { ...m, content: supersededStub(m.toolName, m.content.length), images: undefined }
    }

    // Dedup only among results that are still full — a stubbed earlier
    // copy must not become the target of a backward pointer.
    if (next === m && !m.isError && m.content.length >= MIN_STUB_CHARS) {
      const key = `${m.toolName} ${m.content}`
      const first = firstSeen.get(key)
      if (first === undefined) {
        firstSeen.set(key, i)
      } else {
        next = { ...m, content: duplicateStub(m.toolName, m.content.length), images: undefined }
      }
    }

    if (next === m && m.images && m.images.length > 0) {
      next = { ...m, images: undefined, content: imagesOmittedNote(m.images.length) + m.content }
    }

    if (next !== m) changed = true
    return next
  })

  return changed ? out : messages
}

function pageStateKey(
  toolName: string,
  toolUseId: string,
  argsById: Map<string, Record<string, unknown>>
): string {
  const args = argsById.get(toolUseId)
  const session = typeof args?.session_id === 'string' ? args.session_id : ''
  return `${toolName} ${session}`
}

function supersededStub(tool: string, chars: number): string {
  return (
    `[superseded page state — this ${tool} result (${chars.toLocaleString()} chars) was replaced by a ` +
    `newer read of the same browser session later in this conversation. The page may have changed since; ` +
    `call ${tool} again if you need its current content.]`
  )
}

function duplicateStub(tool: string, chars: number): string {
  return `[duplicate result — byte-identical to an earlier ${tool} result above (${chars.toLocaleString()} chars); refer to that copy.]`
}

function imagesOmittedNote(count: number): string {
  const what = count === 1 ? 'screenshot' : `${count} screenshots`
  return `[${what} omitted — a newer screenshot appears later in this conversation; take a new one if you need current visuals.]\n`
}
