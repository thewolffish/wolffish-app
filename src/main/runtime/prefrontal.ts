import { diskWriter } from '@main/io/diskWriter'
import type { BasalGanglia } from '@main/runtime/basalganglia'
import type { Cerebellum } from '@main/runtime/cerebellum'
import type { Corpus } from '@main/runtime/corpus'
import { Cortex, type CortexSearchResult } from '@main/runtime/cortex'
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

const AUTONOMOUS_PROMPT = `<autonomy_mode>
Autonomy is ON. Act with high agency and minimal hand-holding:
- Ask the user as little as possible — ideally nothing. Make reasonable assumptions and decide for yourself instead of stopping to ask.
- Default to action: when a step is clearly needed to reach the goal, just do it rather than proposing it and waiting for approval.
- Drive the task end-to-end to the best possible outcome on your own. Only surface to the user for genuine blockers you truly cannot resolve.
</autonomy_mode>`

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
  private hippocampus: Hippocampus | null
  private basalganglia: BasalGanglia | null
  private corpus: Corpus | null
  private device: Device | null

  constructor(private options: PrefrontalOptions) {
    this.cortex = options.cortex ?? null
    this.ras = options.ras ?? new RAS({ totalBudgetTokens: this.getTokenBudget() })
    this.cerebellum = options.cerebellum ?? null
    this.hippocampus = options.hippocampus ?? null
    this.basalganglia = options.basalganglia ?? null
    this.corpus = options.corpus ?? null
    this.device = options.device ?? null
  }

  async buildSystemPrompt(
    message = '',
    runtime?: RuntimeContext,
    role?: 'orchestrator' | 'worker',
    opts?: { omitTools?: boolean; stateless?: boolean }
  ): Promise<string> {
    const bundle = await this.buildContext(message, runtime, role, opts)
    const blocks = [
      bundle.systemPrompt,
      await this.buildRoleBlock(role),
      await this.buildBehaviorBlock()
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

  selectTools(role?: 'orchestrator' | 'worker'): ToolDefinition[] {
    return this.cerebellum?.getToolDefinitions(this.excludedCapabilitiesFor(role)) ?? []
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
    opts?: { omitTools?: boolean; stateless?: boolean }
  ): Promise<ContextBundle> {
    // A worker runs a bounded, self-contained task the orchestrator composed —
    // it doesn't need the user's stored memory, learned feedback, conversation
    // history, or keyword-injected skill bodies (those are about the live user
    // thread, not the worker's slice). Skipping them keeps the worker prompt
    // lean (it was ~42k tokens, mostly irrelevant) and far cheaper, while
    // KEEPING what tool work needs: identity, agent procedures, device facts,
    // variables, and the tool definitions.
    // Stateless mode (local chatbot) is leaner than a worker: identity only —
    // no agent procedures, no memory/history/skills, no tools — so a local
    // model answers like a plain LLM with minimal prompt and no context bloat.
    const stateless = opts?.stateless === true
    const lean = role === 'worker' || stateless
    // Assemble against a clamped budget, not the raw model window. A 200k–1M
    // window is for the live conversation, not a system prompt that gets
    // rebuilt every iteration — capping it here is what keeps the prompt lean
    // and its prefix stable enough for the provider to cache.
    const budget = this.ras.allocateBudget(clampAssemblyBudget(this.getTokenBudget()))
    const candidates: ContextCandidate[] = []
    const includedPaths = new Set<string>()

    for (const entry of ALWAYS_INCLUDED) {
      // Stateless keeps only identity (soul/user) — drop the agent operating
      // manual (the `prefrontal` category) so the model isn't steered agentic.
      if (stateless && entry.category !== 'identity') continue
      const content = await this.readFile(entry.rel)
      if (content) {
        candidates.push({ category: entry.category, source: entry.rel, content })
        includedPaths.add(entry.rel)
      }
    }

    if (!lean) {
      const memoryCandidates = await this.collectMemoryCandidates(message, includedPaths)
      for (const c of memoryCandidates) {
        candidates.push(c)
        includedPaths.add(c.source)
      }

      const feedbackCandidate = await this.collectFeedbackCandidate(
        this.options.feedbackWindowDays ?? 7
      )
      if (feedbackCandidate && !includedPaths.has(feedbackCandidate.source)) {
        candidates.push(feedbackCandidate)
        includedPaths.add(feedbackCandidate.source)
      }

      const historyCandidates = await this.collectRecentEpisodes(
        this.options.episodeWindowDays ?? 2
      )
      for (const c of historyCandidates) {
        if (includedPaths.has(c.source)) continue
        candidates.push(c)
        includedPaths.add(c.source)
      }
    }

    const filtered = this.ras.filterContext(message, candidates, budget)
    const grouped = groupByCategory(filtered)

    const sections: string[] = []
    const sectionsIncluded: string[] = []

    // Device facts bypass RAS — they're universally relevant for any
    // tool call (correct shell syntax, correct paths, resource limits).
    // Resolved once before the loop so the per-iteration cost stays
    // bounded by the disk cache TTL.
    const deviceBody = this.device ? await this.device.getBlockBody().catch(() => '') : ''

    for (const category of SECTION_ORDER) {
      const items = grouped.get(category) ?? []
      if (items.length > 0) {
        const body = items.map((it) => formatItem(it)).join('\n\n')
        sections.push(this.wrap(SECTION_TAGS[category], body))
        sectionsIncluded.push(category)
      }

      // Device facts sit right after <identity> so the model reads
      // "who I am, then where I am" before any memory or skills. Skipped in
      // stateless mode — they're tool/agent-oriented and just add bloat.
      if (category === 'identity' && deviceBody.length > 0 && !stateless) {
        sections.push(this.wrap('device', deviceBody))
        sectionsIncluded.push('device')
      }

      // User-defined variables from config.json sit right after <device>
      // so the model sees "who I am, where I am, what I have" before
      // any memory or skills. Sensitive values are passed in plaintext
      // so the agent can use them in tool calls. Skipped in stateless mode.
      if (category === 'identity' && !stateless) {
        const variablesBody = await this.collectVariablesBlock()
        if (variablesBody.length > 0) {
          sections.push(this.wrap('variables', variablesBody))
          sectionsIncluded.push('variables')
        }
      }

      // Tools come from loaded capabilities, not from the RAS-scored
      // candidate pool. Inject right after <prefrontal> so the model sees
      // "what I am, then what I can do, then what I know".
      if (category === 'prefrontal') {
        if (stateless) {
          // Stateless chatbot: no tools and no notice — keep it minimal.
        } else if (opts?.omitTools) {
          // Tool use is suppressed (restrictLocalModels — see Agent.respond).
          // Replace the ~20k-token <tools> catalog with a short notice so the
          // model knows it has no tools, why, and how the user re-enables them.
          // The native tools API param is zeroed separately in Agent.ts.
          const omitted =
            this.cerebellum?.getToolDefinitions(this.excludedCapabilitiesFor(role)).length ?? 0
          if (omitted > 0) {
            sections.push(this.wrap('tools_status', toolsDisabledNotice(omitted)))
            sectionsIncluded.push('tools_status')
          }
        } else {
          const toolsBody =
            this.cerebellum?.getToolsPrompt(this.excludedCapabilitiesFor(role)).trim() ?? ''
          if (toolsBody.length > 0) {
            sections.push(this.wrap('tools', toolsBody))
            sectionsIncluded.push('tools')
          }
        }

        // Pure skills (no tools, just procedure bodies) are injected into
        // a <skills> section when the user's message matches their trigger
        // keywords. This surfaces capabilities like "planning" that guide
        // agent behaviour without providing callable tools. Skipped for a
        // worker — these match the orchestrator's user-facing message, not the
        // worker's composed sub-task, so they'd be noise.
        if (this.cerebellum && message.trim() && !lean) {
          const matched = this.cerebellum
            .findRelevantSkills(message)
            .filter((cap) => cap.tools.length === 0 && cap.body.trim().length > 0)
          if (matched.length > 0) {
            const skillsBody = matched
              .map(
                (cap) =>
                  `<source path="brain/cerebellum/${cap.name}/SKILL.md">\n${cap.body}\n</source>`
              )
              .join('\n\n')
            sections.push(this.wrap('skills', skillsBody))
            sectionsIncluded.push('skills')
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

  private async collectMemoryCandidates(
    message: string,
    exclude: Set<string>
  ): Promise<ContextCandidate[]> {
    if (!this.cortex || !message.trim()) return []
    let hits: CortexSearchResult[] = []
    try {
      hits = this.cortex.search(message, 12)
    } catch {
      return []
    }

    const out: ContextCandidate[] = []
    for (const hit of hits) {
      if (exclude.has(hit.path)) continue
      // Capability files (SKILL.md and plugin code) are surfaced via the
      // <tools> section already; pulling them into <memory> would duplicate
      // their content and burn tokens for nothing.
      if (hit.path.startsWith('brain/cerebellum/')) continue
      // Corpus logs are operational event trails for debugging — the LLM
      // doesn't need to read its own event log, and at 500-700 tokens per
      // day they crowd out actually-useful memories.
      if (hit.path.startsWith('brain/corpus/')) continue
      // Motor task transcripts are rewritten after every tool step. The
      // running task's file embeds the user's message verbatim, so cortex
      // scores it 1.00 and the prompt re-ingests a growing copy of the
      // very conversation the model is already holding — mutating the
      // prompt every iteration and defeating provider prefix caches.
      // Past tasks stay reachable on demand via insula tools and through
      // hippocampus episodes; task minutiae never belong in every prompt.
      if (hit.path.startsWith('brain/motor/')) continue
      // Basal-ganglia day files are the raw tool-outcome log. Their learning
      // signal is already folded into context as the bounded preference digest
      // (collectFeedbackCandidate below); pulling the raw days in here would
      // re-introduce the firehose the digest exists to replace. They stay
      // reachable verbatim on demand via wolffish_recall.
      if (hit.path.startsWith('brain/basalganglia/')) continue
      const content = await this.readFile(hit.path)
      if (!content) continue
      out.push({ category: 'memory', source: hit.path, content })
    }
    return out
  }

  private async collectRecentEpisodes(windowDays: number): Promise<ContextCandidate[]> {
    if (this.hippocampus) {
      const episodes = await this.hippocampus.getRecentEpisodes(windowDays).catch(() => [])
      return episodes.map((ep) => ({
        category: 'history' as ContextCategory,
        source: `brain/hippocampus/episodes/${ep.date}.md`,
        content: ep.content
      }))
    }
    const dir = path.join(this.options.workspaceRoot, 'brain', 'hippocampus', 'episodes')
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return []
    }

    const dated = entries
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .sort()
      .slice(-windowDays)

    const out: ContextCandidate[] = []
    for (const name of dated) {
      try {
        const raw = await fs.readFile(path.join(dir, name), 'utf8')
        const content = raw.trim()
        if (content.length === 0) continue
        out.push({
          category: 'history',
          source: `brain/hippocampus/episodes/${name}`,
          content
        })
      } catch {
        // skip unreadable files
      }
    }
    return out
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
  const lines: string[] = []
  if (runtime) {
    if (runtime.renderCounters !== false) {
      lines.push(`  Tool iteration this turn: ${runtime.iteration}`)
      lines.push(`  Tools called this turn: ${runtime.toolsCalled}`)
    }
    lines.push(
      `  IMPORTANT: When a task requires calling a tool for each item in a set (e.g. reading N emails, fetching N pages), you MUST call the tool for EVERY item before producing final output. Batch 10-15 calls per response for efficiency; their results return to you automatically and you continue with the remaining items in the same loop. A response with no tool calls ENDS the task — never end one planning to "continue next turn". Metadata from search/list results is NOT a substitute for calling the per-item tool — if the task says "read all," call read for ALL, not just a subset.`
    )
  }
  return lines.join('\n')
}

/**
 * Body of the <tools_status> block shown to a local model when tools are
 * suppressed (restrictLocalModels). Tells the model it has no tools, why, and
 * how the user can turn them on — so the model can relay that to the user
 * instead of pretending to act.
 */
function toolsDisabledNotice(omittedCount: number): string {
  const plural = omittedCount === 1 ? 'tool' : 'tools'
  return [
    `You are running on a local model. Tool use is turned OFF for local models by default, so ${omittedCount} ${plural} that would normally be available ${omittedCount === 1 ? 'has' : 'have'} been withheld and you cannot call any tool this turn.`,
    `Small local models often misuse tools, loop, or stall on a large tool list — keeping you tool-free is what lets you answer reliably.`,
    `- For questions, explanations, writing, brainstorming, and conversation: answer fully and helpfully as yourself.`,
    `- If a request needs tools (running commands, editing files, browsing the web, reading/sending channel messages): tell the user plainly that tool use is disabled for local models, and that they can enable it in Settings → Wolffish by turning off "Restrict local models" — best only for a capable local model with a large context window.`,
    `Never invent tool output or claim an action happened.`
  ].join('\n')
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
