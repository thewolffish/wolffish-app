import type { BasalGanglia } from '@main/runtime/basalganglia/basalganglia'
import type { Cerebellum } from '@main/runtime/cerebellum/cerebellum'
import type { Corpus } from '@main/runtime/corpus/corpus'
import { Cortex, type CortexSearchResult } from '@main/runtime/cortex/cortex'
import type { Device } from '@main/runtime/device/device'
import type { Hippocampus } from '@main/runtime/hippocampus/hippocampus'
import {
  DEFAULT_BUDGET_TOKENS,
  RAS,
  type ContextCandidate,
  type ContextCategory,
  type ScoredCandidate
} from '@main/runtime/ras/ras'
import type { FallbackMode, ToolDefinition } from '@main/runtime/thalamus/thalamus'
import { readConfig } from '@main/workspace/workspace'
import fs from 'node:fs/promises'
import path from 'node:path'

export type PrefrontalOptions = {
  workspaceRoot: string
  episodeWindowDays?: number
  feedbackWindowDays?: number
  getContextBudget?: () => number
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
}

/**
 * Carries information about which provider is currently driving the
 * turn so prefrontal can adjust the prompt accordingly. When the cloud
 * cascade exhausts and we fall to local, agent passes
 * `{ isFallback: true, mode, reason, cloudProvider }`. In restricted
 * fallback the `<tools>` section and the API tool list are both
 * omitted — the local model literally cannot call tools.
 */
export type ProviderContext = {
  isFallback: boolean
  mode?: FallbackMode
  reason?: string
  cloudProvider?: string
}

const ALWAYS_INCLUDED: Array<{ category: ContextCategory; rel: string; tag: string }> = [
  { category: 'identity', rel: 'brain/identity/soul.md', tag: 'soul' },
  { category: 'identity', rel: 'brain/identity/user.md', tag: 'user' },
  { category: 'prefrontal', rel: 'brain/prefrontal/agents.core.md', tag: 'agents-core' },
  { category: 'prefrontal', rel: 'brain/prefrontal/agents.md', tag: 'agents' }
]

const SECTION_ORDER: ContextCategory[] = ['identity', 'prefrontal', 'memory', 'skills', 'history']

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
    providerContext?: ProviderContext
  ): Promise<string> {
    const bundle = await this.buildContext(message, runtime, providerContext)
    return bundle.systemPrompt
  }

  /**
   * Pick the tools the LLM gets to see for this iteration. Restricted
   * fallback mode returns an empty list — the local model has no tools
   * surfaced and is steered via agents.md to decline complex requests
   * in plain text. Full mode and normal cloud turns return the full
   * cerebellum-loaded tool list.
   */
  selectTools(providerContext?: ProviderContext): ToolDefinition[] {
    if (providerContext?.isFallback && providerContext.mode === 'restricted') {
      return []
    }
    return this.cerebellum?.getToolDefinitions() ?? []
  }

  /**
   * Score candidates, fit them into the budget, and assemble the final
   * system prompt. Writes a debug snapshot and emits `context.built`.
   * If `runtime` is supplied, a `<runtime>` block reporting the live
   * iteration counter is appended last so the model can see its own
   * loop position. If `providerContext.isFallback` is true, that
   * `<runtime>` block also carries a `<provider>` notice and a
   * `<fallbackMode>` tag, and the `<tools>` section is omitted entirely
   * when the mode is `'restricted'`.
   */
  async buildContext(
    message = '',
    runtime?: RuntimeContext,
    providerContext?: ProviderContext
  ): Promise<ContextBundle> {
    const budget = this.ras.allocateBudget(this.getTokenBudget())
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

    // Restricted fallback strips tool descriptions from the prompt.
    // Showing a model tools it can't actually call (because the API
    // request omits them) just confuses it.
    const showTools = !(providerContext?.isFallback && providerContext.mode === 'restricted')

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
      if (category === 'prefrontal' && showTools) {
        const toolsBody = this.cerebellum?.getToolsPrompt().trim() ?? ''
        if (toolsBody.length > 0) {
          sections.push(this.wrap('tools', toolsBody))
          sectionsIncluded.push('tools')
        }
      }
    }

    if (runtime || providerContext?.isFallback) {
      sections.push(this.wrap('runtime', formatRuntimeBody(runtime, providerContext)))
      sectionsIncluded.push('runtime')
    }

    const systemPrompt = sections.join('\n\n')
    const estimatedTokens = this.ras.estimateTokens(systemPrompt)

    if (this.corpus) {
      this.corpus.emit('context.built', {
        tokenCount: estimatedTokens,
        tokenBudget: this.getTokenBudget(),
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
    return {
      category: 'memory',
      source: 'brain/basalganglia/recent.md',
      content
    }
  }

  private async collectVariablesBlock(): Promise<string> {
    try {
      const config = await readConfig()
      const vars = config?.variables ?? []
      if (vars.length === 0) return ''
      const lines = vars.map((v) => `- ${v.name} = ${v.value}${v.sensitive ? ' (sensitive)' : ''}`)
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

function formatRuntimeBody(
  runtime: RuntimeContext | undefined,
  providerContext: ProviderContext | undefined
): string {
  const lines: string[] = []
  if (runtime) {
    lines.push(`  Tool iteration this turn: ${runtime.iteration}`)
    lines.push(`  Tools called this turn: ${runtime.toolsCalled}`)
  }
  if (providerContext?.isFallback) {
    const cloudName = providerContext.cloudProvider ?? 'the cloud provider'
    const reason = providerContext.reason ?? 'unavailable'
    const detail = reason && reason !== 'unavailable' ? ` (${reason})` : ''
    lines.push(
      `  <provider>You are running as the local fallback model. The cloud provider (${cloudName}) is currently unavailable${detail}.</provider>`
    )
    lines.push(`  <fallbackMode>${providerContext.mode ?? 'restricted'}</fallbackMode>`)
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
