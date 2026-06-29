import { diskWriter } from '@main/io/diskWriter'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Corpus } from '@main/runtime/corpus'

/**
 * Hippocampus is the memory layer.
 *
 * Maps to: the hippocampus — a seahorse-shaped structure deep in the
 * temporal lobe responsible for forming new memories, consolidating them
 * during sleep, and threading them into the cortex's long-term store.
 * Damage it and you can still remember the past, but you can't form
 * anything new (the famous Patient H.M. case).
 *
 * In Wolffish memory works in three stages, the same way the brain
 * does it:
 *   1. Episodes — daily logs in hippocampus/episodes/YYYY-MM-DD.md
 *   2. Consolidated — weekly summaries in hippocampus/consolidated/YYYY-WNN.md
 *   3. Knowledge — long-lived facts in hippocampus/knowledge/*.md
 * The nightly heartbeat consolidates and promotes; nothing important is
 * ever lost, but day-to-day chatter doesn't drown out long-term context.
 */

export type ToolOutcome = 'success' | 'failed' | 'denied' | 'blocked'

export type TurnToolCall = {
  name: string
  argsSummary: string
  outcome: ToolOutcome
}

export type TurnSummary = {
  timestamp: Date
  userMessage: string
  toolCalls: TurnToolCall[]
  assistantResponse: string
}

export type Episode = {
  date: string
  content: string
}

export type MemorySource = 'episode' | 'consolidated' | 'knowledge'

export type MemorySearchResult = {
  source: MemorySource
  path: string
  snippet: string
  score: number
}

export type KnowledgeFile = 'projects' | 'people' | 'preferences' | 'technical' | 'decisions'

export type ConsolidationRange = 'daily' | 'weekly'

export type HippocampusOptions = {
  workspaceRoot?: string
  corpus?: Corpus
}

const RESPONSE_PREVIEW_CHARS = 200
const HEADLINE_PREVIEW_CHARS = 80
// Episodes are a log of WHAT happened, not a verbatim archive — the full
// message lives in brain/conversations/*.json and is reachable via
// wolffish_recall. Capping the user line keeps a single giant prompt (e.g. a
// multi-KB "role" brief) from bloating the history section of every future
// system prompt for the next two days.
const USER_PREVIEW_CHARS = 280

export class Hippocampus {
  private workspaceRoot: string | null
  private corpus: Corpus | null

  constructor(options: HippocampusOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? null
    this.corpus = options.corpus ?? null
  }

  /**
   * Append a turn summary to today's episode file. Creates the file with
   * a date header if it doesn't exist yet.
   */
  async appendEpisode(turn: TurnSummary): Promise<void> {
    if (!this.workspaceRoot) return
    const dir = path.join(this.workspaceRoot, 'brain', 'hippocampus', 'episodes')
    const date = formatDate(turn.timestamp)
    const filename = `${date}.md`
    const filepath = path.join(dir, filename)

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

    const block = renderTurn(turn)
    const body = (needsHeader ? `# ${date}\n\n` : '') + block

    try {
      await diskWriter.appendLine(filepath, body)
    } catch {
      return
    }

    this.corpus?.emit('memory.episodeSaved', {
      date,
      section: headline(turn.userMessage)
    })
  }

  /**
   * Read the most recent episode files in chronological order. The
   * window includes today even if today's file is empty.
   */
  async getRecentEpisodes(days = 2): Promise<Episode[]> {
    if (!this.workspaceRoot) return []
    const dir = path.join(this.workspaceRoot, 'brain', 'hippocampus', 'episodes')
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return []
    }

    const dated = entries
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .sort()
      .slice(-days)

    const out: Episode[] = []
    for (const name of dated) {
      try {
        const raw = await fs.readFile(path.join(dir, name), 'utf8')
        const content = raw.trim()
        if (content.length === 0) continue
        out.push({ date: name.replace(/\.md$/, ''), content })
      } catch {
        // skip unreadable files
      }
    }
    return out
  }

  /**
   * Read today's episode file. Returns null if it doesn't exist or is empty.
   */
  async getTodayEpisode(): Promise<Episode | null> {
    return this.getEpisode(formatDate(new Date()))
  }

  /**
   * Read a specific day's episode file by ISO date (YYYY-MM-DD).
   */
  async getEpisode(date: string): Promise<Episode | null> {
    if (!this.workspaceRoot) return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
    const filepath = path.join(this.workspaceRoot, 'brain', 'hippocampus', 'episodes', `${date}.md`)
    try {
      const raw = await fs.readFile(filepath, 'utf8')
      const content = raw.trim()
      if (content.length === 0) return null
      return { date, content }
    } catch {
      return null
    }
  }

  /**
   * Append a long-lived fact to one of the knowledge files. Used at the
   * end of consolidation when something graduates from "noise of the
   * week" into "true about the user".
   */
  async promoteToKnowledge(file: KnowledgeFile, fact: string): Promise<void> {
    if (!this.workspaceRoot) return
    const filepath = path.join(
      this.workspaceRoot,
      'brain',
      'hippocampus',
      'knowledge',
      `${file}.md`
    )
    const trimmed = fact.trim()
    if (trimmed.length === 0) return
    const line = trimmed.startsWith('-') ? trimmed : `- ${trimmed}`

    try {
      await fs.mkdir(path.dirname(filepath), { recursive: true })
    } catch {
      return
    }

    let existing = ''
    try {
      existing = await fs.readFile(filepath, 'utf8')
    } catch {
      existing = `# ${capitalize(file)}\n\n`
    }

    const needsNewline = existing.length > 0 && !existing.endsWith('\n')
    const body = `${needsNewline ? '\n' : ''}${line}\n`
    try {
      await diskWriter.appendLine(filepath, body)
    } catch {
      return
    }

    this.corpus?.emit('memory.knowledgeUpdated', { file, fact: trimmed })
  }

  /**
   * Write a weekly digest to consolidated/YYYY-WNN.md. Used by the
   * nightly compaction job in brainstem.
   */
  async writeConsolidated(weekKey: string, content: string): Promise<void> {
    if (!this.workspaceRoot) return
    if (!/^\d{4}-W\d{2}$/.test(weekKey)) return
    const dir = path.join(this.workspaceRoot, 'brain', 'hippocampus', 'consolidated')
    const filepath = path.join(dir, `${weekKey}.md`)
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch {
      return
    }
    let existing = ''
    try {
      existing = await fs.readFile(filepath, 'utf8')
    } catch {
      existing = ''
    }
    const header = existing.length === 0 ? `# ${weekKey}\n\n` : ''
    const sep = existing.length > 0 && !existing.endsWith('\n\n') ? '\n\n' : ''
    try {
      await diskWriter.appendLine(filepath, `${header}${sep}${content.trim()}\n`)
    } catch {
      return
    }
    this.corpus?.emit('memory.consolidated', { week: weekKey })
  }
}

function renderTurn(turn: TurnSummary): string {
  const time = formatTime(turn.timestamp)
  const head = `## ${time} — ${headline(turn.userMessage)}\n`
  const userLine = `- **User:** ${truncate(oneLine(turn.userMessage), USER_PREVIEW_CHARS) || '(empty)'}\n`
  const toolLine =
    turn.toolCalls.length > 0
      ? `- **Tools:** ${turn.toolCalls.map(formatToolCall).join(', ')}\n`
      : `- **Tools:** none\n`
  const responsePreview = truncate(oneLine(turn.assistantResponse), RESPONSE_PREVIEW_CHARS)
  const responseLine = `- **Response:** ${responsePreview || '(empty)'}\n\n`
  return head + userLine + toolLine + responseLine
}

function formatToolCall(call: TurnToolCall): string {
  const args = call.argsSummary ? ` ${call.argsSummary}` : ''
  return `${call.name}${args} (${call.outcome})`
}

function headline(text: string): string {
  const collapsed = oneLine(text)
  return truncate(collapsed, HEADLINE_PREVIEW_CHARS) || '(empty)'
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trimEnd()}…`
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

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}
