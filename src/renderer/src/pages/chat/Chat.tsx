import { ActiveModelChip } from '@components/common/active-model-chip/ActiveModelChip'
import { ApprovalCard } from '@components/common/approval-card/ApprovalCard'
import { AttachmentList } from '@components/common/attachment-list/AttachmentList'
import { AudioPlayer } from '@components/common/audio-player/AudioPlayer'
import { ContextMeter } from '@components/common/context-meter/ContextMeter'
import { ProviderErrorCard } from '@components/common/provider-error-card/ProviderErrorCard'
import { ToolCard } from '@components/common/tool-card/ToolCard'
import { TurnFooter } from '@components/common/turn-footer/TurnFooter'
import { UpdateCard } from '@components/common/update-card/UpdateCard'
import { CopyButton } from '@components/core/copy-button/CopyButton'
import { Markdown } from '@components/core/markdown/Markdown'
import {
  OllamaLogo,
  TelegramLogo,
  WhatsAppLogo
} from '@components/core/provider-logos/ProviderLogos'
import { useToast } from '@components/core/toast/useToast'
import { Tooltip } from '@components/core/tooltip/Tooltip'
import { RTL_LOCALES } from '@lib/i18n'
import { cn } from '@lib/utils/cn/cn'
import type {
  ConversationChannel,
  ConversationFile,
  MessageAttachment,
  Segment
} from '@preload/index'
import {
  useFlow,
  type ApprovalCardState,
  type AssistantMessage,
  type ChatMessage,
  type ToolTiming
} from '@providers/flow/useFlow'
import { useLocale } from '@providers/locale/useLocale'
import iconTransparent from '@resources/images/icon_transparent.png'
import {
  Activity04Icon,
  ArrowUp02Icon,
  HeartCheckIcon,
  CancelCircleIcon,
  Clock01Icon,
  CloudIcon,
  CloudUploadIcon,
  Delete02Icon,
  FileEditIcon,
  Folder01Icon,
  Image02Icon,
  Mic01Icon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
  Settings02Icon,
  StopCircleIcon
} from 'hugeicons-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

// On macOS the OS draws traffic lights in our chrome (titleBarStyle: 'hiddenInset'),
// so we float the action buttons into that strip. On Windows/Linux the OS still
// draws a full title bar above the renderer, so the buttons stay in-flow below it.
const IS_MAC = /mac/i.test(navigator.userAgent)

type ToolResultSegment = Extract<Segment, { kind: 'tool_result' }>

export function Chat(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
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
  const [savingMode, setSavingMode] = useState(false)

  const onNewChat = useCallback(() => {
    setMessages([])
    setActiveConversationId(null)
  }, [setMessages, setActiveConversationId])

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

  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [storedFolders, setStoredFolders] = useState<string[]>([])
  const workingFolders = activeConversationId ? storedFolders : []
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
  const [, setContextTokens] = useState<number | null>(null)
  const [contextBudget, setContextBudget] = useState<number | null>(null)
  const [inputTokens, setInputTokens] = useState<number | null>(null)
  const [outputTokens, setOutputTokens] = useState<number | null>(null)
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null)
  // Set when the turn finishes; freezes the elapsed-time display until
  // the next message is sent. Stays visible between turns so the user
  // can see how long the last reply took.
  const [turnEndedAt, setTurnEndedAt] = useState<number | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const pendingTurnIdRef = useRef<string | null>(null)
  const conversationRef = useRef<ConversationFile | null>(null)
  const titleGeneratedRef = useRef(false)
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

  // Refresh vision support when the local model or local-only flag
  // changes. Cloud providers all support vision; only Ollama models can
  // come back as non-vision and need proactive UI gating.
  useEffect(() => {
    let cancelled = false
    void window.api.model.capabilities().then((caps) => {
      if (cancelled) return
      setModelVisionSupport({ supportsVision: caps.supportsVision, model: caps.model })
    })
    return () => {
      cancelled = true
    }
  }, [currentModel, localOnly])

  const persistConversation = useCallback(
    async (msgs: ChatMessage[]) => {
      const convMessages = msgs
        .filter((m) => {
          if (isUser(m)) return true
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
            timestamp: Date.now()
          }
        })

      if (convMessages.length === 0) return

      if (!conversationRef.current) {
        const conv = await window.api.conversation.create(currentModel)
        conversationRef.current = conv
        setActiveConversationId(conv.id)
        titleGeneratedRef.current = false
      }

      conversationRef.current.messages = convMessages
      conversationRef.current.updatedAt = Date.now()
      await window.api.conversation.save(conversationRef.current)

      if (!titleGeneratedRef.current && convMessages.length >= 2) {
        titleGeneratedRef.current = true
        window.api.conversation.generateTitle(conversationRef.current).then(({ title }) => {
          if (title && conversationRef.current) {
            conversationRef.current.title = title
            conversationRef.current.updatedAt = Date.now()
            void window.api.conversation.save(conversationRef.current)
          }
        })
      }
    },
    [currentModel, setActiveConversationId]
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
        titleGeneratedRef.current = conv.title !== 'Untitled'
        const raw = conv.workingFolder
        const folders = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
        setStoredFolders(folders)
        setFolderListOpen(false)
        sentFolderByConvRef.current.set(conv.id, folders)
      })
    } else {
      conversationRef.current = null
      titleGeneratedRef.current = false
    }
  }, [activeConversationId])

  const shouldPersistRef = useRef(false)

  useEffect(() => {
    if (shouldPersistRef.current) {
      shouldPersistRef.current = false
      void persistConversation(messages)
    }
  }, [messages, persistConversation])

  useEffect(() => {
    const offSegment = window.api.chat.onSegment((segment) => {
      if (pendingTurnIdRef.current !== segment.turnId) return
      setMessages((prev) => appendSegment(prev, segment))
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
      setMessages((prev) => markError(prev, turnId, error))
    })
    const offTurnEvent = window.api.chat.onTurnEvent(({ turnId, type, payload }) => {
      if (pendingTurnIdRef.current !== turnId) return
      if (type === 'context.built' && typeof payload.tokenCount === 'number') {
        setContextTokens(payload.tokenCount)
        if (typeof payload.tokenBudget === 'number') setContextBudget(payload.tokenBudget)
      } else if (type === 'llm.response') {
        if (typeof payload.inputTokens === 'number') setInputTokens(payload.inputTokens)
        if (typeof payload.outputTokens === 'number') setOutputTokens(payload.outputTokens)
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
    return () => {
      offSegment()
      offDone()
      offError()
      offTurnEvent()
      offApprovalRequest()
    }
  }, [setMessages])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

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
          titleGeneratedRef.current = loaded.title !== 'Untitled'
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
          titleGeneratedRef.current = false
        }
      }
      return activeConversationId
    }
    const conv = await window.api.conversation.create(currentModel)
    conversationRef.current = conv
    setActiveConversationId(conv.id)
    titleGeneratedRef.current = false
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
        ...(attachments.length > 0 ? { attachments } : {})
      }
      const assistantPlaceholder: AssistantMessage = {
        id: cryptoId(),
        role: 'assistant',
        segments: [],
        status: 'streaming'
      }
      // Prepend an attachment summary so the LLM knows what files came
      // along with this turn even though it can't read them. Tools like
      // stt_transcribe_upload can then pick up the file from this hint.
      const workspaceRoot = status?.rootPath ?? null
      const previousFolders = sentFolderByConvRef.current.get(conversationId) ?? []
      const historyContent = composeHistoryContent(
        trimmed,
        attachments,
        workspaceRoot,
        workingFolders,
        previousFolders
      )
      sentFolderByConvRef.current.set(conversationId, workingFolders)
      const currentEntry: {
        role: 'user'
        content: string
        attachments?: MessageAttachment[]
      } = { role: 'user', content: historyContent }
      if (attachments.length > 0) currentEntry.attachments = attachments
      const history = textHistory(messages, workspaceRoot).concat(currentEntry)

      setMessages((prev) => [...stripErrors(prev), userMessage, assistantPlaceholder])
      setStreaming(true)
      setTurnStartedAt(Date.now())
      setTurnEndedAt(null)

      const response = await window.api.chat.send({ history, conversationId })
      pendingTurnIdRef.current = response.turnId
      if (!response.ok && response.error) {
        pendingTurnIdRef.current = null
        setStreaming(false)
        setTurnEndedAt(Date.now())
        setMessages((prev) => markError(prev, response.turnId, response.error ?? 'unknown error'))
      }
    },
    [streaming, messages, setMessages, ensureConversationId, status?.rootPath, workingFolders]
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
      setMessages((prev) => [
        ...stripErrors(prev),
        {
          id: userMsgId,
          role: 'user',
          content: '',
          attachments: [attachment],
          transcribing: true
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
      // the agent doesn't echo our UI marker back.
      const workspaceRoot = status?.rootPath ?? null
      const previousFolders = sentFolderByConvRef.current.get(conversationId) ?? []
      const historyContent = `<voice_note>\n${composeHistoryContent(
        transcript,
        [attachment],
        workspaceRoot,
        workingFolders,
        previousFolders
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
        status: 'streaming'
      }
      setMessages((prev) => [...prev, assistantPlaceholder])
      setStreaming(true)
      setTurnStartedAt(Date.now())
      setTurnEndedAt(null)

      const response = await window.api.chat.send({ history, conversationId })
      pendingTurnIdRef.current = response.turnId
      if (!response.ok && response.error) {
        pendingTurnIdRef.current = null
        setStreaming(false)
        setTurnEndedAt(Date.now())
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
    workingFolders
  ])

  const stop = useCallback(() => {
    void window.api.chat.cancel()
  }, [])

  const onRetry = useCallback(() => {
    if (streaming) return
    const last = lastUserContent(messages)
    if (!last) return
    void sendContent(last)
  }, [messages, streaming, sendContent])

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

  return (
    <main
      className="bg-bg relative flex h-full w-full flex-col pt-10"
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
      <header
        dir="ltr"
        className={cn(
          'flex items-center gap-1',
          IS_MAC ? 'fixed top-0 right-0 z-50 h-9 px-2 [-webkit-app-region:drag]' : 'px-4 py-2'
        )}
      >
        {currentModel && (
          <>
            <Tooltip content={t('chat.workspace')}>
              <button
                type="button"
                onClick={() => goTo('viewer')}
                disabled={streaming}
                aria-label={t('chat.workspace')}
                className={cn(
                  'text-muted hover:text-fg flex cursor-pointer items-center justify-center rounded-lg p-1.5',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted'
                )}
              >
                <FileEditIcon size={14} />
              </button>
            </Tooltip>
            <Tooltip content={t('chat.heartbeat')}>
              <button
                type="button"
                onClick={() => goTo('heartbeat')}
                disabled={streaming}
                aria-label={t('chat.heartbeat')}
                className={cn(
                  'text-muted hover:text-fg flex cursor-pointer items-center justify-center rounded-lg p-1.5',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted'
                )}
              >
                <HeartCheckIcon size={14} />
              </button>
            </Tooltip>
            <Tooltip content={t('chat.history')}>
              <button
                type="button"
                onClick={() => goTo('history')}
                disabled={streaming}
                aria-label={t('chat.history')}
                className={cn(
                  'text-muted hover:text-fg flex cursor-pointer items-center justify-center rounded-lg p-1.5',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted'
                )}
              >
                <Clock01Icon size={14} />
              </button>
            </Tooltip>
            <Tooltip content={t('chat.settings')} align="end">
              <button
                type="button"
                onClick={() => goTo('settings')}
                disabled={streaming}
                aria-label={t('chat.settings')}
                className={cn(
                  'text-muted hover:text-fg flex cursor-pointer items-center justify-center rounded-lg p-1.5',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted'
                )}
              >
                <Settings02Icon size={14} />
              </button>
            </Tooltip>
          </>
        )}
      </header>

      <div ref={scrollerRef} className="relative flex-1 overflow-y-auto px-6 py-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-6 pt-2">
          <div className="pointer-events-auto">
            <UpdateCard />
          </div>
        </div>
        <div
          className={cn(
            'mx-auto flex max-w-2xl flex-col gap-4',
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
            </div>
          )}
          {messages.map((m) => (
            <ChatItem
              key={m.id}
              message={m}
              t={t}
              awaitingApproval={awaitingApproval}
              onApprovalDecision={respondApproval}
              onRetry={onRetry}
            />
          ))}
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
          className="border-border/60 bg-bg/80 relative border-t p-4 backdrop-blur"
        >
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
                  workingFolders.length > 0
                    ? () => setFolderListOpen((p) => !p)
                    : addWorkingFolder
                }
                disabled={streaming}
                title={
                  workingFolders.length > 0
                    ? t('chat.workingFolder')
                    : t('chat.selectFolder')
                }
                aria-label={
                  workingFolders.length > 0
                    ? t('chat.workingFolder')
                    : t('chat.selectFolder')
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
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setFolderListOpen(false)}
                  />
                  <div className="border-border bg-surface text-fg absolute bottom-full start-0 z-20 mb-2 rounded-lg border px-2 py-2 text-xs shadow-md min-w-[200px] max-w-[280px]">
                    <div className="text-muted mb-1.5 text-[10px] font-medium uppercase tracking-wide whitespace-nowrap">
                      {t('chat.workingFolder')}
                    </div>
                    <div dir="ltr" className="space-y-1.5">
                      {workingFolders.map((folder) => (
                        <div
                          key={folder}
                          className="flex items-center gap-1.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div
                              className="truncate text-xs"
                              title={folder}
                            >
                              {folder.split('/').pop()}
                            </div>
                            <code
                              className="border-border bg-bg text-muted mt-0.5 block max-w-[220px] truncate rounded border px-1 py-0.5 font-mono text-[9px]"
                              title={folder}
                            >
                              {folder}
                            </code>
                          </div>
                          <button
                            type="button"
                            onClick={() => void removeWorkingFolder(folder)}
                            className="text-muted/40 hover:text-red-500 shrink-0 cursor-pointer transition-colors"
                            title="Remove"
                          >
                            <Delete02Icon size={12} />
                          </button>
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
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (!streaming) void send()
                    }
                  }}
                  rows={1}
                  placeholder={t('chat.placeholder')}
                  dir={isRtl ? 'rtl' : 'ltr'}
                  className={cn(
                    'bg-surface text-fg border-border placeholder:text-muted hover:border-muted',
                    'min-h-10 max-h-40 flex-1 resize-none rounded-lg border px-3 py-2 text-sm',
                    'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                    placeholderAlign
                  )}
                />
                <button
                  type="submit"
                  disabled={
                    !streaming && draft.trim().length === 0 && pendingAttachments.length === 0
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
                    used={inputTokens ?? 0}
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
                  turnStartedAt={turnStartedAt}
                  turnEndedAt={turnEndedAt}
                  locale={locale}
                />
              </div>
            )}
          </div>
        </form>
      )}
    </main>
  )
}

function ChatItem({
  message,
  t,
  awaitingApproval,
  onApprovalDecision,
  onRetry
}: {
  message: ChatMessage
  t: (k: string, opts?: Record<string, unknown>) => string
  awaitingApproval: boolean
  onApprovalDecision: (id: string, decision: 'approved' | 'denied') => void
  onRetry: () => void
}): React.JSX.Element {
  if (message.role === 'user') {
    return (
      <UserBubble
        content={message.content}
        attachments={message.attachments}
        transcribing={message.transcribing}
        t={t}
      />
    )
  }
  return (
    <AssistantBubble
      message={message}
      t={t}
      awaitingApproval={awaitingApproval}
      onApprovalDecision={onApprovalDecision}
      onRetry={onRetry}
    />
  )
}

function UserBubble({
  content,
  attachments,
  transcribing,
  t
}: {
  content: string
  attachments?: MessageAttachment[]
  transcribing?: boolean
  t: (k: string, opts?: Record<string, unknown>) => string
}): React.JSX.Element {
  const hasContent = content.length > 0
  const hasAttachments = !!attachments && attachments.length > 0
  return (
    <div className="flex w-full flex-col gap-1.5 items-end">
      {transcribing ? (
        <div className="bg-primary text-primary-fg max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed wrap-break-word">
          <span className="animate-pulse">{t('chat.voice.transcribing')}</span>
        </div>
      ) : (
        hasContent && (
          <div className="bg-primary text-primary-fg max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap wrap-break-word">
            {content}
          </div>
        )
      )}
      {hasAttachments && (
        <div className="flex w-full flex-col items-end gap-2">
          <AttachmentList attachments={attachments!} align="end" />
        </div>
      )}
    </div>
  )
}

function AssistantBubble({
  message,
  t,
  awaitingApproval,
  onApprovalDecision,
  onRetry
}: {
  message: AssistantMessage
  t: (k: string) => string
  awaitingApproval: boolean
  onApprovalDecision: (id: string, decision: 'approved' | 'denied') => void
  onRetry: () => void
}): React.JSX.Element {
  const isStreaming = message.status === 'streaming'
  const isError = message.status === 'error'
  const renderable = renderSegments(
    message.segments,
    message.approvals,
    message.toolTimings,
    onApprovalDecision,
    onRetry
  )
  const showThinking = isStreaming && renderable.empty
  const fullText = useMemo(() => collectText(message.segments), [message.segments])
  const showCopy = !isStreaming && !isError && fullText.length > 0

  if (isError && message.error) {
    return (
      <div className="flex flex-col gap-1 items-start">
        <div className="bg-surface border-border text-muted max-w-[85%] rounded-2xl border px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap wrap-break-word">
          <strong>{t('chat.errorPrefix')}:</strong> {message.error}
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2 items-start">
      {showThinking ? (
        <div className="bg-surface border-border text-fg max-w-[85%] rounded-2xl border px-4 py-2.5 text-sm leading-relaxed wrap-break-word">
          <span className="text-muted animate-pulse italic">
            {t(awaitingApproval ? 'chat.awaitingPermission' : 'chat.thinking')}
          </span>
        </div>
      ) : (
        renderable.blocks
      )}
      {showCopy && (
        <CopyButton
          text={fullText}
          variant="inline"
          ariaLabelKey="chat.copyMessage"
          className="px-2"
        />
      )}
    </div>
  )
}

type RenderResult = { blocks: ReactNode; empty: boolean }

function renderSegments(
  segments: Segment[],
  approvals: Record<string, ApprovalCardState> | undefined,
  toolTimings: Record<string, ToolTiming> | undefined,
  onApprovalDecision: (id: string, decision: 'approved' | 'denied') => void,
  onRetry: () => void
): RenderResult {
  const blocks: ReactNode[] = []
  let textBuffer = ''
  let textRun = 0
  // active_model is the upfront "who's handling this turn" chip. If the
  // cascade later falls over to local, the provider_change chip shows the
  // same info and the upfront chip becomes redundant — drop it.
  const hasProviderChange = segments.some((s) => s.kind === 'provider_change')
  // Defer rendering either chip until the cascade has actually committed
  // to a provider — i.e. real content (text or a tool call) has arrived.
  // Without this, a brief flicker shows: active_model chip flashes the
  // cloud model name, then swaps to the local one when the fallback
  // engages. Waiting for content means the chip appears once with the
  // final answer and stays put.
  const hasCommitted = segments.some((s) => s.kind === 'text' || s.kind === 'tool_call')

  const flushText = (): void => {
    if (textBuffer.length === 0) return
    textRun += 1
    // If the buffer is a bare wolffish-media image, render it without the
    // text-bubble wrapper so it displays like a shared photo — no border,
    // no background, no padding — just the image with rounded corners.
    const isMediaImage = /^!\[[^\]]*\]\(wolffish-media:\/\/[^)]+\)$/.test(textBuffer.trim())
    blocks.push(
      isMediaImage ? (
        <div key={`md-${textRun}`} className="self-start max-w-[85%]">
          <Markdown content={textBuffer} />
        </div>
      ) : (
        <div
          key={`md-${textRun}`}
          className="bg-surface border-border text-fg max-w-[85%] rounded-2xl border px-4 py-2.5 text-sm leading-relaxed self-start wrap-break-word"
        >
          <Markdown content={textBuffer} />
        </div>
      )
    )
    textBuffer = ''
  }

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx]
    if (seg.kind === 'text') {
      textBuffer += seg.delta
    } else if (seg.kind === 'tool_call') {
      flushText()
      const result = findResult(segments, seg.toolCallId)
      const approval = approvals?.[seg.toolCallId]
      const timing = toolTimings?.[seg.toolCallId]

      const voiceData = result?.status === 'success' ? parseVoiceResult(result.output) : null

      const imagePath = extractToolResultImage(result)

      if (voiceData) {
        blocks.push(<ToolCard key={seg.segmentId} call={seg} result={result} timing={timing} />)
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
      } else if (approval) {
        blocks.push(
          <ApprovalCard
            key={`appr_${seg.segmentId}`}
            state={approval}
            onDecision={(d) => onApprovalDecision(approval.approvalId, d)}
          />
        )
        if (approval.decision !== undefined) {
          blocks.push(<ToolCard key={seg.segmentId} call={seg} result={result} timing={timing} />)
        }
      } else {
        blocks.push(<ToolCard key={seg.segmentId} call={seg} result={result} timing={timing} />)
      }

      if (imagePath) {
        const src = imagePath.startsWith('wolffish-media://')
          ? imagePath
          : `wolffish-media://${imagePath.replace(/^.*?\.wolffish\/workspace\//, '')}`
        blocks.push(
          <div key={`img_${seg.segmentId}`} className="self-start max-w-[85%]">
            <img src={src} alt="Tool result" className="max-w-full rounded-xl" loading="lazy" />
          </div>
        )
      }
    } else if (seg.kind === 'tool_result') {
      // Already rendered alongside its tool_call.
      continue
    } else if (seg.kind === 'separator') {
      // Flush whatever text has accumulated into its own bubble, then
      // continue — the next text segment starts a new bubble.
      flushText()
    } else if (seg.kind === 'active_model') {
      if (hasProviderChange || !hasCommitted) continue
      // Each agent iteration emits its own active_model chip. If this
      // iteration produces no text or tool_call after the chip (e.g.
      // the agent ends silently after a voice_respond), the chip would
      // render as a stray bubble. Skip chips with no following content.
      if (!hasFollowingContent(segments, segIdx)) continue
      flushText()
      blocks.push(<ActiveModelChip key={seg.segmentId} provider={seg.provider} model={seg.model} />)
    } else if (seg.kind === 'provider_change') {
      if (!hasCommitted) continue
      if (!hasFollowingContent(segments, segIdx)) continue
      flushText()
      blocks.push(<ActiveModelChip key={seg.segmentId} provider={seg.to} model={seg.model} />)
    } else if (seg.kind === 'turn_end') {
      flushText()
      if (seg.stopReason === 'no_provider_available' && seg.providerError) {
        blocks.push(
          <ProviderErrorCard key={seg.segmentId} payload={seg.providerError} onRetry={onRetry} />
        )
      } else if (seg.stopReason === 'error') {
        blocks.push(<TurnFooter key={seg.segmentId} stopReason={seg.stopReason} />)
      }
    }
  }

  flushText()
  return { blocks: <>{blocks}</>, empty: blocks.length === 0 }
}

function hasFollowingContent(segments: Segment[], fromIdx: number): boolean {
  for (let i = fromIdx + 1; i < segments.length; i++) {
    const k = segments[i].kind
    if (k === 'text' || k === 'tool_call') return true
  }
  return false
}

function PendingAttachmentChip({
  attachment,
  onRemove
}: {
  attachment: MessageAttachment
  onRemove: () => void
}): React.JSX.Element {
  const sizeKb = Math.max(1, Math.round(attachment.sizeBytes / 1024))
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
      <span className="text-muted shrink-0 tabular-nums text-[10px]">{sizeKb} KB</span>
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
  turnStartedAt,
  turnEndedAt,
  locale
}: {
  inputTokens: number | null
  outputTokens: number | null
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
  const parts: string[] = [
    formatElapsed(elapsedMs, t),
    t('chat.status.tokenUsage', {
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

function ModeToggle({
  value,
  onChange,
  disabled
}: {
  value: boolean
  onChange: (next: boolean) => void
  disabled: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const modes: {
    key: 'local' | 'cloud'
    label: string
    Icon: React.ComponentType<{ size?: number }>
  }[] = [
    { key: 'local', label: t('chat.modeToggle.local'), Icon: OllamaLogo },
    { key: 'cloud', label: t('chat.modeToggle.cloud'), Icon: CloudIcon }
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
        return (
          <button
            key={m.key}
            role="tab"
            type="button"
            disabled={disabled}
            aria-selected={active}
            onClick={() => onChange(m.key === 'local')}
            className={cn(
              'flex w-14 cursor-pointer flex-col items-center gap-0.5 rounded-md px-1.5 py-1',
              'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              active
                ? 'bg-primary text-primary-fg'
                : cn('text-muted', !disabled && 'hover:text-fg'),
              disabled && 'cursor-not-allowed opacity-60'
            )}
          >
            <Icon size={14} />
            <span className="text-[10px] leading-tight font-medium">{m.label}</span>
          </button>
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

const IMAGE_EXTS_RE = /\.(?:png|jpe?g|gif|webp)$/i

function extractToolResultImage(result?: ToolResultSegment): string | null {
  if (!result?.output || result.status !== 'success') return null
  const output = result.output.trim()
  try {
    const parsed = JSON.parse(output)
    if (typeof parsed?.path === 'string' && IMAGE_EXTS_RE.test(parsed.path)) {
      return parsed.path
    }
    if (typeof parsed?.media_url === 'string') return parsed.media_url
  } catch {
    /* not JSON */
  }
  const m = output.match(/(\/[^\s",:)]+\.(?:png|jpe?g|gif|webp))\b/i)
  if (m) return m[1]
  return null
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

function stripErrors(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => !(isAssistant(m) && m.status === 'error'))
}

function textHistory(
  messages: ChatMessage[],
  workspaceRoot: string | null
): Array<{ role: 'user' | 'assistant'; content: string; attachments?: MessageAttachment[] }> {
  const out: Array<{
    role: 'user' | 'assistant'
    content: string
    attachments?: MessageAttachment[]
  }> = []
  for (const m of messages) {
    if (isUser(m)) {
      const content = composeHistoryContent(m.content, m.attachments ?? [], workspaceRoot)
      const entry: { role: 'user'; content: string; attachments?: MessageAttachment[] } = {
        role: 'user',
        content
      }
      if (m.attachments && m.attachments.length > 0) entry.attachments = m.attachments
      out.push(entry)
    } else if (isAssistant(m) && m.status === 'complete') {
      const text = collectText(m.segments)
      if (text.length > 0) out.push({ role: 'assistant', content: text })
    }
  }
  return out
}

function lastUserContent(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (isUser(m)) return m.content
  }
  return null
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
  previousFolders?: string[]
): string {
  const parts: string[] = []
  if (workingFolders && workingFolders.length > 0) {
    const folderList = workingFolders.map((f) => `- ${f}`).join('\n')
    parts.push(
      `<working_folders>\nThe user has set the following working directories:\n${folderList}\nBe attentive that the user has pointed you to these folders. When the user references files, paths, or project context, assume they are relative to these directories unless stated otherwise.\n</working_folders>`
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
  | { code: 'video_not_allowed' }
  | { code: 'vision_not_supported'; model: string }

function validationErrorMessage(
  error: ValidationErrorType,
  t: (k: string, v?: Record<string, unknown>) => string
): string {
  switch (error.code) {
    case 'file_too_large':
      return t('chat.upload.fileTooLarge', { limit: formatBytes(error.maxBytes) })
    case 'max_files_reached':
      return t('chat.upload.maxFiles', { count: error.max })
    case 'total_size_exceeded':
      return t('chat.upload.totalExceeded', { limit: formatBytes(error.maxBytes) })
    case 'type_not_supported':
      return t('chat.upload.typeNotSupported')
    case 'video_not_allowed':
      return t('chat.upload.videoNotAllowed')
    case 'vision_not_supported':
      return t('chat.upload.visionNotSupported', { model: error.model })
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(0)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}
