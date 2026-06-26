import type { TelegramChannelStatus } from '@main/channels/telegram/channel'
import type { WhatsAppChannelStatus } from '@main/channels/whatsapp/channel'

/**
 * A point-in-time view of one messaging channel's connectivity, shaped for
 * the agent rather than the settings UI. This is the single source of truth
 * behind both `wolffish_status` (a compact one-liner) and the dedicated
 * `channel_status` tool (the full view with reconnect steps). The agent uses
 * it to decide whether it can reach the user on a channel and, when it can't,
 * to tell them exactly how to reconnect — instead of guessing or trying to
 * GUI-automate a desktop app that isn't there.
 */
export type ChannelStatusSnapshot = {
  /** Stable channel id used in tool output and logs. */
  id: 'telegram' | 'whatsapp' | 'electron'
  /** Human label shown to the user (e.g. "Telegram"). */
  label: string
  /** True when the channel is connected and able to send right now. */
  connected: boolean
  /** Raw lifecycle state (running, connected, qr, disconnected, error, …). */
  state: string
  /** One-line specifics — bot handle, linked phone, or why it's down. */
  detail: string
  /** When NOT connected, concrete steps to (re)connect. Empty when connected. */
  reconnect: string
}

/**
 * Live status getters for the channels that have a connection lifecycle. The
 * in-app (Electron) channel has no getter — it's reported as always available
 * while the desktop app is open.
 */
export type ChannelStatusDeps = {
  telegram: () => TelegramChannelStatus
  whatsapp: () => WhatsAppChannelStatus
}

const TELEGRAM_RECONNECT =
  'Open Settings → Telegram, paste your bot token (from @BotFather) and your allowed Telegram user ID, then enable the channel.'
const WHATSAPP_RECONNECT_QR =
  'Open Settings → WhatsApp and scan the QR code shown there with WhatsApp on your phone (WhatsApp → Settings → Linked Devices → Link a Device).'
const WHATSAPP_RECONNECT_GENERIC =
  'Open Settings → WhatsApp to reconnect — if it shows a QR code, scan it with WhatsApp on your phone (WhatsApp → Settings → Linked Devices → Link a Device).'

/**
 * Snapshot every channel's connectivity. Always returns all channels (in a
 * stable order) so the agent can see which are down, not just which are up.
 */
export function collectChannelStatus(deps: ChannelStatusDeps): ChannelStatusSnapshot[] {
  return [telegramSnapshot(deps.telegram()), whatsappSnapshot(deps.whatsapp()), electronSnapshot()]
}

function telegramSnapshot(s: TelegramChannelStatus): ChannelStatusSnapshot {
  const connected = s.status === 'running'
  let detail: string
  if (connected) {
    detail = s.botUsername ? `connected as @${s.botUsername}` : 'connected'
  } else if (s.status === 'starting') {
    detail = 'starting up — connecting to Telegram'
  } else if (s.status === 'error') {
    detail = s.error ? `error: ${s.error}` : 'connection error'
  } else {
    detail = 'not enabled'
  }
  return {
    id: 'telegram',
    label: 'Telegram',
    connected,
    state: s.status,
    detail,
    reconnect: connected ? '' : TELEGRAM_RECONNECT
  }
}

function whatsappSnapshot(s: WhatsAppChannelStatus): ChannelStatusSnapshot {
  const connected = s.status === 'connected'
  let detail: string
  if (connected) {
    const who = s.connectedName ?? (s.connectedPhone ? `+${s.connectedPhone}` : null)
    detail = who ? `linked to ${who}` : 'connected'
  } else if (s.status === 'qr') {
    detail = 'waiting for a QR scan to link a device'
  } else if (s.status === 'connecting') {
    detail = s.hasSession ? 'reconnecting an existing session' : 'connecting'
  } else if (s.status === 'error') {
    detail = s.error ? `error: ${s.error}` : 'connection error'
  } else {
    detail = 'not linked'
  }
  return {
    id: 'whatsapp',
    label: 'WhatsApp',
    connected,
    state: s.status,
    detail,
    reconnect: connected
      ? ''
      : s.status === 'qr'
        ? WHATSAPP_RECONNECT_QR
        : WHATSAPP_RECONNECT_GENERIC
  }
}

function electronSnapshot(): ChannelStatusSnapshot {
  return {
    id: 'electron',
    label: 'In-app chat',
    connected: true,
    state: 'available',
    detail: 'always available while the desktop app is open',
    reconnect: ''
  }
}
