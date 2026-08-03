/**
 * The Mobile channel — the desktop end of the tunnel to wolffish-mobile.
 *
 * Structurally a sibling of the Telegram and WhatsApp channels: it owns a
 * transport, exposes status to the settings panel, and serves the agent's
 * world to a remote surface. What differs is the shape of that surface. A
 * Telegram chat is a message stream; the phone is a second view of the whole
 * app, so this channel answers for configuration, the conversation index,
 * conversation bodies on demand, and usage — and pushes changes as they
 * happen so the phone stays live rather than polling.
 *
 * The desktop is the `host`: it parks on the relay and waits. The phone dials
 * in when it is in the foreground and disappears when iOS suspends it, which
 * is why every reconnect re-handshakes and nothing here assumes continuity.
 */
import {
  loadIdentity,
  loadPairing,
  peerKeyBytes,
  ridForPairing,
  savePairing,
  secretBytes,
  updatePairing,
  clearPairing,
  storageBackend,
  type MobilePairing
} from '@main/channels/mobile/keys'
import { buildConfigSnapshot, type SnapshotSources } from '@main/channels/mobile/snapshot'
import { listConversations, loadConversation, type ConversationFile } from '@main/conversations'
import { DEFAULT_RELAY_URL, Event, Rpc, type ConversationMeta } from '@main/tunnel/protocol'
import {
  generateCode,
  encodePairingPayload,
  rendezvousId,
  secretFromCode,
  toBase64Url,
  toHex,
  CODE_TTL_MS
} from '@main/tunnel/pairing'
import { Tunnel, type TunnelState } from '@main/tunnel/tunnel'
import { randomBytes } from 'node:crypto'

export type MobileStatus = {
  /** Nothing paired, or a phone is known. */
  paired: boolean
  pairing: {
    method: 'qr' | 'code'
    pairedAt: number
    lastSeenAt: number | null
    deviceName: string | null
  } | null
  /** Live tunnel state; null before a tunnel is started. */
  tunnel: TunnelState | null
  /** Present only while a pairing offer is open. */
  offer: {
    mode: 'qr' | 'code'
    /** The QR's payload string; the panel renders it as a QR image. */
    payload: string | null
    /** The typed code, formatted `K7M9-2QXR`. */
    code: string | null
    expiresAt: number
  } | null
  /** Which platform store protects the keys, for the privacy card. */
  storage: { available: boolean; backend: string }
  verbose: boolean
}

export type MobileChannelDeps = SnapshotSources & {
  /** Broadcast to the renderer so the panel updates without polling. */
  onStatus?: (status: MobileStatus) => void
  /** Channel log line, matching the other channels' verbose output. */
  log?: (line: string) => void
  relayUrl?: string
}

export class MobileChannel {
  private tunnel: Tunnel | null = null
  private offer: MobileStatus['offer'] = null
  private offerTimer: ReturnType<typeof setTimeout> | null = null
  private pairing: MobilePairing | null = null
  private tunnelState: TunnelState | null = null
  private verbose = false
  private readonly relayUrl: string

  constructor(private readonly deps: MobileChannelDeps) {
    this.relayUrl = deps.relayUrl ?? DEFAULT_RELAY_URL
  }

  // -------------------------------------------------------------- lifecycle

  /** Restore a stored pairing and start listening. Safe to call on every boot. */
  async start(): Promise<void> {
    this.pairing = await loadPairing()
    if (!this.pairing) {
      this.emitStatus()
      return
    }
    await this.openTunnel('qr')
  }

  async stop(): Promise<void> {
    this.clearOffer()
    this.tunnel?.stop()
    this.tunnel = null
    this.tunnelState = null
    this.emitStatus()
  }

  setVerbose(verbose: boolean): void {
    this.verbose = verbose
    this.emitStatus()
  }

  private log(line: string): void {
    if (this.verbose) this.deps.log?.(`[mobile] ${line}`)
  }

  // ---------------------------------------------------------------- pairing

  /**
   * Begin a QR pairing. The payload carries the relay, this desktop's public
   * key and a fresh secret, so the phone can run IKpsk2 in one round trip.
   */
  async offerQr(): Promise<MobileStatus> {
    const identity = await loadIdentity()
    const secret = new Uint8Array(randomBytes(32))
    const payload = encodePairingPayload({
      v: 1,
      relay: this.relayUrl,
      pk: toHex(identity.publicKey),
      ps: toBase64Url(secret)
    })
    await this.beginPairing(secret, 'qr', { payload, code: null })
    return this.getStatus()
  }

  /**
   * Begin a typed-code pairing, for a desktop with no screen the phone can see
   * — a headless box, or a session over SSH. The code carries only the secret,
   * so the handshake is XXpsk3 and both keys are exchanged inside it.
   */
  async offerCode(): Promise<MobileStatus> {
    const code = generateCode((length) => new Uint8Array(randomBytes(length)))
    const secret = secretFromCode(code)
    await this.beginPairing(secret, 'code', { payload: null, code })
    return this.getStatus()
  }

  private async beginPairing(
    secret: Uint8Array,
    mode: 'qr' | 'code',
    display: { payload: string | null; code: string | null }
  ): Promise<void> {
    this.clearOffer()
    this.tunnel?.stop()
    this.tunnel = null

    // The offer *is* the pairing until a phone completes a handshake: the
    // rendezvous is derived from this secret, so the desktop must already be
    // waiting there when the phone arrives.
    this.pairing = {
      secret: toBase64Url(secret),
      peerPublicKey: null,
      method: mode,
      pairedAt: Date.now(),
      lastSeenAt: null,
      deviceName: null
    }
    await savePairing(this.pairing)

    const expiresAt = Date.now() + CODE_TTL_MS
    this.offer = { mode, payload: display.payload, code: display.code, expiresAt }
    this.offerTimer = setTimeout(() => {
      // An unclaimed offer must not linger: a code read aloud or a QR left on
      // screen should stop working on its own.
      if (this.pairing && !this.pairing.peerPublicKey) void this.unpair()
      else this.clearOffer()
    }, CODE_TTL_MS)

    this.log(`pairing offer opened (${mode}), rendezvous ${rendezvousId(secret).slice(0, 16)}…`)
    await this.openTunnel(mode)
  }

  private clearOffer(): void {
    if (this.offerTimer) clearTimeout(this.offerTimer)
    this.offerTimer = null
    this.offer = null
  }

  /** Forget the phone entirely. */
  async unpair(): Promise<MobileStatus> {
    this.clearOffer()
    this.tunnel?.stop()
    this.tunnel = null
    this.tunnelState = null
    this.pairing = null
    await clearPairing()
    this.log('unpaired')
    this.emitStatus()
    return this.getStatus()
  }

  // ----------------------------------------------------------------- tunnel

  private async openTunnel(mode: 'qr' | 'code'): Promise<void> {
    if (!this.pairing) return
    const identity = await loadIdentity()
    const pairing = this.pairing

    const tunnel = new Tunnel({
      role: 'host',
      relayUrl: this.relayUrl,
      rid: ridForPairing(pairing),
      staticKeypair: identity,
      pairingSecret: secretBytes(pairing),
      peerStaticPublicKey: peerKeyBytes(pairing),
      identity: { device: 'wolffish-app', platform: process.platform },
      autoReconnect: true,
      verbose: this.verbose,
      log: (line) => this.deps.log?.(line)
    })
    this.tunnel = tunnel

    tunnel.onState((state) => {
      this.tunnelState = state
      // A completed handshake is the moment a pairing offer becomes a pairing.
      if (state.status === 'connected') void this.onConnected()
      this.emitStatus()
    })

    this.registerHandlers(tunnel)
    // Failures are already folded into tunnel state and retried with backoff;
    // surfacing them again here would double-report the same condition.
    void tunnel.start(mode).catch(() => undefined)
  }

  private async onConnected(): Promise<void> {
    const key = this.tunnel?.peerStaticPublicKey
    if (!key || !this.pairing) return
    const hex = toHex(key)
    if (this.pairing.peerPublicKey !== hex) {
      // First completed handshake — pin the phone and close the offer, so the
      // QR on screen and the code stop being usable by anyone else.
      this.pairing = (await updatePairing({ peerPublicKey: hex, lastSeenAt: Date.now() })) ?? null
      this.clearOffer()
      this.log(`paired with phone key ${hex.slice(0, 8)}…`)
    } else {
      this.pairing = (await updatePairing({ lastSeenAt: Date.now() })) ?? null
    }
    this.emitStatus()
  }

  // --------------------------------------------------------------- handlers

  private registerHandlers(tunnel: Tunnel): void {
    tunnel.onRpc(Rpc.hello, async (params) => {
      const name = typeof params.deviceName === 'string' ? params.deviceName : null
      if (name && this.pairing?.deviceName !== name) {
        this.pairing = (await updatePairing({ deviceName: name })) ?? null
        this.emitStatus()
      }
      return { ok: true, app: 'wolffish-app', platform: process.platform }
    })

    tunnel.onRpc(Rpc.configSnapshot, () => buildConfigSnapshot(this.deps))

    /**
     * Metadata only — titles, icons, counts, timestamps. Never message bodies:
     * a real workspace is ~900 MB of conversation JSON, and the phone opens
     * one conversation at a time.
     */
    tunnel.onRpc(Rpc.conversationIndex, async (params) => {
      const since = typeof params.since === 'number' ? params.since : 0
      const all = await listConversations()
      const rows = all
        .filter((meta) => (meta.updatedAt ?? 0) > since)
        .map(
          (meta): ConversationMeta => ({
            id: meta.id,
            title: meta.title,
            model: null,
            channel: meta.channel ?? null,
            icon: meta.icon ?? null,
            projectId: meta.projectId ?? null,
            sealed: false,
            createdAt: meta.updatedAt,
            updatedAt: meta.updatedAt,
            messageCount: meta.messageCount,
            stats: null,
            summary: null
          })
        )
      this.log(`served conversation index — ${rows.length} of ${all.length} rows since ${since}`)
      return { rows, total: all.length, at: Date.now() }
    })

    /** One conversation, fetched when the phone opens it. */
    tunnel.onRpc(Rpc.conversationBody, async (params) => {
      const id = String(params.id ?? '')
      const file = await loadConversation(id)
      if (!file) throw new Error(`unknown conversation ${id}`)
      return toWireConversation(file)
    })

    tunnel.onRpc(Rpc.usage, async () => {
      const days = (await this.deps.usageDays?.()) ?? []
      return { days }
    })
  }

  // ------------------------------------------------------------------ push

  /** A conversation was created or changed — the phone's list updates live. */
  pushConversationUpserted(meta: ConversationMeta): void {
    this.tunnel?.emit(Event.conversationUpserted, meta)
  }

  pushConversationDeleted(id: string): void {
    this.tunnel?.emit(Event.conversationDeleted, { id })
  }

  /** Streaming assistant output for whichever conversation the phone has open. */
  pushMessageDelta(conversationId: string, text: string, seq: number): void {
    this.tunnel?.emit(Event.messageDelta, { conversationId, text, seq })
  }

  pushMessageAppended(conversationId: string, message: unknown): void {
    this.tunnel?.emit(Event.messageAppended, { conversationId, message })
  }

  pushTurnStatus(conversationId: string, state: string, detail?: unknown): void {
    this.tunnel?.emit(Event.turnStatus, { conversationId, state, detail })
  }

  pushTurnScored(conversationId: string, score: unknown): void {
    this.tunnel?.emit(Event.turnScored, { conversationId, score })
  }

  /** Any settings change — the phone refreshes the affected screen. */
  pushConfigChanged(section?: string): void {
    this.tunnel?.emit(Event.configChanged, { section: section ?? null, at: Date.now() })
  }

  pushUsageChanged(): void {
    this.tunnel?.emit(Event.usageChanged, { at: Date.now() })
  }

  // ----------------------------------------------------------------- status

  getStatus(): MobileStatus {
    return {
      paired: Boolean(this.pairing?.peerPublicKey),
      pairing: this.pairing
        ? {
            method: this.pairing.method,
            pairedAt: this.pairing.pairedAt,
            lastSeenAt: this.pairing.lastSeenAt,
            deviceName: this.pairing.deviceName
          }
        : null,
      tunnel: this.tunnelState,
      offer: this.offer,
      storage: storageBackend(),
      verbose: this.verbose
    }
  }

  private emitStatus(): void {
    this.deps.onStatus?.(this.getStatus())
  }

  get connected(): boolean {
    return this.tunnel?.connected ?? false
  }
}

/** Desktop conversation file → the phone's message shape. */
function toWireConversation(file: ConversationFile): Record<string, unknown> {
  return {
    id: file.id,
    title: file.title,
    model: file.model ?? null,
    channel: (file as { channel?: string }).channel ?? null,
    icon: (file as { icon?: string }).icon ?? null,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    stats: (file as { stats?: unknown }).stats ?? null,
    messages: (file.messages ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      // Attachments and tool payloads travel verbatim; the phone's renderers
      // already understand the desktop's shapes.
      payload: stripUndefined({
        attachments: (message as { attachments?: unknown }).attachments,
        segments: (message as { segments?: unknown }).segments,
        rating: (message as { rating?: unknown }).rating
      })
    }))
  }
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined)
  return entries.length ? Object.fromEntries(entries) : undefined
}
