import type { Agent } from '@main/runtime/agent'
import type { Corpus } from '@main/runtime/corpus'
import type { Cortex } from '@main/runtime/cortex'
import type { Hippocampus, KnowledgeFile } from '@main/runtime/hippocampus'
import type { ChatMessage, Thalamus } from '@main/runtime/thalamus'
import { DEFAULT_COMPACTION, type CompactionConfig } from '@main/workspace/workspace'
import chokidar, { type FSWatcher } from 'chokidar'
import cron, { type ScheduledTask } from 'node-cron'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Brainstem runs the autonomic background work — the things that keep
 * the agent alive without anyone deciding to do them.
 *
 * Maps to: the brainstem — the stalk that connects the brain to the
 * spinal cord. It runs heart rate, breathing, blood pressure, the
 * sleep-wake cycle. You don't have to think about any of it; the
 * brainstem just runs it, and if it stops, you stop.
 *
 * In Wolffish, Brainstem owns three background concerns: a chokidar
 * watcher that drives cortex reindexing, a cron scheduler that fires
 * jobs declared in brainstem/heartbeat.md, and the nightly compaction
 * job that summarizes the day's episodes and promotes the worthwhile
 * facts into long-term knowledge.
 */

export type ScheduleKind =
  | 'daily'
  | 'weekly'
  | 'every'
  | 'hourly'
  | 'weekday'
  | 'monthly'
  | 'startup'
  | 'cron'

export type BrainstemJob = {
  id: string
  type: ScheduleKind
  cron: string | null
  label: string
  body: string
  task: ScheduledTask | null
}

export type CompactionResult = {
  date: string
  promoted: number
  skipped: boolean
  reason?: string
}

export type BrainstemOptions = {
  workspaceRoot?: string
  corpus?: Corpus
  cortex?: Cortex
  hippocampus?: Hippocampus
  thalamus?: Thalamus
  watcherDebounceMs?: number
  agent?: Agent
}

const KNOWLEDGE_FILES: readonly KnowledgeFile[] = [
  'projects',
  'people',
  'preferences',
  'technical',
  'decisions'
]

const COMPACTION_SYSTEM_PROMPT =
  'You are the consolidation pass for a personal AI agent. Your job is to extract durable, long-term facts from a single day of conversation logs.'

const COMPACTION_USER_PREFIX = `Summarize the following daily log into key facts worth remembering long-term.
Extract: user preferences learned, project details mentioned, decisions made, people referenced.
Output as markdown sections matching: projects.md, people.md, preferences.md, technical.md, decisions.md
Only include facts that are genuinely worth remembering beyond today.
If nothing is worth promoting, say "Nothing to promote."

DAILY LOG:
`

const NOTHING_TO_PROMOTE = /nothing to promote/i

const DEFAULT_DEBOUNCE_MS = 500
const MIN_EPISODE_ENTRIES_FOR_COMPACTION = 3

// ── Schedule heading regexes ──────────────────────────────────────────
const STARTUP_RE = /^Startup$/i
const EVERY_RE = /^Every\s*\((\d+)(m|h)\)$/i
const HOURLY_RE = /^Hourly\s*\(:?(\d{1,2})\)$/i
const DAILY_NIGHTLY_RE = /^(?:Nightly|Daily)\s*\((\d{1,2}):(\d{2})\)$/i
const WEEKDAY_RE = /^Weekday\s*\((\d{1,2}):(\d{2})\)$/i
const WEEKLY_RE =
  /^Weekly\s*\((Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+(\d{1,2}):(\d{2})\)/i
const MONTHLY_RE = /^Monthly\s*\((\d{1,2})\s+(\d{1,2}):(\d{2})\)$/i
const CRON_RE = /^Cron\s*\((.+)\)$/i

const DAY_OF_WEEK: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
}

export type ParsedSchedule = {
  id: string
  kind: ScheduleKind
  cron: string | null
  label: string
  body: string
}

export type RunningJobInfo = {
  id: string
  label: string
  body: string
  startedAt: number
}

export type JobLogEntry = {
  id: string
  timestamp: number
  kind: 'text' | 'tool_call' | 'tool_result' | 'started' | 'completed' | 'failed' | 'skipped'
  summary: string
}

export type BrainstemListener = {
  onJobStarted?: (info: RunningJobInfo) => void
  onJobEnded?: (payload: { id: string; status: 'completed' | 'failed'; error?: string }) => void
  onJobLog?: (entry: JobLogEntry) => void
}

export class Brainstem {
  private workspaceRoot: string | null
  private corpus: Corpus | null
  private cortex: Cortex | null
  private hippocampus: Hippocampus | null
  private thalamus: Thalamus | null
  private agent: Agent | null
  private watcher: FSWatcher | null = null
  private jobs = new Map<string, BrainstemJob>()
  private pendingIndex = new Map<string, NodeJS.Timeout>()
  private runningJobs = new Set<string>()
  private runningJobInfo: RunningJobInfo | null = null
  private jobQueue: Promise<void> = Promise.resolve()
  private compactionTasks: ScheduledTask[] = []
  private compactionConfig: CompactionConfig = DEFAULT_COMPACTION
  private readonly debounceMs: number
  private listener: BrainstemListener | null = null

  constructor(options: BrainstemOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? null
    this.corpus = options.corpus ?? null
    this.cortex = options.cortex ?? null
    this.hippocampus = options.hippocampus ?? null
    this.thalamus = options.thalamus ?? null
    this.agent = options.agent ?? null
    this.debounceMs = options.watcherDebounceMs ?? DEFAULT_DEBOUNCE_MS
  }

  setAgent(agent: Agent): void {
    this.agent = agent
  }

  setListener(listener: BrainstemListener | null): void {
    this.listener = listener
  }

  getRunningJob(): RunningJobInfo | null {
    return this.runningJobInfo
  }

  async init(): Promise<void> {
    await this.startWatcher()
    await this.startScheduler()
    this.startCompactionScheduler()
  }

  async stop(): Promise<void> {
    await this.stopAll()
  }

  async stopAll(): Promise<void> {
    this.stopCompactionScheduler()
    await this.stopScheduler()
    await this.stopWatcher()
  }

  async startWatcher(): Promise<void> {
    if (this.watcher) return
    if (!this.workspaceRoot) return

    const root = path.join(this.workspaceRoot, 'brain')
    let watcher: FSWatcher
    try {
      watcher = chokidar.watch(root, {
        ignoreInitial: true,
        persistent: true,
        ignored: (filepath) => shouldIgnoreWatch(filepath)
      })
    } catch {
      return
    }
    this.watcher = watcher

    const onFileChange = (filepath: string, action: 'index' | 'remove'): void => {
      if (isHeartbeatFile(filepath)) {
        void this.reloadScheduler()
        return
      }
      this.scheduleIndex(filepath, action)
    }

    watcher.on('add', (fp) => onFileChange(fp, 'index'))
    watcher.on('change', (fp) => onFileChange(fp, 'index'))
    watcher.on('unlink', (fp) => onFileChange(fp, 'remove'))
    watcher.on('error', () => {})
  }

  async stopWatcher(): Promise<void> {
    for (const timer of this.pendingIndex.values()) clearTimeout(timer)
    this.pendingIndex.clear()
    if (!this.watcher) return
    try {
      await this.watcher.close()
    } catch {
      // best-effort
    }
    this.watcher = null
  }

  async startScheduler(): Promise<void> {
    if (this.jobs.size > 0) return
    if (!this.workspaceRoot) return

    const heartbeatPath = path.join(this.workspaceRoot, 'brain', 'brainstem', 'heartbeat.md')
    let raw: string
    try {
      raw = await fs.readFile(heartbeatPath, 'utf8')
    } catch {
      return
    }

    const schedules = parseHeartbeat(raw)
    const startupJobs: ParsedSchedule[] = []

    for (const schedule of schedules) {
      if (schedule.kind === 'startup') {
        startupJobs.push(schedule)
        this.jobs.set(schedule.id, {
          id: schedule.id,
          type: schedule.kind,
          cron: null,
          label: schedule.label,
          body: schedule.body,
          task: null
        })
        continue
      }

      if (!schedule.cron) continue
      const handler = this.handlerFor(schedule.kind, schedule.body, schedule.label)
      if (!handler) continue

      let task: ScheduledTask
      try {
        task = cron.schedule(schedule.cron, async () => {
          await this.executeJob(schedule, handler)
        })
      } catch {
        continue
      }
      this.jobs.set(schedule.id, {
        id: schedule.id,
        type: schedule.kind,
        cron: schedule.cron,
        label: schedule.label,
        body: schedule.body,
        task
      })
    }

    for (const startup of startupJobs) {
      const handler = this.handlerFor(startup.kind, startup.body, startup.label)
      if (!handler) continue
      void this.executeJob(startup, handler)
    }
  }

  async stopScheduler(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (!job.task) continue
      try {
        await job.task.stop()
      } catch {
        // best-effort
      }
    }
    this.jobs.clear()
  }

  private async reloadScheduler(): Promise<void> {
    await this.stopScheduler()
    await this.startScheduler()
    this.corpus?.emit('brainstem.schedulerReloaded', {
      jobs: this.jobs.size,
      timestamp: new Date().toISOString()
    })
  }

  getActiveJobs(): Array<{
    id: string
    type: ScheduleKind
    cron: string | null
    label: string
    body: string
  }> {
    return [...this.jobs.values()].map((j) => ({
      id: j.id,
      type: j.type,
      cron: j.cron,
      label: j.label,
      body: j.body
    }))
  }

  async runCompaction(date?: string, jobId?: string): Promise<CompactionResult> {
    const targetDate = date ?? formatDate(new Date())
    const log = (kind: JobLogEntry['kind'], summary: string): void => {
      if (jobId) {
        this.listener?.onJobLog?.({ id: jobId, timestamp: Date.now(), kind, summary })
      }
    }

    if (!this.hippocampus || !this.thalamus) {
      return { date: targetDate, promoted: 0, skipped: true, reason: 'not configured' }
    }

    log('text', `Fetching episode for ${targetDate}`)
    const episode = await this.hippocampus.getEpisode(targetDate)
    if (!episode) {
      log('text', 'No episode found — skipping')
      return { date: targetDate, promoted: 0, skipped: true, reason: 'no episode' }
    }

    const entryCount = countEpisodeEntries(episode.content)
    if (entryCount < MIN_EPISODE_ENTRIES_FOR_COMPACTION) {
      log('text', `Only ${entryCount} entries — skipping`)
      return { date: targetDate, promoted: 0, skipped: true, reason: 'too few entries' }
    }

    log('text', `Analyzing ${entryCount} episode entries`)

    const messages: ChatMessage[] = [
      { role: 'user', content: `${COMPACTION_USER_PREFIX}${episode.content}` }
    ]

    let response = ''
    try {
      for await (const chunk of this.thalamus.stream({
        system: COMPACTION_SYSTEM_PROMPT,
        messages
      })) {
        if (chunk.type === 'text') response += chunk.text
        else if (chunk.type === 'error') {
          return {
            date: targetDate,
            promoted: 0,
            skipped: true,
            reason: `llm error: ${chunk.message}`
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { date: targetDate, promoted: 0, skipped: true, reason: `llm error: ${message}` }
    }

    if (NOTHING_TO_PROMOTE.test(response.trim())) {
      log('text', 'Nothing to promote')
      await this.hippocampus.writeConsolidated(
        weekKey(targetDate),
        summaryHeader(targetDate, response)
      )
      return { date: targetDate, promoted: 0, skipped: false, reason: 'nothing to promote' }
    }

    const sections = parsePromotionSections(response)
    let promoted = 0
    for (const [file, facts] of sections) {
      for (const fact of facts) {
        await this.hippocampus.promoteToKnowledge(file, fact)
        promoted += 1
        log('tool_result', `Promoted fact to ${file}`)
      }
    }

    log('text', `Promoted ${promoted} fact${promoted === 1 ? '' : 's'} to knowledge`)

    await this.hippocampus.writeConsolidated(
      weekKey(targetDate),
      summaryHeader(targetDate, response)
    )

    return { date: targetDate, promoted, skipped: false }
  }

  private async executeJob(schedule: ParsedSchedule, handler: () => Promise<void>): Promise<void> {
    if (this.runningJobs.size > 0) {
      this.corpus?.emit('brainstem.jobSkipped', {
        job: schedule.id,
        label: schedule.label,
        reason: 'another job is running'
      })
      this.listener?.onJobLog?.({
        id: schedule.id,
        timestamp: Date.now(),
        kind: 'skipped',
        summary: `Skipped "${schedule.label}" — another job is running`
      })
      return
    }
    this.runningJobs.add(schedule.id)
    const start = Date.now()
    const info: RunningJobInfo = {
      id: schedule.id,
      label: schedule.label,
      body: schedule.body,
      startedAt: start
    }
    this.runningJobInfo = info
    this.corpus?.emit('brainstem.jobStarted', {
      job: schedule.id,
      type: schedule.kind,
      label: schedule.label,
      timestamp: new Date(start).toISOString()
    })
    this.listener?.onJobStarted?.(info)
    this.listener?.onJobLog?.({
      id: schedule.id,
      timestamp: start,
      kind: 'started',
      summary: `Started "${schedule.label}"`
    })
    try {
      await handler()
      this.corpus?.emit('brainstem.jobCompleted', {
        job: schedule.id,
        type: schedule.kind,
        label: schedule.label,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start
      })
      this.listener?.onJobEnded?.({ id: schedule.id, status: 'completed' })
      this.listener?.onJobLog?.({
        id: schedule.id,
        timestamp: Date.now(),
        kind: 'completed',
        summary: `Completed "${schedule.label}" in ${Math.round((Date.now() - start) / 1000)}s`
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.corpus?.emit('brainstem.jobFailed', {
        job: schedule.id,
        type: schedule.kind,
        label: schedule.label,
        timestamp: new Date().toISOString(),
        error: message
      })
      this.listener?.onJobEnded?.({ id: schedule.id, status: 'failed', error: message })
      this.listener?.onJobLog?.({
        id: schedule.id,
        timestamp: Date.now(),
        kind: 'failed',
        summary: `Failed "${schedule.label}": ${message}`
      })
    } finally {
      this.runningJobs.delete(schedule.id)
      this.runningJobInfo = null
    }
  }

  private handlerFor(
    _kind: ScheduleKind,
    body: string,
    label: string
  ): (() => Promise<void>) | null {
    if (body.trim().length === 0) return null
    return () => this.runHeartbeatJob(body, label)
  }

  private runHeartbeatJob(instruction: string, label: string): Promise<void> {
    if (!this.agent) return Promise.resolve()
    const job = this.jobQueue.then(() =>
      this.agent!.processAutonomous({ instruction, jobLabel: label }).then(() => undefined)
    )
    this.jobQueue = job.catch(() => undefined)
    return job
  }

  private async runWeeklyReview(jobId?: string): Promise<void> {
    const log = (kind: JobLogEntry['kind'], summary: string): void => {
      if (jobId) {
        this.listener?.onJobLog?.({ id: jobId, timestamp: Date.now(), kind, summary })
      }
    }

    if (!this.hippocampus) return
    const today = new Date()
    log('text', 'Fetching recent episodes')
    const recent = await this.hippocampus.getRecentEpisodes(7)
    if (recent.length === 0) {
      log('text', 'No episodes found — skipping')
      return
    }
    log('text', `Consolidating ${recent.length} episode${recent.length === 1 ? '' : 's'}`)
    const digest = recent.map((ep) => `## ${ep.date}\n\n${ep.content}`).join('\n\n---\n\n')
    await this.hippocampus.writeConsolidated(weekKey(formatDate(today)), digest)
    log('text', 'Weekly digest written')
  }

  // ── Config-driven compaction scheduler ────────────────────────────────

  private startCompactionScheduler(): void {
    this.stopCompactionScheduler()
    const cfg = this.compactionConfig

    // Daily compaction
    const dailyCron = `0 ${cfg.dailyHour} * * *`
    try {
      this.compactionTasks.push(
        cron.schedule(dailyCron, () => {
          void this.executeJob(
            {
              id: 'compaction-daily',
              kind: 'daily',
              cron: dailyCron,
              label: 'Daily compaction',
              body: 'heartbeat.overlay.compactionDaily'
            },
            () => this.runCompaction(undefined, 'compaction-daily').then(() => undefined)
          )
        })
      )
    } catch {
      /* invalid cron — shouldn't happen with validated hours */
    }

    // Weekly consolidation
    const weeklyCron = `0 ${cfg.weeklyHour} * * ${cfg.weeklyDay}`
    try {
      this.compactionTasks.push(
        cron.schedule(weeklyCron, () => {
          void this.executeJob(
            {
              id: 'compaction-weekly',
              kind: 'weekly',
              cron: weeklyCron,
              label: 'Weekly consolidation',
              body: 'heartbeat.overlay.compactionWeekly'
            },
            () => this.runWeeklyReview('compaction-weekly')
          )
        })
      )
    } catch {
      /* invalid cron */
    }
  }

  private stopCompactionScheduler(): void {
    for (const task of this.compactionTasks) {
      try {
        task.stop()
      } catch {
        /* best-effort */
      }
    }
    this.compactionTasks = []
  }

  setCompactionConfig(config: CompactionConfig): void {
    this.compactionConfig = config
    this.startCompactionScheduler()
  }

  getCompactionConfig(): CompactionConfig {
    return { ...this.compactionConfig }
  }

  private scheduleIndex(filepath: string, action: 'index' | 'remove'): void {
    if (!this.cortex) return
    if (!filepath.toLowerCase().endsWith('.md')) return
    if (shouldIgnoreWatch(filepath)) return

    const existing = this.pendingIndex.get(filepath)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.pendingIndex.delete(filepath)
      void this.dispatchIndex(filepath, action)
    }, this.debounceMs)
    this.pendingIndex.set(filepath, timer)
  }

  private async dispatchIndex(filepath: string, action: 'index' | 'remove'): Promise<void> {
    if (!this.cortex) return
    try {
      if (action === 'remove') await this.cortex.removeFile(filepath)
      else await this.cortex.indexFile(filepath)
    } catch {
      // a single failed index shouldn't break the watcher loop
    }
  }
}

// ── File-watcher ignore rules ─────────────────────────────────────────

function shouldIgnoreWatch(filepath: string): boolean {
  const normalized = filepath.replace(/\\/g, '/')
  if (normalized.endsWith('cortex.db')) return true
  if (normalized.endsWith('cortex.db-wal') || normalized.endsWith('cortex.db-shm')) return true
  if (normalized.includes('/.debug/')) return true
  if (normalized.includes('/brain/corpus/')) return true
  if (/\.log\.md$/i.test(normalized)) return true
  const base = path.basename(normalized)
  if (base.startsWith('.')) return true
  return false
}

function isHeartbeatFile(filepath: string): boolean {
  return filepath.replace(/\\/g, '/').endsWith('/brain/brainstem/heartbeat.md')
}

// ── Heartbeat parser ──────────────────────────────────────────────────

export function parseHeartbeat(raw: string): ParsedSchedule[] {
  const out: ParsedSchedule[] = []
  const stripped = raw.replace(/<!--[\s\S]*?-->/g, '')
  const lines = stripped.split(/\r?\n/)
  const idCounters = new Map<string, number>()

  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(/^##\s+(.+?)\s*$/)
    if (!heading) continue

    const headingText = heading[1]
    const body = collectBody(lines, i + 1)
    const parsed = matchSchedule(headingText)

    if (!parsed) continue

    const count = (idCounters.get(parsed.kind) ?? 0) + 1
    idCounters.set(parsed.kind, count)
    const id = count > 1 ? `${parsed.kind}-${count}` : parsed.kind

    out.push({
      id,
      kind: parsed.kind,
      cron: parsed.cron,
      label: headingText,
      body
    })
  }

  return out
}

function collectBody(lines: string[], startIndex: number): string {
  const bodyLines: string[] = []
  for (let j = startIndex; j < lines.length; j++) {
    if (/^##\s+/.test(lines[j])) break
    if (/^---+\s*$/.test(lines[j])) continue
    bodyLines.push(lines[j])
  }
  return bodyLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function matchSchedule(text: string): { kind: ScheduleKind; cron: string | null } | null {
  // Startup — no cron, runs once on init
  if (STARTUP_RE.test(text)) {
    return { kind: 'startup', cron: null }
  }

  // Every (Nm) or Every (Nh)
  const every = EVERY_RE.exec(text)
  if (every) {
    const n = Number(every[1])
    const unit = every[2].toLowerCase()
    if (unit === 'm') return { kind: 'every', cron: `*/${n} * * * *` }
    return { kind: 'every', cron: `0 */${n} * * *` }
  }

  // Hourly (:MM) or Hourly (MM)
  const hourly = HOURLY_RE.exec(text)
  if (hourly) {
    const mm = Number(hourly[1])
    return { kind: 'hourly', cron: `${mm} * * * *` }
  }

  // Daily (HH:MM) or Nightly (HH:MM) — both parse as 'daily'
  const daily = DAILY_NIGHTLY_RE.exec(text)
  if (daily) {
    const hh = Number(daily[1])
    const mm = Number(daily[2])
    return { kind: 'daily', cron: `${mm} ${hh} * * *` }
  }

  // Weekday (HH:MM)
  const weekday = WEEKDAY_RE.exec(text)
  if (weekday) {
    const hh = Number(weekday[1])
    const mm = Number(weekday[2])
    return { kind: 'weekday', cron: `${mm} ${hh} * * 1-5` }
  }

  // Weekly (Day HH:MM)
  const weekly = WEEKLY_RE.exec(text)
  if (weekly) {
    const day = DAY_OF_WEEK[weekly[1].toLowerCase()] ?? 0
    const hh = Number(weekly[2])
    const mm = Number(weekly[3])
    return { kind: 'weekly', cron: `${mm} ${hh} * * ${day}` }
  }

  // Monthly (DD HH:MM)
  const monthly = MONTHLY_RE.exec(text)
  if (monthly) {
    const dd = Number(monthly[1])
    const hh = Number(monthly[2])
    const mm = Number(monthly[3])
    return { kind: 'monthly', cron: `${mm} ${hh} ${dd} * *` }
  }

  // Cron (raw expression)
  const cronMatch = CRON_RE.exec(text)
  if (cronMatch) {
    const expression = cronMatch[1].trim()
    if (cron.validate(expression)) {
      return { kind: 'cron', cron: expression }
    }
    return null
  }

  return null
}

// ── Compaction helpers ────────────────────────────────────────────────

function parsePromotionSections(response: string): Map<KnowledgeFile, string[]> {
  const result = new Map<KnowledgeFile, string[]>()
  const lines = response.split(/\r?\n/)
  let current: KnowledgeFile | null = null
  for (const raw of lines) {
    const line = raw.trim()
    const header = matchKnowledgeHeader(line)
    if (header) {
      current = header
      if (!result.has(current)) result.set(current, [])
      continue
    }
    if (!current) continue
    if (line.length === 0) continue
    if (line.startsWith('-') || line.startsWith('*')) {
      const fact = line.replace(/^[-*]\s*/, '').trim()
      if (fact.length > 0 && !/^nothing to promote$/i.test(fact)) {
        result.get(current)!.push(fact)
      }
    }
  }
  return result
}

function matchKnowledgeHeader(line: string): KnowledgeFile | null {
  const m = /^#{1,4}\s+(.+?)\s*$/.exec(line)
  if (!m) return null
  const stripped = m[1].toLowerCase().replace(/\.md$/, '').replace(/[`*_]/g, '').trim()
  for (const file of KNOWLEDGE_FILES) {
    if (stripped === file) return file
  }
  return null
}

function countEpisodeEntries(content: string): number {
  let count = 0
  for (const line of content.split(/\r?\n/)) {
    if (/^##\s+\d{2}:\d{2}\s+/.test(line)) count += 1
  }
  return count
}

function summaryHeader(date: string, body: string): string {
  return `## Compaction for ${date}\n\n${body.trim()}`
}

function weekKey(dateStr: string): string {
  const d = parseDateString(dateStr)
  if (!d) return formatWeekKey(new Date())
  return formatWeekKey(d)
}

function parseDateString(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function formatWeekKey(d: Date): string {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

function formatDate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
