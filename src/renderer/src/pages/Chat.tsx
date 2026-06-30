import { ApprovalCard } from '@components/common/approval-card/ApprovalCard'
import { QuestionCard } from '@components/common/question-card/QuestionCard'
import { AttachmentList } from '@components/common/attachment-list/AttachmentList'
import { AudioPlayer } from '@components/common/audio-player/AudioPlayer'
import { CodeFileViewer } from '@components/common/code-file-viewer/CodeFileViewer'
import { CompactionCard } from '@components/common/compaction-card/CompactionCard'
import { ContextMeter } from '@components/common/context-meter/ContextMeter'
import { DocxViewer } from '@components/common/docx-viewer/DocxViewer'
import { FileCard } from '@components/common/file-card/FileCard'
import { PathCard } from '@components/common/path-card/PathCard'
import { extractPathCandidates } from '@components/common/path-card/extractPaths'
import { canonicalPath } from '@components/common/path-card/pathStat'
import { HtmlFileViewer } from '@components/common/html-file-viewer/HtmlFileViewer'
import { ReindexActiveOverlay } from '@components/common/reindex-active-overlay/ReindexActiveOverlay'
import { ImageViewer } from '@components/common/image-viewer/ImageViewer'
import { MarkdownFileViewer } from '@components/common/markdown-file-viewer/MarkdownFileViewer'
import { PageViewer } from '@components/common/page-viewer/PageViewer'
import { PdfViewer } from '@components/common/pdf-viewer/PdfViewer'
import { ProviderErrorCards } from '@components/common/provider-error-card/ProviderErrorCard'
import { Sidebar } from '@components/common/sidebar/Sidebar'
import { SpreadsheetViewer } from '@components/common/spreadsheet-viewer/SpreadsheetViewer'
import { BrainButton } from '@components/common/brain-button/BrainButton'
import { ToolCard } from '@components/common/tool-card/ToolCard'
import { TurnFooter } from '@components/common/turn-footer/TurnFooter'
import { UpdateCard } from '@components/common/update-card/UpdateCard'
import { VideoPlayer } from '@components/common/video-player/VideoPlayer'
import { CodeEditor } from '@components/core/CodeEditor'
import { useContextMenu } from '@components/core/ContextMenu'
import { CopyButton } from '@components/core/CopyButton'
import { Markdown } from '@components/core/Markdown'
import {
  AnthropicLogo,
  DeepSeekLogo,
  KimiLogo,
  MimoLogo,
  MiniMaxLogo,
  OllamaLogo,
  OpenAILogo,
  OpenRouterLogo,
  QwenLogo,
  StepfunLogo,
  ZaiLogo,
  TelegramLogo,
  WhatsAppLogo,
  XAILogo
} from '@components/core/ProviderLogos'
import { useToast } from '@components/core/toast/useToast'
import { Tooltip } from '@components/core/Tooltip'
import { RTL_LOCALES } from '@lib/i18n'
import { cn } from '@lib/utils/cn'
import { formatBytes } from '@lib/utils/format'
import { pageTopPadding } from '@lib/utils/platform'
import { preselectSettingsTab } from '@pages/settings/settingsNav'
import type {
  AskUserResponse,
  ChatHistoryMessage,
  ConversationChannel,
  ConversationFile,
  FolderListing,
  MessageAttachment,
  Segment,
  ThinkingMode,
  TimelineEntry
} from '@preload/index'
import {
  normalizeReasoningMode,
  reasoningModesFor,
  type ReasoningMode
} from '@main/runtime/reasoning'
import {
  useFlow,
  type ApprovalCardState,
  type AskCardState,
  type AssistantMessage,
  type ChatMessage,
  type ToolTiming
} from '@providers/flow/useFlow'
import { useLocale } from '@providers/locale/useLocale'
import { useTheme } from '@providers/theme/useTheme'
import iconTransparent from '@resources/images/icon_transparent.png'
import {
  Activity04Icon,
  ArrowExpandIcon,
  ArrowUp02Icon,
  CancelCircleIcon,
  Clock01Icon,
  CloudIcon,
  CloudUploadIcon,
  Delete02Icon,
  FileEditIcon,
  Folder01Icon,
  HeartCheckIcon,
  Image02Icon,
  Robot01Icon,
  SparklesIcon,
  UserIcon,
  Mic01Icon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
  Settings02Icon,
  StopCircleIcon
} from 'hugeicons-react'
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

type ToolResultSegment = Extract<Segment, { kind: 'tool_result' }>

// In-app verbose display preference, mirroring the Telegram / WhatsApp
// channel toggle but for what the renderer DISPLAYS (history is untouched).
// false (default) = clean feed: agent replies, file-bearing tool results,
// and errors only; the model/provider chip, tool-activity and compaction
// cards are hidden. true = the full activity feed (chip included). Provided
// by Chat, read in AssistantBubble.
const InAppVerboseContext = createContext(false)

export function Chat(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const { isDark } = useTheme()
  const toast = useToast()
  const isRtl = RTL_LOCALES.has(locale)
  const {
    goTo,
    status,
    messages,
    setMessages,
    refreshStatus,
    activeConversationId,
    setActiveConversationId
  } = useFlow()

  const currentModel = status?.config?.llm.local.model ?? null
  const showAnalytics = status?.config?.showChatAnalytics ?? true
  const localOnly = status?.config?.llm.localOnly ?? false
  const cloudProviders = useMemo(
    () => status?.config?.llm.providers ?? [],
    [status?.config?.llm.providers]
  )
  const brain = status?.config?.llm.brain ?? null
  const hasCloudProvider = cloudProviders.some((p) => p.apiKey && p.apiKey.length > 0)
  // The single Brain is the active cloud model — but only when its provider
  // still has a saved key. Null otherwise (no cloud model selected).
  const activeCloudProvider = useMemo(() => {
    if (!brain) return null
    const provider = cloudProviders.find((p) => p.id === brain.providerId)
    return provider && provider.apiKey && provider.apiKey.length > 0 ? brain.providerId : null
  }, [brain, cloudProviders])
  const hasAnyModel = !!currentModel || hasCloudProvider
  const [savingMode, setSavingMode] = useState(false)
  const activeCloudModel = useMemo(
    () => (activeCloudProvider && brain ? brain.model : null),
    [activeCloudProvider, brain]
  )

  // Orchestrator mode: the cloud switcher tab reflects BOTH models — the
  // orchestrator (the Brain, shown via activeCloud*) and the worker model below.
  const orchestratorMode = status?.config?.llm.orchestratorMode ?? 'single'
  const workerModel = status?.config?.llm.workerModel ?? null
  const workerSel = useMemo(() => {
    if (!workerModel) return null
    const provider = cloudProviders.find((p) => p.id === workerModel.providerId)
    return provider && provider.apiKey && provider.apiKey.length > 0
      ? { provider: workerModel.providerId as string, model: workerModel.model }
      : null
  }, [workerModel, cloudProviders])
  const persistedThinkingModes = status?.config?.llm.thinkingModes

  // Ordered reasoning modes this model honours (canonical scale). Drives the
  // brain button. Source of truth is reasoningModesFor — corrected to live
  // provider behaviour during verification.
  const reasoningModes = useMemo<ReasoningMode[]>(() => {
    if (localOnly) return []
    const provider = activeCloudProvider
    const model = activeCloudModel
    if (!provider || !model) return []
    const openrouterReasoning =
      provider === 'openrouter'
        ? (cloudProviders.find((p) => p.id === 'openrouter')?.reasoningModels?.includes(model) ??
          false)
        : false
    return reasoningModesFor(provider, model, { openrouterReasoning })
  }, [localOnly, activeCloudProvider, activeCloudModel, cloudProviders])

  // Active mode, clamped/migrated to a value valid for this model's modes.
  const thinkingMode = useMemo<ReasoningMode>(
    () =>
      normalizeReasoningMode(
        activeCloudModel ? persistedThinkingModes?.[activeCloudModel] : undefined,
        reasoningModes
      ),
    [activeCloudModel, persistedThinkingModes, reasoningModes]
  )

  // Persist via API — the source of truth is persistedThinkingModes, which
  // updates reactively through status once the write completes.
  const setThinkingMode = useCallback(
    async (mode: string) => {
      if (!activeCloudModel) return
      // Skip redundant writes. The effect below drives this setter
      // autonomously on every status/model transition (including starting a
      // new chat), so persisting an unchanged value just adds config.json
      // write churn — and that write contention is what surfaced the
      // config-wipe race in the first place. A never-seen model has no
      // persisted value (undefined), so the default still gets written once.
      const current = persistedThinkingModes?.[activeCloudModel]
      if (mode === current) return
      await window.api.runtime.setThinkingMode(activeCloudModel, mode as ThinkingMode)
      await refreshStatus()
    },
    [activeCloudModel, persistedThinkingModes, refreshStatus]
  )

  // Migrate/clamp the persisted mode to a value valid for this model. Runs on
  // load and on every model switch so a stale or legacy token (e.g. 'basic')
  // is rewritten to a canonical one. No write when the model has no modes.
  useEffect(() => {
    if (!activeCloudModel || reasoningModes.length === 0) return
    const persisted = persistedThinkingModes?.[activeCloudModel]
    const normalized = normalizeReasoningMode(persisted, reasoningModes)
    if (persisted !== normalized) void setThinkingMode(normalized)
  }, [reasoningModes, activeCloudModel, persistedThinkingModes, setThinkingMode])

  const [reindexActive, setReindexActive] = useState(false)
  useEffect(() => {
    let cancelled = false
    window.api.reindex.getStatus().then((s) => {
      if (!cancelled) setReindexActive(!!s)
    })
    const offStarted = window.api.reindex.onStarted(() => setReindexActive(true))
    const offEnded = window.api.reindex.onEnded(() => setReindexActive(false))
    return () => {
      cancelled = true
      offStarted()
      offEnded()
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    const off = window.api.provider.onUpdated(() => {
      void refreshStatus()
    })
    return off
  }, [refreshStatus])

  // In-app verbose display preference. Read once on mount and kept live via
  // the broadcast the settings panel triggers on save, so toggling it
  // re-renders an open feed immediately. Off (default) = clean feed.
  // Seed from the already-loaded workspace config (status is resolved before
  // Chat renders) so the very FIRST paint knows whether tool cards belong in
  // the clean feed. Without this seed it defaulted to false, the async
  // getConfig() below flipped it to true a beat later, and tool cards popped in
  // on a second render — growing the conversation and flashing on open.
  const [inAppVerbose, setInAppVerbose] = useState(status?.config?.inapp?.verbose ?? false)
  useEffect(() => {
    let cancelled = false
    void window.api.inapp.getConfig().then((cfg) => {
      if (!cancelled) setInAppVerbose(cfg.verbose ?? false)
    })
    const off = window.api.inapp.onConfigChange((cfg) => setInAppVerbose(cfg.verbose ?? false))
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const onModeChange = useCallback(
    async (next: boolean) => {
      if (savingMode || next === localOnly) return
      setSavingMode(true)
      try {
        await window.api.runtime.setLocalOnly(next)
        await refreshStatus()
      } finally {
        setSavingMode(false)
      }
    },
    [savingMode, localOnly, refreshStatus]
  )
  // While the agent is paused for a confirm/destructive approval, the
  // streaming bubble swaps "Thinking…" for "Awaiting permission…".
  const awaitingApproval = messages.some((m) => {
    if (!isAssistant(m) || !m.approvals) return false
    for (const approval of Object.values(m.approvals)) {
      if (approval.decision === undefined) return true
    }
    return false
  })
  // While the agent is paused on an ask_user question, the streaming bubble
  // shows "Awaiting your answer…" instead of the thinking shimmer.
  const awaitingAsk = messages.some((m) => {
    if (!isAssistant(m) || !m.asks) return false
    for (const ask of Object.values(m.asks)) {
      if (!ask.answered) return true
    }
    return false
  })

  const [draft, setDraft] = useState('')
  const [draftExpanded, setDraftExpanded] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { onContextMenu: onTextareaContextMenu, menu: textareaMenu } = useContextMenu(
    useCallback(() => {
      const el = textareaRef.current
      const hasSelection = el ? el.selectionStart !== el.selectionEnd : false
      return [
        {
          label: t('chat.contextMenu.selectAll'),
          action: () => el?.select(),
          disabled: !draft
        },
        {
          label: t('chat.contextMenu.copy'),
          action: () => {
            if (el)
              void navigator.clipboard.writeText(
                el.value.substring(el.selectionStart, el.selectionEnd)
              )
          },
          disabled: !hasSelection
        },
        {
          label: t('chat.contextMenu.paste'),
          action: async () => {
            const text = await navigator.clipboard.readText()
            if (!el) return
            const start = el.selectionStart
            const end = el.selectionEnd
            const before = draft.substring(0, start)
            const after = draft.substring(end)
            setDraft(before + text + after)
          }
        },
        { separator: true as const },
        {
          label: t('chat.contextMenu.clear'),
          action: () => setDraft(''),
          disabled: !draft
        }
      ]
    }, [draft, t])
  )

  const { onContextMenu: onEditorContextMenu, menu: editorMenu } = useContextMenu(
    useCallback(() => {
      return [
        {
          label: t('chat.contextMenu.selectAll'),
          action: () => document.execCommand('selectAll'),
          disabled: !draft
        },
        {
          label: t('chat.contextMenu.copy'),
          action: () => {
            const sel = window.getSelection()
            if (sel && sel.toString()) void navigator.clipboard.writeText(sel.toString())
          },
          disabled: !window.getSelection()?.toString()
        },
        {
          label: t('chat.contextMenu.paste'),
          action: async () => {
            const text = await navigator.clipboard.readText()
            document.execCommand('insertText', false, text)
          }
        },
        { separator: true as const },
        {
          label: t('chat.contextMenu.clear'),
          action: () => setDraft(''),
          disabled: !draft
        }
      ]
    }, [draft, t])
  )
  const [storedFolders, setStoredFolders] = useState<string[]>([])
  const workingFolders = useMemo(
    () => (activeConversationId ? storedFolders : []),
    [activeConversationId, storedFolders]
  )
  const [folderListOpen, setFolderListOpen] = useState(false)
  /**
   * Files the user has staged but not yet sent. Each entry holds the
   * already-saved metadata returned from upload:saveFile so the file is
   * on disk the moment it's picked — sending later just attaches the
   * stable filePath. If the user discards a staged file we leave the
   * bytes on disk; cheap, and a future "uploads orphan sweep" can clean
   * them up if it ever becomes a problem.
   */
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([])
  // Active model's vision support, used to proactively reject image
  // uploads on local non-vision models. Refreshed when the active model
  // changes; defaults to true (cloud providers always support vision)
  // so image uploads aren't blocked while the first probe is in flight.
  const [modelVisionSupport, setModelVisionSupport] = useState<{
    supportsVision: boolean
    model: string | null
  }>({ supportsVision: true, model: null })
  const [dragActive, setDragActive] = useState(false)
  const [contextTokens, setContextTokens] = useState<number | null>(null)
  const [contextBudget, setContextBudget] = useState<number | null>(null)
  const [inputTokens, setInputTokens] = useState<number | null>(null)
  const [outputTokens, setOutputTokens] = useState<number | null>(null)
  const [cacheReadTokens, setCacheReadTokens] = useState<number | null>(null)
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null)
  // Set when the turn finishes; freezes the elapsed-time display until
  // the next message is sent. Stays visible between turns so the user
  // can see how long the last reply took.
  const [turnEndedAt, setTurnEndedAt] = useState<number | null>(null)

  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([])
  const [timelineOpen, setTimelineOpen] = useState(false)

  const onNewChat = useCallback(() => {
    setMessages([])
    setActiveConversationId(null)
    setContextTokens(null)
    setContextBudget(null)
    setInputTokens(null)
    setOutputTokens(null)
    setCacheReadTokens(null)
    setTurnStartedAt(null)
    setTurnEndedAt(null)
  }, [
    setMessages,
    setActiveConversationId,
    setContextTokens,
    setContextBudget,
    setInputTokens,
    setOutputTokens,
    setCacheReadTokens,
    setTurnStartedAt,
    setTurnEndedAt
  ])

  const scrollerRef = useRef<HTMLDivElement>(null)
  const pendingTurnIdRef = useRef<string | null>(null)
  const conversationRef = useRef<ConversationFile | null>(null)
  const modelContextWindowRef = useRef<number | null>(null)
  // Mirror of the per-turn token/context aggregates, kept in a ref so the
  // `task.completed` timeline entry can read final totals synchronously.
  // The onTurnEvent closure is created once, so reading the token state
  // directly there would see stale (turn-start) values — the ref does not.
  const turnStatsRef = useRef<TurnStats>({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    contextTokens: 0
  })
  // Tracks the last working-folder value we communicated to the model
  // per conversation. Lets us emit a one-shot "cleared" notice on the
  // transition from set→null so the model stops referring to the old
  // folder it saw in earlier turns.
  const sentFolderByConvRef = useRef<Map<string, string[]>>(new Map())
  // Track the channel of the currently-loaded conversation. Null
  // when there's no active conversation (fresh chat). Telegram
  // conversations are read-only from the in-app chat — we hide the
  // input form and show a notice instead.
  const [activeChannel, setActiveChannel] = useState<ConversationChannel | null>(null)

  // ── Voice recording ───────────────────────────────────────────
  type RecorderPhase = 'idle' | 'recording' | 'review'
  const [recPhase, setRecPhase] = useState<RecorderPhase>('idle')
  const [recElapsed, setRecElapsed] = useState(0)
  const [recBlobUrl, setRecBlobUrl] = useState<string | null>(null)
  const [recPlaying, setRecPlaying] = useState(false)
  const [micAvailable, setMicAvailable] = useState(true)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recChunksRef = useRef<Blob[]>([])
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recAudioRef = useRef<HTMLAudioElement | null>(null)
  const recBlobRef = useRef<Blob | null>(null)

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        setMicAvailable(devices.some((d) => d.kind === 'audioinput'))
      })
      .catch(() => setMicAvailable(false))
  }, [])

  const discardRecording = useCallback(() => {
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current)
      recTimerRef.current = null
    }
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    if (recAudioRef.current) {
      recAudioRef.current.pause()
      recAudioRef.current = null
    }
    if (recBlobUrl) URL.revokeObjectURL(recBlobUrl)
    recBlobRef.current = null
    setRecBlobUrl(null)
    setRecPlaying(false)
    setRecPhase('idle')
    setRecElapsed(0)
  }, [recBlobUrl])

  const startRecording = useCallback(async () => {
    try {
      const access = await window.api.mic.checkAccess()
      if (access === 'not-determined') {
        const granted = await window.api.mic.requestAccess()
        if (!granted) {
          toast.show({ message: t('chat.voice.permissionDenied'), tone: 'error' })
          return
        }
      } else if (access === 'denied' || access === 'restricted') {
        toast.show({ message: t('chat.voice.permissionDenied'), tone: 'error' })
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      recChunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recChunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(recChunksRef.current, { type: mimeType })
        recBlobRef.current = blob
        const url = URL.createObjectURL(blob)
        setRecBlobUrl(url)
        setRecPhase('review')
      }
      recorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop())
        toast.show({ message: t('chat.voice.error'), tone: 'error' })
        discardRecording()
      }
      mediaRecorderRef.current = recorder
      recorder.start(250)
      setRecElapsed(0)
      setRecPhase('recording')
      recTimerRef.current = setInterval(() => setRecElapsed((s) => s + 1), 1000)
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? t('chat.voice.permissionDenied')
          : t('chat.voice.error')
      toast.show({ message: msg, tone: 'error' })
    }
  }, [toast, t, discardRecording])

  const stopRecording = useCallback(() => {
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current)
      recTimerRef.current = null
    }
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const togglePlayback = useCallback(() => {
    if (!recBlobUrl) return
    if (recPlaying && recAudioRef.current) {
      recAudioRef.current.pause()
      setRecPlaying(false)
      return
    }
    const audio = new Audio(recBlobUrl)
    recAudioRef.current = audio
    audio.onended = () => setRecPlaying(false)
    audio.play()
    setRecPlaying(true)
  }, [recBlobUrl, recPlaying])

  const formatRecTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current)
      if (recBlobUrl) URL.revokeObjectURL(recBlobUrl)
    }
  }, [recBlobUrl])
  // ── End voice recording ───────────────────────────────────────

  useEffect(() => {
    if (!activeConversationId) return
    let cancelled = false
    void window.api.conversation.load(activeConversationId).then((conv) => {
      if (cancelled) return
      setActiveChannel(conv?.channel ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [activeConversationId])

  // Treat the loaded channel as null whenever no conversation is
  // active. Computing this at render time (instead of clearing
  // activeChannel from inside the effect) avoids the cascading-render
  // pattern react-hooks lint flags.
  const isTelegramConversation = activeConversationId !== null && activeChannel === 'telegram'
  const isWhatsAppConversation = activeConversationId !== null && activeChannel === 'whatsapp'
  const isHeartbeatConversation = activeConversationId !== null && activeChannel === 'heartbeat'
  const isExternalChannel =
    isTelegramConversation || isWhatsAppConversation || isHeartbeatConversation

  // Re-sync model-dependent UI whenever the active model changes — the local
  // model, the local-only toggle, OR the cloud Brain (activeCloudModel). Two
  // things ride on this: vision support (only Ollama models can come back as
  // non-vision and need proactive UI gating), and the context-meter budget.
  // Pushing caps.contextWindow into contextBudget here makes the meter reflect
  // the new model's window immediately on switch — before any turn fires.
  // Without activeCloudModel in the deps the budget stayed pinned to the
  // previous model's window when switching between cloud models.
  useEffect(() => {
    let cancelled = false
    void window.api.model.capabilities().then((caps) => {
      if (cancelled) return
      setModelVisionSupport({ supportsVision: caps.supportsVision, model: caps.model })
      // caps.provider is null exactly when no model is resolved (the backend's
      // 8 000 placeholder case); a non-null provider means contextWindow is the
      // real resolved window. Null the ref otherwise so the budget consumers
      // below treat any positive window as authoritative.
      const cw = caps.provider ? caps.contextWindow : null
      modelContextWindowRef.current = cw
      if (cw && cw > 0) setContextBudget(cw)
    })
    return () => {
      cancelled = true
    }
  }, [currentModel, localOnly, activeCloudModel])

  const persistConversation = useCallback(
    async (msgs: ChatMessage[]) => {
      const convMessages = msgs
        .filter((m) => {
          if (isUser(m)) return true
          if (isAssistant(m) && m.status === 'error') return true
          if (isAssistant(m) && m.status === 'complete') return m.segments.length > 0
          return false
        })
        .map((m) => {
          if (isUser(m)) {
            return {
              role: 'user' as const,
              content: m.content,
              timestamp: Date.now(),
              ...(m.attachments && m.attachments.length > 0 ? { attachments: m.attachments } : {})
            }
          }
          const am = m as AssistantMessage
          return {
            role: 'assistant' as const,
            content: collectText(am.segments),
            segments: am.segments,
            approvals: am.approvals,
            toolTimings: am.toolTimings,
            stopReason: am.stopReason,
            ...(am.status === 'error' && am.error ? { error: am.error } : {}),
            timestamp: Date.now()
          }
        })

      if (convMessages.length === 0) return

      if (!conversationRef.current) {
        const conv = await window.api.conversation.create(currentModel)
        conversationRef.current = conv
        setActiveConversationId(conv.id)
      }

      conversationRef.current.messages = convMessages
      conversationRef.current.updatedAt = Date.now()
      conversationRef.current.contextMeter =
        contextTokens != null && contextBudget != null
          ? { contextTokens, contextBudget }
          : (conversationRef.current.contextMeter ?? null)
      conversationRef.current.timeline =
        timelineEntries.length > 0
          ? timelineEntries
          : (conversationRef.current.timeline ?? undefined)
      await window.api.conversation.save(conversationRef.current)
    },
    [currentModel, setActiveConversationId, contextTokens, contextBudget, timelineEntries]
  )

  useEffect(() => {
    if (activeConversationId) {
      // Always (re)load on id change. The previous `&& !conversationRef.current`
      // guard left a stale ref behind when switching from one conversation
      // to another without first nulling activeConversationId — newly sent
      // messages would then merge into the previous conversation's file.
      if (conversationRef.current?.id === activeConversationId) return
      const targetId = activeConversationId
      void window.api.conversation.load(targetId).then((conv) => {
        // Drop the result if the user has already switched again — the
        // newer effect run is now in flight and owns conversationRef.
        if (!conv || activeConversationId !== targetId) return
        conversationRef.current = conv
        if (conv.contextMeter) {
          setContextTokens(conv.contextMeter.contextTokens)
          const cw = modelContextWindowRef.current
          setContextBudget(cw && cw > 0 ? cw : conv.contextMeter.contextBudget)
        } else {
          setContextTokens(null)
          setContextBudget(null)
        }
        const raw = conv.workingFolder
        const folders = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
        setStoredFolders(folders)
        setFolderListOpen(false)
        sentFolderByConvRef.current.set(conv.id, folders)
        setTimelineEntries(conv.timeline ?? [])
      })
    } else {
      conversationRef.current = null
      queueMicrotask(() => setTimelineEntries([]))
    }
  }, [activeConversationId])

  const shouldPersistRef = useRef(false)

  useLayoutEffect(() => {
    if (shouldPersistRef.current) {
      shouldPersistRef.current = false
      void persistConversation(messages).catch(() => undefined)
    }
  }, [messages, persistConversation])

  const persistedErrorIdsRef = useRef(new Set<string>())
  useLayoutEffect(() => {
    const unpersisted = messages.find(
      (m): m is AssistantMessage =>
        isAssistant(m) && m.status === 'error' && !persistedErrorIdsRef.current.has(m.id)
    )
    if (unpersisted && conversationRef.current) {
      persistedErrorIdsRef.current.add(unpersisted.id)
      void persistConversation(messages).catch(() => undefined)
    }
  }, [messages, persistConversation])

  useEffect(() => {
    const offSegment = window.api.chat.onSegment((segment) => {
      if (pendingTurnIdRef.current !== segment.turnId) return
      setMessages((prev) => appendSegment(prev, segment))
      const segKind = segment.kind
      if (segKind === 'tool_call' || segKind === 'tool_result' || segKind === 'compaction') {
        const entry = buildSegmentTimelineEntry(segment)
        if (entry) {
          if (segKind === 'compaction') {
            setTimelineEntries((prev) => {
              const idx = prev.findLastIndex((e) => e.kind === 'compaction.started')
              if (idx !== -1) {
                const updated = [...prev]
                updated[idx] = { ...updated[idx], ...entry }
                return updated
              }
              return [...prev, entry]
            })
          } else {
            setTimelineEntries((prev) => [...prev, entry])
          }
        }
      }
    })
    const offDone = window.api.chat.onDone(({ turnId }) => {
      if (pendingTurnIdRef.current !== turnId) return
      pendingTurnIdRef.current = null
      setStreaming(false)
      setTurnEndedAt(Date.now())
      shouldPersistRef.current = true
      setMessages((prev) => markComplete(prev, turnId))
    })
    const offError = window.api.chat.onError(({ turnId, error }) => {
      if (pendingTurnIdRef.current !== turnId) return
      pendingTurnIdRef.current = null
      setStreaming(false)
      setTurnEndedAt(Date.now())
      shouldPersistRef.current = true
      setMessages((prev) => markError(prev, turnId, error))
    })
    const offTurnEvent = window.api.chat.onTurnEvent(({ turnId, type, payload }) => {
      if (pendingTurnIdRef.current !== turnId) return
      if (type === 'context.built') {
        // The window the backend just built this turn with is the freshest
        // reading there is — the turn resolves the local model's real context
        // length (via /api/show) before this fires. Adopt it AND refresh the
        // ref, so a capabilities fetch that happened to run while Ollama was
        // still starting (and returned the 16k fallback) can't keep pinning the
        // meter to that stale value. Previously the stale ref won here, which
        // re-asserted 16k on every turn even after the backend had recovered.
        if (typeof payload.tokenBudget === 'number' && payload.tokenBudget > 0) {
          modelContextWindowRef.current = payload.tokenBudget
          setContextBudget(payload.tokenBudget)
        }
      } else if (type === 'llm.response') {
        const uncached = typeof payload.inputTokens === 'number' ? payload.inputTokens : 0
        const cacheRead = typeof payload.cacheReadTokens === 'number' ? payload.cacheReadTokens : 0
        const cacheCreated =
          typeof payload.cacheCreationTokens === 'number' ? payload.cacheCreationTokens : 0
        const out = typeof payload.outputTokens === 'number' ? payload.outputTokens : 0
        setContextTokens(uncached + cacheRead + cacheCreated)
        if (typeof payload.inputTokens === 'number') {
          const v = payload.inputTokens
          setInputTokens((prev) => (prev ?? 0) + v)
        }
        if (typeof payload.outputTokens === 'number') {
          const v = payload.outputTokens
          setOutputTokens((prev) => (prev ?? 0) + v)
        }
        if (typeof payload.cacheReadTokens === 'number') {
          const v = payload.cacheReadTokens
          setCacheReadTokens((prev) => (prev ?? 0) + v)
        }
        // Mirror into the ref (final context size is absolute; the rest
        // accumulate) so task.completed can report end-of-turn totals.
        const stats = turnStatsRef.current
        stats.inputTokens += uncached
        stats.outputTokens += out
        stats.cacheReadTokens += cacheRead
        stats.contextTokens = uncached + cacheRead + cacheCreated
      }
      if (
        type !== 'tool.called' &&
        type !== 'tool.completed' &&
        type !== 'tool.failed' &&
        type !== 'compaction.applied'
      ) {
        const { summary: tlSummary, detail: tlDetail } = timelineEventSummary(
          type,
          payload,
          turnStatsRef.current
        )
        setTimelineEntries((prev) => [
          ...prev,
          {
            id: `te_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            timestamp: Date.now(),
            kind: type,
            ...(tlSummary ? { summary: tlSummary } : {}),
            ...(tlDetail ? { detail: tlDetail } : {})
          }
        ])
      }
    })
    const offApprovalRequest = window.api.chat.onApprovalRequest((event) => {
      if (event.turnId !== null && pendingTurnIdRef.current !== event.turnId) return
      setMessages((prev) =>
        attachApproval(prev, {
          approvalId: event.id,
          toolCallId: event.toolCallId,
          tool: event.tool,
          args: event.args,
          reason: event.reason,
          level: event.level,
          description: event.description
        })
      )
    })
    const offAskRequest = window.api.chat.onAskRequest((event) => {
      if (event.turnId !== null && pendingTurnIdRef.current !== event.turnId) return
      setMessages((prev) =>
        attachAsk(prev, {
          askId: event.id,
          toolCallId: event.toolCallId,
          question: event.question,
          details: event.details,
          options: event.options,
          allowOther: event.allowOther,
          otherLabel: event.otherLabel,
          otherDescription: event.otherDescription
        })
      )
    })
    return () => {
      offSegment()
      offDone()
      offError()
      offTurnEvent()
      offApprovalRequest()
      offAskRequest()
    }
  }, [setMessages])

  // The feed pins to the end like a logs tail purely via CSS: the scroller is
  // `flex flex-col-reverse`, so its scroll origin sits at the bottom (newest).
  // Opening a conversation lands at the true end with no flash, and the view
  // stays pinned as async children (file viewers, images, code highlighting)
  // settle — no measure-and-jump that could park mid-feed, and a user who
  // scrolls up to read history is never yanked down. The only case CSS can't
  // cover is sending while scrolled up: force the newest into view so the user
  // always sees their own message and the reply.
  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current
    if (el) el.scrollTop = 0
  }, [])

  const respondApproval = useCallback(
    async (approvalId: string, decision: 'approved' | 'denied') => {
      setMessages((prev) =>
        prev.map((m) => {
          if (!isAssistant(m) || !m.approvals) return m
          let changed = false
          const next: Record<string, ApprovalCardState> = {}
          for (const [key, approval] of Object.entries(m.approvals)) {
            if (approval.approvalId === approvalId) {
              next[key] = { ...approval, decision }
              changed = true
            } else {
              next[key] = approval
            }
          }
          return changed ? { ...m, approvals: next } : m
        })
      )
      await window.api.chat.respondApproval({ id: approvalId, decision })
    },
    [setMessages]
  )

  const respondAsk = useCallback(
    async (askId: string, response: AskUserResponse) => {
      // Optimistically mark the card answered so the chosen option highlights
      // the instant it's clicked — the tool_result lands a beat later.
      setMessages((prev) =>
        prev.map((m) => {
          if (!isAssistant(m) || !m.asks) return m
          let changed = false
          const next: Record<string, AskCardState> = {}
          for (const [key, ask] of Object.entries(m.asks)) {
            if (ask.askId === askId) {
              next[key] = {
                ...ask,
                answered: true,
                selectedIndex: response.kind === 'option' ? response.index : undefined,
                customText: response.kind === 'custom' ? response.text : undefined
              }
              changed = true
            } else {
              next[key] = ask
            }
          }
          return changed ? { ...m, asks: next } : m
        })
      )
      await window.api.chat.respondAsk({ id: askId, response })
    },
    [setMessages]
  )

  /**
   * Resolve (or reserve) a conversation id without sending. Used by the
   * upload picker too — files need a destination folder before the user
   * has written any text.
   */
  const ensureConversationId = useCallback(async (): Promise<string> => {
    if (activeConversationId) {
      if (!conversationRef.current || conversationRef.current.id !== activeConversationId) {
        const loaded = await window.api.conversation.load(activeConversationId)
        if (loaded) {
          conversationRef.current = loaded
        } else {
          const now = Date.now()
          conversationRef.current = {
            id: activeConversationId,
            title: 'Untitled',
            model: currentModel,
            messages: [],
            createdAt: now,
            updatedAt: now
          }
        }
      }
      return activeConversationId
    }
    const conv = await window.api.conversation.create(currentModel)
    conversationRef.current = conv
    setActiveConversationId(conv.id)
    return conv.id
  }, [activeConversationId, currentModel, setActiveConversationId])

  const sendContent = useCallback(
    async (content: string, attachments: MessageAttachment[] = []) => {
      const trimmed = content.trim()
      // Allow attachment-only messages: a file with no caption is still a
      // valid send. We require at least one of the two so a stray Enter
      // on an empty input doesn't fire.
      if (!trimmed && attachments.length === 0) return
      if (streaming) return

      const conversationId = await ensureConversationId()

      const userMessage: ChatMessage = {
        id: cryptoId(),
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
        ...(attachments.length > 0 ? { attachments } : {})
      }
      const assistantPlaceholder: AssistantMessage = {
        id: cryptoId(),
        role: 'assistant',
        segments: [],
        status: 'streaming',
        timestamp: Date.now()
      }
      // Prepend an attachment summary so the LLM knows what files came
      // along with this turn even though it can't read them. Tools like
      // stt_transcribe_upload can then pick up the file from this hint.
      const workspaceRoot = status?.rootPath ?? null
      const previousFolders = sentFolderByConvRef.current.get(conversationId) ?? []
      const folderListings =
        workingFolders.length > 0 ? await fetchFolderListings(workingFolders) : undefined
      const historyContent = composeHistoryContent(
        trimmed,
        attachments,
        workspaceRoot,
        workingFolders,
        previousFolders,
        folderListings
      )
      sentFolderByConvRef.current.set(conversationId, workingFolders)
      const currentEntry: {
        role: 'user'
        content: string
        attachments?: MessageAttachment[]
      } = { role: 'user', content: historyContent }
      if (attachments.length > 0) currentEntry.attachments = attachments
      const history = textHistory(messages, workspaceRoot).concat(currentEntry)

      setMessages((prev) => [...prev, userMessage, assistantPlaceholder])
      scrollToBottom()
      setStreaming(true)
      setTurnStartedAt(Date.now())
      setTurnEndedAt(null)
      setInputTokens(0)
      setOutputTokens(0)
      setCacheReadTokens(0)
      turnStatsRef.current = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        contextTokens: 0
      }
      setTimelineEntries([])
      setTimelineOpen(false)

      const response = await window.api.chat.send({
        history,
        conversationId,
        thinkingMode: thinkingMode as import('@preload/index').ThinkingMode
      })
      pendingTurnIdRef.current = response.turnId
      if (!response.ok && response.error) {
        pendingTurnIdRef.current = null
        setStreaming(false)
        setTurnEndedAt(Date.now())
        shouldPersistRef.current = true
        setMessages((prev) => markError(prev, response.turnId, response.error ?? 'unknown error'))
      }
    },
    [
      streaming,
      messages,
      setMessages,
      ensureConversationId,
      status?.rootPath,
      workingFolders,
      thinkingMode,
      scrollToBottom
    ]
  )

  const send = useCallback(async () => {
    const trimmed = draft.trim()
    if (!trimmed && pendingAttachments.length === 0) return
    const atts = pendingAttachments
    setDraft('')
    setPendingAttachments([])
    await sendContent(trimmed, atts)
  }, [draft, pendingAttachments, sendContent])

  const sendRecording = useCallback(async () => {
    const blob = recBlobRef.current
    if (!blob) return
    if (streaming) return
    const blobUrl = recBlobUrl
    if (recAudioRef.current) {
      recAudioRef.current.pause()
      recAudioRef.current = null
    }
    setRecPhase('idle')
    setRecPlaying(false)
    setRecElapsed(0)

    try {
      const conversationId = await ensureConversationId()
      const buffer = await blob.arrayBuffer()
      const fileName = `recording-${Date.now()}.webm`
      const meta = await window.api.upload.saveBuffer({ conversationId, buffer, fileName })
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      setRecBlobUrl(null)
      recBlobRef.current = null
      const attachment: MessageAttachment = {
        type: meta.type,
        filePath: meta.filePath,
        originalName: meta.originalName,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes
      }

      // Render the audio in chat immediately with a transcribing
      // placeholder, BEFORE running STT — so the player shows up the
      // instant the user clicks send, and the transcript fills in
      // when whisper returns.
      const userMsgId = cryptoId()
      const userTs = Date.now()
      setMessages((prev) => [
        ...prev,
        {
          id: userMsgId,
          role: 'user',
          content: '',
          attachments: [attachment],
          transcribing: true,
          timestamp: userTs
        }
      ])

      const sttResult = await window.api.stt.transcribe({
        filePath: meta.filePath,
        conversationId
      })

      if (!sttResult.ok) {
        toast.show({ message: sttResult.error, tone: 'error' })
        setMessages((prev) =>
          prev.map((m) => (m.id === userMsgId ? { ...m, content: '', transcribing: false } : m))
        )
        return
      }

      const transcript = sttResult.transcript
      setMessages((prev) =>
        prev.map((m) =>
          m.id === userMsgId ? { ...m, content: transcript, transcribing: false } : m
        )
      )

      // Now trigger the LLM — mirrors sendContent's tail. We use the
      // raw transcript (no 🎙 prefix) for the model-facing history so
      // the agent doesn't echo our UI marker back. The <voice_note lang="…">
      // tag carries Whisper's detected language so the model replies in it
      // instead of guessing from a short transcript.
      const workspaceRoot = status?.rootPath ?? null
      const previousFolders = sentFolderByConvRef.current.get(conversationId) ?? []
      const langAttr = sttResult.language ? ` lang="${sttResult.language}"` : ''
      const folderListings =
        workingFolders.length > 0 ? await fetchFolderListings(workingFolders) : undefined
      const historyContent = `<voice_note${langAttr}>\n${composeHistoryContent(
        transcript,
        [attachment],
        workspaceRoot,
        workingFolders,
        previousFolders,
        folderListings
      )}`
      sentFolderByConvRef.current.set(conversationId, workingFolders)
      const currentEntry: {
        role: 'user'
        content: string
        attachments?: MessageAttachment[]
      } = { role: 'user', content: historyContent, attachments: [attachment] }
      const history = textHistory(messages, workspaceRoot).concat(currentEntry)

      const assistantPlaceholder: AssistantMessage = {
        id: cryptoId(),
        role: 'assistant',
        segments: [],
        status: 'streaming',
        timestamp: Date.now()
      }
      setMessages((prev) => [...prev, assistantPlaceholder])
      scrollToBottom()
      setStreaming(true)
      setTurnStartedAt(Date.now())
      setTurnEndedAt(null)
      setInputTokens(0)
      setOutputTokens(0)
      setCacheReadTokens(0)
      turnStatsRef.current = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        contextTokens: 0
      }
      setTimelineEntries([])
      setTimelineOpen(false)

      const response = await window.api.chat.send({
        history,
        conversationId,
        thinkingMode: thinkingMode as import('@preload/index').ThinkingMode
      })
      pendingTurnIdRef.current = response.turnId
      if (!response.ok && response.error) {
        pendingTurnIdRef.current = null
        setStreaming(false)
        setTurnEndedAt(Date.now())
        shouldPersistRef.current = true
        setMessages((prev) => markError(prev, response.turnId, response.error ?? 'unknown error'))
      }
    } catch {
      toast.show({ message: t('chat.voice.error'), tone: 'error' })
    }
  }, [
    recBlobUrl,
    ensureConversationId,
    toast,
    t,
    streaming,
    messages,
    setMessages,
    status,
    workingFolders,
    thinkingMode,
    scrollToBottom
  ])

  const stop = useCallback(() => {
    void window.api.chat.cancel()
  }, [])

  /**
   * Save each source (filesystem path or in-memory File) into the active
   * conversation's uploads folder, gathering metadata to stage as
   * pendingAttachments. Validates each file individually against
   * size/count/type limits — invalid files get a toast error, valid ones
   * are staged. Files dropped from the OS or pasted from clipboard arrive
   * as File objects: paths come via webUtils.getPathForFile when the file
   * lives on disk, otherwise we read the buffer (e.g. clipboard images).
   */
  const stageSources = useCallback(
    async (sources: Array<{ kind: 'path'; path: string } | { kind: 'file'; file: File }>) => {
      if (sources.length === 0) return
      const conversationId = await ensureConversationId()
      const next: MessageAttachment[] = []
      let currentCount = pendingAttachments.length
      let currentTotalBytes = pendingAttachments.reduce((s, a) => s + a.sizeBytes, 0)

      for (const source of sources) {
        try {
          let meta: MessageAttachment
          if (source.kind === 'path') {
            meta = await window.api.upload.saveFile({ conversationId, sourcePath: source.path })
          } else {
            const buffer = await source.file.arrayBuffer()
            const fileName = pastedFileName(source.file)
            meta = await window.api.upload.saveBuffer({ conversationId, buffer, fileName })
          }
          if (meta.type === 'image' && !modelVisionSupport.supportsVision) {
            const msg = validationErrorMessage(
              { code: 'vision_not_supported', model: modelVisionSupport.model ?? 'current model' },
              t
            )
            toast.show({ message: msg, tone: 'error' })
            continue
          }
          const error = await window.api.upload.validate({
            fileName: meta.originalName,
            sizeBytes: meta.sizeBytes,
            currentCount,
            currentTotalBytes
          })
          if (error) {
            const msg = validationErrorMessage(error, t)
            toast.show({ message: msg, tone: 'error' })
            continue
          }
          next.push(meta)
          currentCount++
          currentTotalBytes += meta.sizeBytes
        } catch {
          // skip this file — multi-file batches shouldn't fail-fast
        }
      }
      if (next.length > 0) {
        setPendingAttachments((prev) => [...prev, ...next])
      }
    },
    [ensureConversationId, pendingAttachments, toast, t, modelVisionSupport]
  )

  const stageFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      const sources = files.map((file) => {
        let path = ''
        try {
          path = window.api.upload.getPathForFile(file)
        } catch {
          path = ''
        }
        return path.length > 0
          ? ({ kind: 'path', path } as const)
          : ({ kind: 'file', file } as const)
      })
      await stageSources(sources)
    },
    [stageSources]
  )

  const pickUploads = useCallback(async () => {
    if (streaming) return
    const paths = await window.api.upload.pickFile()
    await stageSources(paths.map((path) => ({ kind: 'path', path }) as const))
  }, [streaming, stageSources])

  const removePending = useCallback((filePath: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.filePath !== filePath))
  }, [])

  const persistWorkingFolders = useCallback(
    async (folders: string[]) => {
      await ensureConversationId()
      const conv = conversationRef.current
      if (!conv) return
      conv.workingFolder = folders.length > 0 ? folders : null
      await window.api.conversation.save(conv)
    },
    [ensureConversationId]
  )

  const addWorkingFolder = useCallback(async () => {
    if (streaming) return
    const folder = await window.api.upload.pickFolder()
    if (!folder || storedFolders.includes(folder)) return
    const updated = [...storedFolders, folder]
    setStoredFolders(updated)
    await persistWorkingFolders(updated)
  }, [streaming, storedFolders, persistWorkingFolders])

  const removeWorkingFolder = useCallback(
    async (path: string) => {
      const updated = storedFolders.filter((f) => f !== path)
      setStoredFolders(updated)
      const conv = conversationRef.current
      if (!conv) return
      conv.workingFolder = updated.length > 0 ? updated : null
      await window.api.conversation.save(conv)
    },
    [storedFolders]
  )

  const handleDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (streaming) return
      if (!hasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      setDragActive(true)
    },
    [streaming]
  )

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    // The dragleave fires on every child boundary; only clear the flag
    // when we leave the chat container itself (relatedTarget outside).
    const related = e.relatedTarget as Node | null
    if (related && (e.currentTarget as Node).contains(related)) return
    setDragActive(false)
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (streaming) return
      if (!hasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
    },
    [streaming]
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setDragActive(false)
      if (streaming) return
      const files = Array.from(e.dataTransfer.files ?? [])
      if (files.length === 0) return
      await stageFiles(files)
    },
    [streaming, stageFiles]
  )

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLElement>) => {
      if (streaming) return
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length === 0) return
      // Intercept clipboard files so they don't end up as binary noise
      // pasted into the textarea. Plain text paste keeps default behavior.
      e.preventDefault()
      await stageFiles(files)
    },
    [streaming, stageFiles]
  )

  const hasMessages = messages.length > 0
  const placeholderAlign = useMemo(() => (isRtl ? 'text-right' : 'text-left'), [isRtl])

  if (reindexActive) return <ReindexActiveOverlay />

  return (
    <main
      className={cn('bg-bg relative flex h-full w-full flex-col', pageTopPadding)}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      {dragActive && (
        <div
          aria-hidden
          className={cn(
            'bg-bg/80 pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 backdrop-blur',
            'text-fg text-sm font-medium'
          )}
        >
          <CloudUploadIcon size={40} className="text-accent" />
          {t('chat.dropToAttach')}
        </div>
      )}
      <Sidebar
        items={[
          {
            key: 'soul',
            icon: SparklesIcon,
            label: t('chat.soul'),
            onClick: () => goTo('soul'),
            disabled: streaming
          },
          {
            key: 'user',
            icon: UserIcon,
            label: t('chat.user'),
            onClick: () => goTo('user'),
            disabled: streaming
          },
          {
            key: 'agents',
            icon: Robot01Icon,
            label: t('chat.agents'),
            onClick: () => goTo('agents'),
            disabled: streaming
          },
          {
            key: 'heartbeat',
            icon: HeartCheckIcon,
            label: t('chat.heartbeat'),
            onClick: () => goTo('heartbeat'),
            disabled: streaming
          },
          {
            key: 'viewer',
            icon: FileEditIcon,
            label: t('chat.workspace'),
            onClick: () => goTo('viewer'),
            disabled: streaming
          },
          {
            key: 'history',
            icon: Clock01Icon,
            label: t('chat.history'),
            onClick: () => goTo('history'),
            disabled: streaming
          },
          {
            key: 'settings',
            icon: Settings02Icon,
            label: t('chat.settings'),
            onClick: () => goTo('settings'),
            disabled: streaming
          }
        ]}
      />

      <div
        ref={scrollerRef}
        className="relative flex flex-1 flex-col-reverse overflow-y-auto px-6 py-8"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-6 pt-2">
          <div className="pointer-events-auto">
            <UpdateCard />
          </div>
        </div>
        <div
          className={cn(
            // `w-full` is essential: as a flex item of the column-reverse
            // scroller, `mx-auto` alone would shrink this wrapper to its
            // content width (collapsing the column and centering bubbles).
            // w-full + max-w-3xl + mx-auto restores the normal centered column.
            'mx-auto flex w-full max-w-3xl flex-col gap-4',
            // Empty state centers the welcome; otherwise the conversation
            // bottom-pins via the column-reverse scroller — the newest message
            // is glued to the bottom from the first frame, so opening a
            // conversation never flashes the top before snapping to the end.
            !hasMessages && 'h-full justify-center'
          )}
        >
          {!hasMessages && (
            <div className="text-fg flex flex-col items-center gap-4 text-center">
              <img
                src={iconTransparent}
                alt=""
                aria-hidden
                className="h-20 w-20 object-contain"
                draggable={false}
              />
              <div className="flex flex-col gap-2">
                <h2 className="text-2xl font-semibold tracking-tight">{t('chat.empty.title')}</h2>
                <p className="text-muted text-sm leading-relaxed">{t('chat.empty.subtitle')}</p>
              </div>
              {!hasAnyModel && (
                <div
                  className={cn(
                    'border-border bg-surface text-muted',
                    'mt-2 flex w-full max-w-sm items-center gap-2.5 rounded-xl border px-4 py-3 text-xs leading-relaxed'
                  )}
                >
                  <Settings02Icon size={14} className="shrink-0" aria-hidden />
                  <p className="flex-1">
                    {t('chat.noModel.notice')}
                    <br />
                    <button
                      type="button"
                      onClick={() => {
                        preselectSettingsTab('brain')
                        goTo('settings')
                      }}
                      className="text-primary hover:underline cursor-pointer font-medium"
                    >
                      {t('chat.noModel.settingsLink')}
                    </button>
                  </p>
                </div>
              )}
            </div>
          )}
          <InAppVerboseContext.Provider value={inAppVerbose}>
            {messages.map((m) => (
              <ChatItem
                key={m.id}
                message={m}
                t={t}
                awaitingApproval={awaitingApproval}
                awaitingAsk={awaitingAsk}
                onApprovalDecision={respondApproval}
                onAskRespond={respondAsk}
              />
            ))}
          </InAppVerboseContext.Provider>
          {hasMessages && !hasAnyModel && (
            <div
              className={cn(
                'border-border bg-surface text-muted',
                'flex items-center gap-2.5 rounded-xl border px-4 py-3 text-xs leading-relaxed self-start'
              )}
            >
              <Settings02Icon size={14} className="shrink-0" aria-hidden />
              <p className="flex-1">
                {t('chat.noModel.notice')}
                <br />
                <button
                  type="button"
                  onClick={() => {
                    preselectSettingsTab('brain')
                    goTo('settings')
                  }}
                  className="text-primary hover:underline cursor-pointer font-medium"
                >
                  {t('chat.noModel.settingsLink')}
                </button>
              </p>
            </div>
          )}
        </div>
      </div>

      {isExternalChannel ? (
        <div className="border-border/60 bg-bg/80 border-t p-4 backdrop-blur">
          <div className="bg-surface border-border mx-auto flex max-w-2xl items-center gap-2.5 rounded-xl border px-4 py-3">
            {isHeartbeatConversation ? (
              <Activity04Icon size={16} className="text-muted shrink-0" aria-hidden />
            ) : isTelegramConversation ? (
              <TelegramLogo size={16} className="text-muted shrink-0" aria-hidden />
            ) : (
              <WhatsAppLogo size={16} className="text-muted shrink-0" aria-hidden />
            )}
            <span className="text-muted flex-1 truncate text-sm cursor-default">
              {t(
                isHeartbeatConversation
                  ? 'chat.heartbeatReadOnly'
                  : isTelegramConversation
                    ? 'chat.telegramReadOnly'
                    : 'chat.whatsappReadOnly'
              )}
            </span>
            <button
              type="button"
              onClick={onNewChat}
              title={t('chat.newChat')}
              aria-label={t('chat.newChat')}
              className={cn(
                'border-border text-muted hover:text-fg flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs',
                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
              )}
            >
              <PlusSignIcon size={12} />
              <span>{t('chat.newChat')}</span>
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (streaming) stop()
            else void send()
          }}
          className={cn(
            'bg-bg/80 relative z-40 p-4 backdrop-blur',
            !streaming && 'border-t border-border/60'
          )}
        >
          {streaming && <div className="rainbow-border" />}
          {pendingAttachments.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-full px-4 pb-2">
              <div className="pointer-events-auto mx-auto flex max-w-xl flex-wrap gap-2">
                {pendingAttachments.map((att) => (
                  <PendingAttachmentChip
                    key={att.filePath}
                    attachment={att}
                    onRemove={() => removePending(att.filePath)}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="relative mx-auto flex max-w-xl items-end gap-2">
            <div className="pointer-events-auto absolute inset-e-full top-1/2 me-6 -translate-y-1/2 flex items-center gap-2 whitespace-nowrap">
              {timelineEntries.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTimelineOpen(true)}
                  className={cn(
                    'border-border bg-surface text-muted hover:text-fg absolute bottom-full mb-6 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs shadow-sm',
                    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
                  )}
                >
                  <span className="bg-bg border-border text-fg inline-flex h-4 min-w-4 items-center justify-center rounded-full border px-1 text-[10px] font-semibold tabular-nums">
                    {timelineEntries.length}
                  </span>
                  {t('chat.timeline.viewLogs')}
                </button>
              )}
              <div className="border-border bg-surface inline-flex items-center rounded-lg border p-0.5">
                <button
                  type="button"
                  onClick={onNewChat}
                  disabled={streaming}
                  title={t('chat.newChat')}
                  aria-label={t('chat.newChat')}
                  className={cn(
                    'flex w-14 flex-col items-center gap-0.5 rounded-md px-1.5 py-1',
                    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                    'text-muted',
                    !streaming && 'cursor-pointer hover:text-fg',
                    streaming && 'cursor-not-allowed opacity-60'
                  )}
                >
                  <PlusSignIcon size={14} />
                  <span className="text-[10px] leading-tight font-medium">
                    {t('chat.newChatShort')}
                  </span>
                </button>
              </div>
              <ModeToggle
                value={localOnly}
                onChange={onModeChange}
                disabled={savingMode || streaming}
                activeCloudProvider={activeCloudProvider}
                cloudModel={activeCloudModel}
                localModel={currentModel}
                isOrchestrator={orchestratorMode === 'orchestrator'}
                worker={workerSel}
              />
            </div>
            <button
              type="button"
              onClick={pickUploads}
              disabled={streaming}
              title={
                modelVisionSupport.supportsVision
                  ? t('chat.attachFile')
                  : t('chat.upload.visionNotSupported', {
                      model: modelVisionSupport.model ?? 'current model'
                    })
              }
              aria-label={t('chat.attachFile')}
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border',
                'border-border bg-surface text-muted hover:text-fg hover:border-muted',
                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                'disabled:cursor-not-allowed disabled:opacity-50',
                !streaming && 'cursor-pointer'
              )}
            >
              <Image02Icon size={18} />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={
                  workingFolders.length > 0 ? () => setFolderListOpen((p) => !p) : addWorkingFolder
                }
                disabled={streaming}
                title={workingFolders.length > 0 ? t('chat.workingFolder') : t('chat.selectFolder')}
                aria-label={
                  workingFolders.length > 0 ? t('chat.workingFolder') : t('chat.selectFolder')
                }
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  !streaming && 'cursor-pointer',
                  workingFolders.length > 0
                    ? 'border-primary/40 bg-primary/10 text-primary hover:border-primary/60'
                    : 'border-border bg-surface text-muted hover:text-fg hover:border-muted'
                )}
              >
                <Folder01Icon size={18} />
              </button>
              {folderListOpen && workingFolders.length > 0 && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setFolderListOpen(false)} />
                  <div className="border-border bg-surface text-fg absolute bottom-full inset-s-0 z-20 mb-2 rounded-lg border px-2 py-2 text-xs shadow-md min-w-[200px] max-w-[280px]">
                    <div className="text-muted mb-1.5 text-[10px] font-medium uppercase tracking-wide whitespace-nowrap">
                      {t('chat.workingFolder')}
                    </div>
                    <div dir="ltr" className="space-y-1.5">
                      {workingFolders.map((folder) => (
                        <div key={folder} className="space-y-0.5">
                          <div className="truncate text-xs" title={folder}>
                            {folder.split('/').pop()}
                          </div>
                          <div className="flex items-center gap-1">
                            <code
                              className="border-border bg-bg text-muted block min-w-0 flex-1 truncate rounded border px-1 py-0.5 font-mono text-[9px]"
                              title={folder}
                            >
                              {folder}
                            </code>
                            <button
                              type="button"
                              onClick={() => void removeWorkingFolder(folder)}
                              className="text-muted/40 hover:text-red-500 shrink-0 cursor-pointer"
                              title="Remove"
                            >
                              <Delete02Icon size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={addWorkingFolder}
                      disabled={streaming}
                      className="text-muted hover:text-fg mt-1.5 flex w-full cursor-pointer items-center gap-1 text-[10px]"
                    >
                      <PlusSignIcon size={10} />
                      {t('chat.addMore')}
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={recPhase === 'idle' ? () => void startRecording() : undefined}
              disabled={streaming || !micAvailable || recPhase !== 'idle'}
              title={!micAvailable ? t('chat.voice.noMic') : t('chat.voice.record')}
              aria-label={t('chat.voice.record')}
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border',
                'border-border bg-surface text-muted hover:text-fg hover:border-muted',
                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                'disabled:cursor-not-allowed disabled:opacity-50',
                !streaming && micAvailable && recPhase === 'idle' && 'cursor-pointer'
              )}
            >
              <Mic01Icon size={18} />
            </button>
            {recPhase === 'idle' ? (
              <>
                <div className="relative flex min-w-0 flex-1 flex-col">
                  <textarea
                    ref={textareaRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onContextMenu={onTextareaContextMenu}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        if (!streaming) void send()
                      }
                    }}
                    rows={1}
                    placeholder={t('chat.placeholder')}
                    dir={isRtl ? 'rtl' : 'ltr'}
                    disabled={streaming}
                    className={cn(
                      'bg-surface text-fg border-border placeholder:text-muted hover:border-muted',
                      'min-h-10 max-h-40 w-full resize-none rounded-lg border px-3 py-2 text-sm',
                      'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      placeholderAlign
                    )}
                  />
                  <button
                    type="button"
                    disabled={streaming}
                    onClick={() => setDraftExpanded(true)}
                    className={cn(
                      'text-muted hover:text-fg absolute inset-e-2 top-1/2 z-10 -translate-y-1/2 opacity-50 hover:opacity-100',
                      'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-muted',
                      !streaming && 'cursor-pointer'
                    )}
                  >
                    <ArrowExpandIcon size={14} />
                  </button>
                </div>
                <BrainButton
                  modes={reasoningModes}
                  value={thinkingMode}
                  onCycle={setThinkingMode}
                  disabled={savingMode || streaming}
                />
                <button
                  type="submit"
                  disabled={
                    !hasAnyModel ||
                    (!streaming && draft.trim().length === 0 && pendingAttachments.length === 0)
                  }
                  aria-label={streaming ? t('chat.stop') : t('chat.send')}
                  className={cn(
                    'flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg',
                    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    streaming
                      ? 'bg-border text-fg hover:brightness-95'
                      : 'bg-primary text-primary-fg hover:brightness-110'
                  )}
                >
                  {streaming ? <StopCircleIcon size={18} /> : <ArrowUp02Icon size={18} />}
                </button>
                {showAnalytics && (
                  <ContextMeter
                    used={contextTokens ?? 0}
                    budget={contextBudget ?? 0}
                    locale={locale}
                  />
                )}
              </>
            ) : recPhase === 'recording' ? (
              <div className="bg-surface border-border flex min-h-10 flex-1 items-center gap-3 rounded-lg border px-3">
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
                <span className="text-fg tabular-nums text-sm font-medium">
                  {formatRecTime(recElapsed)}
                </span>
                <span className="text-muted flex-1 text-xs">{t('chat.voice.recording')}</span>
                <button
                  type="button"
                  onClick={stopRecording}
                  className="bg-border text-fg flex h-7 w-7 items-center justify-center rounded-md hover:brightness-95"
                  aria-label={t('chat.stop')}
                >
                  <StopCircleIcon size={14} />
                </button>
              </div>
            ) : (
              <div className="bg-surface border-border flex min-h-10 flex-1 items-center gap-2 rounded-lg border px-3">
                <button
                  type="button"
                  onClick={togglePlayback}
                  className="text-muted hover:text-fg flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                  aria-label={recPlaying ? t('chat.stop') : 'Play'}
                >
                  {recPlaying ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
                </button>
                <span className="text-fg tabular-nums text-sm font-medium">
                  {formatRecTime(recElapsed)}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={discardRecording}
                  className="text-muted hover:text-fg flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                  aria-label={t('chat.voice.delete')}
                  title={t('chat.voice.delete')}
                >
                  <Delete02Icon size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => void sendRecording()}
                  className="bg-primary text-primary-fg flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:brightness-110"
                  aria-label={t('chat.voice.send')}
                  title={t('chat.voice.send')}
                >
                  <ArrowUp02Icon size={14} />
                </button>
              </div>
            )}
            {showAnalytics && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-s-full top-1/2 ms-6 -translate-y-1/2 whitespace-nowrap"
              >
                <StatusBar
                  inputTokens={inputTokens}
                  outputTokens={outputTokens}
                  cacheReadTokens={cacheReadTokens}
                  turnStartedAt={turnStartedAt}
                  turnEndedAt={turnEndedAt}
                  locale={locale}
                />
              </div>
            )}
          </div>
        </form>
      )}
      {textareaMenu}
      {editorMenu}
      {draftExpanded &&
        createPortal(
          <div
            role="presentation"
            onClick={() => setDraftExpanded(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              onContextMenu={onEditorContextMenu}
              className="border-border bg-surface flex h-[80vh] w-[80vw] flex-col overflow-hidden rounded-2xl border shadow-xl"
            >
              <CodeEditor
                value={draft}
                language="markdown"
                isDark={isDark}
                onChange={setDraft}
                className="flex-1 overflow-auto"
                placeholder={t('chat.placeholder')}
              />
            </div>
          </div>,
          document.body
        )}
      {timelineOpen &&
        createPortal(
          <div
            role="presentation"
            onClick={() => setTimelineOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="border-border bg-surface flex h-[80vh] w-[80vw] flex-col overflow-hidden rounded-2xl border shadow-xl"
            >
              <div className="border-border flex shrink-0 items-center justify-between border-b px-5 py-3">
                <h2 className="text-fg min-w-0 flex-1 truncate text-sm font-semibold">
                  {messages.find((m) => m.role === 'user')?.content || t('chat.timeline.title')}
                </h2>
                <span className="text-muted ms-3 shrink-0 text-[10px] tabular-nums">
                  {t('chat.timeline.eventCount', { count: timelineEntries.length })}
                </span>
              </div>
              <TimelineList entries={timelineEntries} locale={locale} />
            </div>
          </div>,
          document.body
        )}
    </main>
  )
}

function relativeTime(ts: number, locale: string): string {
  const diff = Date.now() - ts
  const s = Math.floor(diff / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)

  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    if (d > 0) return rtf.format(-d, 'day')
    if (h > 0) return rtf.format(-h, 'hour')
    if (m > 0) return rtf.format(-m, 'minute')
    if (s < 5) return rtf.format(0, 'second') // "now" / "الآن"
    return rtf.format(-s, 'second')
  } catch {
    if (d > 0) return `${d}d ago`
    if (h > 0) return `${h}h ago`
    if (m > 0) return `${m}m ago`
    if (s < 5) return 'just now'
    return `${s}s ago`
  }
}

const TIMELINE_KIND_COLOR: Record<string, string> = {
  'context.built': 'bg-sky-500',
  'llm.response': 'bg-indigo-500',
  'tool.called': 'bg-blue-500',
  'tool.completed': 'bg-emerald-500',
  'tool.failed': 'bg-red-500',
  'safety.allowed': 'bg-emerald-500',
  'safety.blocked': 'bg-red-500',
  'safety.approved': 'bg-emerald-500',
  'safety.denied': 'bg-amber-500',
  'compaction.started': 'bg-blue-500',
  'compaction.applied': 'bg-violet-500',
  'task.created': 'bg-sky-500',
  'task.stepCompleted': 'bg-emerald-500',
  'task.completed': 'bg-emerald-500',
  'task.failed': 'bg-red-500',
  'task.stopped': 'bg-amber-500',
  'segment.tool_call': 'bg-blue-500',
  'segment.tool_result': 'bg-violet-500',
  'segment.compaction': 'bg-violet-500'
}

function CompactionStartedCard({
  messagesCount,
  targetsCount,
  tokenCount,
  tokenBudget,
  startedAt
}: {
  messagesCount: number
  targetsCount: number
  tokenCount: number
  tokenBudget: number
  startedAt: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [])
  const elapsedMs = now - startedAt
  return (
    <div className="border-border bg-surface w-full max-w-[85%] self-start rounded-2xl border px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 animate-pulse dark:text-blue-400">
          {t('chat.compactionCard.title')}
        </span>
        <span className="text-muted shrink-0 text-xs tabular-nums">
          {formatCompactionElapsed(elapsedMs)}
        </span>
      </div>
      <p className="text-muted mt-1 text-xs">
        {t('chat.compactionCard.compacting', {
          targets: targetsCount,
          messages: messagesCount,
          current: fmtNum(tokenCount),
          limit: fmtNum(tokenBudget)
        })}
      </p>
    </div>
  )
}

function formatCompactionElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const totalSeconds = ms / 1000
  if (totalSeconds < 60) return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${minutes}m ${seconds}s`
}

function fmtNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// Per-turn aggregates mirrored from the live token state (see turnStatsRef)
// so terminal timeline entries can report end-of-turn totals.
type TurnStats = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  contextTokens: number
}

// Render a millisecond duration in the largest sensible unit. Raw ms is only
// useful sub-second; past that, seconds/minutes/hours read far better in the
// logs (108679ms → "1m 49s").
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min < 60) return sec === 0 ? `${min}m` : `${min}m ${sec}s`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return remMin === 0 ? `${hr}h` : `${hr}h ${remMin}m`
}

function TimelineList({
  entries,
  locale
}: {
  entries: TimelineEntry[]
  locale: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const endRef = useRef<HTMLDivElement>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length])

  if (entries.length === 0) {
    return (
      <div className="text-muted/50 flex items-center justify-center py-8 text-xs">
        {t('heartbeat.overlay.waiting')}
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-3">
      <div className="flex flex-col gap-1">
        {entries.map((entry, i) => {
          const isLast = i === entries.length - 1
          const color = TIMELINE_KIND_COLOR[entry.kind] ?? 'bg-muted/40'
          const label = t(`chat.timeline.event.${entry.kind}`, { defaultValue: entry.kind })
          const timeStr = relativeTime(entry.timestamp, locale)
          const content =
            entry.summary || entry.detail
              ? [entry.summary, entry.detail].filter(Boolean).join('\n')
              : null
          return (
            <div
              key={entry.id}
              className={cn(
                'rounded-lg px-3 py-2 text-xs',
                isLast ? 'text-fg bg-accent/5' : 'text-muted/70'
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[9px] font-semibold tabular-nums',
                    isLast ? `${color} text-white` : 'bg-muted/15 text-muted/50',
                    entry.kind === 'compaction.started' && 'animate-pulse'
                  )}
                >
                  {i + 1}
                </span>
                <span className="font-semibold">{label}</span>
                {entry.kind === 'compaction.started' && (
                  <span className="text-blue-500 animate-pulse text-[10px]">●</span>
                )}
                <span className="flex-1" />
                <span className="text-muted/40 shrink-0 text-[10px] tabular-nums">{timeStr}</span>
              </div>
              {content && (
                <div className="group/tl relative mt-1.5 ms-4">
                  <pre
                    dir="ltr"
                    className={cn(
                      'overflow-x-auto rounded-md border px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word',
                      isLast
                        ? 'bg-bg border-border text-fg/80'
                        : 'bg-bg/50 border-border/50 text-muted/50'
                    )}
                  >
                    {content}
                  </pre>
                  <div className="absolute right-1.5 top-1.5 opacity-0 group-hover/tl:opacity-100">
                    <CopyButton text={content} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
        <div ref={endRef} />
      </div>
    </div>
  )
}

function buildSegmentTimelineEntry(segment: Segment): TimelineEntry | null {
  const segKind = segment.kind
  const ts = Date.now()
  if (segKind === 'tool_call') {
    const args = segment.args
    const action =
      typeof args.command === 'string'
        ? args.command
        : typeof args.path === 'string'
          ? args.path
          : typeof args.query === 'string'
            ? args.query
            : null
    return {
      id: segment.segmentId,
      timestamp: ts,
      kind: `segment.${segKind}`,
      summary: segment.name,
      detail: action ?? (Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : undefined)
    }
  }
  if (segKind === 'tool_result') {
    const output = segment.output || segment.error || ''
    return {
      id: segment.segmentId,
      timestamp: ts,
      kind: `segment.${segKind}`,
      summary: segment.status,
      detail: output ? (output.length > 2000 ? output.slice(0, 2000) + '…' : output) : undefined
    }
  }
  if (segKind === 'compaction') {
    const lines = segment.details.map((d) => {
      const pct =
        d.originalChars > 0 ? Math.round((1 - d.compactedChars / d.originalChars) * 100) : 0
      return `${d.toolName ?? 'unknown'}: ${d.originalChars} → ${d.compactedChars} chars (${pct}% reduced)`
    })
    lines.unshift(`~${fmtNum(segment.tokensSaved)} tokens saved in ${segment.durationMs}ms`)
    return {
      id: segment.segmentId,
      timestamp: ts,
      kind: `segment.${segKind}`,
      detail: lines.join('\n')
    }
  }
  return null
}

function timelineEventSummary(
  type: string,
  payload: Record<string, unknown>,
  turnStats?: TurnStats
): { summary?: string; detail?: string } {
  switch (type) {
    case 'context.built': {
      const count = typeof payload.tokenCount === 'number' ? payload.tokenCount : null
      const budget = typeof payload.tokenBudget === 'number' ? payload.tokenBudget : null
      const sections = Array.isArray(payload.sectionsIncluded)
        ? (payload.sectionsIncluded as string[]).join(', ')
        : null
      const lines: string[] = []
      if (count != null)
        lines.push(`Tokens: ${fmtNum(count)}${budget != null ? ` / ${fmtNum(budget)} budget` : ''}`)
      if (sections) lines.push(`Sections: ${sections}`)
      return { detail: lines.length > 0 ? lines.join('\n') : undefined }
    }
    case 'llm.response': {
      const inp = typeof payload.inputTokens === 'number' ? payload.inputTokens : 0
      const out = typeof payload.outputTokens === 'number' ? payload.outputTokens : 0
      const cache = typeof payload.cacheReadTokens === 'number' ? payload.cacheReadTokens : 0
      const cacheCreated =
        typeof payload.cacheCreationTokens === 'number' ? payload.cacheCreationTokens : 0
      const dur = typeof payload.durationMs === 'number' ? payload.durationMs : null
      const provider = typeof payload.provider === 'string' ? payload.provider : null
      const lines: string[] = []
      lines.push(`Input: ${fmtNum(inp)} tokens`)
      lines.push(`Output: ${fmtNum(out)} tokens`)
      if (cache > 0) lines.push(`Cache read: ${fmtNum(cache)} tokens`)
      if (cacheCreated > 0) lines.push(`Cache created: ${fmtNum(cacheCreated)} tokens`)
      if (provider) lines.push(`Provider: ${provider}`)
      if (dur != null) lines.push(`Duration: ${formatDuration(dur)}`)
      return { summary: `${fmtNum(inp)} in / ${fmtNum(out)} out`, detail: lines.join('\n') }
    }
    case 'safety.blocked':
      return {
        detail:
          [
            typeof payload.tool === 'string' ? `Tool: ${payload.tool}` : null,
            typeof payload.reason === 'string' ? payload.reason : null
          ]
            .filter(Boolean)
            .join('\n') || undefined
      }
    case 'safety.allowed':
    case 'safety.approved':
    case 'safety.denied':
      return { detail: typeof payload.tool === 'string' ? payload.tool : undefined }
    case 'compaction.started': {
      const lines: string[] = []
      if (typeof payload.messagesCount === 'number')
        lines.push(`Messages: ${payload.messagesCount}`)
      if (payload.force) lines.push('Mode: forced (overflow recovery)')
      if (payload.progressive) lines.push('Mode: progressive (mid-iteration)')
      return { detail: lines.length > 0 ? lines.join('\n') : undefined }
    }
    case 'task.created': {
      const lines: string[] = []
      if (typeof payload.name === 'string') lines.push(payload.name)
      if (typeof payload.stepsTotal === 'number') lines.push(`Steps: ${payload.stepsTotal}`)
      return { detail: lines.length > 0 ? lines.join('\n') : undefined }
    }
    case 'task.stepCompleted':
      return {
        detail:
          typeof payload.step === 'number' && typeof payload.total === 'number'
            ? `Step ${payload.step}/${payload.total}`
            : undefined
      }
    case 'task.completed': {
      const lines: string[] = []
      if (typeof payload.durationMs === 'number')
        lines.push(`Duration: ${formatDuration(payload.durationMs)}`)
      // End-of-turn roll-up from the live token aggregates — only what was
      // actually recorded, so a no-LLM turn stays a bare duration line.
      if (turnStats) {
        if (turnStats.inputTokens > 0 || turnStats.outputTokens > 0)
          lines.push(
            `Tokens: ${fmtNum(turnStats.inputTokens)} in / ${fmtNum(turnStats.outputTokens)} out`
          )
        if (turnStats.cacheReadTokens > 0)
          lines.push(`Cache read: ${fmtNum(turnStats.cacheReadTokens)} tokens`)
        if (turnStats.contextTokens > 0)
          lines.push(`Context: ${fmtNum(turnStats.contextTokens)} tokens`)
      }
      return { detail: lines.length > 0 ? lines.join('\n') : undefined }
    }
    case 'task.failed':
      return { detail: typeof payload.error === 'string' ? payload.error : undefined }
    case 'task.stopped':
      return { detail: typeof payload.taskId === 'string' ? `Task: ${payload.taskId}` : undefined }
    default:
      return {}
  }
}

function useRelativeTime(ts: number | undefined): string | null {
  const { i18n } = useTranslation()
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!ts) return
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [ts])
  return ts ? relativeTime(ts, i18n.language) : null
}

function ChatItem({
  message,
  t,
  awaitingApproval,
  awaitingAsk,
  onApprovalDecision,
  onAskRespond
}: {
  message: ChatMessage
  t: (k: string, opts?: Record<string, unknown>) => string
  awaitingApproval: boolean
  awaitingAsk: boolean
  onApprovalDecision: (id: string, decision: 'approved' | 'denied') => void
  onAskRespond: (askId: string, response: AskUserResponse) => void
}): React.JSX.Element {
  if (message.role === 'user') {
    return (
      <UserBubble
        content={message.content}
        attachments={message.attachments}
        transcribing={message.transcribing}
        timestamp={message.timestamp}
        t={t}
      />
    )
  }
  return (
    <AssistantBubble
      message={message}
      awaitingApproval={awaitingApproval}
      awaitingAsk={awaitingAsk}
      onApprovalDecision={onApprovalDecision}
      onAskRespond={onAskRespond}
    />
  )
}

function UserBubble({
  content,
  attachments,
  transcribing,
  timestamp,
  t
}: {
  content: string
  attachments?: MessageAttachment[]
  transcribing?: boolean
  timestamp?: number
  t: (k: string, opts?: Record<string, unknown>) => string
}): React.JSX.Element {
  const hasContent = content.length > 0
  const hasAttachments = !!attachments && attachments.length > 0
  const timeLabel = useRelativeTime(timestamp)
  const showFooter = !transcribing && hasContent
  return (
    <div className="flex w-full flex-col gap-1.5 items-end">
      {transcribing ? (
        <div className="bg-primary text-primary-fg max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed wrap-break-word">
          <span className="animate-pulse">{t('chat.voice.transcribing')}</span>
        </div>
      ) : (
        hasContent && (
          <div className="bg-primary text-primary-fg max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed wrap-anywhere [&_h1]:text-inherit [&_h2]:text-inherit [&_h3]:text-inherit [&_h4]:text-inherit [&_code]:text-inherit [&_code]:bg-primary-fg/15 [&_pre_pre]:bg-primary-fg/10 [&_pre_pre]:text-inherit [&_pre_pre]:border-primary-fg/20 [&_a]:text-primary-fg [&_blockquote]:text-inherit [&_blockquote]:border-primary-fg/40 [&_table]:border-primary-fg/20 [&_th]:border-primary-fg/20 [&_td]:border-primary-fg/20 [&_thead]:bg-primary-fg/10 [&_hr]:border-primary-fg/30">
            <Markdown content={content} />
          </div>
        )
      )}
      {hasAttachments && (
        <div className="flex w-full flex-col items-end gap-2">
          <AttachmentList attachments={attachments!} align="end" />
        </div>
      )}
      {showFooter && (
        <div className="flex items-center gap-1.5">
          <CopyButton
            text={content}
            variant="inline"
            ariaLabelKey="chat.copyMessage"
            className="px-2"
          />
          {timeLabel && (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Clock01Icon size={14} />
              {timeLabel}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function AssistantBubble({
  message,
  awaitingApproval,
  awaitingAsk,
  onApprovalDecision,
  onAskRespond
}: {
  message: AssistantMessage
  awaitingApproval: boolean
  awaitingAsk: boolean
  onApprovalDecision: (id: string, decision: 'approved' | 'denied') => void
  onAskRespond: (askId: string, response: AskUserResponse) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const verbose = useContext(InAppVerboseContext)
  const isStreaming = message.status === 'streaming'
  const isError = message.status === 'error'
  const [typedText, setTypedText] = useState('')
  const wordsRef = useRef<string[]>([])

  useEffect(() => {
    const words = [...(t('chat.thinkingWords', { returnObjects: true }) as string[])]
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[words[i], words[j]] = [words[j], words[i]]
    }
    wordsRef.current = words
  }, [t])

  useEffect(() => {
    if (!isStreaming) return
    let wordIdx = 0
    let charIdx = 0
    let wait = 0
    let phase: 'typing' | 'pause' = 'typing'

    const id = setInterval(() => {
      const words = wordsRef.current
      const c = [...words[wordIdx % words.length]]

      if (phase === 'typing') {
        charIdx++
        setTypedText(c.slice(0, charIdx).join(''))
        if (charIdx >= c.length) {
          phase = 'pause'
          wait = 0
        }
      } else {
        if (++wait >= 40) {
          // 2s hold then next word
          wordIdx = (wordIdx + 1) % words.length
          charIdx = 0
          phase = 'typing'
        }
      }
    }, 50)

    return () => clearInterval(id)
  }, [isStreaming])
  const renderable = renderSegments(
    message.segments,
    message.approvals,
    message.asks,
    message.toolTimings,
    onApprovalDecision,
    onAskRespond,
    verbose,
    isStreaming
  )
  const showThinking = isStreaming && renderable.empty
  const fullText = useMemo(() => collectText(message.segments), [message.segments])
  const showCopy = !isStreaming && !isError && fullText.length > 0
  const timeLabel = useRelativeTime(message.timestamp)

  if (isError && message.error) {
    const providerSeg = message.segments.find(
      (s): s is Extract<Segment, { kind: 'turn_end' }> =>
        s.kind === 'turn_end' && !!s.providerErrors?.length
    )
    if (providerSeg?.providerErrors?.length) {
      return (
        <div className="flex flex-col gap-1 items-start">
          <ProviderErrorCards failures={providerSeg.providerErrors} />
        </div>
      )
    }
    return (
      <div className="flex flex-col gap-1 items-start">
        <ProviderErrorCards
          failures={[
            {
              provider: 'unknown',
              providerLogo: '',
              statusCode: null,
              errorReason: message.error,
              errorDetail: null,
              retriesAttempted: 0,
              totalDurationMs: 0
            }
          ]}
        />
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2 items-start">
      {showThinking ? (
        <div className="bg-surface border-border text-fg max-w-[85%] rounded-2xl border px-4 py-2.5 text-sm leading-relaxed wrap-break-word">
          <span className="text-muted italic">
            {awaitingApproval ? (
              <span className="animate-pulse">{t('chat.awaitingPermission')}</span>
            ) : awaitingAsk ? (
              <span className="animate-pulse">{t('chat.awaitingAnswer')}</span>
            ) : (
              <span className="animate-pulse">{typedText}…</span>
            )}
          </span>
        </div>
      ) : (
        renderable.blocks
      )}
      {showCopy && (
        <div className="flex items-center gap-1.5">
          <CopyButton
            text={fullText}
            variant="inline"
            ariaLabelKey="chat.copyMessage"
            className="px-2"
          />
          {timeLabel && (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Clock01Icon size={14} />
              {timeLabel}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

type RenderResult = { blocks: ReactNode; empty: boolean }

// The `ask` capability's single tool. Its tool_call renders as an interactive
// QuestionCard rather than a generic tool card.
const ASK_USER_TOOL = 'ask_user'

function renderSegments(
  segments: Segment[],
  approvals: Record<string, ApprovalCardState> | undefined,
  asks: Record<string, AskCardState> | undefined,
  toolTimings: Record<string, ToolTiming> | undefined,
  onApprovalDecision: (id: string, decision: 'approved' | 'denied') => void,
  onAskRespond: (askId: string, response: AskUserResponse) => void,
  verbose: boolean,
  isStreaming: boolean
): RenderResult {
  const blocks: ReactNode[] = []
  let textBuffer = ''
  let textRun = 0
  // Wrap a subagent block in a left accent rail + a small worker-label chip so
  // it reads as marked subagent activity. The wrapper spans the message width
  // (no max-w of its own) so the inner bubble/card gets the SAME width it would
  // in single mode; logical props (border-s / ps / ms) mirror in RTL; colors
  // come from theme tokens (dark/light).
  const wrapSubagent = (
    worker: { id: string; label: string },
    key: string,
    node: ReactNode
  ): ReactNode => (
    <div key={key} className="border-primary/30 ms-2 flex w-full flex-col gap-1 border-s-2 ps-3">
      <span className="text-primary/80 inline-flex w-fit items-center rounded text-[10px] font-medium tracking-wide uppercase">
        {worker.label}
      </span>
      {node}
    </div>
  )
  // Per-worker text buffer. Concurrent workers interleave their text deltas
  // token-by-token in the merged stream, so we coalesce each worker's text by id
  // and flush it as ONE bubble at that worker's next tool call (narration →
  // action) or at the end — never a tiny bubble per interleave.
  const workerText = new Map<string, { label: string; buf: string; run: number }>()
  let workerRun = 0
  const flushWorkerText = (id: string): void => {
    const e = workerText.get(id)
    if (!e || e.buf.length === 0) return
    workerText.delete(id)
    const bubble = (
      <div className="bg-surface border-border text-fg max-w-[85%] rounded-2xl border px-4 py-2.5 text-sm leading-relaxed self-start wrap-anywhere">
        <Markdown content={e.buf} />
      </div>
    )
    blocks.push(wrapSubagent({ id, label: e.label }, `wmd-${id}-${e.run}`, bubble))
  }
  // Generic guard: every file path already rendered as a player/viewer in this
  // message. Prevents the same file showing twice when it's reachable from more
  // than one detector (e.g. a voice result that also matches the generic media
  // extractor). Rebuilt every render, so the per-render scope IS the TTL.
  const emittedFiles = new Set<string>()
  const emitOnce = (filePath: string): boolean => {
    if (emittedFiles.has(filePath)) return false
    emittedFiles.add(filePath)
    return true
  }

  // Filesystem paths named anywhere in this turn (assistant prose or a tool
  // result), collected in order and deduped. Rendered once as openable cards at
  // the END of the message rather than inline at the first mention: in a long
  // agentic turn the first mention is often a mid-message "plan" line, and a
  // resumed chat auto-scrolls to the bottom — so an inline card ends up scrolled
  // off-screen. The end is where the closing summary points and where the eye
  // lands, and it's identical whether the message is live or restored.
  const pathCandidates: string[] = []
  const pathSeen = new Set<string>()
  const collectPaths = (text: string): void => {
    if (isStreaming) return
    for (const candidate of extractPathCandidates(text)) {
      // Dedup on the canonical (home-folded) path so `~/x` and `/Users/me/x`
      // don't both render; keep the first-seen spelling for display.
      const key = canonicalPath(candidate)
      if (pathSeen.has(key)) continue
      pathSeen.add(key)
      pathCandidates.push(candidate)
    }
  }

  const flushText = (): void => {
    if (textBuffer.length === 0) return
    textRun += 1
    // A standalone wolffish-media image (e.g. a generated meme/GIF) renders as
    // a proper file card — filename + reveal/download — matching every other
    // attachment, instead of a bare floating photo.
    const mediaImage = textBuffer.trim().match(/^!\[[^\]]*\]\(wolffish-media:\/\/([^)]+)\)$/)
    if (mediaImage) {
      const relativePath = mediaImage[1]
      const mediaFileName = relativePath.split('/').pop() ?? 'image'
      const mediaExt = (mediaFileName.match(/\.[^./\\]+$/)?.[0] ?? '').toLowerCase()
      const mediaMime = `image/${mediaExt === '.jpg' ? 'jpeg' : mediaExt.slice(1) || 'png'}`
      blocks.push(
        <ImageViewer
          key={`md-${textRun}`}
          filePath={relativePath}
          fileExists={true}
          mimeType={mediaMime}
          fileName={mediaFileName}
        />
      )
      textBuffer = ''
      return
    }
    const bubble = (
      <div
        key={`md-${textRun}`}
        className="bg-surface border-border text-fg max-w-[85%] rounded-2xl border px-4 py-2.5 text-sm leading-relaxed self-start wrap-anywhere"
      >
        <Markdown content={textBuffer} />
      </div>
    )
    blocks.push(bubble)
    // Collect any filesystem paths named in this bubble; the cards render at the
    // end of the message (see collectPaths). Skipped mid-stream — a partial path
    // token would resolve to nothing — and verified on-device by PathCard.
    collectPaths(textBuffer)
    textBuffer = ''
  }

  // Voice replies: a turn surfaces at most ONE voice_respond memo — the LAST
  // one. The model occasionally replies, then redoes the reply; only the final
  // voice_respond is the real answer, so earlier ones are superseded.
  // voice_generate ASSETS (isResponse:false) are unaffected and each render.
  let lastVoiceReplyId: string | null = null
  for (const s of segments) {
    if (s.kind !== 'tool_call') continue
    const r = findResult(segments, s.toolCallId)
    const v = r?.status === 'success' ? parseVoiceResult(r.output) : null
    if (v?.isResponse) lastVoiceReplyId = s.toolCallId
  }

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx]
    if (seg.kind === 'text') {
      if (seg.worker) {
        // Subagent text is verbose-only (clean feed = orchestrator's reply
        // only); coalesce per worker so interleaved deltas don't fragment.
        if (!verbose) continue
        const e = workerText.get(seg.worker.id) ?? {
          label: seg.worker.label,
          buf: '',
          run: ++workerRun
        }
        e.buf += seg.delta
        e.label = seg.worker.label
        workerText.set(seg.worker.id, e)
      } else {
        textBuffer += seg.delta
      }
    } else if (seg.kind === 'tool_call') {
      // Subagent tool calls (forwarded from a worker, tagged `worker`) render as
      // the SAME tool card, marked as that subagent's activity — verbose-only,
      // since the clean feed hides all subagent internals. No black box: every
      // worker tool call is right here and persisted.
      if (seg.worker) {
        flushWorkerText(seg.worker.id) // narration before this worker's action
        if (verbose) {
          const wResult = findResult(segments, seg.toolCallId)
          const wTiming = toolTimings?.[seg.toolCallId]
          blocks.push(
            wrapSubagent(
              seg.worker,
              `wtc-${seg.segmentId}`,
              <ToolCard call={seg} result={wResult} timing={wTiming} />
            )
          )
        }
        continue
      }

      flushText()
      const result = findResult(segments, seg.toolCallId)

      // ask_user renders a dedicated interactive question card instead of a
      // tool card — always visible (the user must be able to answer), even
      // on the clean feed. Rendered while pending (live ask state) and after
      // answering (the tool_result). Skip everything else for this call.
      if (seg.name === ASK_USER_TOOL) {
        const ask = asks?.[seg.toolCallId]
        if (ask || result) {
          blocks.push(
            <QuestionCard
              key={`ask_${seg.segmentId}`}
              args={seg.args}
              result={result}
              ask={ask}
              onRespond={onAskRespond}
            />
          )
        }
        continue
      }

      const approval = approvals?.[seg.toolCallId]
      const timing = toolTimings?.[seg.toolCallId]

      const voiceData = result?.status === 'success' ? parseVoiceResult(result.output) : null
      // An stt_* result's filePath is the user's SOURCE recording (an input),
      // never a deliverable — don't echo it back as an audio card.
      const isSttResult = (seg.name ?? '').startsWith('stt_')

      const codeFile = extractToolResultCodeFile(seg, result)

      // Clean feed (verbose off): the activity card is dropped for plain
      // successful tool calls — the file viewers below still render, so
      // file-bearing results survive. Failed/denied results keep the card
      // (errors must surface); a still-running call (no result yet) stays
      // hidden until it completes. Mirrors the channel renderSegment rules.
      const cardVisible = verbose || (result != null && result.status !== 'success')

      if (voiceData) {
        if (cardVisible) {
          blocks.push(<ToolCard key={seg.segmentId} call={seg} result={result} timing={timing} />)
        }
        // Render every voice_generate asset, but for the voice_respond REPLY
        // only the final one — a redone reply must not show as a second memo.
        const supersededReply = voiceData.isResponse && seg.toolCallId !== lastVoiceReplyId
        if (!supersededReply) {
          blocks.push(
            <AudioPlayer
              key={`voice_${seg.segmentId}`}
              source="voice"
              filePath={voiceData.filePath}
              fileExists={true}
              mimeType="audio/mpeg"
              fileName={voiceData.fileName}
            />
          )
        }
      } else if (approval) {
        // Approval cards always render — the user must be able to act on a
        // pending tool call regardless of the verbose preference.
        blocks.push(
          <ApprovalCard
            key={`appr_${seg.segmentId}`}
            state={approval}
            onDecision={(d) => onApprovalDecision(approval.approvalId, d)}
          />
        )
        if (approval.decision !== undefined && cardVisible) {
          blocks.push(<ToolCard key={seg.segmentId} call={seg} result={result} timing={timing} />)
        }
      } else if (cardVisible) {
        blocks.push(<ToolCard key={seg.segmentId} call={seg} result={result} timing={timing} />)
      }

      const page = codeFile ? null : extractToolResultPage(seg, result)

      // Code-file content and fetched-page content are renderings of routine
      // successful output, not delivered files — the channel clean feed skips
      // them, so we only show them when verbose. They still own the branch
      // (no fall-through to the delivered-file viewers, which never coincide).
      if (codeFile) {
        if (verbose) {
          // Reveal/download the read/written file via the OS. revealPath and
          // downloadPath resolve ~ and absolute paths (file_read/file_write
          // targets live anywhere on the user's machine, not just the
          // workspace); a relative path can't be resolved from the renderer, so
          // the buttons are omitted for it.
          const codeFilePath = codeFile.filePath
          const pathActionable = /^(?:~|\/)/.test(codeFilePath)
          blocks.push(
            <CodeFileViewer
              key={`code_${seg.segmentId}`}
              content={codeFile.content}
              fileName={codeFile.fileName}
              htmlPreview={/\.html?$/i.test(codeFile.fileName)}
              onReveal={
                pathActionable
                  ? () =>
                      void window.api.upload.revealPath(codeFilePath).catch(() => {
                        // best-effort
                      })
                  : undefined
              }
              onDownload={
                pathActionable
                  ? () =>
                      void window.api.upload.downloadPath(codeFilePath).catch(() => {
                        // best-effort
                      })
                  : undefined
              }
            />
          )
        }
      } else if (page) {
        if (verbose) {
          blocks.push(
            <PageViewer
              key={`page_${seg.segmentId}`}
              content={page.content}
              title={page.title}
              url={page.url}
              format={page.format}
            />
          )
        }
      } else {
        const imagePath = extractToolResultImage(result)
        if (imagePath) {
          const imgRelPath = imagePath.startsWith('wolffish-media://')
            ? imagePath
            : imagePath.replace(/^.*?\.wolffish\/workspace\//, '')
          const imgReachable = !imgRelPath.startsWith('/')
          const imgFileName = imagePath.split('/').pop() ?? 'image'
          const imgExt = (imagePath.match(/\.[^./\\]+$/) || [''])[0].toLowerCase()
          const imgMime = `image/${imgExt === '.jpg' ? 'jpeg' : imgExt.slice(1)}`
          if (emitOnce(imgRelPath)) {
            blocks.push(
              <ImageViewer
                key={`img_${seg.segmentId}`}
                filePath={imgRelPath}
                fileExists={imgReachable}
                mimeType={imgMime}
                fileName={imgFileName}
              />
            )
          }
        }

        const docResults = extractToolResultDocuments(result)
        if (docResults) {
          for (let di = 0; di < docResults.length; di++) {
            const doc = docResults[di]
            // Dedup across detectors/segments in this message: the same file is
            // often delivered by two tools in one turn — e.g. browser_pdf
            // returns {"path":"x.pdf"} (recognized as a document) and send_file
            // then emits the [wolffish-output: x.pdf (document)] marker for the
            // SAME file. Without this guard the PDF renders twice. Mirrors the
            // image/media emitOnce above and the channels' sentFiles dedup.
            const docKey = doc.path.replace(/^.*?\.wolffish\/workspace\//, '')
            if (!emitOnce(docKey)) continue
            const fileName = doc.path.split('/').pop() ?? 'document'
            const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
            if (ext === 'pdf') {
              blocks.push(
                <PdfViewer
                  key={`doc_${seg.segmentId}_${di}`}
                  filePath={doc.path}
                  fileExists={true}
                  fileName={fileName}
                  sizeBytes={doc.size}
                />
              )
            } else if (ext === 'docx') {
              blocks.push(
                <DocxViewer
                  key={`doc_${seg.segmentId}_${di}`}
                  filePath={doc.path}
                  fileExists={true}
                  fileName={fileName}
                  sizeBytes={doc.size}
                />
              )
            } else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
              blocks.push(
                <SpreadsheetViewer
                  key={`doc_${seg.segmentId}_${di}`}
                  filePath={doc.path}
                  fileExists={true}
                  fileName={fileName}
                  sizeBytes={doc.size}
                />
              )
            } else {
              blocks.push(
                <FileCard
                  key={`doc_${seg.segmentId}_${di}`}
                  filePath={doc.path}
                  fileExists={true}
                  fileName={fileName}
                  sizeBytes={doc.size}
                  mimeType={docMimeType(ext)}
                />
              )
            }
          }
        }

        // Skip the generic media extractor for voice_respond / voice_generate:
        // their audio already rendered as the dedicated voice player above, and
        // the same workspace path would otherwise match here and render a SECOND
        // player (a native <video> card when the file is webm). This is the
        // voice-"double" fix. emitOnce is the generic backstop for any other
        // overlap within a message.
        const media = voiceData || isSttResult ? null : extractToolResultMedia(result)
        if (media) {
          const mediaFileName = media.path.split('/').pop() ?? 'media'
          const mediaExt = (media.path.match(/\.[^./\\]+$/) || [''])[0].toLowerCase()
          const mediaMime =
            media.type === 'audio'
              ? `audio/${mediaExt === '.mp3' ? 'mpeg' : mediaExt.slice(1)}`
              : `video/${mediaExt === '.mov' ? 'quicktime' : mediaExt.slice(1)}`
          // Convert absolute workspace path to a relative path for the blob loader.
          // If the path is outside the workspace (e.g. /tmp/) the regex won't
          // match and relPath stays absolute — render with fileExists=false so
          // the player shows an "unavailable" placeholder.
          const relPath = media.path.replace(/^.*?\.wolffish\/workspace\//, '')
          const fileReachable = !relPath.startsWith('/')
          if (emitOnce(relPath)) {
            if (media.type === 'audio') {
              blocks.push(
                <AudioPlayer
                  key={`media_${seg.segmentId}`}
                  filePath={relPath}
                  fileExists={fileReachable}
                  mimeType={mediaMime}
                  fileName={mediaFileName}
                />
              )
            } else {
              blocks.push(
                <VideoPlayer
                  key={`media_${seg.segmentId}`}
                  filePath={relPath}
                  fileExists={fileReachable}
                  mimeType={mediaMime}
                  fileName={mediaFileName}
                />
              )
            }
          }
        }

        // Generic files (any extension) explicitly delivered via send_file —
        // render a file card with reveal/download, same as a non-previewable
        // attachment. send_file copies out-of-workspace files into files/ so
        // the absolute path is always reachable.
        const genericFiles = extractToolResultGenericFiles(result)
        for (let gi = 0; gi < genericFiles.length; gi++) {
          const gPath = genericFiles[gi]
          // Same cross-detector dedup as documents/images above: don't render a
          // second card for a file already shown in this message.
          const gKey = gPath.replace(/^.*?\.wolffish\/workspace\//, '')
          if (!emitOnce(gKey)) continue
          const gName = gPath.split('/').pop() ?? 'file'
          const gExt = gName.split('.').pop()?.toLowerCase() ?? ''
          // Markdown delivered via the (file) catch-all renders inline as rich
          // markdown — same card attachments use — instead of a bare file card.
          if (gExt === 'md' || gExt === 'mdx' || gExt === 'markdown') {
            blocks.push(
              <MarkdownFileViewer
                key={`file_${seg.segmentId}_${gi}`}
                filePath={gPath}
                fileExists={true}
                fileName={gName}
                sizeBytes={0}
                mimeType="text/markdown"
              />
            )
          } else if (gExt === 'html' || gExt === 'htm') {
            // HTML delivered via the (file) catch-all renders inline as
            // highlighted source with a live, sandboxed preview on expand —
            // same card attachments use — instead of a bare file card.
            blocks.push(
              <HtmlFileViewer
                key={`file_${seg.segmentId}_${gi}`}
                filePath={gPath}
                fileExists={true}
                fileName={gName}
                sizeBytes={0}
                mimeType="text/html"
              />
            )
          } else {
            blocks.push(
              <FileCard
                key={`file_${seg.segmentId}_${gi}`}
                filePath={gPath}
                fileExists={true}
                fileName={gName}
                sizeBytes={0}
                mimeType={docMimeType(gExt)}
              />
            )
          }
        }

        // Collect paths from tool output too — a short, successful result that
        // names an absolute/home path (a created folder, an output file) earns
        // the same end-of-message card as a path in assistant prose. Delivery
        // markers are stripped first so a file already shown as a card isn't
        // repeated, and big dumps (listings, logs) are skipped so they don't
        // spray cards.
        if (result?.status === 'success' && result.output) {
          const toolText = result.output.replace(/\[wolffish-output:[^\]]+\]/g, '').trim()
          if (toolText.length > 0 && toolText.length <= 2000) {
            collectPaths(toolText)
          }
        }
      }
    } else if (seg.kind === 'tool_result') {
      // Already rendered alongside its tool_call.
      continue
    } else if (seg.kind === 'separator') {
      // Flush whatever text has accumulated into its own bubble, then
      // continue — the next text segment starts a new bubble.
      flushText()
    } else if (seg.kind === 'compaction_started') {
      // Clean feed: compaction is internal activity, not a result — hide it.
      if (!verbose) continue
      const hasCompletion = segments.some((s, j) => j > segIdx && s.kind === 'compaction')
      if (!hasCompletion) {
        flushText()
        blocks.push(
          <CompactionStartedCard
            key={seg.segmentId}
            messagesCount={seg.messagesCount}
            targetsCount={seg.targetsCount}
            tokenCount={seg.tokenCount}
            tokenBudget={seg.tokenBudget}
            startedAt={seg.startedAt}
          />
        )
      }
    } else if (seg.kind === 'compaction') {
      // Clean feed: compaction is internal activity, not a result — hide it.
      if (!verbose) continue
      flushText()
      blocks.push(
        <CompactionCard
          key={seg.segmentId}
          targetsCount={seg.targetsCount}
          tokensSaved={seg.tokensSaved}
          durationMs={seg.durationMs}
          details={seg.details}
        />
      )
    } else if (seg.kind === 'turn_end') {
      // Workers flush and finish first. A worker's closing narration has no
      // following tool call to flush it, so it sits buffered in `workerText`
      // until the post-loop drain below. But `turn_end` is the orchestrator's
      // final segment, and this flushText() would emit its closing synthesis
      // HERE — before that drain — burying the summary above the very worker
      // reports it summarizes. Drain the workers first so the orchestrator's
      // reply lands last. (The post-loop drain stays as the streaming-render
      // fallback for an in-flight turn that has no turn_end yet.)
      for (const id of workerText.keys()) flushWorkerText(id)
      flushText()
      if (seg.providerErrors?.length) {
        blocks.push(<ProviderErrorCards key={seg.segmentId} failures={seg.providerErrors} />)
      } else if (seg.stopReason === 'error') {
        blocks.push(<TurnFooter key={seg.segmentId} stopReason={seg.stopReason} />)
      }
    }
  }

  // Flush any trailing subagent narration (a worker's final text with no
  // following tool call) before the orchestrator's closing synthesis.
  for (const id of workerText.keys()) flushWorkerText(id)
  flushText()

  // Openable cards for every filesystem path named this turn, rendered together
  // at the end so they sit with the closing summary and survive a resumed chat's
  // auto-scroll to the bottom. Each verifies on-device and renders nothing if the
  // path no longer exists.
  for (const candidate of pathCandidates) {
    blocks.push(<PathCard key={`path-${candidate}`} path={candidate} />)
  }

  return { blocks: <>{blocks}</>, empty: blocks.length === 0 }
}

function PendingAttachmentChip({
  attachment,
  onRemove
}: {
  attachment: MessageAttachment
  onRemove: () => void
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'border-border bg-surface text-fg flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs',
        'max-w-xs'
      )}
    >
      <span className="bg-primary/10 text-primary inline-flex h-5 items-center rounded px-1.5 text-[10px] font-medium uppercase tracking-wide">
        {attachment.type}
      </span>
      <span className="truncate" title={attachment.originalName}>
        {attachment.originalName}
      </span>
      <span className="text-muted shrink-0 tabular-nums text-[10px]">
        {formatBytes(attachment.sizeBytes)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        title="Remove"
        aria-label="Remove attachment"
        className="text-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-accent shrink-0 cursor-pointer rounded"
      >
        <CancelCircleIcon size={14} />
      </button>
    </div>
  )
}

function StatusBar({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  turnStartedAt,
  turnEndedAt,
  locale
}: {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  turnStartedAt: number | null
  turnEndedAt: number | null
  locale: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    if (turnStartedAt === null || turnEndedAt !== null) return
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [turnStartedAt, turnEndedAt])

  const elapsedMs = turnStartedAt === null ? 0 : Math.max(0, (turnEndedAt ?? now) - turnStartedAt)
  const hasCacheTokens = (cacheReadTokens ?? 0) > 0
  const parts: string[] = [
    formatElapsed(elapsedMs, t),
    hasCacheTokens
      ? t('chat.status.tokenUsageCached', {
          cached: formatTokensCompact(cacheReadTokens ?? 0, locale),
          input: formatTokensCompact(inputTokens ?? 0, locale),
          output: formatTokensCompact(outputTokens ?? 0, locale)
        })
      : t('chat.status.tokenUsage', {
          input: formatTokensCompact(inputTokens ?? 0, locale),
          output: formatTokensCompact(outputTokens ?? 0, locale)
        })
  ]

  return (
    <code
      aria-hidden
      className="text-muted bg-surface border-border flex h-5 items-center gap-1.5 rounded border px-1.5 font-mono text-[10px]"
    >
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span aria-hidden className="text-border">
              ·
            </span>
          )}
          <span>{part}</span>
        </Fragment>
      ))}
    </code>
  )
}

function CloudOffIcon({ size = 24 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.5 19h-1a4.5 4.5 0 0 1-.42-8.98A7 7 0 0 1 18.42 12H19a3 3 0 0 1 2.07 5.17" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  )
}

const CLOUD_PROVIDER_LOGOS: Record<string, React.ComponentType<{ size?: number }>> = {
  anthropic: AnthropicLogo,
  openai: OpenAILogo,
  openrouter: OpenRouterLogo,
  deepseek: DeepSeekLogo,
  mimo: MimoLogo,
  kimi: KimiLogo,
  minimax: MiniMaxLogo,
  xai: XAILogo,
  qwen: QwenLogo,
  stepfun: StepfunLogo,
  zai: ZaiLogo
}

function ModeToggle({
  value,
  onChange,
  disabled,
  activeCloudProvider,
  cloudModel,
  localModel,
  isOrchestrator = false,
  worker = null
}: {
  value: boolean
  onChange: (next: boolean) => void
  disabled: boolean
  activeCloudProvider: string | null
  cloudModel: string | null
  localModel: string | null
  isOrchestrator?: boolean
  worker?: { provider: string; model: string } | null
}): React.JSX.Element {
  const { t } = useTranslation()

  const hasCloudModel = cloudModel !== null
  const cloudFallback = hasCloudModel ? CloudIcon : CloudOffIcon
  const CloudIconCmp =
    (activeCloudProvider && CLOUD_PROVIDER_LOGOS[activeCloudProvider]) || cloudFallback
  const cloudLabel = activeCloudProvider
    ? t(`settings.model.providers.${activeCloudProvider}`)
    : t('chat.modeToggle.cloud')

  // Orchestrator mode: the SAME cloud tab carries both models. Its icon becomes
  // the two provider logos (orchestrator + worker) side by side, and its tooltip
  // names each role + model — so the switcher reflects the mode in place.
  const WorkerLogo = worker ? (CLOUD_PROVIDER_LOGOS[worker.provider] ?? CloudIcon) : null
  const dual = isOrchestrator && WorkerLogo !== null
  const cloudIconNode = dual ? (
    <span className="inline-flex items-center gap-0.5">
      <CloudIconCmp size={13} />
      {WorkerLogo ? <WorkerLogo size={13} /> : null}
    </span>
  ) : undefined
  const cloudTooltip = dual
    ? `${t('settings.brain.orchestratorSlot')} — ${cloudModel ?? t('chat.modeToggle.noModel')}  ·  ${t('settings.brain.workerSlot')} — ${worker?.model ?? t('chat.modeToggle.noModel')}`
    : cloudModel || t('chat.modeToggle.noModel')

  const modes: {
    key: 'local' | 'cloud'
    label: string
    tooltip: string
    Icon: React.ComponentType<{ size?: number }>
    iconNode?: React.ReactNode
  }[] = [
    {
      key: 'local',
      label: t('chat.modeToggle.local'),
      tooltip: localModel || t('chat.modeToggle.noModel'),
      Icon: OllamaLogo
    },
    {
      key: 'cloud',
      label: cloudLabel,
      tooltip: cloudTooltip,
      Icon: CloudIconCmp,
      iconNode: cloudIconNode
    }
  ]
  const current: 'local' | 'cloud' = value ? 'local' : 'cloud'
  return (
    <div
      role="tablist"
      aria-label={t('chat.modeToggle.ariaLabel')}
      className="border-border bg-surface inline-flex items-center gap-0.5 rounded-lg border p-0.5"
    >
      {modes.map((m) => {
        const active = m.key === current
        const Icon = m.Icon
        const btn = (
          <button
            role="tab"
            type="button"
            disabled={disabled}
            aria-selected={active}
            onClick={() => onChange(m.key === 'local')}
            className={cn(
              'flex w-18 cursor-pointer flex-col items-center gap-0.5 rounded-md px-1.5 py-1',
              'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              active
                ? 'bg-primary text-primary-fg'
                : cn('text-muted', !disabled && 'hover:text-fg'),
              disabled && 'cursor-not-allowed opacity-60'
            )}
          >
            {m.iconNode ?? <Icon size={14} />}
            <span className="max-w-full truncate text-[10px] leading-tight font-medium">
              {m.label}
            </span>
          </button>
        )
        return (
          <Tooltip key={m.key} content={m.tooltip} side="top">
            {btn}
          </Tooltip>
        )
      })}
    </div>
  )
}

function findResult(segments: Segment[], toolCallId: string): ToolResultSegment | undefined {
  for (const s of segments) {
    if (s.kind === 'tool_result' && s.toolCallId === toolCallId) return s
  }
  return undefined
}

const IMAGE_EXTS_RE = /\.(?:png|jpe?g|gif|webp|bmp|tiff?)$/i
const DOCUMENT_EXTS_RE = /\.(?:pdf|docx?|xlsx?|pptx?|csv)$/i
// const AUDIO_EXTS_RE = /\.(?:mp3|wav|m4a|ogg|flac|aac|wma|opus)$/i
// const VIDEO_EXTS_RE = /\.(?:mp4|mov|avi|mkv|m4v|wmv|flv|webm)$/i
const CODE_EXTS_RE =
  /\.(?:js|jsx|mjs|cjs|ts|tsx|vue|svelte|py|rb|rs|go|java|kt|kts|swift|c|cpp|h|hpp|cs|css|scss|less|sass|html|htm|xml|json|yaml|yml|toml|ini|conf|env|sh|bash|zsh|fish|bat|cmd|ps1|sql|graphql|gql|md|mdx|txt|log|php|lua|r|pl|dart|scala|groovy|proto|zig|ex|exs|erl|hs|clj|ml|dockerfile|makefile)$/i

const DOC_MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv'
}

function docMimeType(ext: string): string {
  return DOC_MIME_MAP[ext] ?? 'application/octet-stream'
}

type ToolCallSegment = Extract<Segment, { kind: 'tool_call' }>

// A tool result whose entire output is a `[wolffish-output: <path> (<type>)]`
// delivery marker is a file *delivery*, not file *content* — the path-keyed
// viewers (image/doc/media/generic) own those. send_file accepts both `file`
// and `path` args, so a `{path: 'report.md'}` mis-call would otherwise make
// extractToolResultCodeFile treat the marker string as code and render it as a
// code block, shadowing the correct MarkdownFileViewer/FileCard rendering.
const DELIVERY_MARKER_ONLY_RE =
  /^\[wolffish-output:\s*[^\]]+?\s+\((?:image|audio|video|document|file)\)\]$/

function extractToolResultCodeFile(
  call: ToolCallSegment,
  result?: ToolResultSegment
): { filePath: string; fileName: string; content: string } | null {
  if (!result?.output || result.status !== 'success') return null
  if (DELIVERY_MARKER_ONLY_RE.test(result.output.trim())) return null
  const argsPath = typeof call.args?.path === 'string' ? call.args.path : null
  if (!argsPath || !CODE_EXTS_RE.test(argsPath)) return null
  return {
    filePath: argsPath,
    fileName: argsPath.split('/').pop() ?? 'file',
    content: result.output
  }
}

function extractToolResultImage(result?: ToolResultSegment): string | null {
  if (!result?.output || result.status !== 'success') return null
  const output = result.output.trim()

  // Prefer the explicit [wolffish-output: path (image)] marker — it
  // identifies the output file unambiguously even when the ffmpeg
  // stderr also contains the input file path.
  const marker = output.match(/\[wolffish-output:\s*([^\]]+?)\s+\(image\)\]/)
  if (marker) return marker[1].trim()

  try {
    const parsed = JSON.parse(output)
    if (typeof parsed?.path === 'string' && IMAGE_EXTS_RE.test(parsed.path)) {
      return parsed.path
    }
    if (typeof parsed?.media_url === 'string') return parsed.media_url
  } catch {
    /* not JSON */
  }
  // Bare-path fallback for tools (e.g. ext_screenshot) whose plain-text output
  // is just a saved screenshot path. Require the path to live inside the
  // workspace — that's the only image the viewer can actually load, and the
  // restriction stops incidental image URLs embedded in fetched page content
  // (e.g. browser_page_content returning HTML full of /preview.redd.it/*.png)
  // from being mis-detected and rendered as a broken "image unavailable" card.
  const m = output.match(
    /(\/[^\s",:)]*\.wolffish\/workspace\/[^\s",:)]+\.(?:png|jpe?g|gif|webp|bmp|tiff?))\b/i
  )
  if (m) return m[1]
  return null
}

/** Tools whose successful output is a fetched web page worth rendering as a card. */
const PAGE_CONTENT_TOOLS = new Set(['browser_page_content', 'ext_read_page', 'web_fetch'])

/**
 * Extract a renderable web page from a page-content tool result. Returns the
 * page text plus whatever title/url metadata the tool exposed: ext_read_page
 * yields JSON `{content,url,title}`; browser_page_content yields raw text/HTML
 * (title sniffed from <title> when HTML); web_fetch carries its URL in args.
 */
function extractToolResultPage(
  call: ToolCallSegment,
  result?: ToolResultSegment
): { content: string; title: string | null; url: string | null; format: string } | null {
  if (!result?.output || result.status !== 'success') return null
  if (!PAGE_CONTENT_TOOLS.has(call.name)) return null
  const raw = result.output.trim()
  if (!raw) return null

  const argFormat = typeof call.args?.format === 'string' ? call.args.format : null
  const argUrl = typeof call.args?.url === 'string' ? call.args.url : null

  if (call.name === 'ext_read_page') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.content === 'string') {
        return {
          content: parsed.content,
          title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : null,
          url: typeof parsed.url === 'string' && parsed.url.trim() ? parsed.url : null,
          format: argFormat ?? 'text'
        }
      }
    } catch {
      /* not JSON — fall through and render the raw text */
    }
  }

  const format = argFormat ?? (call.name === 'web_fetch' ? 'markdown' : 'text')
  let title: string | null = null
  if (format === 'html') {
    const tm = raw.match(/<title[^>]*>([^<]+)<\/title>/i)
    if (tm) title = tm[1].trim()
  }
  return { content: raw, title, url: argUrl, format }
}

function extractToolResultDocuments(
  result?: ToolResultSegment
): { path: string; size: number }[] | null {
  if (!result?.output || result.status !== 'success') return null
  const output = result.output.trim()
  const docs: { path: string; size: number }[] = []
  const seen = new Set<string>()

  // [wolffish-output: path (document)] markers from the shell plugin's
  // opened-file detection — explicit markers survive paths with spaces.
  const markerRegex = /\[wolffish-output:\s*([^\]]+?)\s+\(document\)\]/g
  let marker: RegExpExecArray | null
  while ((marker = markerRegex.exec(output)) !== null) {
    const markerPath = marker[1].trim()
    if (DOCUMENT_EXTS_RE.test(markerPath) && !seen.has(markerPath)) {
      seen.add(markerPath)
      docs.push({ path: markerPath, size: 0 })
    }
  }

  try {
    const parsed = JSON.parse(output)
    if (typeof parsed?.path === 'string' && DOCUMENT_EXTS_RE.test(parsed.path)) {
      seen.add(parsed.path)
      docs.push({ path: parsed.path, size: parsed.size ?? 0 })
    }
    if (Array.isArray(parsed?.files)) {
      for (const f of parsed.files) {
        if (typeof f?.path === 'string' && DOCUMENT_EXTS_RE.test(f.path) && !seen.has(f.path)) {
          seen.add(f.path)
          docs.push({ path: f.path, size: f.size ?? 0 })
        }
      }
    }
  } catch {
    /* not JSON */
  }

  return docs.length > 0 ? docs : null
}

/**
 * Extract audio/video file paths from tool result output. Detects the
 * `[wolffish-output: /path (type)]` marker emitted by the ffmpeg plugin,
 * as well as bare absolute paths with known media extensions.
 */
function extractToolResultMedia(
  result?: ToolResultSegment
): { path: string; type: 'audio' | 'video' } | null {
  if (!result?.output || result.status !== 'success') return null
  const output = result.output

  // Match the wolffish-output marker: [wolffish-output: /path/to/file.mp3 (audio)]
  const marker = output.match(/\[wolffish-output:\s*([^\]]+?)\s+\((audio|video)\)\]/)
  if (marker) {
    return { path: marker[1].trim(), type: marker[2] as 'audio' | 'video' }
  }

  // Bare-path fallback for tools whose plain-text output is just a saved media
  // path. Require the path to live inside the workspace — same restriction the
  // image extractor uses — so incidental media URLs embedded in tool output
  // (e.g. a web_search result snippet linking a .mp4) aren't mis-detected and
  // rendered as a broken "deleted or unavailable" player.
  //
  // webm is matched as AUDIO here (tested before video): wolffish's own webm
  // outputs are voice/TTS, and a native <video> card for a voice clip is the
  // "weird card" we're fixing. A genuine webm *video* still renders correctly
  // because it carries the explicit (video) marker handled above.
  const audioMatch = output.match(
    /(\/[^\s",:)]*\.wolffish\/workspace\/[^\s",:)]+\.(?:mp3|wav|m4a|ogg|flac|aac|wma|opus|webm))\b/i
  )
  if (audioMatch) return { path: audioMatch[1], type: 'audio' }

  const videoMatch = output.match(
    /(\/[^\s",:)]*\.wolffish\/workspace\/[^\s",:)]+\.(?:mp4|mov|avi|mkv|m4v|wmv|flv))\b/i
  )
  if (videoMatch) return { path: videoMatch[1], type: 'video' }

  return null
}

/**
 * Extract generic file paths explicitly delivered via send_file. These carry
 * a `[wolffish-output: /path (file)]` marker — the catch-all type for any
 * extension that isn't an image/audio/video/document. Only the explicit
 * marker is matched (no bare-path fallback) so incidental paths in tool
 * output are never mistaken for a delivery.
 */
function extractToolResultGenericFiles(result?: ToolResultSegment): string[] {
  if (!result?.output || result.status !== 'success') return []
  const paths: string[] = []
  const seen = new Set<string>()
  const markerRegex = /\[wolffish-output:\s*([^\]]+?)\s+\(file\)\]/g
  let match: RegExpExecArray | null
  while ((match = markerRegex.exec(result.output)) !== null) {
    const p = match[1].trim()
    if (!seen.has(p)) {
      seen.add(p)
      paths.push(p)
    }
  }
  return paths
}

function collectText(segments: Segment[]): string {
  let out = ''
  for (const s of segments) {
    if (s.kind === 'text') out += s.delta
  }
  return out
}

function cryptoId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function isAssistant(m: ChatMessage): m is AssistantMessage {
  return (m.kind === undefined || m.kind === 'message') && m.role === 'assistant'
}

function isUser(m: ChatMessage): m is Extract<ChatMessage, { role: 'user' }> {
  return (m.kind === undefined || m.kind === 'message') && m.role === 'user'
}

function appendSegment(messages: ChatMessage[], segment: Segment): ChatMessage[] {
  const out = [...messages]
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]
    if (isAssistant(m) && m.status === 'streaming') {
      const next: AssistantMessage = { ...m, segments: [...m.segments, segment] }
      if (segment.kind === 'turn_end') next.stopReason = segment.stopReason
      if (segment.kind === 'tool_call') {
        next.toolTimings = {
          ...(m.toolTimings ?? {}),
          [segment.toolCallId]: { startedAt: Date.now() }
        }
      } else if (segment.kind === 'tool_result') {
        const existing = m.toolTimings?.[segment.toolCallId]
        if (existing && existing.endedAt === undefined) {
          next.toolTimings = {
            ...m.toolTimings,
            [segment.toolCallId]: { ...existing, endedAt: Date.now() }
          }
        }
      }
      out[i] = next
      return out
    }
  }
  return out
}

function markComplete(messages: ChatMessage[], turnId: string): ChatMessage[] {
  void turnId
  const out = [...messages]
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]
    if (isAssistant(m) && m.status === 'streaming') {
      out[i] = { ...m, status: 'complete' }
      return out
    }
  }
  return out
}

function markError(messages: ChatMessage[], turnId: string, error: string): ChatMessage[] {
  void turnId
  const out = [...messages]
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]
    if (isAssistant(m) && m.status === 'streaming') {
      out[i] = { ...m, status: 'error', error }
      return out
    }
  }
  return out
}

function textHistory(messages: ChatMessage[], workspaceRoot: string | null): ChatHistoryMessage[] {
  const out: ChatHistoryMessage[] = []
  for (const m of messages) {
    if (isUser(m)) {
      const content = composeHistoryContent(m.content, m.attachments ?? [], workspaceRoot)
      const entry: ChatHistoryMessage = { role: 'user', content }
      if (m.attachments && m.attachments.length > 0) entry.attachments = m.attachments
      out.push(entry)
    } else if (isAssistant(m) && m.status === 'complete') {
      const segments = m.segments
      const turnEnd = segments.find((s) => s.kind === 'turn_end')
      const reasoningContent =
        turnEnd && 'reasoningContent' in turnEnd && turnEnd.reasoningContent
          ? (turnEnd.reasoningContent as string)
          : undefined

      // Build a tool_call lookup so tool_results can reference the name
      const toolCallNames = new Map<string, string>()
      for (const s of segments) {
        if (s.kind === 'tool_call') toolCallNames.set(s.toolCallId, s.name)
      }

      // Split segments into iterations delimited by active_model boundaries.
      // Each iteration = one LLM call that may produce text + tool_uses,
      // followed by tool results before the next LLM call.
      let iterText = ''
      let iterToolUses: Array<{ id: string; name: string; args: Record<string, unknown> }> = []
      let iterToolResults: ChatHistoryMessage[] = []
      let hasContent = false

      const flushIteration = (): void => {
        if (!hasContent) return
        const assistantMsg: ChatHistoryMessage = {
          role: 'assistant',
          content: iterText
        }
        if (iterToolUses.length > 0) assistantMsg.toolUses = iterToolUses
        if (reasoningContent && out.length === 0) assistantMsg.reasoningContent = reasoningContent
        out.push(assistantMsg)
        for (const tr of iterToolResults) out.push(tr)
        // Backfill: a run stopped mid-tool can leave a tool_call segment with
        // no tool_result (older conversations saved before the agent closed
        // these at the source). Providers reject an assistant tool_calls
        // message that isn't answered for every id, so synthesize a canceled
        // result for each missing one — immediately after the assistant turn.
        const resultIds = new Set(
          iterToolResults
            .filter((r): r is Extract<ChatHistoryMessage, { role: 'tool' }> => r.role === 'tool')
            .map((r) => r.toolUseId)
        )
        for (const use of iterToolUses) {
          if (resultIds.has(use.id)) continue
          out.push({
            role: 'tool',
            toolUseId: use.id,
            toolName: use.name,
            content: 'Tool execution was canceled by the user before it completed.',
            isError: true
          })
        }
        iterText = ''
        iterToolUses = []
        iterToolResults = []
        hasContent = false
      }

      let iterCount = 0
      for (const s of segments) {
        if (s.kind === 'active_model') {
          if (iterCount > 0) flushIteration()
          iterCount++
        } else if (s.kind === 'text') {
          iterText += s.delta
          hasContent = true
        } else if (s.kind === 'tool_call') {
          iterToolUses.push({ id: s.toolCallId, name: s.name, args: s.args })
          hasContent = true
        } else if (s.kind === 'tool_result') {
          iterToolResults.push({
            role: 'tool',
            toolUseId: s.toolCallId,
            toolName: toolCallNames.get(s.toolCallId) ?? 'unknown',
            content: s.output,
            isError: s.status === 'failed' || undefined
          })
          hasContent = true
        }
      }
      flushIteration()
    }
  }
  return out
}

function attachApproval(messages: ChatMessage[], approval: ApprovalCardState): ChatMessage[] {
  const out = [...messages]
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]
    if (isAssistant(m) && m.status === 'streaming') {
      const approvals = { ...(m.approvals ?? {}), [approval.toolCallId]: approval }
      out[i] = { ...m, approvals }
      return out
    }
  }
  return out
}

function attachAsk(messages: ChatMessage[], ask: AskCardState): ChatMessage[] {
  const out = [...messages]
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]
    if (isAssistant(m) && m.status === 'streaming') {
      const asks = { ...(m.asks ?? {}), [ask.toolCallId]: ask }
      out[i] = { ...m, asks }
      return out
    }
  }
  return out
}

type VoiceResultData = {
  filePath: string
  fileName: string
  isResponse: boolean
}

function parseVoiceResult(output: string): VoiceResultData | null {
  try {
    const parsed = JSON.parse(output)
    if (typeof parsed?.filePath === 'string' && typeof parsed?.fileName === 'string') {
      return {
        filePath: parsed.filePath,
        fileName: parsed.fileName,
        isResponse: !!parsed.isResponse
      }
    }
  } catch {
    // not voice output
  }
  return null
}

/**
 * Resolve a workspace-relative upload path to an absolute path the LLM
 * can hand straight to shell tools. The renderer can't import path/os,
 * so we join with forward slashes — uploads are always under
 * `${rootPath}/uploads/...` and the workspace root never contains a
 * trailing slash. Falls back to the relative path when the workspace
 * root isn't yet known (rare; status loads before chat is usable).
 */
function toAbsoluteUploadPath(relativePath: string, workspaceRoot: string | null): string {
  if (!workspaceRoot) return relativePath
  const root = workspaceRoot.replace(/[\\/]+$/, '')
  const rel = relativePath.replace(/^[\\/]+/, '')
  return `${root}/${rel}`
}

/**
 * Read the top-level entries of every working folder in parallel so the
 * current turn can ship the folder structure to the model. Runs on every
 * send (cheap — one shallow readdir per folder) so the listing reflects the
 * folder as it is right now, not when it was first selected. Unreadable
 * folders resolve to an error entry rather than rejecting the whole turn.
 */
async function fetchFolderListings(folders: string[]): Promise<Map<string, FolderListing>> {
  const map = new Map<string, FolderListing>()
  await Promise.all(
    folders.map(async (f) => {
      try {
        map.set(f, await window.api.upload.listFolder(f))
      } catch {
        map.set(f, { entries: [], truncated: false, error: 'unreadable' })
      }
    })
  )
  return map
}

/**
 * Render one working folder as a bullet with its top-level contents indented
 * beneath. Directories get a trailing slash so the model can tell them from
 * files at a glance. Falls back to the bare path when no listing is available
 * (e.g. the read failed or hasn't run).
 */
function formatWorkingFolder(folder: string, listing?: FolderListing): string {
  if (!listing) return `- ${folder}`
  if (listing.error) return `- ${folder} (could not read contents: ${listing.error})`
  if (listing.entries.length === 0) return `- ${folder} (empty)`
  const items = listing.entries
    .map((e) => `    ${e.isDirectory ? `${e.name}/` : e.name}`)
    .join('\n')
  let more = ''
  if (listing.truncated) {
    const files = listing.omittedFiles ?? 0
    const folders = listing.omittedDirectories ?? 0
    more = `\n    … and ${files} more file${files === 1 ? '' : 's'} and ${folders} more folder${folders === 1 ? '' : 's'} omitted`
  }
  return `- ${folder}\n${items}${more}`
}

/**
 * Build the LLM-facing content string for a user turn. Text comes first
 * (when present); attachments are appended as a bullet list under a
 * sentinel header so the model has unambiguous metadata to act on
 * (filename, type, size, absolute path). The sentinel uses pseudo-XML
 * rather than markdown so it survives copy-paste between providers
 * without bullets collapsing. The path is rendered as an absolute path
 * so the model can pass it straight to ffmpeg/ffprobe/etc. — guessing a
 * root (e.g. macOS "Application Support") leads to file-not-found.
 */
function composeHistoryContent(
  text: string,
  attachments: MessageAttachment[],
  workspaceRoot: string | null,
  workingFolders?: string[],
  previousFolders?: string[],
  folderListings?: Map<string, FolderListing>
): string {
  const parts: string[] = []
  if (workingFolders && workingFolders.length > 0) {
    const folderList = workingFolders
      .map((f) => formatWorkingFolder(f, folderListings?.get(f)))
      .join('\n')
    parts.push(
      `<working_folders>\nThe user has set the following working directories. The top-level contents of each are listed so you already have the structure — you don't need to list these again unless you need deeper levels or suspect they changed:\n${folderList}\nBe attentive that the user has pointed you to these folders. When the user references files, paths, or project context, assume they are relative to these directories unless stated otherwise.\n</working_folders>`
    )
  } else if (previousFolders && previousFolders.length > 0) {
    parts.push(
      `<working_folders_cleared>\nThe user has cleared their previously selected working folders (${previousFolders.join(', ')}). They are no longer the active working directories — disregard any earlier references to them as the current context unless the user mentions them again.\n</working_folders_cleared>`
    )
  }
  if (text) parts.push(text)
  if (attachments.length > 0) {
    const lines = attachments.map((a) => {
      const ext = a.originalName.includes('.')
        ? a.originalName.slice(a.originalName.lastIndexOf('.'))
        : ''
      const abs = toAbsoluteUploadPath(a.filePath, workspaceRoot)
      return `  - ${a.originalName} (type=${a.type}, mime=${a.mimeType}, size=${a.sizeBytes}b, path=${abs}${ext ? `, ext=${ext}` : ''})`
    })
    parts.push(
      `<attachments>\nThe user attached ${attachments.length} file${attachments.length === 1 ? '' : 's'} to this message:\n${lines.join('\n')}\n</attachments>`
    )
    const hasVideo = attachments.some((a) => a.type === 'video')
    if (hasVideo) {
      parts.push(
        `<video_instructions>\nOne or more attached files are videos. You cannot view or process video content directly. Instead, use ffmpeg via your shell tool to read the video metadata and inspect the file. Start by running: ffmpeg -hide_banner -i "<path>" for each video file — its stderr reports duration, resolution, codecs and streams. (If ffprobe is available it gives structured JSON: ffprobe -v quiet -print_format json -show_format -show_streams "<path>".) Use ffmpeg for any further video operations the user requests.\n</video_instructions>`
      )
    }
  }
  return parts.join('\n\n')
}

// Clipboard images (e.g. screenshots) often arrive as File objects with no
// useful name — fall back to a timestamp + the mime-derived extension so the
// saved file is still recognizable on disk.
function pastedFileName(file: File): string {
  if (file.name && file.name !== 'image.png') return file.name
  const ext = file.type.includes('/') ? file.type.split('/')[1] : 'bin'
  return `pasted-${Date.now()}.${ext || 'bin'}`
}

function hasFiles(e: React.DragEvent<HTMLDivElement>): boolean {
  const types = e.dataTransfer?.types
  if (!types) return false
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'Files') return true
  }
  return false
}

function formatTokensCompact(n: number, locale: string): string {
  // Hand-rolled k/m/b suffix so the unit letters stay Latin in every
  // locale (matches how technical token counts are usually displayed).
  // The numeric portion is locale-formatted so RTL users see the right
  // decimal separator.
  const fmt = (value: number): string => {
    try {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)
    } catch {
      return String(value)
    }
  }
  if (n >= 1_000_000_000) return `${fmt(n / 1_000_000_000)}b`
  if (n >= 1_000_000) return `${fmt(n / 1_000_000)}m`
  if (n >= 1_000) return `${fmt(n / 1_000)}k`
  return fmt(n)
}

function formatElapsed(ms: number, t: (k: string, v?: Record<string, unknown>) => string): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) {
    return t('chat.status.elapsedSeconds', { seconds: totalSeconds })
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return t('chat.status.elapsedMinutes', { minutes, seconds })
}

type ValidationErrorType =
  | { code: 'file_too_large'; maxBytes: number }
  | { code: 'max_files_reached'; max: number }
  | { code: 'total_size_exceeded'; maxBytes: number }
  | { code: 'type_not_supported' }
  | { code: 'vision_not_supported'; model: string }

function validationErrorMessage(
  error: ValidationErrorType,
  t: (k: string, v?: Record<string, unknown>) => string
): string {
  switch (error.code) {
    case 'file_too_large':
      return t('chat.upload.fileTooLarge', { limit: formatBytes(error.maxBytes, 0) })
    case 'max_files_reached':
      return t('chat.upload.maxFiles', { count: error.max })
    case 'total_size_exceeded':
      return t('chat.upload.totalExceeded', { limit: formatBytes(error.maxBytes, 0) })
    case 'type_not_supported':
      return t('chat.upload.typeNotSupported')
    case 'vision_not_supported':
      return t('chat.upload.visionNotSupported', { model: error.model })
  }
}
