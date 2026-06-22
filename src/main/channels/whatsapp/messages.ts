import type { proto } from '@whiskeysockets/baileys'

/**
 * Message wrapper keys that WhatsApp nests real content inside.
 * Recursively unwrapped (up to 4 levels) before extraction.
 */
const WRAPPER_KEYS: ReadonlyArray<keyof proto.IMessage> = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage'
]

/**
 * Recursively unwrap WhatsApp message wrappers to reach the inner
 * content message. Returns the deepest non-wrapper message found,
 * or the original if no wrappers are present.
 */
export function unwrapMessage(msg: proto.IMessage, depth = 0): proto.IMessage {
  if (depth >= 4) return msg
  for (const key of WRAPPER_KEYS) {
    const wrapper = msg[key] as { message?: proto.IMessage } | undefined
    if (wrapper?.message) return unwrapMessage(wrapper.message, depth + 1)
  }
  return msg
}

/**
 * Extract text body from an inbound WhatsApp message. Follows the
 * same priority chain OpenClaw uses:
 *  1. conversation (plain text)
 *  2. extendedTextMessage.text
 *  3. caption from image/video/document
 *  4. media placeholder for non-text content
 */
export function extractTextBody(raw: proto.IWebMessageInfo): string | null {
  const msg = raw.message
  if (!msg) return null

  const inner = unwrapMessage(msg)

  // Plain text
  const conversation = inner.conversation?.trim()
  if (conversation) return conversation

  // Extended text (links, formatting, mentions)
  const extended = inner.extendedTextMessage?.text?.trim()
  if (extended) return extended

  // Captions on media
  const caption =
    inner.imageMessage?.caption?.trim() ??
    inner.videoMessage?.caption?.trim() ??
    inner.documentMessage?.caption?.trim()
  if (caption) return caption

  // Media placeholders — let the agent know something was sent
  if (inner.imageMessage) return '<media:image>'
  if (inner.videoMessage) return '<media:video>'
  if (inner.audioMessage) return '<media:audio>'
  if (inner.documentMessage) return '<media:document>'
  if (inner.stickerMessage) return '<media:sticker>'
  if (inner.locationMessage) {
    const lat = inner.locationMessage.degreesLatitude
    const lng = inner.locationMessage.degreesLongitude
    return `<location:${lat},${lng}>`
  }
  if (inner.contactMessage) {
    const name = inner.contactMessage.displayName
    return name ? `<contact:${name}>` : '<contact>'
  }

  return null
}

/**
 * True when the message is a push-to-talk voice note (the mic button),
 * which we download + transcribe. Forwarded music / attached audio files
 * (audioMessage without ptt) are intentionally excluded — they keep the
 * '<media:audio>' placeholder behaviour, mirroring Telegram which only
 * transcribes `message:voice` and treats `message:audio` as a plain file.
 */
export function isInboundVoiceNote(raw: proto.IWebMessageInfo): boolean {
  const msg = raw.message
  if (!msg) return false
  return unwrapMessage(msg).audioMessage?.ptt === true
}

/**
 * Determine whether an inbound message should be forwarded to the
 * agent pipeline or silently dropped. Mirrors OpenClaw's filter chain.
 */
export function shouldProcessMessage(msg: proto.IWebMessageInfo): boolean {
  const key = msg.key
  if (!key?.remoteJid) return false

  // Drop status broadcasts and broadcast lists
  if (key.remoteJid.endsWith('@broadcast')) return false
  if (key.remoteJid.endsWith('@status')) return false
  if (key.remoteJid === 'status@broadcast') return false

  // Drop protocol messages with no user content
  if (!msg.message) return false
  if (hasOnlyProtocolContent(msg.message)) return false

  return true
}

/**
 * Returns true when the message contains only protocol-level content
 * (receipts, typing, reactions, protocol messages) with nothing the
 * agent could meaningfully process.
 */
function hasOnlyProtocolContent(msg: proto.IMessage): boolean {
  const inner = unwrapMessage(msg)

  // These are protocol/system messages, not user content
  if (inner.protocolMessage) return true
  if (inner.reactionMessage) return true
  if (inner.senderKeyDistributionMessage && !inner.conversation && !inner.extendedTextMessage)
    return true

  return false
}

/**
 * Extract the message timestamp as a JS Date. Baileys stores
 * timestamps as either a number (unix seconds) or a Long object.
 */
export function messageTimestamp(msg: proto.IWebMessageInfo): Date {
  const ts = msg.messageTimestamp
  if (!ts) return new Date()
  if (typeof ts === 'number') return new Date(ts * 1000)
  // Long object — toNumber() gives us seconds
  if (typeof (ts as { toNumber?: () => number }).toNumber === 'function') {
    return new Date((ts as { toNumber: () => number }).toNumber() * 1000)
  }
  return new Date(Number(ts) * 1000)
}

/**
 * Extract the sender's phone-format JID from a message key.
 * For DMs this is remoteJid; for groups it's participant.
 * Returns null if the JID is a LID without phone mapping.
 */
export function senderJid(msg: proto.IWebMessageInfo): string | null {
  const key = msg.key
  if (!key?.remoteJid) return null

  // Group messages — participant holds the sender
  if (key.remoteJid.endsWith('@g.us')) {
    return key.participant ?? null
  }

  // DMs — remoteJid is the sender
  return key.remoteJid
}

/**
 * Check whether a JID is a LID (Linked Identity) rather than a
 * phone-based JID. LID JIDs cannot be messaged directly without
 * a phone mapping.
 */
export function isLidJid(jid: string): boolean {
  return /@(lid|hosted\.lid)$/i.test(jid)
}
