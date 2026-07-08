import { diskWriter } from '@main/io/diskWriter'
import { deliveredFilesReminder } from '@main/runtime/agent/delivered-files'
import type { BasalGanglia } from '@main/runtime/basalganglia'
import type { Cerebellum } from '@main/runtime/cerebellum'
import { COMPACTION_THRESHOLD } from '@main/runtime/compactor'
import type { Corpus } from '@main/runtime/corpus'
import { Cortex } from '@main/runtime/cortex'
import type { Device } from '@main/runtime/device'
import type { Hippocampus } from '@main/runtime/hippocampus'
import { OFFLINE_NOTICE } from '@main/runtime/outbound'
import {
  clampAssemblyBudget,
  DEFAULT_BUDGET_TOKENS,
  RAS,
  type ContextCandidate,
  type ContextCategory,
  type ScoredCandidate
} from '@main/runtime/ras'
import { reasoningModesFor } from '@main/runtime/reasoning'
import { contextWindowForModel, type ToolDefinition } from '@main/runtime/thalamus'
import { cloudModelSupportsVision } from '@main/runtime/vision'
import { readConfig } from '@main/workspace/workspace'
import fs from 'node:fs/promises'
import path from 'node:path'

export type PrefrontalOptions = {
  workspaceRoot: string
  episodeWindowDays?: number
  feedbackWindowDays?: number
  getContextBudget?: () => number
  getContextWindow?: () => number
  cortex?: Cortex
  ras?: RAS
  cerebellum?: Cerebellum
  hippocampus?: Hippocampus
  basalganglia?: BasalGanglia
  corpus?: Corpus
  device?: Device
}

export type Approach = 'direct-answer' | 'use-tools' | 'multi-step-task' | 'clarify'

export type Plan = {
  approach: Approach
  rationale: string
  toolHints: string[]
}

export type ContextBundle = {
  systemPrompt: string
  estimatedTokens: number
  sectionsIncluded: string[]
}

export type RuntimeContext = {
  iteration: number
  toolsCalled: number
  /**
   * When false, the live iteration counters are omitted from the
   * `<runtime>` block so the system prompt stays byte-stable across
   * tool-loop iterations (the counters travel in the outbound volatile
   * tail instead — see formatRuntimeStatus). Defaults to true, which
   * preserves the legacy in-prompt rendering.
   */
  renderCounters?: boolean
  /**
   * File names already delivered to the user this turn (auto-attached by a
   * tool). Travels with the per-iteration counters — rendered in the volatile
   * tail (optimized) or the `<runtime>` block (legacy), both after every cache
   * breakpoint — so it reinforces "don't re-send an already-delivered file"
   * without landing inside the cached history. Reset each turn by the caller.
   */
  deliveredFiles?: string[]
  /**
   * Host connectivity, sampled per iteration (Electron net.isOnline()). When
   * false, an explicit OFFLINE_NOTICE is rendered so the model doesn't burn
   * iterations on tools that need the internet and leans on offline tools
   * (memory recall, files, shell) instead. Travels the same vehicle as the
   * counters — volatile tail (optimized) or `<runtime>` block (legacy) — so
   * the online→offline flip never perturbs a cached prompt prefix. Undefined
   * or true renders nothing: online is the silent default.
   */
  online?: boolean
}

const ALWAYS_INCLUDED: Array<{ category: ContextCategory; rel: string; tag: string }> = [
  { category: 'identity', rel: 'brain/identity/soul.md', tag: 'soul' },
  { category: 'identity', rel: 'brain/identity/user.md', tag: 'user' },
  { category: 'prefrontal', rel: 'brain/prefrontal/agents.core.md', tag: 'agents-core' },
  { category: 'prefrontal', rel: 'brain/prefrontal/agents.md', tag: 'agents' }
]

const SECTION_ORDER: ContextCategory[] = ['identity', 'prefrontal', 'memory', 'skills', 'history']

/**
 * The delegation capability — planning/spawning/driving live subagents. It is
 * surfaced ONLY to a workflow master turn: a single-mode turn and an agent
 * turn never see it. Keeping it from agents is load-bearing — it holds the
 * agent tree flat (an agent can't spawn agents), so the registry stays one
 * finite source of truth with no await-stealing between concurrent consumers.
 */
const DELEGATION_CAPABILITIES: ReadonlySet<string> = new Set(['workflow'])

/**
 * Channel egress capabilities — the live messaging channels register their send
 * tools in-process under these names when connected (TELEGRAM_CAPABILITY_NAME /
 * WHATSAPP_CAPABILITY_NAME in src/main/channels/*\/tools.ts). Their sends hit
 * the channel API directly, so a worker holding them could message the user
 * out-of-band. Hard-coded here (not imported) to keep runtime decoupled from the
 * channel layer; the values are stable identifiers.
 */
const CHANNEL_CAPABILITIES: ReadonlySet<string> = new Set(['telegram', 'whatsapp'])

/**
 * Everything an agent role is denied on top of delegation: channel egress
 * stays master-only — an agent must never message the user directly; only the
 * master speaks (the single voice). The `ask` capability is also withheld: a
 * subagent's ask_user card can't anchor in the chat (its toolCallId never
 * reaches the renderer) and would park the agent on a question that can't be
 * answered — blockers belong in its report to the master.
 */
const AGENT_EXCLUDED_CAPABILITIES: ReadonlySet<string> = new Set([
  ...DELEGATION_CAPABILITIES,
  ...CHANNEL_CAPABILITIES,
  'ask'
])

// Self-qualifying overlay for locally-run models. Deliberately NOT a
// capability claim ("you are small") — a capable local 70B would be lied to,
// and any size-based branch would reintroduce the special-casing this
// replaced. One overlay, zero branching, full access.
const LOCAL_MODEL_PROMPT = `<local_model>
You are running as a locally-hosted model on the user's own machine. If a task exceeds what you can do reliably, say so plainly and suggest switching to a capable cloud model — hallucinating capability serves nobody. But if the user insists, comply fully: you have the same tools, memory, and context as any other model here, and nothing is withheld from you.
</local_model>`

// Channel formatting overlays, keyed by the turn's delivery channel (see
// AgentTurnOptions.channel). Appended when the turn's prose is delivered
// through a messaging channel whose renderer differs from the in-app chat.
// Keyed by hard-coded name — same decoupling rationale as
// CHANNEL_CAPABILITIES above. There is NO egress converter: the channels
// send the model's prose verbatim (Telegram with parse_mode HTML), so
// these overlays are the only thing standing between the model's habits
// and raw Markdown in the user's chat — the model IS the formatter.
const CHANNEL_PROMPTS: Readonly<Record<string, string>> = {
  whatsapp: `<channel>
You are talking with the user over WhatsApp: every prose reply you write is delivered VERBATIM as WhatsApp messages — there is no Markdown renderer and no converter between you and the user. WhatsApp does NOT render Markdown; write replies in WhatsApp's own text formatting and nothing else:
- *bold* (single asterisks), _italic_ (single underscores), ~strikethrough~ (single tildes), \`inline code\` (backticks), \`\`\`monospace block\`\`\` (triple backticks, no language tag).
- Lists: start a line with "- " for a bullet or "1. " for a numbered item. Quote: start the line with "> ".
- NEVER use Markdown syntax: no **double asterisks**, no # headings, no | tables |, no [text](url) links, no --- rules. Every leaked marker reaches the user as raw, ugly syntax. GOOD: *Flight details*\n_Gate 22_. BAD: **Flight details**\n| gate | 22 |.
- If a message contains any formatting, call whatsapp_check_format on the exact text FIRST and only send once it comes back clean.
- Instead of a heading, write a short *bold* line. Instead of a table, write one "*Label:* value" line per fact. For a link, paste the bare URL — WhatsApp makes it clickable.
- The same applies to everything you relay: tool results, file contents, and subagent reports are often Markdown — rewrite them in WhatsApp formatting before quoting them.
- Exception: to show an image inline you may embed ![description](wolffish-media://…) exactly as a tool result gave it to you — the channel replaces it with the actual image.
- ask_user questions, option labels, and option descriptions are rendered by the channel's own question card — write them as plain text with no formatting markers.
- Emojis render natively — use them naturally to aid scanning; a leading emoji on a *bold* line does a heading's job (✈️ *Flight details*).
- This is a phone chat: keep replies short and scannable. Prefer a few tight lines over long structured documents.
</channel>`,
  telegram: `<channel>
You are talking with the user over Telegram: every prose reply you write is delivered VERBATIM as Telegram messages sent with parse_mode HTML — there is no Markdown renderer and no converter between you and the user. Telegram does NOT render Markdown; write replies in Telegram's HTML subset and nothing else:
- Allowed tags: <b>bold</b>, <i>italic</i>, <u>underline</u>, <s>strikethrough</s>, <code>inline code</code>, <pre>multi-line code block</pre> (or <pre><code class="language-python">…</code></pre>), <a href="https://…">link</a>, <blockquote>quote</blockquote>, <span class="tg-spoiler">spoiler</span>.
- NO other tags exist: no <br> (use real newlines), no <p>, <ul>, <li>, <h1>, <table>, and NEVER wrap the message in a container tag like <message>/<html>. One unknown tag, unclosed tag, or bare < / & makes Telegram reject the ENTIRE message and it arrives as raw tag soup — write literal & as &amp;, < as &lt;, > as &gt;, in prose and inside <code>/<pre> alike, and close every tag you open. GOOD: <b>Digest</b>\ncost &lt;5. BAD: <b>Digest</b>…</message> (stray wrapper), line<br>line, cost < 5 & up (unescaped).
- If a message contains ANY HTML tag or literal < / &, call telegram_check_format on the exact text FIRST and only send once it returns valid — never guess.
- NEVER use Markdown syntax: no **bold**, no # headings, no | tables |, no [text](url), no --- rules. Every leaked marker reaches the user as raw, ugly syntax.
- Instead of a heading, write a short <b>bold</b> line. Instead of a table, write one "<b>Label:</b> value" line per fact. Lists are plain lines starting with "- " or "1. " (literal text is fine there).
- The same applies to everything you relay: tool results, file contents, and subagent reports are often Markdown — rewrite them in Telegram HTML before quoting them.
- Exception: to show an image inline you may embed ![description](wolffish-media://…) exactly as a tool result gave it to you — the channel replaces it with the actual image.
- ask_user questions, option labels, and option descriptions are rendered by the channel's own question card — write them as plain text with no HTML and no formatting markers.
- Emojis render natively — use them naturally to aid scanning; a leading emoji on a <b>bold</b> line does a heading's job (✈️ <b>Flight details</b>).
- This is a phone chat: keep replies short and scannable. Prefer a few tight lines over long structured documents.
</channel>`
}

// Non-sensitive config variables longer than this are previewed, not dumped
// verbatim, into the (RAS-bypassing) <variables> block. Generous enough that
// real values — URLs, names, IDs, keys — are never touched.
const VARIABLE_VALUE_MAX_CHARS = 400

// <workflow_models> caps: enough for a realistic multi-provider setup while
// keeping the master's overlay lean (the block is per-turn pinned prompt text).
const MODELS_BLOCK_PER_PROVIDER = 10
const MODELS_BLOCK_MAX_LINES = 40

const SECTION_TAGS: Record<ContextCategory, string> = {
  identity: 'identity',
  prefrontal: 'prefrontal',
  memory: 'memory',
  skills: 'skills',
  history: 'recent'
}

/**
 * Prefrontal handles executive function — planning, working memory, and
 * deciding what approach to take.
 *
 * Maps to: the prefrontal cortex — the front of the frontal lobes, the
 * part of the brain that takes the longest to mature and the first to
 * decline. It holds working memory, weighs trade-offs, suppresses
 * impulses, and assembles a plan before the motor cortex fires.
 *
 * In Wolffish, Prefrontal reads the workspace markdown (soul, user,
 * agents, tools, recent episodes), asks the cortex for relevant memories,
 * routes everything through the RAS for budget-aware filtering, and emits
 * the assembled system prompt the model will see. A debug snapshot of
 * every assembled prompt is written to brain/prefrontal/.debug/ so the
 * exact context can be inspected after the fact.
 */
export class Prefrontal {
  private cortex: Cortex | null
  private ras: RAS
  private cerebellum: Cerebellum | null
  private basalganglia: BasalGanglia | null
  private corpus: Corpus | null
  private device: Device | null

  constructor(private options: PrefrontalOptions) {
    this.cortex = options.cortex ?? null
    this.ras = options.ras ?? new RAS({ totalBudgetTokens: this.getTokenBudget() })
    this.cerebellum = options.cerebellum ?? null
    this.basalganglia = options.basalganglia ?? null
    this.corpus = options.corpus ?? null
    this.device = options.device ?? null
  }

  async buildSystemPrompt(
    message = '',
    runtime?: RuntimeContext,
    role?: 'master' | 'agent',
    opts?: {
      /**
       * True when the resolved model runs locally. Adds the self-qualifying
       * honesty overlay — prompt text, never divergent assembly: a local
       * model gets the same context, tools, and memory as any cloud model.
       */
      localModel?: boolean
      channel?: string
      conversationId?: string | null
    }
  ): Promise<string> {
    const bundle = await this.buildContext(message, runtime, role, opts)
    const blocks = [
      bundle.systemPrompt,
      await this.buildRoleBlock(role),
      opts?.localModel ? LOCAL_MODEL_PROMPT : '',
      opts?.channel ? (CHANNEL_PROMPTS[opts.channel] ?? '') : ''
    ].filter((b) => b && b.length > 0)
    return blocks.join('\n\n')
  }

  /**
   * Role overlay for workflow mode, appended after the assembled prompt. A
   * master gets the workflow doctrine (it designs and drives the run) plus
   * the live model catalog for per-agent choices; an agent gets the subagent
   * framing (bounded task, reports to the master, never the user). A
   * single-mode turn (no role) gets nothing.
   */
  private async buildRoleBlock(role?: 'master' | 'agent'): Promise<string> {
    if (role === 'master') {
      const md = (await this.readFile('brain/identity/workflow.md'))?.trim() ?? ''
      const models = await this.workflowModelsBlock()
      return models ? `${md}\n\n${models}` : md
    }
    if (role === 'agent') {
      return (await this.readFile('brain/identity/workflow-agent.md'))?.trim() ?? ''
    }
    return ''
  }

  /**
   * Tell the master exactly which models it can spawn agents on — the
   * connected providers' validated catalogs, each with its reasoning efforts,
   * context window and vision support — so per-agent model choice is informed,
   * not blind. (The thalamus also clamps an out-of-range effort and rejects an
   * unconnected provider at the seam, so this is guidance, not a hard guard.)
   * Capped per provider to keep the overlay lean; rebuilt with the turn pin,
   * so it is byte-stable across iterations.
   */
  private async workflowModelsBlock(): Promise<string> {
    const cfg = await readConfig().catch(() => null)
    if (!cfg) return ''
    const connected = cfg.llm.providers.filter((p) => p.apiKey)
    if (connected.length === 0) return ''
    const brain = cfg.llm.brain
    const lines: string[] = []
    for (const p of connected) {
      const models = (p.models ?? []).filter(Boolean).slice(0, MODELS_BLOCK_PER_PROVIDER)
      // A provider with an empty cached catalog still has its saved model.
      if (models.length === 0 && p.model) models.push(p.model)
      for (const m of models) {
        const openrouterReasoning =
          p.id === 'openrouter' ? (p.reasoningModels?.includes(m) ?? false) : false
        const modes = reasoningModesFor(p.id, m, { openrouterReasoning })
        const traits: string[] = []
        traits.push(`~${Math.round(contextWindowForModel(m) / 1000)}k ctx`)
        if (modes.length > 0) traits.push(`effort: ${modes.join('/')}`)
        if (cloudModelSupportsVision(p.id, m)) traits.push('vision')
        const isBrain = brain && brain.providerId === p.id && brain.model === m
        lines.push(`- ${p.id}/${m} (${traits.join(', ')})${isBrain ? ' ← your own model' : ''}`)
      }
    }
    if (lines.length === 0) return ''
    return `<workflow_models>\nModels you can run agents on — pass agent_spawn's \`model\` exactly as listed (\`provider/model-id\`), or omit it to run the agent on your own model. Match the model to the slice: frontier models for hard reasoning, cheaper/faster ones for mechanical work. Default to models from YOUR OWN provider's family (yours is marked below); pick another family only when the slice clearly benefits from it.\n${lines.slice(0, MODELS_BLOCK_MAX_LINES).join('\n')}\n</workflow_models>`
  }

  /**
   * The capabilities a given role must NOT see. A master gets everything
   * (incl. delegation); an agent loses delegation, channel egress AND ask; a
   * single-mode turn loses only delegation. Used for BOTH the API tool array
   * (`getToolDefinitions`) and the `<capabilities>` prompt block so the two
   * never drift — an agent shouldn't read about tools it can't call.
   */
  private excludedCapabilitiesFor(role?: 'master' | 'agent'): ReadonlySet<string> | undefined {
    return role === 'master'
      ? undefined
      : role === 'agent'
        ? AGENT_EXCLUDED_CAPABILITIES
        : DELEGATION_CAPABILITIES
  }

  selectTools(role?: 'master' | 'agent', conversationId?: string | null): ToolDefinition[] {
    return (
      this.cerebellum?.getToolDefinitions(this.excludedCapabilitiesFor(role), {
        conversationId: conversationId ?? null
      }) ?? []
    )
  }

  /**
   * Score candidates, fit them into the budget, and assemble the final
   * system prompt. Writes a debug snapshot and emits `context.built`.
   * If `runtime` is supplied, a `<runtime>` block reporting the live
   * iteration counter is appended last so the model can see its own
   * loop position.
   */
  async buildContext(
    message = '',
    runtime?: RuntimeContext,
    role?: 'master' | 'agent',
    opts?: { localModel?: boolean; conversationId?: string | null }
  ): Promise<ContextBundle> {
    // LEAN BY DESIGN: the prompt carries the essentials only — identity, the
    // behavioral contract, device facts, the learned-preferences digest, a
    // "what memory exists" map, and a one-line-per-capability index. No
    // memory dumps, no episode dumps, no tool catalogs: everything else is
    // indexed on disk and retrieved surgically (memory_search / tool_search)
    // when the turn actually needs it.
    //
    // An agent runs a bounded, self-contained task the master composed — it
    // additionally skips the preferences digest and the memory map (those are
    // about the live user thread, not the agent's slice).
    const lean = role === 'agent'
    const conversationId = opts?.conversationId ?? null
    // Assemble against a clamped budget, not the raw model window — the guard
    // that keeps a pathological candidate from ever ballooning the prompt.
    const budget = this.ras.allocateBudget(clampAssemblyBudget(this.getTokenBudget()))
    const candidates: ContextCandidate[] = []
    const includedPaths = new Set<string>()

    for (const entry of ALWAYS_INCLUDED) {
      const content = await this.readFile(entry.rel)
      if (content) {
        candidates.push({ category: entry.category, source: entry.rel, content })
        includedPaths.add(entry.rel)
      }
    }

    if (!lean) {
      // The one ambient memory that stays: the bounded learned-preferences
      // digest (~500 tokens). Checking preferences must not cost a retrieval
      // round-trip on every task.
      const feedbackCandidate = await this.collectFeedbackCandidate(
        this.options.feedbackWindowDays ?? 7
      )
      if (feedbackCandidate && !includedPaths.has(feedbackCandidate.source)) {
        candidates.push(feedbackCandidate)
        includedPaths.add(feedbackCandidate.source)
      }
    }

    const filtered = this.ras.filterContext(message, candidates, budget)
    const grouped = groupByCategory(filtered)

    const sections: string[] = []
    const sectionsIncluded: string[] = []

    // Device facts bypass RAS — they're universally relevant for any
    // tool call (correct shell syntax, correct paths, resource limits).
    const deviceBody = this.device ? await this.device.getBlockBody().catch(() => '') : ''

    for (const category of SECTION_ORDER) {
      const items = grouped.get(category) ?? []
      if (items.length > 0) {
        const body = items.map((it) => formatItem(it)).join('\n\n')
        sections.push(this.wrap(SECTION_TAGS[category], body))
        sectionsIncluded.push(category)
      }

      // Device facts sit right after <identity> so the model reads
      // "who I am, then where I am".
      if (category === 'identity' && deviceBody.length > 0) {
        sections.push(this.wrap('device', deviceBody))
        sectionsIncluded.push('device')
      }

      // User-defined variables from config.json sit right after <device>.
      // Sensitive values are passed in plaintext so the agent can use them
      // in tool calls.
      if (category === 'identity') {
        const variablesBody = await this.collectVariablesBlock()
        if (variablesBody.length > 0) {
          sections.push(this.wrap('variables', variablesBody))
          sectionsIncluded.push('variables')
        }
      }

      if (category === 'prefrontal') {
        // The capability INDEX — one line per capability, no schemas. The
        // model always knows what exists; tool_search loads what a turn
        // needs. Full schemas ship only for the core + activated set (the
        // native tools param, selected in lockstep via selectTools).
        const indexBody =
          this.cerebellum
            ?.getCapabilityIndex(this.excludedCapabilitiesFor(role), conversationId)
            .trim() ?? ''
        if (indexBody.length > 0) {
          sections.push(
            this.wrap(
              'capabilities',
              `Installed capabilities ([loaded] = callable right now; anything else is one tool_search/tool_activate away):\n${indexBody}`
            )
          )
          sectionsIncluded.push('capabilities')
        }

        // The memory map: a byte-stable-per-day coverage stub telling the
        // model WHAT exists to be recalled — never the content itself.
        if (!lean) {
          const memoryMap = await this.buildMemoryMap()
          if (memoryMap.length > 0) {
            sections.push(this.wrap('memory_map', memoryMap))
            sectionsIncluded.push('memory_map')
          }
        }
      }
    }

    if (runtime) {
      sections.push(this.wrap('runtime', formatRuntimeBody(runtime)))
      sectionsIncluded.push('runtime')
    }

    const systemPrompt = sections.join('\n\n')
    const estimatedTokens = this.ras.estimateTokens(systemPrompt)

    if (this.corpus) {
      this.corpus.emit('context.built', {
        tokenCount: estimatedTokens,
        // The model's FULL context window — a 1M model reads 1M on the meter.
        // (Compaction enforces against getTokenBudget(), the window minus the
        // output reserve; the meter deliberately shows the headline window
        // because that's the number the user knows their model by.)
        tokenBudget: this.getContextWindow(),
        // Where auto-compaction actually triggers, in the same token units as
        // tokenBudget — the meter draws this as a tick so the visible % and
        // the compaction trigger stop being two unrelated denominators.
        compactionAt: Math.floor(this.getTokenBudget() * COMPACTION_THRESHOLD),
        sectionsIncluded
      })
    }

    await this.writeDebugSnapshot({
      message,
      systemPrompt,
      estimatedTokens,
      sectionsIncluded,
      filtered
    })

    return { systemPrompt, estimatedTokens, sectionsIncluded }
  }

  /**
   * Choose how to handle the user's message. Phase 2 will read the
   * thalamus classification and basal-ganglia preferences to pick the
   * right approach.
   */
  // plan(_message: string): Plan {
  //   throw new Error('Prefrontal.plan not implemented — Phase 2')
  // }

  /**
   * Total tokens available for context this turn. Phase 2 will subtract
   * what the model needs to generate from the model's max-context.
   */
  getTokenBudget(): number {
    return this.options.getContextBudget?.() ?? DEFAULT_BUDGET_TOKENS
  }

  getContextWindow(): number {
    return this.options.getContextWindow?.() ?? this.getTokenBudget()
  }

  /**
   * The `<memory_map>` stub: a coverage MAP of everything recallable — never
   * the content. Byte-stable per calendar day (cached) so it doesn't churn
   * the provider prompt-cache prefix between turns: counts are rounded to
   * coarse buckets and the whole string regenerates once per day.
   */
  private memoryMapCache: { day: string; body: string } | null = null

  private async buildMemoryMap(): Promise<string> {
    const day = new Date().toISOString().slice(0, 10)
    if (this.memoryMapCache?.day === day) return this.memoryMapCache.body
    if (!this.cortex) return ''

    let body = ''
    try {
      const cov = this.cortex.coverage()
      const round = (n: number): string =>
        n < 20 ? String(n) : n < 200 ? `~${Math.round(n / 10) * 10}` : `~${Math.round(n / 50) * 50}`
      const lines: string[] = [
        'Everything you have ever done, said, produced, or spent is indexed on disk — this is the coverage map, NOT the content. It is never evidence of absence: memory_search (2-3 phrasings) before concluding something was not recorded.'
      ]
      for (const s of cov.recordsBySource) {
        const range = s.minDate && s.maxDate ? ` (${s.minDate} → ${s.maxDate})` : ''
        lines.push(`- ${s.source}: ${round(s.count)} records${range}`)
      }
      lines.push(
        `- conversations on disk: ${round(cov.conversations)} (conversation_list / conversation_read)`
      )
      lines.push(
        `- generated/uploaded files: ${round(cov.artifacts)} (memory_search sources: artifact)`
      )

      // Long-term knowledge topics (## headers of the five curated files) —
      // tiny, and they tell the model what durable facts exist to be fetched.
      const topics: string[] = []
      for (const file of ['projects', 'people', 'preferences', 'technical', 'decisions']) {
        const raw = await this.readFile(`brain/hippocampus/knowledge/${file}.md`)
        if (!raw) continue
        const headers = [...raw.matchAll(/^##\s+(.+\S)\s*$/gm)].map((m) => m[1]).slice(0, 8)
        if (headers.length > 0) topics.push(`${file}: ${headers.join(', ')}`)
      }
      if (topics.length > 0) {
        lines.push(`- knowledge topics — ${topics.join(' | ')} (memory_get the file for details)`)
      }
      body = lines.join('\n')
    } catch {
      body = ''
    }
    this.memoryMapCache = { day, body }
    return body
  }

  private async collectFeedbackCandidate(windowDays: number): Promise<ContextCandidate | null> {
    if (!this.basalganglia) return null
    const content = await this.basalganglia.getPreferences(windowDays).catch(() => '')
    if (!content || content.trim().length === 0) return null
    // Mandatory (prefrontal) so the synthesized habit digest is always present
    // — it's tiny and represents standing behavioural guidance, not a
    // query-dependent memory. The source label is deliberately not a real path
    // (the digest is synthesized, not a file the model should try to read).
    return {
      category: 'prefrontal',
      source: 'synthesized: learned preferences',
      content
    }
  }

  private async collectVariablesBlock(): Promise<string> {
    try {
      const config = await readConfig()
      const vars = config?.variables ?? []
      if (vars.length === 0) return ''
      // This block bypasses RAS, so an oversized pasted value (a JSON blob, a
      // cert) would land in the prefix uncapped on every turn — the same
      // unbounded-source failure mode this work hardened elsewhere. Cap
      // non-sensitive values; keep sensitive ones whole so the agent can still
      // use a secret verbatim in a tool call (keys are short anyway).
      const lines = vars.map((v) => {
        const value =
          v.sensitive || v.value.length <= VARIABLE_VALUE_MAX_CHARS
            ? v.value
            : `${v.value.slice(0, VARIABLE_VALUE_MAX_CHARS).trimEnd()}… (${v.value.length} chars; read config.json for the full value)`
        return `- ${v.name} = ${value}${v.sensitive ? ' (sensitive)' : ''}`
      })
      return [
        'The user has defined the following variables in Settings > Variables.',
        'Use these values when the user references them or when a task requires them.',
        'These are the single source of truth — never ask the user to re-enter a value that exists here.',
        'If the user shares a secret or API key in chat and asks you to save it, write it to config.json under the variables array using file_write so it appears in the Variables UI.',
        '',
        ...lines
      ].join('\n')
    } catch {
      return ''
    }
  }

  private async readFile(relPath: string): Promise<string | null> {
    try {
      const raw = await fs.readFile(path.join(this.options.workspaceRoot, relPath), 'utf8')
      // Strip HTML comments so workspace files can carry author-facing
      // instructions (<!-- ... -->) without burning context tokens.
      const content = raw.replace(/<!--[\s\S]*?-->/g, '').trim()
      return content.length > 0 ? content : null
    } catch {
      return null
    }
  }

  private async writeDebugSnapshot(args: {
    message: string
    systemPrompt: string
    estimatedTokens: number
    sectionsIncluded: string[]
    filtered: ScoredCandidate[]
  }): Promise<void> {
    const dir = path.join(this.options.workspaceRoot, 'brain', 'prefrontal', '.debug')
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch {
      return
    }
    const stamp = formatStamp(new Date())
    const filename = `${stamp}.md`
    await pruneDebugSnapshots(dir)
    const sourceList = args.filtered
      .map((it) => `- (${it.category}, score=${it.score.toFixed(2)}, ~${it.tokens}t) ${it.source}`)
      .join('\n')
    const header = [
      `# Prefrontal context snapshot`,
      ``,
      `- timestamp: ${new Date().toISOString()}`,
      `- estimated tokens: ${args.estimatedTokens}`,
      `- budget: ${this.getTokenBudget()}`,
      `- sections: ${args.sectionsIncluded.join(', ') || '(none)'}`,
      ``,
      `## message`,
      ``,
      args.message || '(empty)',
      ``,
      `## sources`,
      ``,
      sourceList || '(none)',
      ``,
      `## prompt`,
      ``,
      args.systemPrompt,
      ''
    ].join('\n')
    try {
      await diskWriter.writeFileAtomic(path.join(dir, filename), header)
    } catch {
      // best-effort: snapshot failure must not block a turn
    }
  }

  private wrap(tag: string, body: string): string {
    return `<${tag}>\n${body}\n</${tag}>`
  }
}

function formatItem(item: ScoredCandidate): string {
  return `<source path="${item.source}">\n${item.content}\n</source>`
}

function formatRuntimeBody(runtime: RuntimeContext | undefined): string {
  // The batch-every-item doctrine that used to ride here unconditionally
  // lives in the core contract (agents.core.md "Loop discipline") now — the
  // runtime block carries only live counters, and only on the legacy path.
  const lines: string[] = []
  if (runtime && runtime.renderCounters !== false) {
    lines.push(`  Tool iteration this turn: ${runtime.iteration}`)
    lines.push(`  Tools called this turn: ${runtime.toolsCalled}`)
    // Gated on renderCounters (legacy path only) — in the optimized path the
    // prompt is pinned, so this per-turn fact rides the volatile tail via
    // formatRuntimeStatus instead, never touching the cached prefix.
    const delivered = deliveredFilesReminder(runtime.deliveredFiles ?? [])
    if (delivered) lines.push(`  ${delivered}`)
    // Same vehicle rule as the counters: legacy rebuilds the prompt each
    // iteration so the notice lives here; optimized pins the prompt and the
    // notice rides the volatile tail instead.
    if (runtime.online === false) lines.push(`  ${OFFLINE_NOTICE}`)
  }
  return lines.join('\n')
}

function groupByCategory(items: ScoredCandidate[]): Map<ContextCategory, ScoredCandidate[]> {
  const map = new Map<ContextCategory, ScoredCandidate[]>()
  for (const item of items) {
    const list = map.get(item.category) ?? []
    list.push(item)
    map.set(item.category, list)
  }
  return map
}

function formatStamp(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}.${ms}`
}

/** Keep at most this many prompt snapshots in brain/prefrontal/.debug. */
const SNAPSHOT_KEEP = 50
/** Only pay the readdir once the dir has clearly outgrown the cap. */
const SNAPSHOT_PRUNE_SLACK = 10

/**
 * Cap .debug snapshot growth. Snapshot filenames are sortable timestamps, so
 * lexicographic order IS chronological order — delete the oldest overflow.
 * One snapshot lands per context build (hourly heartbeats alone add ~180KB
 * each); without pruning the dir grew unbounded (83MB in 18 days observed).
 */
async function pruneDebugSnapshots(dir: string): Promise<void> {
  let names: string[]
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith('.md'))
  } catch {
    return
  }
  if (names.length < SNAPSHOT_KEEP + SNAPSHOT_PRUNE_SLACK) return
  names.sort()
  const excess = names.slice(0, names.length - SNAPSHOT_KEEP)
  for (const name of excess) {
    try {
      await fs.unlink(path.join(dir, name))
    } catch {
      // best-effort: pruning must never block a turn
    }
  }
}
