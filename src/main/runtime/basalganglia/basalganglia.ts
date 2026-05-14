import fs from 'node:fs/promises'
import path from 'node:path'
import type { Corpus } from '@main/runtime/corpus/corpus'

/**
 * BasalGanglia learns from outcomes — what worked, what didn't, what the
 * user approved or rejected.
 *
 * Maps to: the basal ganglia — a cluster of nuclei deep in the brain that
 * handle reward processing and habit formation. Every time you take an
 * action, the basal ganglia compares the result to the prediction and
 * nudges future behavior toward what worked. Skills you do without
 * thinking — typing, driving, the cadence of a familiar conversation —
 * live here.
 *
 * In Wolffish, the basal ganglia tracks every tool call, plan, and user
 * approval/rejection. Over time it builds a feedback log that the
 * prefrontal can read when planning: "the last twelve times I suggested a
 * Conventional Commit message the user accepted it without edits — keep
 * doing that." Growth comes from this loop, not from the model weights.
 */

export type FeedbackOutcome = 'success' | 'failed' | 'denied' | 'approved' | 'blocked'

export type FeedbackEntry = {
  timestamp: Date
  tool: string
  outcome: FeedbackOutcome
  args: Record<string, unknown>
  output?: string
  error?: string
  reason?: string
}

const OUTPUT_PREVIEW_CHARS = 200

export type FeedbackSummary = {
  totalCalls: number
  successCount: number
  failedCount: number
  deniedCount: number
  successRate: number
  topTools: Array<{ tool: string; count: number }>
  topDenied: Array<{ tool: string; count: number }>
}

export type BasalGangliaOptions = {
  workspaceRoot?: string
  corpus?: Corpus
}

const CORPUS_OUTCOME_MAP: Record<FeedbackOutcome, 'success' | 'failure' | 'approved' | 'rejected'> =
  {
    success: 'success',
    approved: 'approved',
    failed: 'failure',
    blocked: 'failure',
    denied: 'rejected'
  }

export class BasalGanglia {
  private workspaceRoot: string | null
  private corpus: Corpus | null

  constructor(options: BasalGangliaOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? null
    this.corpus = options.corpus ?? null
  }

  /**
   * Append a tool-call outcome to today's feedback file. One file per day
   * under brain/basalganglia/YYYY-MM-DD.md, append-only.
   */
  async recordOutcome(entry: FeedbackEntry): Promise<void> {
    if (!this.workspaceRoot) return
    const dir = path.join(this.workspaceRoot, 'brain', 'basalganglia')
    const date = formatDate(entry.timestamp)
    const filepath = path.join(dir, `${date}.md`)

    try {
      await fs.mkdir(dir, { recursive: true })
    } catch {
      return
    }

    let needsHeader = true
    try {
      await fs.access(filepath)
      needsHeader = false
    } catch {
      // file doesn't exist
    }

    const line = renderEntry(entry)
    const body = (needsHeader ? `# ${date}\n\n` : '') + line

    try {
      await fs.appendFile(filepath, body, 'utf8')
    } catch {
      return
    }

    this.corpus?.emit('feedback.recorded', {
      action: entry.tool,
      outcome: CORPUS_OUTCOME_MAP[entry.outcome]
    })
  }

  /**
   * Concatenate the last N days of feedback files. Returned as plain text
   * so the prefrontal can fold it into the memory section of context.
   */
  async getPreferences(days = 7): Promise<string> {
    if (!this.workspaceRoot) return ''
    const dir = path.join(this.workspaceRoot, 'brain', 'basalganglia')
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return ''
    }

    const dated = entries
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .sort()
      .slice(-days)

    const chunks: string[] = []
    for (const name of dated) {
      try {
        const raw = await fs.readFile(path.join(dir, name), 'utf8')
        const trimmed = raw.trim()
        if (trimmed.length > 0) chunks.push(trimmed)
      } catch {
        // skip unreadable files
      }
    }
    return chunks.join('\n\n')
  }

  /**
   * Aggregate stats across every recorded feedback file. Used by the insula
   * to answer "how am I doing?" and by the brain settings UI.
   */
  async getFeedbackSummary(): Promise<FeedbackSummary> {
    const empty: FeedbackSummary = {
      totalCalls: 0,
      successCount: 0,
      failedCount: 0,
      deniedCount: 0,
      successRate: 0,
      topTools: [],
      topDenied: []
    }
    if (!this.workspaceRoot) return empty

    const dir = path.join(this.workspaceRoot, 'brain', 'basalganglia')
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return empty
    }

    const toolCounts = new Map<string, number>()
    const deniedCounts = new Map<string, number>()
    let total = 0
    let success = 0
    let failed = 0
    let denied = 0

    for (const name of entries) {
      if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) continue
      let raw: string
      try {
        raw = await fs.readFile(path.join(dir, name), 'utf8')
      } catch {
        continue
      }
      for (const line of raw.split(/\r?\n/)) {
        const parsed = parseEntryLine(line)
        if (!parsed) continue
        total += 1
        toolCounts.set(parsed.tool, (toolCounts.get(parsed.tool) ?? 0) + 1)
        if (parsed.outcome === 'success' || parsed.outcome === 'approved') success += 1
        else if (parsed.outcome === 'failed' || parsed.outcome === 'blocked') failed += 1
        else if (parsed.outcome === 'denied') {
          denied += 1
          deniedCounts.set(parsed.tool, (deniedCounts.get(parsed.tool) ?? 0) + 1)
        }
      }
    }

    return {
      totalCalls: total,
      successCount: success,
      failedCount: failed,
      deniedCount: denied,
      successRate: total === 0 ? 0 : success / total,
      topTools: rank(toolCounts, 5),
      topDenied: rank(deniedCounts, 5)
    }
  }
}

function renderEntry(entry: FeedbackEntry): string {
  const time = formatTime(entry.timestamp)
  const lines = [`- ${time} | ${entry.tool} | ${entry.outcome}`]
  lines.push(`  - Args: ${codeSpan(jsonInline(entry.args))}`)
  if (entry.outcome === 'denied' || entry.outcome === 'blocked') {
    if (entry.reason && entry.reason.trim().length > 0) {
      lines.push(`  - Reason: ${oneLine(entry.reason)}`)
    }
  } else if (entry.outcome === 'failed') {
    if (entry.error && entry.error.trim().length > 0) {
      lines.push(`  - Error: ${truncate(oneLine(entry.error), OUTPUT_PREVIEW_CHARS)}`)
    }
  } else if (entry.output && entry.output.trim().length > 0) {
    lines.push(`  - Output: ${codeSpan(truncate(oneLine(entry.output), OUTPUT_PREVIEW_CHARS))}`)
  }
  return `${lines.join('\n')}\n\n`
}

function parseEntryLine(line: string): { tool: string; outcome: FeedbackOutcome } | null {
  const m = /^-\s+\d{2}:\d{2}\s+\|\s+([^|]+?)\s+\|\s+(\S+)\s*$/.exec(line)
  if (!m) return null
  const tool = m[1].trim()
  const outcomeRaw = m[2].trim() as FeedbackOutcome
  if (!['success', 'failed', 'denied', 'approved', 'blocked'].includes(outcomeRaw)) return null
  return { tool, outcome: outcomeRaw }
}

function jsonInline(value: unknown): string {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return String(value)
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trimEnd()}…`
}

// Pick a backtick run one longer than the longest run in the content so the
// span renders cleanly even when the args/output contain backticks.
function codeSpan(content: string): string {
  const longest = (content.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0)
  const fence = '`'.repeat(longest + 1)
  const pad = content.startsWith('`') || content.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${content}${pad}${fence}`
}

function rank(counts: Map<string, number>, limit: number): Array<{ tool: string; count: number }> {
  return [...counts.entries()]
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
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
  return `${hh}:${mm}`
}
