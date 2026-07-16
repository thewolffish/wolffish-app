import type { Segment, SegmentTurnEndReason, ToolResultStatus } from '@main/runtime/broca'
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

export type { Segment, SegmentTurnEndReason, ToolResultStatus }

export type ThemeSource = 'system' | 'light' | 'dark'
export type Locale = 'en' | 'ar'

export type ThemeState = {
  themeSource: ThemeSource
  shouldUseDarkColors: boolean
}

export type ModelFamily = 'gemma' | 'qwen' | 'llama' | 'deepseek' | 'kimi'
export type SizeKey = 'nano' | 'mini' | 'compact' | 'standard' | 'pro' | 'max' | 'extreme' | 'ultra'

export type ModelEntry = {
  family: ModelFamily
  sizeKey: SizeKey
  ollamaName: string
  sizeBytes: number
  ramBytes: number
  paramsBillions?: number
  releaseDate?: string
}

export type SystemInfo = {
  totalRamBytes: number
  freeDiskBytes: number | null
  totalDiskBytes: number | null
  platform: NodeJS.Platform
  arch: string
  cpuCount: number
  cpuModel: string
}

export type LocalModelConfig = {
  enabled: boolean
  provider: 'ollama'
  model: string | null
  endpoint: string
}

export type CloudProviderConfig = {
  id:
    | 'anthropic'
    | 'openai'
    | 'openrouter'
    | 'deepseek'
    | 'mimo'
    | 'kimi'
    | 'minimax'
    | 'xai'
    | 'qwen'
    | 'stepfun'
    | 'zai'
  model: string
  apiKey: string
  models?: string[]
  reasoningModels?: string[]
}

export type SafetyConfig = {
  bypassPermissions: boolean
  blockCredentials: boolean
}

export type TelegramConfig = {
  enabled: boolean
  botToken: string
  allowedUserIds: number[]
  autoRefresh?: boolean
  staleHours?: number
  /**
   * When true, every tool call/result/activity is relayed to the chat
   * (full transparency). When false (default), only agent messages,
   * file-bearing tool results, and errors are sent — a clean feed.
   * Affects sending only; history persistence is unchanged.
   */
  verbose?: boolean
  /** Keep automation runs out of the /resume picker (on by default). */
  hideAutomationsFromResume?: boolean
}

export type WhatsAppConfig = {
  enabled: boolean
  allowedPhoneNumbers: string[]
  autoRefresh?: boolean
  staleHours?: number
  /**
   * When true, every tool call/result/activity is relayed to the chat
   * (full transparency). When false (default), only agent messages,
   * file-bearing tool results, and errors are sent — a clean feed.
   * Affects sending only; history persistence is unchanged.
   */
  verbose?: boolean
  /** Keep automation runs out of the /resume picker (on by default). */
  hideAutomationsFromResume?: boolean
}

/**
 * In-app (desktop) chat display preferences. Mirrors the Telegram /
 * WhatsApp verbose toggle, but for the primary renderer feed: when false
 * (default) the in-app chat shows a clean feed — agent replies,
 * file-bearing tool results, errors, and the model chip — and hides
 * tool-activity and compaction cards. Display-only; history is unaffected.
 */
export type InAppConfig = {
  verbose?: boolean
}

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

export type WhatsAppApi = {
  getConfig: () => Promise<WhatsAppConfig>
  setConfig: (
    patch: Partial<WhatsAppConfig>
  ) => Promise<{ ok: true; status: WhatsAppChannelStatus; config: WhatsAppConfig }>
  status: () => Promise<WhatsAppChannelStatus>
  logout: () => Promise<void>
  requestQr: () => Promise<void>
  onQr: (callback: (qr: string) => void) => () => void
  onStatusChange: (callback: (status: WhatsAppChannelStatus) => void) => () => void
}

export type InAppApi = {
  getConfig: () => Promise<InAppConfig>
  setConfig: (patch: Partial<InAppConfig>) => Promise<{ ok: true; config: InAppConfig }>
  onConfigChange: (callback: (config: InAppConfig) => void) => () => void
}

// MCP connection views. Mirrors src/main/runtime/mcp/types.ts (the
// preload re-declares main types by convention) — keep both in sync.
export type McpTransportKind = 'stdio' | 'http'

export type McpServerState = 'connected' | 'connecting' | 'needs-auth' | 'offline' | 'disabled'

/**
 * One custom HTTP header for a remote server. Persisted plaintext;
 * `sensitive` only masks the value in the settings UI.
 */
export type McpHeader = {
  key: string
  value: string
  sensitive?: boolean
}

export type McpServerSnapshot = {
  id: string
  name: string
  slug: string
  transport: McpTransportKind
  target: string
  enabled: boolean
  state: McpServerState
  toolCount: number
  toolNames: string[]
  /** http: the configured custom headers (values raw; UI masks sensitive ones). */
  headers?: McpHeader[]
  serverName?: string
  serverVersion?: string
  error?: string
  /** Live connect-progress line, present only while state is `connecting`. */
  progress?: string
  lastConnectedAt?: number
}

export type McpTestResult = {
  ok: boolean
  toolCount?: number
  durationMs?: number
  error?: string
}

export type McpAddInput = {
  name?: string
  target: string
  env?: Record<string, string>
  /** http custom headers. Ignored for stdio targets. */
  headers?: McpHeader[]
}

export type McpAddResult = { ok: true; server: McpServerSnapshot } | { ok: false; error: string }

export type McpApi = {
  list: () => Promise<McpServerSnapshot[]>
  add: (input: McpAddInput) => Promise<McpAddResult>
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>
  setEnabled: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
  setHeaders: (id: string, headers: McpHeader[]) => Promise<{ ok: boolean; error?: string }>
  test: (id: string) => Promise<McpTestResult>
  authorize: (id: string) => Promise<{ ok: boolean; error?: string }>
  onStatusChange: (callback: (servers: McpServerSnapshot[]) => void) => () => void
}

export type SttConfig = {
  defaultModel: string
}

export type TtsConfig = {
  defaultVoice: string
  defaultSpeed: string
}

export type Variable = {
  name: string
  value: string
  sensitive: boolean
}

export type WeekStartsOn = 0 | 1

export type WorkspaceConfig = {
  version: 1
  launchAtStartup?: boolean
  ollamaModelsFolder?: string
  llm: {
    local: LocalModelConfig
    providers: CloudProviderConfig[]
    /** The single user-chosen cloud model — the Brain. */
    brain?: BrainSelection | null
    /** Chat mode: 'single' (default, solo turns) vs 'workflow' (model-led agents). */
    mode?: 'single' | 'workflow'
    localOnly?: boolean
    restrictPowerfulModels?: boolean
    /** Per-model thinking mode. Key is model name, value is ThinkingMode. */
    thinkingModes?: Record<string, ThinkingMode>
  }
  safety?: SafetyConfig
  weekStartsOn?: WeekStartsOn
  variables?: Variable[]
  telegram?: TelegramConfig
  whatsapp?: WhatsAppConfig
  inapp?: InAppConfig
  stt?: SttConfig
  tts?: TtsConfig
  computerUse?: ComputerUseConfig
  browserExtension?: BrowserExtensionConfig
  updates?: UpdatesConfig
  lastSettingsState?: {
    tab?: string
    provider?: string
    channel?: string
    service?: string
    hippocampusTab?: string
    sidebarCollapsed?: string
    rightSidebarCollapsed?: string
  }
  locale: Locale
  theme: ThemeSource
  onboardingCompleted: boolean
}

export type WorkspaceStatus = {
  rootPath: string
  initialized: boolean
  hasLocalModel: boolean
  onboardingCompleted: boolean
  config: WorkspaceConfig | null
}

export type OllamaTag = { name: string; size: number }

export type PullProgressEvent = {
  modelName: string
  status: string
  completed: number | null
  total: number | null
}

export type PullDoneEvent =
  | { modelName: string; ok: true }
  | { modelName: string; ok: false; error: string; aborted: boolean }

export type SelectModelResult =
  | { ok: true; alreadyDownloaded?: boolean; alreadyRunning?: boolean }
  | { ok: false; error: string; aborted: boolean }

export type PersistedApproval = {
  approvalId: string
  toolCallId: string
  tool: string
  args: Record<string, unknown>
  reason: string
  level: DangerLevel
  description?: ApprovalDescription
  decision?: ApprovalDecision
}

export type PersistedToolTiming = {
  startedAt: number
  endedAt?: number
}

export type MessageAttachmentType = 'audio' | 'video' | 'image' | 'pdf' | 'other'

export type MessageAttachment = {
  type: MessageAttachmentType
  /** Path relative to workspace root, e.g. "uploads/conv-2026-05-01_14-30-45/photo.png". */
  filePath: string
  originalName: string
  mimeType: string
  sizeBytes: number
  width?: number
  height?: number
  durationSeconds?: number
}

export type ConversationMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  segments?: Segment[]
  approvals?: Record<string, PersistedApproval>
  toolTimings?: Record<string, PersistedToolTiming>
  stopReason?: SegmentTurnEndReason
  error?: string
  attachments?: MessageAttachment[]
  /** Set when this user message is a voice transcript — the audio attachment must not be exposed to the LLM. */
  voicePrompt?: boolean
  /** Whisper's detected language for a voicePrompt message (ISO 639-1). */
  voiceLang?: string
}

export type ConversationChannel = 'electron' | 'telegram' | 'whatsapp' | 'heartbeat' | 'procedure'

export type TimelineEntry = {
  id: string
  timestamp: number
  kind: string
  summary?: string
  detail?: string
}

/** Frozen roll-up of the most recent completed turn (dual decl — see src/main/conversations.ts). */
export type ConversationTurnStats = {
  endedAt: number
  elapsedMs: number
  apiMs: number
  apiCalls: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  cost: number
  provider: string | null
  model: string | null
}

/** Persisted per-conversation tokenomics (dual decl — see src/main/conversations.ts). */
export type ConversationStats = {
  /**
   * Lifetime totals for this conversation. Includes workflow-agent spend;
   * accrues from the first turn after this feature shipped for pre-existing
   * conversations.
   */
  allTime: {
    processingMs: number
    apiMs: number
    turns: number
    apiCalls: number
    toolCalls: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    cost: number
  }
  lastTurn: ConversationTurnStats | null
  /**
   * Context-meter snapshot at last save. `model` records which model the
   * reading was measured under so a reload never divides an old model's
   * numerator by a different model's window.
   */
  meter: {
    contextTokens: number
    contextBudget: number
    compactionAt?: number | null
    model?: string | null
  } | null
}

export type ConversationFile = {
  id: string
  title: string
  model: string | null
  messages: ConversationMessage[]
  createdAt: number
  updatedAt: number
  channel?: ConversationChannel
  sealed?: boolean
  workingFolder?: string[] | null
  /** Legacy meter snapshot — superseded by `stats.meter`, still read as a fallback. */
  contextMeter?: { contextTokens: number; contextBudget: number } | null
  stats?: ConversationStats | null
  timeline?: TimelineEntry[]
  /** Rolling prefix summary — see src/main/conversations.ts (dual decl). */
  summary?: string | null
  /** First message index NOT covered by `summary` (always a user message). */
  summarizedThroughMessage?: number | null
}

export type ConversationMeta = {
  id: string
  title: string
  updatedAt: number
  channel?: ConversationChannel
  messageCount: number
}

export type ChatHistoryAttachment = {
  type: MessageAttachmentType
  filePath: string
  originalName: string
  mimeType: string
  sizeBytes: number
}

export type ChatHistoryMessage =
  | {
      role: 'user'
      content: string
      attachments?: ChatHistoryAttachment[]
      reasoningContent?: string
    }
  | {
      role: 'assistant'
      content: string
      toolUses?: Array<{ id: string; name: string; args: Record<string, unknown> }>
      reasoningContent?: string
    }
  | {
      role: 'tool'
      toolUseId: string
      toolName: string
      content: string
      isError?: boolean
    }
export type ChatDoneEvent = { turnId: string; conversationId: string | null }
export type ChatErrorEvent = { turnId: string; conversationId: string | null; error: string }

/**
 * Turn lifecycle broadcast (chat:turnState) — fired for EVERY channel's
 * turns (in-app, WhatsApp, Telegram) so the Conversations sidebar can show
 * live status chips without owning the turn.
 */
export type ChatTurnStateEvent = {
  phase: 'started' | 'done' | 'canceled' | 'error'
  turnId: string
  conversationId: string | null
  channel: string
  title?: string | null
  error?: string
}

export type ChatTurnEvent = {
  turnId: string
  conversationId: string | null
  type:
    | 'context.built'
    | 'llm.response'
    | 'turn.usage'
    | 'task.created'
    | 'task.stepCompleted'
    | 'task.completed'
    | 'task.failed'
    | 'task.stopped'
    | 'tool.called'
    | 'tool.completed'
    | 'tool.failed'
    | 'safety.allowed'
    | 'safety.blocked'
    | 'safety.approved'
    | 'safety.denied'
    | 'compaction.started'
    | 'compaction.applied'
  payload: Record<string, unknown>
}

export type DangerLevel = 'safe' | 'warn' | 'confirm' | 'destructive' | 'block'
export type ApprovalDecision = 'approved' | 'denied'

export type RiskLevel = 'low' | 'medium' | 'high'

export type ApprovalDescription = {
  title: string
  description: string
  command?: string
  impact?: string
  risk: RiskLevel
}

export type ChatApprovalRequestEvent = {
  turnId: string
  conversationId: string | null
  id: string
  toolCallId: string
  tool: string
  args: Record<string, unknown>
  level: DangerLevel
  reason: string
  description?: ApprovalDescription
}

/** One selectable choice on an ask-the-user question card. */
export type AskUserOption = {
  label: string
  description?: string
}

/** The user's answer to a question card, sent back to the main process. */
export type AskUserResponse =
  | { kind: 'option'; index: number }
  | { kind: 'custom'; text: string }
  | { kind: 'canceled' }
  | { kind: 'unsupported' }

/** Emitted when the agent asks the user a multiple-choice question. */
export type ChatAskRequestEvent = {
  turnId: string
  conversationId: string | null
  id: string
  toolCallId: string
  question: string
  details?: string
  options: AskUserOption[]
  allowOther: boolean
  otherLabel?: string
  otherDescription?: string
}

export type ChatCredentialBlockedEvent = {
  turnId: string
  conversationId: string | null
  type: string
}

export type ThemeApi = {
  get: () => Promise<ThemeState>
  set: (source: ThemeSource) => Promise<ThemeState>
  onUpdated: (listener: (state: ThemeState) => void) => () => void
}

export type LocaleApi = {
  get: () => Promise<Locale>
  set: (locale: Locale) => Promise<Locale>
}

export type SystemApi = {
  getInfo: () => Promise<SystemInfo>
}

export type WorkspaceApi = {
  getStatus: () => Promise<WorkspaceStatus>
  completeOnboarding: () => Promise<WorkspaceConfig>
  getModelCatalog: () => Promise<readonly ModelEntry[]>
}

export type AppClosingPendingEvent = { tasks: number }

export type AppApi = {
  factoryReset: () => Promise<void>
  onClosingPending: (listener: (event: AppClosingPendingEvent) => void) => () => void
}

export type DataAnalytics = {
  workspaceBytes: number
  hippocampusBytes: number
  corpusBytes: number
  prefrontalBytes: number
  ramBytes: number
  cpuPercent: number
  totalRamBytes: number
  cpuCount: number
}

export type DataApi = {
  getAnalytics: () => Promise<DataAnalytics>
}

export type LaunchAtStartupStatus = { active: boolean }

export type RuntimeApi = {
  setLaunchAtStartup: (value: boolean) => Promise<{ value: boolean; active: boolean }>
  getLaunchAtStartupStatus: () => Promise<LaunchAtStartupStatus>
  setBypassPermissions: (value: boolean) => Promise<{ value: boolean }>
  setBlockCredentials: (value: boolean) => Promise<{ value: boolean }>
  setLocalOnly: (value: boolean) => Promise<{ value: boolean }>
  setRestrictPowerfulModels: (value: boolean) => Promise<{ value: boolean }>
  setThinkingMode: (model: string, mode: ThinkingMode) => Promise<void>
  setUpdatesEnabled: (value: boolean) => Promise<{ value: boolean }>
  setWeekStartsOn: (value: WeekStartsOn) => Promise<{ value: WeekStartsOn }>
  setLastSettingsState: (patch: Record<string, string>) => Promise<void>
  getCompactionConfig: () => Promise<CompactionConfig>
  setCompactionConfig: (patch: Partial<CompactionConfig>) => Promise<CompactionConfig>
}

export type CompactionConfig = {
  dailyHour: number
  weeklyDay: number
  weeklyHour: number
}

export type OllamaModelDetail = {
  name: string
  tag: string
  fullName: string
  sizeBytes: number
  family: string | null
  parameterSize: string | null
  quantization: string | null
  format: string | null
}

export type OllamaApi = {
  detect: () => Promise<{ reachable: boolean; installed: boolean }>
  installUrl: () => Promise<string>
  openInstallPage: () => Promise<{ opened: boolean }>
  start: () => Promise<{ ok: boolean; error?: string }>
  listInstalled: () => Promise<OllamaTag[]>
  scanAvailable: () => Promise<OllamaModelDetail[]>
  getModelsFolder: () => Promise<string>
  setModelsFolder: (folder: string) => Promise<{ ok: true; folder: string }>
  pickModelsFolder: () => Promise<string | null>
}

export type ModelCapabilities = {
  provider: string | null
  model: string | null
  supportsVision: boolean
  contextWindow: number
  /** Token count where auto-compaction triggers for this model. */
  compactionAt: number
}

export type ModelApi = {
  select: (modelName: string) => Promise<SelectModelResult>
  cancelPull: () => Promise<{ canceled: boolean }>
  clear: () => Promise<{ cleared: boolean }>
  status: () => Promise<{ model: string | null }>
  capabilities: () => Promise<ModelCapabilities>
  onPullProgress: (listener: (event: PullProgressEvent) => void) => () => void
  onPullDone: (listener: (event: PullDoneEvent) => void) => () => void
}

export type ProviderListEntry = {
  id: CloudProviderConfig['id']
  model: string
  apiKey: string
  models?: string[]
  reasoningModels?: string[]
}

export type ProviderTestErrorKind =
  | 'invalid_key'
  | 'rate_limited'
  | 'invalid_model'
  | 'network'
  | 'generic'

export type ProviderTestResult =
  | { ok: true; models: string[]; reasoningModels?: string[] }
  | { ok: false; kind: ProviderTestErrorKind; message?: string }

// `id` is null for events not tied to a specific provider (e.g. the Brain
// was cleared). Listeners that filter by provider id simply won't match.
export type ProviderUpdatedEvent = { id: CloudProviderConfig['id'] | null }

/** The single user-chosen cloud model — the Brain. */
export type BrainSelection = { providerId: CloudProviderConfig['id']; model: string }

export type ProviderApi = {
  list: () => Promise<ProviderListEntry[]>
  test: (payload: { id: CloudProviderConfig['id']; apiKey?: string }) => Promise<ProviderTestResult>
  save: (payload: {
    id: CloudProviderConfig['id']
    model: string
    apiKey?: string
    models?: string[]
    reasoningModels?: string[]
  }) => Promise<{ ok: true } | { ok: false; error: string }>
  remove: (id: CloudProviderConfig['id']) => Promise<{ ok: true }>
  setBrain: (brain: BrainSelection | null) => Promise<{ ok: true }>
  setMode: (mode: 'single' | 'workflow') => Promise<{ ok: true }>
  onUpdated: (listener: (event: ProviderUpdatedEvent) => void) => () => void
}

// Canonical reasoning scale (see src/main/runtime/reasoning.ts). Inlined here
// to keep the preload bundle decoupled from main.
export type ThinkingMode = 'off' | 'on' | 'high' | 'max'

export type ChatApi = {
  send: (payload: {
    history: ChatHistoryMessage[]
    conversationId?: string | null
    /** Active working-folder paths — the agent injects fresh listings into the outbound volatile tail. */
    workingFolders?: string[]
    thinkingMode?: ThinkingMode
    /** Per-turn chat-mode override (procedure Play honors the procedure's stamp). */
    modeOverride?: 'single' | 'workflow'
  }) => Promise<{ turnId: string; ok: boolean; error?: string }>
  /** Cancel one conversation's in-flight turn; omitted id cancels all. */
  cancel: (payload?: { conversationId?: string | null }) => Promise<{ canceled: boolean }>
  respondApproval: (payload: { id: string; decision: ApprovalDecision }) => Promise<{ ok: boolean }>
  respondAsk: (payload: { id: string; response: AskUserResponse }) => Promise<{ ok: boolean }>
  /** Save-dialog + Chromium print of a renderer-built transcript HTML. */
  exportPdf: (payload: {
    html: string
    fileName: string
  }) => Promise<{ ok: boolean; canceled?: boolean; error?: string }>
  onSegment: (
    listener: (segment: Segment & { conversationId?: string | null }) => void
  ) => () => void
  onDone: (listener: (event: ChatDoneEvent) => void) => () => void
  onError: (listener: (event: ChatErrorEvent) => void) => () => void
  onTurnEvent: (listener: (event: ChatTurnEvent) => void) => () => void
  onApprovalRequest: (listener: (event: ChatApprovalRequestEvent) => void) => () => void
  onAskRequest: (listener: (event: ChatAskRequestEvent) => void) => () => void
  onCredentialBlocked: (listener: (event: ChatCredentialBlockedEvent) => void) => () => void
  /** Turn lifecycle across ALL channels — backs the sidebar status chips. */
  onTurnState: (listener: (event: ChatTurnStateEvent) => void) => () => void
}

export type ConversationSummaryUpdate = {
  conversationId: string
  summary: string
  summarizedThroughMessage: number
}

export type ConversationApi = {
  list: () => Promise<ConversationMeta[]>
  load: (id: string) => Promise<ConversationFile | null>
  save: (conv: ConversationFile) => Promise<{ ok: true }>
  /** ok:false ⇒ refused (conversation has a turn in flight). */
  delete: (id: string) => Promise<{ ok: boolean }>
  create: (model: string | null) => Promise<ConversationFile>
  /**
   * Fired when the main-side rolling summarizer persisted a new prefix
   * summary. The renderer folds it into its in-memory conversation so the
   * next whole-file save preserves it and the next send replays lean.
   */
  onSummaryUpdated: (listener: (update: ConversationSummaryUpdate) => void) => () => void
  /**
   * Fired when a conversation was deleted anywhere (in-app History OR a
   * channel /delete). The sidebar prunes its live run-status so a
   * channel-side delete doesn't leave a ghost row.
   */
  onDeleted: (listener: (event: { id: string }) => void) => () => void
  /**
   * Fired when the conversation list-visible set may have changed on disk (a
   * conversation was created, renamed, appended, or removed and re-indexed).
   * Covers paths that emit no turn lifecycle — autonomous heartbeat/procedure
   * runs, create-without-turn, the sensitive-data gate — so the rail and
   * History refetch. Payload-free: the listener just re-lists.
   */
  onChanged: (listener: () => void) => () => void
}

export type ViewerTreeNode =
  | { type: 'dir'; name: string; relativePath: string; children: ViewerTreeNode[] }
  | { type: 'file'; name: string; relativePath: string }

export type UsageTimeRange = 'today' | 'this_month' | '3_months' | '6_months' | 'ytd' | 'all_time'

export type UsageProviderSummary = {
  provider:
    | 'anthropic'
    | 'openai'
    | 'openrouter'
    | 'deepseek'
    | 'mimo'
    | 'kimi'
    | 'minimax'
    | 'xai'
    | 'qwen'
    | 'stepfun'
    | 'zai'
    | 'local'
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number
  models: Array<{ model: string; inputTokens: number; outputTokens: number; cost: number }>
}

export type BraveUsageSummary = {
  totalQueries: number
  totalCost: number
}

export type UsageSummary = {
  providers: UsageProviderSummary[]
  brave: BraveUsageSummary
}

export type UsageStats = {
  messages: number
  conversations: number
  activeDays: number
  longestStreak: number
  totalTokens: number
  favouriteModel: string | null
}

export type UsageDailyEntry = {
  date: string
  totalTokens: number
}

export type UsageApi = {
  getSummary: (range: UsageTimeRange) => Promise<UsageSummary>
  getStats: (range: UsageTimeRange) => Promise<UsageStats>
  getDaily: (year: number) => Promise<UsageDailyEntry[]>
  sync: () => Promise<{ ok: true }>
}

export type ViewerApi = {
  readTree: () => Promise<ViewerTreeNode[]>
  readFile: (relativePath: string) => Promise<string>
  readBinaryFile: (relativePath: string) => Promise<ArrayBuffer>
  writeFile: (relativePath: string, content: string) => Promise<void>
  hasDefault: (relativePath: string) => Promise<boolean>
  readDefault: (relativePath: string) => Promise<string>
  stat: (relativePath: string) => Promise<{ mtimeMs: number }>
  download: (relativePath: string) => Promise<{ ok: boolean }>
  revealInFolder: (relativePath: string) => Promise<{ ok: boolean }>
  resync: () => Promise<ViewerTreeNode[]>
}

export type HeartbeatJobView = {
  id: string
  type: string
  cron: string | null
  label: string
  body: string
  /** The job's own chat mode (its `mode: …` marker); null ⇒ follows global. */
  mode: 'single' | 'workflow' | null
  nextRunMs: number | null
}

export type HeartbeatRunningJob = {
  id: string
  label: string
  body: string
  startedAt: number
  /** The run's own mode (stamped marker / procedure field); null ⇒ global. */
  mode: 'single' | 'workflow' | null
}

export type HeartbeatLogEntry = {
  id: string
  timestamp: number
  kind: 'text' | 'tool_call' | 'tool_result' | 'started' | 'completed' | 'failed' | 'skipped'
  summary: string
}

export type HeartbeatApi = {
  getJobs: () => Promise<HeartbeatJobView[]>
  getRunningJob: () => Promise<HeartbeatRunningJob | null>
  /** Run an automation on demand by id or exact heading label, bypassing its schedule. */
  runJob: (idOrLabel: string) => Promise<{ ok: boolean; started: boolean; error?: string }>
  onJobStarted: (listener: (job: HeartbeatRunningJob) => void) => () => void
  onJobEnded: (
    listener: (payload: { id: string; status: 'completed' | 'failed'; error?: string }) => void
  ) => () => void
  onJobLog: (listener: (entry: HeartbeatLogEntry) => void) => () => void
}

export type Procedure = {
  id: string
  title: string
  prompt: string
  /** The procedure's own chat mode; absent (legacy rows) ⇒ follows global. */
  mode?: 'single' | 'workflow'
  createdAt: number
  updatedAt: number
}

export type ProceduresApi = {
  list: () => Promise<Procedure[]>
  create: (payload: {
    title: string
    prompt: string
    mode?: 'single' | 'workflow'
  }) => Promise<Procedure>
  update: (payload: {
    id: string
    title?: string
    prompt?: string
    mode?: 'single' | 'workflow'
  }) => Promise<Procedure>
  delete: (id: string) => Promise<{ ok: true }>
}

export type ReindexStatus = {
  startedAt: number
  total: number
  done: number
}

export type ReindexApi = {
  getStatus: () => Promise<ReindexStatus | null>
  onStarted: (listener: (status: { startedAt: number; total: number }) => void) => () => void
  onProgress: (listener: (status: { done: number; total: number }) => void) => () => void
  onEnded: (listener: (payload: { filesCount: number; durationMs: number }) => void) => () => void
}

export type CapabilityEntry = {
  name: string
  description: string
  status: 'ok' | 'error'
  hasPlugin: boolean
  toolCount: number
  triggers: string[]
  requires: string[]
  official: boolean
  enabled: boolean
  error?: string
}

export type CapabilityImportSource = 'skill' | 'folder' | 'zip'

export type CapabilityImportResult =
  | {
      ok: true
      name: string
      folderName: string
      source: CapabilityImportSource
      hasPlugin: boolean
      toolCount: number
    }
  | { ok: false; error: string }

export type CapabilityDeleteResult =
  | { ok: true; capabilities: CapabilityEntry[] }
  | { ok: false; error: string }

export type CerebellumApi = {
  listCapabilities: () => Promise<CapabilityEntry[]>
  reload: () => Promise<CapabilityEntry[]>
  toggleCapability: (name: string, enabled: boolean) => Promise<void>
  /** Validate and import a dropped/picked SKILL.md, folder, or .zip. */
  importCapability: (sourcePath: string) => Promise<CapabilityImportResult>
  /** Open a native file/folder picker for the import dropzone. Null if canceled. */
  pickImport: (options?: { title?: string; filterName?: string }) => Promise<string | null>
  /** Delete a user-imported capability and nuke its folder. Refuses official ones. */
  deleteCapability: (name: string) => Promise<CapabilityDeleteResult>
}

export type VoiceApi = {
  readFile: (filePath: string) => Promise<ArrayBuffer>
  download: (filePath: string) => Promise<{ ok: boolean }>
  revealInFolder: (filePath: string) => Promise<{ ok: boolean }>
  exists: (filePath: string) => Promise<boolean>
}

export type UploadedFileMetadata = {
  type: MessageAttachmentType
  filePath: string
  originalName: string
  mimeType: string
  sizeBytes: number
  width?: number
  height?: number
  durationSeconds?: number
}

export type UploadFileMeta = {
  sizeBytes: number
  mtimeMs: number
  mimeType: string
}

export type VariablesApi = {
  list: () => Promise<Variable[]>
  save: (variables: Variable[]) => Promise<{ ok: true }>
}

/**
 * Kinds of telegram errors that the renderer can translate into a
 * locale-appropriate message. `unknown` falls back to the raw error
 * string from grammY/Telegram so we never silently swallow a useful
 * server message.
 */
export type TelegramErrorKind =
  | 'missing_token'
  | 'token_format'
  | 'invalid_token'
  | 'invalid_user_id'
  | 'rate_limit'
  | 'network'
  | 'unknown'

export type TelegramChannelStatus = {
  status: 'stopped' | 'starting' | 'running' | 'error'
  errorKind: TelegramErrorKind | null
  /** Raw error string from grammY/Telegram, useful when kind is `unknown`. */
  error: string | null
  /** Connected bot's @username, available once running. Null otherwise. */
  botUsername: string | null
  /** Connected bot's display name (first_name), available once running. */
  botName: string | null
}

export type TelegramTestResult =
  | { ok: true }
  | { ok: false; kind: TelegramErrorKind; message?: string }

export type TelegramApi = {
  getConfig: () => Promise<TelegramConfig>
  setConfig: (patch: Partial<TelegramConfig>) => Promise<{
    ok: true
    status: TelegramChannelStatus
    config: TelegramConfig
  }>
  status: () => Promise<TelegramChannelStatus>
  sendTestMessage: (payload: { token: string; userId: number }) => Promise<TelegramTestResult>
  onStatusChange: (callback: (status: TelegramChannelStatus) => void) => () => void
}

/**
 * Brave Search API. Stateless — the renderer just toggles a flag and sets
 * a key. The web-search cerebellum plugin reads the persisted config and
 * uses Brave as the primary provider when enabled, falling back to
 * DuckDuckGo on failure.
 */
export type BraveErrorKind =
  | 'missing_key'
  | 'invalid_key'
  | 'rate_limit'
  | 'subscription'
  | 'network'
  | 'unknown'

export type BraveStatus = {
  status: 'disabled' | 'configured' | 'error'
  errorKind: BraveErrorKind | null
  /** Raw error from the last test attempt, surfaced when kind is `unknown`. */
  error: string | null
}

export type BraveConfig = {
  enabled: boolean
  apiKey: string
}

export type BraveTestResult =
  | { ok: true; resultsCount: number }
  | { ok: false; kind: BraveErrorKind; message?: string }

export type BraveApi = {
  getConfig: () => Promise<BraveConfig>
  setConfig: (patch: Partial<BraveConfig>) => Promise<{
    ok: true
    status: BraveStatus
    config: BraveConfig
  }>
  status: () => Promise<BraveStatus>
  test: (apiKey: string) => Promise<BraveTestResult>
}

export type GoogleConfig = {
  status: 'inactive' | 'active'
  account: string
  clientId: string
  projectId: string
  credentialsStored: boolean
}

export type GoogleErrorKind =
  | 'platform_unsupported'
  | 'install_failed'
  | 'credentials_invalid'
  | 'auth_failed'
  | 'auth_timeout'
  | 'network'
  | 'unknown'

export type GoogleStatus = {
  status: 'inactive' | 'active' | 'error'
  errorKind: GoogleErrorKind | null
  error: string | null
}

export type GoogleBinaryStatus = {
  gogInstalled: boolean
  gogVersion: string | null
}

export type GoogleSetupResult =
  | { ok: true; binary: GoogleBinaryStatus }
  | { ok: false; kind: GoogleErrorKind; message?: string }

export type GoogleUpdateResult =
  | {
      ok: true
      updated: boolean
      version: string | null
      previousVersion?: string | null
    }
  | { ok: false; kind: GoogleErrorKind; message?: string }

export type GoogleSetupStateEvent = { stage: 'idle' | 'setup' | 'updating'; percent: number }
export type GoogleAuthUrlEvent = { url: string }

export type GoogleCredentialsResult =
  | { ok: true; clientId: string; projectId: string }
  | { ok: false; kind: GoogleErrorKind; message?: string }

export type GoogleAuthResult =
  | { ok: true; account: string }
  | { ok: false; kind: GoogleErrorKind; message?: string }

export type GoogleApi = {
  getConfig: () => Promise<GoogleConfig>
  setConfig: (patch: Partial<GoogleConfig>) => Promise<{
    ok: true
    status: GoogleStatus
    config: GoogleConfig
  }>
  status: () => Promise<GoogleStatus>
  checkBinary: () => Promise<GoogleBinaryStatus>
  setup: () => Promise<GoogleSetupResult>
  update: () => Promise<GoogleUpdateResult>
  getSetupState: () => Promise<GoogleSetupStateEvent>
  onSetupState: (listener: (event: GoogleSetupStateEvent) => void) => () => void
  onAuthUrl: (listener: (event: GoogleAuthUrlEvent) => void) => () => void
  uploadCredentials: (jsonContent: string) => Promise<GoogleCredentialsResult>
  deleteCredentials: () => Promise<{ ok: true } | { ok: false; message: string }>
  authAdd: (email: string) => Promise<GoogleAuthResult>
  cancelAuth: () => Promise<boolean>
  listAccounts: () => Promise<string[]>
  // Best-effort per-account token health: email → true (refresh token still
  // valid) / false (expired or revoked). Accounts we couldn't evaluate are
  // omitted, not marked unhealthy.
  checkAccounts: () => Promise<Record<string, boolean>>
  removeAccount: (
    email: string
  ) => Promise<{ ok: true; accounts: string[] } | { ok: false; message: string }>
}

export type NotionErrorKind =
  | 'missing_token'
  | 'invalid_token'
  | 'rate_limit'
  | 'network'
  | 'unknown'

export type NotionStatus = {
  status: 'disabled' | 'configured' | 'error'
  errorKind: NotionErrorKind | null
  error: string | null
}

export type NotionConnection = {
  id: string
  label: string
  token: string
  name: string
  email: string
}

export type NotionConfig = {
  connections: NotionConnection[]
}

export type NotionTestResult =
  | { ok: true; name: string; email: string | null }
  | { ok: false; kind: NotionErrorKind; message?: string }

export type NotionApi = {
  getConfig: () => Promise<NotionConfig>
  setConfig: (connections: NotionConnection[]) => Promise<{
    ok: true
    status: NotionStatus
    config: NotionConfig
  }>
  status: () => Promise<NotionStatus>
  test: (token: string) => Promise<NotionTestResult>
}

export type GitHubErrorKind =
  | 'missing_token'
  | 'invalid_token'
  | 'rate_limit'
  | 'insufficient_scope'
  | 'network'
  | 'unknown'

export type GitHubStatus = {
  status: 'disabled' | 'configured' | 'error'
  errorKind: GitHubErrorKind | null
  error: string | null
}

export type GitHubConnection = {
  id: string
  label: string
  token: string
  login: string
  name: string
}

export type GitHubConfig = {
  connections: GitHubConnection[]
}

export type GitHubTestResult =
  | { ok: true; login: string; name: string | null; scopes: string }
  | { ok: false; kind: GitHubErrorKind; message?: string }

export type GitHubApi = {
  getConfig: () => Promise<GitHubConfig>
  setConfig: (connections: GitHubConnection[]) => Promise<{
    ok: true
    status: GitHubStatus
    config: GitHubConfig
  }>
  status: () => Promise<GitHubStatus>
  test: (token: string) => Promise<GitHubTestResult>
}

export type MemesConfig = {
  imgflip: {
    username: string
    password: string
  }
  giphy: {
    apiKey: string
  }
}

export type MemesErrorKind = 'missing_key' | 'invalid_key' | 'rate_limit' | 'network' | 'unknown'

export type MemesStatus = {
  memegen: 'available'
  giphy: 'disabled' | 'configured' | 'error'
  imgflip: 'disabled' | 'configured' | 'error'
  giphyErrorKind: MemesErrorKind | null
  giphyError: string | null
  imgflipErrorKind: MemesErrorKind | null
  imgflipError: string | null
}

export type MemesTestResult = { ok: true } | { ok: false; kind: MemesErrorKind; message?: string }

export type MemesApi = {
  getConfig: () => Promise<MemesConfig>
  setConfig: (patch: Partial<MemesConfig>) => Promise<{
    ok: true
    status: MemesStatus
    config: MemesConfig
  }>
  status: () => Promise<MemesStatus>
  testGiphy: (apiKey: string) => Promise<MemesTestResult>
  testImgflip: (payload: { username: string; password: string }) => Promise<MemesTestResult>
}

export type UpdatesConfig = {
  enabled: boolean
}

export type ComputerUseConfig = {
  screenshotMaxWidth: number
  screenshotFormat: 'jpeg' | 'png'
}

export type ComputerUsePermissions = {
  platform: string
  hint: string | null
  accessibility: boolean
  screenRecording: boolean
}

export type ComputerUseApi = {
  getConfig: () => Promise<ComputerUseConfig>
  setConfig: (patch: Partial<ComputerUseConfig>) => Promise<{ ok: true; config: ComputerUseConfig }>
  checkPermissions: () => Promise<ComputerUsePermissions>
}

export type BrowserExtensionConfig = {
  port: number
  screenshotMaxWidth: number
  screenshotFormat: 'jpeg' | 'png'
  screenshotQuality: number
}

export type ExtensionConnectionStatus = 'stopped' | 'listening' | 'connected' | 'error'

export type ExtensionServerStatus = {
  status: ExtensionConnectionStatus
  error: string | null
  extensionVersion: string | null
  port: number
}

export type BrowserExtensionApi = {
  getConfig: () => Promise<BrowserExtensionConfig>
  setConfig: (
    patch: Partial<BrowserExtensionConfig>
  ) => Promise<{ ok: true; config: BrowserExtensionConfig }>
  status: () => Promise<ExtensionServerStatus>
  openExtensionFolder: () => Promise<void>
  getExtensionPath: () => Promise<string>
  updateExtension: () => Promise<{ ok: true }>
  testConnection: () => Promise<{ ok: boolean; steps: number; passed: number; error?: string }>
  openExtensionsPage: () => Promise<void>
  onStatusChange: (callback: (status: ExtensionServerStatus) => void) => () => void
}

export type UpdateAvailableEvent = {
  version: string
  releaseNotes: string | null
}

export type UpdateDownloadProgressEvent = {
  percent: number
}

export type UpdateReadyEvent = {
  version: string
  releaseNotes: string | null
}

export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'error'

export type UpdaterErrorCode = 'checksum' | 'network' | 'timeout' | 'filesystem' | 'unknown'

export type UpdaterErrorInfo = {
  code: UpdaterErrorCode
  message: string
  detail: string | null
}

export type UpdaterState = {
  phase: UpdaterPhase
  version: string | null
  percent: number
  releaseNotes: string | null
  error: UpdaterErrorInfo | null
}

export type UpdateCheckResult = { ok: true; version: string | null } | { ok: false; error: string }

export type UpdaterApi = {
  install: () => Promise<void>
  check: () => Promise<UpdateCheckResult>
  getVersion: () => Promise<string>
  getReady: () => Promise<UpdateReadyEvent | null>
  getState: () => Promise<UpdaterState>
  consumePostUpdate: () => Promise<boolean>
  listChangelogMonths: () => Promise<string[]>
  readChangelog: (month: string, locale?: string) => Promise<string>
  onAvailable: (listener: (event: UpdateAvailableEvent) => void) => () => void
  onProgress: (listener: (event: UpdateDownloadProgressEvent) => void) => () => void
  onReady: (listener: (event: UpdateReadyEvent) => void) => () => void
  onState: (listener: (state: UpdaterState) => void) => () => void
}

export type SttTranscribeResult =
  | { ok: true; transcript: string; language?: string }
  | { ok: false; error: string }

export type MicApi = {
  checkAccess: () => Promise<'granted' | 'denied' | 'not-determined' | 'restricted'>
  requestAccess: () => Promise<boolean>
}

// Local voice-engine provisioning (Kokoro TTS / faster-whisper STT) exposed to
// the Settings panels: a manual install with streamed progress + a readiness
// check so the panels can gate voice/model selection until installed.
export type EngineInstallPhase = 'python' | 'engine' | 'ffmpeg' | 'model' | 'done'
export type EngineInstallProgressEvent = { phase: EngineInstallPhase; percent: number }
export type EngineStatus = { installed: boolean }
export type EngineInstallResult = { ok: true } | { ok: false; error: string }
export type TtsPreviewResult = { ok: true; filePath: string } | { ok: false; error: string }
// Queryable in-flight install state — lets a panel recover progress after the
// user navigates away and back (the install keeps running in main).
export type EngineInstallRuntimeState = {
  installing: boolean
  progress: EngineInstallProgressEvent | null
  error: string | null
}

export type SttApi = {
  getConfig: () => Promise<SttConfig>
  setConfig: (patch: Partial<SttConfig>) => Promise<{ ok: true; config: SttConfig }>
  transcribe: (payload: {
    filePath: string
    conversationId?: string
  }) => Promise<SttTranscribeResult>
  installStatus: () => Promise<EngineStatus>
  install: () => Promise<EngineInstallResult>
  onInstallProgress: (listener: (event: EngineInstallProgressEvent) => void) => () => void
  getInstallState: () => Promise<EngineInstallRuntimeState>
}

export type TtsApi = {
  getConfig: () => Promise<TtsConfig>
  setConfig: (patch: Partial<TtsConfig>) => Promise<{ ok: true; config: TtsConfig }>
  installStatus: () => Promise<EngineStatus>
  install: () => Promise<EngineInstallResult>
  onInstallProgress: (listener: (event: EngineInstallProgressEvent) => void) => () => void
  getInstallState: () => Promise<EngineInstallRuntimeState>
  preview: (payload: { text?: string; voice?: string; speed?: string }) => Promise<TtsPreviewResult>
}

export type UploadValidationError =
  | { code: 'file_too_large'; maxBytes: number }
  | { code: 'max_files_reached'; max: number }
  | { code: 'total_size_exceeded'; maxBytes: number }
  | { code: 'type_not_supported' }

/** One top-level entry of a working folder, for attaching folder structure to chat context. */
export type FolderEntry = { name: string; isDirectory: boolean }
/**
 * The top-level listing of a working folder (capped). When `truncated`,
 * `omittedDirectories`/`omittedFiles` count what was dropped past the cap.
 * `error` is set when the dir was unreadable.
 */
export type FolderListing = {
  entries: FolderEntry[]
  truncated: boolean
  omittedDirectories?: number
  omittedFiles?: number
  error?: string
}

export type UploadApi = {
  pickFile: () => Promise<string[]>
  pickFolder: () => Promise<string | null>
  saveFile: (payload: {
    conversationId: string
    sourcePath: string
  }) => Promise<UploadedFileMetadata>
  saveBuffer: (payload: {
    conversationId: string
    buffer: ArrayBuffer
    fileName: string
  }) => Promise<UploadedFileMetadata>
  readFile: (relativePath: string) => Promise<ArrayBuffer>
  exists: (relativePath: string) => Promise<boolean>
  getMetadata: (relativePath: string) => Promise<UploadFileMeta | null>
  isSupported: (fileName: string) => Promise<boolean>
  validate: (payload: {
    fileName: string
    sizeBytes: number
    currentCount: number
    currentTotalBytes: number
  }) => Promise<UploadValidationError | null>
  openExternal: (relativePath: string) => Promise<{ ok: boolean; error?: string }>
  /** Existence + type of a device path (resolves a leading ~), for chat path cards. */
  statPath: (path: string) => Promise<{ exists: boolean; isDirectory: boolean }>
  /** Top-level contents of a directory (resolves a leading ~), for attaching working-folder structure to chat context. */
  listFolder: (path: string) => Promise<FolderListing>
  /** Open a directory, or reveal a file in its parent folder (resolves a leading ~). */
  revealPath: (path: string) => Promise<{ ok: boolean; error?: string }>
  /** Save a copy of a device path (resolves a leading ~) to a user-picked location. */
  downloadPath: (path: string) => Promise<{ ok: boolean; error?: string }>
  download: (relativePath: string) => Promise<{ ok: boolean }>
  /** Reveal the file in the OS file manager (Finder/Explorer). */
  revealInFolder: (relativePath: string) => Promise<{ ok: boolean }>
  /** Resolve the absolute filesystem path for a File object (e.g. from drag-and-drop). */
  getPathForFile: (file: File) => string
}

/** Spellcheck fields relayed from the main-process `context-menu` event — the
 *  only place Chromium exposes the misspelled word + its suggestions. `misspelledWord`
 *  is empty when nothing under the cursor is misspelled. */
export type SpellcheckContextMenu = {
  isEditable: boolean
  misspelledWord: string
  dictionarySuggestions: string[]
}

export type SpellcheckApi = {
  /** Fires on every right-click that the page doesn't preventDefault. Carries the
   *  spellcheck payload so the renderer's own styled menu can offer corrections. */
  onContextMenu: (listener: (event: SpellcheckContextMenu) => void) => () => void
  /** Replace the currently-selected misspelled word in the focused field. */
  replace: (word: string) => Promise<void>
  /** Add a word to the spellchecker's custom dictionary so it stops being flagged. */
  addToDictionary: (word: string) => Promise<void>
}

export type WolffishApi = {
  theme: ThemeApi
  locale: LocaleApi
  system: SystemApi
  workspace: WorkspaceApi
  ollama: OllamaApi
  model: ModelApi
  provider: ProviderApi
  chat: ChatApi
  conversation: ConversationApi
  viewer: ViewerApi
  heartbeat: HeartbeatApi
  procedures: ProceduresApi
  reindex: ReindexApi
  app: AppApi
  data: DataApi
  runtime: RuntimeApi
  usage: UsageApi
  cerebellum: CerebellumApi
  variables: VariablesApi
  voice: VoiceApi
  upload: UploadApi
  telegram: TelegramApi
  whatsapp: WhatsAppApi
  inapp: InAppApi
  mcp: McpApi
  brave: BraveApi
  notion: NotionApi
  github: GitHubApi
  google: GoogleApi
  memes: MemesApi
  mic: MicApi
  stt: SttApi
  tts: TtsApi
  computerUse: ComputerUseApi
  browserExtension: BrowserExtensionApi
  updater: UpdaterApi
  spellcheck: SpellcheckApi
}

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: WolffishApi = {
  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    set: (source) => ipcRenderer.invoke('theme:set', source),
    onUpdated: (listener) => subscribe('theme:updated', listener)
  },
  locale: {
    get: () => ipcRenderer.invoke('locale:get'),
    set: (locale) => ipcRenderer.invoke('locale:set', locale)
  },
  system: {
    getInfo: () => ipcRenderer.invoke('system:getInfo')
  },
  workspace: {
    getStatus: () => ipcRenderer.invoke('workspace:getStatus'),
    completeOnboarding: () => ipcRenderer.invoke('workspace:completeOnboarding'),
    getModelCatalog: () => ipcRenderer.invoke('workspace:getModelCatalog')
  },
  ollama: {
    detect: () => ipcRenderer.invoke('ollama:detect'),
    installUrl: () => ipcRenderer.invoke('ollama:installUrl'),
    openInstallPage: () => ipcRenderer.invoke('ollama:openInstallPage'),
    start: () => ipcRenderer.invoke('ollama:start'),
    listInstalled: () => ipcRenderer.invoke('ollama:listInstalled'),
    scanAvailable: () => ipcRenderer.invoke('ollama:scanAvailable'),
    getModelsFolder: () => ipcRenderer.invoke('ollama:getModelsFolder'),
    setModelsFolder: (folder) => ipcRenderer.invoke('ollama:setModelsFolder', folder),
    pickModelsFolder: () => ipcRenderer.invoke('ollama:pickModelsFolder')
  },
  model: {
    select: (modelName) => ipcRenderer.invoke('model:select', modelName),
    cancelPull: () => ipcRenderer.invoke('model:cancelPull'),
    clear: () => ipcRenderer.invoke('model:clear'),
    status: () => ipcRenderer.invoke('model:status'),
    capabilities: () => ipcRenderer.invoke('model:capabilities'),
    onPullProgress: (listener) => subscribe('model:pullProgress', listener),
    onPullDone: (listener) => subscribe('model:pullDone', listener)
  },
  provider: {
    list: () => ipcRenderer.invoke('provider:list'),
    test: (payload) => ipcRenderer.invoke('provider:test', payload),
    save: (payload) => ipcRenderer.invoke('provider:save', payload),
    remove: (id) => ipcRenderer.invoke('provider:remove', id),
    setBrain: (brain) => ipcRenderer.invoke('provider:setBrain', brain),
    setMode: (mode) => ipcRenderer.invoke('provider:setMode', mode),
    onUpdated: (listener) => subscribe('provider:updated', listener)
  },
  chat: {
    send: (payload) => ipcRenderer.invoke('chat:send', payload),
    cancel: (payload) => ipcRenderer.invoke('chat:cancel', payload),
    respondApproval: (payload) => ipcRenderer.invoke('chat:approvalRespond', payload),
    respondAsk: (payload) => ipcRenderer.invoke('chat:askRespond', payload),
    exportPdf: (payload) => ipcRenderer.invoke('chat:exportPdf', payload),
    onSegment: (listener) => subscribe('chat:segment', listener),
    onDone: (listener) => subscribe('chat:done', listener),
    onError: (listener) => subscribe('chat:error', listener),
    onTurnEvent: (listener) => subscribe('chat:turnEvent', listener),
    onApprovalRequest: (listener) => subscribe('chat:approvalRequest', listener),
    onAskRequest: (listener) => subscribe('chat:askRequest', listener),
    onCredentialBlocked: (listener) => subscribe('chat:credentialBlocked', listener),
    onTurnState: (listener) => subscribe('chat:turnState', listener)
  },
  conversation: {
    list: () => ipcRenderer.invoke('conversation:list'),
    load: (id) => ipcRenderer.invoke('conversation:load', id),
    save: (conv) => ipcRenderer.invoke('conversation:save', conv),
    delete: (id) => ipcRenderer.invoke('conversation:delete', id),
    create: (model) => ipcRenderer.invoke('conversation:create', model),
    onSummaryUpdated: (listener) => subscribe('conversation:summaryUpdated', listener),
    onDeleted: (listener) => subscribe('conversation:deleted', listener),
    onChanged: (listener) => subscribe('conversation:changed', listener)
  },
  viewer: {
    readTree: () => ipcRenderer.invoke('viewer:readTree'),
    readFile: (relativePath) => ipcRenderer.invoke('viewer:readFile', relativePath),
    readBinaryFile: (relativePath) => ipcRenderer.invoke('viewer:readBinaryFile', relativePath),
    writeFile: (relativePath, content) =>
      ipcRenderer.invoke('viewer:writeFile', relativePath, content),
    hasDefault: (relativePath) => ipcRenderer.invoke('viewer:hasDefault', relativePath),
    readDefault: (relativePath) => ipcRenderer.invoke('viewer:readDefault', relativePath),
    stat: (relativePath) => ipcRenderer.invoke('viewer:stat', relativePath),
    download: (relativePath) => ipcRenderer.invoke('viewer:download', relativePath),
    revealInFolder: (relativePath) => ipcRenderer.invoke('viewer:revealInFolder', relativePath),
    resync: () => ipcRenderer.invoke('viewer:resync')
  },
  heartbeat: {
    getJobs: () => ipcRenderer.invoke('heartbeat:getJobs'),
    getRunningJob: () => ipcRenderer.invoke('heartbeat:getRunningJob'),
    runJob: (idOrLabel) => ipcRenderer.invoke('heartbeat:runJob', idOrLabel),
    onJobStarted: (listener) => subscribe('heartbeat:jobStarted', listener),
    onJobEnded: (listener) => subscribe('heartbeat:jobEnded', listener),
    onJobLog: (listener) => subscribe('heartbeat:jobLog', listener)
  },
  procedures: {
    list: () => ipcRenderer.invoke('procedures:list'),
    create: (payload) => ipcRenderer.invoke('procedures:create', payload),
    update: (payload) => ipcRenderer.invoke('procedures:update', payload),
    delete: (id) => ipcRenderer.invoke('procedures:delete', id)
  },
  reindex: {
    getStatus: () => ipcRenderer.invoke('reindex:getStatus'),
    onStarted: (listener) => subscribe('reindex:started', listener),
    onProgress: (listener) => subscribe('reindex:progress', listener),
    onEnded: (listener) => subscribe('reindex:ended', listener)
  },
  app: {
    factoryReset: () => ipcRenderer.invoke('app:factoryReset'),
    onClosingPending: (listener) => subscribe('app:closingPending', listener)
  },
  data: {
    getAnalytics: () => ipcRenderer.invoke('data:getAnalytics')
  },
  runtime: {
    setLaunchAtStartup: (value) => ipcRenderer.invoke('runtime:setLaunchAtStartup', value),
    getLaunchAtStartupStatus: () => ipcRenderer.invoke('runtime:getLaunchAtStartupStatus'),
    setBypassPermissions: (value) => ipcRenderer.invoke('runtime:setBypassPermissions', value),
    setBlockCredentials: (value) => ipcRenderer.invoke('runtime:setBlockCredentials', value),
    setLocalOnly: (value) => ipcRenderer.invoke('runtime:setLocalOnly', value),
    setRestrictPowerfulModels: (value) =>
      ipcRenderer.invoke('runtime:setRestrictPowerfulModels', value),
    setThinkingMode: (model, mode) => ipcRenderer.invoke('runtime:setThinkingMode', model, mode),
    setUpdatesEnabled: (value) => ipcRenderer.invoke('runtime:setUpdatesEnabled', value),
    setWeekStartsOn: (value) => ipcRenderer.invoke('runtime:setWeekStartsOn', value),
    setLastSettingsState: (patch) => ipcRenderer.invoke('runtime:setLastSettingsState', patch),
    getCompactionConfig: () => ipcRenderer.invoke('runtime:getCompactionConfig'),
    setCompactionConfig: (patch) => ipcRenderer.invoke('runtime:setCompactionConfig', patch)
  },
  usage: {
    getSummary: (range) => ipcRenderer.invoke('usage:getSummary', range),
    getStats: (range) => ipcRenderer.invoke('usage:getStats', range),
    getDaily: (year) => ipcRenderer.invoke('usage:getDaily', year),
    sync: () => ipcRenderer.invoke('usage:sync')
  },
  cerebellum: {
    listCapabilities: () => ipcRenderer.invoke('cerebellum:listCapabilities'),
    reload: () => ipcRenderer.invoke('cerebellum:reload'),
    toggleCapability: (name, enabled) =>
      ipcRenderer.invoke('cerebellum:toggleCapability', name, enabled),
    importCapability: (sourcePath) => ipcRenderer.invoke('cerebellum:importCapability', sourcePath),
    pickImport: (options) => ipcRenderer.invoke('cerebellum:pickImport', options),
    deleteCapability: (name) => ipcRenderer.invoke('cerebellum:deleteCapability', name)
  },
  variables: {
    list: () => ipcRenderer.invoke('variables:list'),
    save: (variables) => ipcRenderer.invoke('variables:save', variables)
  },
  voice: {
    readFile: (filePath) => ipcRenderer.invoke('voice:readFile', filePath),
    download: (filePath) => ipcRenderer.invoke('voice:download', filePath),
    revealInFolder: (filePath) => ipcRenderer.invoke('voice:revealInFolder', filePath),
    exists: (filePath) => ipcRenderer.invoke('voice:exists', filePath)
  },
  upload: {
    pickFile: () => ipcRenderer.invoke('upload:pickFile'),
    pickFolder: () => ipcRenderer.invoke('upload:pickFolder'),
    saveFile: (payload) => ipcRenderer.invoke('upload:saveFile', payload),
    saveBuffer: (payload) => ipcRenderer.invoke('upload:saveBuffer', payload),
    readFile: (relativePath) => ipcRenderer.invoke('upload:readFile', relativePath),
    exists: (relativePath) => ipcRenderer.invoke('upload:exists', relativePath),
    getMetadata: (relativePath) => ipcRenderer.invoke('upload:getMetadata', relativePath),
    isSupported: (fileName) => ipcRenderer.invoke('upload:isSupported', fileName),
    validate: (payload) => ipcRenderer.invoke('upload:validate', payload),
    openExternal: (relativePath) => ipcRenderer.invoke('upload:openExternal', relativePath),
    statPath: (path) => ipcRenderer.invoke('upload:statPath', path),
    listFolder: (path) => ipcRenderer.invoke('upload:listFolder', path),
    revealPath: (path) => ipcRenderer.invoke('upload:revealPath', path),
    downloadPath: (path) => ipcRenderer.invoke('upload:downloadPath', path),
    download: (relativePath) => ipcRenderer.invoke('upload:download', relativePath),
    revealInFolder: (relativePath) => ipcRenderer.invoke('upload:revealInFolder', relativePath),
    getPathForFile: (file) => webUtils.getPathForFile(file)
  },
  telegram: {
    getConfig: () => ipcRenderer.invoke('telegram:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('telegram:setConfig', patch),
    status: () => ipcRenderer.invoke('telegram:status'),
    sendTestMessage: (payload) => ipcRenderer.invoke('telegram:sendTestMessage', payload),
    onStatusChange: (callback) => subscribe('telegram:statusChange', callback)
  },
  whatsapp: {
    getConfig: () => ipcRenderer.invoke('whatsapp:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('whatsapp:setConfig', patch),
    status: () => ipcRenderer.invoke('whatsapp:status'),
    logout: () => ipcRenderer.invoke('whatsapp:logout'),
    requestQr: () => ipcRenderer.invoke('whatsapp:requestQr'),
    onQr: (callback) => subscribe('whatsapp:qr', callback),
    onStatusChange: (callback) => subscribe('whatsapp:statusChange', callback)
  },
  inapp: {
    getConfig: () => ipcRenderer.invoke('inapp:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('inapp:setConfig', patch),
    onConfigChange: (callback) => subscribe('inapp:configChange', callback)
  },
  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    add: (input) => ipcRenderer.invoke('mcp:add', input),
    remove: (id) => ipcRenderer.invoke('mcp:remove', id),
    setEnabled: (id, enabled) => ipcRenderer.invoke('mcp:setEnabled', id, enabled),
    setHeaders: (id, headers) => ipcRenderer.invoke('mcp:setHeaders', id, headers),
    test: (id) => ipcRenderer.invoke('mcp:test', id),
    authorize: (id) => ipcRenderer.invoke('mcp:authorize', id),
    onStatusChange: (callback) => subscribe('mcp:statusChange', callback)
  },
  brave: {
    getConfig: () => ipcRenderer.invoke('brave:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('brave:setConfig', patch),
    status: () => ipcRenderer.invoke('brave:status'),
    test: (apiKey) => ipcRenderer.invoke('brave:test', apiKey)
  },
  notion: {
    getConfig: () => ipcRenderer.invoke('notion:getConfig'),
    setConfig: (connections) => ipcRenderer.invoke('notion:setConfig', connections),
    status: () => ipcRenderer.invoke('notion:status'),
    test: (token) => ipcRenderer.invoke('notion:test', token)
  },
  github: {
    getConfig: () => ipcRenderer.invoke('github:getConfig'),
    setConfig: (connections) => ipcRenderer.invoke('github:setConfig', connections),
    status: () => ipcRenderer.invoke('github:status'),
    test: (token) => ipcRenderer.invoke('github:test', token)
  },
  memes: {
    getConfig: () => ipcRenderer.invoke('memes:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('memes:setConfig', patch),
    status: () => ipcRenderer.invoke('memes:status'),
    testGiphy: (apiKey) => ipcRenderer.invoke('memes:testGiphy', apiKey),
    testImgflip: (payload) => ipcRenderer.invoke('memes:testImgflip', payload)
  },
  google: {
    getConfig: () => ipcRenderer.invoke('google:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('google:setConfig', patch),
    status: () => ipcRenderer.invoke('google:status'),
    checkBinary: () => ipcRenderer.invoke('google:checkBinary'),
    setup: () => ipcRenderer.invoke('google:setup'),
    update: () => ipcRenderer.invoke('google:update'),
    getSetupState: () => ipcRenderer.invoke('google:getSetupState'),
    onSetupState: (listener) => subscribe('google:setupState', listener),
    onAuthUrl: (listener) => subscribe('google:authUrl', listener),
    uploadCredentials: (jsonContent) => ipcRenderer.invoke('google:uploadCredentials', jsonContent),
    deleteCredentials: () => ipcRenderer.invoke('google:deleteCredentials'),
    authAdd: (email) => ipcRenderer.invoke('google:authAdd', email),
    cancelAuth: () => ipcRenderer.invoke('google:cancelAuth'),
    listAccounts: () => ipcRenderer.invoke('google:listAccounts'),
    checkAccounts: () => ipcRenderer.invoke('google:checkAccounts'),
    removeAccount: (email) => ipcRenderer.invoke('google:removeAccount', email)
  },
  mic: {
    checkAccess: () => ipcRenderer.invoke('mic:checkAccess'),
    requestAccess: () => ipcRenderer.invoke('mic:requestAccess')
  },
  stt: {
    getConfig: () => ipcRenderer.invoke('stt:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('stt:setConfig', patch),
    transcribe: (payload) => ipcRenderer.invoke('stt:transcribe', payload),
    installStatus: () => ipcRenderer.invoke('stt:installStatus'),
    install: () => ipcRenderer.invoke('stt:install'),
    onInstallProgress: (listener) => subscribe('stt:installProgress', listener),
    getInstallState: () => ipcRenderer.invoke('stt:getInstallState')
  },
  tts: {
    getConfig: () => ipcRenderer.invoke('tts:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('tts:setConfig', patch),
    installStatus: () => ipcRenderer.invoke('tts:installStatus'),
    install: () => ipcRenderer.invoke('tts:install'),
    onInstallProgress: (listener) => subscribe('tts:installProgress', listener),
    getInstallState: () => ipcRenderer.invoke('tts:getInstallState'),
    preview: (payload) => ipcRenderer.invoke('tts:preview', payload)
  },
  computerUse: {
    getConfig: () => ipcRenderer.invoke('computerUse:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('computerUse:setConfig', patch),
    checkPermissions: () => ipcRenderer.invoke('computerUse:checkPermissions')
  },
  browserExtension: {
    getConfig: () => ipcRenderer.invoke('browserExtension:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('browserExtension:setConfig', patch),
    status: () => ipcRenderer.invoke('browserExtension:status'),
    openExtensionFolder: () => ipcRenderer.invoke('browserExtension:openExtensionFolder'),
    getExtensionPath: () => ipcRenderer.invoke('browserExtension:getExtensionPath'),
    updateExtension: () => ipcRenderer.invoke('browserExtension:updateExtension'),
    testConnection: () => ipcRenderer.invoke('browserExtension:testConnection'),
    openExtensionsPage: () => ipcRenderer.invoke('browserExtension:openExtensionsPage'),
    onStatusChange: (listener) => subscribe('extension:statusChange', listener)
  },
  updater: {
    install: () => ipcRenderer.invoke('updater:install'),
    check: () => ipcRenderer.invoke('updater:check'),
    getVersion: () => ipcRenderer.invoke('updater:getVersion'),
    getReady: () => ipcRenderer.invoke('updater:getReady'),
    getState: () => ipcRenderer.invoke('updater:getState'),
    consumePostUpdate: () => ipcRenderer.invoke('updater:consumePostUpdate'),
    listChangelogMonths: () => ipcRenderer.invoke('updater:listChangelogMonths'),
    readChangelog: (month: string, locale?: string) =>
      ipcRenderer.invoke('updater:readChangelog', month, locale),
    onAvailable: (listener) => subscribe('updater:available', listener),
    onProgress: (listener) => subscribe('updater:progress', listener),
    onReady: (listener) => subscribe('updater:ready', listener),
    onState: (listener) => subscribe('updater:state', listener)
  },
  spellcheck: {
    onContextMenu: (listener) => subscribe('spellcheck:contextMenu', listener),
    replace: (word) => ipcRenderer.invoke('spellcheck:replace', word),
    addToDictionary: (word) => ipcRenderer.invoke('spellcheck:addToDictionary', word)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  ;(window as unknown as { api: WolffishApi }).api = api
}
