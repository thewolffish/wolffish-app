import { diskWriter } from '@main/io/diskWriter'
import { deliveredFilesReminder } from '@main/runtime/agent/delivered-files'
import type { BasalGanglia } from '@main/runtime/basalganglia'
import type { Cerebellum } from '@main/runtime/cerebellum'
import type { Corpus } from '@main/runtime/corpus'
import { Cortex } from '@main/runtime/cortex'
import type { Device } from '@main/runtime/device'
import type { Hippocampus } from '@main/runtime/hippocampus'
import {
  clampAssemblyBudget,
  DEFAULT_BUDGET_TOKENS,
  RAS,
  type ContextCandidate,
  type ContextCategory,
  type ScoredCandidate
} from '@main/runtime/ras'
import { reasoningModesFor } from '@main/runtime/reasoning'
import type { ToolDefinition } from '@main/runtime/thalamus'
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
}

const ALWAYS_INCLUDED: Array<{ category: ContextCategory; rel: string; tag: string }> = [
  { category: 'identity', rel: 'brain/identity/soul.md', tag: 'soul' },
  { category: 'identity', rel: 'brain/identity/user.md', tag: 'user' },
  { category: 'prefrontal', rel: 'brain/prefrontal/agents.core.md', tag: 'agents-core' },
  { category: 'prefrontal', rel: 'brain/prefrontal/agents.md', tag: 'agents' }
]

const SECTION_ORDER: ContextCategory[] = ['identity', 'prefrontal', 'memory', 'skills', 'history']

/**
 * The delegation capability — spawning/driving live workers. It is surfaced ONLY
 * to an orchestrator turn: a single-mode turn and a worker turn never see it.
 * Keeping it from workers is load-bearing — it holds the worker tree flat (a
 * worker can't spawn workers), so the registry stays one finite source of truth.
 */
const DELEGATION_CAPABILITIES: ReadonlySet<string> = new Set(['orchestrator'])

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
 * Everything a worker role is denied on top of delegation: channel egress stays
 * orchestrator-only — a worker must never message the user directly; only the
 * orchestrator speaks (the single voice).
 */
const WORKER_EXCLUDED_CAPABILITIES: ReadonlySet<string> = new Set([
  ...DELEGATION_CAPABILITIES,
  ...CHANNEL_CAPABILITIES
])

// Behavior overlays appended to the system prompt when the matching Brain toggle
// is on (config.llm.greedy / autonomous). Default = neither → no change.
const GREEDY_PROMPT = `<effort_mode>
Greedy effort is ON. Persistence outranks speed and cost on this turn:
- Don't stop at the first sign of trouble. If an approach fails, try another, then another — where you'd normally give up after ~3 attempts, push to ~10.
- Don't settle on a single strategy. Explore several genuinely different approaches (aim for ~5) before concluding something can't be done.
- Disregard token budget and elapsed time completely. Going the extra mile to actually finish the job, and finish it well, is always worth it here.
- Verify your work and push past "good enough" to genuinely complete and correct.
</effort_mode>`

// Self-qualifying overlay for locally-run models. Deliberately NOT a
// capability claim ("you are small") — a capable local 70B would be lied to,
// and any size-based branch would reintroduce the special-casing this
// replaced. One overlay, zero branching, full access.
const LOCAL_MODEL_PROMPT = `<local_model>
You are running as a locally-hosted model on the user's own machine. If a task exceeds what you can do reliably, say so plainly and suggest switching to a capable cloud model — hallucinating capability serves nobody. But if the user insists, comply fully: you have the same tools, memory, and context as any other model here, and nothing is withheld from you.
</local_model>`

const AUTONOMOUS_PROMPT = `<autonomy_mode>
Autonomy is ON. Act with high agency and minimal hand-holding:
- Ask the user as little as possible — ideally nothing. Make reasonable assumptions and decide for yourself instead of stopping to ask.
- Default to action: when a step is clearly needed to reach the goal, just do it rather than proposing it and waiting for approval.
- Drive the task end-to-end to the best possible outcome on your own. Only surface to the user for genuine blockers you truly cannot resolve.
</autonomy_mode>`

// Channel formatting overlays, keyed by the turn's delivery channel (see
// AgentTurnOptions.channel). Appended when the turn's prose is delivered
// through a messaging channel whose renderer differs from the in-app chat.
// Keyed by hard-coded name — same decoupling rationale as
// CHANNEL_CAPABILITIES above. The WhatsApp channel also converts leaked
// Markdown at egress (channels/whatsapp/format.ts), but a converter can't
// un-design a table or a heading-structured document — the model has to
// write for the medium in the first place; the converter is the backstop.
const CHANNEL_PROMPTS: Readonly<Record<string, string>> = {
  whatsapp: `<channel>
You are talking with the user over WhatsApp: every prose reply you write is delivered as WhatsApp messages. WhatsApp does NOT render Markdown — write replies in WhatsApp's own text formatting and nothing else:
- *bold* (single asterisks), _italic_ (single underscores), ~strikethrough~ (single tildes), \`inline code\` (backticks), \`\`\`monospace block\`\`\` (triple backticks, no language tag).
- Lists: start a line with "- " for a bullet or "1. " for a numbered item. Quote: start the line with "> ".
- NEVER use Markdown syntax: no **double asterisks**, no # headings, no | tables |, no [text](url) links, no --- rules.
- Instead of a heading, write a short *bold* line. Instead of a table, write one "*Label:* value" line per fact. For a link, paste the bare URL — WhatsApp makes it clickable.
- This is a phone chat: keep replies short and scannable. Prefer a few tight lines over long structured documents.
</channel>`
}

// Non-sensitive config variables longer than this are previewed, not dumped
// verbatim, into the (RAS-bypassing) <variables> block. Generous enough that
// real values — URLs, names, IDs, keys — are never touched.
const VARIABLE_VALUE_MAX_CHARS = 400

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
    role?: 'orchestrator' | 'worker',
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
      await this.buildBehaviorBlock(),
      opts?.localModel ? LOCAL_MODEL_PROMPT : '',
      opts?.channel ? (CHANNEL_PROMPTS[opts.channel] ?? '') : ''
    ].filter((b) => b && b.length > 0)
    return blocks.join('\n\n')
  }

  /**
   * Behavior overlay driven by the Brain settings toggles (config.llm.greedy /
   * autonomous), appended to the prompt. Off by default → nothing added. Applies
   * to every turn (single, orchestrator, worker). Read from config at build time
   * so a toggle change takes effect on the next turn.
   */
  private async buildBehaviorBlock(): Promise<string> {
    const cfg = await readConfig().catch(() => null)
    const parts: string[] = []
    if (cfg?.llm.greedy) parts.push(GREEDY_PROMPT)
    if (cfg?.llm.autonomous) parts.push(AUTONOMOUS_PROMPT)
    return parts.join('\n\n')
  }

  /**
   * Role overlay for orchestrator mode (Phase 2), appended after the assembled
   * prompt. An orchestrator gets the delegation playbook (it drives live
   * workers); a worker gets the worker framing (bounded task, reports to the
   * orchestrator, never the user). A single-mode turn (no role) gets nothing —
   * the Phase-1 prompt, untouched.
   */
  private async buildRoleBlock(role?: 'orchestrator' | 'worker'): Promise<string> {
    if (role === 'orchestrator') {
      const md = (await this.readFile('brain/identity/orchestrator.md'))?.trim() ?? ''
      const efforts = await this.workerReasoningBlock()
      return efforts ? `${md}\n\n${efforts}` : md
    }
    if (role === 'worker') return (await this.readFile('brain/identity/worker.md'))?.trim() ?? ''
    return ''
  }

  /**
   * Tell the orchestrator exactly which reasoning efforts ITS worker model
   * supports — models differ widely (none / always-on / graded), and the
   * orchestrator otherwise picks `effort` blind. (The thalamus also clamps an
   * out-of-range pick at the seam, so this is guidance, not a hard guard.)
   */
  private async workerReasoningBlock(): Promise<string> {
    const cfg = await readConfig().catch(() => null)
    const w = cfg?.llm.workerModel
    if (!w) return ''
    const openrouterReasoning =
      w.providerId === 'openrouter'
        ? (cfg?.llm.providers
            .find((p) => p.id === 'openrouter')
            ?.reasoningModels?.includes(w.model) ?? false)
        : false
    const modes = reasoningModesFor(w.providerId, w.model, { openrouterReasoning })
    if (modes.length === 0) {
      return `<worker_reasoning>\nYour worker model (\`${w.model}\`) has no adjustable reasoning — spawn_worker's \`effort\` argument has no effect for it, so omit it.\n</worker_reasoning>`
    }
    const list = modes.map((m) => `\`${m}\``).join(', ')
    return `<worker_reasoning>\nYour worker model is \`${w.model}\`. The only reasoning efforts it supports are: ${list}. Pass spawn_worker's \`effort\` from this set (a higher value is automatically clamped down to the model's max).\n</worker_reasoning>`
  }

  /**
   * Pick the tools the LLM gets to see for this iteration. Role-gated:
   * - `orchestrator` → the full list, delegation included.
   * - `worker` → full minus delegation minus channel egress (flat tree, no
   *   direct user contact).
   * - default (single-mode turn) → full minus delegation (no live workers
   *   without an orchestrator to own them).
   */
  /**
   * The capabilities a given role must NOT see. Orchestrator gets everything
   * (incl. delegation); a worker loses delegation AND channel egress; single
   * mode loses only delegation. Used for BOTH the API tool array
   * (`getToolDefinitions`) and the `<tools>` prompt-text block so the two never
   * drift — a worker shouldn't read about tools it can't call.
   */
  private excludedCapabilitiesFor(
    role?: 'orchestrator' | 'worker'
  ): ReadonlySet<string> | undefined {
    return role === 'orchestrator'
      ? undefined
      : role === 'worker'
        ? WORKER_EXCLUDED_CAPABILITIES
        : DELEGATION_CAPABILITIES
  }

  selectTools(role?: 'orchestrator' | 'worker', conversationId?: string | null): ToolDefinition[] {
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
    role?: 'orchestrator' | 'worker',
    opts?: { localModel?: boolean; conversationId?: string | null }
  ): Promise<ContextBundle> {
    // LEAN BY DESIGN: the prompt carries the essentials only — identity, the
    // behavioral contract, device facts, the learned-preferences digest, a
    // "what memory exists" map, and a one-line-per-capability index. No
    // memory dumps, no episode dumps, no tool catalogs: everything else is
    // indexed on disk and retrieved surgically (memory_search / tool_search)
    // when the turn actually needs it.
    //
    // A worker runs a bounded, self-contained task the orchestrator composed —
    // it additionally skips the preferences digest and the memory map (those
    // are about the live user thread, not the worker's slice).
    const lean = role === 'worker'
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
