import type { TurnSink } from '@main/channels/channel'
import {
  getConversationIdForChat,
  setConversationIdForChat
} from '@main/channels/telegram/conversations'
import {
  bidiMark,
  escapeHtml,
  markdownToPlain,
  markdownToTelegramHtml
} from '@main/channels/telegram/format'
import {
  flushMessageIds,
  loadMessageIds,
  recordMessageId,
  takeMessageIdsForChat
} from '@main/channels/telegram/messages'
import { buildTelegramCapability, TELEGRAM_CAPABILITY_NAME } from '@main/channels/telegram/tools'
import type { TurnRunner } from '@main/channels/turn-runner'
import {
  createConversation,
  deleteConversation,
  generateTitle,
  listConversations,
  loadConversation,
  saveConversation,
  type ConversationFile,
  type ConversationMessage,
  type ConversationMeta,
  type MessageAttachment
} from '@main/conversations'
import type { Agent } from '@main/runtime/agent'
import type { ApprovalDecision, ApprovalRequest } from '@main/runtime/amygdala'
import type { Segment, SegmentTurnEndReason } from '@main/runtime/broca'
import type { CorpusEvents } from '@main/runtime/corpus'
import type { LocalProvider } from '@main/runtime/providers/local'
import { composeAttachmentContext } from '@main/uploads/compose-attachments'
import { saveUploadFromBuffer } from '@main/uploads/uploads'
import {
  getTelegramConfig,
  setLocalOnly as persistLocalOnly,
  workspaceRoot
} from '@main/workspace/workspace'
import type {
  ChatHistoryMessage,
  PersistedApproval,
  PersistedToolTiming,
  TelegramConfig,
  TelegramErrorKind,
  TelegramTestResult
} from '@preload/index'
import { Bot, GrammyError, HttpError, InputFile, type Context as BotContext } from 'grammy'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Maximum bytes per Telegram message. The spec is 4096; we cap one
 * char below to leave room for the trailing newline our split logic
 * adds when it has to chunk.
 */
const MESSAGE_LIMIT = 4096

/**
 * Approval / cancel / new / status are slash commands only —
 * deterministic so an off-the-cuff "yes" or "stop" in normal
 * conversation never accidentally resolves an approval or cancels a
 * task. /start is the Telegram convention for "begin a session" so
 * it's an alias for /new.
 */
const APPROVE_COMMAND = '/approve'
const DENY_COMMAND = '/deny'
const STATUS_COMMAND = '/status'
const CURRENT_COMMAND = '/current'
const RESUME_COMMAND = '/resume'
const DELETE_COMMAND = '/delete'
const CLEAR_COMMAND = '/clear'
const LOCAL_COMMAND = '/local'
const CLOUD_COMMAND = '/cloud'
const STOP_COMMANDS = new Set(['/stop', '/cancel'])
const NEW_COMMANDS = new Set(['/new', '/start'])

const COMMANDS_HELP_HTML = [
  '<b>Commands:</b>',
  '/resume — continue a previous chat',
  '/delete — delete a saved conversation',
  '/clear — clear messages from this chat',
  '/ — show more commands'
].join('\n')

/**
 * Keycap-emoji digits for visually numbering picker items. /resume
 * and /delete only show up to 10 conversations at a time, so this
 * array covers the full range.
 */
const KEYCAP_NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'] as const

const SELECTION_LIMIT = KEYCAP_NUMBERS.length

/**
 * Static reply used when the local model is unavailable or fails.
 * Phrased to match what the local-model fallback would generate so
 * users don't get a noticeably different experience.
 */
const FALLBACK_BUSY_REPLY = "Hold on — I'm working on something. I'll get back to you in a moment."

/**
 * System prompt for the local-model decline. Kept short so a
 * lightweight local model can produce a coherent response in <2s.
 * Strict instruction not to attempt the request — we want the user to
 * resend after the active turn finishes.
 */
const BUSY_SYSTEM_PROMPT =
  "You are a friendly assistant currently working on a previous task for the user. The user has just sent a NEW message but you cannot address it yet — another task is still running. Reply briefly (1-2 short sentences) acknowledging their new message and politely asking them to wait. Do NOT attempt to answer their question, perform any action, or speculate about an answer. Just say you're busy and will get to it. Be warm and natural."

/**
 * Cap how long we wait for the local model to produce the decline.
 * If the model is slow (cold start, big quant), bail and use the
 * fallback so the user isn't left hanging.
 */
const BUSY_REPLY_TIMEOUT_MS = 8000

/**
 * Telegram bot API limits file downloads to 20 MB. Anything larger
 * fails at getFile() with a 400. We surface a friendly message and
 * leave the message untouched so the user can resend a smaller copy.
 */
const TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024

/**
 * Telegram clears the "typing…" indicator ~5s after the last
 * sendChatAction. Re-fire every 4s while a turn is live so the
 * indicator stays visible the whole time agent.respond is working,
 * not just for the first burst.
 */
const TYPING_HEARTBEAT_MS = 4000

type ChannelStatus = 'stopped' | 'starting' | 'running' | 'error'

export type TelegramChannelStatus = {
  status: ChannelStatus
  errorKind: TelegramErrorKind | null
  error: string | null
}

/**
 * Per-chat state held while a turn is in flight. Lives in memory only;
 * the conversation file on disk is the source of truth for history.
 */
/**
 * In-flight conversation picker raised by /resume or /delete. The
 * channel renders a numbered list of conversation ids and stores
 * them here; the next number-only reply selects one.
 */
type PendingSelection = {
  command: 'resume' | 'delete'
  conversationIds: string[]
}

type ActiveTurn = {
  chatId: number
  conversation: ConversationFile
  /**
   * Pending text we haven't sent to Telegram yet — drained and
   * cleared by flushBufferedText on each tool call and at turn_end.
   * Keeps the message ordering tight: prose, tool, prose, tool.
   */
  textBuffer: string
  /**
   * Full prose the model produced this turn — accumulated alongside
   * textBuffer but NEVER cleared. Used to derive the assistant
   * message's `content` field at save time.
   */
  assistantContent: string
  /**
   * Every segment emitted during the turn, in order. Persisted
   * verbatim on the assistant message so the in-app history can
   * replay the full sequence (text, tool calls, tool results,
   * active_model chips, turn_end) — same fidelity the Electron
   * channel saves.
   */
  segments: Segment[]
  /**
   * All approvals raised this turn, keyed by approvalId. Filled
   * in when amygdala fires the bridge; the decision is back-filled
   * once the user sends /approve or /deny. Pending approvals at
   * turn end are recorded as denied (they never got a reply).
   */
  approvals: Map<string, PersistedApproval>
  /**
   * Per-tool-call timing. Start recorded on the tool_call segment,
   * end recorded on the matching tool_result. Used by the in-app
   * tool card to show "ran for Xms".
   */
  toolTimings: Map<string, PersistedToolTiming>
  /** Captured from the turn_end segment so the renderer can show the right footer chip. */
  stopReason: SegmentTurnEndReason | null
  taskId: string | null
  controller: AbortController
  pendingApprovalId: string | null
  /** Resolves the approval Promise once the user replies. */
  pendingApprovalResolve: ((decision: ApprovalDecision) => void) | null
  /** Cleared once the assistant message has been pushed to disk. */
  done: Promise<void> | null
  /** setInterval handle for the typing-indicator heartbeat. */
  typingTimer: NodeJS.Timeout | null
  /**
   * Maps tool_call id → tool name so a later tool_result segment
   * (which carries only the id) can render under the same heading
   * the call did. Wiped at end-of-turn with the rest of the
   * active record.
   */
  toolCallNames: Map<string, string>
  /**
   * Each agent iteration emits an active_model chip. We defer sending
   * it until the iteration commits real content (text or a tool call),
   * so iterations that produce nothing — e.g. the silent wrap-up turn
   * after a voice_respond — don't leave a stray chip in the chat.
   * Cleared on flush (chip sent) or at turn_end (chip dropped).
   */
  pendingActiveModel: string | null
  /**
   * Promise chain that serializes renderSegment calls. Each call
   * chains onto the previous one so concurrent fire-and-forget
   * invocations execute in arrival order — prevents text segments
   * from interleaving when an earlier segment yields at an await.
   */
  renderChain: Promise<void>
}

/**
 * The Telegram channel. Mirrors what ElectronChannel does, but for the
 * Telegram surface:
 *
 *  - bot lifecycle (start / stop / restart on config change),
 *  - long-poll updates via grammY,
 *  - chat-id → conversation-id mapping (resumes prior conversations),
 *  - per-chat active turn (cancel / approval / stream buffer),
 *  - segment-to-message rendering (text accumulated, tool calls and
 *    results emitted as their own messages, final assistant text sent
 *    at onDone in 4096-byte chunks),
 *  - approval flow via /approve and /deny slash commands,
 *  - cancellation via /stop, fresh-start via /new.
 *
 * The channel is intentionally a no-op when telegram.enabled is false:
 * no bot instance, no listeners, nothing imported from grammY at
 * runtime beyond the type definitions. start()/stop() are idempotent
 * so the settings panel can flip them freely.
 */
export class TelegramChannel {
  private bot: Bot | null = null
  /**
   * The currently-running bot's token. Stored so media handlers can
   * build the download URL — grammY exposes file paths but not the
   * full https://api.telegram.org/file/bot<TOKEN>/<path> URL.
   */
  private botToken: string | null = null
  private allowedUserIds = new Set<number>()
  private status: ChannelStatus = 'stopped'
  private statusError: string | null = null
  private statusErrorKind: TelegramErrorKind | null = null
  private readonly activeByChat = new Map<number, ActiveTurn>()
  /**
   * Tracks pickers in progress per chat. /resume and /delete render
   * a numbered list and store the corresponding conversation ids
   * here; the next number-only reply from that chat resolves the
   * picker. Any other reply implicitly cancels it.
   */
  private readonly pendingSelections = new Map<number, PendingSelection>()
  /**
   * Per-chat typing heartbeats covering pre-turn processing — the
   * window between a Telegram update arriving and dispatchTurn's own
   * heartbeat taking over. Covers downloads, transcription, validation,
   * conversation lookup. Handed off in onTurnStarted; otherwise cleared
   * by the handler's finally so an early return never leaks the bubble.
   */
  private readonly preTypingByChat = new Map<number, NodeJS.Timeout>()

  constructor(
    private readonly agent: Agent,
    private readonly runner: TurnRunner,
    /**
     * Used for the "I'm busy" decline replies when a new message
     * arrives while another Telegram turn is in flight. Going through
     * the full agent.respond pipeline would either queue the decline
     * (defeats the point) or interrupt the active turn (worse). The
     * local provider can answer instantly without touching shared
     * agent state.
     */
    private readonly localProvider: LocalProvider
  ) {}

  /**
   * Start the bot with the given config. Idempotent — already-running
   * with the same token is a no-op; same-token "start" while starting
   * just waits. Returns the final state on completion.
   */
  async start(config: TelegramConfig): Promise<TelegramChannelStatus> {
    if (!config.enabled) {
      return this.getStatus()
    }
    // Trim defensively. Tokens copied from BotFather sometimes carry
    // trailing whitespace or zero-width chars that grammY passes
    // straight through to the URL, producing a 404 from getMe.
    const trimmedToken = config.botToken.trim()
    if (!trimmedToken) {
      this.setStatusError('missing_token', null)
      return this.getStatus()
    }
    if (!isPlausibleBotToken(trimmedToken)) {
      this.setStatusError('token_format', null)
      return this.getStatus()
    }
    if (this.status === 'running' || this.status === 'starting') {
      return this.getStatus()
    }

    this.status = 'starting'
    this.statusError = null
    this.statusErrorKind = null
    this.allowedUserIds = new Set(config.allowedUserIds)

    const bot = new Bot(trimmedToken)
    bot.on('message:text', (ctx) => void this.handleTextMessage(ctx))
    // Voice messages get their own path: Telegram's press-and-hold
    // mic recording is handled as if the user typed the transcript.
    // Other media (photos, video, audio files, documents) keep the
    // existing attach-and-dispatch flow.
    bot.on('message:voice', (ctx) => void this.handleVoiceMessage(ctx))
    bot.on(
      ['message:photo', 'message:video', 'message:audio', 'message:document'],
      (ctx) => void this.handleMediaMessage(ctx)
    )
    bot.catch((err) => {
      const kind = classifyBotError(err.error)
      const message = err.error instanceof Error ? err.error.message : String(err.error)
      this.agent.corpus.emit('telegram.error', { kind, message })
    })

    try {
      // bot.init() validates the token by fetching the bot's own
      // identity. A bad token throws here; we surface the failure
      // without ever starting the long-poll loop.
      await bot.init()
      // Publish the slash command menu so Telegram clients show the
      // available commands in the chat's command picker. Non-fatal if
      // the call fails (older bot servers, transient network) — the
      // commands still work as plain text, just without the
      // discoverability hint. /approve and /deny are listed too so
      // the user has somewhere to look when a confirmation prompt
      // shows up; the LLM can still volunteer them on its own when a
      // user seems lost.
      await bot.api
        .setMyCommands([
          { command: 'new', description: 'Start a fresh conversation' },
          { command: 'current', description: 'Current conversation' },
          { command: 'resume', description: 'Pick a conversation to resume' },
          { command: 'delete', description: 'Pick a conversation to delete' },
          { command: 'clear', description: 'Clear all messages' },
          { command: 'stop', description: 'Cancel the current task' },
          { command: 'approve', description: 'Approve a pending action' },
          { command: 'deny', description: 'Deny a pending action' },
          { command: 'status', description: 'Wolffish current status' },
          { command: 'local', description: 'Switch to local model' },
          { command: 'cloud', description: 'Switch to cloud model' }
        ])
        .catch(() => undefined)
    } catch (err) {
      this.bot = null
      const corpusKind = classifyBotError(err)
      const rawMessage = err instanceof Error ? err.message : String(err)
      // Map the corpus-event taxonomy onto the user-facing kind set the
      // panel renders. The corpus uses `token` for any auth-shaped
      // failure (401/403/404) and `send` for everything else; the panel
      // wants to distinguish "invalid token" from a generic unknown so
      // it can render a localized hint.
      const userKind: TelegramErrorKind =
        corpusKind === 'token'
          ? 'invalid_token'
          : corpusKind === 'rate_limit'
            ? 'rate_limit'
            : corpusKind === 'network'
              ? 'network'
              : 'unknown'
      this.setStatusError(userKind, rawMessage)
      this.agent.corpus.emit('telegram.error', { kind: corpusKind, message: rawMessage })
      return this.getStatus()
    }

    this.bot = bot
    this.botToken = trimmedToken

    // Hydrate the persisted message-id tracker so /clear can delete
    // messages from previous sessions. Best-effort — a missing or
    // corrupt file just leaves the tracker empty.
    await loadMessageIds()

    // Register the channel's tool surface with the cerebellum so the
    // LLM can use telegram_send proactively — e.g. notifying the user
    // when a long-running task finishes. Re-registration is idempotent;
    // calling start() after a config change just rewires references.
    const { capability, plugin } = buildTelegramCapability({
      getBot: () => this.bot,
      getAllowedUserIds: () => this.allowedUserIds,
      trackOutgoing: (cid, mid) => this.trackMessageId(cid, mid)
    })
    this.agent.cerebellum.registerInProcessCapability(capability, plugin)

    // Long-poll loop. drop_pending_updates so a freshly enabled bot
    // doesn't replay weeks of old messages on first launch.
    void bot.start({ drop_pending_updates: true }).catch((err) => {
      const corpusKind = classifyBotError(err)
      const rawMessage = err instanceof Error ? err.message : String(err)
      const userKind: TelegramErrorKind =
        corpusKind === 'token'
          ? 'invalid_token'
          : corpusKind === 'rate_limit'
            ? 'rate_limit'
            : corpusKind === 'network'
              ? 'network'
              : 'unknown'
      this.setStatusError(userKind, rawMessage)
      this.agent.corpus.emit('telegram.error', { kind: corpusKind, message: rawMessage })
    })

    this.status = 'running'
    this.agent.corpus.emit('telegram.started', {
      allowedUserCount: this.allowedUserIds.size
    })
    return this.getStatus()
  }

  /** Stop the bot. Idempotent. */
  async stop(reason?: string): Promise<void> {
    if (!this.bot) {
      this.status = 'stopped'
      return
    }
    try {
      await this.bot.stop()
    } catch {
      // best-effort; if the stop call itself errors we still want the
      // local state to reflect that the bot is no longer accepting
      // updates. Anything stuck inside grammY is the SDK's problem.
    }
    this.bot = null
    this.botToken = null
    this.activeByChat.clear()
    this.pendingSelections.clear()
    // Tear down any in-flight pre-turn typing heartbeats — if a
    // handler was mid-download when stop() came in, its finally won't
    // run before the process exits.
    for (const timer of this.preTypingByChat.values()) clearInterval(timer)
    this.preTypingByChat.clear()
    // Flush any pending tracker writes to disk. Don't clear the
    // in-memory cache — message ids are persistent across bot
    // stop/start so /clear can sweep prior sessions.
    await flushMessageIds()
    this.status = 'stopped'
    this.statusError = null
    this.statusErrorKind = null
    // Take the channel's tools out of the LLM's surface so it doesn't
    // see capabilities it can no longer execute. Idempotent.
    this.agent.cerebellum.unregisterInProcessCapability(TELEGRAM_CAPABILITY_NAME)
    this.agent.corpus.emit('telegram.stopped', reason ? { reason } : {})
  }

  async restart(config: TelegramConfig): Promise<TelegramChannelStatus> {
    await this.stop('restart')
    return this.start(config)
  }

  /**
   * Send a one-off test message without taking over the long-poll
   * loop. Used by the settings panel to verify a token+chat-id pair
   * before the user enables the channel for real.
   *
   * The sent message is recorded in the persistent tracker so a later
   * /clear sweeps it alongside real-conversation messages — otherwise
   * test messages pile up in the user's chat with no way to remove them.
   */
  async sendTestMessage(token: string, userId: number): Promise<TelegramTestResult> {
    const trimmed = (token ?? '').trim()
    if (!trimmed) return { ok: false, kind: 'missing_token' }
    if (!Number.isFinite(userId)) return { ok: false, kind: 'invalid_user_id' }
    if (!isPlausibleBotToken(trimmed)) return { ok: false, kind: 'token_format' }
    const tempBot = new Bot(trimmed)
    try {
      await tempBot.init()
      const sent = await tempBot.api.sendMessage(userId, 'Wolffish Telegram channel is working ✅')
      // Hydrate the tracker if start() hasn't run yet — sendTestMessage
      // commonly fires before the channel is enabled. Then record and
      // flush synchronously so the id survives an app quit before the
      // user ever starts the bot.
      await loadMessageIds()
      this.trackMessageId(userId, sent.message_id)
      await flushMessageIds()
      return { ok: true }
    } catch (err) {
      const corpusKind = classifyBotError(err)
      const raw = err instanceof Error ? err.message : String(err)
      const kind: TelegramErrorKind =
        corpusKind === 'token'
          ? 'invalid_token'
          : corpusKind === 'rate_limit'
            ? 'rate_limit'
            : corpusKind === 'network'
              ? 'network'
              : 'unknown'
      return { ok: false, kind, message: raw }
    }
  }

  getStatus(): TelegramChannelStatus {
    return {
      status: this.status,
      errorKind: this.statusErrorKind,
      error: this.statusError
    }
  }

  /**
   * Centralizes the "I'm in an error state" transition. Sets the
   * channel status to 'error', records both the discriminated kind
   * (so the renderer can translate) and the raw message (used as a
   * fallback when the kind is `unknown`).
   */
  private setStatusError(kind: TelegramErrorKind, message: string | null): void {
    this.status = 'error'
    this.statusErrorKind = kind
    this.statusError = message
  }

  hasActiveTurn(): boolean {
    return this.activeByChat.size > 0
  }

  /**
   * Start a typing heartbeat for the pre-turn window. Idempotent per
   * chat — repeat calls keep the existing timer. A single
   * sendChatAction expires after ~5s in Telegram, so anything that
   * could outlast that (downloads, transcription, validation, conv
   * lookup) needs the periodic re-fire to keep the bubble lit. The
   * matching stopPreTyping must run on every exit path, including
   * errors and busy-replies, or the bubble persists past the work.
   */
  private startPreTyping(chatId: number, ctx: BotContext): void {
    if (this.preTypingByChat.has(chatId)) return
    void ctx.api.sendChatAction(chatId, 'typing').catch(() => undefined)
    const timer = setInterval(() => {
      void ctx.api.sendChatAction(chatId, 'typing').catch(() => undefined)
    }, TYPING_HEARTBEAT_MS)
    timer.unref?.()
    this.preTypingByChat.set(chatId, timer)
  }

  private stopPreTyping(chatId: number): void {
    const timer = this.preTypingByChat.get(chatId)
    if (!timer) return
    clearInterval(timer)
    this.preTypingByChat.delete(chatId)
  }

  abort(): void {
    for (const turn of this.activeByChat.values()) {
      turn.controller.abort()
    }
    this.activeByChat.clear()
  }

  private async handleTextMessage(ctx: BotContext): Promise<void> {
    const userId = ctx.from?.id
    const chatId = ctx.chat?.id
    const text = ctx.message?.text
    if (!userId || !chatId || !text) return

    // Silent ignore for non-allowed users. No reply, no acknowledgment,
    // nothing the attacker can use to fingerprint the bot.
    if (!this.allowedUserIds.has(userId)) return

    // Track the incoming id so /clear can delete it later.
    if (ctx.message?.message_id) {
      this.trackMessageId(chatId, ctx.message.message_id)
    }

    const trimmed = text.trim()
    const lower = trimmed.toLowerCase()
    const command = parseSlashCommand(lower)

    const active = this.activeByChat.get(chatId)

    // /status — read-only introspection. Doesn't touch the agent
    // pipeline, so it works whether or not a turn is running. Useful
    // for a worried user who wants to know "is the bot stuck?" while
    // a long task is mid-flight.
    if (command === STATUS_COMMAND) {
      await this.handleStatusCommand(chatId)
      return
    }

    // /current — read-only too. Reports which conversation this
    // chat is currently bound to, in the same one-row layout the
    // /resume picker uses for each item.
    if (command === CURRENT_COMMAND) {
      await this.handleCurrentCommand(chatId)
      return
    }

    // /local and /cloud — flip the same llm.localOnly setting the
    // chat input's mode switch toggles. Busy-blocked for the same
    // reason the renderer disables the toggle mid-stream: switching
    // mid-turn would leave the in-flight stream running on the old
    // provider while the user thinks the next message is from the new
    // one. Caller can /stop first if they want to switch immediately.
    if (command === LOCAL_COMMAND || command === CLOUD_COMMAND) {
      if (this.activeByChat.size > 0) {
        await this.sendBusyReply(chatId, trimmed)
        return
      }
      await this.handleModeSwitchCommand(chatId, command === LOCAL_COMMAND)
      return
    }

    // /clear — wipe the visible chat in Telegram. Touches nothing
    // Wolffish-side: the conversation file, mapping, and history
    // all stay intact. Busy-blocked because deleting messages
    // mid-turn while the agent is still sending creates a race
    // (deletes happen, agent sends new messages, those orphans
    // pile up). Caller can /stop first if they want to clear
    // mid-task.
    if (command === CLEAR_COMMAND) {
      if (this.activeByChat.size > 0) {
        await this.sendBusyReply(chatId, trimmed)
        return
      }
      await this.handleClearCommand(chatId, ctx.message?.message_id ?? 0)
      return
    }

    // /stop — only meaningful while a turn is running, and only resolves
    // the turn for the chat that issued it. Comes before the busy-check
    // below so a user trying to halt a stuck turn isn't told "I'm busy".
    if (command && STOP_COMMANDS.has(command)) {
      if (!active) {
        await this.safeSend(chatId, 'Nothing to stop.')
        return
      }
      active.controller.abort()
      if (active.taskId) {
        await this.agent.motor.stopTask(active.taskId).catch(() => undefined)
      }
      await this.safeSend(chatId, '⏹ Stopping…')
      const deadline = Date.now() + 10_000
      while (this.activeByChat.has(chatId) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100))
      }
      if (this.activeByChat.has(chatId)) {
        await this.safeSend(chatId, '⏹ Attempted to stop, but the task may still be winding down.')
      } else {
        await this.safeSend(chatId, '⏹ Stopped.')
      }
      return
    }

    // /approve and /deny — only meaningful when there's a pending
    // approval for this chat. Determinism is the point: a casual "yes"
    // in conversation should never resolve an approval, only the
    // explicit slash command does.
    if (active && active.pendingApprovalId && active.pendingApprovalResolve) {
      if (command === APPROVE_COMMAND || command === DENY_COMMAND) {
        const decision: ApprovalDecision = command === APPROVE_COMMAND ? 'approved' : 'denied'
        const approvalId = active.pendingApprovalId
        const resolve = active.pendingApprovalResolve
        active.pendingApprovalId = null
        active.pendingApprovalResolve = null
        // Back-fill the decision on the persisted record so the
        // saved conversation reflects what the user chose.
        const stored = active.approvals.get(approvalId)
        if (stored) stored.decision = decision
        resolve(decision)
        await this.safeSend(chatId, decision === 'approved' ? '✅ Approved.' : '❌ Denied.')
        return
      }
      // Anything else falls through. The approval stays pending; on
      // turn cleanup it resolves denied so the agent doesn't hang.
      // Falling through means the busy-check below will catch the
      // message and decline politely.
    }

    // /new, /resume, /delete all require a clean slate — they touch
    // the chat-id → conversation-id mapping and would race a turn
    // that's actively reading from it. Decline if anything is in
    // flight; the user has to /stop or wait first.
    if (command && NEW_COMMANDS.has(command)) {
      if (this.activeByChat.size > 0) {
        await this.sendBusyReply(chatId, trimmed)
        return
      }
      await this.handleNewCommand(chatId)
      return
    }
    if (command === RESUME_COMMAND) {
      if (this.activeByChat.size > 0) {
        await this.sendBusyReply(chatId, trimmed)
        return
      }
      await this.renderConversationPicker(chatId, 'resume')
      return
    }
    if (command === DELETE_COMMAND) {
      if (this.activeByChat.size > 0) {
        await this.sendBusyReply(chatId, trimmed)
        return
      }
      await this.renderConversationPicker(chatId, 'delete')
      return
    }

    // Number-only reply for an outstanding /resume or /delete picker.
    // We check here — after the slash-command handlers but before
    // the busy/dispatch path — so a user typing "1" right after
    // the picker selects a row instead of starting a turn. Anything
    // that isn't a valid number cancels the picker silently and
    // falls through to normal handling.
    const pending = this.pendingSelections.get(chatId)
    if (pending) {
      const num = parseSelectionNumber(trimmed)
      if (num !== null && num >= 1 && num <= pending.conversationIds.length) {
        const targetId = pending.conversationIds[num - 1]
        this.pendingSelections.delete(chatId)
        if (pending.command === 'resume') {
          await this.handleResumeSelection(chatId, targetId)
        } else {
          await this.handleDeleteSelection(chatId, targetId)
        }
        return
      }
      // Not a recognized selection — drop the picker and let the
      // message fall through to the normal flow.
      this.pendingSelections.delete(chatId)
    }

    // Only one Telegram conversation processes at a time. If anything
    // is in flight (this chat or another allowed user's chat), the
    // local model produces a polite "I'm busy" reply. Active turn
    // keeps running; new message is dropped, not queued — the user
    // resends once the bot is free.
    if (this.activeByChat.size > 0) {
      await this.sendBusyReply(chatId, trimmed)
      return
    }

    // Free — dispatch as a new turn.
    await this.dispatchTurn(chatId, userId, trimmed, [], ctx)
  }

  /**
   * Handle the /status slash command. Calls insula.reflect() — same
   * report the introspect capability produces — and ships it as a
   * (potentially multi-message) reply. Long reports get chunked at
   * 4096 bytes by safeSend's caller; we pre-split here so the chunks
   * land in the right order even if a later send queues behind another.
   *
   * Read-only: does not abort or queue against any active turn. The
   * report includes uptime, active provider/model, capabilities,
   * RAM/disk, performance stats, and recent topics — exactly what an
   * Electron user gets from the introspect plugin.
   */
  private async handleStatusCommand(chatId: number): Promise<void> {
    let report: string
    try {
      report = await this.agent.insula.reflect()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.safeSend(chatId, `⚠️ Couldn't generate status: ${message}`)
      return
    }
    const trimmed = report.trim()
    if (trimmed.length === 0) {
      await this.safeSend(chatId, 'No status data available yet.')
      return
    }
    for (const chunk of splitForTelegram(trimmed)) {
      await this.safeSend(chatId, chunk)
    }
  }

  /**
   * Handle the /current slash command. Reports which conversation
   * this chat is currently bound to, formatted the same way each
   * row in the /resume picker is — title, relative time, message
   * count. Read-only: never creates a conversation, never changes
   * state, works regardless of busy state.
   */
  private async handleCurrentCommand(chatId: number): Promise<void> {
    const currentId = await getConversationIdForChat(chatId)
    if (!currentId) {
      await this.safeSend(chatId, 'No active conversation. Send any message to start one.')
      return
    }
    const conv = await loadConversation(currentId)
    if (!conv) {
      await this.safeSend(chatId, 'No active conversation. Send any message to start one.')
      return
    }
    const title = escapeHtml(conv.title || 'Untitled')
    const when = formatRelativeTime(conv.updatedAt)
    const count = conv.messages.length === 1 ? '1 message' : `${conv.messages.length} messages`
    await this.sendHtml(chatId, `<b>${title}</b>\n${when}\n${count}`)
  }

  /**
   * Handle the /new (or /start) slash command. Caller has already
   * verified no turn is running. Rotates this chat's mapping to a
   * brand-new conversation file; the old conversation stays on disk
   * under its original id, it just stops being the resume target for
   * this chat.
   */
  private async handleNewCommand(chatId: number): Promise<void> {
    this.pendingSelections.delete(chatId)
    const fresh = createConversation(null)
    fresh.channel = 'telegram'
    await saveConversation(fresh)
    await setConversationIdForChat(chatId, fresh.id)

    await this.sendHtml(chatId, `✨ New conversation started.\n\n${COMMANDS_HELP_HTML}`)
  }

  /**
   * Record a Telegram message id so /clear can later delete it.
   * Delegates to the persistent module — IDs survive app restarts
   * so a week of accumulated messages can be cleared even after
   * many launches.
   */
  private trackMessageId(chatId: number, messageId: number): void {
    recordMessageId(chatId, messageId)
  }

  /**
   * Handle /clear — delete the messages we've sent or received in
   * this chat from the Telegram client. Pure UI cleanup; the
   * conversation file, chat-id mapping, episodes, basalganglia
   * feedback, and every other piece of Wolffish state are left
   * untouched. The user can /resume the same conversation right
   * after and pick up where they left off.
   *
   * Uses Telegram's batched `deleteMessages` (plural) — up to 100
   * ids per request, so a typical clear lands in one round trip
   * instead of N. Designed for private bot chats; group-chat 48h
   * limits aren't a concern here. Per-batch errors are swallowed
   * so one bad id doesn't abort the sweep — the rest still go.
   */
  private async handleClearCommand(chatId: number, clearMessageId: number): Promise<void> {
    if (!this.bot) return
    recordMessageId(chatId, clearMessageId)
    const ids = takeMessageIdsForChat(chatId)
    if (ids.length === 0) return
    const BATCH = 100
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH)
      await this.bot.api.deleteMessages(chatId, chunk).catch(() => undefined)
    }
  }

  /**
   * Handle /local and /cloud — flip llm.localOnly via the same code
   * path the chat input's mode switch uses: persist the config, then
   * push the new value into the live thalamus so the next turn's
   * cascade picks it up. The IPC handler in main does the same two
   * steps; we mirror them here so a Telegram-driven switch and an
   * Electron-driven switch leave the runtime in identical state.
   */
  private async handleModeSwitchCommand(chatId: number, localOnly: boolean): Promise<void> {
    await persistLocalOnly(localOnly)
    this.agent.thalamus.setLocalOnly(localOnly)
    await this.safeSend(
      chatId,
      localOnly ? '🖥 Switched to local model.' : '☁️ Switched to cloud model.'
    )
  }

  /**
   * Render the numbered picker that drives /resume and /delete. Lists
   * up to 10 most-recent Telegram-channel conversations (Electron
   * conversations are excluded — they live in the in-app history and
   * are read-only from Telegram). Stores the resolved conversation
   * ids in pendingSelections so the next number reply selects one.
   * Caller has already verified no turn is running.
   */
  private async renderConversationPicker(
    chatId: number,
    command: 'resume' | 'delete'
  ): Promise<void> {
    const all = await listConversations()
    const telegram = all.filter((c) => c.channel === 'telegram').slice(0, SELECTION_LIMIT)

    if (telegram.length === 0) {
      this.pendingSelections.delete(chatId)
      await this.safeSend(chatId, 'No saved conversations yet.')
      return
    }

    const headerHtml =
      command === 'resume'
        ? '<b>Resume a conversation</b> — reply with the number:'
        : '<b>Delete a conversation</b> — reply with the number:'

    const itemsHtml = telegram.map((conv, idx) => formatPickerItem(conv, idx)).join('\n\n')

    this.pendingSelections.set(chatId, {
      command,
      conversationIds: telegram.map((c) => c.id)
    })

    await this.sendHtml(chatId, `${headerHtml}\n\n${itemsHtml}`)
  }

  /**
   * Swap this chat's active conversation to the selected one. The
   * old conversation file stays on disk; only the chat-id mapping
   * changes, which is what /resume effectively means: "make this
   * conversation the one I'm continuing."
   */
  private async handleResumeSelection(chatId: number, conversationId: string): Promise<void> {
    const conv = await loadConversation(conversationId)
    if (!conv) {
      await this.safeSend(chatId, '⚠️ That conversation is no longer available.')
      return
    }
    await setConversationIdForChat(chatId, conversationId)
    await this.sendHtml(chatId, `▶️ Resumed: <b>${escapeHtml(conv.title)}</b>`)
  }

  /**
   * Delete the chosen conversation. If it was the chat's active
   * conversation, also rotate the mapping to a fresh one — leaving
   * the chat with no active conversation would orphan the next
   * message. If a different (non-active) conversation was deleted,
   * the chat keeps its current active.
   */
  private async handleDeleteSelection(chatId: number, conversationId: string): Promise<void> {
    const currentId = await getConversationIdForChat(chatId)
    const wasActive = currentId === conversationId

    await deleteConversation(conversationId)

    if (wasActive) {
      const fresh = createConversation(null)
      fresh.channel = 'telegram'
      await saveConversation(fresh)
      await setConversationIdForChat(chatId, fresh.id)
      await this.sendHtml(chatId, `🗑 Deleted. New conversation started.\n\n${COMMANDS_HELP_HTML}`)
    } else {
      await this.safeSend(chatId, '🗑 Deleted.')
    }
  }

  /**
   * Generate and send a polite "I'm busy" reply using the local
   * provider directly. Bypasses the agent pipeline entirely so the
   * decline doesn't queue behind the active turn or interrupt it.
   * Falls back to a static message if the local model isn't
   * configured, errors out, or doesn't produce text within
   * BUSY_REPLY_TIMEOUT_MS — keeps the user from hanging on a slow
   * cold-start.
   */
  private async sendBusyReply(chatId: number, userText: string): Promise<void> {
    if (!this.localProvider.isReady) {
      await this.safeSend(chatId, FALLBACK_BUSY_REPLY)
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
    await this.safeSend(chatId, trimmed.length > 0 ? trimmed : FALLBACK_BUSY_REPLY)
  }

  /**
   * Telegram's press-and-hold voice message (the mic button — comes
   * in as `message:voice`, distinct from `message:audio` which is a
   * music file the user attached).
   *
   * Flow: download the OGG/Opus blob to the conversation's uploads
   * folder (same place every other media file lives), run it through
   * the cerebellum's stt_transcribe tool, then dispatch a normal
   * text turn using the transcript as content with the voice file
   * attached. The agent sees a regular user turn with the transcript
   * spelled out; the audio is preserved as an attachment so the
   * in-app history can play it back later.
   *
   * Other audio types (`message:audio`, attached MP3s, etc.) keep
   * the original attach-and-dispatch flow via handleMediaMessage.
   */
  private async handleVoiceMessage(ctx: BotContext): Promise<void> {
    const userId = ctx.from?.id
    const chatId = ctx.chat?.id
    const message = ctx.message
    if (!userId || !chatId || !message) return
    if (!this.allowedUserIds.has(userId)) return

    if (message.message_id) this.trackMessageId(chatId, message.message_id)

    const fileInfo = extractFileInfo(message)
    if (!fileInfo) return

    if (this.activeByChat.size > 0) {
      await this.sendBusyReply(chatId, '(voice message)')
      return
    }

    // Light up the typing bubble for the entire pre-turn window —
    // download, STT, transcript echo. dispatchTurn's onTurnStarted
    // hands off to the in-turn heartbeat; the finally below catches
    // every early-return path (download fail, transcribe fail, etc.)
    // so the bubble never lingers past the work.
    this.startPreTyping(chatId, ctx)
    try {
      const conversation = await this.loadOrCreateConversation(chatId)

      let attachment: MessageAttachment
      try {
        const file = await ctx.api.getFile(fileInfo.fileId)
        if (typeof file.file_size === 'number' && file.file_size > TELEGRAM_DOWNLOAD_LIMIT) {
          await this.safeSend(
            chatId,
            `⚠️ Voice message too large (${formatBytes(file.file_size)}). Limit is ${formatBytes(TELEGRAM_DOWNLOAD_LIMIT)}.`
          )
          return
        }
        if (!file.file_path) {
          throw new Error('telegram getFile returned no file_path')
        }
        if (!this.botToken) {
          throw new Error('bot is not running')
        }
        const url = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`download failed: HTTP ${response.status}`)
        }
        const buffer = Buffer.from(await response.arrayBuffer())

        // Save to workspace/uploads/{conv}/ — same pattern any other
        // media file uses. The voice file persists alongside the
        // conversation; the in-app history can replay it later.
        attachment = await saveUploadFromBuffer(
          conversation.id,
          buffer,
          fileInfo.fileName ?? defaultFileName(file.file_path)
        )
        this.agent.corpus.emit('telegram.media.received', {
          chatId,
          userId,
          type: attachment.type,
          filePath: attachment.filePath,
          sizeBytes: attachment.sizeBytes
        })
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err)
        await this.safeSend(chatId, `⚠️ Voice download failed: ${errMessage}`)
        return
      }

      // Stamp the conversation id on cerebellum BEFORE invoking the tool
      // so the speech-to-text plugin's persistTranscription() routes the
      // transcript into speech/conv-{id}/ instead of speech/orphan/. The
      // agent's respond() does this for in-turn tool calls, but this
      // path runs the tool directly, outside any turn.
      this.agent.cerebellum.setCurrentConversationId(conversation.id)
      let result: Awaited<ReturnType<typeof this.agent.cerebellum.executeTool>>
      try {
        result = await this.agent.cerebellum.executeTool('stt_transcribe', {
          filePath: attachment.filePath
        })
      } finally {
        this.agent.cerebellum.setCurrentConversationId(null)
      }
      if (!result.success) {
        await this.safeSend(
          chatId,
          `⚠️ Couldn't transcribe voice message: ${result.error ?? 'unknown error'}`
        )
        return
      }
      const transcript = extractTranscript(result.output ?? '')
      if (!transcript) {
        await this.safeSend(chatId, '⚠️ Voice message transcribed to nothing.')
        return
      }

      // Echo the transcript back so the user sees exactly what we
      // heard before the agent responds — italics + mic emoji to
      // distinguish it from a normal reply. Goes out before the turn
      // dispatch so it lands above the agent's answer in the chat.
      await this.sendHtml(chatId, `🎙 <i>${escapeHtml(transcript)}</i>`)

      // Dispatch with the transcript as content and the voice file
      // attached. The agent reads the prose; the audio is along for
      // the ride so the conversation file preserves the original.
      // voicePrompt:true tells the history builder to keep the audio
      // out of the LLM-bound history — the transcript IS the prompt.
      await this.dispatchTurn(chatId, userId, transcript, [attachment], ctx, conversation, {
        voicePrompt: true
      })
    } finally {
      this.stopPreTyping(chatId)
    }
  }

  /**
   * Photos, videos, audio files, documents. Downloads the file via
   * grammY's getFile + the file-bot URL, saves into the conversation's
   * upload folder, attaches metadata to the user message, then dispatches
   * the turn the same way text messages do. Caption (if present) becomes
   * the message body — without one, the message body is empty and the
   * model sees the attachment alone.
   *
   * Voice messages (`message:voice`) get a different path —
   * handleVoiceMessage transcribes them and treats the transcript as
   * the user's prompt instead of attaching the OGG blob.
   */
  private async handleMediaMessage(ctx: BotContext): Promise<void> {
    const userId = ctx.from?.id
    const chatId = ctx.chat?.id
    const message = ctx.message
    if (!userId || !chatId || !message) return
    if (!this.allowedUserIds.has(userId)) return

    if (message.message_id) this.trackMessageId(chatId, message.message_id)

    const fileInfo = extractFileInfo(message)
    if (!fileInfo) return

    const caption = (message.caption ?? '').trim()

    // Busy check happens BEFORE the download — no point pulling 50 MB
    // off Telegram's servers if we're just going to decline anyway.
    // Same one-active-conversation rule the text path enforces.
    if (this.activeByChat.size > 0) {
      const declineContext = caption.length > 0 ? caption : '(media file)'
      await this.sendBusyReply(chatId, declineContext)
      return
    }

    // Light up the typing bubble for the entire pre-turn window —
    // a 20 MB download over slow networks can easily exceed 5 seconds,
    // which is when Telegram clears a single sendChatAction. The finally
    // catches every early-return path so the bubble never lingers.
    this.startPreTyping(chatId, ctx)
    try {
      const conversation = await this.loadOrCreateConversation(chatId)

      let attachment: MessageAttachment
      try {
        const file = await ctx.api.getFile(fileInfo.fileId)
        if (typeof file.file_size === 'number' && file.file_size > TELEGRAM_DOWNLOAD_LIMIT) {
          await this.safeSend(
            chatId,
            `⚠️ File too large (${formatBytes(file.file_size)}). Telegram bots can only fetch files up to 20 MB.`
          )
          return
        }
        if (!file.file_path) {
          throw new Error('telegram getFile returned no file_path')
        }
        if (!this.botToken) {
          throw new Error('bot is not running')
        }
        const url = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`download failed: HTTP ${response.status}`)
        }
        const buffer = Buffer.from(await response.arrayBuffer())
        attachment = await saveUploadFromBuffer(
          conversation.id,
          buffer,
          fileInfo.fileName ?? defaultFileName(file.file_path)
        )
        this.agent.corpus.emit('telegram.media.received', {
          chatId,
          userId,
          type: attachment.type,
          filePath: attachment.filePath,
          sizeBytes: attachment.sizeBytes
        })
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err)
        await this.safeSend(chatId, `⚠️ Media upload failed: ${errMessage}`)
        return
      }

      // Vision-capability gate. The renderer toasts the same message at
      // attach time; on Telegram we can't intercept before download but
      // we catch it before dispatch so the user gets a clear reply
      // instead of the model silently ignoring the image. Cloud
      // providers always support vision; only Ollama can come back
      // negative.
      if (
        attachment.type === 'image' &&
        this.agent.thalamus.getActiveProvider() === 'local' &&
        !(await this.agent.thalamus.localSupportsVision())
      ) {
        const modelName = this.agent.thalamus.getLocalModelName() ?? 'current model'
        await this.safeSend(
          chatId,
          `⚠️ ${modelName} doesn't support image uploads. Switch to a vision model or send a different file.`
        )
        return
      }

      await this.dispatchTurn(chatId, userId, caption, [attachment], ctx, conversation)
    } finally {
      this.stopPreTyping(chatId)
    }
  }

  private async dispatchTurn(
    chatId: number,
    userId: number,
    userText: string,
    attachments: MessageAttachment[],
    ctx: BotContext,
    preloadedConversation?: ConversationFile,
    options: { voicePrompt?: boolean } = {}
  ): Promise<void> {
    void userId
    // Cover the gap between dispatch entry and onTurnStarted — load,
    // save, history build. Idempotent: voice/media already started their
    // own pre-typer; this is a no-op there. For text messages it's the
    // first call. onTurnStarted hands off; the finally below is a safety
    // net for synchronous failures before the turn even starts.
    this.startPreTyping(chatId, ctx)
    try {
      const conversation = preloadedConversation ?? (await this.loadOrCreateConversation(chatId))

      const userMessage: ConversationMessage = {
        role: 'user',
        content: userText,
        timestamp: Date.now(),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(options.voicePrompt ? { voicePrompt: true } : {})
      }
      conversation.messages.push(userMessage)
      conversation.updatedAt = userMessage.timestamp
      await saveConversation(conversation)

      // History exposed to the agent. Voice-prompt messages keep their
      // raw transcript only — the audio stays on disk for chat replay
      // but never reaches the LLM (transcript IS the prompt).
      // Every other user message gets the `<attachments>` metadata
      // block composed into content + the attachments field forwarded,
      // so the agent's processHistoryAttachments can convert images,
      // PDFs, and docs into native content blocks (same rules the
      // in-app channel uses).
      const history: ChatHistoryMessage[] = conversation.messages.map((m) => {
        if (m.role !== 'user') {
          const turnEnd = m.segments?.find((s) => s.kind === 'turn_end')
          const entry: ChatHistoryMessage = { role: m.role, content: m.content }
          if (turnEnd && 'reasoningContent' in turnEnd && turnEnd.reasoningContent) {
            entry.reasoningContent = turnEnd.reasoningContent as string
          }
          return entry
        }
        if (m.voicePrompt) return { role: 'user', content: `<voice_note>\n${m.content}` }
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
        return entry
      })

      const handle = this.runner.send({
        history,
        conversationId: conversation.id,
        makeSink: ({ turnId, conversationId }) => this.createSink(turnId, conversationId, chatId),
        onTurnStarted: ({ turnId, controller }) => {
          const active: ActiveTurn = {
            chatId,
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
            done: null,
            typingTimer: null,
            toolCallNames: new Map(),
            pendingActiveModel: null,
            renderChain: Promise.resolve()
          }
          this.activeByChat.set(chatId, active)
          // Hand off from the pre-turn heartbeat — the turn timer below
          // covers the rest of the window. Stopping the pre-typer here
          // avoids two intervals firing in parallel through the turn.
          this.stopPreTyping(chatId)
          // Fire once immediately so the indicator shows up right away,
          // then re-fire on a 4s cadence — Telegram clears the bubble
          // after ~5s, so a single fire only covers the first burst.
          // While an approval is pending we pause the heartbeat so the
          // chat doesn't look "busy" while the agent is actually waiting
          // on the user. It resumes when they answer.
          void ctx.api.sendChatAction(chatId, 'typing').catch(() => undefined)
          active.typingTimer = setInterval(() => {
            const turn = this.activeByChat.get(chatId)
            if (!turn) return
            if (turn.pendingApprovalId) return
            void ctx.api.sendChatAction(chatId, 'typing').catch(() => undefined)
          }, TYPING_HEARTBEAT_MS)
          // unref so this timer doesn't keep node.js alive on its own
          // during a graceful shutdown.
          active.typingTimer.unref?.()
          // Suppress unused-turnId — captured by sink closures.
          void turnId
        },
        onTurnEnded: () => {
          const finished = this.activeByChat.get(chatId)
          if (finished) {
            // Mark any approval still pending at end-of-turn as denied
            // so the saved record matches the real outcome — the runner
            // also denies the Promise via pendingApprovalResolve below,
            // but the persisted decision needs the same write.
            if (finished.pendingApprovalId) {
              const stored = finished.approvals.get(finished.pendingApprovalId)
              if (stored && !stored.decision) stored.decision = 'denied'
            }

            // Persist the full assistant turn — text, every segment in
            // order, approvals (with decisions), tool timings, stop
            // reason. Same shape the in-app Electron channel saves.
            // Save as long as we have anything to save (text OR
            // segments) so tool-only turns aren't dropped.
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
                // Re-key by toolCallId so the in-app renderer can look up
                // approvals via seg.toolCallId (same as the Electron flow).
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
            if (finished.typingTimer) {
              clearInterval(finished.typingTimer)
              finished.typingTimer = null
            }
            if (finished.pendingApprovalResolve) {
              finished.pendingApprovalResolve('denied')
              finished.pendingApprovalId = null
              finished.pendingApprovalResolve = null
            }
          }
          this.activeByChat.delete(chatId)
        }
      })

      await handle.done
    } finally {
      // Safety net — onTurnStarted already cleared this on the happy
      // path. This catches the case where runner.send throws or
      // handle.done rejects before onTurnStarted ever fires.
      this.stopPreTyping(chatId)
    }
  }

  private async loadOrCreateConversation(chatId: number): Promise<ConversationFile> {
    const existingId = await getConversationIdForChat(chatId)
    if (existingId) {
      const loaded = await loadConversation(existingId)
      if (loaded) {
        const cfg = await getTelegramConfig()
        const autoRefresh = cfg.autoRefresh ?? true
        const staleMs = (cfg.staleHours ?? 3) * 60 * 60 * 1000
        if (autoRefresh && loaded.messages.length > 0) {
          const elapsed = Date.now() - loaded.updatedAt
          if (elapsed >= staleMs) {
            const fresh = createConversation(null)
            fresh.channel = 'telegram'
            await saveConversation(fresh)
            await setConversationIdForChat(chatId, fresh.id)
            const oldTitle = loaded.title || 'Untitled'
            await this.sendHtml(
              chatId,
              `🔄 Conversation "<b>${escapeHtml(oldTitle)}</b>" was idle for ${Math.floor(elapsed / 3_600_000)}h — started a fresh one.\n\nUse /resume to go back. Your past conversations are preserved.`
            )
            return fresh
          }
        }
        return loaded
      }
    }
    const fresh = createConversation(null)
    fresh.channel = 'telegram'
    await saveConversation(fresh)
    await setConversationIdForChat(chatId, fresh.id)
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

  private createSink(turnId: string, conversationId: string | null, chatId: number): TurnSink {
    return {
      channelId: 'telegram',
      turnId,
      conversationId,
      onSegment: (segment) => {
        const active = this.activeByChat.get(chatId)
        if (active) {
          active.renderChain = active.renderChain.then(() => this.renderSegment(chatId, segment))
        }
      },
      onTurnEvent: <E extends keyof CorpusEvents>(type: E, payload: CorpusEvents[E]): void => {
        const active = this.activeByChat.get(chatId)
        if (!active) return
        if (type === 'task.created') {
          const task = payload as CorpusEvents['task.created']
          if (task.taskId) active.taskId = task.taskId
        }
      },
      onApprovalRequest: (req) => this.handleApprovalRequest(chatId, req),
      onDone: () => {
        const active = this.activeByChat.get(chatId)
        if (active) {
          active.renderChain = active.renderChain.then(() => this.flushFinalText(chatId))
        } else {
          void this.flushFinalText(chatId)
        }
      },
      onError: (error) => {
        void this.safeSend(chatId, `⚠️ ${truncateForTelegram(error)}`)
      },
      onCredentialBlocked: () => {
        // The runner already pushed the canned reply through onSegment;
        // nothing extra to do here.
      }
    }
  }

  private async renderSegment(chatId: number, segment: Segment): Promise<void> {
    const active = this.activeByChat.get(chatId)
    if (!active) return

    // Persist EVERY segment in turn order. The in-app chat replays
    // assistant messages from this list (text + tool cards + chips),
    // so dropping any of them would degrade the history view —
    // tool calls would disappear, approvals would orphan, etc.
    active.segments.push(segment)

    if (segment.kind === 'text') {
      await this.flushPendingActiveModel(chatId)
      active.textBuffer += segment.delta
      active.assistantContent += segment.delta
      return
    }

    if (segment.kind === 'tool_call') {
      // Flush any prose preceding the tool call so the message order
      // in Telegram matches the model's output: "here's what I'm
      // thinking … now running tool …". The typing indicator stays
      // live via the per-turn heartbeat. Render the call as a
      // headline with monospace args underneath — the heading is
      // bold so it's scannable, the args go in <pre> so JSON
      // structure stays legible.
      active.toolCallNames.set(segment.toolCallId, segment.name)
      active.toolTimings.set(segment.toolCallId, { startedAt: Date.now() })
      await this.flushPendingActiveModel(chatId)
      await this.flushBufferedText(chatId)
      const heading = `⚙️ <b>${escapeHtml(segment.name)}</b>`
      const args = formatArgsForTelegram(segment.args)
      const html = args.length > 0 ? `${heading}\n<pre>${escapeHtml(args)}</pre>` : heading
      await this.sendHtml(chatId, html)
      return
    }

    if (segment.kind === 'tool_result') {
      const timing = active.toolTimings.get(segment.toolCallId)
      if (timing) timing.endedAt = Date.now()
      const icon = segment.status === 'success' ? '✅' : segment.status === 'denied' ? '❌' : '⚠️'
      const name = active.toolCallNames.get(segment.toolCallId)
      const heading = name ? `${icon} <b>${escapeHtml(name)}</b>` : icon
      const output = segment.output?.trim() ?? ''

      // voice_respond / voice_generate produce a JSON blob whose only
      // useful payload is the MP3 path — render a clean result line
      // and send the audio file as a native Telegram audio message
      // instead of dumping the JSON as a code block.
      if (segment.status === 'success' && (name === 'voice_respond' || name === 'voice_generate')) {
        const voice = parseVoiceToolOutput(output)
        if (voice) {
          await this.sendHtml(chatId, heading)
          await this.sendVoiceAudio(chatId, voice)
          return
        }
      }

      const imagePaths = extractWolffishMediaPaths(output)
      if (imagePaths.length > 0) {
        for (const imgPath of imagePaths) {
          await this.sendImageFile(chatId, imgPath)
        }
        const remaining = stripWolffishMediaMarkdown(output).trim()
        if (remaining.length > 0) {
          const cleanRemaining = markdownToPlain(remaining)
          await this.sendHtml(
            chatId,
            `${heading}\n<pre>${escapeHtml(truncateToolOutput(cleanRemaining))}</pre>`
          )
        }
        return
      }

      const docPaths = extractDocumentPaths(output)
      if (docPaths.length > 0) {
        await this.sendHtml(chatId, heading)
        for (const docPath of docPaths) {
          await this.sendDocumentFile(chatId, docPath)
        }
        return
      }

      if (output.length === 0) {
        await this.sendHtml(chatId, heading)
        return
      }
      // Wrap every tool result in <pre> so shell-style output
      // (ffmpeg, file reads, git diffs) keeps its monospace
      // structure. Strip Markdown markup first so reflective tools
      // like wolffish_status — whose output is itself Markdown —
      // don't surface literal `**` and `##` characters inside the
      // code block. Plain non-markdown output is unaffected by the
      // strip pass.
      const cleaned = markdownToPlain(output)
      const truncated = truncateToolOutput(cleaned)
      await this.sendHtml(chatId, `${heading}\n<pre>${escapeHtml(truncated)}</pre>`)
      return
    }

    if (segment.kind === 'compaction') {
      const saved =
        segment.tokensSaved >= 1000
          ? `${Math.round(segment.tokensSaved / 1000)}k`
          : String(segment.tokensSaved)
      const model = segment.details[0]?.compactedBy
      const via = model && model !== 'truncate' ? ` via ${escapeHtml(model)}` : ''
      const html =
        `🗜️ <b>Context compacted</b> — ${segment.targetsCount}` +
        ` message${segment.targetsCount !== 1 ? 's' : ''} compacted, ` +
        `~${saved} tokens saved${via}`
      await this.sendHtml(chatId, html)
      return
    }

    if (segment.kind === 'turn_end') {
      active.stopReason = segment.stopReason
      // Flush any remaining text. onDone is also called by the runner
      // after this — flushing here covers tool-only turns where the
      // model produced no trailing text after the last tool call.
      // Drop any pending model chip — the iteration ended without
      // committing real content (e.g. silent wrap-up after voice_respond).
      active.pendingActiveModel = null
      await this.flushBufferedText(chatId)
      return
    }

    if (segment.kind === 'active_model') {
      // Defer the chip until the iteration commits real content
      // (text or a tool call). Skips silent wrap-up iterations that
      // would otherwise leave a stray "🤖 model" message at the end.
      active.pendingActiveModel = segment.model
      return
    }

    if (segment.kind === 'provider_change') {
      active.pendingActiveModel = segment.model
      return
    }
  }

  private async flushPendingActiveModel(chatId: number): Promise<void> {
    const active = this.activeByChat.get(chatId)
    if (!active) return
    const model = active.pendingActiveModel
    if (!model) return
    active.pendingActiveModel = null
    await this.sendHtml(chatId, `🤖 <b>${escapeHtml(model)}</b>`)
  }

  private async sendVoiceAudio(
    chatId: number,
    voice: { filePath: string; fileName: string }
  ): Promise<void> {
    if (!this.bot) return
    try {
      const buffer = await fs.readFile(voice.filePath)
      const file = new InputFile(buffer, voice.fileName || path.basename(voice.filePath))
      await this.bot.api.sendAudio(chatId, file)
    } catch (err) {
      await this.sendHtml(
        chatId,
        `⚠️ Failed to send voice memo: ${escapeHtml(err instanceof Error ? err.message : String(err))}`
      )
    }
  }

  private async sendImageFile(chatId: number, filePath: string): Promise<void> {
    if (!this.bot) return
    try {
      const buffer = await fs.readFile(filePath)
      const file = new InputFile(buffer, path.basename(filePath))
      const ext = path.extname(filePath).toLowerCase()
      if (ext === '.gif') {
        await this.bot.api.sendAnimation(chatId, file)
      } else {
        await this.bot.api.sendPhoto(chatId, file)
      }
    } catch {
      // best-effort — file may not exist or bot may have dropped
    }
  }

  private async sendDocumentFile(chatId: number, filePath: string): Promise<void> {
    if (!this.bot) return
    try {
      const buffer = await fs.readFile(filePath)
      const file = new InputFile(buffer, path.basename(filePath))
      const sent = await this.bot.api.sendDocument(chatId, file)
      this.trackMessageId(chatId, sent.message_id)
    } catch {
      // best-effort
    }
  }

  private async flushBufferedText(chatId: number): Promise<void> {
    const active = this.activeByChat.get(chatId)
    if (!active) return
    const raw = active.textBuffer
    active.textBuffer = ''

    const imagePaths = extractWolffishMediaPaths(raw)
    const cleaned = stripWolffishMediaMarkdown(raw)

    if (cleaned.trim().length > 0) {
      for (const chunk of splitForTelegram(cleaned)) {
        await this.safeSend(chatId, chunk)
      }
    }
    for (const imgPath of imagePaths) {
      await this.sendImageFile(chatId, imgPath)
    }
  }

  private async flushFinalText(chatId: number): Promise<void> {
    await this.flushBufferedText(chatId)
  }

  private handleApprovalRequest(
    chatId: number,
    req: ApprovalRequest & { id: string }
  ): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      const active = this.activeByChat.get(chatId)
      if (!active) {
        resolve('denied')
        return
      }

      // Drop any prior pending approval from a previous tool call —
      // the new one supersedes it. The earlier resolver fires denied
      // so the prior amygdala await unwinds cleanly.
      if (active.pendingApprovalResolve) {
        active.pendingApprovalResolve('denied')
        // Mark the superseded approval as denied so the saved
        // history reflects what actually happened.
        const prior = active.pendingApprovalId
        if (prior) {
          const stored = active.approvals.get(prior)
          if (stored && !stored.decision) stored.decision = 'denied'
        }
      }
      active.pendingApprovalId = req.id
      active.pendingApprovalResolve = resolve

      // Stash the approval data in the turn record so the in-app
      // history view can show the same approval card the live
      // Electron flow would. Decision stays undefined here and
      // gets back-filled when the user sends /approve or /deny.
      active.approvals.set(req.id, {
        approvalId: req.id,
        toolCallId: req.toolCall.id,
        tool: req.toolCall.name,
        args: req.toolCall.args,
        reason: req.reason,
        level: req.level,
        description: req.description
      })

      const args = formatArgsForTelegram(req.toolCall.args)
      const parts: string[] = [`🔒 <b>Approval required:</b> ${escapeHtml(req.toolCall.name)}`]
      if (req.description?.title) parts.push(escapeHtml(req.description.title))
      if (req.description?.description) parts.push(escapeHtml(req.description.description))
      if (req.reason) parts.push(`<b>Reason:</b> ${escapeHtml(req.reason)}`)
      if (args.length > 0) parts.push(`<pre>${escapeHtml(args)}</pre>`)
      parts.push('Send /approve or /deny.')
      void this.sendHtml(chatId, parts.join('\n\n'))
    })
  }

  /**
   * Send a Markdown-formatted message. Converts the text to the
   * subset of HTML Telegram supports — plain prose passes through
   * with HTML entities escaped; Markdown markup (`**bold**`, fenced
   * code, links, etc.) renders as proper formatting instead of
   * literal asterisks and backticks.
   *
   * If Telegram rejects the HTML (parse error on input the converter
   * didn't anticipate), falls back to plain text so the user still
   * sees the content rather than nothing.
   */
  private async safeSend(chatId: number, text: string): Promise<void> {
    // ⚠️ Potential breaking change — the leading zero-width mark may
    // interfere with downstream text matching, hashing, or /command parsing.
    const mark = bidiMark(text)
    await this.dispatchSend(chatId, mark + markdownToTelegramHtml(text), mark + text)
  }

  /**
   * Send a message that's already in Telegram HTML form. Used for the
   * structured surfaces the channel constructs itself — tool calls,
   * tool results, approval prompts — where wrapping their output in
   * <pre> code blocks is more readable than plain-text monospace
   * approximations. Same fallback semantics as safeSend.
   */
  private async sendHtml(chatId: number, html: string): Promise<void> {
    await this.dispatchSend(chatId, html, stripHtmlTags(html))
  }

  private async dispatchSend(chatId: number, html: string, plainFallback: string): Promise<void> {
    if (!this.bot) return
    try {
      const sent = await this.bot.api.sendMessage(chatId, html, { parse_mode: 'HTML' })
      this.trackMessageId(chatId, sent.message_id)
      return
    } catch (err) {
      const kind = classifyBotError(err)
      if (kind !== 'send' && kind !== 'unknown') {
        const message = err instanceof Error ? err.message : String(err)
        this.agent.corpus.emit('telegram.error', { kind, message })
        return
      }
    }
    try {
      const sent = await this.bot.api.sendMessage(chatId, plainFallback)
      this.trackMessageId(chatId, sent.message_id)
    } catch (err) {
      const kind = classifyBotError(err)
      const message = err instanceof Error ? err.message : String(err)
      this.agent.corpus.emit('telegram.error', { kind, message })
    }
  }
}

/**
 * Telegram caps each message at 4096 characters. Split on paragraph
 * boundaries when possible so a long reply doesn't get sliced
 * mid-sentence; fall back to hard-cut for monolithic blocks.
 */
function splitForTelegram(text: string): string[] {
  if (text.length <= MESSAGE_LIMIT) return [text]
  const out: string[] = []
  let remaining = text
  while (remaining.length > MESSAGE_LIMIT) {
    const slice = remaining.slice(0, MESSAGE_LIMIT)
    let cut = slice.lastIndexOf('\n\n')
    if (cut < MESSAGE_LIMIT * 0.5) cut = slice.lastIndexOf('\n')
    if (cut < MESSAGE_LIMIT * 0.5) cut = slice.lastIndexOf('. ')
    if (cut < MESSAGE_LIMIT * 0.5) cut = MESSAGE_LIMIT
    out.push(remaining.slice(0, cut).trimEnd())
    remaining = remaining.slice(cut).trimStart()
  }
  if (remaining.length > 0) out.push(remaining)
  return out
}

function truncateForTelegram(text: string): string {
  if (text.length <= MESSAGE_LIMIT) return text
  return text.slice(0, MESSAGE_LIMIT - 1) + '…'
}

const TOOL_OUTPUT_LIMIT = 1500

function truncateToolOutput(text: string): string {
  if (text.length <= TOOL_OUTPUT_LIMIT) return text
  return text.slice(0, TOOL_OUTPUT_LIMIT - 1) + '…'
}

function formatArgsForTelegram(args: Record<string, unknown>): string {
  const entries = Object.entries(args ?? {})
  if (entries.length === 0) return ''
  const parts: string[] = []
  for (const [key, value] of entries) {
    parts.push(`${key}: ${stringifyArg(value)}`)
  }
  return parts.join('\n')
}

function stringifyArg(value: unknown): string {
  if (value == null) return String(value)
  if (typeof value === 'string') {
    if (value.length > 200) return value.slice(0, 199) + '…'
    return value
  }
  try {
    const json = JSON.stringify(value)
    if (json.length > 200) return json.slice(0, 199) + '…'
    return json
  } catch {
    return String(value)
  }
}

/**
 * Extract the leading slash command from a lowercased message, or
 * null if the message isn't a command. Strips bot-username suffixes
 * (`/new@MyBot`) and discards trailing arguments — we only key off
 * the command itself.
 */
/**
 * Strip Telegram-flavored HTML tags and decode the four entities the
 * channel emits. Used as the plain-text fallback for sendHtml when
 * Telegram rejects the HTML — the user still sees readable content,
 * just without formatting.
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

/**
 * Pull plain text out of an stt_transcribe tool result. The plugin
 * returns a JSON blob shaped like `{ "text": "...", "language": "...",
 * "segments": [...] }`. Older / alternate plugin shapes might just
 * print the transcript as a bare string — handle both. Returns the
 * empty string when nothing usable is in the output.
 */
function extractTranscript(rawOutput: string): string {
  const trimmed = rawOutput.trim()
  if (trimmed.length === 0) return ''
  try {
    const parsed = JSON.parse(trimmed) as { text?: unknown }
    if (parsed && typeof parsed.text === 'string') return parsed.text.trim()
  } catch {
    // not JSON; fall through to raw
  }
  return trimmed
}

/**
 * Parse a number-only reply for picker selection. Accepts a 1-2
 * digit number, optionally surrounded by whitespace. Returns null
 * if the message is anything else, including text that contains a
 * number ("send 1 message" doesn't select item 1).
 */
function parseSelectionNumber(text: string): number | null {
  const m = /^\s*(\d{1,2})\s*$/.exec(text)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Render one item in the /resume or /delete picker. Three lines —
 * keycap-numbered title, relative time, message count — matching
 * the layout the user requested. Title is HTML-escaped because it
 * goes through sendHtml without further conversion.
 */
function formatPickerItem(conv: ConversationMeta, index: number): string {
  const numEmoji = KEYCAP_NUMBERS[index] ?? `${index + 1}.`
  const title = escapeHtml(conv.title || 'Untitled')
  const when = formatRelativeTime(conv.updatedAt)
  const count = conv.messageCount === 1 ? '1 message' : `${conv.messageCount ?? 0} messages`
  return `${numEmoji} <b>${title}</b>\n${when}\n${count}`
}

/**
 * Plain-English relative time. Telegram users see this in /resume
 * and /delete pickers, so it skews short and human. Anything past
 * a week falls back to a date so old conversations stay legible.
 */
function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp
  if (diffMs < 0) return 'just now'
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 2) return 'a minute ago'
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 2) return 'an hour ago'
  if (hours < 24) return `${hours} hours ago`
  const days = Math.floor(hours / 24)
  if (days < 2) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(timestamp).toLocaleDateString()
}

function parseSlashCommand(lower: string): string | null {
  if (!lower.startsWith('/')) return null
  // Take everything up to the first space, then strip @username.
  const head = lower.split(/\s+/, 1)[0]
  const at = head.indexOf('@')
  return at >= 0 ? head.slice(0, at) : head
}

function classifyBotError(err: unknown): CorpusEvents['telegram.error']['kind'] {
  if (err instanceof GrammyError) {
    const code = err.error_code
    // 404 from getMe means Telegram couldn't resolve the bot for the
    // supplied token — i.e. the token is wrong or revoked. Same
    // user-facing meaning as 401/403, just a different status code.
    if (code === 401 || code === 403 || code === 404) return 'token'
    if (code === 429) return 'rate_limit'
    return 'send'
  }
  if (err instanceof HttpError) {
    // grammY wraps non-JSON 4xx responses as HttpError. The auth-shaped
    // codes (401/403/404) still mean the token is bad — message format
    // is `Call to 'getMe' failed! (404: Not Found)`.
    if (/\((?:401|403|404):/.test(err.message ?? '')) return 'token'
    return 'network'
  }
  // Best-effort fallback for wrapped/non-grammy errors.
  const msg = err instanceof Error ? err.message : String(err)
  if (/\((?:401|403|404):/.test(msg)) return 'token'
  return 'unknown'
}

/**
 * Loose bot-token shape check. BotFather hands out tokens of the form
 * `<digits>:<35-char base64-ish string>`. Catches the most common
 * paste mistakes (just the API ID, the link without the token, etc.)
 * before we send a doomed request to Telegram.
 */
function isPlausibleBotToken(token: string): boolean {
  return /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)
}

type ExtractedFile = { fileId: string; fileName?: string }

/**
 * Extract the bot-API file id and (best-effort) original name from a
 * telegram message. Telegram exposes different shapes per media kind —
 * this normalizes them so the channel only has to think in terms of
 * "fetch this id, save it as that name".
 */
function extractFileInfo(message: unknown): ExtractedFile | null {
  const m = message as {
    photo?: Array<{ file_id?: string; width?: number; height?: number }>
    video?: { file_id?: string; file_name?: string; mime_type?: string }
    audio?: { file_id?: string; file_name?: string; title?: string; performer?: string }
    voice?: { file_id?: string; mime_type?: string }
    document?: { file_id?: string; file_name?: string; mime_type?: string }
    message_id?: number
  } | null
  if (!m) return null

  if (m.photo && m.photo.length > 0) {
    // Telegram returns multiple sizes; the last entry is the largest.
    const largest = m.photo[m.photo.length - 1]
    if (!largest?.file_id) return null
    const stamp = m.message_id ?? Date.now()
    return { fileId: largest.file_id, fileName: `photo_${stamp}.jpg` }
  }

  if (m.video?.file_id) {
    return {
      fileId: m.video.file_id,
      fileName: m.video.file_name ?? `video_${m.message_id ?? Date.now()}.mp4`
    }
  }

  if (m.audio?.file_id) {
    const fallbackTitle =
      [m.audio.performer, m.audio.title].filter(Boolean).join(' - ') ||
      `audio_${m.message_id ?? Date.now()}`
    return {
      fileId: m.audio.file_id,
      fileName: m.audio.file_name ?? `${fallbackTitle}.mp3`
    }
  }

  if (m.voice?.file_id) {
    return {
      fileId: m.voice.file_id,
      fileName: `voice_${m.message_id ?? Date.now()}.ogg`
    }
  }

  if (m.document?.file_id) {
    return {
      fileId: m.document.file_id,
      fileName: m.document.file_name ?? `document_${m.message_id ?? Date.now()}`
    }
  }

  return null
}

function defaultFileName(filePath: string): string {
  const base = filePath.split('/').pop() ?? 'upload.bin'
  if (base.length === 0) return 'upload.bin'
  return base
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function parseVoiceToolOutput(output: string): { filePath: string; fileName: string } | null {
  if (!output) return null
  try {
    const parsed = JSON.parse(output)
    const filePath = typeof parsed?.filePath === 'string' ? parsed.filePath : ''
    const fileName = typeof parsed?.fileName === 'string' ? parsed.fileName : ''
    if (!filePath) return null
    return { filePath, fileName: fileName || path.basename(filePath) }
  } catch {
    return null
  }
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const DOCUMENT_EXTS = new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.csv'])

function extractWolffishMediaPaths(output: string): string[] {
  const paths: string[] = []
  const seen = new Set<string>()

  const mediaRegex = /wolffish-media:\/\/([^\s)"]+)/g
  let match: RegExpExecArray | null
  while ((match = mediaRegex.exec(output)) !== null) {
    const abs = path.join(workspaceRoot(), decodeURIComponent(match[1]))
    if (!seen.has(abs)) {
      seen.add(abs)
      paths.push(abs)
    }
  }

  const absRegex = /(\/[^\s",:)]+\.(?:png|jpe?g|gif|webp))\b/gi
  while ((match = absRegex.exec(output)) !== null) {
    const abs = match[1]
    if (!seen.has(abs) && IMAGE_EXTS.has(path.extname(abs).toLowerCase())) {
      seen.add(abs)
      paths.push(abs)
    }
  }

  const home = os.homedir()
  const homeRegex = /(~\/[^\s",:)]+\.(?:png|jpe?g|gif|webp))\b/gi
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
    .replace(/!\[[^\]]*\]\(wolffish-media:\/\/[^\s)]+\)/g, '')
    .replace(/(Saved to|Screenshot saved[^.]*) ~?\/[^\s"]+\.(?:png|jpe?g|gif|webp)/gi, '')
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

// Re-exported so the IPC layer can include attachment data when
// surfacing already-saved Telegram media to other consumers in
// future phases. Not used yet.
export type { MessageAttachment }
