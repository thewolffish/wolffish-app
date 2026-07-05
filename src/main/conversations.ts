import { diskWriter } from '@main/io/diskWriter'
import type { Segment, SegmentTurnEndReason } from '@main/runtime/broca'
import type { NoProviderAvailableInfo } from '@main/runtime/thalamus'
import { workspaceRoot } from '@main/workspace/workspace'
import type { PersistedApproval, PersistedToolTiming } from '@preload/index'
import nlp from 'compromise'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export type MessageAttachmentType = 'audio' | 'video' | 'image' | 'pdf' | 'other'

export type MessageAttachment = {
  type: MessageAttachmentType
  /** Path relative to workspace root, e.g. "uploads/conv-2026-05-01_14-30-45/photo.png". */
  filePath: string
  originalName: string
  mimeType: string
  sizeBytes: number
  width?: number
  height?: number
  durationSeconds?: number
}

export type ConversationMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  attachments?: MessageAttachment[]
  /**
   * True when this user message originated from a transcribed voice
   * note (Telegram's press-and-hold mic). The transcript IS the
   * prompt — the audio attachment is preserved on disk for chat
   * replay only and must NOT be re-exposed to the LLM as additional
   * context. The Telegram history builder reads this flag to decide
   * whether to emit the attachments + `<attachments>` metadata block
   * to the agent. Absent / false on every other message kind,
   * including non-voice audio uploads (those go through the normal
   * media path and DO surface to the LLM).
   */
  voicePrompt?: boolean
  /**
   * For a voice-note user message, the language Whisper detected in the
   * audio (ISO 639-1, e.g. "en", "ar"). Threaded into the `<voice_note
   * lang="…">` history tag so the model has a deterministic signal of
   * which language to reply in — Whisper's detection beats the model
   * guessing from a short transcript. Absent when detection returned
   * nothing or for non-voice messages.
   */
  voiceLang?: string
  /**
   * Full segment stream for assistant messages — text deltas, tool
   * calls, tool results, active_model chips, turn_end. Saved by the
   * Electron channel (via the renderer's persistConversation) and
   * the Telegram channel both, so the in-app history view replays
   * the exact sequence the user saw, with tool cards, approvals,
   * and timing intact.
   */
  segments?: Segment[]
  approvals?: Record<string, PersistedApproval>
  toolTimings?: Record<string, PersistedToolTiming>
  stopReason?: SegmentTurnEndReason
  error?: string
}

/**
 * Where the conversation originated. `electron` is the in-app chat;
 * `telegram` is the Telegram bot. Optional for backward compatibility
 * with conversation files written before the field shipped — those
 * are treated as `electron` by default.
 */
export type ConversationChannel = 'electron' | 'telegram' | 'whatsapp' | 'heartbeat' | 'procedure'

export type TimelineEntry = {
  id: string
  timestamp: number
  kind: string
  summary?: string
  detail?: string
}

/** Frozen roll-up of the most recent completed turn (dual decl — see src/preload/index.ts). */
export type ConversationTurnStats = {
  endedAt: number
  elapsedMs: number
  apiMs: number
  apiCalls: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  cost: number
  provider: string | null
  model: string | null
}

/**
 * Persisted per-conversation tokenomics (dual decl — see src/preload/index.ts).
 * Written by the renderer alongside messages; the context-meter card restores
 * from it on reopen so all-time totals, the last turn's elapsed/token split
 * and the meter reading survive restarts.
 */
export type ConversationStats = {
  allTime: {
    processingMs: number
    apiMs: number
    turns: number
    apiCalls: number
    toolCalls: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    cost: number
  }
  lastTurn: ConversationTurnStats | null
  meter: {
    contextTokens: number
    contextBudget: number
    compactionAt?: number | null
    model?: string | null
  } | null
}

export type ConversationFile = {
  id: string
  title: string
  model: string | null
  messages: ConversationMessage[]
  createdAt: number
  updatedAt: number
  channel?: ConversationChannel
  sealed?: boolean
  workingFolder?: string[] | null
  /** Legacy meter snapshot — superseded by `stats.meter`, still read as a fallback. */
  contextMeter?: { contextTokens: number; contextBudget: number } | null
  stats?: ConversationStats | null
  timeline?: TimelineEntry[]
  /**
   * Rolling prefix summary of messages[0..summarizedThroughMessage-1],
   * written by the post-turn summarizer when a conversation outgrows
   * verbatim replay. Both rebuild paths (renderer textHistory + channel
   * assistantSegmentsToHistory) replay `summary + messages from the mark`
   * instead of the whole transcript — a long conversation pays ONE
   * summarization ever (until it grows again), not a fresh compaction LLM
   * call every turn. Summarized turns stay on disk and indexed:
   * conversation_read retrieves them verbatim.
   */
  summary?: string | null
  /** First message index NOT covered by `summary` (always a user message). */
  summarizedThroughMessage?: number | null
}

export type ConversationMeta = {
  id: string
  title: string
  updatedAt: number
  channel?: ConversationChannel
  /**
   * Number of saved messages on the conversation. Surfaced so list
   * views (Telegram /resume, /delete picker) can show it without
   * having to load each file separately.
   */
  messageCount: number
}

function conversationsDir(): string {
  return path.join(workspaceRoot(), 'brain', 'conversations')
}

/**
 * The single source of truth for the per-conversation directory name.
 * The conversation file itself is `${conversationDirName(id)}.json`, and
 * uploads/voice/speech directories are `<dir>/${conversationDirName(id)}/`
 * so a quick glance at any of them tells you the same conversation.
 *
 * Defensive replacement of unsafe characters: ids are timestamps in normal
 * use, but we treat them as untrusted in case the format changes later or
 * a foreign id leaks in from outside.
 */
export function conversationDirName(id: string): string {
  const safe = (id ?? '').replace(/[^A-Za-z0-9._-]/g, '_')
  return `conv-${safe}`
}

function filePathForId(id: string): string {
  return path.join(conversationsDir(), `${conversationDirName(id)}.json`)
}

function idFromFilename(filename: string): string | null {
  const match = filename.match(/^conv-(.+)\.json$/)
  return match ? match[1] : null
}

function generateId(): string {
  const now = new Date()
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
  const stamp = [
    now.getFullYear(),
    '-',
    pad(now.getMonth() + 1),
    '-',
    pad(now.getDate()),
    '_',
    pad(now.getHours()),
    '-',
    pad(now.getMinutes()),
    '-',
    pad(now.getSeconds())
  ].join('')
  // The id IS the on-disk filename, so it MUST be unique. A second-resolution
  // timestamp alone collides whenever two conversations are created in the same
  // second — e.g. a procedure/automation run firing while a live chat is open —
  // and the second save silently overwrites the first (destroying a whole
  // conversation). Append milliseconds + a random suffix so collisions can't
  // happen; the readable timestamp prefix is kept for human-legible filenames.
  return `${stamp}_${pad(now.getMilliseconds(), 3)}-${randomBytes(3).toString('hex')}`
}

export async function countConversationsSince(sinceMs: number): Promise<number> {
  const dir = conversationsDir()
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return 0
  }
  let count = 0
  for (const entry of entries) {
    const id = idFromFilename(entry)
    if (!id) continue
    try {
      const raw = await fs.readFile(path.join(dir, entry), 'utf8')
      const conv = JSON.parse(raw) as ConversationFile
      if (conv.createdAt >= sinceMs) count++
    } catch {
      continue
    }
  }
  return count
}

export async function listConversations(): Promise<ConversationMeta[]> {
  const dir = conversationsDir()
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }

  const metas: ConversationMeta[] = []
  for (const entry of entries) {
    const id = idFromFilename(entry)
    if (!id) continue
    try {
      const raw = await fs.readFile(path.join(dir, entry), 'utf8')
      const conv = JSON.parse(raw) as ConversationFile
      metas.push({
        id: conv.id,
        title: conv.title,
        updatedAt: conv.updatedAt,
        channel: conv.channel,
        messageCount: conv.messages?.length ?? 0
      })
    } catch {
      continue
    }
  }

  metas.sort((a, b) => b.updatedAt - a.updatedAt)
  return metas
}

export async function loadConversation(id: string): Promise<ConversationFile | null> {
  try {
    const raw = await fs.readFile(filePathForId(id), 'utf8')
    const conv = JSON.parse(raw) as ConversationFile
    migrateSegments(conv)
    return conv
  } catch {
    return null
  }
}

/**
 * Normalize legacy segment shapes so the renderer never needs to
 * check for old field names.
 *
 * - `providerError` (singular object) → `providerErrors` (array)
 */
function migrateSegments(conv: ConversationFile): void {
  for (const msg of conv.messages) {
    if (!msg.segments) continue
    for (const seg of msg.segments) {
      if (seg.kind !== 'turn_end') continue
      const raw = seg as Record<string, unknown>
      if (raw.providerError && !seg.providerErrors) {
        seg.providerErrors = [raw.providerError as NoProviderAvailableInfo]
        delete raw.providerError
      }
    }
  }
}

export async function saveConversation(conv: ConversationFile): Promise<void> {
  await diskWriter.writeFileAtomic(filePathForId(conv.id), JSON.stringify(conv, null, 2))
}

export async function deleteConversation(id: string): Promise<void> {
  await diskWriter.deleteFile(filePathForId(id))

  // Clean up the per-conversation media folders so a deleted chat doesn't
  // leave orphan files on disk. Best-effort: any folder that's missing or
  // unreadable is silently skipped.
  const dir = conversationDirName(id)
  const root = workspaceRoot()
  for (const subroot of ['uploads', 'voice', 'speech']) {
    await fs.rm(path.join(root, subroot, dir), { recursive: true, force: true }).catch(() => {
      // best-effort
    })
  }
}

export function createConversation(model: string | null): ConversationFile {
  const now = Date.now()
  return {
    id: generateId(),
    title: 'Untitled',
    model,
    messages: [],
    createdAt: now,
    updatedAt: now
  }
}

const MAX_TITLE_WORDS = 8

const FILLER_RE = [
  /^(hey|hi|hello|yo|so|ok|okay)\s*[,.]?\s*/i,
  /^(can|could|would) you (please\s+)?/i,
  /^(i need|i want|i'd like|i would like) (you )?to\s+/i,
  /^(i'm trying|i am trying) to\s+/i,
  /^(please|pls)\s+/i,
  /^tell me (about\s+)?/i,
  /^(show|explain|describe) (me\s+)?/i
]

const NOISE_RE =
  /\b(right now|right away|at the moment|for me|for now|just|actually|basically|simply|really|literally)\b/gi

const BREAK_WORDS = new Set([
  'that',
  'which',
  'who',
  'whom',
  'where',
  'when',
  'while',
  'because',
  'since',
  'if',
  'although',
  'unless',
  'after',
  'before',
  'and',
  'but',
  'or',
  'so',
  'yet',
  'with',
  'without',
  'about',
  'from',
  'for',
  'into'
])

const DANGLING = new Set([
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'for',
  'with',
  'from',
  'a',
  'an',
  'the'
])

function stripFiller(s: string): string {
  let out = s
  for (const re of FILLER_RE) out = out.replace(re, '')
  return out.trim() || s
}

function stripNoise(s: string): string {
  const out = s
    .replace(NOISE_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return out || s
}

function stripTrailingRepeat(s: string): string {
  const words = s.split(/\s+/)
  if (words.length < 4) return s
  const head = words[0].toLowerCase()
  for (let i = words.length - 1; i > words.length / 2; i--) {
    if (words[i].toLowerCase() === head) {
      return words.slice(0, i).join(' ')
    }
  }
  return s
}

function smartTruncate(s: string, max: number): string {
  const words = s.split(/\s+/)
  if (words.length <= max) return s

  const half = Math.ceil(max / 2)

  for (let i = max; i >= half; i--) {
    if (BREAK_WORDS.has(words[i]?.toLowerCase())) {
      let cut = i
      while (cut > half && DANGLING.has(words[cut - 1]?.toLowerCase())) cut--
      if (cut >= half) return words.slice(0, cut).join(' ')
    }
  }

  let end = max
  while (end > half && DANGLING.has(words[end - 1]?.toLowerCase())) end--
  return words.slice(0, end).join(' ')
}

export function generateTitle(conv: ConversationFile): string {
  const userMsg = conv.messages.find((m) => m.role === 'user')
  if (!userMsg) return 'Untitled'

  const raw = userMsg.content.trim()
  if (!raw) return 'Untitled'

  const text =
    raw
      .replace(/^```[\s\S]*?```\s*/g, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/(\*{1,3}|_{1,3}|~~|`)(.*?)\1/g, '$2')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s*[-*+>]\s+/gm, '')
      .trim() || raw
  const doc = nlp(text)
  const first = (doc.sentences().first().text() || text).trim()

  let stripped = stripFiller(first)
    .replace(/[?.!]+$/, '')
    .trim()
  stripped = stripNoise(stripped)
  stripped = stripTrailingRepeat(stripped)

  const words = stripped.split(/\s+/)
  if (words.length <= MAX_TITLE_WORDS) {
    return cap(stripped)
  }

  return cap(smartTruncate(stripped, MAX_TITLE_WORDS))
}

function cap(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t) return 'Untitled'
  return t.charAt(0).toUpperCase() + t.slice(1)
}
