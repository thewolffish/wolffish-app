import type {
  Capability,
  SkillToolDescriptor,
  ToolExecutionResult,
  WolffishPlugin
} from '@main/runtime/cerebellum'
import { workspaceRoot } from '@main/workspace/workspace'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Bot, InputFile } from 'grammy'

/**
 * Capability name used to register Telegram tools with the cerebellum.
 * Lives outside brain/cerebellum/ — it's an in-process capability the
 * channel manages directly.
 */
export const TELEGRAM_CAPABILITY_NAME = 'telegram'

/**
 * Bot upload caps published by Telegram. Photos go through the
 * compressed-image path with a 10 MB ceiling; documents/video/audio
 * use the multipart path which tops out at 50 MB. Voice notes have
 * the same 50 MB document limit. Niche file types (stickers, video
 * notes) aren't exposed as tools — they'd be more confusing than
 * useful for the LLM.
 */
const PHOTO_LIMIT = 10 * 1024 * 1024
const DOCUMENT_LIMIT = 50 * 1024 * 1024

type ToolDeps = {
  getBot: () => Bot | null
  getAllowedUserIds: () => Set<number>
  /**
   * Records every outgoing message id with the channel's per-chat
   * tracker so /clear can later delete it. Optional — older
   * call sites that don't pass this still work, the messages
   * just won't be cleared by /clear.
   */
  trackOutgoing?: (chatId: number, messageId: number) => void
}

/**
 * Build the Telegram capability + plugin pair to register with the
 * cerebellum while the bot is running. The LLM gets the widely-used
 * primitives (text, media, edit) — niche features like stickers,
 * locations, dice, polls and forum messages are intentionally left
 * out so the surface area stays small and predictable.
 *
 * The plugin captures references to the bot and allowed-id set,
 * not values, so settings changes that swap the bot or adjust the
 * id list take effect on the next tool call without re-registration.
 */
export function buildTelegramCapability(deps: ToolDeps): {
  capability: Capability
  plugin: WolffishPlugin
} {
  const tools: SkillToolDescriptor[] = [
    {
      name: 'telegram_send',
      description:
        'Send a plain text message to one of the allowed Telegram users. Use to notify the user out-of-band — for example when a long-running task you started in the chat finishes. Plain text only; no markdown. Returns the Telegram message_id so a later edit can target this message.',
      parameters: {
        message: {
          type: 'string',
          description: 'The message body. 1–4096 characters. Plain text.',
          required: true
        },
        userId: {
          type: 'number',
          description:
            'Optional Telegram user ID. Must be in the allowed list. Defaults to the first allowed user.',
          required: false
        }
      }
    },
    {
      name: 'telegram_send_photo',
      description:
        'Send an image to one of the allowed Telegram users. The path must point to a file inside the workspace (e.g. uploads/conv-{id}/foo.png). Up to 10 MB; PNG / JPEG / WebP. Returns the message_id.',
      parameters: {
        path: {
          type: 'string',
          description:
            'Workspace-relative path to the image file (e.g. "uploads/conv-2026-05-02_12-00-00/diagram.png").',
          required: true
        },
        caption: {
          type: 'string',
          description: 'Optional caption shown beneath the image. Up to 1024 characters.',
          required: false
        },
        userId: {
          type: 'number',
          description: 'Optional Telegram user ID. Defaults to the first allowed user.',
          required: false
        }
      }
    },
    {
      name: 'telegram_send_document',
      description:
        'Send any file (text, PDF, archive, etc.) to one of the allowed Telegram users. Up to 50 MB. The original filename is preserved. Returns the message_id.',
      parameters: {
        path: {
          type: 'string',
          description: 'Workspace-relative path to the file.',
          required: true
        },
        caption: {
          type: 'string',
          description: 'Optional caption shown beneath the document.',
          required: false
        },
        userId: {
          type: 'number',
          description: 'Optional Telegram user ID. Defaults to the first allowed user.',
          required: false
        }
      }
    },
    {
      name: 'telegram_send_video',
      description:
        'Send a video file to one of the allowed Telegram users. Up to 50 MB; MP4 streams reliably across clients. Returns the message_id.',
      parameters: {
        path: {
          type: 'string',
          description: 'Workspace-relative path to the video file.',
          required: true
        },
        caption: {
          type: 'string',
          description: 'Optional caption shown beneath the video.',
          required: false
        },
        userId: {
          type: 'number',
          description: 'Optional Telegram user ID. Defaults to the first allowed user.',
          required: false
        }
      }
    },
    {
      name: 'telegram_send_audio',
      description:
        'Send an audio file (rendered as a music player) to one of the allowed Telegram users. Up to 50 MB; MP3 / M4A / OGG. Returns the message_id.',
      parameters: {
        path: {
          type: 'string',
          description: 'Workspace-relative path to the audio file.',
          required: true
        },
        caption: {
          type: 'string',
          description: 'Optional caption shown beneath the audio.',
          required: false
        },
        userId: {
          type: 'number',
          description: 'Optional Telegram user ID. Defaults to the first allowed user.',
          required: false
        }
      }
    },
    {
      name: 'telegram_edit_message',
      description:
        'Edit the text of a previously-sent Telegram message. Pass the message_id from the original send result. Useful for live progress updates without spamming the chat with new messages.',
      parameters: {
        messageId: {
          type: 'number',
          description: 'The message_id returned from a previous telegram_send call.',
          required: true
        },
        message: {
          type: 'string',
          description: 'New text body. 1–4096 characters. Plain text.',
          required: true
        },
        userId: {
          type: 'number',
          description:
            'Optional Telegram user ID — must be the same chat the original message was sent to. Defaults to the first allowed user.',
          required: false
        }
      }
    }
  ]

  const capability: Capability = {
    name: TELEGRAM_CAPABILITY_NAME,
    dir: '<in-process>',
    description:
      'Out-of-band Telegram messaging. Send text and media to allowed users, or edit a message you sent earlier. Use to notify the user when they are not actively in the chat (e.g. a background task finished) or to deliver an artifact you just produced.\n\nChannel context: only one Telegram conversation processes at a time. The Telegram bot runtime intercepts a handful of slash commands BEFORE they reach you — these are user-to-runtime controls, NOT tools available to you, and you must never call any tool that imitates them:\n\n- `/new` — the runtime starts a fresh conversation.\n- `/current` — the runtime shows the conversation this chat is currently bound to.\n- `/resume` — the runtime shows a numbered picker of past conversations and switches the chat to the chosen one.\n- `/delete` — the runtime shows a numbered picker and deletes the chosen conversation.\n- `/clear` — the runtime deletes the visible Telegram messages without touching the Wolffish conversation file.\n- `/stop` — the runtime cancels the active task.\n- `/approve` and `/deny` — the runtime resolves a pending confirmation prompt.\n- `/status` — the runtime renders an introspection report directly via the insula. **Because /status already covers this on Telegram, you must NOT call introspection tools like `wolffish_status`, `wolffish_recent`, or any other reflective tool on a Telegram turn.** They duplicate /status and produce a long report the user did not ask for. The only exception is when the user explicitly asks a question that ONLY an introspection tool can answer (e.g. "what tasks failed yesterday") — and even then, prefer to summarize from your own context first.\n\nIf a Telegram user asks how to start over, switch conversations, or delete one, point them at the matching slash command — don\'t try to manage conversation state yourself. Otherwise stay focused on whatever the user actually asked for.',
    triggers: { keywords: ['telegram', 'notify', 'message me', 'send to telegram'] },
    tools,
    body: '',
    hasPlugin: true,
    status: 'ok',
    requires: [],
    packages: {},
    npmDependencies: {}
  }

  const plugin: WolffishPlugin = {
    name: TELEGRAM_CAPABILITY_NAME,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: toJsonSchema(t.parameters)
    })),
    execute: async (toolName, args) => {
      const bot = deps.getBot()
      if (!bot) return failure('Telegram bot is not running')

      switch (toolName) {
        case 'telegram_send':
          return sendText(bot, deps, args)
        case 'telegram_send_photo':
          return sendMedia(bot, deps, args, 'photo')
        case 'telegram_send_document':
          return sendMedia(bot, deps, args, 'document')
        case 'telegram_send_video':
          return sendMedia(bot, deps, args, 'video')
        case 'telegram_send_audio':
          return sendMedia(bot, deps, args, 'audio')
        case 'telegram_edit_message':
          return editText(bot, deps, args)
        default:
          return failure(`unknown telegram tool: ${toolName}`)
      }
    }
  }

  return { capability, plugin }
}

async function sendText(
  bot: Bot,
  deps: ToolDeps,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const message = stringArg(args.message)
  if (!message) return failure('message is required and must be a non-empty string')
  if (message.length > 4096) {
    return failure(`message too long: ${message.length} > 4096 characters`)
  }
  const target = resolveTarget(deps, args.userId)
  if (!target.ok) return failure(target.error)
  try {
    const result = await bot.api.sendMessage(target.id, message)
    deps.trackOutgoing?.(target.id, result.message_id)
    return success(`Sent. message_id=${result.message_id} to=${target.id}`)
  } catch (err) {
    return failure(`send failed: ${errMessage(err)}`)
  }
}

type MediaKind = 'photo' | 'document' | 'video' | 'audio'

async function sendMedia(
  bot: Bot,
  deps: ToolDeps,
  args: Record<string, unknown>,
  kind: MediaKind
): Promise<ToolExecutionResult> {
  const relativePath = stringArg(args.path)
  if (!relativePath) return failure('path is required (workspace-relative)')

  const abs = resolveWorkspaceFilePath(relativePath)
  if (!abs) {
    return failure(
      `path must be a workspace-relative path inside the workspace root (got "${relativePath}")`
    )
  }

  let stat: import('node:fs').Stats
  try {
    stat = await fs.stat(abs)
  } catch {
    return failure(`file not found: ${relativePath}`)
  }
  if (!stat.isFile()) return failure(`not a file: ${relativePath}`)

  const limit = kind === 'photo' ? PHOTO_LIMIT : DOCUMENT_LIMIT
  if (stat.size > limit) {
    return failure(
      `file too large: ${formatBytes(stat.size)} > ${formatBytes(limit)} (telegram bot limit for ${kind})`
    )
  }

  const target = resolveTarget(deps, args.userId)
  if (!target.ok) return failure(target.error)

  const caption = stringArg(args.caption) ?? undefined
  if (caption && caption.length > 1024) {
    return failure(`caption too long: ${caption.length} > 1024 characters`)
  }

  let buffer: Buffer
  try {
    buffer = await fs.readFile(abs)
  } catch (err) {
    return failure(`read failed: ${errMessage(err)}`)
  }

  const filename = path.basename(abs)
  const file = new InputFile(buffer, filename)

  try {
    let result: { message_id: number }
    if (kind === 'photo') {
      result = await bot.api.sendPhoto(target.id, file, caption ? { caption } : undefined)
    } else if (kind === 'video') {
      result = await bot.api.sendVideo(target.id, file, caption ? { caption } : undefined)
    } else if (kind === 'audio') {
      result = await bot.api.sendAudio(target.id, file, caption ? { caption } : undefined)
    } else {
      result = await bot.api.sendDocument(target.id, file, caption ? { caption } : undefined)
    }
    deps.trackOutgoing?.(target.id, result.message_id)
    return success(`Sent. message_id=${result.message_id} to=${target.id} kind=${kind}`)
  } catch (err) {
    return failure(`send failed: ${errMessage(err)}`)
  }
}

async function editText(
  bot: Bot,
  deps: ToolDeps,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const messageId = numberArg(args.messageId)
  if (messageId == null) return failure('messageId is required (number)')
  const message = stringArg(args.message)
  if (!message) return failure('message is required and must be a non-empty string')
  if (message.length > 4096) {
    return failure(`message too long: ${message.length} > 4096 characters`)
  }
  const target = resolveTarget(deps, args.userId)
  if (!target.ok) return failure(target.error)
  try {
    await bot.api.editMessageText(target.id, messageId, message)
    return success(`Edited. message_id=${messageId} to=${target.id}`)
  } catch (err) {
    return failure(`edit failed: ${errMessage(err)}`)
  }
}

function resolveTarget(
  deps: ToolDeps,
  userIdArg: unknown
): { ok: true; id: number } | { ok: false; error: string } {
  const allowed = deps.getAllowedUserIds()
  if (allowed.size === 0) {
    return {
      ok: false,
      error: 'no allowed Telegram users configured — add user IDs in Settings → Telegram first'
    }
  }
  const requested = numberArg(userIdArg)
  const id = requested ?? allowed.values().next().value
  if (typeof id !== 'number') {
    return { ok: false, error: 'no target user id available' }
  }
  if (!allowed.has(id)) {
    return { ok: false, error: `user id ${id} is not in the allowed list` }
  }
  return { ok: true, id }
}

/**
 * Resolve a workspace-relative path to an absolute path on disk,
 * refusing absolute paths and `..` traversal so the LLM tool can only
 * read files inside ~/.wolffish/workspace. Returns null when the
 * path would escape the workspace.
 */
function resolveWorkspaceFilePath(relativePath: string): string | null {
  if (relativePath.includes('..')) return null
  if (path.isAbsolute(relativePath)) return null
  const root = workspaceRoot()
  const abs = path.resolve(root, relativePath)
  if (abs !== root && !abs.startsWith(root + path.sep)) return null
  return abs
}

function stringArg(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? value : null
}

function numberArg(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value)
  return null
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function success(output: string): ToolExecutionResult {
  return { success: true, output }
}

function failure(error: string): ToolExecutionResult {
  return { success: false, error }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/**
 * Convert the inline parameter spec on each tool into the JSON Schema
 * shape thalamus expects when handing tools to the LLM. Mirrors what
 * cerebellum's disk-loaded plugins do at registration time.
 */
function toJsonSchema(parameters: SkillToolDescriptor['parameters']): {
  type: 'object'
  properties: Record<string, { type: string; description: string }>
  required: string[]
} {
  const properties: Record<string, { type: string; description: string }> = {}
  const required: string[] = []
  for (const [name, spec] of Object.entries(parameters)) {
    properties[name] = {
      type: spec.type ?? 'string',
      description: spec.description ?? ''
    }
    if (spec.required) required.push(name)
  }
  return { type: 'object', properties, required }
}
