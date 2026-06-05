import { is } from '@electron-toolkit/utils'
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
  id: 'anthropic' | 'openai' | 'deepseek' | 'mimo' | 'kimi' | 'minimax' | 'xai' | 'qwen' | 'stepfun'
  model: string
  apiKey: string
  // Cached from the provider's /v1/models endpoint. Refreshed on app
  // startup (see refreshAllProviderModels in main/index.ts) and on each
  // successful "Test" in settings. Optional so legacy configs migrate
  // cleanly — an empty cache just means "no list yet, retest to populate".
  models?: string[]
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
}

export type BraveConfig = {
  enabled: boolean
  apiKey: string
}

/**
 * Notion integration token. When `token` is non-empty, the notion
 * cerebellum plugin can read/write Notion pages, databases, and blocks.
 * Stateless — no daemon, no long-poll. The plugin reads config.json
 * directly on every tool call.
 */
export type NotionConfig = {
  token: string
}

/**
 * GitHub Personal Access Token plus the authenticated account snapshot.
 * `token` is the credential the cerebellum plugin reads on every call.
 * `login` and `name` are populated by the settings panel after a
 * successful Test Connection — kept in config.json so the UI can show
 * the connected account on next launch without re-testing. Cleared
 * automatically when the token changes (a new token may belong to a
 * different account, so the cached identity is no longer trustworthy).
 */
export type GitHubConfig = {
  token: string
  login: string
  name: string
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
 * `defaultVoice` is an Edge-TTS voice name (e.g. `en-US-AriaNeural`).
 * `defaultSpeed` is the rate string Edge-TTS expects (`+0%`, `-50%`,
 * `+100%`, etc.). Empty values fall back to plugin defaults.
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
  enabled: boolean
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
    // Ordered list of configured cloud provider ids. The first entry is
    // primary, the second is fallback. Only ids whose providers have a
    // saved key appear here. Optional so legacy configs migrate cleanly —
    // when absent the cascade falls back to the order in `providers`.
    cloudPriority?: CloudProviderConfig['id'][]
    // When true, the cascade falls back to the local Ollama model after
    // all cloud providers exhaust their retries. Off by default — small
    // local models can't reliably handle agentic tool-use turns, so we'd
    // rather surface the failure to the user than silently degrade.
    allowLocalFallback?: boolean
    // When true, the cascade skips cloud providers entirely and uses
    // only the local model. Toggle from the chat input's mode switch.
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
  lastSettingsState?: {
    tab?: string
    provider?: string
    channel?: string
    service?: string
    hippocampusTab?: string
  }
  disabledCapabilities?: string[]
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

export function lockfilePath(): string {
  return path.join(WORKSPACE_ROOT, LOCK_FILENAME)
}

export function defaultsWorkspacePath(): string {
  if (is.dev) {
    return path.join(app.getAppPath(), 'src', 'defaults', 'workspace')
  }
  return path.join(process.resourcesPath, 'defaults', 'workspace')
}

export async function readConfig(): Promise<WorkspaceConfig | null> {
  try {
    const raw = await fs.readFile(configPath(), 'utf8')
    return JSON.parse(raw) as WorkspaceConfig
  } catch {
    return null
  }
}

export async function writeConfig(config: WorkspaceConfig): Promise<void> {
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8')
}

export async function patchConfig(
  patch: (current: WorkspaceConfig) => WorkspaceConfig
): Promise<WorkspaceConfig> {
  const current = (await readConfig()) ?? defaultConfig()
  const next = patch(current)
  await writeConfig(next)
  return next
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
      allowLocalFallback: false,
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
  await migrateAgentsCore()

  // Always sync bundled capabilities — new ones get added and existing
  // ones get refreshed on every launch, so plugin bug fixes shipped by an
  // app upgrade actually reach existing workspaces. Files the user added
  // alongside a bundled plugin (e.g. node_modules from `npm install`,
  // ad-hoc notes) are preserved because we copy with force-overwrite, not
  // a wipe-and-replace.
  await ensureBundledCapabilities()
  await migrateOfficialCapabilities()

  // cortex.db is derived from markdown — safe to nuke on every launch so
  // the index reflects any files changed by migration above.
  await nukeCortexDb()

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
      filter: (src) => !src.endsWith('.DS_Store')
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

async function migrateAgentsCore(): Promise<void> {
  const bundled = path.join(defaultsWorkspacePath(), 'brain', 'prefrontal', 'agents.core.md')
  if (!existsSync(bundled)) return
  const target = path.join(WORKSPACE_ROOT, 'brain', 'prefrontal', 'agents.core.md')
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(bundled, target)
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

async function nukeCortexDb(): Promise<void> {
  const dbPath = path.join(WORKSPACE_ROOT, 'brain', 'cortex.db')
  try {
    await fs.unlink(dbPath)
  } catch {
    // doesn't exist or already deleted
  }
  // Also clean up WAL/SHM files SQLite may have left behind
  for (const suffix of ['-wal', '-shm']) {
    try {
      await fs.unlink(dbPath + suffix)
    } catch {
      // ignore
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
      await fs.writeFile(filepath, `${header}\n`, 'utf8')
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
    return {
      ...c,
      llm: {
        ...c.llm,
        providers: nextProviders,
        cloudPriority: reconcileCloudPriority(c.llm.cloudPriority, nextProviders)
      }
    }
  })
}

export async function removeCloudProvider(id: CloudProviderConfig['id']): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const nextProviders = c.llm.providers.filter((p) => p.id !== id)
    return {
      ...c,
      llm: {
        ...c.llm,
        providers: nextProviders,
        cloudPriority: reconcileCloudPriority(c.llm.cloudPriority, nextProviders)
      }
    }
  })
}

export async function setCloudPriority(
  order: CloudProviderConfig['id'][]
): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({
    ...c,
    llm: { ...c.llm, cloudPriority: reconcileCloudPriority(order, c.llm.providers) }
  }))
}

// Drop ids whose provider was removed and append any newly-configured
// providers to the tail. Keeps cloudPriority a faithful, deduped subset
// of the configured providers so the cascade can iterate it directly.
function reconcileCloudPriority(
  prior: CloudProviderConfig['id'][] | undefined,
  providers: CloudProviderConfig[]
): CloudProviderConfig['id'][] {
  const valid = new Set(providers.map((p) => p.id))
  const seen = new Set<CloudProviderConfig['id']>()
  const out: CloudProviderConfig['id'][] = []
  for (const id of prior ?? []) {
    if (!valid.has(id) || seen.has(id)) continue
    out.push(id)
    seen.add(id)
  }
  for (const p of providers) {
    if (seen.has(p.id)) continue
    out.push(p.id)
    seen.add(p.id)
  }
  return out
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

export async function setAllowLocalFallback(value: boolean): Promise<WorkspaceConfig> {
  return patchConfig((c) => ({
    ...c,
    llm: { ...c.llm, allowLocalFallback: value }
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
  staleHours: 3
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
      staleHours: patch.staleHours ?? current.staleHours
    }
    return { ...c, telegram: next }
  })
}

const EMPTY_WHATSAPP_CONFIG: WhatsAppConfig = {
  enabled: false,
  allowedPhoneNumbers: []
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
      allowedPhoneNumbers: patch.allowedPhoneNumbers ?? current.allowedPhoneNumbers
    }
    return { ...c, whatsapp: next }
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

const EMPTY_NOTION_CONFIG: NotionConfig = { token: '' }

export async function getNotionConfig(): Promise<NotionConfig> {
  const config = await readConfig()
  return config?.notion ?? EMPTY_NOTION_CONFIG
}

export async function setNotionConfig(patch: Partial<NotionConfig>): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const current = c.notion ?? EMPTY_NOTION_CONFIG
    const next: NotionConfig = {
      token: patch.token ?? current.token
    }
    return { ...c, notion: next }
  })
}

const EMPTY_GITHUB_CONFIG: GitHubConfig = { token: '', login: '', name: '' }

export async function getGitHubConfig(): Promise<GitHubConfig> {
  const config = await readConfig()
  const stored = config?.github
  if (!stored) return EMPTY_GITHUB_CONFIG
  // Backfill login/name for legacy configs that pre-date account snapshot.
  return {
    token: stored.token ?? '',
    login: stored.login ?? '',
    name: stored.name ?? ''
  }
}

export async function setGitHubConfig(patch: Partial<GitHubConfig>): Promise<WorkspaceConfig> {
  return patchConfig((c) => {
    const current = c.github ?? EMPTY_GITHUB_CONFIG
    // Token rotation invalidates the cached identity — a fresh token may
    // belong to a different account, so don't keep the old login/name
    // unless the patch explicitly supplies them.
    const tokenChanged = patch.token !== undefined && patch.token !== current.token
    const next: GitHubConfig = {
      token: patch.token ?? current.token,
      login: patch.login ?? (tokenChanged ? '' : current.login),
      name: patch.name ?? (tokenChanged ? '' : current.name)
    }
    return { ...c, github: next }
  })
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
  enabled: true,
  screenshotMaxWidth: 1280,
  screenshotFormat: 'jpeg'
}

export async function getComputerUseConfig(): Promise<ComputerUseConfig> {
  const config = await readConfig()
  const stored = config?.computerUse
  if (!stored) return DEFAULT_COMPUTER_USE_CONFIG
  return {
    enabled: stored.enabled ?? true,
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
      enabled: patch.enabled ?? current.enabled,
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
