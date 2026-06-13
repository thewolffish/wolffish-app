import type { Corpus } from '@main/runtime/corpus'
import { shapeOutbound } from '@main/runtime/outbound'
import { AnthropicProvider } from '@main/runtime/providers/anthropic'
import { DeepSeekProvider } from '@main/runtime/providers/deepseek'
import { KimiProvider } from '@main/runtime/providers/kimi'
import { LocalProvider } from '@main/runtime/providers/local'
import { MimoProvider } from '@main/runtime/providers/mimo'
import { MiniMaxProvider } from '@main/runtime/providers/minimax'
import { OpenAIProvider } from '@main/runtime/providers/openai'
import { OpenRouterProvider } from '@main/runtime/providers/openrouter'
import { QwenProvider } from '@main/runtime/providers/qwen'
import { StepfunProvider } from '@main/runtime/providers/stepfun'
import { XAIProvider } from '@main/runtime/providers/xai'
import {
  cloudModelSupportsVision,
  hasVisualContent,
  stripVisualContent
} from '@main/runtime/vision'
import { net } from 'electron'

export type ToolUse = {
  id: string
  name: string
  args: Record<string, unknown>
}

export type UserContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string }
  | { type: 'document'; mediaType: 'application/pdf'; data: string }

export type ToolResultImage = {
  mediaType: string
  data: string
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | {
      role: 'user'
      content: string | UserContentBlock[]
      /**
       * Marks a synthetic outbound-only message (the per-iteration runtime
       * status tail). Never present on internal history — it is appended to
       * the structural clone right before provider dispatch. Providers must
       * never place a cache breakpoint on a volatile message: its content
       * changes every call, so a breakpoint there would never match again.
       */
      volatile?: boolean
    }
  | { role: 'assistant'; content: string; toolUses?: ToolUse[]; reasoningContent?: string }
  | {
      role: 'tool'
      toolUseId: string
      toolName: string
      content: string
      isError?: boolean
      images?: ToolResultImage[]
    }

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'deepseek'
  | 'mimo'
  | 'kimi'
  | 'minimax'
  | 'xai'
  | 'qwen'
  | 'stepfun'
  | 'local'

export type ToolDefinition = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type ThinkingMode = 'none' | 'basic' | 'extended' | 'max' | 'fast' | 'budget'

export type ProviderStreamOptions = {
  system: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  signal?: AbortSignal
  thinkingMode?: ThinkingMode
  /**
   * Per-iteration loop-position report (live tool counters). Appended to
   * the outbound structural clone as a final volatile user message so
   * everything before it stays a byte-stable, cacheable prefix. The
   * internal messages array is never touched.
   */
  volatileStatus?: string
  /**
   * Enables deterministic outbound truncation in the structural clone:
   * superseded page-state reads, byte-equal duplicate results, and stale
   * screenshots collapse to self-describing stubs. Internal history is
   * never touched. See outbound.ts for the exact (conservative) rules.
   */
  truncateOutbound?: boolean
  /**
   * Stable per-conversation key passed to providers that support cache
   * routing hints (OpenAI `prompt_cache_key`). Keeps all calls of a task
   * on the same cache shard — without it, sustained tool loops above
   * ~15 req/min on one prefix overflow to cold machines.
   */
  cacheKey?: string
  /**
   * Provider+model that served the previous iteration of this turn. The
   * cascade moves this entry to the front so a mid-task turn keeps
   * hitting the same provider cache. Hard failures still cascade onward —
   * pinning biases the order, it never traps the turn on a dead provider.
   */
  stickyProvider?: { id: ProviderId; model: string }
  /**
   * Invoked by thalamus on a cloud→local fallback transition within a
   * single stream call. Lets the caller (the agent) supply a system
   * prompt rebuilt for fallback context — including the `<runtime>`
   * provider notice — and the tool list appropriate for the current
   * fallback mode (no tools in restricted mode). When omitted, thalamus
   * reuses the cloud options for the local call and only the model's
   * response can signal the fallback to the user.
   */
  buildFallback?: (mode: FallbackMode) => Promise<FallbackOptions> | FallbackOptions
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'unknown'

export type StreamUsage = {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
}

export type NoProviderAvailableInfo = {
  provider: string
  providerLogo: string
  statusCode: number | null
  errorReason: string
  errorDetail: string | null
  retriesAttempted: number
  totalDurationMs: number
}

export type FallbackMode = 'full' | 'restricted'

export type FallbackOptions = {
  system: string
  tools?: ToolDefinition[]
}

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  // provider/model are stamped by thalamus on relay — unlike the
  // head-of-cascade active_model announcement, they name the entry that
  // actually served the call, which is what turn pinning must follow.
  | {
      type: 'turn_meta'
      stopReason: StopReason
      usage?: StreamUsage
      provider?: ProviderId
      model?: string
    }
  | { type: 'error'; message: string; recoverable: boolean; failures?: NoProviderAvailableInfo[] }
  | { type: 'active_model'; provider: ProviderId; model: string }
  | {
      type: 'provider_change'
      from: string
      to: string
      model: string
      reason: string
      mode: FallbackMode
    }
  | { type: 'no_provider_available'; failures: NoProviderAvailableInfo[] }

export type CloudProviderConfig = {
  id:
    | 'anthropic'
    | 'openai'
    | 'openrouter'
    | 'deepseek'
    | 'mimo'
    | 'kimi'
    | 'minimax'
    | 'xai'
    | 'qwen'
    | 'stepfun'
  model: string
  apiKey: string
  models?: string[]
  reasoningModels?: string[]
  // Anthropic cache breakpoint TTL. '1h' costs 2x base on cache writes but
  // survives tasks whose individual steps outlast the 5-minute default
  // (slow browser automation, long shell commands). Anthropic-only.
  cacheTtl?: '5m' | '1h'
}

export type ProviderHealth = {
  id: ProviderId
  healthy: boolean
  failCount: number
  cooldownUntil: number
}

export type ThalamusOptions = {
  corpus?: Corpus
}

// Per-provider cooldown after consecutive failures, exposed via
// getHealth() for diagnostics. The cascade itself does NOT skip
// providers in cooldown — every turn re-tries from the top of the
// cascade so a transiently-flaky provider gets another shot, and the
// retry budget below absorbs the actual back-off. Steps escalate so a
// genuinely-broken provider stays visibly degraded for longer.
const COOLDOWN_STEPS_MS = [30_000, 60_000, 120_000, 300_000]

// ~3 minutes total. Cloud providers retry on transient failures with
// this schedule before the cascade moves to the next provider. Slow but
// non-erroring streams never trip this — there's no per-call deadline,
// so a long Claude response doesn't cascade unnecessarily to Ollama.
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 90_000]

const PROVIDER_LOGO: Record<ProviderId, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  openrouter: 'openrouter',
  deepseek: 'deepseek',
  mimo: 'mimo',
  kimi: 'kimi',
  minimax: 'minimax',
  xai: 'xai',
  qwen: 'qwen',
  stepfun: 'stepfun',
  local: 'ollama'
}

// Short English labels surfaced to the local fallback model via the
// <provider> notice in its runtime block. They aren't i18n keys —
// nothing translates them — they're plain-text hints the model can
// quote or paraphrase when explaining the situation to the user.
const STATUS_REASON_LABEL: Record<number, string> = {
  400: 'bad request',
  401: 'authentication failed',
  403: 'forbidden',
  404: 'model not found',
  429: 'rate-limited',
  500: 'server error',
  502: 'gateway error',
  503: 'unavailable',
  504: 'timeout',
  529: 'overloaded'
}

type ErrorClass = 'transient' | 'hard' | 'offline' | 'unknown'

type ProviderFailure = {
  provider: ProviderId
  statusCode: number | null
  errorClass: ErrorClass
  reasonKey: string
  rawMessage: string | null
  retries: number
  durationMs: number
}

interface StreamableProvider {
  stream(options: ProviderStreamOptions): AsyncGenerator<StreamChunk>
}

type CascadeEntry = {
  id: ProviderId
  model: string
  provider: StreamableProvider
}

/**
 * Thalamus is the sensory gateway — every input passes through it before
 * it reaches any other region.
 *
 * Maps to: the thalamus — a pair of egg-shaped nuclei that sit on top of
 * the brainstem and relay almost every sensory signal (sight, sound,
 * touch, taste — everything except smell) up to the cortex. Nothing
 * reaches conscious processing without being routed by the thalamus first.
 *
 * In Wolffish, Thalamus owns the LLM cascade: Claude → OpenAI → Local. It
 * tracks each provider's health, falls back automatically on failure with
 * exponential cooldown, and exposes a single async-generator interface so
 * downstream regions don't need to know which provider is responding.
 */
export class Thalamus {
  private cloudProviders: CloudProviderConfig[] = []
  private cloudPriority: CloudProviderConfig['id'][] = []
  private health = new Map<ProviderId, ProviderHealth>()
  private corpus: Corpus | null
  private allowLocalFallback = false
  private localOnly = false

  constructor(
    private local: LocalProvider,
    options: ThalamusOptions = {}
  ) {
    this.corpus = options.corpus ?? null
  }

  setCorpus(corpus: Corpus): void {
    this.corpus = corpus
  }

  setCloudProviders(providers: CloudProviderConfig[]): void {
    this.cloudProviders = providers.filter((p) => p.apiKey && p.model)
  }

  setCloudPriority(order: CloudProviderConfig['id'][]): void {
    this.cloudPriority = [...order]
  }

  getCloudProviders(): CloudProviderConfig[] {
    return [...this.cloudProviders]
  }

  setAllowLocalFallback(value: boolean): void {
    this.allowLocalFallback = value
  }

  setLocalOnly(value: boolean): void {
    this.localOnly = value
  }

  /**
   * Local fallback always engages when cloud exhausts; this getter
   * exposes the *mode* the local model should run in. `'full'` lets it
   * use tools and try anything (the user opted in). `'restricted'`
   * means the local model has no tools surfaced and is steered via
   * agents.md to decline complex requests in plain text.
   */
  getFallbackMode(): FallbackMode {
    return this.allowLocalFallback ? 'full' : 'restricted'
  }

  cascade(): ProviderId[] {
    return this.buildCascade().map((c) => c.id)
  }

  /**
   * The first provider in the cascade — i.e. the one we'd hit right now,
   * ignoring health/cooldown. Used by callers that just want a label for
   * the model that will probably handle the request.
   */
  getActiveProvider(): ProviderId | null {
    return this.buildCascade()[0]?.id ?? null
  }

  /**
   * Model name of the first cascade entry — the one getActiveProvider()
   * points at. Null when nothing is configured.
   */
  getActiveModel(): string | null {
    return this.buildCascade()[0]?.model ?? null
  }

  getLocalModelName(): string | null {
    return this.local.currentModel
  }

  /**
   * Whether the active local model supports image input. Queries
   * Ollama's /api/show on first call and caches the result. Returns
   * false when no local model is configured.
   */
  async localSupportsVision(): Promise<boolean> {
    return this.local.supportsVision()
  }

  /**
   * Per-entry multimodal gate. Vision blocks can reach a text-only entry
   * via replayed history, tool-result screenshots, or a mid-turn cascade
   * fallback from a vision model — and text-only APIs reject the whole
   * request with HTTP 400 when they see an image part (DeepSeek: `unknown
   * variant image_url, expected text`). Strip rather than fail: the model
   * gets a note about what was removed instead.
   */
  private async guardVisualContent(
    entry: CascadeEntry,
    options: ProviderStreamOptions
  ): Promise<ProviderStreamOptions> {
    if (!hasVisualContent(options.messages)) return options
    const vision =
      entry.id === 'local'
        ? await this.local.supportsVision()
        : cloudModelSupportsVision(entry.id, entry.model)
    if (vision) return options
    return { ...options, messages: stripVisualContent(options.messages) }
  }

  /**
   * Context-window size (input tokens) for the model that would handle the
   * next turn — i.e. the first provider in the cascade. Returns a
   * conservative 8 000 when nothing is configured.
   */
  getActiveContextWindow(): number {
    const cascade = this.buildCascade()
    if (cascade.length === 0) return 8_000
    return contextWindowForModel(cascade[0].model)
  }

  /**
   * Token budget for context assembly. Subtracts the model's output ceiling
   * from the context window so the combined input+max_tokens never exceeds
   * the model's limit. For Anthropic (separate input/output budgets) the
   * deduction is zero.
   */
  getContextBudget(): number {
    const cascade = this.buildCascade()
    if (cascade.length === 0) return 8_000
    const model = cascade[0].model
    const window = contextWindowForModel(model)
    const outputReserve = maxOutputForModel(model)
    return Math.max(window - outputReserve, Math.floor(window * 0.5))
  }

  /**
   * Make a bare LLM call to summarize content for context compaction.
   * Uses the same provider cascade as the main stream (head provider
   * first, falling through on failure). No system prompt, no tools —
   * pure summarization.
   *
   * If the content exceeds the compaction model's own context window, it
   * is split into parts, each compacted separately, and the summaries
   * merged.
   */
  async compactContent(
    content: string,
    signal?: AbortSignal
  ): Promise<{ text: string; provider: string; model: string }> {
    const instruction =
      `You are compacting conversation context to fit within a model's context window. ` +
      `Your goal is to REDUCE size while RETAINING maximum useful information.\n\n` +
      `Rules:\n` +
      `- Preserve ALL: tool names, function calls, API endpoints, parameter names, return values, error messages, status codes\n` +
      `- Preserve ALL: names, emails, dates, timestamps, numbers, IDs, URLs, file paths\n` +
      `- Preserve ALL: decisions made, action items, conclusions, errors and their causes\n` +
      `- For structured data (JSON, tables): keep the schema/keys and representative values, collapse repeated similar entries into a count + example\n` +
      `- For tool results: keep the tool name, key fields from the response, and outcome. Do NOT reduce a tool call + result to a single sentence\n` +
      `- Remove: redundant whitespace, boilerplate HTML/headers, repeated patterns, verbose formatting, base64 data, CSS/styling\n` +
      `- Remove: marketing copy, legal disclaimers, email footers/signatures, tracking pixels descriptions\n` +
      `- Output plain text, no markdown formatting overhead\n` +
      `- Never fabricate or infer data not present in the original\n\n` +
      `Compact the following:\n\n---\n\n`
    const prompt = instruction + content
    const promptTokens = Math.ceil(prompt.length / 4)

    const cascade = this.buildCascade()
    if (cascade.length === 0) throw new Error('No compaction providers available')

    for (const entry of cascade) {
      const modelWindow = contextWindowForModel(entry.model)
      const maxOutput = maxOutputForModel(entry.model)
      const available = modelWindow - maxOutput

      if (promptTokens <= available) {
        const result = await this.compactSingle(entry, prompt, signal)
        if (result) return result
        continue
      }

      const promptOverheadChars = instruction.length + 50
      const charsPerPart = Math.max(available * 4 - promptOverheadChars, 4000)
      const parts: string[] = []
      for (let i = 0; i < content.length; i += charsPerPart) {
        parts.push(content.slice(i, i + charsPerPart))
      }

      try {
        const summaries = await Promise.all(
          parts.map((part) => {
            return this.compactSingle(entry, instruction + part, signal)
          })
        )
        const valid = summaries.filter(Boolean) as {
          text: string
          provider: string
          model: string
        }[]
        if (valid.length === parts.length) {
          return {
            text: valid.map((s) => s.text).join('\n\n'),
            provider: valid[0].provider,
            model: valid[0].model
          }
        }
      } catch {
        // fall through to next provider
      }
    }

    throw new Error('All compaction providers failed')
  }

  /**
   * Raw LLM call for conversation-level summarization during compaction.
   * Unlike compactContent, takes a complete prompt (no hardcoded instruction)
   * and uses 5 retries with escalating backoff for resilience.
   *
   * If the prompt exceeds the model's context window, it is split into parts,
   * each summarized separately, and the results merged.
   */
  async summarize(
    prompt: string,
    signal?: AbortSignal
  ): Promise<{ text: string; provider: string; model: string }> {
    const promptTokens = Math.ceil(prompt.length / 4)

    const cascade = this.buildCascade()
    if (cascade.length === 0) throw new Error('No summarization providers available')

    for (const entry of cascade) {
      const modelWindow = contextWindowForModel(entry.model)
      const maxOutput = maxOutputForModel(entry.model)
      const available = modelWindow - maxOutput

      if (promptTokens <= available) {
        const result = await this.summarizeSingle(entry, prompt, signal)
        if (result) return result
        continue
      }

      const charsPerPart = Math.max(available * 4 - 500, 4000)
      const parts: string[] = []
      for (let i = 0; i < prompt.length; i += charsPerPart) {
        parts.push(prompt.slice(i, i + charsPerPart))
      }

      try {
        const summaries = await Promise.all(
          parts.map((part) => this.summarizeSingle(entry, part, signal))
        )
        const valid = summaries.filter(Boolean) as {
          text: string
          provider: string
          model: string
        }[]
        if (valid.length === parts.length) {
          return {
            text: valid.map((s) => s.text).join('\n\n'),
            provider: valid[0].provider,
            model: valid[0].model
          }
        }
      } catch {
        // fall through to next provider
      }
    }

    throw new Error('All summarization providers failed')
  }

  /**
   * Single summarization call. 5 retries with escalating backoff
   * (1s, 2s, 4s, 8s, 16s).
   */
  private async summarizeSingle(
    entry: CascadeEntry,
    prompt: string,
    signal?: AbortSignal
  ): Promise<{ text: string; provider: string; model: string } | null> {
    const msgs: ChatMessage[] = [{ role: 'user', content: prompt }]
    const delays = [1000, 2000, 4000, 8000, 16000]

    for (let attempt = 0; attempt < 5; attempt++) {
      if (signal?.aborted) return null
      try {
        let text = ''
        for await (const chunk of entry.provider.stream({
          system: '',
          messages: msgs,
          signal
        })) {
          if (chunk.type === 'text') text += chunk.text
        }
        if (text.length > 0) return { text, provider: entry.id, model: entry.model }
      } catch {
        if (attempt >= 4) return null
        await sleep(delays[attempt], signal)
      }
    }
    return null
  }

  /**
   * Single compaction call to one provider. Returns null on failure.
   * Retries up to 3 times with brief back-off.
   */
  private async compactSingle(
    entry: CascadeEntry,
    prompt: string,
    signal?: AbortSignal
  ): Promise<{ text: string; provider: string; model: string } | null> {
    const messages: ChatMessage[] = [{ role: 'user', content: prompt }]
    let attempts = 0

    while (attempts < 3) {
      attempts++
      if (signal?.aborted) return null
      try {
        let text = ''
        for await (const chunk of entry.provider.stream({
          system: '',
          messages,
          signal
        })) {
          if (chunk.type === 'text') text += chunk.text
        }
        if (text.length > 0) return { text, provider: entry.id, model: entry.model }
      } catch {
        if (attempts >= 3) return null
        await sleep(1000, signal)
      }
    }
    return null
  }

  /**
   * Stream a turn through the provider cascade.
   *
   * Each cloud provider gets a retry budget (`RETRY_DELAYS_MS`) for
   * transient failures (overloaded, rate-limited, gateway errors). Hard
   * failures (auth, not-found) skip ahead to the next cloud provider
   * with no delay. Once every cloud provider exhausts its retries, the
   * cascade *always* falls back to the local model when one is
   * configured — `allowLocalFallback` no longer gates this; it only
   * controls the fallback mode the local model runs in. When no local
   * model exists, thalamus yields a single `no_provider_available`
   * chunk and the renderer can surface a structured retry card. Once
   * any text has streamed the provider choice is committed — failures
   * past that point can't retry without the user seeing the abandoned
   * reply.
   */
  async *stream(options: ProviderStreamOptions): AsyncGenerator<StreamChunk> {
    const cascade = this.buildCascade()
    if (cascade.length === 0) {
      const message = 'no provider available — load a local model or add an API key'
      this.emit('llm.error', { provider: 'none', error: message })
      yield { type: 'error', message, recoverable: false }
      return
    }

    const cloudEntries = cascade.filter((c) => c.id !== 'local')
    const localEntry = cascade.find((c) => c.id === 'local') ?? null

    // Task pinning: bias the cascade toward the provider+model that served
    // the previous iteration of this turn, so the conversation prefix keeps
    // hitting the same provider's cache. Only reorders — a pinned provider
    // that hard-fails still cascades to the rest as usual.
    const sticky = options.stickyProvider
    if (sticky) {
      const idx = cloudEntries.findIndex((c) => c.id === sticky.id && c.model === sticky.model)
      if (idx > 0) {
        const [entry] = cloudEntries.splice(idx, 1)
        cloudEntries.unshift(entry)
      }
    }

    // Announce who's about to handle this turn so the renderer can show a
    // chip alongside the response. Falls back to local when no cloud key
    // is configured. The provider_change chunk later in the cascade keeps
    // the renderer in sync if we have to fail over to local mid-turn.
    const head = cloudEntries[0] ?? localEntry
    if (head) {
      yield { type: 'active_model', provider: head.id, model: head.model }
    }

    const allFailures: ProviderFailure[] = []

    // 1. Cloud providers, each with their own retry budget.
    for (const entry of cloudEntries) {
      const result = yield* this.streamOnce(entry, options, { retry: true })
      if (result.kind === 'success') return
      if (result.kind === 'committed-error') {
        const failures = result.failure
          ? [
              {
                provider: result.failure.provider,
                providerLogo: PROVIDER_LOGO[result.failure.provider],
                statusCode: result.failure.statusCode,
                errorReason: result.failure.reasonKey,
                errorDetail: result.failure.rawMessage,
                retriesAttempted: result.failure.retries,
                totalDurationMs: result.failure.durationMs
              }
            ]
          : undefined
        yield { type: 'error', message: result.message, recoverable: false, failures }
        return
      }
      allFailures.push(result.failure)
      // Hard or transient-exhausted: try the next cloud provider.
    }

    // 2. Cloud exhausted. Fall to local if one exists — the toggle now
    //    controls the *mode*, not whether the fallback engages.
    const lastCloudFailure = allFailures[allFailures.length - 1] ?? null
    if (localEntry) {
      const mode = this.getFallbackMode()
      // Only announce a provider change when cloud was actually attempted
      // and failed. When local is the head from the start (localOnly mode
      // or no cloud configured), the active_model chunk above already
      // announced local — emitting a provider_change here would falsely
      // claim a fallback from cloud, and surfaces fall-channels (like
      // Telegram, which renders both chunks sequentially) end up showing
      // the model name twice.
      if (lastCloudFailure) {
        this.emit('llm.fallback', {
          from: lastCloudFailure.provider,
          to: localEntry.id,
          reason: lastCloudFailure.reasonKey
        })
        yield {
          type: 'provider_change',
          from: lastCloudFailure.provider,
          to: localEntry.id,
          model: localEntry.model,
          reason: lastCloudFailure.reasonKey,
          mode
        }
      }
      let localOptions = options
      if (options.buildFallback) {
        try {
          const rebuilt = await options.buildFallback(mode)
          localOptions = { ...options, system: rebuilt.system, tools: rebuilt.tools }
        } catch {
          // best-effort — fall through with the cloud-mode options
        }
      }
      const result = yield* this.streamOnce(localEntry, localOptions, { retry: false })
      if (result.kind === 'success') return
      if (result.kind === 'committed-error') {
        const failures = result.failure
          ? [
              {
                provider: result.failure.provider,
                providerLogo: PROVIDER_LOGO[result.failure.provider],
                statusCode: result.failure.statusCode,
                errorReason: result.failure.reasonKey,
                errorDetail: result.failure.rawMessage,
                retriesAttempted: result.failure.retries,
                totalDurationMs: result.failure.durationMs
              }
            ]
          : undefined
        yield { type: 'error', message: result.message, recoverable: false, failures }
        return
      }
      allFailures.push(result.failure)
    }

    // 3. Every provider exhausted. Surface a structured error card per
    //    failed provider so the user sees exactly what went wrong with
    //    each one — not just the last.
    const failures: NoProviderAvailableInfo[] =
      allFailures.length > 0
        ? allFailures.map((f) => ({
            provider: f.provider,
            providerLogo: PROVIDER_LOGO[f.provider],
            statusCode: f.statusCode,
            errorReason: f.reasonKey,
            errorDetail: f.rawMessage,
            retriesAttempted: f.retries,
            totalDurationMs: f.durationMs
          }))
        : [
            {
              provider: cloudEntries[0]?.id ?? localEntry?.id ?? 'local',
              providerLogo: PROVIDER_LOGO[cloudEntries[0]?.id ?? localEntry?.id ?? 'local'],
              statusCode: null,
              errorReason: 'unavailable',
              errorDetail: null,
              retriesAttempted: 0,
              totalDurationMs: 0
            }
          ]
    yield { type: 'no_provider_available', failures }
  }

  private async *streamOnce(
    entry: CascadeEntry,
    options: ProviderStreamOptions,
    cfg: { retry: boolean }
  ): AsyncGenerator<
    StreamChunk,
    | { kind: 'success' }
    | { kind: 'committed-error'; message: string; failure?: ProviderFailure }
    | { kind: 'failed'; failure: ProviderFailure }
  > {
    const guarded = await this.guardVisualContent(entry, shapeOutbound(options))
    const overallStartedAt = Date.now()
    let attempt = 0
    let lastFailure: ProviderFailure | null = null

    while (true) {
      if (options.signal?.aborted) {
        return {
          kind: 'failed',
          failure: lastFailure ?? {
            provider: entry.id,
            statusCode: null,
            errorClass: 'unknown',
            reasonKey: 'unavailable',
            rawMessage: null,
            retries: attempt,
            durationMs: Date.now() - overallStartedAt
          }
        }
      }

      // Offline halts the cloud retries early; local can still try.
      if (entry.id !== 'local' && !net.isOnline()) {
        return {
          kind: 'failed',
          failure: {
            provider: entry.id,
            statusCode: null,
            errorClass: 'offline',
            reasonKey: 'offline',
            rawMessage: null,
            retries: attempt,
            durationMs: Date.now() - overallStartedAt
          }
        }
      }

      this.emit('llm.request', { provider: entry.id, model: entry.model })

      const startedAt = Date.now()
      let textEmitted = false
      let inputTokens = 0
      let outputTokens = 0
      let cacheCreationTokens = 0
      let cacheReadTokens = 0

      try {
        for await (const chunk of entry.provider.stream(guarded)) {
          if (chunk.type === 'text') {
            textEmitted = true
          } else if (chunk.type === 'turn_meta') {
            if (chunk.usage) {
              inputTokens = chunk.usage.inputTokens
              outputTokens = chunk.usage.outputTokens
              cacheCreationTokens = chunk.usage.cacheCreationTokens ?? 0
              cacheReadTokens = chunk.usage.cacheReadTokens ?? 0
            }
            // Stamp the entry that actually served this call so the agent
            // can pin the next iteration to it (active_model only names
            // the cascade head, which may not be who answered).
            yield { ...chunk, provider: entry.id, model: entry.model }
            continue
          }
          yield chunk
        }

        this.markHealthy(entry.id)
        const durationMs = Date.now() - startedAt
        this.emit('llm.response', {
          provider: entry.id,
          inputTokens,
          outputTokens,
          cacheCreationTokens,
          cacheReadTokens,
          durationMs
        })
        return { kind: 'success' }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.markFailed(entry.id)
        this.emit('llm.error', { provider: entry.id, error: message })

        if (textEmitted) {
          // Provider had already streamed bytes to the user — committing
          // to a different provider mid-turn would be incoherent.
          const classified = classifyError(err)
          return {
            kind: 'committed-error',
            message,
            failure: {
              provider: entry.id,
              statusCode: classified.statusCode,
              errorClass: classified.errorClass,
              reasonKey: reasonKeyFor(classified.statusCode),
              rawMessage: extractProviderDetail(message) ?? message,
              retries: attempt,
              durationMs: Date.now() - overallStartedAt
            }
          }
        }
        if (isAbortError(err)) {
          return { kind: 'committed-error', message }
        }

        const classified = classifyError(err)
        lastFailure = {
          provider: entry.id,
          statusCode: classified.statusCode,
          errorClass: classified.errorClass,
          reasonKey: reasonKeyFor(classified.statusCode),
          rawMessage: extractProviderDetail(message),
          retries: attempt,
          durationMs: Date.now() - overallStartedAt
        }

        // Hard errors aren't worth retrying on the same provider.
        if (classified.errorClass === 'hard' || !cfg.retry) {
          return { kind: 'failed', failure: lastFailure }
        }

        // Transient: back off and try again on the same provider.
        if (attempt >= RETRY_DELAYS_MS.length) {
          return { kind: 'failed', failure: lastFailure }
        }
        const delay = RETRY_DELAYS_MS[attempt]
        attempt += 1
        this.emit('llm.retry', {
          provider: entry.id,
          attempt,
          delayMs: delay,
          errorClass: classified.errorClass
        })
        const slept = await sleep(delay, options.signal)
        if (!slept) {
          return {
            kind: 'failed',
            failure: {
              ...lastFailure,
              retries: attempt,
              durationMs: Date.now() - overallStartedAt
            }
          }
        }
      }
    }
  }

  /**
   * Snapshot of provider health for diagnostics.
   */
  getHealth(): ProviderHealth[] {
    return this.buildCascade().map((entry) => {
      const state = this.health.get(entry.id)
      return (
        state ?? {
          id: entry.id,
          healthy: true,
          failCount: 0,
          cooldownUntil: 0
        }
      )
    })
  }

  private buildCascade(): CascadeEntry[] {
    const out: CascadeEntry[] = []
    const seen = new Set<CloudProviderConfig['id']>()
    // Priority is the source of truth for cloud ordering. Any provider
    // configured but missing from priority (legacy configs, race after a
    // save) appends in `cloudProviders` order so it still gets a turn.
    const order: CloudProviderConfig['id'][] = []
    if (!this.localOnly) {
      for (const id of this.cloudPriority) {
        if (seen.has(id)) continue
        if (!this.cloudProviders.some((p) => p.id === id)) continue
        order.push(id)
        seen.add(id)
      }
      for (const p of this.cloudProviders) {
        if (seen.has(p.id)) continue
        order.push(p.id)
        seen.add(p.id)
      }
    }
    for (const id of order) {
      const cfg = this.cloudProviders.find((p) => p.id === id)
      if (!cfg) continue
      if (id === 'anthropic') {
        out.push({
          id: 'anthropic',
          model: cfg.model,
          provider: new AnthropicProvider(cfg.apiKey, cfg.model, undefined, undefined, cfg.cacheTtl)
        })
      } else if (id === 'openai') {
        out.push({
          id: 'openai',
          model: cfg.model,
          provider: new OpenAIProvider(cfg.apiKey, cfg.model, undefined, this.corpus)
        })
      } else if (id === 'deepseek') {
        out.push({
          id: 'deepseek',
          model: cfg.model,
          provider: new DeepSeekProvider(cfg.apiKey, cfg.model)
        })
      } else if (id === 'mimo') {
        out.push({
          id: 'mimo',
          model: cfg.model,
          provider: new MimoProvider(cfg.apiKey, cfg.model)
        })
      } else if (id === 'kimi') {
        out.push({
          id: 'kimi',
          model: cfg.model,
          provider: new KimiProvider(cfg.apiKey, cfg.model)
        })
      } else if (id === 'minimax') {
        out.push({
          id: 'minimax',
          model: cfg.model,
          provider: new MiniMaxProvider(cfg.apiKey, cfg.model)
        })
      } else if (id === 'xai') {
        out.push({
          id: 'xai',
          model: cfg.model,
          provider: new XAIProvider(cfg.apiKey, cfg.model)
        })
      } else if (id === 'qwen') {
        out.push({
          id: 'qwen',
          model: cfg.model,
          provider: new QwenProvider(cfg.apiKey, cfg.model)
        })
      } else if (id === 'stepfun') {
        out.push({
          id: 'stepfun',
          model: cfg.model,
          provider: new StepfunProvider(cfg.apiKey, cfg.model)
        })
      } else if (id === 'openrouter') {
        out.push({
          id: 'openrouter',
          model: cfg.model,
          provider: new OpenRouterProvider(cfg.apiKey, cfg.model, undefined, cfg.reasoningModels)
        })
      }
    }
    if (this.local.isReady) {
      out.push({
        id: 'local',
        model: this.local.currentModel ?? 'local',
        provider: this.local
      })
    }
    return out
  }

  private markHealthy(id: ProviderId): void {
    this.health.set(id, { id, healthy: true, failCount: 0, cooldownUntil: 0 })
  }

  private markFailed(id: ProviderId): void {
    const prev = this.health.get(id)
    const failCount = (prev?.failCount ?? 0) + 1
    const stepIdx = Math.min(failCount - 1, COOLDOWN_STEPS_MS.length - 1)
    const cooldown = COOLDOWN_STEPS_MS[stepIdx]
    this.health.set(id, {
      id,
      healthy: false,
      failCount,
      cooldownUntil: Date.now() + cooldown
    })
  }

  private emit<
    K extends 'llm.request' | 'llm.response' | 'llm.error' | 'llm.fallback' | 'llm.retry'
  >(
    event: K,
    payload: K extends 'llm.request'
      ? { provider: string; model: string }
      : K extends 'llm.response'
        ? {
            provider: string
            inputTokens: number
            outputTokens: number
            cacheCreationTokens: number
            cacheReadTokens: number
            durationMs: number
          }
        : K extends 'llm.error'
          ? { provider: string; error: string }
          : K extends 'llm.fallback'
            ? { from: string; to: string; reason: string }
            : { provider: string; attempt: number; delayMs: number; errorClass: string }
  ): void {
    if (!this.corpus) return
    if (event === 'llm.request') {
      this.corpus.emit('llm.request', payload as { provider: string; model: string })
    } else if (event === 'llm.response') {
      this.corpus.emit(
        'llm.response',
        payload as {
          provider: string
          inputTokens: number
          outputTokens: number
          cacheCreationTokens: number
          cacheReadTokens: number
          durationMs: number
        }
      )
    } else if (event === 'llm.error') {
      this.corpus.emit('llm.error', payload as { provider: string; error: string })
    } else if (event === 'llm.fallback') {
      this.corpus.emit('llm.fallback', payload as { from: string; to: string; reason: string })
    } else {
      this.corpus.emit(
        'llm.retry',
        payload as { provider: string; attempt: number; delayMs: number; errorClass: string }
      )
    }
  }
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: string }).name
  return name === 'AbortError'
}

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504, 529])
const HARD_STATUSES = new Set([400, 401, 403, 404])

function classifyError(err: unknown): { statusCode: number | null; errorClass: ErrorClass } {
  const message = err instanceof Error ? err.message : String(err)
  const status = parseHttpStatus(message)
  if (status !== null) {
    if (TRANSIENT_STATUSES.has(status)) return { statusCode: status, errorClass: 'transient' }
    if (HARD_STATUSES.has(status)) return { statusCode: status, errorClass: 'hard' }
    return { statusCode: status, errorClass: 'unknown' }
  }
  // Fetch-level network errors look like TypeError or AbortError; the
  // ECONNRESET / ETIMEDOUT family also surfaces as transient.
  if (/overloaded|ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|fetch failed/i.test(message)) {
    return { statusCode: null, errorClass: 'transient' }
  }
  return { statusCode: null, errorClass: 'unknown' }
}

function parseHttpStatus(message: string): number | null {
  const match = /HTTP\s+(\d{3})/.exec(message)
  return match ? Number(match[1]) : null
}

function reasonKeyFor(statusCode: number | null): string {
  if (statusCode !== null && STATUS_REASON_LABEL[statusCode]) {
    return STATUS_REASON_LABEL[statusCode]
  }
  return 'unavailable'
}

function extractProviderDetail(raw: string): string | null {
  const jsonStart = raw.indexOf('{')
  if (jsonStart === -1) return null
  try {
    const parsed = JSON.parse(raw.slice(jsonStart))
    const msg = parsed?.error?.message ?? parsed?.message
    return typeof msg === 'string' ? msg : null
  } catch {
    return null
  }
}

function contextWindowForModel(model: string): number {
  const m = model.toLowerCase()
  // Claude Fable 5 and 4.6+ — Fable 5, Opus 4.6/4.7/4.8, Sonnet 4.6 have 1M windows
  if (m.includes('fable')) return 1_000_000
  if (m.includes('opus-4-8') || m.includes('opus-4-7') || m.includes('opus-4-6')) return 1_000_000
  if (m.includes('sonnet-4-6')) return 1_000_000
  // Claude 4.0–4.5 and Haiku — 200k
  if (m.includes('opus-4') || m.includes('sonnet-4')) return 200_000
  if (m.includes('haiku-4')) return 200_000
  // Claude 3.x
  if (m.includes('3-7-sonnet') || m.includes('3.7-sonnet')) return 200_000
  if (m.includes('3-5-sonnet') || m.includes('3.5-sonnet')) return 200_000
  if (m.includes('3-5-haiku') || m.includes('3.5-haiku')) return 200_000
  if (m.includes('opus') || m.includes('sonnet') || m.includes('haiku')) return 200_000
  // DeepSeek
  if (m.includes('deepseek-v4')) return 1_000_000
  // Xiaomi Mimo
  if (m.includes('mimo-v2.5')) return 1_000_000
  if (m.includes('mimo-v2')) return 256_000
  if (m.includes('mimo')) return 256_000
  // Kimi / Moonshot
  if (m.includes('kimi-k2')) return 262_144
  if (m.includes('moonshot-v1-128k')) return 131_072
  if (m.includes('moonshot-v1-32k')) return 32_768
  if (m.includes('moonshot-v1-8k')) return 8_192
  if (m.includes('moonshot')) return 131_072
  // MiniMax
  if (m.includes('minimax-m3')) return 1_000_000
  if (m.includes('minimax-m2')) return 200_000
  // Qwen Cloud
  if (m.includes('qwen3.7-max') || m.includes('qwen3.7-plus')) return 1_000_000
  if (m.includes('qwen3.6')) return 1_000_000
  if (m.includes('qwen3.5-plus') || m.includes('qwen3.5-flash')) return 1_000_000
  if (m.includes('qwen3-max') || m.includes('qwen3-coder')) return 131_072
  if (m.includes('qwen-max') || m.includes('qwen-plus')) return 131_072
  if (m.includes('qwen-turbo') || m.includes('qwen-flash')) return 131_072
  // Stepfun
  if (m.includes('step-3')) return 128_000
  if (m.includes('step-2-16k')) return 16_000
  if (m.includes('step-2')) return 128_000
  if (m.includes('step-1-200k')) return 200_000
  if (m.includes('step-1-128k')) return 128_000
  if (m.includes('step-1')) return 64_000
  // OpenRouter — model IDs are prefixed with provider slug (e.g. "anthropic/claude-…")
  // so the checks above for bare model names won't match. Catch the common ones here.
  if (m.includes('anthropic/claude')) return 200_000
  if (m.includes('openai/gpt-5') || m.includes('openai/gpt-4.1')) return 1_000_000
  if (m.includes('openai/gpt-4o')) return 128_000
  if (m.includes('openai/o3') || m.includes('openai/o4')) return 200_000
  if (m.includes('google/gemini-2')) return 1_000_000
  if (m.includes('deepseek/deepseek')) return 128_000
  if (m.includes('meta-llama/')) return 131_072
  if (m.includes('mistralai/')) return 131_072
  if (m.includes('qwen/')) return 131_072
  // xAI / Grok
  if (m.includes('grok-4.3') || m.includes('grok-4.20')) return 1_000_000
  if (m.includes('grok-build')) return 256_000
  if (m.includes('grok-4')) return 256_000
  if (m.includes('grok-3')) return 131_072
  if (m.includes('grok-2')) return 131_072
  // OpenAI
  if (m.includes('gpt-5.4') || m.includes('gpt-5.5')) return 1_000_000
  if (m.includes('gpt-5')) return 400_000
  if (m.includes('gpt-4.1')) return 1_000_000
  if (m.includes('gpt-4o')) return 128_000
  if (m.includes('gpt-4')) return 128_000
  if (m.includes('o1-mini')) return 128_000
  if (m.includes('o1')) return 128_000
  if (m.includes('o3') || m.includes('o4')) return 200_000
  if (m.includes('gpt-3.5')) return 16_000
  return 8_000
}

/**
 * Max output tokens (max_tokens / max_completion_tokens) that the provider
 * sends for a given model. Used by getContextBudget() to reserve space.
 * For Anthropic the input/output budgets are independent so this returns 0.
 */
function maxOutputForModel(model: string): number {
  const m = model.toLowerCase()
  // Anthropic — input and output windows are separate
  if (m.includes('opus-4') || m.includes('sonnet-4') || m.includes('haiku-4')) return 0
  if (m.includes('claude')) return 0
  if (/3\.[57]-(sonnet|haiku)/.test(m)) return 0
  // DeepSeek
  if (m.includes('deepseek-v4')) return 32_768
  // Xiaomi Mimo
  if (m.includes('mimo-v2.5-pro')) return 65_536
  if (m.includes('mimo')) return 32_768
  // Kimi / Moonshot
  if (m.includes('kimi-k2')) return 65_536
  if (m.includes('moonshot-v1-128k')) return 16_384
  if (m.includes('moonshot-v1-32k')) return 8_192
  if (m.includes('moonshot-v1-8k')) return 4_096
  if (m.includes('moonshot')) return 8_192
  // MiniMax
  if (m.includes('minimax-m3')) return 65_536
  if (m.includes('minimax-m2')) return 32_768
  // Qwen
  if (m.includes('qwen3.7') || m.includes('qwen3.6') || m.includes('qwen3.5')) return 65_536
  if (m.includes('qwen3')) return 32_768
  if (m.includes('qwen-plus')) return 32_768
  if (m.includes('qwen')) return 8_192
  // Stepfun
  if (m.includes('step-3')) return 32_768
  if (m.includes('step-2') || m.includes('step-1')) return 8_192
  // xAI / Grok
  if (m.includes('grok-4.3') || m.includes('grok-4.20')) return 65_536
  if (m.includes('grok-4') || m.includes('grok-build')) return 32_768
  if (m.includes('grok')) return 32_768
  // OpenAI
  if (m.includes('gpt-5')) return 65_536
  if (m.includes('gpt-4.1')) return 32_768
  if (m.includes('gpt-4o') || m.includes('gpt-4')) return 16_384
  if (m.includes('o1')) return 32_768
  if (m.includes('o3') || m.includes('o4')) return 65_536
  // OpenRouter prefixed models — match provider slug patterns
  if (m.includes('anthropic/')) return 0
  if (m.includes('openai/gpt-5')) return 65_536
  if (m.includes('openai/o3') || m.includes('openai/o4')) return 65_536
  if (m.includes('openai/gpt-4.1')) return 32_768
  if (m.includes('openai/gpt-4o')) return 16_384
  if (m.includes('deepseek/')) return 32_768
  if (m.includes('google/gemini')) return 65_536
  return 32_768
}

/**
 * Rough token estimate for a messages array. Uses the same 1-token ≈ 4-chars
 * heuristic as RAS.estimateTokens(). Accounts for all text content in
 * user, assistant, tool, and system messages plus base64 image payloads
 * (≈0.75 bytes per token after base64 overhead).
 */
export function estimateMessageTokens(messages: ChatMessage[]): number {
  let chars = 0
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
  return Math.ceil(chars / 4)
}

function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
