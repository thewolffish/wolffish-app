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
    cloudPriority?: CloudProviderConfig['id'][]
    allowLocalFallback?: boolean
    localOnly?: boolean
    restrictPowerfulModels?: boolean
    /** Per-model thinking mode. Key is model name, value is ThinkingMode. */
    thinkingModes?: Record<string, ThinkingMode>
  }
  safety?: SafetyConfig
  showChatAnalytics?: boolean
  weekStartsOn?: WeekStartsOn
  variables?: Variable[]
  telegram?: TelegramConfig
  whatsapp?: WhatsAppConfig
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
  /** Set when this user message is a Telegram voice transcript — the audio attachment must not be exposed to the LLM. */
  voicePrompt?: boolean
}

export type ConversationChannel = 'electron' | 'telegram' | 'whatsapp' | 'heartbeat'

export type TimelineEntry = {
  id: string
  timestamp: number
  kind: string
  summary?: string
  detail?: string
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
  contextMeter?: { contextTokens: number; contextBudget: number } | null
  timeline?: TimelineEntry[]
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
export type ChatDoneEvent = { turnId: string }
export type ChatErrorEvent = { turnId: string; error: string }

export type ChatTurnEvent = {
  turnId: string
  type:
    | 'context.built'
    | 'llm.response'
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
  turnId: string | null
  id: string
  toolCallId: string
  tool: string
  args: Record<string, unknown>
  level: DangerLevel
  reason: string
  description?: ApprovalDescription
}

export type ChatCredentialBlockedEvent = {
  turnId: string
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
  setAllowLocalFallback: (value: boolean) => Promise<{ value: boolean }>
  setShowChatAnalytics: (value: boolean) => Promise<{ value: boolean }>
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

export type ProviderUpdatedEvent = { id: CloudProviderConfig['id'] }

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
  getPriority: () => Promise<CloudProviderConfig['id'][]>
  setPriority: (order: CloudProviderConfig['id'][]) => Promise<{ ok: true }>
  onUpdated: (listener: (event: ProviderUpdatedEvent) => void) => () => void
}

export type ThinkingMode = 'none' | 'basic' | 'extended' | 'max' | 'fast' | 'budget'

export type ChatApi = {
  send: (payload: {
    history: ChatHistoryMessage[]
    conversationId?: string | null
    thinkingMode?: ThinkingMode
  }) => Promise<{ turnId: string; ok: boolean; error?: string }>
  cancel: () => Promise<{ canceled: boolean }>
  respondApproval: (payload: { id: string; decision: ApprovalDecision }) => Promise<{ ok: boolean }>
  onSegment: (listener: (segment: Segment) => void) => () => void
  onDone: (listener: (event: ChatDoneEvent) => void) => () => void
  onError: (listener: (event: ChatErrorEvent) => void) => () => void
  onTurnEvent: (listener: (event: ChatTurnEvent) => void) => () => void
  onApprovalRequest: (listener: (event: ChatApprovalRequestEvent) => void) => () => void
  onCredentialBlocked: (listener: (event: ChatCredentialBlockedEvent) => void) => () => void
}

export type ConversationApi = {
  list: () => Promise<ConversationMeta[]>
  load: (id: string) => Promise<ConversationFile | null>
  save: (conv: ConversationFile) => Promise<{ ok: true }>
  delete: (id: string) => Promise<{ ok: true }>
  create: (model: string | null) => Promise<ConversationFile>
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
  nextRunMs: number | null
}

export type HeartbeatRunningJob = {
  id: string
  label: string
  body: string
  startedAt: number
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
  onJobStarted: (listener: (job: HeartbeatRunningJob) => void) => () => void
  onJobEnded: (
    listener: (payload: { id: string; status: 'completed' | 'failed'; error?: string }) => void
  ) => () => void
  onJobLog: (listener: (entry: HeartbeatLogEntry) => void) => () => void
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

export type GoogleSetupProgressEvent = { percent: number }
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
  onSetupProgress: (listener: (event: GoogleSetupProgressEvent) => void) => () => void
  onAuthUrl: (listener: (event: GoogleAuthUrlEvent) => void) => () => void
  uploadCredentials: (jsonContent: string) => Promise<GoogleCredentialsResult>
  deleteCredentials: () => Promise<{ ok: true } | { ok: false; message: string }>
  authAdd: (email: string) => Promise<GoogleAuthResult>
  cancelAuth: () => Promise<boolean>
  listAccounts: () => Promise<string[]>
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

export type NotionConfig = {
  token: string
  name: string
  email: string
}

export type NotionTestResult =
  | { ok: true; name: string; email: string | null }
  | { ok: false; kind: NotionErrorKind; message?: string }

export type NotionApi = {
  getConfig: () => Promise<NotionConfig>
  setConfig: (patch: Partial<NotionConfig>) => Promise<{
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

export type GitHubConfig = {
  token: string
  login: string
  name: string
}

export type GitHubTestResult =
  | { ok: true; login: string; name: string | null; scopes: string }
  | { ok: false; kind: GitHubErrorKind; message?: string }

export type GitHubApi = {
  getConfig: () => Promise<GitHubConfig>
  setConfig: (patch: Partial<GitHubConfig>) => Promise<{
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

export type UpdateCheckResult = { ok: true; version: string | null } | { ok: false; error: string }

export type UpdaterApi = {
  install: () => Promise<void>
  check: () => Promise<UpdateCheckResult>
  getVersion: () => Promise<string>
  getReady: () => Promise<UpdateReadyEvent | null>
  consumePostUpdate: () => Promise<boolean>
  listChangelogMonths: () => Promise<string[]>
  readChangelog: (month: string, locale?: string) => Promise<string>
  onAvailable: (listener: (event: UpdateAvailableEvent) => void) => () => void
  onProgress: (listener: (event: UpdateDownloadProgressEvent) => void) => () => void
  onReady: (listener: (event: UpdateReadyEvent) => void) => () => void
}

export type SttTranscribeResult =
  | { ok: true; transcript: string; language?: string }
  | { ok: false; error: string }

export type MicApi = {
  checkAccess: () => Promise<'granted' | 'denied' | 'not-determined' | 'restricted'>
  requestAccess: () => Promise<boolean>
}

export type SttApi = {
  getConfig: () => Promise<SttConfig>
  setConfig: (patch: Partial<SttConfig>) => Promise<{ ok: true; config: SttConfig }>
  transcribe: (payload: {
    filePath: string
    conversationId?: string
  }) => Promise<SttTranscribeResult>
}

export type TtsApi = {
  getConfig: () => Promise<TtsConfig>
  setConfig: (patch: Partial<TtsConfig>) => Promise<{ ok: true; config: TtsConfig }>
}

export type UploadValidationError =
  | { code: 'file_too_large'; maxBytes: number }
  | { code: 'max_files_reached'; max: number }
  | { code: 'total_size_exceeded'; maxBytes: number }
  | { code: 'type_not_supported' }
  | { code: 'vision_not_supported'; model: string }

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
  download: (relativePath: string) => Promise<{ ok: boolean }>
  /** Reveal the file in the OS file manager (Finder/Explorer). */
  revealInFolder: (relativePath: string) => Promise<{ ok: boolean }>
  /** Resolve the absolute filesystem path for a File object (e.g. from drag-and-drop). */
  getPathForFile: (file: File) => string
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
    getPriority: () => ipcRenderer.invoke('provider:getPriority'),
    setPriority: (order) => ipcRenderer.invoke('provider:setPriority', order),
    onUpdated: (listener) => subscribe('provider:updated', listener)
  },
  chat: {
    send: (payload) => ipcRenderer.invoke('chat:send', payload),
    cancel: () => ipcRenderer.invoke('chat:cancel'),
    respondApproval: (payload) => ipcRenderer.invoke('chat:approvalRespond', payload),
    onSegment: (listener) => subscribe('chat:segment', listener),
    onDone: (listener) => subscribe('chat:done', listener),
    onError: (listener) => subscribe('chat:error', listener),
    onTurnEvent: (listener) => subscribe('chat:turnEvent', listener),
    onApprovalRequest: (listener) => subscribe('chat:approvalRequest', listener),
    onCredentialBlocked: (listener) => subscribe('chat:credentialBlocked', listener)
  },
  conversation: {
    list: () => ipcRenderer.invoke('conversation:list'),
    load: (id) => ipcRenderer.invoke('conversation:load', id),
    save: (conv) => ipcRenderer.invoke('conversation:save', conv),
    delete: (id) => ipcRenderer.invoke('conversation:delete', id),
    create: (model) => ipcRenderer.invoke('conversation:create', model)
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
    onJobStarted: (listener) => subscribe('heartbeat:jobStarted', listener),
    onJobEnded: (listener) => subscribe('heartbeat:jobEnded', listener),
    onJobLog: (listener) => subscribe('heartbeat:jobLog', listener)
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
    setAllowLocalFallback: (value) => ipcRenderer.invoke('runtime:setAllowLocalFallback', value),
    setShowChatAnalytics: (value) => ipcRenderer.invoke('runtime:setShowChatAnalytics', value),
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
  brave: {
    getConfig: () => ipcRenderer.invoke('brave:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('brave:setConfig', patch),
    status: () => ipcRenderer.invoke('brave:status'),
    test: (apiKey) => ipcRenderer.invoke('brave:test', apiKey)
  },
  notion: {
    getConfig: () => ipcRenderer.invoke('notion:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('notion:setConfig', patch),
    status: () => ipcRenderer.invoke('notion:status'),
    test: (token) => ipcRenderer.invoke('notion:test', token)
  },
  github: {
    getConfig: () => ipcRenderer.invoke('github:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('github:setConfig', patch),
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
    onSetupProgress: (listener) => subscribe('google:setupProgress', listener),
    onAuthUrl: (listener) => subscribe('google:authUrl', listener),
    uploadCredentials: (jsonContent) => ipcRenderer.invoke('google:uploadCredentials', jsonContent),
    deleteCredentials: () => ipcRenderer.invoke('google:deleteCredentials'),
    authAdd: (email) => ipcRenderer.invoke('google:authAdd', email),
    cancelAuth: () => ipcRenderer.invoke('google:cancelAuth'),
    listAccounts: () => ipcRenderer.invoke('google:listAccounts'),
    removeAccount: (email) => ipcRenderer.invoke('google:removeAccount', email)
  },
  mic: {
    checkAccess: () => ipcRenderer.invoke('mic:checkAccess'),
    requestAccess: () => ipcRenderer.invoke('mic:requestAccess')
  },
  stt: {
    getConfig: () => ipcRenderer.invoke('stt:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('stt:setConfig', patch),
    transcribe: (payload) => ipcRenderer.invoke('stt:transcribe', payload)
  },
  tts: {
    getConfig: () => ipcRenderer.invoke('tts:getConfig'),
    setConfig: (patch) => ipcRenderer.invoke('tts:setConfig', patch)
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
    consumePostUpdate: () => ipcRenderer.invoke('updater:consumePostUpdate'),
    listChangelogMonths: () => ipcRenderer.invoke('updater:listChangelogMonths'),
    readChangelog: (month: string, locale?: string) =>
      ipcRenderer.invoke('updater:readChangelog', month, locale),
    onAvailable: (listener) => subscribe('updater:available', listener),
    onProgress: (listener) => subscribe('updater:progress', listener),
    onReady: (listener) => subscribe('updater:ready', listener)
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
