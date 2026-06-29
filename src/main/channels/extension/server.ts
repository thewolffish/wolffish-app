import {
  listConversations,
  logEvent,
  readEvents,
  type ExtensionEvent
} from '@main/channels/extension/log'
import { diskWriter } from '@main/io/diskWriter'
import { wlog } from '@main/workspace/logger'
import { getBrowserExtensionConfig, getRuntimeExtensionVersion } from '@main/workspace/workspace'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'

const TAG = 'extension'
const HEARTBEAT_CHECK_MS = 45_000

// ─── Debug Logger ───────────────────────────────────────────────────────────

const DEBUG_DIR = join(homedir(), '.wolffish', 'workspace', 'logs', 'extension', '.debug')
let debugReady: Promise<void> | null = null

function ensureDebugDir(): Promise<void> {
  if (!debugReady) debugReady = mkdir(DEBUG_DIR, { recursive: true }).then(() => {})
  return debugReady
}

function debugStamp(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '')
}

function debugFile(): string {
  return join(DEBUG_DIR, `${new Date().toISOString().slice(0, 10)}.log`)
}

async function debug(level: string, msg: string): Promise<void> {
  const line = `${debugStamp()}  ${level.padEnd(5)}  ${msg}\n`
  try {
    await ensureDebugDir()
    await diskWriter.appendLine(debugFile(), line)
  } catch {
    // never let debug logging crash anything
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type ExtensionConnectionStatus = 'stopped' | 'listening' | 'connected' | 'error'

export interface ExtensionServerStatus {
  status: ExtensionConnectionStatus
  error: string | null
  extensionVersion: string | null
  port: number
}

interface PendingCommand {
  resolve: (response: WolffishResponse) => void
  reject: (error: Error) => void
}

interface WolffishCommand {
  id: string
  type: string
  params: Record<string, unknown>
}

interface WolffishResponse {
  id: string
  success: boolean
  data?: unknown
  error?: string
}

// ─── Server ─────────────────────────────────────────────────────────────────

export class ExtensionServer {
  private wss: WebSocketServer | null = null
  private client: WebSocket | null = null
  private status: ExtensionConnectionStatus = 'stopped'
  private statusError: string | null = null
  private pendingCommands = new Map<string, PendingCommand>()
  private lastPing = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private extensionVersion: string | null = null
  private currentConversationId: string | null = null
  private syncedConversationId: string | null = null
  private currentTitle: string | null = null
  private currentPort = 23151
  private onStatusChange: ((status: ExtensionServerStatus) => void) | null = null

  setStatusChangeHandler(handler: (status: ExtensionServerStatus) => void): void {
    this.onStatusChange = handler
  }

  async start(config: { port: number }): Promise<ExtensionServerStatus> {
    void debug('INFO', `start() called: port=${config.port}`)

    if (this.wss) {
      void debug('INFO', 'start() stopping existing server first')
      await this.stop()
    }

    this.currentPort = config.port

    return new Promise((resolve) => {
      try {
        this.wss = new WebSocketServer({ port: config.port, host: '127.0.0.1' })
        void debug('INFO', `WebSocketServer created on 127.0.0.1:${config.port}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.status = 'error'
        this.statusError = message
        wlog.error(TAG, `Failed to create server: ${message}`)
        void debug('ERROR', `WebSocketServer constructor threw: ${message}`)
        resolve(this.getStatus())
        return
      }

      this.wss.on('listening', () => {
        this.status = 'listening'
        this.statusError = null
        wlog.info(TAG, `WebSocket server listening on port ${config.port}`)
        void debug('INFO', `listening on port ${config.port}`)
        this.broadcastStatus()
        resolve(this.getStatus())
      })

      this.wss.on('error', (err: NodeJS.ErrnoException) => {
        const message =
          err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use` : err.message
        this.status = 'error'
        this.statusError = message
        wlog.error(TAG, message)
        void debug('ERROR', `server error: code=${err.code} message=${message}`)
        this.broadcastStatus()
        resolve(this.getStatus())
      })

      this.wss.on('connection', (ws: WebSocket, req) => {
        const origin = req.headers.origin ?? 'none'
        const ua = req.headers['user-agent'] ?? 'none'
        void debug(
          'INFO',
          `new connection: origin=${origin} ua=${ua.slice(0, 80)} readyState=${ws.readyState}`
        )
        this.handleConnection(ws)
      })
    })
  }

  async stop(): Promise<void> {
    void debug('INFO', 'stop() called')
    this.stopHeartbeat()
    this.rejectAllPending('Server shutting down')

    if (this.client) {
      this.client.close()
      this.client = null
    }

    this.clearBridge()

    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve())
      })
      this.wss = null
    }

    this.status = 'stopped'
    this.statusError = null
    this.extensionVersion = null
    this.broadcastStatus()
    wlog.info(TAG, 'Server stopped')
    void debug('INFO', 'server stopped')
  }

  isConnected(): boolean {
    return this.client !== null && this.client.readyState === 1 /* WebSocket.OPEN */
  }

  getStatus(): ExtensionServerStatus {
    return {
      status: this.status,
      error: this.statusError,
      extensionVersion: this.extensionVersion,
      port: this.currentPort
    }
  }

  setConversationId(id: string | null, title?: string | null): void {
    if (!id) return
    this.currentConversationId = id
    if (title && title !== 'Untitled') this.currentTitle = title
  }

  updateTitle(id: string, title: string): void {
    if (!title || title === 'Untitled') return
    if (id !== this.currentConversationId || !this.isConnected()) return
    if (title === this.currentTitle) return
    this.currentTitle = title
    if (this.syncedConversationId === id) {
      void this.pushEventsSync(id)
    }
  }

  async sendCommand(type: string, params: Record<string, unknown>): Promise<WolffishResponse> {
    if (!this.isConnected()) {
      throw new Error('Browser extension is not connected')
    }

    const id = randomUUID()
    const command: WolffishCommand = { id, type, params }

    if (this.currentConversationId) {
      const event = await logEvent(this.currentConversationId, type, params)

      if (this.currentConversationId !== this.syncedConversationId) {
        this.syncedConversationId = this.currentConversationId
        void this.pushEventsSync(this.currentConversationId)
      } else {
        this.pushEventLogged(event)
      }
    }

    // No execution timeout: a command runs for as long as it legitimately
    // needs (e.g. humanized typing of a long body). Pending commands are not
    // orphaned — rejectAllPending() settles them when the socket closes,
    // shuts down, or is replaced, which is the only way a sent command can
    // fail to come back.
    return new Promise((resolve, reject) => {
      this.pendingCommands.set(id, { resolve, reject })

      try {
        this.client!.send(JSON.stringify(command))
      } catch (err) {
        this.pendingCommands.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  async runTestScenario(): Promise<{ ok: boolean; steps: number; passed: number }> {
    if (!this.isConnected()) {
      return { ok: false, steps: 0, passed: 0 }
    }

    void debug('INFO', 'running test scenario')
    const saved = this.currentConversationId
    const testId = `test-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`
    this.currentConversationId = testId

    // Push events_sync so the extension shows this conversation as active
    void this.pushEventsSync(testId)

    const steps: Array<{ type: string; params: Record<string, unknown> }> = [
      { type: 'browser_tab_open', params: { url: 'https://wolffi.sh/extension', active: true } },
      { type: 'browser_get_url', params: {} },
      { type: 'browser_tabs_list', params: {} },
      { type: 'browser_cookies_get', params: { domain: 'wolffi.sh' } },
      { type: 'browser_screenshot', params: {} },
      { type: 'browser_read_page', params: { format: 'markdown' } },
      { type: 'browser_query_selector', params: { selector: 'h1', limit: 1 } },
      { type: 'browser_get_page_info', params: {} },
      { type: 'browser_scroll', params: { direction: 'down', amount: 300 } },
      { type: 'browser_screenshot', params: { fullPage: true } }
    ]

    let passed = 0
    for (const step of steps) {
      try {
        const res = await this.sendCommand(step.type, step.params)
        if (res.success) passed++
        else void debug('WARN', `test ${step.type}: ${res.error}`)
      } catch (err) {
        void debug('WARN', `test ${step.type} threw: ${err instanceof Error ? err.message : err}`)
      }
    }

    this.currentConversationId = saved
    void debug('INFO', `test scenario complete: ${passed}/${steps.length}`)
    return { ok: passed === steps.length, steps: steps.length, passed }
  }

  sendPortUpdate(port: number): void {
    if (!this.isConnected()) return
    this.sendRaw({ type: 'event', event: 'port_update', data: { port } })
  }

  async requestReload(): Promise<void> {
    if (!this.isConnected()) return
    try {
      this.sendRaw({ type: 'event', event: 'extension_reload', data: {} })
    } catch {
      // best-effort
    }
  }

  private async checkVersionAndReload(): Promise<void> {
    if (!this.extensionVersion) return
    try {
      const runtimeVersion = await getRuntimeExtensionVersion()
      void debug(
        'INFO',
        `version check: extension=${this.extensionVersion} runtime=${runtimeVersion}`
      )
      if (!runtimeVersion) return
      if (this.extensionVersion !== runtimeVersion) {
        wlog.info(
          TAG,
          `Extension version mismatch: running=${this.extensionVersion} runtime=${runtimeVersion} — sending reload`
        )
        void debug('INFO', 'sending extension_reload due to version mismatch')
        this.sendRaw({ type: 'event', event: 'extension_reload', data: {} })
      } else {
        wlog.info(TAG, `Extension version ${this.extensionVersion} is current`)
      }
    } catch (err) {
      void debug('ERROR', `version check failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  async getConversations(): ReturnType<typeof listConversations> {
    return listConversations()
  }

  async getConversationEvents(conversationId: string): Promise<ExtensionEvent[]> {
    return readEvents(conversationId)
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private handleConnection(ws: WebSocket): void {
    if (this.client) {
      void debug('INFO', 'replacing existing client')
      wlog.info(TAG, 'New connection replacing existing client')
      this.client.close()
      this.rejectAllPending('Replaced by new connection')
      this.clearBridge()
    }

    this.client = ws
    this.lastPing = Date.now()
    this.status = 'connected'
    this.statusError = null
    this.startHeartbeat()
    this.exposeBridge()
    this.broadcastStatus()
    wlog.info(TAG, 'Extension connected')
    void debug('INFO', `handleConnection complete — readyState=${ws.readyState}`)

    ws.on('message', (data: Buffer | string) => {
      const raw = String(data)
      void debug('RECV', raw.slice(0, 300))
      this.handleMessage(raw)
    })

    ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason.toString()
      void debug(
        'INFO',
        `ws close: code=${code} reason="${reasonStr}" wasOurs=${this.client === ws}`
      )
      wlog.info(TAG, `WebSocket close: code=${code} reason="${reasonStr}"`)
      if (this.client === ws) {
        this.client = null
        this.status = this.wss ? 'listening' : 'stopped'
        this.extensionVersion = null
        this.stopHeartbeat()
        this.rejectAllPending('Extension disconnected')
        this.clearBridge()
        this.broadcastStatus()
        wlog.info(TAG, 'Extension disconnected')
        void debug('INFO', 'cleanup complete after disconnect')
      }
    })

    ws.on('error', (err) => {
      void debug('ERROR', `ws error: ${err.message}`)
      wlog.error(TAG, `WebSocket error: ${err.message}`)
    })

    ws.on('unexpected-response', (_req, res) => {
      void debug('ERROR', `unexpected-response: status=${res.statusCode}`)
      wlog.error(TAG, `Unexpected response: ${res.statusCode}`)
    })
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw) as Record<string, unknown>
    } catch {
      void debug('WARN', `invalid JSON: ${raw.slice(0, 100)}`)
      wlog.warn(TAG, 'Received invalid JSON')
      return
    }

    if (msg.type === 'ping') {
      this.lastPing = Date.now()
      this.sendRaw({ type: 'pong' })
      return
    }

    if (msg.type === 'get_conversations') {
      void this.pushConversationsList()
      return
    }

    if (msg.type === 'get_conversation_events' && typeof msg.conversationId === 'string') {
      void this.pushConversationEvents(msg.conversationId as string)
      return
    }

    if (msg.type === 'extension_info') {
      this.extensionVersion = (msg.version as string) ?? null
      void debug('INFO', `extension_info: version=${this.extensionVersion}`)
      this.broadcastStatus()
      void this.checkVersionAndReload()
      return
    }

    if (typeof msg.id === 'string') {
      const pending = this.pendingCommands.get(msg.id)
      if (pending) {
        this.pendingCommands.delete(msg.id)
        pending.resolve(msg as unknown as WolffishResponse)
        void debug('INFO', `resolved command ${msg.id}`)
      } else {
        void debug('WARN', `no pending command for id=${msg.id}`)
      }
    }
  }

  private sendRaw(data: unknown): void {
    if (this.isConnected()) {
      const json = JSON.stringify(data)
      void debug('SEND', json.slice(0, 300))
      this.client!.send(json)
    }
  }

  private async pushEventsSync(conversationId: string): Promise<void> {
    try {
      const title = this.currentTitle || 'Untitled'
      const events = await readEvents(conversationId)
      this.sendRaw({
        type: 'event',
        event: 'events_sync',
        data: { conversationId, title, events }
      })
      const conversations = await listConversations()
      const existing = conversations.find((c) => c.conversationId === conversationId)
      if (existing) {
        existing.title = title
      } else {
        conversations.unshift({
          conversationId,
          title,
          eventCount: events.length,
          lastTimestamp: Date.now()
        })
      }
      this.sendRaw({
        type: 'event',
        event: 'conversations_list',
        data: conversations
      })
    } catch {
      // best-effort
    }
  }

  private async pushConversationsList(): Promise<void> {
    try {
      const conversations = await listConversations()
      if (this.currentConversationId && this.currentTitle) {
        const existing = conversations.find((c) => c.conversationId === this.currentConversationId)
        if (existing) {
          existing.title = this.currentTitle
        }
      }
      this.sendRaw({
        type: 'event',
        event: 'conversations_list',
        data: conversations
      })
    } catch {
      // best-effort
    }
  }

  private async pushConversationEvents(conversationId: string): Promise<void> {
    try {
      const events = await readEvents(conversationId)
      this.sendRaw({
        type: 'event',
        event: 'conversation_events',
        data: { conversationId, events }
      })
    } catch {
      // best-effort
    }
  }

  private pushEventLogged(event: ExtensionEvent): void {
    this.sendRaw({
      type: 'event',
      event: 'event_logged',
      data: event
    })
  }

  private exposeBridge(): void {
    ;(globalThis as Record<string, unknown>).__wolffishExtensionBridge = {
      sendCommand: (type: string, params: Record<string, unknown>) =>
        this.sendCommand(type, params),
      isConnected: () => this.isConnected(),
      getStatus: () => this.getStatus(),
      getConfig: () => getBrowserExtensionConfig()
    }
    void debug('INFO', 'bridge exposed on globalThis')
  }

  private clearBridge(): void {
    ;(globalThis as Record<string, unknown>).__wolffishExtensionBridge = null
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      const elapsed = Date.now() - this.lastPing
      if (elapsed > HEARTBEAT_CHECK_MS) {
        void debug('WARN', `heartbeat timeout: ${elapsed}ms since last ping`)
        wlog.warn(TAG, 'Extension heartbeat timeout, closing connection')
        this.client?.close()
      }
    }, HEARTBEAT_CHECK_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private rejectAllPending(reason: string): void {
    const count = this.pendingCommands.size
    if (count > 0) void debug('INFO', `rejecting ${count} pending commands: ${reason}`)
    for (const [id, pending] of this.pendingCommands) {
      pending.reject(new Error(reason))
      this.pendingCommands.delete(id)
    }
  }

  private broadcastStatus(): void {
    this.onStatusChange?.(this.getStatus())
  }
}
