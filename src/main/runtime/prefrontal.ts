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

  async buildSystemPrompt(message = '', runtime?: RuntimeContext): Promise<string> {
    const bundle = await this.buildContext(message, runtime)
    return bundle.systemPrompt
  }

  /**
   * Pick the tools the LLM gets to see for this iteration — the full
   * cerebellum-loaded tool list.
   */
  selectTools(): ToolDefinition[] {
    return this.cerebellum?.getToolDefinitions() ?? []
  }

  /**
   * Score candidates, fit them into the budget, and assemble the final
   * system prompt. Writes a debug snapshot and emits `context.built`.
   * If `runtime` is supplied, a `<runtime>` block reporting the live
   * iteration counter is appended last so the model can see its own
   * loop position.
   */
  async buildContext(message = '', runtime?: RuntimeContext): Promise<ContextBundle> {
    // Assemble against a clamped budget, not the raw model window. A 200k–1M
    // window is for the live conversation, not a system prompt that gets
    // rebuilt every iteration — capping it here is what keeps the prompt lean
    // and its prefix stable enough for the provider to cache.
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

    const historyCandidates = await this.collectRecentEpisodes(this.options.episodeWindowDays ?? 2)
    for (const c of historyCandidates) {
      if (includedPaths.has(c.source)) continue
      candidates.push(c)
      includedPaths.add(c.source)
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
      // "who I am, then where I am" before any memory or skills.
      if (category === 'identity' && deviceBody.length > 0) {
        sections.push(this.wrap('device', deviceBody))
        sectionsIncluded.push('device')
      }

      // User-defined variables from config.json sit right after <device>
      // so the model sees "who I am, where I am, what I have" before
      // any memory or skills. Sensitive values are passed in plaintext
      // so the agent can use them in tool calls.
      if (category === 'identity') {
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
        const toolsBody = this.cerebellum?.getToolsPrompt().trim() ?? ''
        if (toolsBody.length > 0) {
          sections.push(this.wrap('tools', toolsBody))
          sectionsIncluded.push('tools')
        }

        // Pure skills (no tools, just procedure bodies) are injected into
        // a <skills> section when the user's message matches their trigger
        // keywords. This surfaces capabilities like "planning" that guide
        // agent behaviour without providing callable tools.
        if (this.cerebellum && message.trim()) {
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
      await fs.writeFile(path.join(dir, filename), header, 'utf8')
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
