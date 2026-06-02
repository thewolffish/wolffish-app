import type { Corpus } from '@main/runtime/corpus'
import type { ProviderId } from '@main/runtime/thalamus'
import fs from 'node:fs/promises'
import path from 'node:path'

export type UsageEntry = {
  timestamp: Date
  provider: ProviderId
  model: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  cost: number
}

export type TimeRange = 'today' | 'this_month' | '3_months' | '6_months' | 'ytd' | 'all_time'

export type UsageStatsTotals = {
  messages: number
  conversations: number
  activeDays: number
  longestStreak: number
  totalTokens: number
  favouriteModel: string | null
}

export type ProviderUsageSummary = {
  provider: ProviderId
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number
  models: Array<{ model: string; inputTokens: number; outputTokens: number; cost: number }>
}

export type BraveUsageSummary = {
  totalQueries: number
  totalCost: number
}

export type UsageSummary = {
  providers: ProviderUsageSummary[]
  brave: BraveUsageSummary
}

export type DailyUsage = {
  date: string
  totalTokens: number
}

export type UsageOptions = {
  workspaceRoot?: string
  corpus?: Corpus
}

type CachedEntry = {
  timestamp: string
  provider: ProviderId
  model: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  cost: number
}

type ModelPricing = {
  input: number // $/token
  output: number // $/token
  cacheWrite: number // multiplier on input rate (e.g. 1.25 → 125% of base)
  cacheRead: number // multiplier on input rate (e.g. 0.10 → 10% of base)
}

// https://docs.anthropic.com/en/docs/about-claude/models#model-comparison-table
const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-8': { input: 5 / 1e6, output: 25 / 1e6, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-opus-4-7': { input: 5 / 1e6, output: 25 / 1e6, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-opus-4-6': { input: 5 / 1e6, output: 25 / 1e6, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-opus-4-5': { input: 5 / 1e6, output: 25 / 1e6, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-opus-4-1': { input: 15 / 1e6, output: 75 / 1e6, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-opus-4': { input: 15 / 1e6, output: 75 / 1e6, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-sonnet-4-6': { input: 3 / 1e6, output: 15 / 1e6, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-sonnet-4-5': { input: 3 / 1e6, output: 15 / 1e6, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-sonnet-4': { input: 3 / 1e6, output: 15 / 1e6, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-haiku-4-5': { input: 1 / 1e6, output: 5 / 1e6, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-3-7-sonnet': { input: 3 / 1e6, output: 15 / 1e6, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-3-5-sonnet': { input: 3 / 1e6, output: 15 / 1e6, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-3-5-haiku': { input: 0.8 / 1e6, output: 4 / 1e6, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-3-haiku': { input: 0.25 / 1e6, output: 1.25 / 1e6, cacheWrite: 1.25, cacheRead: 0.1 }
}

// https://developers.openai.com/api/docs/pricing
// OpenAI auto-caches prefixes; no write premium. Pro models have no cached tier.
const OPENAI_PRICING: Record<string, ModelPricing> = {
  'gpt-5.5-pro': { input: 30 / 1e6, output: 180 / 1e6, cacheWrite: 1.0, cacheRead: 1.0 },
  'gpt-5.5': { input: 5 / 1e6, output: 30 / 1e6, cacheWrite: 1.0, cacheRead: 0.1 },
  'gpt-5.4-pro': { input: 30 / 1e6, output: 180 / 1e6, cacheWrite: 1.0, cacheRead: 1.0 },
  'gpt-5.4': { input: 2.5 / 1e6, output: 15 / 1e6, cacheWrite: 1.0, cacheRead: 0.1 },
  'gpt-5.4-mini': { input: 0.75 / 1e6, output: 4.5 / 1e6, cacheWrite: 1.0, cacheRead: 0.1 },
  'gpt-5.4-nano': { input: 0.2 / 1e6, output: 1.25 / 1e6, cacheWrite: 1.0, cacheRead: 0.1 },
  'gpt-5': { input: 2.5 / 1e6, output: 10 / 1e6, cacheWrite: 1.0, cacheRead: 0.5 },
  'gpt-4o': { input: 2.5 / 1e6, output: 10 / 1e6, cacheWrite: 1.0, cacheRead: 0.5 },
  'gpt-4o-mini': { input: 0.15 / 1e6, output: 0.6 / 1e6, cacheWrite: 1.0, cacheRead: 0.5 },
  'gpt-4-turbo': { input: 10 / 1e6, output: 30 / 1e6, cacheWrite: 1.0, cacheRead: 0.5 },
  'gpt-4': { input: 30 / 1e6, output: 60 / 1e6, cacheWrite: 1.0, cacheRead: 1.0 },
  'gpt-3.5-turbo': { input: 0.5 / 1e6, output: 1.5 / 1e6, cacheWrite: 1.0, cacheRead: 1.0 },
  o1: { input: 15 / 1e6, output: 60 / 1e6, cacheWrite: 1.0, cacheRead: 0.5 },
  'o1-mini': { input: 3 / 1e6, output: 12 / 1e6, cacheWrite: 1.0, cacheRead: 0.5 },
  o3: { input: 10 / 1e6, output: 40 / 1e6, cacheWrite: 1.0, cacheRead: 0.5 },
  'o3-mini': { input: 1.1 / 1e6, output: 4.4 / 1e6, cacheWrite: 1.0, cacheRead: 0.5 },
  'o4-mini': { input: 1.1 / 1e6, output: 4.4 / 1e6, cacheWrite: 1.0, cacheRead: 0.5 }
}

// https://api-docs.deepseek.com/quick_start/pricing
// DeepSeek auto-caches at ~2% of input rate; no write premium.
const DEEPSEEK_PRICING: Record<string, ModelPricing> = {
  'deepseek-v4-pro': { input: 0.435 / 1e6, output: 0.87 / 1e6, cacheWrite: 1.0, cacheRead: 0.02 },
  'deepseek-v4-flash': { input: 0.14 / 1e6, output: 0.28 / 1e6, cacheWrite: 1.0, cacheRead: 0.02 },
  'deepseek-chat': { input: 0.27 / 1e6, output: 1.1 / 1e6, cacheWrite: 1.0, cacheRead: 0.02 },
  'deepseek-reasoner': { input: 0.55 / 1e6, output: 2.19 / 1e6, cacheWrite: 1.0, cacheRead: 0.02 }
}

// https://platform.xiaomimimo.com/docs/en-US/pricing (overseas USD)
// Input rates are for the ≤256K tier; the 256K-1M tier is ~5× higher but
// most Wolffish turns stay under 256K. Cache write is free (limited time).
const MIMO_PRICING: Record<string, ModelPricing> = {
  'mimo-v2.5-pro': { input: 0.2 / 1e6, output: 2.0 / 1e6, cacheWrite: 0, cacheRead: 15.0 },
  'mimo-v2-pro': { input: 0.2 / 1e6, output: 2.0 / 1e6, cacheWrite: 0, cacheRead: 15.0 },
  'mimo-v2.5': { input: 0.08 / 1e6, output: 0.8 / 1e6, cacheWrite: 0, cacheRead: 25.0 },
  'mimo-v2-omni': { input: 0.08 / 1e6, output: 0.8 / 1e6, cacheWrite: 0, cacheRead: 25.0 },
  'mimo-v2-flash': { input: 0.01 / 1e6, output: 0.3 / 1e6, cacheWrite: 0, cacheRead: 0 }
}

// https://platform.kimi.ai/docs/pricing
// Cache read multiplier = cache_hit_rate / cache_miss_rate (auto-caching, no write premium).
const KIMI_PRICING: Record<string, ModelPricing> = {
  'kimi-k2.6': { input: 0.95 / 1e6, output: 4.0 / 1e6, cacheWrite: 1.0, cacheRead: 0.16 / 0.95 },
  'kimi-k2.5': { input: 0.6 / 1e6, output: 3.0 / 1e6, cacheWrite: 1.0, cacheRead: 0.1 / 0.6 },
  'moonshot-v1-128k': { input: 2.0 / 1e6, output: 5.0 / 1e6, cacheWrite: 0, cacheRead: 0 },
  'moonshot-v1-32k': { input: 1.0 / 1e6, output: 3.0 / 1e6, cacheWrite: 0, cacheRead: 0 },
  'moonshot-v1-8k': { input: 0.2 / 1e6, output: 2.0 / 1e6, cacheWrite: 0, cacheRead: 0 },
  'moonshot-v1-auto': { input: 1.0 / 1e6, output: 3.0 / 1e6, cacheWrite: 0, cacheRead: 0 }
}

// https://platform.minimax.io/docs/guides/pricing-paygo.md
// Promotional rates shown; cache read is a fraction of input.
const MINIMAX_PRICING: Record<string, ModelPricing> = {
  'MiniMax-M3': { input: 0.30 / 1e6, output: 1.20 / 1e6, cacheWrite: 1.0, cacheRead: 0.20 },
  'MiniMax-M2.7': { input: 0.30 / 1e6, output: 1.20 / 1e6, cacheWrite: 1.25, cacheRead: 0.20 },
  'MiniMax-M2.7-highspeed': { input: 0.60 / 1e6, output: 2.40 / 1e6, cacheWrite: 1.0, cacheRead: 0.10 },
  'MiniMax-M2.5': { input: 0.30 / 1e6, output: 1.20 / 1e6, cacheWrite: 1.25, cacheRead: 0.10 },
  'MiniMax-M2.5-highspeed': { input: 0.60 / 1e6, output: 2.40 / 1e6, cacheWrite: 1.0, cacheRead: 0.05 },
  'MiniMax-M2.1': { input: 0.30 / 1e6, output: 1.20 / 1e6, cacheWrite: 1.25, cacheRead: 0.10 },
  'MiniMax-M2.1-highspeed': { input: 0.60 / 1e6, output: 2.40 / 1e6, cacheWrite: 1.0, cacheRead: 0.05 },
  'MiniMax-M2': { input: 0.30 / 1e6, output: 1.20 / 1e6, cacheWrite: 1.25, cacheRead: 0.10 }
}

const LOCAL_EQUIVALENT_PRICING: ModelPricing = {
  input: 0,
  output: 0,
  cacheWrite: 1.0,
  cacheRead: 1.0
}

// Empirical billing offset for cloud API cost estimation.
//
// Published per-token rates under-predict actual dashboard charges by ~16.6%.
// The gap comes from request-level rounding, cache-tier auto-promotion on
// long-running agentic loops, and internal token-accounting differences the
// stream usage object doesn't surface.
//
// Calibration (2026-05-20 heartbeat, claude-opus-4-6):
//   raw token math = $38.28   (in:60269 out:8920 cw:5895367 cr:1816295)
//   Anthropic dashboard = $44.62
//   ratio = 44.62 / 38.28 = 1.1657 → rounded to 1.166 (errs +$0.02 above)
//
// Applied on top of the fact-based token calculation so the UI never
// under-reports spending.
const CLOUD_BILLING_OFFSET = 0.166

const BRAVE_COST_PER_QUERY = 0.005

type CachedBraveEntry = {
  timestamp: string
}

export class Usage {
  private workspaceRoot: string | null
  private corpus: Corpus | null
  private cache: CachedEntry[] = []
  private braveCache: CachedBraveEntry[] = []
  private loaded = false

  constructor(options: UsageOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? null
    this.corpus = options.corpus ?? null
  }

  async load(): Promise<void> {
    if (this.loaded || !this.workspaceRoot) return
    this.cache = await this.parseAllProviderFiles()
    this.braveCache = await this.parseBraveFile()
    this.loaded = true
  }

  async sync(): Promise<void> {
    this.loaded = false
    this.cache = []
    this.braveCache = []
    await this.load()
  }

  async recordUsage(entry: UsageEntry): Promise<void> {
    if (!this.workspaceRoot) return
    await this.load()

    // Cache the timestamp in local-naive form (`YYYY-MM-DDTHH:MM:SS`)
    // matching what parseProviderLine produces on file roundtrip. Using
    // `toISOString()` here would store UTC, which slice(0, 10) then
    // attributes to the wrong calendar day for any user east of UTC who
    // records a turn between local midnight and UTC midnight (e.g. a
    // 02:30 AM Riyadh turn on May 1 would show under April 30 until the
    // app is restarted and the cache is rebuilt from the file).
    const cached: CachedEntry = {
      timestamp: `${formatDate(entry.timestamp)}T${formatTime(entry.timestamp)}`,
      provider: entry.provider,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheCreationTokens: entry.cacheCreationTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cost: entry.cost
    }
    this.cache.push(cached)

    await this.appendToProviderFile(entry)
    await this.appendToDailyFile(entry)

    this.corpus?.emit('usage.recorded', {
      provider: entry.provider,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cost: entry.cost
    })
  }

  async getSummary(range: TimeRange): Promise<UsageSummary> {
    await this.load()
    const cutoff = rangeCutoff(range)
    const filtered = this.cache.filter((e) => e.timestamp >= cutoff)

    const byProvider = new Map<ProviderId, { entries: CachedEntry[] }>()
    for (const entry of filtered) {
      const bucket = byProvider.get(entry.provider) ?? { entries: [] }
      bucket.entries.push(entry)
      byProvider.set(entry.provider, bucket)
    }

    const providers: ProviderUsageSummary[] = []
    for (const pid of [
      'local',
      'anthropic',
      'openai',
      'deepseek',
      'mimo',
      'kimi',
      'minimax'
    ] as ProviderId[]) {
      const bucket = byProvider.get(pid)
      if (!bucket) {
        providers.push({
          provider: pid,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCost: 0,
          models: []
        })
        continue
      }

      const modelMap = new Map<
        string,
        { inputTokens: number; outputTokens: number; cost: number }
      >()
      let totalInput = 0
      let totalOutput = 0
      let totalCost = 0

      for (const e of bucket.entries) {
        totalInput += e.inputTokens
        totalOutput += e.outputTokens
        totalCost += e.cost
        const m = modelMap.get(e.model) ?? { inputTokens: 0, outputTokens: 0, cost: 0 }
        m.inputTokens += e.inputTokens
        m.outputTokens += e.outputTokens
        m.cost += e.cost
        modelMap.set(e.model, m)
      }

      providers.push({
        provider: pid,
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        totalCost: totalCost,
        models: [...modelMap.entries()].map(([model, stats]) => ({ model, ...stats }))
      })
    }

    const braveCutoff = rangeCutoff(range)
    const braveFiltered = this.braveCache.filter((e) => e.timestamp >= braveCutoff)
    const brave: BraveUsageSummary = {
      totalQueries: braveFiltered.length,
      totalCost: braveFiltered.length * BRAVE_COST_PER_QUERY
    }

    return { providers, brave }
  }

  async getDaily(year: number): Promise<DailyUsage[]> {
    await this.load()
    const yearStr = String(year)
    const byDay = new Map<string, number>()
    for (const entry of this.cache) {
      const date = entry.timestamp.slice(0, 10)
      if (!date.startsWith(yearStr)) continue
      byDay.set(date, (byDay.get(date) ?? 0) + entry.inputTokens + entry.outputTokens)
    }
    return [...byDay.entries()]
      .map(([date, totalTokens]) => ({ date, totalTokens }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  async getStats(range: TimeRange): Promise<Omit<UsageStatsTotals, 'conversations'>> {
    await this.load()
    const cutoff = rangeCutoff(range)
    const filtered = this.cache.filter((e) => e.timestamp >= cutoff)

    let totalTokens = 0
    const days = new Set<string>()
    const modelCounts = new Map<string, number>()

    for (const e of filtered) {
      totalTokens += e.inputTokens + e.outputTokens
      days.add(e.timestamp.slice(0, 10))
      modelCounts.set(e.model, (modelCounts.get(e.model) ?? 0) + 1)
    }

    let favouriteModel: string | null = null
    let topCount = 0
    for (const [model, count] of modelCounts) {
      if (count > topCount) {
        favouriteModel = model
        topCount = count
      }
    }

    return {
      messages: filtered.length,
      activeDays: days.size,
      longestStreak: longestConsecutiveStreak([...days]),
      totalTokens,
      favouriteModel
    }
  }

  private usageDir(): string {
    return path.join(this.workspaceRoot!, 'usage')
  }

  private providerFilePath(provider: ProviderId): string {
    const name = provider === 'local' ? 'ollama' : provider
    return path.join(this.usageDir(), 'providers', `${name}.md`)
  }

  private dailyFilePath(date: string): string {
    return path.join(this.usageDir(), 'daily', `${date}.md`)
  }

  private async appendToProviderFile(entry: UsageEntry): Promise<void> {
    const filepath = this.providerFilePath(entry.provider)
    const dir = path.dirname(filepath)
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch {
      return
    }

    const date = formatDate(entry.timestamp)
    const time = formatTime(entry.timestamp)
    const cachePart =
      entry.cacheCreationTokens || entry.cacheReadTokens
        ? ` cw:${entry.cacheCreationTokens ?? 0} cr:${entry.cacheReadTokens ?? 0}`
        : ''
    const line = `- ${date} ${time} | ${entry.model} | in:${entry.inputTokens} out:${entry.outputTokens}${cachePart} | $${entry.cost.toFixed(6)}\n`

    let existing = ''
    try {
      existing = await fs.readFile(filepath, 'utf8')
    } catch {
      existing = ''
    }

    const dateHeader = `## ${date}`
    if (!existing.includes(dateHeader)) {
      const body =
        existing.length === 0
          ? `# ${providerLabel(entry.provider)}\n\n${dateHeader}\n\n${line}`
          : `\n${dateHeader}\n\n${line}`
      try {
        await fs.appendFile(filepath, body, 'utf8')
      } catch {
        return
      }
    } else {
      try {
        await fs.appendFile(filepath, line, 'utf8')
      } catch {
        return
      }
    }
  }

  private async appendToDailyFile(entry: UsageEntry): Promise<void> {
    const date = formatDate(entry.timestamp)
    const filepath = this.dailyFilePath(date)
    const dir = path.dirname(filepath)
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch {
      return
    }

    const time = formatTime(entry.timestamp)
    const providerName = providerLabel(entry.provider)
    const cachePart =
      entry.cacheCreationTokens || entry.cacheReadTokens
        ? ` cw:${entry.cacheCreationTokens ?? 0} cr:${entry.cacheReadTokens ?? 0}`
        : ''
    const line = `- ${time} | ${providerName} | ${entry.model} | in:${entry.inputTokens} out:${entry.outputTokens}${cachePart} | $${entry.cost.toFixed(6)}\n`

    let needsHeader = true
    try {
      await fs.access(filepath)
      needsHeader = false
    } catch {
      // file doesn't exist
    }

    const body = (needsHeader ? `# ${date}\n\n` : '') + line
    try {
      await fs.appendFile(filepath, body, 'utf8')
    } catch {
      return
    }
  }

  private async parseAllProviderFiles(): Promise<CachedEntry[]> {
    if (!this.workspaceRoot) return []
    const entries: CachedEntry[] = []
    const providerDir = path.join(this.usageDir(), 'providers')

    const providerFiles: Array<{ file: string; provider: ProviderId }> = [
      { file: 'ollama.md', provider: 'local' },
      { file: 'anthropic.md', provider: 'anthropic' },
      { file: 'openai.md', provider: 'openai' },
      { file: 'deepseek.md', provider: 'deepseek' },
      { file: 'mimo.md', provider: 'mimo' },
      { file: 'kimi.md', provider: 'kimi' },
      { file: 'minimax.md', provider: 'minimax' }
    ]

    for (const { file, provider } of providerFiles) {
      const filepath = path.join(providerDir, file)
      let raw: string
      try {
        raw = await fs.readFile(filepath, 'utf8')
      } catch {
        continue
      }
      for (const line of raw.split(/\r?\n/)) {
        const parsed = parseProviderLine(line, provider)
        if (parsed) entries.push(parsed)
      }
    }

    return entries
  }

  private async parseBraveFile(): Promise<CachedBraveEntry[]> {
    if (!this.workspaceRoot) return []
    const filepath = path.join(this.usageDir(), 'providers', 'brave.md')
    let raw: string
    try {
      raw = await fs.readFile(filepath, 'utf8')
    } catch {
      return []
    }
    const entries: CachedBraveEntry[] = []
    for (const line of raw.split(/\r?\n/)) {
      const m = /^-\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\|/.exec(line)
      if (m) entries.push({ timestamp: `${m[1]}T${m[2]}` })
    }
    return entries
  }
}

function parseProviderLine(line: string, provider: ProviderId): CachedEntry | null {
  const m =
    /^-\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\|\s+(\S+)\s+\|\s+in:(\d+)\s+out:(\d+)(?:\s+cw:(\d+)\s+cr:(\d+))?\s+\|\s+\$(\d+(?:\.\d+)?)/.exec(
      line
    )
  if (!m) return null
  return {
    timestamp: `${m[1]}T${m[2]}`,
    provider,
    model: m[3],
    inputTokens: Number(m[4]),
    outputTokens: Number(m[5]),
    cacheCreationTokens: m[6] ? Number(m[6]) : undefined,
    cacheReadTokens: m[7] ? Number(m[7]) : undefined,
    cost: Number(m[8])
  }
}

export function calculateCost(
  provider: ProviderId,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens?: number,
  cacheReadTokens?: number
): number {
  if (provider === 'local') {
    return (
      inputTokens * LOCAL_EQUIVALENT_PRICING.input + outputTokens * LOCAL_EQUIVALENT_PRICING.output
    )
  }
  const table =
    provider === 'anthropic'
      ? ANTHROPIC_PRICING
      : provider === 'deepseek'
        ? DEEPSEEK_PRICING
        : provider === 'mimo'
          ? MIMO_PRICING
          : provider === 'kimi'
            ? KIMI_PRICING
            : provider === 'minimax'
              ? MINIMAX_PRICING
              : OPENAI_PRICING
  const pricing = findPricing(model, table)
  // Fact-based: published per-token rates applied to reported token counts
  const raw =
    inputTokens * pricing.input +
    (cacheCreationTokens ?? 0) * pricing.input * pricing.cacheWrite +
    (cacheReadTokens ?? 0) * pricing.input * pricing.cacheRead +
    outputTokens * pricing.output
  const offset = provider === 'anthropic' || provider === 'openai' ? CLOUD_BILLING_OFFSET : 0
  return raw * (1 + offset)
}

function findPricing(model: string, table: Record<string, ModelPricing>): ModelPricing {
  if (table[model]) return table[model]
  // Sort keys longest-first so 'claude-opus-4-6' matches before 'claude-opus-4'
  const sorted = Object.keys(table).sort((a, b) => b.length - a.length)
  for (const key of sorted) {
    if (model.startsWith(key)) return table[key]
  }
  const values = Object.values(table)
  if (values.length > 0) return values[0]
  return { input: 3 / 1e6, output: 15 / 1e6, cacheWrite: 1.25, cacheRead: 0.1 }
}

// Cutoffs are returned as local-naive datetime strings to match the
// cache format. Mixing UTC ISO here against local-naive entries would
// silently misclassify entries that straddle midnight in either
// direction.
function rangeCutoff(range: TimeRange): string {
  const now = new Date()
  let d: Date
  switch (range) {
    case 'today':
      d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      break
    case 'this_month':
      d = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case '3_months':
      d = new Date(now.getFullYear(), now.getMonth() - 3, 1)
      break
    case '6_months':
      d = new Date(now.getFullYear(), now.getMonth() - 6, 1)
      break
    case 'ytd':
      d = new Date(now.getFullYear(), 0, 1)
      break
    case 'all_time':
      d = new Date(0)
      break
  }
  return `${formatDate(d)}T${formatTime(d)}`
}

function formatDate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function providerLabel(provider: ProviderId): string {
  if (provider === 'local') return 'Ollama'
  if (provider === 'anthropic') return 'Anthropic'
  if (provider === 'deepseek') return 'DeepSeek'
  if (provider === 'mimo') return 'Xiaomi Mimo'
  if (provider === 'kimi') return 'Kimi'
  if (provider === 'minimax') return 'MiniMax'
  return 'OpenAI'
}

function longestConsecutiveStreak(dates: string[]): number {
  if (dates.length === 0) return 0
  const sorted = [...dates].sort()
  let longest = 1
  let current = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + 'T00:00:00Z')
    const cur = new Date(sorted[i] + 'T00:00:00Z')
    const diffDays = Math.round((cur.getTime() - prev.getTime()) / 86_400_000)
    if (diffDays === 1) {
      current++
      if (current > longest) longest = current
    } else if (diffDays > 1) {
      current = 1
    }
  }
  return longest
}
