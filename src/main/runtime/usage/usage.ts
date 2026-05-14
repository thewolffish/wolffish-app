import fs from 'node:fs/promises'
import path from 'node:path'
import type { Corpus } from '@main/runtime/corpus/corpus'
import type { ProviderId } from '@main/runtime/thalamus/thalamus'

export type UsageEntry = {
  timestamp: Date
  provider: ProviderId
  model: string
  inputTokens: number
  outputTokens: number
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
  cost: number
}

const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-sonnet-4': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  'claude-haiku-4': { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  'claude-3-7-sonnet': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  'claude-3-5-sonnet': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  'claude-3-5-haiku': { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  'claude-3-haiku': { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 }
}

const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
  'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  'gpt-4-turbo': { input: 10 / 1_000_000, output: 30 / 1_000_000 },
  'gpt-4': { input: 30 / 1_000_000, output: 60 / 1_000_000 },
  'gpt-3.5-turbo': { input: 0.5 / 1_000_000, output: 1.5 / 1_000_000 },
  o1: { input: 15 / 1_000_000, output: 60 / 1_000_000 },
  'o1-mini': { input: 3 / 1_000_000, output: 12 / 1_000_000 },
  o3: { input: 10 / 1_000_000, output: 40 / 1_000_000 },
  'o3-mini': { input: 1.1 / 1_000_000, output: 4.4 / 1_000_000 },
  'o4-mini': { input: 1.1 / 1_000_000, output: 4.4 / 1_000_000 }
}

const LOCAL_EQUIVALENT_PRICING: { input: number; output: number } = {
  input: 3 / 1_000_000,
  output: 15 / 1_000_000
}

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
    for (const pid of ['local', 'anthropic', 'openai'] as ProviderId[]) {
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
    const line = `- ${date} ${time} | ${entry.model} | in:${entry.inputTokens} out:${entry.outputTokens} | $${entry.cost.toFixed(6)}\n`

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
    const line = `- ${time} | ${providerName} | ${entry.model} | in:${entry.inputTokens} out:${entry.outputTokens} | $${entry.cost.toFixed(6)}\n`

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
      { file: 'openai.md', provider: 'openai' }
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
    /^-\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\|\s+(\S+)\s+\|\s+in:(\d+)\s+out:(\d+)\s+\|\s+\$(\d+(?:\.\d+)?)/.exec(
      line
    )
  if (!m) return null
  return {
    timestamp: `${m[1]}T${m[2]}`,
    provider,
    model: m[3],
    inputTokens: Number(m[4]),
    outputTokens: Number(m[5]),
    cost: Number(m[6])
  }
}

export function calculateCost(
  provider: ProviderId,
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  if (provider === 'anthropic') {
    const pricing = findPricing(model, ANTHROPIC_PRICING)
    return inputTokens * pricing.input + outputTokens * pricing.output
  }
  if (provider === 'openai') {
    const pricing = findPricing(model, OPENAI_PRICING)
    return inputTokens * pricing.input + outputTokens * pricing.output
  }
  return (
    inputTokens * LOCAL_EQUIVALENT_PRICING.input + outputTokens * LOCAL_EQUIVALENT_PRICING.output
  )
}

function findPricing(
  model: string,
  table: Record<string, { input: number; output: number }>
): { input: number; output: number } {
  if (table[model]) return table[model]
  for (const [key, value] of Object.entries(table)) {
    if (model.startsWith(key) || key.startsWith(model) || model.includes(key) || key.includes(model))
      return value
  }
  const values = Object.values(table)
  if (values.length > 0) return values[0]
  return { input: 3 / 1_000_000, output: 15 / 1_000_000 }
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
