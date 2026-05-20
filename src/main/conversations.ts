import fs from 'node:fs/promises'
import path from 'node:path'
import { workspaceRoot } from '@main/workspace/workspace'
import { readConfig } from '@main/workspace/workspace'
import { streamChat, detect as detectOllama } from '@main/ollama'
import type { Segment, SegmentTurnEndReason } from '@main/runtime/broca'
import type { PersistedApproval, PersistedToolTiming } from '@preload/index'

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
}

/**
 * Where the conversation originated. `electron` is the in-app chat;
 * `telegram` is the Telegram bot. Optional for backward compatibility
 * with conversation files written before the field shipped — those
 * are treated as `electron` by default.
 */
export type ConversationChannel = 'electron' | 'telegram' | 'whatsapp' | 'heartbeat'

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
  return [
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
    return JSON.parse(raw) as ConversationFile
  } catch {
    return null
  }
}

export async function saveConversation(conv: ConversationFile): Promise<void> {
  const dir = conversationsDir()
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(filePathForId(conv.id), JSON.stringify(conv, null, 2), 'utf8')
}

export async function deleteConversation(id: string): Promise<void> {
  try {
    await fs.unlink(filePathForId(id))
  } catch {
    // already gone
  }

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

export async function generateTitle(conv: ConversationFile): Promise<string | null> {
  const userMsg = conv.messages.find((m) => m.role === 'user')
  const assistantMsg = conv.messages.find((m) => m.role === 'assistant')
  if (!userMsg || !assistantMsg) return null

  const cfg = await readConfig()
  const model = cfg?.llm.local.model
  const endpoint = cfg?.llm.local.endpoint
  if (!model) return null

  const reachable = await detectOllama(endpoint)
  if (!reachable) return null

  try {
    const result = await streamChat({
      endpoint,
      model,
      messages: [
        {
          role: 'system',
          content:
            'Generate a concise title (3-6 words) summarizing this conversation topic. Reply with only the title, nothing else. No quotes, no punctuation at the end.'
        },
        { role: 'user', content: userMsg.content },
        { role: 'assistant', content: assistantMsg.content },
        { role: 'user', content: 'Generate the title now.' }
      ],
      onToken: () => {},
      temperature: 0.3
    })
    const title = result.text.trim().replace(/^["']|["']$/g, '')
    if (title.length > 0 && title.length < 100) return title
    return null
  } catch {
    return null
  }
}
