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
  loadRelayUrl,
  peerKeyBytes,
  ridForPairing,
  savePairing,
  saveRelayUrl,
  secretBytes,
  updatePairing,
  clearPairing,
  storageBackend,
  type MobilePairing
} from '@main/channels/mobile/keys'
import { buildConfigSnapshot, type SnapshotSources } from '@main/channels/mobile/snapshot'
import {
  assistantSegmentsToHistory,
  buildAssistantMessage,
  replayWindow,
  stubStaleToolResults,
  type AssistantAccumulator
} from '@main/channels/channel'
import { extractTranscript, extractVoiceLanguage } from '@main/channels/stt-result'
import {
  createConversation,
  listConversations,
  loadConversation,
  mintMessageId,
  saveConversation,
  updateConversation,
  type ConversationFile,
  type ConversationMessage,
  type MessageAttachment
} from '@main/conversations'
import { composeAttachmentContext } from '@main/uploads/compose-attachments'
import {
  classifyFile,
  resolveUploadPath,
  saveUploadFromFile,
  statUpload,
  uploadExists
} from '@main/uploads/uploads'
import { workspaceRoot } from '@main/workspace/root'
import {
  CHUNK_SIZE,
  DEFAULT_RELAY_URL,
  Event,
  Rpc,
  type ConversationMeta
} from '@main/tunnel/protocol'
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
import type { TurnRunner } from '@main/channels/turn-runner'
import type { TurnSink } from '@main/channels/channel'
import { upsertWorkflowSegment, type Segment } from '@main/runtime/broca'
import type { ChatHistoryMessage } from '@preload/index'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export type MobileStatus = {
  /** Nothing paired, or a phone is known. */
  paired: boolean
  pairing: {
    method: 'qr' | 'code'
    pairedAt: number
    lastSeenAt: number | null
    deviceName: string | null
    /** How the phone describes itself. Null on a phone running an older build. */
    platform: 'ios' | 'android' | null
    model: string | null
    osVersion: string | null
    appVersion: string | null
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
  /** Relay endpoint the tunnel dials — known before pairing, shown in the panel. */
  relayUrl: string
  /** What "reset to default" returns to, so the panel needn't hardcode it. */
  defaultRelayUrl: string
}

/** The reflection fields the phone may patch — mirrors workspace's ReflectionConfig. */
export type ReflectionWirePatch = {
  hour?: number
  quietHours?: number
  scoring?: Partial<Record<'inapp' | 'telegram' | 'whatsapp', boolean>>
}

export type MobileChannelDeps = SnapshotSources & {
  /** Runs turns the phone starts, exactly as the other channels do. */
  runner: TurnRunner
  /**
   * Apply a reflection-config patch exactly as the settings IPC does —
   * persist, reschedule, announce — answering the complete post-write
   * config. Optional so hosts that don't serve reflection simply refuse.
   */
  applyReflectionConfig?: (patch: ReflectionWirePatch) => Promise<Record<string, unknown>>
  /** Start a reflection job now — the same enqueue the panel's Run-now uses. */
  runReflectionJob?: (
    kind: 'reflection' | 'deepClean'
  ) => Promise<'running' | 'queued' | 'coalesced'>
  /**
   * Apply a phone-edited settings patch through the same setters the
   * desktop's own panels use. Whitelisted inside; throws on unknown keys.
   * Absent = phone settings stay a read-only mirror.
   */
  applySettings?: (settings: Record<string, unknown>) => Promise<void>
  /** Replace the workspace's prompt variables — the phone's Variables page. */
  applyVariables?: (
    variables: Array<{ name: string; value: string; sensitive: boolean }>
  ) => Promise<void>
  /**
   * Flip one capability through the same implementation the desktop's own
   * settings toggle runs. Resolves to the enabled state that actually holds
   * (a locked core refuses the off); throws on a name this desktop no longer
   * has, which can only be a stale phone screen.
   */
  applyCapability?: (name: string, enabled: boolean) => Promise<boolean>
  /**
   * One month of this build's own release notes, markdown verbatim — the
   * same pages the desktop's Changelog screen reads. Null for a month this
   * build does not carry. Absent = the snapshot omits `changelog` and the
   * phone's What's-new desktop tab shows its empty state.
   */
  readChangelog?: (month: string, locale: string) => Promise<string | null>
  /** Broadcast to the renderer so the panel updates without polling. */
  onStatus?: (status: MobileStatus) => void
  /**
   * Relay logging. Always on and always per-day, in the workspace log beside
   * every other channel: the desktop is the source of truth for what the
   * connection did, and the phone keeps no log of its own.
   */
  log?: (line: string) => void
  /** Detail for diagnosis — frame-level activity, resolved values. */
  debug?: (line: string) => void
  relayUrl?: string
}

/** Chunked uploads park here until committed — under the workspace uploads
 *  root so the final adopt is a same-volume atomic rename. Dot-prefixed so it
 *  can never collide with a conversation's `conv-…` upload folder. */
const UPLOAD_STAGING_DIR = '.pending'
/** An upload nobody has touched for this long is abandoned and swept. */
const UPLOAD_IDLE_MS = 10 * 60_000
/** Ceiling for one uploaded file. Far above anything the phone produces today
 *  (a voice note is ~1 MB/min); exists so a runaway client stays bounded. */
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

type PendingUpload = {
  conversationId: string
  name: string
  mimeType: string | null
  /** Size the phone declared at begin — commit refuses any other total. */
  expected: number
  received: number
  stagedPath: string
  handle: fs.FileHandle
  idleTimer: ReturnType<typeof setTimeout>
}

export class MobileChannel {
  private tunnel: Tunnel | null = null
  private offer: MobileStatus['offer'] = null
  private offerTimer: ReturnType<typeof setTimeout> | null = null
  private pairing: MobilePairing | null = null
  private tunnelState: TunnelState | null = null
  private verbose = false
  /** Mutable: the panel can point the tunnel at a self-hosted relay. */
  private relayUrl: string
  /** Live turns the phone started, so it can abort them. */
  private readonly turns = new Map<string, { turnId: string; controller: AbortController }>()
  /** Chunked uploads in flight, keyed by upload id. */
  private readonly uploads = new Map<string, PendingUpload>()

  constructor(private readonly deps: MobileChannelDeps) {
    this.relayUrl = deps.relayUrl ?? DEFAULT_RELAY_URL
  }

  // -------------------------------------------------------------- lifecycle

  /** Restore a stored pairing and start listening. Safe to call on every boot. */
  async start(): Promise<void> {
    // The stored override must win before any tunnel dials out; deps.relayUrl
    // stays the programmatic default (tests), DEFAULT_RELAY_URL the shipped one.
    this.relayUrl = (await loadRelayUrl()) ?? this.deps.relayUrl ?? DEFAULT_RELAY_URL
    this.pairing = await loadPairing()
    if (!this.pairing) {
      this.log('no pairing stored — waiting for one to be offered')
      this.emitStatus()
      return
    }
    this.log(
      `restoring pairing from ${new Date(this.pairing.pairedAt).toISOString()} ` +
        `(${this.pairing.method}, device ${this.pairing.deviceName ?? 'unknown'})`
    )
    await this.openTunnel('qr')
  }

  async stop(): Promise<void> {
    this.log('channel stopping')
    this.clearOffer()
    await this.abortAllUploads()
    this.tunnel?.stop()
    this.tunnel = null
    this.tunnelState = null
    this.emitStatus()
  }

  /**
   * Whether the phone's feed shows tool calls and task results, mirroring the
   * same switch on Telegram, WhatsApp and the in-app feed. Off (default) sends
   * a clean feed: assistant messages, file-bearing results and errors only.
   * Display-only — it never affects what is stored, and never affects logging.
   */
  setVerbose(verbose: boolean): void {
    this.verbose = verbose
    this.emitStatus()
  }

  /**
   * Point the tunnel at a different relay — any deployment of the open-source
   * wolffish-relay, or a service speaking the same forwarding contract. Null
   * clears the override and returns to the default.
   *
   * The relay is part of the pairing contract: the QR/code payload names it,
   * and the phone keeps dialing whatever it learned at pairing time. So a
   * change drops any open offer and any paired phone rather than leave a link
   * that can never form again — the panel warns before calling this.
   */
  async setRelayUrl(url: string | null): Promise<MobileStatus> {
    const override = normalizeRelayUrl(url) // throws on a malformed URL
    await saveRelayUrl(override)
    const next = override ?? this.deps.relayUrl ?? DEFAULT_RELAY_URL
    if (next !== this.relayUrl) {
      if (this.pairing) await this.unpair()
      this.relayUrl = next
      this.log(`relay set to ${next}`)
    }
    this.emitStatus()
    return this.getStatus()
  }

  /**
   * Connection logging is unconditional. A tunnel that will not connect is
   * exactly when the record matters, and nobody can be asked to reproduce a
   * failure with logging switched on afterwards. `verbose` is a *feed*
   * preference and has nothing to do with this.
   */
  private log(line: string): void {
    this.deps.log?.(line)
  }

  /** Detail: served RPCs, pushes, per-frame activity. */
  private debug(line: string): void {
    this.deps.debug?.(line)
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

  /**
   * Drop the live link but keep the pairing. The phone reconnects on its own
   * the next time it is opened — this is for cutting a session loose, not for
   * ending the relationship, which is what unpair() is for.
   */
  async disconnect(): Promise<MobileStatus> {
    this.clearOffer()
    this.tunnel?.stop()
    this.tunnel = null
    this.tunnelState = null
    this.log('disconnected by request — pairing kept')
    this.emitStatus()
    return this.getStatus()
  }

  /** Forget the phone entirely. */
  async unpair(): Promise<MobileStatus> {
    this.clearOffer()
    this.tunnel?.stop()
    this.tunnel = null
    this.tunnelState = null
    this.pairing = null
    await clearPairing()
    this.log('unpaired — keys removed, tunnel closed')
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
      // The desktop parks. It is the host: it must be sitting at the
      // rendezvous whenever the phone decides to open, which is most often
      // when nothing here is watching.
      peerWaitMs: null,
      // Always on: see log() above.
      verbose: true,
      log: (line) => this.deps.log?.(line)
    })
    this.tunnel = tunnel

    tunnel.onState((state) => {
      const previous = this.tunnelState
      this.tunnelState = state
      const transition =
        state.status !== previous?.status || state.peerPresent !== previous?.peerPresent
      // Every transition is recorded: this sequence is the whole story when a
      // link will not form. Transitions ONLY — this listener also fires on
      // counter movement, and logging per frame is a disk write per frame.
      if (transition) {
        this.log(
          state.lastError
            ? `${state.status} — ${state.lastError}`
            : `${state.status}${state.peerPresent ? ' (phone present)' : ''}`
        )
        this.debug(
          `state: ${state.status} peer=${state.peerPresent} frames=${state.framesSent}/${state.framesReceived} ` +
            `bytes=${state.bytesSent}/${state.bytesReceived} reconnects=${state.reconnects}`
        )
      }
      // A completed handshake is the moment a pairing offer becomes a pairing
      // — the moment, not the duration. Running this on every event while
      // connected rewrote the sealed pairing file (a safeStorage encrypt plus
      // a whole-file write) once per tick, and that grind is what froze the
      // desktop mid-sync.
      if (state.status === 'connected' && previous?.status !== 'connected') {
        void this.onConnected()
      }
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
      this.log(`paired — phone key pinned ${hex.slice(0, 8)}…, offer closed`)
    } else {
      this.pairing = (await updatePairing({ lastSeenAt: Date.now() })) ?? null
      this.debug('reconnected to the pinned phone')
    }
    this.emitStatus()
  }

  // --------------------------------------------------------------- handlers

  private registerHandlers(tunnel: Tunnel): void {
    tunnel.onRpc(Rpc.hello, async (params) => {
      // The phone describes itself here. Everything is optional and only
      // written when it changes, so an older phone that sends a name alone
      // still works and a reconnect does not rewrite the file for nothing.
      const text = (value: unknown): string | null =>
        typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null
      const platform =
        params.platform === 'ios' || params.platform === 'android' ? params.platform : null
      const described = {
        deviceName: text(params.deviceName),
        platform,
        model: text(params.model),
        osVersion: text(params.osVersion),
        appVersion: text(params.appVersion)
      }
      const patch = Object.fromEntries(
        Object.entries(described).filter(
          ([key, value]) =>
            value !== null && value !== this.pairing?.[key as keyof typeof described]
        )
      )
      if (Object.keys(patch).length > 0) {
        this.pairing = (await updatePairing(patch)) ?? null
        this.emitStatus()
      }
      return { ok: true, app: 'wolffish-app', platform: process.platform }
    })

    tunnel.onRpc(Rpc.configSnapshot, async () => {
      const snapshot = await buildConfigSnapshot(this.deps)
      this.debug(`served config snapshot (${Object.keys(snapshot).length} sections)`)
      return snapshot
    })

    /**
     * The phone edits a setting; this desktop persists it through the same
     * setters its own panels call, so the change is live everywhere at once.
     * The applier validates against a whitelist and throws on anything else —
     * an error here makes the phone refetch the snapshot and revert.
     */
    tunnel.onRpc(Rpc.configSet, async (params) => {
      const settings = (params as { settings?: unknown })?.settings
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new Error('configSet needs a settings object')
      }
      if (!this.deps.applySettings) throw new Error('this desktop does not accept phone edits')
      await this.deps.applySettings(settings as Record<string, unknown>)
      this.debug(`applied phone settings: ${Object.keys(settings).join(', ')}`)
      return { ok: true }
    })

    /**
     * Whole-array variables replace — same contract as the desktop's own
     * variables:save. Each row is coerced field by field so a malformed
     * entry costs itself, never the write.
     */
    tunnel.onRpc(Rpc.variablesSet, async (params) => {
      const raw = (params as { variables?: unknown })?.variables
      if (!Array.isArray(raw)) throw new Error('variablesSet needs a variables array')
      if (!this.deps.applyVariables) throw new Error('this desktop does not accept phone edits')
      const variables = raw
        .map((entry) => {
          const row = (entry ?? {}) as Record<string, unknown>
          return {
            name: typeof row.name === 'string' ? row.name.trim() : '',
            value: typeof row.value === 'string' ? row.value : '',
            sensitive: row.sensitive === true
          }
        })
        .filter((row) => row.name.length > 0)
      await this.deps.applyVariables(variables)
      this.debug(`applied ${variables.length} variable(s) from phone`)
      return { ok: true }
    })

    /**
     * One capability toggle, applied through the same implementation the
     * desktop's own switch runs (validation, locked-core guard, broadcast).
     * The answer carries the state that actually holds, which is how a
     * refused write tells the phone to snap its switch back without a full
     * snapshot round trip.
     */
    tunnel.onRpc(Rpc.capabilitySet, async (params) => {
      const { name, enabled } = (params ?? {}) as { name?: unknown; enabled?: unknown }
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error('capabilitySet needs a capability name')
      }
      if (!this.deps.applyCapability) throw new Error('this desktop does not accept phone edits')
      const actual = await this.deps.applyCapability(name, enabled === true)
      this.log(`capability ${name} switched ${actual ? 'on' : 'off'} by the phone`)
      return { ok: true, enabled: actual }
    })

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
      // The full id list, on request. `since` can only ever report what still
      // exists, so a conversation deleted while the phone was away is
      // invisible to an incremental pull — it would sit on the phone forever.
      // Ids are small (a reconcile of 1000 conversations is tens of KB) and
      // this runs on reconnect, not on a timer.
      const ids = params.withIds === true ? all.map((meta) => meta.id) : undefined
      this.debug(`served conversation index — ${rows.length} of ${all.length} rows since ${since}`)
      return { rows, total: all.length, at: Date.now(), ...(ids ? { ids } : {}) }
    })

    /** One conversation, fetched when the phone opens it. */
    tunnel.onRpc(Rpc.conversationBody, async (params) => {
      const id = String(params.id ?? '')
      const file = await loadConversation(id)
      if (!file) {
        this.log(`conversation body requested for unknown id ${id}`)
        throw new Error(`unknown conversation ${id}`)
      }
      this.debug(`served conversation ${id} (${file.messages?.length ?? 0} messages)`)
      return toWireConversation(file)
    })

    tunnel.onRpc(Rpc.usage, async () => {
      const days = (await this.deps.usageDays?.()) ?? []
      this.debug(`served usage ledger (${days.length} days)`)
      return { days }
    })

    /**
     * One month of this desktop's own release notes. The month is a path
     * segment on the serving side, so anything but a literal `YYYY-MM` is
     * refused here — wire values index into the filesystem and must never
     * carry a traversal. Locale likewise reduces to a plain language tag;
     * the reader falls back to English exactly as the desktop's own
     * Changelog screen does.
     */
    tunnel.onRpc(Rpc.changelogRead, async (params) => {
      const month = String(params.month ?? '')
      if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`not a changelog month: ${month}`)
      const locale = /^[a-z]{2}$/.test(String(params.locale ?? '')) ? String(params.locale) : 'en'
      const markdown = (await this.deps.readChangelog?.(month, locale)) ?? null
      this.debug(`served changelog ${month} (${locale}) — ${markdown ? markdown.length : 0} chars`)
      return { markdown }
    })

    /**
     * The phone hands over a prompt; this desktop runs the turn. Output goes
     * back as events rather than an RPC result — the phone renders a stream,
     * not a reply, so it looks the same as a turn started here.
     *
     * The answer carries only the conversation id, and the rest of the turn —
     * persisting the user message, transcribing a voice note, dispatching the
     * runner — continues after the reply is on the wire. It has to: a voice
     * note's transcription can outlive the phone's RPC timeout (the STT model
     * may still be downloading), and the phone needs the id immediately to
     * navigate. Failures in the continuation surface as a `turn.status` error
     * push against that id, which the phone already renders.
     */
    tunnel.onRpc(Rpc.sendMessage, async (params) => {
      const text = String(params.text ?? '').trim()
      const attachments = await this.sanitizeAttachments(params.attachments)
      // Only an audio file can be a voice prompt — a flag on anything else is
      // a malformed client and is ignored rather than honored.
      const voicePrompt = params.voicePrompt === true && attachments.some((a) => a.type === 'audio')
      const voiceLang =
        typeof params.voiceLang === 'string' && params.voiceLang.trim()
          ? params.voiceLang.trim()
          : undefined
      if (!text && attachments.length === 0) throw new Error('empty prompt')
      let conversationId = typeof params.conversationId === 'string' ? params.conversationId : null

      if (!conversationId) {
        const created = createConversation(null)
        // A voice note has no text yet — leave 'Untitled' so the titler names
        // it from the transcript once the turn runs.
        if (text) created.title = text.slice(0, 60)
        created.messages = []
        await saveConversation(created)
        conversationId = created.id
      }

      const cid = conversationId
      void this.continueSend(cid, text, attachments, voicePrompt, voiceLang).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        this.log(`send from the phone failed in ${cid} — ${message}`)
        this.pushTurnStatus(cid, 'error', message)
      })
      return { conversationId: cid }
    })

    tunnel.onRpc(Rpc.abortTurn, async (params) => {
      const conversationId = String(params.conversationId ?? '')
      const live = this.turns.get(conversationId)
      live?.controller.abort()
      this.turns.delete(conversationId)
      this.log(`abort requested for ${conversationId} — ${live ? 'stopped' : 'nothing running'}`)
      return { aborted: Boolean(live) }
    })

    /**
     * The phone edits the reflection schedule/scoring. The wire shape is
     * data, not policy: every field is re-derived here and anything malformed
     * costs itself rather than the whole patch. The answer is the desktop's
     * own post-write config — the phone renders that, so the two screens can
     * never disagree about what was saved.
     */
    tunnel.onRpc(Rpc.setReflectionConfig, async (params) => {
      const apply = this.deps.applyReflectionConfig
      if (!apply) throw new Error('reflection config not served here')
      const patch = sanitizeReflectionPatch(params)
      const cfg = await apply(patch)
      this.log(
        `reflection config updated from the phone (${Object.keys(patch).join(', ') || 'no-op'})`
      )
      return cfg
    })

    tunnel.onRpc(Rpc.runReflection, async (params) => {
      const run = this.deps.runReflectionJob
      if (!run) throw new Error('reflection jobs not served here')
      const kind = params.kind === 'deepClean' ? 'deepClean' : 'reflection'
      const result = await run(kind)
      this.log(`${kind} run requested from the phone — ${result}`)
      return { result }
    })

    /**
     * Workspace file bytes for the phone's cache. Any path a synced
     * conversation references is servable — resolveUploadPath refuses
     * anything that escapes the workspace root, and that refusal is the
     * entire access story: the tunnel is end-to-end encrypted to one pinned
     * device, so whoever can ask is whoever paired.
     */
    tunnel.onRpc(Rpc.fileStat, async (params) => {
      const rel = String(params.path ?? '')
      if (!resolveUploadPath(rel)) throw new Error(`invalid path: ${rel}`)
      const stat = await statUpload(rel)
      return { exists: stat !== null, sizeBytes: stat?.sizeBytes ?? 0 }
    })

    tunnel.onRpc(Rpc.fileRead, async (params) => {
      const rel = String(params.path ?? '')
      const abs = resolveUploadPath(rel)
      if (!abs) throw new Error(`invalid path: ${rel}`)
      const offset = clampCount(params.offset, 0)
      // The cap is the contract: one answer must stay under the relay's
      // record limit whatever the phone asks for.
      const length = Math.min(clampCount(params.length, CHUNK_SIZE), CHUNK_SIZE)
      const handle = await fs.open(abs, 'r')
      try {
        const stat = await handle.stat()
        const window = Math.max(0, Math.min(length, stat.size - offset))
        const buffer = Buffer.alloc(window)
        if (window > 0) await handle.read(buffer, 0, window, offset)
        return { data: buffer.toString('base64url'), sizeBytes: stat.size }
      } finally {
        await handle.close()
      }
    })

    /**
     * Chunked upload from the phone: begin stakes out a staging file (and a
     * conversation, when the message that will carry the file is the first),
     * chunks append strictly in order, commit adopts the staged bytes as a
     * normal conversation upload and answers with the metadata the message
     * should carry — the desktop picks the final name, so a collision renames
     * here exactly as it would for a file dropped on the composer.
     */
    tunnel.onRpc(Rpc.uploadBegin, async (params) => {
      const name = String(params.name ?? '').trim()
      if (!name) throw new Error('upload needs a file name')
      const expected = clampCount(params.sizeBytes, 0)
      if (expected <= 0 || expected > MAX_UPLOAD_BYTES) {
        throw new Error(`upload size out of range: ${expected}`)
      }
      let conversationId =
        typeof params.conversationId === 'string' && params.conversationId
          ? params.conversationId
          : null
      if (!conversationId) {
        const created = createConversation(null)
        created.messages = []
        await saveConversation(created)
        conversationId = created.id
      }

      const uploadId = toHex(new Uint8Array(randomBytes(16)))
      const stagingDir = path.join(workspaceRoot(), 'uploads', UPLOAD_STAGING_DIR)
      await fs.mkdir(stagingDir, { recursive: true })
      const stagedPath = path.join(stagingDir, uploadId)
      const handle = await fs.open(stagedPath, 'w')
      const upload: PendingUpload = {
        conversationId,
        name,
        mimeType: typeof params.mimeType === 'string' ? params.mimeType : null,
        expected,
        received: 0,
        stagedPath,
        handle,
        idleTimer: setTimeout(() => void this.abortUpload(uploadId, 'idle'), UPLOAD_IDLE_MS)
      }
      this.uploads.set(uploadId, upload)
      this.debug(`upload ${uploadId} begun — ${name}, ${expected} bytes, conv ${conversationId}`)
      return { uploadId, conversationId }
    })

    tunnel.onRpc(Rpc.uploadChunk, async (params) => {
      const uploadId = String(params.uploadId ?? '')
      const upload = this.uploads.get(uploadId)
      if (!upload) throw new Error('unknown upload')
      const offset = clampCount(params.offset, -1)
      const bytes = Buffer.from(String(params.data ?? ''), 'base64url')
      // Strict sequencing: the phone sends one chunk at a time, so anything
      // out of order means a lost or replayed frame — refuse rather than
      // stitch a corrupt file.
      if (offset !== upload.received || bytes.length === 0) {
        await this.abortUpload(uploadId, 'out-of-order chunk')
        throw new Error('upload chunk out of order')
      }
      if (upload.received + bytes.length > upload.expected) {
        await this.abortUpload(uploadId, 'overran declared size')
        throw new Error('upload larger than declared')
      }
      await upload.handle.write(bytes, 0, bytes.length, offset)
      upload.received += bytes.length
      upload.idleTimer.refresh()
      return { received: upload.received }
    })

    tunnel.onRpc(Rpc.uploadCommit, async (params) => {
      const uploadId = String(params.uploadId ?? '')
      const upload = this.uploads.get(uploadId)
      if (!upload) throw new Error('unknown upload')
      this.uploads.delete(uploadId)
      clearTimeout(upload.idleTimer)
      await upload.handle.close()
      if (upload.received !== upload.expected) {
        await fs.rm(upload.stagedPath, { force: true }).catch(() => undefined)
        throw new Error(`upload incomplete: ${upload.received} of ${upload.expected} bytes`)
      }
      const metadata = await saveUploadFromFile(
        upload.conversationId,
        upload.stagedPath,
        upload.name,
        upload.mimeType ?? undefined
      )
      this.debug(`upload ${uploadId} committed — ${metadata.filePath}`)
      return { ...metadata, conversationId: upload.conversationId }
    })
  }

  /**
   * The rest of a send after the RPC reply: transcribe a voice note, persist
   * the user message, build the LLM history, dispatch the runner. Failures
   * here reach the phone as a turn.status error push — the caller wired that.
   */
  private async continueSend(
    conversationId: string,
    text: string,
    attachments: MessageAttachment[],
    voicePrompt: boolean,
    voiceLangHint: string | undefined
  ): Promise<void> {
    let content = text
    let voiceLang = voiceLangHint

    if (voicePrompt && !content) {
      const audio = attachments.find((a) => a.type === 'audio')
      if (!audio) throw new Error('voice note without an audio attachment')
      try {
        // Same pipeline as a Telegram voice note: conversation-scoped so the
        // transcript files under speech/conv-…, ffmpeg ensured because a
        // direct tool call bypasses the agent loop's dependency resolution.
        await this.deps.agent.cerebellum.ensureSystemTool('ffmpeg')
        const result = await this.deps.agent.cerebellum.runWithConversation(conversationId, () =>
          this.deps.agent.cerebellum.executeTool('stt_transcribe', { filePath: audio.filePath })
        )
        if (!result.success) throw new Error(result.error ?? 'transcription failed')
        content = extractTranscript(result.output ?? '')
        if (!content) throw new Error('voice message transcribed to nothing')
        voiceLang = extractVoiceLanguage(result.output ?? '') || voiceLang
      } catch (error) {
        // The recording must survive its failed transcription: persist the
        // message (empty content, audio attached) so both transcripts keep
        // the voice note, then let the error reach the phone.
        await this.persistUserMessage(conversationId, '', attachments, voicePrompt, voiceLang)
        throw error
      }
    }

    const conversation = await loadConversation(conversationId)
    if (!conversation) throw new Error(`unknown conversation ${conversationId}`)

    const userMessage = await this.persistUserMessage(
      conversationId,
      content,
      attachments,
      voicePrompt,
      voiceLang
    )
    // The local copy feeds the history build below; the persist above already
    // merged it onto the freshest disk state.
    conversation.messages.push(userMessage)
    conversation.updatedAt = userMessage.timestamp

    // Same-conversation preemption, matching the Electron channel: a second
    // send into a streaming conversation replaces its turn rather than
    // running two against one transcript.
    this.turns.get(conversationId)?.controller.abort()

    const handle = this.deps.runner.send({
      history: this.buildHistory(conversation),
      conversationId,
      userMessageId: userMessage.id,
      projectId: conversation.projectId ?? null,
      makeSink: ({ turnId, conversationId: sinkConversationId }) =>
        this.createSink(turnId, sinkConversationId ?? conversationId)
    })
    this.turns.set(conversationId, { turnId: handle.turnId, controller: handle.controller })
    this.log(`turn ${handle.turnId} started from the phone in ${conversationId}`)
  }

  /**
   * Append the phone's user message to the conversation file. An append-RMW
   * against the freshest disk state, exactly like the Telegram channel: a
   * concurrent writer (summarizer, another surface) must never be clobbered
   * by a stale copy. A null disk means the conversation was deleted out from
   * under us — the write is skipped rather than resurrecting the file.
   */
  private async persistUserMessage(
    conversationId: string,
    content: string,
    attachments: MessageAttachment[],
    voicePrompt: boolean,
    voiceLang: string | undefined
  ): Promise<ConversationMessage> {
    const message: ConversationMessage = {
      id: mintMessageId(),
      role: 'user',
      content,
      timestamp: Date.now(),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(voicePrompt ? { voicePrompt: true } : {}),
      ...(voiceLang ? { voiceLang } : {})
    }
    await updateConversation(conversationId, (disk) => {
      if (!disk) return null
      disk.messages.push(message)
      disk.updatedAt = message.timestamp
      return disk
    })
    return message
  }

  /**
   * The LLM-bound history, built the way the Telegram channel builds it so a
   * turn from the phone sees exactly what a turn from anywhere else sees:
   * summarized prefix + replay window, assistant segments with their tool
   * calls and results, voice notes as `<voice_note>` transcripts (the audio
   * never reaches the model), attachments composed into the message content
   * and forwarded so images and PDFs become native blocks downstream.
   */
  private buildHistory(conversation: ConversationFile): ChatHistoryMessage[] {
    const window = replayWindow(conversation)
    return stubStaleToolResults(
      window.preamble.concat(
        window.messages.flatMap((m) => {
          if (m.role !== 'user') return assistantSegmentsToHistory(m)
          if (m.voicePrompt) {
            const langAttr = m.voiceLang ? ` lang="${m.voiceLang}"` : ''
            return [{ role: 'user' as const, content: `<voice_note${langAttr}>\n${m.content}` }]
          }
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
      ),
      conversation.id
    )
  }

  /**
   * The attachments a phone message may carry, reduced to the ones that are
   * real: a workspace-relative path that resolves inside the root and whose
   * bytes are already here (the phone uploads before it sends). Type and mime
   * are re-derived rather than trusted — the wire shape is data, not policy.
   */
  private async sanitizeAttachments(raw: unknown): Promise<MessageAttachment[]> {
    if (!Array.isArray(raw)) return []
    const out: MessageAttachment[] = []
    for (const item of raw.slice(0, 10)) {
      if (!item || typeof item !== 'object') continue
      const candidate = item as Record<string, unknown>
      const filePath = typeof candidate.filePath === 'string' ? candidate.filePath : ''
      if (!filePath || !resolveUploadPath(filePath)) continue
      if (!(await uploadExists(filePath))) {
        this.log(`attachment dropped — no bytes on disk for ${filePath}`)
        continue
      }
      const originalName =
        typeof candidate.originalName === 'string' && candidate.originalName
          ? candidate.originalName
          : (filePath.split('/').pop() ?? filePath)
      const declaredMime = typeof candidate.mimeType === 'string' ? candidate.mimeType : undefined
      const { type, mimeType } = classifyFile(originalName, declaredMime)
      const stat = await statUpload(filePath)
      const attachment: MessageAttachment = {
        type,
        filePath,
        originalName,
        mimeType,
        sizeBytes: stat?.sizeBytes ?? 0
      }
      for (const key of ['width', 'height', 'durationSeconds'] as const) {
        const value = candidate[key]
        if (typeof value === 'number' && Number.isFinite(value)) attachment[key] = value
      }
      out.push(attachment)
    }
    return out
  }

  /** Drop one pending upload and its staged bytes. */
  private async abortUpload(uploadId: string, reason: string): Promise<void> {
    const upload = this.uploads.get(uploadId)
    if (!upload) return
    this.uploads.delete(uploadId)
    clearTimeout(upload.idleTimer)
    await upload.handle.close().catch(() => undefined)
    await fs.rm(upload.stagedPath, { force: true }).catch(() => undefined)
    this.debug(`upload ${uploadId} aborted — ${reason}`)
  }

  private async abortAllUploads(): Promise<void> {
    await Promise.all([...this.uploads.keys()].map((id) => this.abortUpload(id, 'channel stopped')))
  }

  /**
   * Renders a turn onto the phone. Text deltas stream as they arrive so the
   * phone shows the assistant writing; anything else (tool calls, the finished
   * message) resolves to a fetch, because the phone already knows how to read
   * a stored conversation and that keeps one shape rather than two.
   *
   * The sink is also this channel's persister. The Electron channel leans on
   * its renderer to save the turn and Telegram saves inside its own sink —
   * nobody else writes a mobile turn to disk, so without the accumulator here
   * the phone's post-turn refetch would pull a transcript that stops before
   * the answer it just watched stream.
   */
  private createSink(turnId: string, conversationId: string): TurnSink {
    let seq = 0
    const acc: AssistantAccumulator = {
      assistantMessageId: mintMessageId(),
      assistantTimestamp: Date.now(),
      assistantContent: '',
      segments: [],
      approvals: new Map(),
      toolTimings: new Map(),
      stopReason: null
    }
    /** Append the accumulated assistant message; resolves once it is on disk. */
    const persistTurn = async (error?: string): Promise<void> => {
      const assistant = buildAssistantMessage(acc)
      if (!assistant) return
      if (error) assistant.error = error
      const endedAt = Date.now()
      await updateConversation(conversationId, (disk) => {
        if (!disk) return null
        disk.messages.push(assistant)
        disk.updatedAt = endedAt
        return disk
      }).catch(() => undefined)
    }
    return {
      channelId: 'mobile' as TurnSink['channelId'],
      turnId,
      conversationId,
      onSegment: (segment: Segment) => {
        // Subagent output never renders as the assistant's own voice — the
        // same rule every other channel's replay path follows. `worker` is
        // only present on the segment kinds that can carry it.
        if ('worker' in segment && segment.worker) return
        // Persist everything the phone's replay will want, whatever the live
        // verbose gating below decides to push right now. Workflow snapshots
        // upsert by id — a stream of them is one card, not a card per tick.
        if (segment.kind === 'workflow') upsertWorkflowSegment(acc.segments, segment)
        else acc.segments.push(segment)
        if (segment.kind === 'turn_end') acc.stopReason = segment.stopReason
        if (segment.kind === 'text') {
          acc.assistantContent += segment.delta
          this.pushMessageDelta(conversationId, segment.delta, seq++)
          return
        }
        // Tool calls and activity are relayed only when the feed is verbose,
        // matching Telegram/WhatsApp: off keeps the phone's feed to assistant
        // messages, file-bearing results and errors.
        if (!this.verbose && segment.kind !== 'tool_result') return
        this.pushMessageAppended(conversationId, { turnId, kind: segment.kind })
      },
      onTurnEvent: () => undefined,
      onApprovalRequest: async () => 'denied',
      onDone: () => {
        this.turns.delete(conversationId)
        this.log(`turn ${turnId} finished`)
        // Disk first, pushes second: the refresh push triggers the phone's
        // body refetch, and a refetch that outruns the save would hand back
        // a transcript without the reply — the exact hole this sink closes.
        void persistTurn().then(() => {
          this.pushTurnStatus(conversationId, 'done')
          void this.pushConversationRefresh(conversationId)
        })
      },
      onError: (error: string) => {
        this.turns.delete(conversationId)
        this.log(`turn ${turnId} failed — ${error}`)
        // A failed turn still persists what streamed before it broke —
        // matching every other channel, and keeping both transcripts honest
        // about how far the answer got.
        void persistTurn(error).then(() => {
          this.pushTurnStatus(conversationId, 'error', error)
          void this.pushConversationRefresh(conversationId)
        })
      },
      onCredentialBlocked: (type: string) => {
        this.pushTurnStatus(conversationId, 'error', `blocked: ${type}`)
      }
    }
  }

  /** Nudge the phone to re-read a conversation whose body just changed. */
  private async pushConversationRefresh(conversationId: string): Promise<void> {
    this.tunnel?.emit(Event.messageAppended, { conversationId })
  }

  // ------------------------------------------------------------------ push

  /** A conversation was created or changed — the phone's list updates live. */
  pushConversationUpserted(meta: ConversationMeta): void {
    this.debug(`push conversation ${meta.id} (${meta.messageCount} messages)`)
    this.tunnel?.emit(Event.conversationUpserted, meta)
  }

  pushConversationDeleted(id: string): void {
    this.debug(`push delete ${id}`)
    this.tunnel?.emit(Event.conversationDeleted, { id })
  }

  /** Streaming assistant output for whichever conversation the phone has open. */
  pushMessageDelta(conversationId: string, text: string, seq: number): void {
    this.tunnel?.emit(Event.messageDelta, { conversationId, text, seq })
  }

  /**
   * The assistant message so far, in full, rather than the piece just added.
   * `replace` tells the phone to show this instead of appending it — the
   * mirror other channels emit is a snapshot, and appending snapshots would
   * repeat the whole answer on screen once per tick.
   */
  pushMessageSnapshot(conversationId: string, text: string): void {
    this.tunnel?.emit(Event.messageDelta, { conversationId, text, replace: true })
  }

  pushMessageAppended(conversationId: string, message: unknown): void {
    this.tunnel?.emit(Event.messageAppended, { conversationId, message })
  }

  pushTurnStatus(conversationId: string, state: string, detail?: unknown): void {
    this.tunnel?.emit(Event.turnStatus, { conversationId, state, detail })
  }

  /** True when a phone is actually on the other end — lets callers skip the
   *  work of building a push nobody will receive. */
  get hasPeer(): boolean {
    return this.tunnel?.connected ?? false
  }

  pushTurnScored(conversationId: string, score: unknown): void {
    this.tunnel?.emit(Event.turnScored, { conversationId, score })
  }

  /** Any settings change — the phone refreshes the affected screen. */
  pushConfigChanged(section?: string): void {
    this.debug(`push config change (${section ?? 'all'})`)
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
            deviceName: this.pairing.deviceName,
            platform: this.pairing.platform ?? null,
            model: this.pairing.model ?? null,
            osVersion: this.pairing.osVersion ?? null,
            appVersion: this.pairing.appVersion ?? null
          }
        : null,
      tunnel: this.tunnelState,
      offer: this.offer,
      storage: storageBackend(),
      verbose: this.verbose,
      relayUrl: this.relayUrl,
      defaultRelayUrl: this.deps.relayUrl ?? DEFAULT_RELAY_URL
    }
  }

  private emitStatus(): void {
    this.deps.onStatus?.(this.getStatus())
  }

  get connected(): boolean {
    return this.tunnel?.connected ?? false
  }
}

/**
 * Canonical form for a relay endpoint a user typed or pasted. Accepts the
 * https:// page URL of a relay (the same host serves both) and bare hosts;
 * returns `wss://host[/path]` with no trailing slash. Null or empty means
 * "no override — use the default". Throws when the input cannot name a relay.
 */
export function normalizeRelayUrl(raw: string | null): string | null {
  if (raw === null) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Recognize an explicit scheme first, so `ftp://x` is rejected instead of
  // being swallowed as a host named "ftp" by the bare-host fallback below.
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)?.[1]?.toLowerCase() ?? null
  if (scheme !== null && !['ws', 'wss', 'http', 'https'].includes(scheme))
    throw new Error(`not a relay URL: ${raw}`)
  let candidate: string
  if (scheme === 'https') candidate = `wss://${trimmed.slice('https://'.length)}`
  else if (scheme === 'http') candidate = `ws://${trimmed.slice('http://'.length)}`
  else if (scheme === null) candidate = `wss://${trimmed}`
  else candidate = trimmed
  const parsed = new URL(candidate) // throws on garbage
  if ((parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') || !parsed.hostname)
    throw new Error(`not a relay URL: ${raw}`)
  // A scheme-less input must look like a host (a dot or a port) — otherwise a
  // pairing code pasted into the wrong field becomes wss://K7M9-2QXR.
  if (scheme === null && !parsed.hostname.includes('.') && !parsed.port)
    throw new Error(`not a relay URL: ${raw}`)
  // The tunnel appends `/t/<rid>` — a trailing slash would double up, while a
  // path prefix (a relay mounted under one) passes through untouched.
  const prefix = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.protocol}//${parsed.host}${prefix}`
}

/**
 * A reflection patch from the wire, reduced to the fields that are real: an
 * integer hour 0-23, an integer quiet window 1-48 h, boolean scoring flags.
 * Malformed fields are dropped rather than clamped — clamping would persist a
 * value the user never chose, while dropping costs that field alone and the
 * authoritative answer corrects the screen that sent it.
 */
export function sanitizeReflectionPatch(params: unknown): ReflectionWirePatch {
  const raw = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>
  const patch: ReflectionWirePatch = {}
  if (
    typeof raw.hour === 'number' &&
    Number.isInteger(raw.hour) &&
    raw.hour >= 0 &&
    raw.hour <= 23
  ) {
    patch.hour = raw.hour
  }
  if (
    typeof raw.quietHours === 'number' &&
    Number.isInteger(raw.quietHours) &&
    raw.quietHours >= 1 &&
    raw.quietHours <= 48
  ) {
    patch.quietHours = raw.quietHours
  }
  if (raw.scoring && typeof raw.scoring === 'object') {
    const flags: NonNullable<ReflectionWirePatch['scoring']> = {}
    for (const surface of ['inapp', 'telegram', 'whatsapp'] as const) {
      const value = (raw.scoring as Record<string, unknown>)[surface]
      if (typeof value === 'boolean') flags[surface] = value
    }
    if (Object.keys(flags).length > 0) patch.scoring = flags
  }
  return patch
}

/** A wire number as a byte count: a non-negative safe integer, else the
 *  fallback. Offsets and lengths come from the peer and index into files —
 *  NaN, negatives and floats must never reach an fs call. */
function clampCount(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fallback
  return value
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
