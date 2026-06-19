/**
 * Corpus is the event bus that connects every brain region.
 *
 * Maps to: the corpus callosum — the thick band of fibers connecting the two
 * hemispheres of the brain. It carries signals between regions so that
 * perception, memory, planning, and motor control can act in concert without
 * any single region knowing the others' internals.
 *
 * In Wolffish, modules publish typed events (`task.completed`,
 * `memory.episodeSaved`, `safety.blocked`, ...) and other modules subscribe.
 * The bus is for "this happened" notifications — when something needs a
 * direct request/response (prefrontal asks cortex for search results), call
 * the module directly.
 */

import { is } from '@electron-toolkit/utils'
import mitt, { type Emitter, type Handler } from 'mitt'
import fs from 'node:fs/promises'
import path from 'node:path'

export type CorpusEvents = {
  'message.received': { content: string; timestamp: string }
  'message.classified': {
    type: 'question' | 'command' | 'conversation'
    complexity: 'simple' | 'complex'
  }

  'context.built': { tokenCount: number; tokenBudget: number; sectionsIncluded: string[] }

  'tools.filtered': { total: number; kept: number; dropped: string[] }

  'llm.request': { provider: string; model: string }
  'llm.response': {
    provider: string
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
    durationMs: number
  }
  'llm.error': { provider: string; error: string }
  'llm.fallback': { from: string; to: string; reason: string }
  'llm.retry': { provider: string; attempt: number; delayMs: number; errorClass: string }
  'llm.reasoning_effort.stripped': { model: string; reason: string }
  // Whole-turn roll-up emitted once per agent turn, with the cache split
  // priced separately so caching wins are measurable from the corpus log.
  'turn.usage': {
    provider: string
    model: string
    iterations: number
    toolCalls: number
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
    cacheHitRate: number
    cost: number
  }

  'tool.called': { taskId: string; tool: string; args: Record<string, unknown> }
  'tool.completed': { taskId: string; tool: string; durationMs: number }
  'tool.failed': { taskId: string; tool: string; error: string; attempt: number }

  'task.created': { taskId: string; name: string; stepsTotal: number }
  'task.stepCompleted': { taskId: string; step: number; total: number }
  'task.completed': { taskId: string; durationMs: number }
  'task.failed': { taskId: string; failedAt: number; error: string }
  'task.stopped': { taskId: string; stoppedAt: number }

  'dependency.checking': { capability: string; dependency: string }
  'dependency.missing': { capability: string; dependency: string }
  'dependency.satisfied': { capability: string; dependency: string; cached: boolean }
  'dependency.installing': { capability: string; dependency: string }
  'dependency.approved': { capability: string; dependency: string }
  'dependency.denied': { capability: string; dependency: string }
  'dependency.installed': { capability: string; dependency: string }
  'dependency.failed': { capability: string; dependency: string; error: string }

  'dependency.npm.installing': { capability: string; deps: string[] }
  'dependency.npm.installed': { capability: string }
  'dependency.npm.failed': { capability: string; error?: string }

  'security.credentialBlocked': { type: string; messageDiscarded: true }

  'safety.allowed': { tool: string; args: Record<string, unknown> }
  'safety.blocked': { tool: string; args: Record<string, unknown>; reason: string }
  'safety.confirmNeeded': {
    id: string
    tool: string
    args: Record<string, unknown>
    reason: string
  }
  'safety.approved': { id: string }
  'safety.denied': { id: string }
  'safety.autoApproved': {
    id: string
    tool: string
    args: Record<string, unknown>
    level: string
    reason: string
  }

  'compaction.started': { messagesCount: number; force?: boolean }
  'compaction.applied': { tokensSaved: number; targetsCount: number }

  'memory.episodeSaved': { date: string; section: string }
  'memory.consolidated': { week: string }
  'memory.knowledgeUpdated': { file: string; fact: string }

  'feedback.recorded': {
    action: string
    outcome: 'success' | 'failure' | 'approved' | 'rejected'
  }

  'health.warning': { resource: string; usage: number; threshold: number }
  'health.critical': { resource: string; message: string }

  'index.reindexed': { filesCount: number; durationMs: number }

  'brainstem.jobStarted': { job: string; type: string; label: string; timestamp: string }
  'brainstem.jobCompleted': {
    job: string
    type: string
    label: string
    timestamp: string
    durationMs: number
  }
  'brainstem.jobFailed': {
    job: string
    type: string
    label: string
    timestamp: string
    error: string
  }
  'brainstem.jobSkipped': { job: string; label: string; reason: string }
  'brainstem.schedulerReloaded': { jobs: number; timestamp: string }

  'usage.recorded': {
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    cost: number
  }

  'voice.generating': { voice: string; textLength: number }
  'voice.generated': { filePath: string; sizeBytes: number; textLength: number }
  'voice.failed': { error: string }

  'upload.started': { originalName: string; type: string; sizeBytes: number }
  'upload.completed': { filePath: string; type: string; sizeBytes: number }
  'upload.failed': { error: string }
  'upload.deleted': { filePath: string }

  'stt.dep.checking': { dependency: string }
  'stt.dep.installing': { dependency: string; note?: string }
  'stt.dep.ready': { dependency: string }
  'stt.dep.failed': { dependency: string; error: string }
  'stt.transcribing': { filePath: string; model: string }
  'stt.transcribed': { language: string; segmentCount: number; textLength: number }
  'stt.failed': { error: string }
  'stt.detecting': { filePath: string }
  'stt.detected': { language: string; confidence: number }

  'telegram.started': { allowedUserCount: number }
  'telegram.stopped': { reason?: string }
  'telegram.statusChanged': Record<string, never>
  'telegram.error': {
    kind: 'token' | 'network' | 'rate_limit' | 'send' | 'unknown'
    message: string
  }
  'telegram.media.received': {
    chatId: number
    userId: number
    type: string
    filePath: string
    sizeBytes: number
  }

  'whatsapp.started': Record<string, never>
  'whatsapp.stopped': { reason?: string }
  'whatsapp.statusChanged': Record<string, never>
  'whatsapp.qr': { qr: string }
  'whatsapp.loggedOut': Record<string, never>
  'whatsapp.error': {
    kind: 'auth' | 'network' | 'crypto' | 'stream' | 'unknown'
    message: string
  }
  'whatsapp.message.received': { remoteJid: string; body: string }
  'whatsapp.message.sent': { remoteJid: string }

  'conversation.changed': { conversationId: string | null; title?: string | null }
}

export type CorpusEvent = keyof CorpusEvents
export type CorpusListener<K extends CorpusEvent> = Handler<CorpusEvents[K]>
export type CorpusUnsubscribe = () => void

export type CorpusOptions = {
  workspaceRoot?: string
  flushIntervalMs?: number
  retentionDays?: number
  devLog?: boolean
}

type BufferedEvent = {
  name: CorpusEvent
  payload: unknown
  timestamp: Date
}

// Batch event writes so a chatty turn doesn't fsync once per emit. 2s
// keeps the on-disk log close enough to live for tail-style debugging
// while still amortizing many events per write. Lost events on a hard
// crash are bounded to <2s of activity, which is acceptable for a log.
const FLUSH_INTERVAL_MS = 2000
const RETENTION_DAYS = 7

export class Corpus {
  private emitter: Emitter<CorpusEvents> = mitt<CorpusEvents>()
  private buffer: BufferedEvent[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private readonly logsDir: string | null
  private readonly flushIntervalMs: number
  private readonly retentionDays: number
  private readonly devLog: boolean

  constructor(options: CorpusOptions = {}) {
    this.logsDir = options.workspaceRoot
      ? path.join(options.workspaceRoot, 'brain', 'corpus')
      : null
    this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS
    this.retentionDays = options.retentionDays ?? RETENTION_DAYS
    this.devLog = options.devLog ?? is.dev

    this.emitter.on('*', (type, payload) => {
      const timestamp = new Date()
      this.buffer.push({ name: type as CorpusEvent, payload, timestamp })
      if (this.devLog) {
        console.log(`[${formatTimestamp(timestamp)}] ${String(type)}`, payload)
      }
    })

    if (this.logsDir) {
      void this.purgeOldLogs()
      this.flushTimer = setInterval(() => void this.flush(), this.flushIntervalMs)
      this.flushTimer.unref?.()
    }
  }

  emit<K extends CorpusEvent>(event: K, payload: CorpusEvents[K]): void {
    this.emitter.emit(event, payload)
  }

  on<K extends CorpusEvent>(event: K, listener: CorpusListener<K>): CorpusUnsubscribe {
    this.emitter.on(event, listener)
    return () => this.emitter.off(event, listener)
  }

  off<K extends CorpusEvent>(event: K, listener: CorpusListener<K>): void {
    this.emitter.off(event, listener)
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    await this.flush()
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0 || !this.logsDir) return
    const items = this.buffer.splice(0, this.buffer.length)

    try {
      await fs.mkdir(this.logsDir, { recursive: true })
    } catch {
      return
    }

    const grouped = new Map<string, string[]>()
    for (const item of items) {
      const date = formatDate(item.timestamp)
      const filename = `${date}.log.md`
      const block = `## ${formatTimestamp(item.timestamp)}\n- ${item.name} → ${safeStringify(item.payload)}\n\n`
      const list = grouped.get(filename) ?? []
      list.push(block)
      grouped.set(filename, list)
    }

    for (const [filename, blocks] of grouped) {
      const filepath = path.join(this.logsDir, filename)
      const date = filename.replace(/\.log\.md$/, '')
      let needsHeader = true
      try {
        await fs.access(filepath)
        needsHeader = false
      } catch {
        // file doesn't exist — write header
      }
      const body = (needsHeader ? `# ${date}\n\n` : '') + blocks.join('')
      try {
        await fs.appendFile(filepath, body, 'utf8')
      } catch {
        // best-effort: drop on persistent IO failure rather than retry-loop
      }
    }
  }

  private async purgeOldLogs(): Promise<void> {
    if (!this.logsDir) return
    let entries: string[]
    try {
      entries = await fs.readdir(this.logsDir)
    } catch {
      return
    }
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000
    for (const name of entries) {
      if (!/^\d{4}-\d{2}-\d{2}\.log\.md$/.test(name)) continue
      const filepath = path.join(this.logsDir, name)
      try {
        const stat = await fs.stat(filepath)
        if (stat.mtimeMs < cutoff) {
          await fs.unlink(filepath)
        }
      } catch {
        // skip unreadable entries
      }
    }
  }
}

function formatDate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTimestamp(d: Date): string {
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const seconds = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hours}:${minutes}:${seconds}.${ms}`
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
