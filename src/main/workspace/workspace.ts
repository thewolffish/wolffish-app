import { is } from '@electron-toolkit/utils'
import { diskWriter } from '@main/io/diskWriter'
import { mcpCapabilityName } from '@main/runtime/mcp/naming'
import type { McpConfig, McpOauthState, McpServerConfig } from '@main/runtime/mcp/types'
import { isKnownModelName } from '@main/runtime/models'
import { app } from 'electron'
import yaml from 'js-yaml'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import semver from 'semver'

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
  // Cached from the provider's /v1/models endpoint. Refreshed on app
  // startup (see refreshAllProviderModels in main/index.ts) and on each
  // successful "Test" in settings. Optional so legacy configs migrate
  // cleanly — an empty cache just means "no list yet, retest to populate".
  models?: string[]
  reasoningModels?: string[]
  // Anthropic prompt-cache breakpoint TTL. '1h' costs 2x base input on
  // cache writes but keeps the prefix warm through tasks whose individual
  // steps outlast the 5-minute default. Ignored by other providers.
  cacheTtl?: '5m' | '1h'
}

export type SafetyConfig = {
  bypassPermissions: boolean
  blockCredentials: boolean
}

export type TelegramConfig = {
  enabled: boolean
  botToken: string
  /** Numeric Telegram user IDs allowed to talk to the bot. Empty = nobody. */
  allowedUserIds: number[]
  autoRefresh?: boolean
  staleHours?: number
  /**
   * When true, every tool call/result/activity is relayed to the chat.
   * When false (default), only agent messages, file-bearing tool results,
   * and errors are sent. Gates sending only; history is unaffected.
   */
  verbose?: boolean
}

/**
 * Brave Search API configuration. When `enabled` is true and `apiKey` is
 * non-empty, the web-search cerebellum plugin uses Brave as the primary
 * search provider (falling back to DuckDuckGo on failure). When disabled
 * or unset, the plugin uses DuckDuckGo only.
 */
export type WhatsAppConfig = {
  enabled: boolean
  allowedPhoneNumbers: string[]
  autoRefresh?: boolean
  staleHours?: number
  /**
   * When true, every tool call/result/activity is relayed to the chat.
   * When false (default), only agent messages, file-bearing tool results,
   * and errors are sent. Gates sending only; history is unaffected.
   */
  verbose?: boolean
}

/**
 * In-app (desktop) chat display preferences. Unlike Telegram / WhatsApp
 * this is not a remote relay channel — it's the primary renderer feed.
 * `verbose` gates what the in-app chat DISPLAYS: false (default) = a clean
 * feed (agent replies, file-bearing tool results, errors); true = the
 * model/provider chip plus every tool call/result/activity card. Display-only
 * — never affects history persistence.
 */
export type InAppConfig = {
  verbose?: boolean
}

export type BraveConfig = {
  enabled: boolean
  apiKey: string
}

/**
 * A single labeled Notion integration. The user assigns a `label`
 * (e.g. "Personal", "Wolffish") so both they and the model can tell
 * multiple linked workspaces apart. `token` is the integration secret.
 * `name`/`email` are the account snapshot resolved by a successful
 * "Test" in settings, kept so the UI can show the connected account on
 * next launch without re-testing.
 */
export type NotionConnection = {
  id: string
  label: string
  token: string
  name: string
  email: string
}

/**
 * Notion integration config. Holds any number of labeled connections —
 * the user can link several Notion workspaces and the model picks one
 * per tool call by its label. Stateless — no daemon, no long-poll. The
 * cerebellum plugin reads config.json directly on every tool call.
 */
export type NotionConfig = {
  connections: NotionConnection[]
}

/**
 * A single labeled GitHub account (Personal Access Token). The user
 * assigns a `label` (e.g. "Personal", "Work") to disambiguate multiple
 * linked accounts. `token` is the PAT the cerebellum plugin reads on
 * every call. `login`/`name` are the account snapshot populated by a
 * successful Test Connection — kept so the UI can show the connected
 * account on next launch without re-testing.
 */
export type GitHubConnection = {
  id: string
  label: string
  token: string
  login: string
  name: string
}

/**
 * GitHub integration config. Holds any number of labeled connections —
 * the user can link several accounts and the model picks one per tool
 * call by its label. Stateless — no daemon: the cerebellum plugin reads
 * config.json directly on every tool call.
 */
export type GitHubConfig = {
  connections: GitHubConnection[]
}

/**
 * Google Workspace integration via gogcli. `status` is 'active' when at
 * least one account is authorized through gogcli. The cerebellum plugin
 * requires an explicit `account` parameter on every call — there is no
 * configured default. Credential storage is delegated to gogcli's own
 * keychain; we only store safe public metadata here.
 */
export type GoogleConfig = {
  status: 'inactive' | 'active'
  clientId: string
  projectId: string
  credentialsStored: boolean
}

/**
 * Speech-to-text defaults the cerebellum plugin reads on every call.
 * `defaultModel` is the Whisper model size — tiny / base / small /
 * medium / large. Empty string falls back to the plugin's hard-coded
 * default (`base`).
 */
export type SttConfig = {
  defaultModel: string
}

/**
 * Text-to-speech defaults the cerebellum plugin reads on every call.
 * `defaultVoice` is a Kokoro voice id (e.g. `af_bella`). `defaultSpeed` is a
 * float multiplier string between `0.5` and `1.5` (e.g. `1.0`). Empty values
 * fall back to the plugin defaults (`af_bella`, `1.0`).
 */
export type TtsConfig = {
  defaultVoice: string
  defaultSpeed: string
}

/**
 * Memes capability provider credentials. `imgflip` needs a free account,
 * `giphy` needs an API key. memegen.link works without any config.
 */
export type MemesConfig = {
  imgflip: {
    username: string
    password: string
  }
  giphy: {
    apiKey: string
  }
}

export type UpdatesConfig = {
  enabled: boolean
  lastVersion?: string
}

export type ComputerUseConfig = {
  screenshotMaxWidth: number
  screenshotFormat: 'jpeg' | 'png'
}

export type BrowserExtensionConfig = {
  port: number
  screenshotMaxWidth: number
  screenshotFormat: 'jpeg' | 'png'
  screenshotQuality: number
}

export type Variable = {
  name: string
  value: string
  sensitive: boolean
}

export type WeekStartsOn = 0 | 1

export type CompactionConfig = {
  /** Hour of day (0-23) for daily compaction. Defaults to 23. */
  dailyHour: number
  /** Day of week (0=Sun, 6=Sat) for weekly consolidation. Defaults to 0 (Sunday). */
  weeklyDay: number
  /** Hour of day (0-23) for weekly consolidation. Defaults to 23. */
  weeklyHour: number
}

export type WorkspaceConfig = {
  version: 1
  // When true, Wolffish registers itself as a login item so the OS
  // launches it automatically on boot/login. Enabled by default.
  // The actual OS registration is checked at runtime via
  // app.getLoginItemSettings() — this field stores the user's intent.
  launchAtStartup?: boolean
  ollamaModelsFolder?: string
  llm: {
    local: LocalModelConfig
    providers: CloudProviderConfig[]
    // The single user-chosen cloud model — the Brain. Sole source of truth
    // for which cloud provider+model runs when not in local-only mode.
    // Null/absent means no cloud model is selected yet. Set from the Brain
    // settings page; the matching provider's `model` field is mirrored to it.
    brain?: { providerId: CloudProviderConfig['id']; model: string } | null
    // Orchestrator mode (Phase 2). 'single' (default) is the Phase-1 single-model
    // app. 'orchestrator' = a frontier orchestrator (the `brain` model) drives
    // live parallel worker sessions running on `workerModel`. Global toggle.
    orchestratorMode?: 'single' | 'orchestrator'
    // The model worker sessions run on in orchestrator mode. Mirrors `brain`'s
    // shape; null/absent until chosen.
    workerModel?: { providerId: CloudProviderConfig['id']; model: string } | null
    // Behavior modifiers — append a system-prompt block when on (prefrontal
    // reads these). Apply to every turn (single, orchestrator, worker).
    // `greedy`: persist hard — many retries, several approaches, ignore
    // token/time budgets until the job is truly done.
    greedy?: boolean
    // `autonomous`: high agency — ask the user as little as possible, decide and
    // act, drive end-to-end. Both default off (no prompt added).
    autonomous?: boolean
    // When true, cloud is skipped entirely and only the local model runs.
    // Toggled from the chat input's mode switch.
    localOnly?: boolean
    // When true (default), the model picker blocks models whose RAM
    // footprint exceeds ~55% of the system's physical memory. Turning
    // this off lets the user install any model regardless of hardware
    // limits — not recommended, as oversized models cause heavy swap
    // thrashing and degrade the entire system.
    restrictPowerfulModels?: boolean
    // Per-model thinking mode. Key is model name, value is thinking mode string.
    thinkingModes?: Record<string, string>
  }
  // Optional so configs written before this field shipped still parse.
  safety?: SafetyConfig
  // On by default. When true, the chat input shows a small strip with
  // elapsed time, output tokens, and context size.
  showChatAnalytics?: boolean
  // Context optimization (prompt caching). On by default; set
  // enabled: false to restore the legacy per-iteration prompt rebuild
  // for debugging. Gates the per-turn pinning of system prompt + tools,
  // the outbound volatile runtime tail, and provider stickiness. Bug
  // fixes (memory exclusions, compaction calibration) are not gated.
  // `truncation` (also default on, requires enabled) additionally
  // collapses provably superseded page reads, byte-equal duplicate
  // results, and stale screenshots into self-describing stubs in the
  // outbound request only — internal history, episodes, and task files
  // keep full fidelity.
  contextOptimization?: {
    enabled?: boolean
    truncation?: boolean
  }
  // 0 = Sunday, 1 = Monday. Defaults to Monday (ISO 8601). Drives how the
  // activity heatmap is laid out and how the user thinks about week
  // boundaries. Optional so legacy configs migrate cleanly.
  weekStartsOn?: WeekStartsOn
  variables?: Variable[]
  // Telegram is a second-class chat surface: same agent pipeline, same
  // history, same memory. Optional so legacy configs migrate cleanly —
  // when absent the bot is treated as disabled and the runtime never
  // touches grammY.
  telegram?: TelegramConfig
  // WhatsApp Web via Baileys. Optional so legacy configs migrate cleanly
  // — when absent the channel never starts.
  whatsapp?: WhatsAppConfig
  // In-app (desktop) chat display preferences. Optional so legacy configs
  // migrate cleanly — when absent the feed defaults to clean (verbose off).
  inapp?: InAppConfig
  // Brave Search API key + toggle. When enabled and a key is set, the
  // web-search plugin uses Brave first and falls back to DuckDuckGo on
  // failure. Optional so legacy configs migrate cleanly.
  brave?: BraveConfig
  // Notion integration token. Optional so legacy configs migrate
  // cleanly — when absent the cerebellum plugin simply has no token
  // and the tools return an "unconfigured" error.
  notion?: NotionConfig
  // GitHub PAT. Optional so legacy configs migrate cleanly — when absent
  // the cerebellum plugin returns an "unconfigured" error.
  github?: GitHubConfig
  // Google Workspace (gogcli) metadata. Only safe public fields — the
  // actual OAuth credentials live in gogcli's credential store.
  google?: GoogleConfig
  // STT/TTS defaults exposed to the cerebellum plugins via config.json.
  // Optional for backwards compatibility — plugin falls back to its
  // own hard-coded defaults when missing or partially set.
  stt?: SttConfig
  tts?: TtsConfig
  // Memes capability provider credentials. Optional — memegen.link
  // works without any config, Imgflip and Giphy need credentials.
  memes?: MemesConfig
  computerUse?: ComputerUseConfig
  browserExtension?: BrowserExtensionConfig
  compaction?: CompactionConfig
  updates?: UpdatesConfig
  // MCP server connections. Types live in @main/runtime/mcp/types (pure,
  // test-importable) and are re-exported below. Optional so legacy
  // configs migrate cleanly — when absent no connections exist.
  mcp?: McpConfig
  lastSettingsState?: {
    tab?: string
    provider?: string
    channel?: string
    service?: string
    hippocampusTab?: string
  }
  disabledCapabilities?: string[]
  /**
   * Extra capabilities whose tool schemas ship on EVERY request, on top of
   * the built-in core set (see cerebellum CORE_CAPABILITIES). The tuning
   * knob for the lean tool surface — no UI, hand-edited in config.json.
   */
  pinnedCapabilities?: string[]
  locale: 'en' | 'ar'
  theme: 'system' | 'light' | 'dark'
  onboardingCompleted: boolean
}

export type WorkspaceStatus = {
  rootPath: string
  initialized: boolean
  hasLocalModel: boolean
  onboardingCompleted: boolean
  config: WorkspaceConfig | null
}

const WORKSPACE_ROOT = path.join(os.homedir(), '.wolffish', 'workspace')
const CONFIG_FILENAME = 'config.json'
const CONFIG_BACKUP_FILENAME = 'config.json.bak'
const LOCK_FILENAME = '.lock'
const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434'

export function workspaceRoot(): string {
  return WORKSPACE_ROOT
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}

/**
 * Wolffish-internal storage roots. Tool calls whose paths land inside any
 * of these are housekeeping the user never asked about — memory updates,
 * knowledge writes, episode logs. The renderer skips approval cards and
 * tool cards entirely for these so the chat stays focused on the
 * conversation, not on plumbing.
 */
function internalRoots(): string[] {
  const home = os.homedir()
  return [WORKSPACE_ROOT, path.join(home, 'brain')]
}

/**
 * True when a tool call targets wolffish's own storage and should run
 * without surfacing any UI. Path-traversal attempts (`..`) are never
 * silenced — those still hit the normal danger-pattern flow.
 */
export function isInternalToolCall(name: string, args: Record<string, unknown>): boolean {
  if (name !== 'file_read' && name !== 'file_write' && name !== 'file_patch') return false
  const raw = args.path
  if (typeof raw !== 'string' || raw.length === 0) return false
  if (raw.includes('..')) return false
  const resolved = path.resolve(expandHome(raw))
  return internalRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep))
}

/**
 * Wipe the entire ~/.wolffish/workspace tree. Caller is responsible for
 * relaunching the app afterwards — leaving the process running with no
 * workspace would put us in an undefined state.
 */
export async function purgeWorkspace(): Promise<void> {
  await fs.rm(WORKSPACE_ROOT, { recursive: true, force: true })
}

export function configPath(): string {
  return path.join(WORKSPACE_ROOT, CONFIG_FILENAME)
}

export function configBackupPath(): string {
  return path.join(WORKSPACE_ROOT, CONFIG_BACKUP_FILENAME)
}

export function lockfilePath(): string {
  return path.join(WORKSPACE_ROOT, LOCK_FILENAME)
}

export function defaultsRootPath(): string {
  if (is.dev) {
    return path.join(app.getAppPath(), 'src', 'defaults')
  }
  return path.join(process.resourcesPath, 'defaults')
}

export function defaultsWorkspacePath(): string {
  return path.join(defaultsRootPath(), 'workspace')
}

export async function readConfig(): Promise<WorkspaceConfig | null> {
  try {
    const { config } = await readConfigStrict()
    return config
  } catch {
    // Lenient read for the many read-only callers (getStatus, getVariables,
    // the integration getXConfig helpers) that already treat a missing or
    // unreadable config as null. Never throws.
    return null
  }
}

/**
 * Read config.json while preserving the distinction the lenient readConfig
 * throws away: a file that is genuinely ABSENT (fresh workspace) versus one
 * that EXISTS but momentarily fails to read or parse (a foreign writer caught
 * mid-write, a transient IO error). That distinction is load-bearing — a
 * config that exists must never be treated as "absent", or a follow-up
 * patchConfig would overwrite real settings with defaults.
 *
 * Returns { exists:false } only for ENOENT. Throws for any other read error
 * or for unparseable JSON.
 */
async function readConfigStrict(): Promise<{ exists: boolean; config: WorkspaceConfig | null }> {
  let raw: string
  try {
    raw = await fs.readFile(configPath(), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, config: null }
    }
    throw err
  }
  return { exists: true, config: JSON.parse(raw) as WorkspaceConfig }
}

// Serializes every config write and read-modify-write through one in-process
// promise chain. The atomic write below guarantees no reader sees a torn
// file; this guarantees no two writers interleave and lose each other's
// update (e.g. a Telegram /local command racing a UI setting change, or the
// renderer's thinking-mode effect racing a provider save). Single-threaded JS
// reassigns `configMutex` synchronously per call, so callers queue FIFO.
let configMutex: Promise<unknown> = Promise.resolve()

function withConfigLock<T>(op: () => Promise<T>): Promise<T> {
  const run = configMutex.then(op, op)
  // Keep the chain moving whether op resolves or rejects; never let a
  // rejection wedge the queue or surface as an unhandled rejection here.
  configMutex = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export async function writeConfig(config: WorkspaceConfig): Promise<void> {
  await withConfigLock(() => writeConfigAtomic(config))
}

/**
 * Atomic write through the single I/O layer: temp file + fsync + rename(2),
 * serialized per path, so a concurrent reader or a crash always sees the
 * complete old file or the complete new one — never the truncated window a
 * bare fs.writeFile exposes mid-write (the partial-read that made readConfig()
 * return null and patchConfig() fall back to defaults, wiping keys/providers).
 * After the swap we mirror the same bytes to config.json.bak as a last-known-
 * good snapshot for recovery.
 *
 * Always reached through writeConfig or patchConfig, both of which already hold
 * the config lock (the logical read-modify-write mutex); diskWriter adds the
 * physical per-path serialization on top.
 */
async function writeConfigAtomic(config: WorkspaceConfig): Promise<void> {
  const data = JSON.stringify(config, null, 2)
  await diskWriter.writeFileAtomic(configPath(), data)
  // Best-effort last-known-good snapshot. A failure here can never affect the
  // live file, and the backup is only ever read as a recovery fallback.
  await diskWriter.writeFileAtomic(configBackupPath(), data).catch(() => {})
}

export async function patchConfig(
  patch: (current: WorkspaceConfig) => WorkspaceConfig
): Promise<WorkspaceConfig> {
  return withConfigLock(async () => {
    const current = await loadConfigBase()
    const next = patch(current)
    await writeConfigAtomic(next)
    return next
  })
}

/**
 * The object a patch is applied on top of. Seeds defaults ONLY when the
 * workspace genuinely has no config yet (fresh install). If config.json
 * exists but can't be read or parsed, we recover the last-known-good backup
 * rather than rebuilding from defaults — falling back to defaults here is the
 * precise bug that wiped real settings. If neither the file nor a usable
 * backup can be read, we throw to abort the write: failing one setting is
 * recoverable; clobbering the whole config is not.
 */
async function loadConfigBase(): Promise<WorkspaceConfig> {
  try {
    const { exists, config } = await readConfigStrict()
    if (config) return config
    if (!exists) return defaultConfig()
  } catch {
    // exists-but-unreadable — fall through to backup recovery
  }
  const backup = await readBackupConfig()
  if (backup) return backup
  throw new Error(
    'config.json exists but is unreadable and no usable backup was found; ' +
      'refusing to overwrite it with defaults'
  )
}

async function readBackupConfig(): Promise<WorkspaceConfig | null> {
  try {
    const raw = await fs.readFile(configBackupPath(), 'utf8')
    return JSON.parse(raw) as WorkspaceConfig
  } catch {
    return null
  }
}

function emptyLocalModel(): LocalModelConfig {
  return {
    enabled: false,
    provider: 'ollama',
    model: null,
    endpoint: DEFAULT_OLLAMA_ENDPOINT
  }
}

function defaultConfig(): WorkspaceConfig {
  return {
    version: 1,
    launchAtStartup: false,
    llm: {
      local: emptyLocalModel(),
      providers: [],
      restrictPowerfulModels: true
    },
    safety: { bypassPermissions: true, blockCredentials: false },
    updates: { enabled: true },
    showChatAnalytics: true,
    weekStartsOn: 1,
    locale: 'en',
    theme: 'system',
    onboardingCompleted: false
  }
}

export async function ensureWorkspace(): Promise<void> {
  const fresh = !existsSync(WORKSPACE_ROOT)

  if (fresh) {
    const source = defaultsWorkspacePath()
    if (!existsSync(source)) {
      throw new Error(`default workspace missing at ${source}`)
    }
    // Skip the cerebellum subtree — ensureBundledCapabilities below copies
    // each capability under its dot-prefixed name. Without this skip, fresh
    // installs end up with both `<name>/` (from the bulk copy) and `.<name>/`
    // (from ensureBundledCapabilities) sitting side-by-side.
    const cerebellumSource = path.join(source, 'brain', 'cerebellum')
    await fs.cp(source, WORKSPACE_ROOT, {
      recursive: true,
      force: false,
      filter: (src) => {
        if (src.endsWith('.DS_Store')) return false
        if (src === cerebellumSource || src.startsWith(cerebellumSource + path.sep)) return false
        return true
      }
    })
    if (!existsSync(configPath())) {
      await writeConfig(defaultConfig())
    }
  }

  // Post-update migration: merge new config keys, overwrite agents.core.md,
  // version-check official capabilities, and nuke cortex.db so it rebuilds.
  // Must run before ensureBundledCapabilities so capability version checks
  // see the current bundled versions.
  await migrateConfig()
  await migrateBrain()
  await migrateConnections()
  await migrateTtsConfig()
  await migrateStaleArtifacts()
  await migrateAgentsCore()
  await migrateAgentsGuide()
  await migrateIdentityRoleFiles()

  // Always sync bundled capabilities — new ones get added and existing
  // ones get refreshed on every launch, so plugin bug fixes shipped by an
  // app upgrade actually reach existing workspaces. Files the user added
  // alongside a bundled plugin (e.g. node_modules from `npm install`,
  // ad-hoc notes) are preserved because we copy with force-overwrite, not
  // a wipe-and-replace.
  await ensureBundledCapabilities()
  await migrateOfficialCapabilities()

  // cortex.db is NOT nuked here anymore: Cortex.init() is schema-versioned
  // (full rebuild on version bump) and its startup catch-up diff picks up any
  // files the migrations above changed — a full every-launch rebuild would
  // throw away the incremental index for nothing.

  await ensureUsageStructure()
  await ensureSpeechDirectory()
  await ensureVoiceDirectory()
  await ensureUploadsDirectory()
  await ensureFilesDirectory()
  await ensureScreenshotsDirectory()
  await ensureLogsDirectory()
  await ensureExtensionLogsDirectory()
  await ensureBundledExtension()
}

async function ensureBundledCapabilities(): Promise<void> {
  const defaultsDir = path.join(defaultsWorkspacePath(), 'brain', 'cerebellum')
  if (!existsSync(defaultsDir)) return

  const userDir = path.join(WORKSPACE_ROOT, 'brain', 'cerebellum')
  await fs.mkdir(userDir, { recursive: true })

  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(defaultsDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    // Bundled capabilities live in dot-prefixed folders (.git, .browser, …)
    // so they're hidden from `ls` but still load and show in our UI.
    const target = path.join(userDir, `.${entry.name}`)
    const source = path.join(defaultsDir, entry.name)
    await fs.cp(source, target, {
      recursive: true,
      force: true,
      filter: (src) => {
        if (src.endsWith('.DS_Store')) return false
        const rel = path.relative(source, src)
        if (rel === 'node_modules' || rel.startsWith('node_modules' + path.sep)) return false
        if (
          rel === 'plugin' + path.sep + 'node_modules' ||
          rel.startsWith('plugin' + path.sep + 'node_modules' + path.sep)
        )
          return false
        return true
      }
    })
  }
}

let bundledCapabilityNamesCache: Set<string> | null = null

/**
 * Names of capabilities that ship with the app (bundled under
 * src/defaults/workspace/brain/cerebellum/). Anything else in the user's
 * workspace was dropped in by them. Read once and cached — the bundled
 * set doesn't change at runtime.
 */
export async function bundledCapabilityNames(): Promise<Set<string>> {
  if (bundledCapabilityNamesCache) return bundledCapabilityNamesCache
  const defaultsDir = path.join(defaultsWorkspacePath(), 'brain', 'cerebellum')
  const names = new Set<string>()
  try {
    const entries = await fs.readdir(defaultsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      names.add(entry.name)
    }
  } catch {
    // best-effort — if defaults are unreadable, treat everything as user-provided
  }
  bundledCapabilityNamesCache = names
  return names
}

async function ensureSpeechDirectory(): Promise<void> {
  await fs.mkdir(path.join(WORKSPACE_ROOT, 'speech'), { recursive: true })
}

async function ensureVoiceDirectory(): Promise<void> {
  await fs.mkdir(path.join(WORKSPACE_ROOT, 'voice'), { recursive: true })
}

async function ensureUploadsDirectory(): Promise<void> {
  await fs.mkdir(path.join(WORKSPACE_ROOT, 'uploads'), { recursive: true })
}

async function ensureFilesDirectory(): Promise<void> {
  await fs.mkdir(path.join(WORKSPACE_ROOT, 'files'), { recursive: true })
}

async function ensureScreenshotsDirectory(): Promise<void> {
  await fs.mkdir(path.join(WORKSPACE_ROOT, 'screenshots'), { recursive: true })
}

async function ensureLogsDirectory(): Promise<void> {
  await fs.mkdir(path.join(WORKSPACE_ROOT, 'logs'), { recursive: true })
}

// ---------------------------------------------------------------------------
// Post-update migration helpers
// ---------------------------------------------------------------------------

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function deepMergeAdditive(
  user: Record<string, unknown>,
  defaults: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...user }
  for (const key of Object.keys(defaults)) {
    if (!(key in merged)) {
      merged[key] = defaults[key]
    } else if (isPlainObject(merged[key]) && isPlainObject(defaults[key])) {
      merged[key] = deepMergeAdditive(
        merged[key] as Record<string, unknown>,
        defaults[key] as Record<string, unknown>
      )
    }
  }
  return merged
}

async function migrateConfig(): Promise<void> {
  const userConfig = await readConfig()
  if (!userConfig) return
  const defaultsPath = path.join(defaultsWorkspacePath(), 'config.json')
  let bundledDefaults: Record<string, unknown>
  try {
    const raw = await fs.readFile(defaultsPath, 'utf8')
    bundledDefaults = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }
  const merged = deepMergeAdditive(
    userConfig as unknown as Record<string, unknown>,
    bundledDefaults
  ) as unknown as WorkspaceConfig
  await writeConfig(merged)
}

/**
 * One-time migration of the legacy single-token Notion/GitHub shape
 * (`{ token, name, email }` / `{ token, login, name }`) into the labeled
 * connections array (`{ connections: [...] }`). Idempotent: once the
 * value is already a `{ connections }` object it does nothing. The old
 * token is preserved as a single connection labeled "Default" so linked
 * accounts keep working across the update.
 */
async function migrateConnections(): Promise<void> {
  const config = await readConfig()
  if (!config) return
  const cfg = config as unknown as Record<string, unknown>
  let changed = false

  const notion = cfg.notion
  if (isPlainObject(notion) && !Array.isArray(notion.connections)) {
    cfg.notion = normalizeNotionConfig(notion)
    changed = true
  }

  const github = cfg.github
  if (isPlainObject(github) && !Array.isArray(github.connections)) {
    cfg.github = normalizeGitHubConfig(github)
    changed = true
  }

  if (changed) await writeConfig(config)
}

/**
 * Derive the single-Brain selection from the legacy cascade config and strip
 * the dead cascade keys (`cloudPriority`, `allowLocalFallback`). Idempotent:
 * once `llm.brain` exists and the dead keys are gone it does nothing. The
 * Brain is seeded from the old primary (cloudPriority[0], or the first
 * configured provider) so existing users keep running on the same model.
 * Runs AFTER migrateConfig so the additive merge can't re-introduce the
 * removed keys.
 */
async function migrateBrain(): Promise<void> {
  const config = await readConfig()
  if (!config) return
  const llm = config.llm as typeof config.llm & {
    cloudPriority?: CloudProviderConfig['id'][]
    allowLocalFallback?: boolean
    statelessLocalModels?: boolean
    restrictLocalModels?: boolean
  }
  const hasDeadKeys =
    'cloudPriority' in llm ||
    'allowLocalFallback' in llm ||
    // The two local-model context lobotomies died with the lean-context
    // unification — strip them so stale config can't imply they still work.
    'statelessLocalModels' in llm ||
    'restrictLocalModels' in llm
  const alreadyMigrated = 'brain' in llm
  if (alreadyMigrated && !hasDeadKeys) return

  // Seed the Brain from the old primary provider when not already set.
  let brain = config.llm.brain ?? null
  if (!alreadyMigrated) {
    const firstId =
      llm.cloudPriority?.find((id) => config.llm.providers.some((p) => p.id === id)) ??
      config.llm.providers[0]?.id
    const provider = firstId ? config.llm.providers.find((p) => p.id === firstId) : undefined
    brain = provider ? { providerId: provider.id, model: provider.model } : null
  }
  delete llm.cloudPriority
  delete llm.allowLocalFallback
  delete llm.statelessLocalModels
  delete llm.restrictLocalModels
  await writeConfig({ ...config, llm: { ...llm, brain } })
}

/**
 * One-time migration off the old Microsoft edge-tts engine. Its voice ids
 * ("en-US-AriaNeural") use hyphens and its speeds ("+0%") use percent signs —
 * neither of which the Kokoro engine understands. Clear stale-format values so
 * the TTS plugin and Settings fall back to their Kokoro defaults (af_bella, 1.0).
 */
async function migrateTtsConfig(): Promise<void> {
  const config = await readConfig()
  if (!config?.tts) return
  const tts = { ...config.tts }
  let changed = false
  if (tts.defaultVoice && tts.defaultVoice.includes('-')) {
    tts.defaultVoice = ''
    changed = true
  }
  if (tts.defaultSpeed && tts.defaultSpeed.includes('%')) {
    tts.defaultSpeed = ''
    changed = true
  }
  if (changed) await writeConfig({ ...config, tts })
}

/**
 * Reclaim disk left behind by engine migrations. The old speech-to-text engine
 * (openai-whisper) pulled a ~2 GB PyTorch into a managed venv at
 * bin/python/venvs/whisper; faster-whisper now lives in venvs/faster-whisper, so
 * the old one is dead weight. Remove it proactively on launch so the space is
 * freed even if the user never invokes speech-to-text again. Strictly scoped to
 * our own ~/.wolffish footprint; idempotent and best-effort.
 *
 * (Not touched, because they live outside our footprint / in the user's own
 * environment: openai-whisper's `~/.cache/whisper` model cache and the system
 * `edge-tts` package the old text-to-speech engine installed.)
 */
async function migrateStaleArtifacts(): Promise<void> {
  const binRoot = path.join(path.dirname(WORKSPACE_ROOT), 'bin')
  const staleWhisperVenv = path.join(binRoot, 'python', 'venvs', 'whisper')
  if (existsSync(staleWhisperVenv)) {
    await fs.rm(staleWhisperVenv, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function migrateAgentsCore(): Promise<void> {
  const bundled = path.join(defaultsWorkspacePath(), 'brain', 'prefrontal', 'agents.core.md')
  if (!existsSync(bundled)) return
  const target = path.join(WORKSPACE_ROOT, 'brain', 'prefrontal', 'agents.core.md')
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(bundled, target)
}

/**
 * AGENTS.md is the orientation guide for any AI assistant pointed at the
 * ~/.wolffish folder. It lives at the ROOT of ~/.wolffish (next to workspace/,
 * runtime/, logs/) — not inside the workspace — because it documents the whole
 * footprint, and its own map and path references are written relative to that
 * root. Bundled at src/defaults/AGENTS.md.
 *
 * App-managed, exactly like agents.core.md above: the bundled copy is rewritten
 * on every launch, so an app upgrade always ships the current guide. Wolffish
 * owns this file — local edits are replaced on the next launch. Custom,
 * persistent agent instructions belong in brain/prefrontal/agents.md, which we
 * never overwrite.
 */
async function migrateAgentsGuide(): Promise<void> {
  const bundled = path.join(defaultsRootPath(), 'AGENTS.md')
  if (!existsSync(bundled)) return
  const target = path.join(path.dirname(WORKSPACE_ROOT), 'AGENTS.md')
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(bundled, target)
}

/**
 * The orchestrator/worker role prompts (brain/identity/) are APP-MANAGED, like
 * agents.core.md: overwritten on every launch so prompt improvements ship with
 * an upgrade. They're framework behaviour, not personalization — custom agent
 * instructions belong in brain/prefrontal/agents.md, which we never overwrite.
 */
async function migrateIdentityRoleFiles(): Promise<void> {
  for (const name of ['orchestrator.md', 'worker.md']) {
    const bundled = path.join(defaultsWorkspacePath(), 'brain', 'identity', name)
    if (!existsSync(bundled)) continue
    const target = path.join(WORKSPACE_ROOT, 'brain', 'identity', name)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(bundled, target)
  }
}

function parseSkillVersion(content: string): string | null {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!fmMatch) return null
  try {
    const fm = yaml.load(fmMatch[1]) as Record<string, unknown>
    return typeof fm.version === 'string' ? fm.version : String(fm.version ?? '')
  } catch {
    return null
  }
}

async function fileHash(filePath: string): Promise<string> {
  try {
    const data = await fs.readFile(filePath)
    return createHash('sha256').update(data).digest('hex')
  } catch {
    return ''
  }
}

function npmInstall(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('npm', ['install', '--production'], { cwd }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function migrateOfficialCapabilities(): Promise<void> {
  const bundledDir = path.join(defaultsWorkspacePath(), 'brain', 'cerebellum')
  if (!existsSync(bundledDir)) return

  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(bundledDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const bundledRoot = path.join(bundledDir, entry.name)
    const installedRoot = path.join(WORKSPACE_ROOT, 'brain', 'cerebellum', `.${entry.name}`)

    const bundledSkill = path.join(bundledRoot, 'SKILL.md')
    if (!existsSync(bundledSkill)) continue

    const bundledContent = await fs.readFile(bundledSkill, 'utf8').catch(() => '')
    const bundledVersion = parseSkillVersion(bundledContent)
    if (!bundledVersion) continue

    const installedSkill = path.join(installedRoot, 'SKILL.md')
    let installedVersion: string | null = null
    if (existsSync(installedSkill)) {
      const installedContent = await fs.readFile(installedSkill, 'utf8').catch(() => '')
      installedVersion = parseSkillVersion(installedContent)
    }

    if (installedVersion && !semver.lt(installedVersion, bundledVersion)) continue

    const oldPkgHash = await fileHash(path.join(installedRoot, 'plugin', 'package.json'))

    await fs.cp(bundledRoot, installedRoot, {
      recursive: true,
      force: true,
      filter: (src) => {
        if (src.endsWith('.DS_Store')) return false
        const rel = path.relative(bundledRoot, src)
        if (rel.startsWith('plugin' + path.sep + 'node_modules')) return false
        if (rel === 'plugin' + path.sep + 'node_modules') return false
        return true
      }
    })

    const newPkgPath = path.join(installedRoot, 'plugin', 'package.json')
    if (existsSync(newPkgPath)) {
      const newPkgHash = await fileHash(newPkgPath)
      if (oldPkgHash !== newPkgHash) {
        await npmInstall(path.join(installedRoot, 'plugin')).catch((err) => {
          console.error(`npm install failed for capability ${entry.name}:`, err)
        })
      }
    }
  }
}

async function ensureUsageStructure(): Promise<void> {
  const usageDir = path.join(WORKSPACE_ROOT, 'usage')
  const providersDir = path.join(usageDir, 'providers')
  const dailyDir = path.join(usageDir, 'daily')
  await fs.mkdir(providersDir, { recursive: true })
  await fs.mkdir(dailyDir, { recursive: true })

  const providerFiles = [
    { file: 'ollama.md', header: '# Ollama' },
    { file: 'anthropic.md', header: '# Anthropic' },
    { file: 'openai.md', header: '# OpenAI' },
    { file: 'mimo.md', header: '# Xiaomi Mimo' },
    { file: 'kimi.md', header: '# Kimi' },
    { file: 'minimax.md', header: '# MiniMax' }
  ]
  for (const { file, header } of providerFiles) {
    const filepath = path.join(providersDir, file)
    if (!existsSync(filepath)) {
      await diskWriter.writeFileAtomic(filepath, `${header}\n`)
    }
  }
}

export async function getStatus(): Promise<WorkspaceStatus> {
  const config = await readConfig()
  const initialized = config !== null
  const hasLocalModel = !!config?.llm.local.model
  return {
    rootPath: WORKSPACE_ROOT,
    initialized,
    hasLocalModel,
    onboardingCompleted: !!config?.onboardingCompleted,
    config
  }
}

export async function selectLocalModel(modelName: string): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({
    ...c,
    llm: {
      ...c.llm,
      local: {
        enabled: true,
        provider: 'ollama',
        model: modelName,
        endpoint: c.llm.local.endpoint || DEFAULT_OLLAMA_ENDPOINT
      }
    }
  }))
}

export async function clearLocalModel(): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({
    ...c,
    llm: { ...c.llm, local: emptyLocalModel() }
  }))
}

export async function setCloudProvider(provider: CloudProviderConfig): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const others = c.llm.providers.filter((p) => p.id !== provider.id)
    const nextProviders = [...others, provider]
    // Keep the Brain's model in sync when its own provider's model changes.
    const brain =
      c.llm.brain && c.llm.brain.providerId === provider.id
        ? { providerId: provider.id, model: provider.model }
        : c.llm.brain
    return {
      ...c,
      llm: { ...c.llm, providers: nextProviders, brain }
    }
  })
}

export async function removeCloudProvider(id: CloudProviderConfig['id']): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const nextProviders = c.llm.providers.filter((p) => p.id !== id)
    // Clear the Brain / worker model if either pointed at the removed provider.
    const brain = c.llm.brain && c.llm.brain.providerId === id ? null : c.llm.brain
    const workerModel =
      c.llm.workerModel && c.llm.workerModel.providerId === id ? null : c.llm.workerModel
    return {
      ...c,
      llm: { ...c.llm, providers: nextProviders, brain, workerModel }
    }
  })
}

/**
 * Set (or clear) the Brain — the single user-chosen cloud model. When
 * non-null, mirror its model onto the matching provider record so the
 * Brain and that provider never drift.
 */
export async function setBrain(
  brain: { providerId: CloudProviderConfig['id']; model: string } | null
): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    if (!brain) return { ...c, llm: { ...c.llm, brain: null } }
    const providers = c.llm.providers.map((p) =>
      p.id === brain.providerId ? { ...p, model: brain.model } : p
    )
    return { ...c, llm: { ...c.llm, providers, brain } }
  })
}

/** Set the orchestrator-mode toggle: 'single' (Phase-1 app) vs 'orchestrator'. */
export async function setOrchestratorMode(
  mode: 'single' | 'orchestrator'
): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const llm = { ...c.llm, orchestratorMode: mode }
    // Default the worker to the same model as the orchestrator (the brain) the
    // first time orchestrator mode is enabled, so it works out of the box. Only
    // when no worker is set yet — never overrides a user's explicit choice.
    if (mode === 'orchestrator' && !llm.workerModel && llm.brain) {
      llm.workerModel = llm.brain
    }
    return { ...c, llm }
  })
}

/**
 * Set (or clear) the worker model — what live worker sessions run on in
 * orchestrator mode. Stored independently of `brain` and NOT mirrored onto the
 * provider record (brain owns that mirror; a shared provider has one `model`
 * field that can't represent both roles). resolveWorker reads this directly.
 */
export async function setWorkerModel(
  worker: { providerId: CloudProviderConfig['id']; model: string } | null
): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({ ...c, llm: { ...c.llm, workerModel: worker } }))
}

/** Toggle greedy effort — see the `greedy` config field. */
export async function setGreedy(greedy: boolean): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({ ...c, llm: { ...c.llm, greedy } }))
}

/** Toggle autonomy — see the `autonomous` config field. */
export async function setAutonomous(autonomous: boolean): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({ ...c, llm: { ...c.llm, autonomous } }))
}

// If the config records a model name no longer in our curated catalog (e.g.
// the catalog was bumped to a new major), clear it so the user is routed
// back to the picker. The renderer additionally checks Ollama at startup for
// installed status.
export async function reconcileLocalModel(): Promise<void> {
  const config = await readConfig()
  if (!config) return
  const { model } = config.llm.local
  if (!model) return
  if (!isKnownModelName(model)) {
    await clearLocalModel()
  }
}

export async function markOnboardingComplete(): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({ ...c, onboardingCompleted: true }))
}

export async function setLocale(locale: 'en' | 'ar'): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({ ...c, locale }))
}

export async function setTheme(theme: 'system' | 'light' | 'dark'): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({ ...c, theme }))
}

export async function setBypassPermissions(value: boolean): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({
    ...c,
    safety: {
      ...(c.safety ?? { bypassPermissions: false, blockCredentials: false }),
      bypassPermissions: value
    }
  }))
}

export async function setBlockCredentials(value: boolean): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({
    ...c,
    safety: {
      ...(c.safety ?? { bypassPermissions: false, blockCredentials: false }),
      blockCredentials: value
    }
  }))
}

export async function setLocalOnly(value: boolean): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({
    ...c,
    llm: { ...c.llm, localOnly: value }
  }))
}

export async function setShowChatAnalytics(value: boolean): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({ ...c, showChatAnalytics: value }))
}

export async function setWeekStartsOn(value: WeekStartsOn): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({ ...c, weekStartsOn: value }))
}

export const DEFAULT_COMPACTION: CompactionConfig = {
  dailyHour: 23,
  weeklyDay: 0,
  weeklyHour: 23
}

export async function getCompactionConfig(): Promise<CompactionConfig> {
  const cfg = await readConfig()
  return cfg?.compaction ?? DEFAULT_COMPACTION
}

export async function setCompactionConfig(
  patch: Partial<CompactionConfig>
): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const current = c.compaction ?? DEFAULT_COMPACTION
    return { ...c, compaction: { ...current, ...patch } }
  })
}

export async function setRestrictPowerfulModels(value: boolean): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({
    ...c,
    llm: { ...c.llm, restrictPowerfulModels: value }
  }))
}

export async function setThinkingMode(model: string, mode: string): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({
    ...c,
    llm: {
      ...c.llm,
      thinkingModes: { ...c.llm.thinkingModes, [model]: mode }
    }
  }))
}

export async function setLaunchAtStartup(value: boolean): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({ ...c, launchAtStartup: value }))
}

/**
 * Wipe the data inside ~/.wolffish/workspace but preserve user preferences:
 * API keys, model selection, locale, theme, runtime toggles, and the
 * week-start setting. Memories, conversations, feedback, tasks, debug
 * snapshots, corpus event logs, knowledge files, identity tweaks, and
 * usage data are all deleted; bundled defaults are recreated. Caller is
 * responsible for stopping the agent and relaunching the app afterwards
 * so no stale handles survive.
 */
export async function factoryReset(): Promise<void> {
  const preserved = await readConfig()
  await purgeWorkspace()
  await ensureWorkspace()
  if (preserved) {
    // Default config has been laid down by ensureWorkspace; overwrite it
    // with the preserved one so API keys, model selection, locale, theme,
    // and runtime toggles survive the reset. onboardingCompleted is
    // forced true because the user has already completed onboarding;
    // making them redo it after a data reset would be punitive.
    await writeConfig({ ...preserved, onboardingCompleted: true })
  }
}

export async function getVariables(): Promise<Variable[]> {
  const config = await readConfig()
  return config?.variables ?? []
}

export async function setVariables(variables: Variable[]): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({ ...c, variables }))
}

const EMPTY_TELEGRAM_CONFIG: TelegramConfig = {
  enabled: false,
  botToken: '',
  allowedUserIds: [],
  autoRefresh: true,
  staleHours: 3,
  verbose: false
}

export async function getTelegramConfig(): Promise<TelegramConfig> {
  const config = await readConfig()
  return config?.telegram ?? EMPTY_TELEGRAM_CONFIG
}

export async function setTelegramConfig(patch: Partial<TelegramConfig>): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const current = c.telegram ?? EMPTY_TELEGRAM_CONFIG
    const next: TelegramConfig = {
      enabled: patch.enabled ?? current.enabled,
      botToken: patch.botToken ?? current.botToken,
      allowedUserIds: patch.allowedUserIds ?? current.allowedUserIds,
      autoRefresh: patch.autoRefresh ?? current.autoRefresh,
      staleHours: patch.staleHours ?? current.staleHours,
      verbose: patch.verbose ?? current.verbose
    }
    return { ...c, telegram: next }
  })
}

const EMPTY_WHATSAPP_CONFIG: WhatsAppConfig = {
  enabled: false,
  allowedPhoneNumbers: [],
  autoRefresh: true,
  staleHours: 3,
  verbose: false
}

export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  const config = await readConfig()
  return config?.whatsapp ?? EMPTY_WHATSAPP_CONFIG
}

export async function setWhatsAppConfig(patch: Partial<WhatsAppConfig>): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const current = c.whatsapp ?? EMPTY_WHATSAPP_CONFIG
    const next: WhatsAppConfig = {
      enabled: patch.enabled ?? current.enabled,
      allowedPhoneNumbers: patch.allowedPhoneNumbers ?? current.allowedPhoneNumbers,
      autoRefresh: patch.autoRefresh ?? current.autoRefresh,
      staleHours: patch.staleHours ?? current.staleHours,
      verbose: patch.verbose ?? current.verbose
    }
    return { ...c, whatsapp: next }
  })
}

const EMPTY_INAPP_CONFIG: InAppConfig = {
  verbose: false
}

export async function getInAppConfig(): Promise<InAppConfig> {
  const config = await readConfig()
  return config?.inapp ?? EMPTY_INAPP_CONFIG
}

export async function setInAppConfig(patch: Partial<InAppConfig>): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const current = c.inapp ?? EMPTY_INAPP_CONFIG
    const next: InAppConfig = {
      verbose: patch.verbose ?? current.verbose
    }
    return { ...c, inapp: next }
  })
}

const EMPTY_BRAVE_CONFIG: BraveConfig = {
  enabled: false,
  apiKey: ''
}

export async function getBraveConfig(): Promise<BraveConfig> {
  const config = await readConfig()
  return config?.brave ?? EMPTY_BRAVE_CONFIG
}

export async function setBraveConfig(patch: Partial<BraveConfig>): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const current = c.brave ?? EMPTY_BRAVE_CONFIG
    const next: BraveConfig = {
      enabled: patch.enabled ?? current.enabled,
      apiKey: patch.apiKey ?? current.apiKey
    }
    return { ...c, brave: next }
  })
}

const EMPTY_STT_CONFIG: SttConfig = { defaultModel: '' }
const EMPTY_TTS_CONFIG: TtsConfig = { defaultVoice: '', defaultSpeed: '' }

export async function getSttConfig(): Promise<SttConfig> {
  const config = await readConfig()
  return config?.stt ?? EMPTY_STT_CONFIG
}

export async function setSttConfig(patch: Partial<SttConfig>): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const current = c.stt ?? EMPTY_STT_CONFIG
    const next: SttConfig = {
      defaultModel: patch.defaultModel ?? current.defaultModel
    }
    return { ...c, stt: next }
  })
}

export async function getTtsConfig(): Promise<TtsConfig> {
  const config = await readConfig()
  return config?.tts ?? EMPTY_TTS_CONFIG
}

export async function setTtsConfig(patch: Partial<TtsConfig>): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const current = c.tts ?? EMPTY_TTS_CONFIG
    const next: TtsConfig = {
      defaultVoice: patch.defaultVoice ?? current.defaultVoice,
      defaultSpeed: patch.defaultSpeed ?? current.defaultSpeed
    }
    return { ...c, tts: next }
  })
}

// Deterministic short key derived from a token, used only to synthesize a
// stable connection `id` for legacy or hand-edited configs that lack one
// (the UI always assigns a real uuid). djb2 — no crypto import needed.
function connectionKeyFromToken(token: string): string {
  let hash = 5381
  for (let i = 0; i < token.length; i++) {
    hash = ((hash << 5) + hash + token.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

/**
 * Coerce whatever is stored under `notion` into the connections shape.
 * Handles the legacy single-token shape (`{ token, name, email }`) by
 * folding it into a single "Default"-labeled connection so nothing is
 * lost before migrateConnections() rewrites config.json on disk.
 */
function normalizeNotionConfig(stored: unknown): NotionConfig {
  if (!isPlainObject(stored)) return { connections: [] }
  if (Array.isArray(stored.connections)) {
    const connections = stored.connections.filter(isPlainObject).map((c, i) => ({
      // Fall back to an index-qualified id so hand-edited entries that omit
      // both id and token don't collide on the same djb2('') hash.
      id:
        String(c.id ?? '').trim() || `notion-${i}-${connectionKeyFromToken(String(c.token ?? ''))}`,
      // Mirror the legacy branch: a blank label would be unreachable by the
      // model once several connections exist, so default it to "Default".
      label: String(c.label ?? '').trim() || 'Default',
      token: String(c.token ?? '').trim(),
      name: String(c.name ?? ''),
      email: String(c.email ?? '')
    }))
    return { connections }
  }
  const token = String(stored.token ?? '').trim()
  if (token) {
    return {
      connections: [
        {
          id: `notion-${connectionKeyFromToken(token)}`,
          label: String(stored.label ?? '').trim() || 'Default',
          token,
          name: String(stored.name ?? ''),
          email: String(stored.email ?? '')
        }
      ]
    }
  }
  return { connections: [] }
}

export async function getNotionConfig(): Promise<NotionConfig> {
  const config = await readConfig()
  return normalizeNotionConfig(config?.notion)
}

export async function setNotionConfig(connections: NotionConnection[]): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({ ...c, notion: { connections } }))
}

/**
 * Coerce whatever is stored under `github` into the connections shape,
 * folding the legacy single-token shape (`{ token, login, name }`) into
 * one "Default"-labeled connection.
 */
function normalizeGitHubConfig(stored: unknown): GitHubConfig {
  if (!isPlainObject(stored)) return { connections: [] }
  if (Array.isArray(stored.connections)) {
    const connections = stored.connections.filter(isPlainObject).map((c, i) => ({
      // Fall back to an index-qualified id so hand-edited entries that omit
      // both id and token don't collide on the same djb2('') hash.
      id:
        String(c.id ?? '').trim() || `github-${i}-${connectionKeyFromToken(String(c.token ?? ''))}`,
      // Mirror the legacy branch: a blank label would be unreachable by the
      // model once several connections exist, so default it to "Default".
      label: String(c.label ?? '').trim() || 'Default',
      token: String(c.token ?? '').trim(),
      login: String(c.login ?? ''),
      name: String(c.name ?? '')
    }))
    return { connections }
  }
  const token = String(stored.token ?? '').trim()
  if (token) {
    return {
      connections: [
        {
          id: `github-${connectionKeyFromToken(token)}`,
          label: String(stored.label ?? '').trim() || 'Default',
          token,
          login: String(stored.login ?? ''),
          name: String(stored.name ?? '')
        }
      ]
    }
  }
  return { connections: [] }
}

export async function getGitHubConfig(): Promise<GitHubConfig> {
  const config = await readConfig()
  return normalizeGitHubConfig(config?.github)
}

export async function setGitHubConfig(connections: GitHubConnection[]): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({ ...c, github: { connections } }))
}

const EMPTY_GOOGLE_CONFIG: GoogleConfig = {
  status: 'inactive',
  clientId: '',
  projectId: '',
  credentialsStored: false
}

export async function getGoogleConfig(): Promise<GoogleConfig> {
  const config = await readConfig()
  return config?.google ?? EMPTY_GOOGLE_CONFIG
}

export async function setGoogleConfig(patch: Partial<GoogleConfig>): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const current = c.google ?? EMPTY_GOOGLE_CONFIG
    const next: GoogleConfig = {
      status: patch.status ?? current.status,
      clientId: patch.clientId ?? current.clientId,
      projectId: patch.projectId ?? current.projectId,
      credentialsStored: patch.credentialsStored ?? current.credentialsStored
    }
    return { ...c, google: next }
  })
}

const EMPTY_MEMES_CONFIG: MemesConfig = {
  imgflip: { username: '', password: '' },
  giphy: { apiKey: '' }
}

export async function getMemesConfig(): Promise<MemesConfig> {
  const config = await readConfig()
  const stored = config?.memes
  if (!stored) return EMPTY_MEMES_CONFIG
  return {
    imgflip: {
      username: stored.imgflip?.username ?? '',
      password: stored.imgflip?.password ?? ''
    },
    giphy: {
      apiKey: stored.giphy?.apiKey ?? ''
    }
  }
}

export async function setMemesConfig(patch: Partial<MemesConfig>): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const current = c.memes ?? EMPTY_MEMES_CONFIG
    const next: MemesConfig = {
      imgflip: {
        username: patch.imgflip?.username ?? current.imgflip.username,
        password: patch.imgflip?.password ?? current.imgflip.password
      },
      giphy: {
        apiKey: patch.giphy?.apiKey ?? current.giphy.apiKey
      }
    }
    return { ...c, memes: next }
  })
}

const DEFAULT_COMPUTER_USE_CONFIG: ComputerUseConfig = {
  screenshotMaxWidth: 1280,
  screenshotFormat: 'jpeg'
}

export async function getComputerUseConfig(): Promise<ComputerUseConfig> {
  const config = await readConfig()
  const stored = config?.computerUse
  if (!stored) return DEFAULT_COMPUTER_USE_CONFIG
  return {
    screenshotMaxWidth: stored.screenshotMaxWidth ?? 1280,
    screenshotFormat: stored.screenshotFormat ?? 'jpeg'
  }
}

export async function setComputerUseConfig(
  patch: Partial<ComputerUseConfig>
): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const current = c.computerUse ?? DEFAULT_COMPUTER_USE_CONFIG
    const next: ComputerUseConfig = {
      screenshotMaxWidth: patch.screenshotMaxWidth ?? current.screenshotMaxWidth,
      screenshotFormat: patch.screenshotFormat ?? current.screenshotFormat
    }
    return { ...c, computerUse: next }
  })
}

// ─── Browser Extension ──────────────────────────────────────────────────

const DEFAULT_BROWSER_EXTENSION_CONFIG: BrowserExtensionConfig = {
  port: 23151,
  screenshotMaxWidth: 1280,
  screenshotFormat: 'jpeg',
  screenshotQuality: 80
}

export async function getBrowserExtensionConfig(): Promise<BrowserExtensionConfig> {
  const config = await readConfig()
  const stored = config?.browserExtension
  if (!stored) return DEFAULT_BROWSER_EXTENSION_CONFIG
  return {
    port: stored.port ?? 23151,
    screenshotMaxWidth: stored.screenshotMaxWidth ?? 1280,
    screenshotFormat: stored.screenshotFormat ?? 'jpeg',
    screenshotQuality: stored.screenshotQuality ?? 80
  }
}

export async function setBrowserExtensionConfig(
  patch: Partial<BrowserExtensionConfig>
): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const current = { ...DEFAULT_BROWSER_EXTENSION_CONFIG, ...c.browserExtension }
    return {
      ...c,
      browserExtension: {
        port: patch.port ?? current.port,
        screenshotMaxWidth: patch.screenshotMaxWidth ?? current.screenshotMaxWidth,
        screenshotFormat: patch.screenshotFormat ?? current.screenshotFormat,
        screenshotQuality: patch.screenshotQuality ?? current.screenshotQuality
      }
    }
  })
}

export type { McpConfig, McpOauthState, McpServerConfig }

const EMPTY_MCP_CONFIG: McpConfig = { servers: [] }

export async function getMcpConfig(): Promise<McpConfig> {
  const config = await readConfig()
  return config?.mcp ?? EMPTY_MCP_CONFIG
}

export async function addMcpServer(server: McpServerConfig): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const servers = (c.mcp ?? EMPTY_MCP_CONFIG).servers.filter((s) => s.id !== server.id)
    return { ...c, mcp: { servers: [...servers, server] } }
  })
}

/**
 * Patch a server record by id. Strictly map-in-place: when the record no
 * longer exists (removed while an async caller was in flight) this is a
 * no-op — it must never re-create a deleted server.
 */
export async function updateMcpServer(
  id: string,
  patch: Partial<Pick<McpServerConfig, 'name' | 'enabled' | 'command' | 'url' | 'env'>>
): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const servers = (c.mcp ?? EMPTY_MCP_CONFIG).servers
    if (!servers.some((s) => s.id === id)) return c
    return {
      ...c,
      mcp: { servers: servers.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
    }
  })
}

/**
 * Merge OAuth state (tokens, client registration, callback port) into a
 * server record. Same map-in-place/no-op contract as updateMcpServer —
 * the MCP SDK calls this mid-connect and must not race a user's remove.
 * An explicit `undefined` value clears the field (credential invalidation).
 */
export async function patchMcpServerOauth(
  id: string,
  patch: Partial<McpOauthState>
): Promise<void> {
  await patchConfig((c) => {
    const servers = (c.mcp ?? EMPTY_MCP_CONFIG).servers
    if (!servers.some((s) => s.id === id)) return c
    return {
      ...c,
      mcp: {
        servers: servers.map((s) => {
          if (s.id !== id) return s
          const oauth: McpOauthState = { ...s.oauth }
          for (const key of ['clientInformation', 'tokens', 'redirectPort'] as const) {
            if (!(key in patch)) continue
            const value = patch[key]
            if (value === undefined) delete oauth[key]
            else (oauth as Record<string, unknown>)[key] = value
          }
          return { ...s, oauth }
        })
      }
    }
  })
}

/**
 * Remove a server and everything it owned: its config record (including
 * OAuth tokens) and any stale disabledCapabilities entry — a later
 * server that lands the same slug must not inherit a disable.
 */
export async function removeMcpServer(id: string): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const servers = (c.mcp ?? EMPTY_MCP_CONFIG).servers
    const removed = servers.find((s) => s.id === id)
    const next: WorkspaceConfig = { ...c, mcp: { servers: servers.filter((s) => s.id !== id) } }
    if (removed && next.disabledCapabilities) {
      next.disabledCapabilities = next.disabledCapabilities.filter(
        (name) => name !== mcpCapabilityName(removed.slug)
      )
    }
    return next
  })
}

export function extensionFolderPath(): string {
  return path.join(WORKSPACE_ROOT, 'extension')
}

async function ensureExtensionLogsDirectory(): Promise<void> {
  await fs.mkdir(path.join(WORKSPACE_ROOT, 'logs', 'extension'), { recursive: true })
}

/**
 * Read the version from a manifest.json file. Returns null if unreadable.
 */
async function readManifestVersion(manifestPath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(raw) as { version?: string }
    return manifest.version ?? null
  } catch {
    return null
  }
}

/**
 * Version of the extension bundled with the app binary. This is the
 * source of truth — on every launch the runtime extension folder is
 * synced to this version.
 */
export async function getBundledExtensionVersion(): Promise<string | null> {
  return readManifestVersion(path.join(defaultsWorkspacePath(), 'extension', 'manifest.json'))
}

/**
 * Version of the extension currently in the runtime workspace folder
 * (~/.wolffish/workspace/extension/). May lag behind the bundled
 * version until the next app launch syncs them.
 */
export async function getRuntimeExtensionVersion(): Promise<string | null> {
  return readManifestVersion(path.join(WORKSPACE_ROOT, 'extension', 'manifest.json'))
}

/**
 * Sync bundled extension files to the runtime workspace. Called on
 * every app launch so plugin bug fixes shipped with an app upgrade
 * reach the user automatically. Returns true if files were updated
 * (bundled version differs from runtime version).
 */
async function ensureBundledExtension(): Promise<void> {
  const source = path.join(defaultsWorkspacePath(), 'extension')
  if (!existsSync(source)) return
  const target = path.join(WORKSPACE_ROOT, 'extension')
  await fs.cp(source, target, {
    recursive: true,
    force: true,
    filter: (src) => !src.endsWith('.DS_Store')
  })
}
