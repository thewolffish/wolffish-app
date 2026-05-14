import type {
  Capability,
  SkillToolDescriptor,
  ToolExecutionResult,
  WolffishPlugin
} from '@main/runtime/cerebellum/cerebellum'
import type { WASocket } from '@whiskeysockets/baileys'

export const WHATSAPP_CAPABILITY_NAME = 'whatsapp'

type ToolDeps = {
  getSocket: () => WASocket | null
  trackSentId: (id: string) => void
}

export function buildWhatsAppCapability(deps: ToolDeps): {
  capability: Capability
  plugin: WolffishPlugin
} {
  const tools: SkillToolDescriptor[] = [
    {
      name: 'whatsapp_send',
      description:
        'Send a plain text message to a WhatsApp JID. Use the full JID format: <phone>@s.whatsapp.net for individuals, <id>@g.us for groups. Returns the message ID on success.',
      parameters: {
        jid: {
          type: 'string',
          description:
            'The recipient JID — e.g. "15551234567@s.whatsapp.net" for a person or "120363012345@g.us" for a group.',
          required: true
        },
        message: {
          type: 'string',
          description: 'The message body. Plain text.',
          required: true
        }
      }
    },
    {
      name: 'whatsapp_send_image',
      description:
        'Send an image to a WhatsApp JID. Provide the image as a base64-encoded string. Returns the message ID.',
      parameters: {
        jid: {
          type: 'string',
          description: 'The recipient JID.',
          required: true
        },
        imageBase64: {
          type: 'string',
          description: 'Base64-encoded image data.',
          required: true
        },
        caption: {
          type: 'string',
          description: 'Optional caption shown beneath the image.',
          required: false
        },
        mimetype: {
          type: 'string',
          description: 'MIME type of the image (default: image/jpeg).',
          required: false
        }
      }
    },
    {
      name: 'whatsapp_send_document',
      description:
        'Send a file/document to a WhatsApp JID. Provide the file as a base64-encoded string. Returns the message ID.',
      parameters: {
        jid: {
          type: 'string',
          description: 'The recipient JID.',
          required: true
        },
        documentBase64: {
          type: 'string',
          description: 'Base64-encoded file data.',
          required: true
        },
        fileName: {
          type: 'string',
          description: 'The filename shown to the recipient.',
          required: true
        },
        caption: {
          type: 'string',
          description: 'Optional caption.',
          required: false
        },
        mimetype: {
          type: 'string',
          description: 'MIME type of the document (default: application/octet-stream).',
          required: false
        }
      }
    },
    {
      name: 'whatsapp_send_audio',
      description:
        'Send a voice note (push-to-talk audio) to a WhatsApp JID. Provide the audio as a base64-encoded string. Always sent as PTT (voice note). Returns the message ID.',
      parameters: {
        jid: {
          type: 'string',
          description: 'The recipient JID.',
          required: true
        },
        audioBase64: {
          type: 'string',
          description: 'Base64-encoded audio data (OGG/Opus preferred).',
          required: true
        },
        mimetype: {
          type: 'string',
          description: 'MIME type of the audio (default: audio/ogg; codecs=opus).',
          required: false
        }
      }
    },
    {
      name: 'whatsapp_reply',
      description:
        'Reply to a specific WhatsApp message. The reply appears as a quote-reply in the chat. Returns the message ID.',
      parameters: {
        jid: {
          type: 'string',
          description: 'The chat JID where the original message lives.',
          required: true
        },
        quotedMessageId: {
          type: 'string',
          description: 'The message ID of the message to reply to.',
          required: true
        },
        message: {
          type: 'string',
          description: 'The reply text.',
          required: true
        }
      }
    },
    {
      name: 'whatsapp_react',
      description: 'React to a WhatsApp message with an emoji.',
      parameters: {
        jid: {
          type: 'string',
          description: 'The chat JID where the message lives.',
          required: true
        },
        messageId: {
          type: 'string',
          description: 'The message ID to react to.',
          required: true
        },
        emoji: {
          type: 'string',
          description: 'The reaction emoji (e.g. "👍", "❤️").',
          required: true
        }
      }
    }
  ]

  const capability: Capability = {
    name: WHATSAPP_CAPABILITY_NAME,
    dir: '<in-process>',
    description:
      'WhatsApp messaging via Baileys (Web client). Send text, images, documents, audio, reply to messages, and react to messages. Messages arrive via the WhatsApp Web socket; the agent can respond to inbound messages and proactively send outbound messages to any linked WhatsApp contact or group.',
    triggers: { keywords: ['whatsapp', 'wa', 'send whatsapp', 'message on whatsapp'] },
    tools,
    body: '',
    hasPlugin: true,
    status: 'ok',
    requires: [],
    packages: {},
    npmDependencies: {}
  }

  const plugin: WolffishPlugin = {
    name: WHATSAPP_CAPABILITY_NAME,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: toJsonSchema(t.parameters)
    })),
    execute: async (toolName, args) => {
      const sock = deps.getSocket()
      if (!sock) return failure('WhatsApp is not connected')

      const track = deps.trackSentId
      switch (toolName) {
        case 'whatsapp_send':
          return sendText(sock, args, track)
        case 'whatsapp_send_image':
          return sendImage(sock, args, track)
        case 'whatsapp_send_document':
          return sendDocument(sock, args, track)
        case 'whatsapp_send_audio':
          return sendAudio(sock, args, track)
        case 'whatsapp_reply':
          return replyTo(sock, args, track)
        case 'whatsapp_react':
          return reactTo(sock, args)
        default:
          return failure(`unknown whatsapp tool: ${toolName}`)
      }
    }
  }

  return { capability, plugin }
}

async function sendText(
  sock: WASocket,
  args: Record<string, unknown>,
  track: (id: string) => void
): Promise<ToolExecutionResult> {
  const jid = stringArg(args.jid)
  if (!jid) return failure('jid is required')
  const message = stringArg(args.message)
  if (!message) return failure('message is required')
  try {
    const result = await sock.sendMessage(jid, { text: message })
    if (result?.key.id) track(result.key.id)
    return success(`Sent. messageId=${result?.key.id} to=${jid}`)
  } catch (err) {
    return failure(`send failed: ${errMessage(err)}`)
  }
}

async function sendImage(
  sock: WASocket,
  args: Record<string, unknown>,
  track: (id: string) => void
): Promise<ToolExecutionResult> {
  const jid = stringArg(args.jid)
  if (!jid) return failure('jid is required')
  const b64 = stringArg(args.imageBase64)
  if (!b64) return failure('imageBase64 is required')
  const caption = stringArg(args.caption) ?? undefined
  const mimetype = stringArg(args.mimetype) ?? 'image/jpeg'
  try {
    const buffer = Buffer.from(b64, 'base64')
    const result = await sock.sendMessage(jid, { image: buffer, caption, mimetype })
    if (result?.key.id) track(result.key.id)
    return success(`Sent image. messageId=${result?.key.id} to=${jid}`)
  } catch (err) {
    return failure(`send image failed: ${errMessage(err)}`)
  }
}

async function sendDocument(
  sock: WASocket,
  args: Record<string, unknown>,
  track: (id: string) => void
): Promise<ToolExecutionResult> {
  const jid = stringArg(args.jid)
  if (!jid) return failure('jid is required')
  const b64 = stringArg(args.documentBase64)
  if (!b64) return failure('documentBase64 is required')
  const fileName = stringArg(args.fileName) ?? 'file'
  const caption = stringArg(args.caption) ?? undefined
  const mimetype = stringArg(args.mimetype) ?? 'application/octet-stream'
  try {
    const buffer = Buffer.from(b64, 'base64')
    const result = await sock.sendMessage(jid, { document: buffer, fileName, caption, mimetype })
    if (result?.key.id) track(result.key.id)
    return success(`Sent document. messageId=${result?.key.id} to=${jid}`)
  } catch (err) {
    return failure(`send document failed: ${errMessage(err)}`)
  }
}

async function sendAudio(
  sock: WASocket,
  args: Record<string, unknown>,
  track: (id: string) => void
): Promise<ToolExecutionResult> {
  const jid = stringArg(args.jid)
  if (!jid) return failure('jid is required')
  const b64 = stringArg(args.audioBase64)
  if (!b64) return failure('audioBase64 is required')
  const mimetype = stringArg(args.mimetype) ?? 'audio/ogg; codecs=opus'
  try {
    const buffer = Buffer.from(b64, 'base64')
    const result = await sock.sendMessage(jid, { audio: buffer, ptt: true, mimetype })
    if (result?.key.id) track(result.key.id)
    return success(`Sent audio. messageId=${result?.key.id} to=${jid}`)
  } catch (err) {
    return failure(`send audio failed: ${errMessage(err)}`)
  }
}

async function replyTo(
  sock: WASocket,
  args: Record<string, unknown>,
  track: (id: string) => void
): Promise<ToolExecutionResult> {
  const jid = stringArg(args.jid)
  if (!jid) return failure('jid is required')
  const quotedId = stringArg(args.quotedMessageId)
  if (!quotedId) return failure('quotedMessageId is required')
  const message = stringArg(args.message)
  if (!message) return failure('message is required')
  try {
    const result = await sock.sendMessage(
      jid,
      { text: message },
      {
        quoted: {
          key: { remoteJid: jid, id: quotedId },
          message: { conversation: '' }
        }
      }
    )
    if (result?.key.id) track(result.key.id)
    return success(`Replied. messageId=${result?.key.id} to=${jid}`)
  } catch (err) {
    return failure(`reply failed: ${errMessage(err)}`)
  }
}

async function reactTo(
  sock: WASocket,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const jid = stringArg(args.jid)
  if (!jid) return failure('jid is required')
  const messageId = stringArg(args.messageId)
  if (!messageId) return failure('messageId is required')
  const emoji = stringArg(args.emoji)
  if (!emoji) return failure('emoji is required')
  try {
    await sock.sendMessage(jid, {
      react: { text: emoji, key: { remoteJid: jid, id: messageId } }
    })
    return success(`Reacted with ${emoji} to message ${messageId}`)
  } catch (err) {
    return failure(`react failed: ${errMessage(err)}`)
  }
}

function stringArg(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? value : null
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
