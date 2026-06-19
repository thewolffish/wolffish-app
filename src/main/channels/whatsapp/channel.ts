import { Boom } from '@hapi/boom'
import { assistantSegmentsToHistory, type TurnSink } from '@main/channels/channel'
import type { TurnRunner } from '@main/channels/turn-runner'
import {
  getConversationIdForJid,
  setConversationIdForJid
} from '@main/channels/whatsapp/conversations'
import { extractTextBody, shouldProcessMessage } from '@main/channels/whatsapp/messages'
import { buildWhatsAppCapability, WHATSAPP_CAPABILITY_NAME } from '@main/channels/whatsapp/tools'
import {
  createConversation,
  deleteConversation,
  generateTitle,
  listConversations,
  loadConversation,
  saveConversation,
  type ConversationFile,
  type ConversationMessage,
  type ConversationMeta
} from '@main/conversations'
import type { Agent } from '@main/runtime/agent'
import type { ApprovalDecision, ApprovalRequest } from '@main/runtime/amygdala'
import type { Segment, SegmentTurnEndReason } from '@main/runtime/broca'
import type { CorpusEvents } from '@main/runtime/corpus'
import type { LocalProvider } from '@main/runtime/providers/local'
import { composeAttachmentContext } from '@main/uploads/compose-attachments'
import {
  getWhatsAppConfig,
  setLocalOnly as persistLocalOnly,
  workspaceRoot
} from '@main/workspace/workspace'
import type {
  ChatHistoryMessage,
  PersistedApproval,
  PersistedToolTiming,
  WhatsAppConfig
} from '@preload/index'
import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
  type BaileysEventMap,
  type proto,
  type WASocket
} from '@whiskeysockets/baileys'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import pino from 'pino'

export type WhatsAppConnectionStatus = 'disconnected' | 'connecting' | 'qr' | 'connected' | 'error'

export type WhatsAppChannelStatus = {
  status: WhatsAppConnectionStatus
  error: string | null
  qr: string | null
  connectedPhone: string | null
  connectedName: string | null
  /**
   * Whether an established (linked) session exists. True means a
   * `connecting` status is a reconnect of an already-paired account, not
   * first-time pairing — the UI shows just a pulsing dot instead of the
   * QR box in that case.
   */
  hasSession: boolean
}

type WhatsAppErrorKind = 'auth' | 'network' | 'crypto' | 'stream' | 'unknown'

const RECONNECT_INITIAL_MS = 2000
const RECONNECT_MAX_MS = 30000
const RECONNECT_FACTOR = 1.8
const RECONNECT_JITTER = 0.25
const RECONNECT_MAX_ATTEMPTS = 12

const STALE_DEFAULT_HOURS = 3

const BUSY_SYSTEM_PROMPT =
  "You are a friendly assistant currently working on a previous task for the user. The user has just sent a NEW message but you cannot address it yet — another task is still running. Reply briefly (1-2 short sentences) acknowledging their new message and politely asking them to wait. Do NOT attempt to answer their question, perform any action, or speculate about an answer. Just say you're busy and will get to it. Be warm and natural."
const BUSY_REPLY_TIMEOUT_MS = 8000
const FALLBACK_BUSY_REPLY = "Hold on — I'm working on something. I'll get back to you in a moment."

const SELECTION_LIMIT = 10

const COMMANDS_HELP =
  '/stop — cancel the current task\n' +
  '/new — start a fresh conversation\n' +
  '/resume — continue a previous chat\n' +
  '/delete — delete a saved conversation\n' +
  '/current — show the active conversation\n' +
  '/status — system status report\n' +
  '/local — switch to local model\n' +
  '/cloud — switch to cloud model'

const KEYCAP_DIGITS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

type ActiveTurn = {
  jid: string
  conversation: ConversationFile
  textBuffer: string
  assistantContent: string
  segments: Segment[]
  approvals: Map<string, PersistedApproval>
  toolTimings: Map<string, PersistedToolTiming>
  stopReason: SegmentTurnEndReason | null
  taskId: string | null
  controller: AbortController
  pendingApprovalId: string | null
  pendingApprovalResolve: ((decision: ApprovalDecision) => void) | null
  toolCallNames: Map<string, string>
  pendingActiveModel: string | null
  lastFlushedModel: string | null
  sentImages: Set<string>
}

type PendingSelection = {
  command: 'resume' | 'delete'
  conversationIds: string[]
}

export class WhatsAppChannel {
  private sock: WASocket | null = null
  private status: WhatsAppConnectionStatus = 'disconnected'
  private statusError: string | null = null
  private currentQr: string | null = null
  private reconnectAttempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private authDir: string | null = null
  private readonly activeByJid = new Map<string, ActiveTurn>()
  private readonly sentIds = new Set<string>()
  private readonly pendingSelections = new Map<string, PendingSelection>()
  private allowedPhoneNumbers: string[] = []
  private readonly lidToPhone = new Map<string, string>()
  private readonly segmentQueue = new Map<string, Promise<void>>()
  private processingEnabled = true
  private qrRequested = false
  private hadValidSession = false
  private connectedAt = 0
  /**
   * Bumped by stop()/logout. connect() captures it before its async
   * setup and bails if it changed — so a stop() that lands while the
   * version fetch is in flight can't have the late catch (or a
   * just-built socket) resurrect a channel the user deliberately closed.
   */
  private connectGeneration = 0

  constructor(
    private readonly agent: Agent,
    private readonly runner: TurnRunner,
    private readonly localProvider: LocalProvider
  ) {}

  getStatus(): WhatsAppChannelStatus {
    const user = this.sock?.user
    return {
      status: this.status,
      error: this.statusError,
      qr: this.currentQr,
      connectedPhone: user?.id ? user.id.split('@')[0].split(':')[0] : null,
      connectedName: user?.notify ?? user?.name ?? null,
      hasSession: this.hadValidSession
    }
  }

  getSocket(): WASocket | null {
    return this.sock
  }

  hasActiveTurn(): boolean {
    return this.activeByJid.size > 0
  }

  abort(): void {
    for (const turn of this.activeByJid.values()) {
      turn.controller.abort()
    }
    this.activeByJid.clear()
  }

  updateAllowedPhoneNumbers(numbers: string[]): void {
    this.allowedPhoneNumbers = numbers
  }

  setProcessingEnabled(enabled: boolean): void {
    this.processingEnabled = enabled
  }

  isStarted(): boolean {
    return this.sock !== null
  }

  async start(config: WhatsAppConfig): Promise<WhatsAppChannelStatus> {
    if (!config.enabled) {
      await this.stop('config disabled')
      return this.getStatus()
    }

    this.allowedPhoneNumbers = config.allowedPhoneNumbers ?? []
    this.processingEnabled = true
    this.statusError = null
    this.currentQr = null

    this.authDir = path.join(workspaceRoot(), 'whatsapp', 'auth')
    await fs.mkdir(this.authDir, { recursive: true })

    const { capability, plugin } = buildWhatsAppCapability({
      getSocket: () => this.sock,
      trackSentId: (id) => this.sentIds.add(id)
    })
    this.agent.cerebellum.registerInProcessCapability(capability, plugin)

    const hasAuth = await this.hasAuthCredentials()
    if (hasAuth) {
      this.hadValidSession = true
      this.status = 'connecting'
      await this.connect()
    } else {
      this.status = 'disconnected'
      this.statusError = null
    }
    return this.getStatus()
  }

  async stop(reason?: string): Promise<void> {
    // Invalidate any in-flight connect() so its async tail can't bring
    // the channel back up after we tear it down here.
    this.connectGeneration++
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempt = 0

    if (this.sock) {
      try {
        this.sock.end(undefined)
      } catch {
        // best-effort
      }
      this.sock = null
    }

    for (const turn of this.activeByJid.values()) {
      turn.controller.abort()
      if (turn.pendingApprovalResolve) {
        turn.pendingApprovalResolve('denied')
      }
    }
    this.activeByJid.clear()
    this.pendingSelections.clear()
    this.lidToPhone.clear()

    this.status = 'disconnected'
    this.statusError = null
    this.currentQr = null
    this.qrRequested = false
    this.agent.cerebellum.unregisterInProcessCapability(WHATSAPP_CAPABILITY_NAME)
    this.agent.corpus.emit('whatsapp.stopped', reason ? { reason } : {})
  }

  async restart(config: WhatsAppConfig): Promise<WhatsAppChannelStatus> {
    await this.stop('restart')
    return this.start(config)
  }

  async logout(): Promise<void> {
    if (this.sock) {
      try {
        await this.sock.logout()
      } catch {
        // best-effort
      }
    }
    await this.clearAuthState()
    await this.stop('logout')
    this.agent.corpus.emit('whatsapp.loggedOut', {})
  }

  // --- Connection lifecycle ---

  private async connect(): Promise<void> {
    if (!this.authDir) return

    // Snapshot the generation so the async tail below can tell whether a
    // stop() landed while we were awaiting the network.
    const generation = this.connectGeneration

    let sock: WASocket
    let saveCreds: () => Promise<void>
    try {
      const logger = pino({ level: 'silent' })
      // eslint-disable-next-line react-hooks/rules-of-hooks -- Baileys utility, not a React hook
      const auth = await useMultiFileAuthState(this.authDir)
      saveCreds = auth.saveCreds
      // Fetching the latest protocol version hits the network; offline at
      // boot this throws before we ever get a socket. Handle it like any
      // other connection failure so an established session keeps retrying
      // gracefully instead of wedging on `connecting` or showing a raw
      // stack-trace error.
      const { version } = await fetchLatestBaileysVersion()

      sock = makeWASocket({
        auth: {
          creds: auth.state.creds,
          keys: makeCacheableSignalKeyStore(auth.state.keys, logger)
        },
        version,
        logger,
        printQRInTerminal: false,
        browser: ['Wolffish', 'desktop', '1.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: false,
        keepAliveIntervalMs: 25000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        getMessage: async (key) => {
          return this.messageStore.get(key.id ?? '') ?? undefined
        }
      })
    } catch (err) {
      // A stop() that landed during setup wins — don't retry or paint
      // status for a channel the user closed.
      if (this.connectGeneration !== generation) return
      this.sock = null
      this.handleSetupFailure(err)
      return
    }

    // Superseded by a stop() while we were building the socket: drop it.
    if (this.connectGeneration !== generation) {
      try {
        sock.end(undefined)
      } catch {
        // best-effort
      }
      return
    }

    this.sock = sock
    // Every listener guards on socket identity (`this.sock !== sock`) so a
    // late event flushed from a socket we've already replaced or torn down
    // can't act on the current session — stale creds writes, ghost message
    // turns, and cross-session lid-map pollution all dissolve. Matches the
    // connection.update guard; only the live socket drives any state.
    sock.ev.on('creds.update', () => {
      if (this.sock !== sock) return
      void saveCreds()
    })
    sock.ev.on('connection.update', (update) => this.handleConnectionUpdate(update, sock))
    sock.ev.on('messages.upsert', (upsert) => this.handleMessagesUpsert(upsert, sock))

    sock.ev.on('messaging-history.set', ({ contacts }) => {
      if (this.sock !== sock) return
      if (!contacts) return
      for (const c of contacts) {
        if (!c.id || !c.lid) continue
        const pn = c.id.split('@')[0].split(':')[0]
        const lid = c.lid.split('@')[0].split(':')[0]
        if (pn && lid) this.lidToPhone.set(lid, pn)
      }
    })

    sock.ev.on('lid-mapping.update', ({ lid, pn }) => {
      if (this.sock !== sock) return
      const lidNum = lid.split('@')[0].split(':')[0]
      const pnNum = pn.split('@')[0].split(':')[0]
      if (lidNum && pnNum) this.lidToPhone.set(lidNum, pnNum)
    })
  }

  private handleConnectionUpdate(
    update: Partial<BaileysEventMap['connection.update']>,
    sock: WASocket
  ): void {
    // Ignore events from a socket we've already replaced (a newer
    // reconnect) or torn down (stop() sets this.sock = null). A genuine
    // event from the current live socket arrives while this.sock still
    // equals it — the close branch nulls this.sock only further down, so
    // this guard never swallows the first close of the active socket.
    // Without it, a late `close` fired during stop()'s teardown would
    // schedule a phantom reconnect that resurrects a disabled channel.
    if (this.sock !== sock) return

    const { connection, lastDisconnect, qr } = update

    if (qr) {
      if (this.qrRequested) {
        // Only accept the first QR — ignore Baileys' QR rotation.
        if (this.status !== 'qr') {
          this.status = 'qr'
          this.currentQr = qr
          this.statusError = null
          this.agent.corpus.emit('whatsapp.qr', { qr })
          this.agent.corpus.emit('whatsapp.statusChanged', {})
        }
      } else {
        // QR emitted without user request — session is invalid.
        this.sock?.end(undefined)
        this.sock = null
        this.status = 'disconnected'
        this.currentQr = null
        this.statusError = this.hadValidSession
          ? 'Session expired — click Connect to re-link.'
          : null
        this.hadValidSession = false
        void this.clearAuthState()
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer)
          this.reconnectTimer = null
        }
        this.reconnectAttempt = 0
        this.agent.corpus.emit('whatsapp.statusChanged', {})
        return
      }
      return
    }

    if (connection === 'open') {
      this.status = 'connected'
      this.statusError = null
      this.currentQr = null
      this.reconnectAttempt = 0
      this.qrRequested = false
      this.hadValidSession = true
      this.connectedAt = Date.now()
      this.agent.corpus.emit('whatsapp.started', {})
      // Also emit statusChanged so every transition flows through the
      // same channel the renderer listens on — `open` shouldn't be the
      // one transition that reaches the UI only via the started handler.
      this.agent.corpus.emit('whatsapp.statusChanged', {})
      return
    }

    if (connection === 'close') {
      this.sock = null
      const error = lastDisconnect?.error as Boom | undefined
      const statusCode = error?.output?.statusCode ?? 0

      if (statusCode === DisconnectReason.loggedOut) {
        this.status = 'disconnected'
        this.statusError = 'Logged out — click Connect to re-link.'
        this.qrRequested = false
        void this.clearAuthState()
        this.agent.corpus.emit('whatsapp.loggedOut', {})
        this.agent.corpus.emit('whatsapp.statusChanged', {})
        return
      }

      // 515 = restart required (e.g. after QR scan to complete pairing).
      if (statusCode === DisconnectReason.restartRequired) {
        this.scheduleReconnect(0)
        return
      }

      // If we were in QR flow (pairing) and it wasn't a restart, it's a real timeout.
      if (this.qrRequested) {
        this.status = 'disconnected'
        this.statusError = 'QR code expired — click Connect to try again.'
        this.qrRequested = false
        this.currentQr = null
        this.agent.corpus.emit('whatsapp.statusChanged', {})
        return
      }

      // Only auto-reconnect established sessions (network blips).
      if (!this.hadValidSession) {
        this.status = 'disconnected'
        this.statusError = null
        this.agent.corpus.emit('whatsapp.statusChanged', {})
        return
      }

      if (this.reconnectAttempt < RECONNECT_MAX_ATTEMPTS) {
        // A routine network blip. Stay in the calm `connecting` state with
        // no error text — the panel renders that as an amber spinner, not
        // a red error box. Surfacing "Reconnecting (attempt N)..." as a
        // statusError (which the UI styles like a failure) is exactly what
        // made an otherwise-successful reconnect look broken. The attempt
        // counter still drives backoff; it just isn't shown to the user.
        this.status = 'connecting'
        this.statusError = null
        this.agent.corpus.emit('whatsapp.statusChanged', {})
        this.scheduleReconnect()
      } else {
        // Genuinely gave up — now it's a real error worth showing.
        this.status = 'error'
        this.statusError = 'Failed to reconnect after maximum attempts.'
        this.agent.corpus.emit('whatsapp.error', {
          kind: classifyError(error),
          message: error?.message ?? 'Max reconnect attempts exhausted'
        })
      }
    }
  }

  /**
   * Socket construction threw before we ever wired up `connection.update`
   * (e.g. the version fetch failed offline at boot). Mirror the close
   * handler's graceful path: an established session keeps retrying with
   * backoff under the calm `connecting` state; otherwise we settle into a
   * quiet `disconnected` the user can retry from.
   */
  private handleSetupFailure(err: unknown): void {
    if (this.hadValidSession && this.reconnectAttempt < RECONNECT_MAX_ATTEMPTS) {
      this.status = 'connecting'
      this.statusError = null
      this.agent.corpus.emit('whatsapp.statusChanged', {})
      this.scheduleReconnect()
      return
    }
    if (this.hadValidSession) {
      this.status = 'error'
      this.statusError = 'Failed to reconnect after maximum attempts.'
      this.agent.corpus.emit('whatsapp.error', {
        kind: err instanceof Boom ? classifyError(err) : 'network',
        message: err instanceof Error ? err.message : 'Connection setup failed'
      })
      return
    }
    this.status = 'disconnected'
    this.statusError = null
    this.agent.corpus.emit('whatsapp.statusChanged', {})
  }

  private scheduleReconnect(overrideMs?: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)

    let delayMs: number
    if (overrideMs !== undefined) {
      delayMs = overrideMs
    } else {
      const base = RECONNECT_INITIAL_MS * Math.pow(RECONNECT_FACTOR, this.reconnectAttempt)
      const capped = Math.min(base, RECONNECT_MAX_MS)
      const jitter = capped * RECONNECT_JITTER * (Math.random() * 2 - 1)
      delayMs = Math.max(0, capped + jitter)
    }

    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      // connect() now self-handles setup failures via handleSetupFailure,
      // so it won't reject; the catch is a defensive backstop only.
      void this.connect().catch(() => undefined)
    }, delayMs)
  }

  // --- Message store (in-memory, for getMessage retry decryption) ---

  private messageStore = new Map<string, proto.IMessage>()
  private readonly MESSAGE_STORE_MAX = 5000
  private readonly MESSAGE_STORE_KEYS: string[] = []

  private storeMessage(id: string, message: proto.IMessage): void {
    if (this.messageStore.size >= this.MESSAGE_STORE_MAX) {
      const oldest = this.MESSAGE_STORE_KEYS.shift()
      if (oldest) this.messageStore.delete(oldest)
    }
    this.messageStore.set(id, message)
    this.MESSAGE_STORE_KEYS.push(id)
  }

  // --- Inbound message handling ---

  private handleMessagesUpsert(upsert: BaileysEventMap['messages.upsert'], sock: WASocket): void {
    // Drop events flushed from a socket we've already replaced/torn down so
    // a stale message can't spin up a ghost turn after stop() or a reconnect.
    if (this.sock !== sock) return
    if (upsert.type !== 'notify') return

    for (const msg of upsert.messages) {
      const msgId = msg.key.id
      if (msgId && msg.message) {
        this.storeMessage(msgId, msg.message)
      }

      if (!this.processingEnabled) continue
      if (!shouldProcessMessage(msg)) continue

      // Drop messages sent before this session connected (history sync after pairing)
      const msgTs = (msg.messageTimestamp as number) ?? 0
      const msgTime = msgTs > 1e12 ? msgTs : msgTs * 1000
      if (this.connectedAt > 0 && msgTime < this.connectedAt - 5000) continue

      if (msgId && this.sentIds.delete(msgId)) continue

      const body = extractTextBody(msg)
      if (!body) continue

      const jid = msg.key.remoteJid!
      const altJid = (msg.key as Record<string, unknown>).remoteJidAlt as string | undefined

      let senderPhone: string
      if (altJid && altJid.includes('@s.whatsapp.net')) {
        senderPhone = altJid.split('@')[0].split(':')[0]
      } else if (jid.endsWith('@lid') || jid.endsWith('@hosted.lid')) {
        const lidKey = jid.split('@')[0].split(':')[0]
        senderPhone = this.lidToPhone.get(lidKey) ?? lidKey
      } else {
        senderPhone = jid.split('@')[0].split(':')[0]
      }
      const allowed = this.allowedPhoneNumbers.map((n) => n.replace(/[^0-9]/g, ''))
      const isAllowed = allowed.some(
        (n) => n === senderPhone || senderPhone.endsWith(n) || n.endsWith(senderPhone)
      )
      if (!isAllowed) continue

      this.agent.corpus.emit('whatsapp.message.received', { remoteJid: jid, body })

      void this.handleInboundMessage(jid, body)
    }
  }

  private async handleInboundMessage(jid: string, text: string): Promise<void> {
    const trimmed = text.trim()
    const lower = trimmed.toLowerCase()

    const active = this.activeByJid.get(jid)

    // /status — read-only introspection. Works even during an active turn.
    if (lower === '/status' || lower === 'status') {
      await this.handleStatusCommand(jid)
      return
    }

    // /current — read-only. Shows which conversation is active.
    if (lower === '/current' || lower === 'current') {
      await this.handleCurrentCommand(jid)
      return
    }

    // /local and /cloud — flip provider mode. Busy-blocked to avoid
    // switching mid-turn.
    if (lower === '/local' || lower === 'local') {
      if (this.activeByJid.size > 0) {
        await this.sendBusyReply(jid, trimmed)
        return
      }
      await this.handleModeSwitchCommand(jid, true)
      return
    }
    if (lower === '/cloud' || lower === 'cloud') {
      if (this.activeByJid.size > 0) {
        await this.sendBusyReply(jid, trimmed)
        return
      }
      await this.handleModeSwitchCommand(jid, false)
      return
    }

    // /stop — cancel the active turn for this JID
    if (lower === '/stop' || lower === 'stop') {
      if (!active) {
        await this.safeSend(jid, 'Nothing to stop.')
        return
      }
      active.controller.abort()
      if (active.taskId) {
        await this.agent.motor.stopTask(active.taskId).catch(() => undefined)
      }
      await this.safeSend(jid, 'Stopping...')
      const deadline = Date.now() + 10_000
      while (this.activeByJid.has(jid) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100))
      }
      if (this.activeByJid.has(jid)) {
        await this.safeSend(jid, 'Attempted to stop, but the task may still be winding down.')
      } else {
        await this.safeSend(jid, 'Stopped.')
      }
      return
    }

    // /approve and /deny — resolve pending approval
    if (active?.pendingApprovalId && active.pendingApprovalResolve) {
      if (lower === '/approve' || lower === 'approve' || lower === 'yes') {
        this.resolveApproval(active, 'approved')
        await this.safeSend(jid, 'Approved.')
        return
      }
      if (lower === '/deny' || lower === 'deny' || lower === 'no') {
        this.resolveApproval(active, 'denied')
        await this.safeSend(jid, 'Denied.')
        return
      }
    }

    // /new — start fresh conversation. Busy-blocked.
    if (lower === '/new' || lower === 'new' || lower === '/start') {
      if (this.activeByJid.size > 0) {
        await this.sendBusyReply(jid, trimmed)
        return
      }
      await this.handleNewCommand(jid)
      return
    }

    // /resume — conversation picker
    if (lower === '/resume' || lower === 'resume') {
      if (this.activeByJid.size > 0) {
        await this.sendBusyReply(jid, trimmed)
        return
      }
      await this.renderConversationPicker(jid, 'resume')
      return
    }

    // /delete — conversation picker for deletion
    if (lower === '/delete' || lower === 'delete') {
      if (this.activeByJid.size > 0) {
        await this.sendBusyReply(jid, trimmed)
        return
      }
      await this.renderConversationPicker(jid, 'delete')
      return
    }

    // Number reply for an outstanding /resume or /delete picker
    const pending = this.pendingSelections.get(jid)
    if (pending) {
      const num = parseSelectionNumber(trimmed)
      if (num !== null && num >= 1 && num <= pending.conversationIds.length) {
        const targetId = pending.conversationIds[num - 1]
        this.pendingSelections.delete(jid)
        if (pending.command === 'resume') {
          await this.handleResumeSelection(jid, targetId)
        } else {
          await this.handleDeleteSelection(jid, targetId)
        }
        return
      }
      this.pendingSelections.delete(jid)
    }

    // Busy check — only one turn at a time across all JIDs
    if (this.activeByJid.size > 0) {
      await this.sendBusyReply(jid, trimmed)
      return
    }

    // Free — dispatch as a new turn
    await this.dispatchTurn(jid, trimmed)
  }

  private resolveApproval(active: ActiveTurn, decision: ApprovalDecision): void {
    const approvalId = active.pendingApprovalId!
    const resolve = active.pendingApprovalResolve!
    active.pendingApprovalId = null
    active.pendingApprovalResolve = null
    const stored = active.approvals.get(approvalId)
    if (stored) stored.decision = decision
    resolve(decision)
  }

  // --- Slash command handlers ---

  private async handleStatusCommand(jid: string): Promise<void> {
    try {
      const report = await this.agent.insula.reflect()
      const text = typeof report === 'string' ? report : JSON.stringify(report, null, 2)
      await this.safeSend(jid, text)
    } catch {
      await this.safeSend(jid, 'Unable to generate status report.')
    }
  }

  private async handleCurrentCommand(jid: string): Promise<void> {
    const convId = await getConversationIdForJid(jid)
    if (!convId) {
      await this.safeSend(jid, 'No active conversation. Send a message to start one.')
      return
    }
    const conv = await loadConversation(convId)
    if (!conv) {
      await this.safeSend(jid, 'No active conversation. Send a message to start one.')
      return
    }
    const msgs = conv.messages.length
    const ago = relativeTime(conv.updatedAt)
    await this.safeSend(jid, `*${conv.title}*\n${msgs} messages · updated ${ago}`)
  }

  private async handleModeSwitchCommand(jid: string, localOnly: boolean): Promise<void> {
    await persistLocalOnly(localOnly)
    this.agent.thalamus.setLocalOnly(localOnly)
    await this.safeSend(jid, localOnly ? 'Switched to local model.' : 'Switched to cloud model.')
  }

  private async handleNewCommand(jid: string): Promise<void> {
    const fresh = createConversation(null)
    fresh.channel = 'whatsapp'
    await saveConversation(fresh)
    await setConversationIdForJid(jid, fresh.id)
    await this.safeSend(jid, `New conversation started.\n\n${COMMANDS_HELP}`)
  }

  private async renderConversationPicker(jid: string, command: 'resume' | 'delete'): Promise<void> {
    const all = await listConversations()
    const whatsapp = all.filter((c) => c.channel === 'whatsapp').slice(0, SELECTION_LIMIT)

    if (whatsapp.length === 0) {
      this.pendingSelections.delete(jid)
      await this.safeSend(jid, 'No saved conversations yet.')
      return
    }

    const header =
      command === 'resume'
        ? '*Resume a conversation* — reply with the number:'
        : '*Delete a conversation* — reply with the number:'

    const items = whatsapp.map((conv, idx) => formatPickerItem(conv, idx)).join('\n\n')

    this.pendingSelections.set(jid, {
      command,
      conversationIds: whatsapp.map((c) => c.id)
    })

    await this.safeSend(jid, `${header}\n\n${items}`)
  }

  private async handleResumeSelection(jid: string, conversationId: string): Promise<void> {
    const conv = await loadConversation(conversationId)
    if (!conv) {
      await this.safeSend(jid, 'That conversation is no longer available.')
      return
    }
    await setConversationIdForJid(jid, conversationId)
    await this.safeSend(jid, `Resumed: *${conv.title}*`)
  }

  private async handleDeleteSelection(jid: string, conversationId: string): Promise<void> {
    const currentId = await getConversationIdForJid(jid)
    const wasActive = currentId === conversationId

    await deleteConversation(conversationId)

    if (wasActive) {
      const fresh = createConversation(null)
      fresh.channel = 'whatsapp'
      await saveConversation(fresh)
      await setConversationIdForJid(jid, fresh.id)
      await this.safeSend(jid, `Deleted. New conversation started.\n\n${COMMANDS_HELP}`)
    } else {
      await this.safeSend(jid, 'Deleted.')
    }
  }

  // --- Turn dispatch (mirrors Telegram's pattern) ---

  private async dispatchTurn(jid: string, userText: string): Promise<void> {
    const conversation = await this.loadOrCreateConversation(jid)

    const userMessage: ConversationMessage = {
      role: 'user',
      content: userText,
      timestamp: Date.now()
    }
    conversation.messages.push(userMessage)
    conversation.updatedAt = userMessage.timestamp
    await saveConversation(conversation)

    const history: ChatHistoryMessage[] = conversation.messages.flatMap((m) => {
      if (m.role !== 'user') return assistantSegmentsToHistory(m)
      if (m.voicePrompt) return [{ role: 'user' as const, content: `<voice_note>\n${m.content}` }]
      const atts = m.attachments ?? []
      const entry: ChatHistoryMessage = {
        role: 'user',
        content: composeAttachmentContext(m.content, atts)
      }
      if (atts.length > 0) {
        entry.attachments = atts.map((a) => ({
          type: a.type,
          filePath: a.filePath,
          originalName: a.originalName,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes
        }))
      }
      return [entry]
    })

    const handle = this.runner.send({
      history,
      conversationId: conversation.id,
      makeSink: ({ turnId, conversationId }) => this.createSink(turnId, conversationId, jid),
      onTurnStarted: ({ controller }) => {
        const active: ActiveTurn = {
          jid,
          conversation,
          textBuffer: '',
          assistantContent: '',
          segments: [],
          approvals: new Map(),
          toolTimings: new Map(),
          stopReason: null,
          taskId: null,
          controller,
          pendingApprovalId: null,
          pendingApprovalResolve: null,
          toolCallNames: new Map(),
          pendingActiveModel: null,
          lastFlushedModel: null,
          sentImages: new Set()
        }
        this.activeByJid.set(jid, active)
      },
      onTurnEnded: () => {
        // Drain the render queue (which includes the final text flush
        // enqueued by onDone) before cleaning up the active turn.
        const pending = this.segmentQueue.get(jid) ?? Promise.resolve()
        void pending.then(() => {
          const finished = this.activeByJid.get(jid)
          if (finished) {
            if (finished.pendingApprovalId) {
              const stored = finished.approvals.get(finished.pendingApprovalId)
              if (stored && !stored.decision) stored.decision = 'denied'
            }

            const content = finished.assistantContent.trim()
            const hasSegments = finished.segments.length > 0
            if (content.length > 0 || hasSegments) {
              const assistant: ConversationMessage = {
                role: 'assistant',
                content,
                timestamp: Date.now()
              }
              if (hasSegments) assistant.segments = finished.segments
              if (finished.approvals.size > 0) {
                assistant.approvals = Object.fromEntries(
                  [...finished.approvals.values()].map((a) => [a.toolCallId, a])
                )
              }
              if (finished.toolTimings.size > 0) {
                assistant.toolTimings = Object.fromEntries(finished.toolTimings)
              }
              if (finished.stopReason) assistant.stopReason = finished.stopReason
              finished.conversation.messages.push(assistant)
              finished.conversation.updatedAt = assistant.timestamp
              void saveConversation(finished.conversation).catch(() => undefined)
              void this.maybeGenerateTitle(finished.conversation)
            }

            if (finished.pendingApprovalResolve) {
              finished.pendingApprovalResolve('denied')
              finished.pendingApprovalId = null
              finished.pendingApprovalResolve = null
            }
          }
          this.activeByJid.delete(jid)
          this.segmentQueue.delete(jid)
        })
      }
    })

    await handle.done
  }

  private async loadOrCreateConversation(jid: string): Promise<ConversationFile> {
    const existingId = await getConversationIdForJid(jid)
    if (existingId) {
      const loaded = await loadConversation(existingId)
      if (loaded) {
        const cfg = await getWhatsAppConfig()
        const staleMs = STALE_DEFAULT_HOURS * 60 * 60 * 1000
        if (loaded.messages.length > 0) {
          const elapsed = Date.now() - loaded.updatedAt
          if (elapsed >= staleMs) {
            const fresh = createConversation(null)
            fresh.channel = 'whatsapp'
            await saveConversation(fresh)
            await setConversationIdForJid(jid, fresh.id)
            const oldTitle = loaded.title || 'Untitled'
            const hours = Math.floor(elapsed / 3_600_000)
            await this.safeSend(
              jid,
              `Conversation "${oldTitle}" was idle for ${hours}h — started a fresh one.\n\nUse /resume to go back.`
            )
            void cfg
            return fresh
          }
        }
        return loaded
      }
    }
    const fresh = createConversation(null)
    fresh.channel = 'whatsapp'
    await saveConversation(fresh)
    await setConversationIdForJid(jid, fresh.id)
    return fresh
  }

  private async maybeGenerateTitle(conv: ConversationFile): Promise<void> {
    if (conv.title !== 'Untitled') return
    if (!conv.messages.some((m) => m.role === 'user')) return
    const title = generateTitle(conv)
    if (title === 'Untitled') return
    conv.title = title
    conv.updatedAt = Date.now()
    await saveConversation(conv).catch(() => undefined)
  }

  // --- TurnSink (renders segments into WhatsApp messages) ---

  private createSink(turnId: string, conversationId: string | null, jid: string): TurnSink {
    return {
      channelId: 'whatsapp',
      turnId,
      conversationId,
      onSegment: (segment) => {
        this.enqueueRender(jid, () => this.renderSegment(jid, segment))
      },
      onTurnEvent: <E extends keyof CorpusEvents>(type: E, payload: CorpusEvents[E]): void => {
        const active = this.activeByJid.get(jid)
        if (!active) return
        if (type === 'task.created') {
          const task = payload as CorpusEvents['task.created']
          if (task.taskId) active.taskId = task.taskId
        }
      },
      onApprovalRequest: (req) => this.handleApprovalRequest(jid, req),
      onDone: () => {
        this.enqueueRender(jid, () => this.flushFinalText(jid))
      },
      onError: (error) => {
        void this.safeSend(jid, `Error: ${error}`)
      },
      onCredentialBlocked: () => {
        // Runner already pushed the canned reply through onSegment
      }
    }
  }

  private enqueueRender(jid: string, fn: () => Promise<void>): void {
    const prev = this.segmentQueue.get(jid) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.segmentQueue.set(jid, next)
  }

  private async renderSegment(jid: string, segment: Segment): Promise<void> {
    const active = this.activeByJid.get(jid)
    if (!active) return

    active.segments.push(segment)

    if (segment.kind === 'text') {
      await this.flushPendingActiveModel(jid)
      active.textBuffer += segment.delta
      active.assistantContent += segment.delta
      return
    }

    if (segment.kind === 'tool_call') {
      active.toolCallNames.set(segment.toolCallId, segment.name)
      active.toolTimings.set(segment.toolCallId, { startedAt: Date.now() })
      await this.flushPendingActiveModel(jid)
      await this.flushBufferedText(jid)
      const args = formatArgs(segment.args)
      const msg =
        args.length > 0 ? `⚙️ *${segment.name}*\n\`\`\`\n${args}\n\`\`\`` : `⚙️ *${segment.name}*`
      await this.safeSend(jid, msg)
      return
    }

    if (segment.kind === 'tool_result') {
      const timing = active.toolTimings.get(segment.toolCallId)
      if (timing) timing.endedAt = Date.now()
      const icon = segment.status === 'success' ? '✅' : segment.status === 'denied' ? '❌' : '⚠️'
      const name = active.toolCallNames.get(segment.toolCallId)
      const heading = name ? `${icon} *${name}*` : icon
      const output = segment.output?.trim() ?? ''

      const imagePaths = extractWolffishMediaPaths(output)
      if (imagePaths.length > 0) {
        await this.safeSend(jid, heading)
        for (const imgPath of imagePaths) {
          await this.sendImageFile(jid, imgPath)
        }
        const remaining = stripWolffishMediaMarkdown(output).trim()
        if (remaining.length > 0) {
          await this.safeSend(jid, blockquote(truncateToolOutput(remaining)))
        }
        return
      }

      const docPaths = extractDocumentPaths(output)
      if (docPaths.length > 0) {
        await this.safeSend(jid, heading)
        for (const docPath of docPaths) {
          await this.sendDocumentFile(jid, docPath)
        }
        return
      }

      const avPaths = extractAudioVideoPaths(output)
      if (avPaths.length > 0) {
        await this.safeSend(jid, heading)
        for (const av of avPaths) {
          if (av.type === 'audio') {
            await this.sendAudioFile(jid, av.path)
          } else {
            await this.sendVideoFile(jid, av.path)
          }
        }
        return
      }

      if (output.length === 0) {
        await this.safeSend(jid, heading)
        return
      }
      await this.safeSend(jid, `${heading}\n${blockquote(truncateToolOutput(output))}`)
      return
    }

    if (segment.kind === 'compaction') {
      const saved =
        segment.tokensSaved >= 1000
          ? `${Math.round(segment.tokensSaved / 1000)}k`
          : String(segment.tokensSaved)
      const model = segment.details[0]?.compactedBy
      const via = model && model !== 'truncate' ? ` via ${model}` : ''
      const msg =
        `🗜️ *Context compacted* — ${segment.targetsCount}` +
        ` message${segment.targetsCount !== 1 ? 's' : ''} compacted, ` +
        `~${saved} tokens saved${via}`
      await this.safeSend(jid, msg)
      return
    }

    if (segment.kind === 'turn_end') {
      active.stopReason = segment.stopReason
      active.pendingActiveModel = null
      await this.flushBufferedText(jid)
      return
    }

    if (segment.kind === 'active_model') {
      active.pendingActiveModel = segment.model
      return
    }

    if (segment.kind === 'provider_change') {
      active.pendingActiveModel = segment.model
      return
    }
  }

  private async flushPendingActiveModel(jid: string): Promise<void> {
    const active = this.activeByJid.get(jid)
    if (!active) return
    const model = active.pendingActiveModel
    if (!model) return
    active.pendingActiveModel = null
    if (model === active.lastFlushedModel) return
    active.lastFlushedModel = model
    await this.safeSend(jid, `🤖 *${model}*`)
  }

  private async flushBufferedText(jid: string): Promise<void> {
    const active = this.activeByJid.get(jid)
    if (!active) return
    const raw = active.textBuffer
    active.textBuffer = ''

    const imagePaths = extractWolffishMediaPaths(raw)
    const cleaned = stripWolffishMediaMarkdown(raw).trim()

    if (cleaned.length > 0) {
      for (const chunk of splitForWhatsApp(cleaned)) {
        await this.safeSend(jid, chunk)
      }
    }
    for (const imgPath of imagePaths) {
      await this.sendImageFile(jid, imgPath)
    }
  }

  private async flushFinalText(jid: string): Promise<void> {
    await this.flushBufferedText(jid)
  }

  private handleApprovalRequest(
    jid: string,
    req: ApprovalRequest & { id: string }
  ): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      const active = this.activeByJid.get(jid)
      if (!active) {
        resolve('denied')
        return
      }

      if (active.pendingApprovalResolve) {
        active.pendingApprovalResolve('denied')
        const prior = active.pendingApprovalId
        if (prior) {
          const stored = active.approvals.get(prior)
          if (stored && !stored.decision) stored.decision = 'denied'
        }
      }

      active.pendingApprovalId = req.id
      active.pendingApprovalResolve = resolve

      active.approvals.set(req.id, {
        approvalId: req.id,
        toolCallId: req.toolCall.id,
        tool: req.toolCall.name,
        args: req.toolCall.args,
        reason: req.reason,
        level: req.level,
        description: req.description
      })

      const parts: string[] = [`*Approval required:* ${req.toolCall.name}`]
      if (req.description?.title) parts.push(req.description.title)
      if (req.description?.description) parts.push(req.description.description)
      if (req.reason) parts.push(`Reason: ${req.reason}`)
      const args = formatArgs(req.toolCall.args)
      if (args.length > 0) parts.push(args)
      parts.push('\nReply "approve" or "deny".')
      void this.safeSend(jid, parts.join('\n\n'))
    })
  }

  // --- Busy handling ---

  private async sendBusyReply(jid: string, userText: string): Promise<void> {
    if (!this.localProvider.isReady) {
      await this.safeSend(jid, FALLBACK_BUSY_REPLY)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), BUSY_REPLY_TIMEOUT_MS)

    let response = ''
    try {
      for await (const chunk of this.localProvider.stream({
        system: BUSY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userText }],
        signal: controller.signal
      })) {
        if (chunk.type === 'text') response += chunk.text
        if (chunk.type === 'turn_meta') break
        if (chunk.type === 'error') {
          response = ''
          break
        }
      }
    } catch {
      response = ''
    } finally {
      clearTimeout(timer)
    }

    const trimmed = response.trim()
    await this.safeSend(jid, trimmed.length > 0 ? trimmed : FALLBACK_BUSY_REPLY)
  }

  // --- Sending ---

  private async safeSend(jid: string, text: string): Promise<void> {
    if (!this.sock) return
    try {
      const sent = await this.sock.sendMessage(jid, { text })
      if (sent?.key.id) {
        this.sentIds.add(sent.key.id)
        this.agent.corpus.emit('whatsapp.message.sent', { remoteJid: jid })
      }
    } catch {
      // best-effort — connection may have dropped
    }
  }

  private async sendImageFile(jid: string, filePath: string): Promise<void> {
    if (!this.sock) return
    const resolved = path.resolve(filePath)
    const active = this.activeByJid.get(jid)
    if (active?.sentImages.has(resolved)) return
    try {
      await fs.access(resolved)
      const buffer = await fs.readFile(resolved)
      const ext = path.extname(resolved).toLowerCase()
      const IMAGE_MIME: Record<string, string> = {
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.tiff': 'image/tiff',
        '.tif': 'image/tiff'
      }
      const mimetype = IMAGE_MIME[ext] ?? 'image/jpeg'
      const sent = await this.sock.sendMessage(jid, {
        image: buffer,
        mimetype
      })
      if (sent?.key.id) {
        this.sentIds.add(sent.key.id)
      }
      if (active) active.sentImages.add(resolved)
    } catch {
      // best-effort
    }
  }

  private async sendDocumentFile(jid: string, filePath: string): Promise<void> {
    if (!this.sock) return
    const resolved = path.resolve(filePath)
    try {
      await fs.access(resolved)
      const buffer = await fs.readFile(resolved)
      const ext = path.extname(resolved).toLowerCase()
      const MIME: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.csv': 'text/csv'
      }
      const mimetype = MIME[ext] ?? 'application/octet-stream'
      const sent = await this.sock.sendMessage(jid, {
        document: buffer,
        mimetype,
        fileName: path.basename(resolved)
      })
      if (sent?.key.id) {
        this.sentIds.add(sent.key.id)
      }
    } catch {
      // best-effort
    }
  }

  private async sendAudioFile(jid: string, filePath: string): Promise<void> {
    if (!this.sock) return
    const resolved = path.resolve(filePath)
    try {
      await fs.access(resolved)
      const buffer = await fs.readFile(resolved)
      const ext = path.extname(resolved).toLowerCase()
      const AUDIO_MIME: Record<string, string> = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
        '.aac': 'audio/aac',
        '.wma': 'audio/x-ms-wma',
        '.opus': 'audio/opus'
      }
      const mimetype = AUDIO_MIME[ext] ?? 'audio/mpeg'
      const sent = await this.sock.sendMessage(jid, {
        audio: buffer,
        mimetype,
        fileName: path.basename(resolved)
      })
      if (sent?.key.id) {
        this.sentIds.add(sent.key.id)
      }
    } catch {
      // best-effort
    }
  }

  private async sendVideoFile(jid: string, filePath: string): Promise<void> {
    if (!this.sock) return
    const resolved = path.resolve(filePath)
    try {
      await fs.access(resolved)
      const buffer = await fs.readFile(resolved)
      const ext = path.extname(resolved).toLowerCase()
      const VIDEO_MIME: Record<string, string> = {
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.m4v': 'video/mp4',
        '.wmv': 'video/x-ms-wmv',
        '.flv': 'video/x-flv',
        '.webm': 'video/webm'
      }
      const mimetype = VIDEO_MIME[ext] ?? 'video/mp4'
      const sent = await this.sock.sendMessage(jid, {
        video: buffer,
        mimetype,
        fileName: path.basename(resolved)
      })
      if (sent?.key.id) {
        this.sentIds.add(sent.key.id)
      }
    } catch {
      // best-effort
    }
  }

  // --- Auth state management ---

  private async hasAuthCredentials(): Promise<boolean> {
    if (!this.authDir) return false
    try {
      const credsPath = path.join(this.authDir, 'creds.json')
      await fs.access(credsPath)
      const stat = await fs.stat(credsPath)
      return stat.size > 10
    } catch {
      return false
    }
  }

  requestQr(): void {
    this.qrRequested = true
    if (!this.authDir) return
    if (this.status === 'disconnected' || this.status === 'error') {
      this.status = 'connecting'
      this.statusError = null
      this.reconnectAttempt = 0
      void this.connect()
    }
  }

  private async clearAuthState(): Promise<void> {
    if (!this.authDir) return
    try {
      const entries = await fs.readdir(this.authDir)
      await Promise.all(entries.map((e) => fs.rm(path.join(this.authDir!, e), { force: true })))
    } catch {
      // best-effort
    }
    this.hadValidSession = false
  }
}

function classifyError(error: Boom | undefined): WhatsAppErrorKind {
  if (!error) return 'unknown'
  const msg = (error.message ?? '').toLowerCase()
  const stack = (error.stack ?? '').toLowerCase()
  const combined = msg + '\n' + stack

  if (combined.includes('bad mac') || combined.includes('unable to authenticate data'))
    return 'crypto'
  if (
    combined.includes('econnrefused') ||
    combined.includes('enotfound') ||
    combined.includes('timeout') ||
    combined.includes('network')
  )
    return 'network'
  if (combined.includes('stream error') || combined.includes('515')) return 'stream'
  if (error.output?.statusCode === DisconnectReason.loggedOut) return 'auth'

  return 'unknown'
}

function formatArgs(args: Record<string, unknown>): string {
  try {
    const str = JSON.stringify(args, null, 2)
    return str.length > 1000 ? str.slice(0, 1000) + '...' : str
  } catch {
    return ''
  }
}

function formatPickerItem(conv: ConversationMeta, idx: number): string {
  const keycap = KEYCAP_DIGITS[idx] ?? `${idx + 1}.`
  const title = conv.title || 'Untitled'
  const msgs = conv.messageCount ?? 0
  const ago = relativeTime(conv.updatedAt)
  return `${keycap} *${title}*\n    ${msgs} messages · ${ago}`
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function parseSelectionNumber(text: string): number | null {
  const cleaned = text.replace(/[^\d]/g, '')
  if (cleaned.length === 0) return null
  const n = parseInt(cleaned, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif'])
const DOCUMENT_EXTS = new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.csv'])
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.wma', '.opus'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.m4v', '.wmv', '.flv', '.webm'])

function extractWolffishMediaPaths(output: string): string[] {
  const paths: string[] = []
  const seen = new Set<string>()

  // Explicit [wolffish-output: path (image)] markers from ffmpeg plugin —
  // these identify the output file unambiguously.
  const markerRegex = /\[wolffish-output:\s*([^\]]+?)\s+\(image\)\]/g
  let match: RegExpExecArray | null
  while ((match = markerRegex.exec(output)) !== null) {
    const abs = match[1].trim()
    if (!seen.has(abs)) {
      seen.add(abs)
      paths.push(abs)
    }
  }

  const mediaRegex = /wolffish-media:\/\/([^\s)"]+)/g
  while ((match = mediaRegex.exec(output)) !== null) {
    const abs = path.join(workspaceRoot(), decodeURIComponent(match[1]))
    if (!seen.has(abs)) {
      seen.add(abs)
      paths.push(abs)
    }
  }

  const absRegex = /(\/[^\s",:)]+\.(?:png|jpe?g|gif|webp|bmp|tiff?))\b/gi
  while ((match = absRegex.exec(output)) !== null) {
    const abs = match[1]
    if (!seen.has(abs) && IMAGE_EXTS.has(path.extname(abs).toLowerCase())) {
      seen.add(abs)
      paths.push(abs)
    }
  }

  const home = os.homedir()
  const homeRegex = /(~\/[^\s",:)]+\.(?:png|jpe?g|gif|webp|bmp|tiff?))\b/gi
  while ((match = homeRegex.exec(output)) !== null) {
    const abs = path.join(home, match[1].slice(2))
    if (!seen.has(abs) && IMAGE_EXTS.has(path.extname(abs).toLowerCase())) {
      seen.add(abs)
      paths.push(abs)
    }
  }

  try {
    const parsed = JSON.parse(output)
    if (parsed?.path && typeof parsed.path === 'string') {
      const abs = parsed.path.startsWith('~/') ? path.join(home, parsed.path.slice(2)) : parsed.path
      if (!seen.has(abs) && IMAGE_EXTS.has(path.extname(abs).toLowerCase())) {
        seen.add(abs)
        paths.push(abs)
      }
    }
  } catch {
    /* not JSON */
  }

  return paths
}

function stripWolffishMediaMarkdown(text: string): string {
  return text
    .replace(/\[wolffish-output:[^\]]+\]/g, '')
    .replace(/!\[[^\]]*\]\(wolffish-media:\/\/[^\s)]+\)/g, '')
    .replace(/(Saved to|Screenshot saved[^.]*) ~?\/[^\s"]+\.(?:png|jpe?g|gif|webp|bmp|tiff?)/gi, '')
    .trim()
}

function extractDocumentPaths(output: string): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  const home = os.homedir()

  function addIfDocument(p: string): void {
    const abs = p.startsWith('~/') ? path.join(home, p.slice(2)) : p
    if (!seen.has(abs) && DOCUMENT_EXTS.has(path.extname(abs).toLowerCase())) {
      seen.add(abs)
      paths.push(abs)
    }
  }

  // Explicit [wolffish-output: path (document)] markers from the shell
  // plugin's opened-file detection — these survive paths with spaces,
  // which the bare-path regex below cannot.
  const markerRegex = /\[wolffish-output:\s*([^\]]+?)\s+\(document\)\]/g
  let markerMatch: RegExpExecArray | null
  while ((markerMatch = markerRegex.exec(output)) !== null) {
    addIfDocument(markerMatch[1].trim())
  }

  try {
    const parsed = JSON.parse(output)
    if (parsed?.path && typeof parsed.path === 'string') {
      addIfDocument(parsed.path)
    }
    if (Array.isArray(parsed?.files)) {
      for (const f of parsed.files) {
        if (f?.path && typeof f.path === 'string') addIfDocument(f.path)
      }
    }
  } catch {
    /* not JSON */
  }

  const absRegex = /(\/[^\s",:)]+\.(?:pdf|docx?|xlsx?|pptx?|csv))\b/gi
  let match: RegExpExecArray | null
  while ((match = absRegex.exec(output)) !== null) {
    addIfDocument(match[1])
  }

  return paths
}

function extractAudioVideoPaths(output: string): { path: string; type: 'audio' | 'video' }[] {
  const results: { path: string; type: 'audio' | 'video' }[] = []
  const seen = new Set<string>()
  const home = os.homedir()

  function resolvePath(p: string): string {
    return p.startsWith('~/') ? path.join(home, p.slice(2)) : p
  }

  // 1. Explicit [wolffish-output: path (audio|video)] markers
  const markerRegex = /\[wolffish-output:\s*([^\]]+?)\s+\((audio|video)\)\]/g
  let match: RegExpExecArray | null
  while ((match = markerRegex.exec(output)) !== null) {
    const abs = resolvePath(match[1].trim())
    if (!seen.has(abs)) {
      seen.add(abs)
      results.push({ path: abs, type: match[2] as 'audio' | 'video' })
    }
  }

  // 2. Fallback: absolute paths with known audio/video extensions
  const avRegex =
    /(\/[^\s",:)]+\.(?:mp3|wav|m4a|ogg|flac|aac|wma|opus|mp4|mov|avi|mkv|m4v|wmv|flv|webm))\b/gi
  while ((match = avRegex.exec(output)) !== null) {
    const abs = match[1]
    if (seen.has(abs)) continue
    const ext = path.extname(abs).toLowerCase()
    if (AUDIO_EXTS.has(ext)) {
      seen.add(abs)
      results.push({ path: abs, type: 'audio' })
    } else if (VIDEO_EXTS.has(ext)) {
      seen.add(abs)
      results.push({ path: abs, type: 'video' })
    }
  }

  return results
}

const WHATSAPP_MESSAGE_LIMIT = 4096

function splitForWhatsApp(text: string): string[] {
  if (text.length <= WHATSAPP_MESSAGE_LIMIT) return [text]
  const out: string[] = []
  let remaining = text
  while (remaining.length > WHATSAPP_MESSAGE_LIMIT) {
    const slice = remaining.slice(0, WHATSAPP_MESSAGE_LIMIT)
    let cut = slice.lastIndexOf('\n\n')
    if (cut < WHATSAPP_MESSAGE_LIMIT * 0.5) cut = slice.lastIndexOf('\n')
    if (cut < WHATSAPP_MESSAGE_LIMIT * 0.5) cut = slice.lastIndexOf('. ')
    if (cut < WHATSAPP_MESSAGE_LIMIT * 0.5) cut = WHATSAPP_MESSAGE_LIMIT
    out.push(remaining.slice(0, cut).trimEnd())
    remaining = remaining.slice(cut).trimStart()
  }
  if (remaining.length > 0) out.push(remaining)
  return out
}

const TOOL_OUTPUT_LIMIT = 1500

function truncateToolOutput(text: string): string {
  if (text.length <= TOOL_OUTPUT_LIMIT) return text
  return text.slice(0, TOOL_OUTPUT_LIMIT - 1) + '…'
}

function blockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => '> ' + line.trimStart())
    .join('\n')
}
