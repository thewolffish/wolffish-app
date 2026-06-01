process.noDeprecation = true

import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { braveService, type BraveStatus, type BraveTestResult } from '@main/brave'
import { turnRouter } from '@main/channels/channel'
import { ElectronChannel } from '@main/channels/electron-channel'
import { TelegramChannel } from '@main/channels/telegram-channel'
import { TurnRunner } from '@main/channels/turn-runner'
import { WhatsAppChannel } from '@main/channels/whatsapp-channel'
import {
  countConversationsSince,
  createConversation,
  deleteConversation,
  generateTitle,
  listConversations,
  loadConversation,
  saveConversation,
  type ConversationFile,
  type ConversationMeta
} from '@main/conversations'
import { getDataAnalytics, type DataAnalytics } from '@main/data'
import { githubService, type GitHubStatus, type GitHubTestResult } from '@main/github'
import {
  googleService,
  type GoogleAuthResult,
  type GoogleBinaryStatus,
  type GoogleCredentialsResult,
  type GoogleSetupResult,
  type GoogleStatus,
  type GoogleUpdateResult
} from '@main/google'
import { acquireLock, releaseLockSync } from '@main/lockfile'
import { memesService, type MemesStatus, type MemesTestResult } from '@main/memes'
import { notionService, type NotionStatus, type NotionTestResult } from '@main/notion'
import {
  detect as detectOllama,
  isOllamaInstalled,
  listTags,
  platformInstallUrl,
  pullModel,
  startOllama,
  type OllamaPullStatus
} from '@main/ollama'
import { Agent } from '@main/runtime/agent'
import type { ApprovalDecision } from '@main/runtime/amygdala'
import { MODEL_CATALOG } from '@main/runtime/models'
import { localProvider } from '@main/runtime/providers/local'
import type { CloudProviderConfig } from '@main/runtime/thalamus'
import { Thalamus } from '@main/runtime/thalamus'
import type { TimeRange as UsageTimeRange } from '@main/runtime/usage'
import { detectSystem, type SystemInfo } from '@main/system'
import {
  checkForUpdatesIfEnabled,
  initUpdater,
  installUpdate,
  stampPreUpdateVersion
} from '@main/updater'
import {
  classifyFile,
  isSupportedExtension,
  readUpload,
  resolveUploadPath,
  saveUpload,
  saveUploadFromBuffer,
  statUpload,
  uploadExists,
  type UploadedFileMetadata
} from '@main/uploads/uploads'
import { categorizeFile, validateFile, type ValidationError } from '@main/uploads/validation'
import {
  hasBundledDefault,
  readBundledDefault,
  readViewerBinaryFile,
  readViewerFile,
  readViewerTree,
  statViewerFile,
  writeViewerFile,
  type ViewerTreeNode
} from '@main/viewer'
import { wlog } from '@main/workspace/logger'
import {
  bundledCapabilityNames,
  clearLocalModel,
  ensureWorkspace,
  factoryReset,
  getBraveConfig,
  getCompactionConfig,
  getComputerUseConfig,
  getGitHubConfig,
  getGoogleConfig,
  getMemesConfig,
  getNotionConfig,
  getStatus,
  getSttConfig,
  getTelegramConfig,
  getTtsConfig,
  getVariables,
  getWhatsAppConfig,
  lockfilePath,
  markOnboardingComplete,
  patchConfig,
  setAllowLocalFallback as persistAllowLocalFallback,
  setBlockCredentials as persistBlockCredentials,
  setBraveConfig as persistBraveConfig,
  setBypassPermissions as persistBypassPermissions,
  setCloudPriority as persistCloudPriority,
  setCompactionConfig as persistCompactionConfig,
  setComputerUseConfig as persistComputerUseConfig,
  setGitHubConfig as persistGitHubConfig,
  setGoogleConfig as persistGoogleConfig,
  setLaunchAtStartup as persistLaunchAtStartup,
  setLocale as persistLocale,
  setLocalOnly as persistLocalOnly,
  setMemesConfig as persistMemesConfig,
  setNotionConfig as persistNotionConfig,
  setRestrictPowerfulModels as persistRestrictPowerfulModels,
  setShowChatAnalytics as persistShowChatAnalytics,
  setSttConfig as persistSttConfig,
  setTelegramConfig as persistTelegramConfig,
  setTheme as persistTheme,
  setTtsConfig as persistTtsConfig,
  setVariables as persistVariables,
  setWeekStartsOn as persistWeekStartsOn,
  setWhatsAppConfig as persistWhatsAppConfig,
  readConfig,
  reconcileLocalModel,
  removeCloudProvider,
  selectLocalModel,
  setCloudProvider,
  workspaceRoot,
  type BraveConfig,
  type ComputerUseConfig,
  type GitHubConfig,
  type GoogleConfig,
  type MemesConfig,
  type NotionConfig,
  type SttConfig,
  type TelegramConfig,
  type TtsConfig,
  type Variable,
  type WeekStartsOn,
  type WhatsAppConfig,
  type WorkspaceStatus
} from '@main/workspace/workspace'
import dockIcon from '@resources/icons/icons/1024x1024.png?asset'
import icon from '@resources/icons/icons/512x512.png?asset'
import trayIconMac from '@resources/icons/icons/trayTemplate.png?asset'
import trayIconMac2x from '@resources/icons/icons/trayTemplate@2x.png?asset'
import trayIconDefault from '@resources/images/icon_transparent.png?asset'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  shell,
  systemPreferences,
  Tray
} from 'electron'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import { join } from 'node:path'

// Redirect Chromium/Electron-managed state into ~/.wolffish so a single
// `rm -rf ~/.wolffish` wipes every byte the app touches. Must run before
// app.whenReady() — Electron resolves these paths on first use.
const WOLFFISH_ROOT = join(os.homedir(), '.wolffish')
app.setPath('userData', join(WOLFFISH_ROOT, 'runtime'))
app.setAppLogsPath(join(WOLFFISH_ROOT, 'logs'))

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'wolffish-media',
    privileges: { bypassCSP: true, supportFetchAPI: true, stream: true }
  }
])

export type ThemeSource = 'system' | 'light' | 'dark'
export type Locale = 'en' | 'ar'

export type ProviderListEntry = {
  id: CloudProviderConfig['id']
  model: string
  apiKey: string
  models?: string[]
}

export type ProviderTestErrorKind =
  | 'invalid_key'
  | 'rate_limited'
  | 'invalid_model'
  | 'network'
  | 'generic'

export type ProviderTestResult =
  | { ok: true; models: string[] }
  | { ok: false; kind: ProviderTestErrorKind; message?: string }

function classifyHttpError(
  status: number,
  rawBody: string
): { kind: ProviderTestErrorKind; message?: string } {
  if (status === 401 || status === 403) return { kind: 'invalid_key' }
  if (status === 429) return { kind: 'rate_limited' }
  if (status === 404) return { kind: 'invalid_model' }
  let message = rawBody
  try {
    const parsed = JSON.parse(rawBody) as { error?: { message?: string } }
    if (parsed.error?.message) message = parsed.error.message
  } catch {
    /* keep raw body */
  }
  return { kind: 'generic', message: message || `HTTP ${status}` }
}

/**
 * Hit the provider's /v1/models endpoint. This doubles as auth validation —
 * if the key is bad we get a 401, no tokens spent. Returns chat-capable
 * models only, sorted newest first.
 */
async function fetchProviderModels(
  id: CloudProviderConfig['id'],
  apiKey: string
): Promise<ProviderTestResult> {
  try {
    if (id === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        }
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { ok: false, ...classifyHttpError(res.status, text) }
      }
      const body = (await res.json()) as {
        data?: Array<{ id: string; created_at?: string }>
      }
      const models = (body.data ?? [])
        .slice()
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        .map((m) => m.id)
      return { ok: true, models }
    }

    if (id === 'deepseek') {
      const res = await fetch('https://api.deepseek.com/models', {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` }
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { ok: false, ...classifyHttpError(res.status, text) }
      }
      const body = (await res.json()) as {
        data?: Array<{ id: string; created?: number }>
      }
      const models = (body.data ?? [])
        .filter((m) => isDeepSeekChatModel(m.id))
        .slice()
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
        .map((m) => m.id)
      return { ok: true, models }
    }

    if (id === 'mimo') {
      const res = await fetch('https://api.xiaomimimo.com/v1/models', {
        method: 'GET',
        headers: { 'api-key': apiKey }
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { ok: false, ...classifyHttpError(res.status, text) }
      }
      const body = (await res.json()) as {
        data?: Array<{ id: string; created?: number }>
      }
      const models = (body.data ?? [])
        .slice()
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
        .map((m) => m.id)
      return { ok: true, models }
    }

    const res = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` }
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, ...classifyHttpError(res.status, text) }
    }
    const body = (await res.json()) as {
      data?: Array<{ id: string; created?: number }>
    }
    const models = (body.data ?? [])
      .filter((m) => isOpenAIChatModel(m.id))
      .slice()
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
      .map((m) => m.id)
    return { ok: true, models }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, kind: 'network', message }
  }
}

// OpenAI's /v1/models returns embeddings, audio, image, moderation, etc.
// Filter to chat-completion-capable models — gpt-* and the o-series
// reasoning models. Exclude obvious non-chat variants (audio/realtime/tts).
function isOpenAIChatModel(id: string): boolean {
  if (id.startsWith('gpt-') || id.startsWith('chatgpt-')) {
    if (/-(audio|tts|whisper|search|realtime|transcribe)/.test(id)) return false
    return true
  }
  if (/^o\d/.test(id)) return true
  return false
}

function isDeepSeekChatModel(id: string): boolean {
  return id.startsWith('deepseek-')
}

/**
 * Refresh the cached model list for every saved provider, in the
 * background, on app startup. Failures (offline, expired key) are silent —
 * the user keeps whatever cache they had and can retest from settings.
 */
async function refreshAllProviderModels(): Promise<void> {
  const cfg = await readConfig()
  if (!cfg?.llm.providers?.length) return
  for (const p of cfg.llm.providers) {
    if (!p.apiKey) continue
    const result = await fetchProviderModels(p.id, p.apiKey)
    if (!result.ok) continue
    await setCloudProvider({ ...p, models: result.models })
    broadcast('provider:updated', { id: p.id })
  }
  // Re-seed the cascade so any new model selection downstream sees the
  // latest config (apiKey/model haven't changed but models did).
  const next = await readConfig()
  if (next?.llm.providers) {
    thalamus.setCloudProviders(next.llm.providers)
    thalamus.setCloudPriority(next.llm.cloudPriority ?? next.llm.providers.map((p) => p.id))
  }
}

export type ThemeState = {
  themeSource: ThemeSource
  shouldUseDarkColors: boolean
}

let activePull: AbortController | null = null
let activePullModel: string | null = null
let lockAcquired = false
let isShuttingDown = false

const thalamus = new Thalamus(localProvider)
const agent = new Agent({
  thalamus,
  workspaceRoot: workspaceRoot(),
  getActiveModel: () => localProvider.currentModel
})

// Channels are the user-facing surfaces wolffish speaks through. The
// Electron renderer is the original; Telegram is the second. They share
// one TurnRunner so cross-channel turns serialize on the agent's shared
// broca/amygdala state. Amygdala's approval bridge dispatches to
// whichever channel owns the active turn via the singleton turnRouter.
const turnRunner = new TurnRunner(agent)
const electronChannel = new ElectronChannel(agent, turnRunner)
const telegramChannel = new TelegramChannel(agent, turnRunner, localProvider)
const whatsappChannel = new WhatsAppChannel(agent, turnRunner, localProvider)

agent.amygdala.setApprovalBridge((req) => turnRouter.dispatchApproval(req))

function currentThemeState(): ThemeState {
  return {
    themeSource: nativeTheme.themeSource as ThemeSource,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors
  }
}

function backgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#0d1117' : '#f0f4f8'
}

let tray: Tray | null = null

function createTray(locale: Locale = 'en'): void {
  if (tray) return
  const isAr = locale === 'ar'
  let img: Electron.NativeImage
  if (process.platform === 'darwin') {
    const img1x = nativeImage.createFromPath(trayIconMac)
    const img2x = nativeImage.createFromPath(trayIconMac2x)
    img = nativeImage.createEmpty()
    img.addRepresentation({ scaleFactor: 1, width: 22, height: 22, buffer: img1x.toPNG() })
    img.addRepresentation({ scaleFactor: 2, width: 44, height: 44, buffer: img2x.toPNG() })
    img.setTemplateImage(true)
  } else {
    img = nativeImage.createFromPath(trayIconDefault).resize({ width: 18, height: 18 })
  }
  tray = new Tray(img)
  tray.setToolTip('Wolffish')
  const contextMenu = Menu.buildFromTemplate([
    {
      label: isAr ? 'إظهار وولف فيش' : 'Show Wolffish',
      click: () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
          win.show()
          showDock()
        } else {
          createWindow()
          showDock()
        }
      }
    },
    { type: 'separator' },
    {
      label: isAr ? 'إغلاق' : 'Quit',
      click: () => {
        isQuittingFromTray = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(contextMenu)

  // On macOS, setContextMenu handles both left and right click — no extra
  // handler needed. On Windows/Linux, right-click opens the menu but
  // left-click fires 'click' — wire it up so a single click restores the
  // window (standard tray behavior on those platforms).
  const restoreWindow = (): void => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.show()
      showDock()
    } else {
      createWindow()
      showDock()
    }
  }
  if (process.platform !== 'darwin') {
    tray.on('click', restoreWindow)
  }
  tray.on('double-click', restoreWindow)
}

function showDock(): void {
  if (process.platform !== 'darwin') return
  void app.dock?.show().then(() => {
    if (is.dev) app.dock?.setIcon(dockIcon)
  })
}

let isQuittingFromTray = false

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1280,
    minHeight: 860,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: backgroundColor(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      plugins: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.on('show', () => {
    mainWindow.webContents.executeJavaScript('document.activeElement?.blur()').catch(() => {})
  })

  mainWindow.on('close', (event) => {
    if (isQuittingFromTray || isShuttingDown) {
      if (quitInProgress) {
        event.preventDefault()
        return
      }
      if (hasInflightWork()) {
        event.preventDefault()
        quitInProgress = true
        broadcast('app:closingPending', { tasks: pendingBackgroundTasks })
        void drainAndQuit()
      }
      return
    }
    event.preventDefault()
    mainWindow.hide()
    if (process.platform === 'darwin') app.dock?.hide()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function broadcastThemeUpdate(): void {
  const state = currentThemeState()
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('theme:updated', state)
  }
}

function broadcast<T>(channel: string, payload: T): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload)
  }
}

async function shutdownGracefully(): Promise<void> {
  if (isShuttingDown) return
  isShuttingDown = true

  if (activePull) activePull.abort()
  electronChannel.abort()
  telegramChannel.abort()
  whatsappChannel.abort()
  await telegramChannel.stop('app shutdown').catch(() => undefined)
  await whatsappChannel.stop('app shutdown').catch(() => undefined)
  await agent.stop().catch(() => undefined)
}

// Counts async work (title generation, save) that fired after a turn
// finished. The renderer treats these as fire-and-forget, so without
// tracking them here a Cmd+Q or window-X mid-flight would tear the
// process down before the file hit disk and the conversation would be
// lost. before-quit waits on this counter to drain before exiting.
let pendingBackgroundTasks = 0
let pendingDrainResolvers: Array<() => void> = []
// Held high from the moment the user requests quit until the drain
// finishes. While it's true, every quit/close attempt is blocked —
// otherwise a spammed Cmd+Q would let the second event slip past the
// in-progress drain and kill the process anyway.
let quitInProgress = false

async function trackBackgroundTask<T>(work: () => Promise<T>): Promise<T> {
  pendingBackgroundTasks += 1
  try {
    return await work()
  } finally {
    pendingBackgroundTasks -= 1
    if (pendingBackgroundTasks === 0) {
      const resolvers = pendingDrainResolvers
      pendingDrainResolvers = []
      for (const r of resolvers) r()
    }
  }
}

function waitForBackgroundDrain(): Promise<void> {
  if (pendingBackgroundTasks === 0) return Promise.resolve()
  return new Promise((resolve) => pendingDrainResolvers.push(resolve))
}

function hasInflightWork(): boolean {
  return (
    !!activePull ||
    electronChannel.hasActiveTurn() ||
    telegramChannel.hasActiveTurn() ||
    whatsappChannel.hasActiveTurn() ||
    pendingBackgroundTasks > 0
  )
}

async function drainAndQuit(): Promise<void> {
  await shutdownGracefully()
  await waitForBackgroundDrain()
  // Drop the gate so our own app.quit() below isn't blocked. The
  // recursive before-quit will see quitInProgress=false and
  // hasInflightWork=false and let the default action through, which
  // lets will-quit fire and release the workspace lockfile.
  quitInProgress = false
  app.quit()
}

/**
 * macOS and Linux GUI apps inherit launchd/XDG environment, which
 * typically lacks user-specific PATH entries (Homebrew, nvm, cargo,
 * pyenv, etc.). Spawn the user's login shell once to capture their
 * real PATH and merge it into process.env so every child_process.spawn
 * downstream (shell plugin, npm install, dependency checks) sees the
 * same binaries the user's terminal would. Windows resolves PATH from
 * the registry at process start, so no fixup is needed there.
 */
function resolveShellPath(): void {
  if (process.platform === 'win32') return
  const userShell = process.env.SHELL || '/bin/sh'
  try {
    const raw = execFileSync(userShell, ['-ilc', 'printf "__WFPATH__%s__WFPATH__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const resolved = raw.match(/__WFPATH__(.+?)__WFPATH__/)?.[1]
    if (resolved && resolved.includes(':')) process.env.PATH = resolved
  } catch {
    // best-effort — keep the existing PATH if the shell fails
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.wolffish.app')

  if (is.dev && process.platform === 'darwin') {
    app.dock?.setIcon(dockIcon)
  }

  resolveShellPath()
  await ensureWorkspace()
  await reconcileLocalModel()
  initUpdater()
  agent.init().catch((err) => {
    console.error('agent.init failed:', err)
  })

  // Workspace config is the single source of truth for persisted preferences.
  // Read it once at startup to apply the theme and restore the selected model.
  const cfg = await readConfig()
  nativeTheme.themeSource = cfg?.theme ?? 'system'
  if (cfg?.llm.local.model) {
    localProvider.configure(cfg.llm.local.model, cfg.llm.local.endpoint)
  }
  if (cfg?.llm.providers) {
    thalamus.setCloudProviders(cfg.llm.providers)
    thalamus.setCloudPriority(cfg.llm.cloudPriority ?? cfg.llm.providers.map((p) => p.id))
    // Fire-and-forget refresh of each provider's model catalogue. Cheap
    // (a single GET per provider) and doesn't block window creation.
    void refreshAllProviderModels()
  }

  // Fire-and-forget update check. Respects the updates.enabled config flag.
  void checkForUpdatesIfEnabled()
  thalamus.setAllowLocalFallback(cfg?.llm.allowLocalFallback ?? false)
  thalamus.setLocalOnly(cfg?.llm.localOnly ?? false)
  agent.amygdala.setBypassPermissions(cfg?.safety?.bypassPermissions ?? false)
  turnRunner.setBlockCredentials(cfg?.safety?.blockCredentials ?? false)
  turnRunner.setLocale(cfg?.locale ?? 'en')
  agent.cerebellum.setDisabled(cfg?.disabledCapabilities ?? [])

  // Compaction schedule from config. Brainstem.init() will call
  // startCompactionScheduler() using whatever config is set here.
  if (cfg?.compaction) {
    agent.brainstem.setCompactionConfig(cfg.compaction)
  }

  // Auto-launch: if the user has opted in (default true), register
  // Wolffish as a login item so the OS starts it on boot/login.
  // Uses Electron's built-in app.setLoginItemSettings which handles
  // macOS (SMAppService / Launch Services), Windows (registry), and
  // Linux (XDG autostart .desktop file).
  // Skip in dev mode — registering the dev binary as a login item
  // causes the Electron debug menu to appear on restart instead of
  // the production app.
  if (!is.dev && cfg?.launchAtStartup !== false) {
    app.setLoginItemSettings({ openAtLogin: true })
  }

  if (cfg?.telegram?.enabled) {
    void telegramChannel
      .start(cfg.telegram)
      .catch((err) => console.error('telegram start failed:', err))
  }

  if (cfg?.whatsapp?.enabled) {
    void whatsappChannel
      .start(cfg.whatsapp)
      .catch((err) => console.error('whatsapp start failed:', err))
  }

  const lock = await acquireLock(lockfilePath())
  if (!lock.acquired) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Wolffish',
      message: 'Wolffish is already running.',
      detail: `Another instance (pid ${lock.runningPid}) is using ~/.wolffish.`,
      buttons: ['OK'],
      defaultId: 0
    })
    app.exit(0)
    return
  }
  lockAcquired = true

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Theme
  ipcMain.handle('theme:get', () => currentThemeState())
  ipcMain.handle('theme:set', async (_e, source: ThemeSource) => {
    nativeTheme.themeSource = source
    await persistTheme(source)
    return currentThemeState()
  })

  // Locale
  ipcMain.handle('locale:get', async (): Promise<Locale> => {
    const config = await readConfig()
    return config?.locale ?? 'en'
  })
  ipcMain.handle('locale:set', async (_e, locale: Locale) => {
    await persistLocale(locale)
    turnRunner.setLocale(locale)
    return locale
  })

  // Runtime — Wolffish-specific toggles. Persist to config.json and
  // mirror into the live amygdala / thalamus instances so the change
  // takes effect on the next turn without a restart.
  ipcMain.handle('runtime:setBypassPermissions', async (_e, value: boolean) => {
    await persistBypassPermissions(value)
    agent.amygdala.setBypassPermissions(value)
    return { value }
  })
  ipcMain.handle('runtime:setBlockCredentials', async (_e, value: boolean) => {
    await persistBlockCredentials(value)
    turnRunner.setBlockCredentials(value)
    return { value }
  })
  ipcMain.handle('runtime:setAllowLocalFallback', async (_e, value: boolean) => {
    await persistAllowLocalFallback(value)
    thalamus.setAllowLocalFallback(value)
    return { value }
  })
  ipcMain.handle('runtime:setShowChatAnalytics', async (_e, value: boolean) => {
    await persistShowChatAnalytics(value)
    return { value }
  })
  ipcMain.handle('runtime:setLocalOnly', async (_e, value: boolean) => {
    await persistLocalOnly(value)
    thalamus.setLocalOnly(value)
    return { value }
  })
  ipcMain.handle('runtime:setRestrictPowerfulModels', async (_e, value: boolean) => {
    await persistRestrictPowerfulModels(value)
    return { value }
  })

  ipcMain.handle('runtime:setLaunchAtStartup', async (_e, value: boolean) => {
    app.setLoginItemSettings({ openAtLogin: value })
    await persistLaunchAtStartup(value)
    const { openAtLogin } = app.getLoginItemSettings()
    return { value, active: openAtLogin }
  })

  ipcMain.handle('runtime:getLaunchAtStartupStatus', () => {
    const { openAtLogin } = app.getLoginItemSettings()
    return { active: openAtLogin }
  })

  ipcMain.handle('variables:list', async (): Promise<Variable[]> => {
    return getVariables()
  })
  ipcMain.handle('variables:save', async (_e, variables: Variable[]): Promise<{ ok: true }> => {
    await persistVariables(variables)
    return { ok: true }
  })

  // Telegram channel — read config, save partial updates, run lifecycle
  // hooks, ship a one-off test message. The lifecycle hooks live here
  // (not inside the channel) so the IPC handler can return the new
  // status synchronously — a UI that flips the toggle wants the chip
  // to update without polling.
  ipcMain.handle('telegram:getConfig', (): Promise<TelegramConfig> => getTelegramConfig())

  ipcMain.handle(
    'telegram:setConfig',
    async (
      _e,
      patch: Partial<TelegramConfig>
    ): Promise<{
      ok: true
      status: ReturnType<TelegramChannel['getStatus']>
      config: TelegramConfig
    }> => {
      const updated = await persistTelegramConfig(patch)
      const next = updated.telegram ?? {
        enabled: false,
        botToken: '',
        allowedUserIds: []
      }
      if (next.enabled) {
        // Re-running start with a different token must restart the
        // long-poll loop, otherwise the old bot keeps replying.
        await telegramChannel.restart(next).catch(() => undefined)
      } else {
        await telegramChannel.stop('config disabled').catch(() => undefined)
      }
      return { ok: true as const, status: telegramChannel.getStatus(), config: next }
    }
  )

  ipcMain.handle(
    'telegram:status',
    (): ReturnType<TelegramChannel['getStatus']> => telegramChannel.getStatus()
  )

  ipcMain.handle(
    'telegram:sendTestMessage',
    (_e, payload: { token: string; userId: number }): Promise<{ ok: boolean; error?: string }> =>
      telegramChannel.sendTestMessage(payload.token, payload.userId)
  )

  // WhatsApp channel — Baileys-based WhatsApp Web client. Persistent
  // WebSocket that registers/unregisters tools with the cerebellum as
  // the connection comes up and goes down.
  ipcMain.handle('whatsapp:getConfig', (): Promise<WhatsAppConfig> => getWhatsAppConfig())

  ipcMain.handle(
    'whatsapp:setConfig',
    async (
      _e,
      patch: Partial<WhatsAppConfig>
    ): Promise<{
      ok: true
      status: ReturnType<WhatsAppChannel['getStatus']>
      config: WhatsAppConfig
    }> => {
      const previous = await getWhatsAppConfig()
      const updated = await persistWhatsAppConfig(patch)
      const next = updated.whatsapp ?? { enabled: false, allowedPhoneNumbers: [] }
      whatsappChannel.updateAllowedPhoneNumbers(next.allowedPhoneNumbers ?? [])
      if (previous.enabled !== next.enabled) {
        if (next.enabled) {
          if (whatsappChannel.isStarted()) {
            whatsappChannel.setProcessingEnabled(true)
          } else {
            await whatsappChannel.start(next).catch(() => undefined)
          }
        } else {
          whatsappChannel.setProcessingEnabled(false)
        }
      }
      const status = whatsappChannel.getStatus()
      // Push status update to renderer
      BrowserWindow.getAllWindows().forEach((w) =>
        w.webContents.send('whatsapp:statusChange', status)
      )
      return { ok: true as const, status, config: next }
    }
  )

  ipcMain.handle(
    'whatsapp:status',
    (): ReturnType<WhatsAppChannel['getStatus']> => whatsappChannel.getStatus()
  )

  ipcMain.handle('whatsapp:logout', async (): Promise<void> => {
    await whatsappChannel.logout()
    await persistWhatsAppConfig({ enabled: false })
    BrowserWindow.getAllWindows().forEach((w) =>
      w.webContents.send('whatsapp:statusChange', whatsappChannel.getStatus())
    )
  })

  ipcMain.handle('whatsapp:requestQr', (): void => {
    whatsappChannel.requestQr()
    BrowserWindow.getAllWindows().forEach((w) =>
      w.webContents.send('whatsapp:statusChange', whatsappChannel.getStatus())
    )
  })

  // Push QR codes and status changes to the renderer as they happen
  agent.corpus.on('whatsapp.qr', ({ qr }) => {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('whatsapp:qr', qr))
  })
  agent.corpus.on('whatsapp.started', () => {
    BrowserWindow.getAllWindows().forEach((w) =>
      w.webContents.send('whatsapp:statusChange', whatsappChannel.getStatus())
    )
  })
  agent.corpus.on('whatsapp.stopped', () => {
    BrowserWindow.getAllWindows().forEach((w) =>
      w.webContents.send('whatsapp:statusChange', whatsappChannel.getStatus())
    )
  })
  agent.corpus.on('whatsapp.error', () => {
    BrowserWindow.getAllWindows().forEach((w) =>
      w.webContents.send('whatsapp:statusChange', whatsappChannel.getStatus())
    )
  })
  agent.corpus.on('whatsapp.statusChanged', () => {
    BrowserWindow.getAllWindows().forEach((w) =>
      w.webContents.send('whatsapp:statusChange', whatsappChannel.getStatus())
    )
  })

  // Brave Search — stateless service. The web-search cerebellum plugin
  // reads the persisted config and uses Brave as the primary provider
  // when enabled. No long-poll, no in-process server: just a key + flag.
  ipcMain.handle('brave:getConfig', (): Promise<BraveConfig> => getBraveConfig())

  ipcMain.handle(
    'brave:setConfig',
    async (
      _e,
      patch: Partial<BraveConfig>
    ): Promise<{ ok: true; status: BraveStatus; config: BraveConfig }> => {
      const updated = await persistBraveConfig(patch)
      const next = updated.brave ?? { enabled: false, apiKey: '' }
      // Reset cached error so the next status read reflects the new key.
      braveService.resetCache()
      return { ok: true as const, status: await braveService.getStatus(), config: next }
    }
  )

  ipcMain.handle('brave:status', (): Promise<BraveStatus> => braveService.getStatus())

  ipcMain.handle(
    'brave:test',
    (_e, apiKey: string): Promise<BraveTestResult> => braveService.testKey(apiKey)
  )

  // Notion — stateless service. The notion cerebellum plugin reads the
  // persisted config and uses the integration token for API calls. No
  // long-poll, no in-process server: just a token.
  ipcMain.handle('notion:getConfig', (): Promise<NotionConfig> => getNotionConfig())

  ipcMain.handle(
    'notion:setConfig',
    async (
      _e,
      patch: Partial<NotionConfig>
    ): Promise<{ ok: true; status: NotionStatus; config: NotionConfig }> => {
      const updated = await persistNotionConfig(patch)
      const next = updated.notion ?? { token: '' }
      notionService.resetCache()
      return { ok: true as const, status: await notionService.getStatus(), config: next }
    }
  )

  ipcMain.handle('notion:status', (): Promise<NotionStatus> => notionService.getStatus())

  ipcMain.handle(
    'notion:test',
    (_e, token: string): Promise<NotionTestResult> => notionService.testToken(token)
  )

  // GitHub — stateless service. The github cerebellum plugin reads the
  // persisted config and uses the PAT for API calls. No daemon, no
  // in-process server: just a token.
  ipcMain.handle('github:getConfig', (): Promise<GitHubConfig> => getGitHubConfig())

  ipcMain.handle(
    'github:setConfig',
    async (
      _e,
      patch: Partial<GitHubConfig>
    ): Promise<{ ok: true; status: GitHubStatus; config: GitHubConfig }> => {
      const updated = await persistGitHubConfig(patch)
      const next = updated.github ?? { token: '', login: '', name: '' }
      githubService.resetCache()
      return { ok: true as const, status: await githubService.getStatus(), config: next }
    }
  )

  ipcMain.handle('github:status', (): Promise<GitHubStatus> => githubService.getStatus())

  ipcMain.handle(
    'github:test',
    (_e, token: string): Promise<GitHubTestResult> => githubService.testToken(token)
  )

  // Memes — stateless service. The memes cerebellum plugin reads
  // config.json directly on every tool call. This module provides test
  // helpers and a status view for the settings panel.
  ipcMain.handle('memes:getConfig', (): Promise<MemesConfig> => getMemesConfig())

  ipcMain.handle(
    'memes:setConfig',
    async (
      _e,
      patch: Partial<MemesConfig>
    ): Promise<{ ok: true; status: MemesStatus; config: MemesConfig }> => {
      const updated = await persistMemesConfig(patch)
      const next = updated.memes ?? {
        imgflip: { username: '', password: '' },
        giphy: { apiKey: '' }
      }
      memesService.resetCache()
      return { ok: true as const, status: await memesService.getStatus(), config: next }
    }
  )

  ipcMain.handle('memes:status', (): Promise<MemesStatus> => memesService.getStatus())

  ipcMain.handle(
    'memes:testGiphy',
    (_e, apiKey: string): Promise<MemesTestResult> => memesService.testGiphy(apiKey)
  )

  ipcMain.handle(
    'memes:testImgflip',
    (_e, payload: { username: string; password: string }): Promise<MemesTestResult> =>
      memesService.testImgflip(payload.username, payload.password)
  )

  // Computer Use — desktop automation. Plugin reads config.json directly;
  // these handlers let the settings panel read/write the config.
  ipcMain.handle('computerUse:getConfig', (): Promise<ComputerUseConfig> => getComputerUseConfig())

  ipcMain.handle(
    'computerUse:setConfig',
    async (
      _e,
      patch: Partial<ComputerUseConfig>
    ): Promise<{ ok: true; config: ComputerUseConfig }> => {
      const updated = await persistComputerUseConfig(patch)
      const next = updated.computerUse ?? {
        enabled: true,
        screenshotMaxWidth: 1280,
        screenshotFormat: 'jpeg' as const
      }
      return { ok: true as const, config: next }
    }
  )

  ipcMain.handle(
    'computerUse:checkPermissions',
    (): {
      platform: string
      hint: string | null
      accessibility: boolean
      screenRecording: boolean
    } => {
      const platform = process.platform

      if (platform === 'darwin') {
        const accessibility = systemPreferences.isTrustedAccessibilityClient(true)
        const screenStatus = systemPreferences.getMediaAccessStatus('screen')
        const screenRecording = screenStatus === 'granted'

        const missing: string[] = []
        if (!accessibility) missing.push('Accessibility')
        if (!screenRecording) missing.push('Screen Recording')

        return {
          platform,
          accessibility,
          screenRecording,
          hint:
            missing.length > 0
              ? `Grant ${missing.join(' and ')} in System Settings → Privacy & Security, then restart Wolffish.`
              : null
        }
      }

      if (platform === 'linux') {
        return {
          platform,
          accessibility: true,
          screenRecording: true,
          hint: 'Linux requires X11. Wayland is not supported by the automation library.'
        }
      }

      return { platform, accessibility: true, screenRecording: true, hint: null }
    }
  )

  // Google Workspace (gogcli) — credential storage and OAuth are
  // delegated to the gog binary. We only persist safe public metadata
  // (client_id, project_id, account email) in config.json.
  ipcMain.handle('google:getConfig', (): Promise<GoogleConfig> => getGoogleConfig())

  ipcMain.handle(
    'google:setConfig',
    async (
      _e,
      patch: Partial<GoogleConfig>
    ): Promise<{ ok: true; status: GoogleStatus; config: GoogleConfig }> => {
      const updated = await persistGoogleConfig(patch)
      const next = updated.google ?? {
        status: 'inactive' as const,
        account: '',
        clientId: '',
        projectId: '',
        credentialsStored: false
      }
      googleService.resetCache()
      return { ok: true as const, status: await googleService.getStatus(), config: next }
    }
  )

  ipcMain.handle('google:status', (): Promise<GoogleStatus> => googleService.getStatus())

  ipcMain.handle(
    'google:checkBinary',
    (): Promise<GoogleBinaryStatus> => googleService.checkBinary()
  )

  ipcMain.handle(
    'google:setup',
    async (event): Promise<GoogleSetupResult> =>
      googleService.setup((percent) => {
        event.sender.send('google:setupProgress', { percent })
      })
  )

  ipcMain.handle(
    'google:update',
    async (event): Promise<GoogleUpdateResult> =>
      googleService.update((percent) => {
        event.sender.send('google:setupProgress', { percent })
      })
  )

  ipcMain.handle(
    'google:uploadCredentials',
    async (_e, jsonContent: string): Promise<GoogleCredentialsResult> => {
      const result = await googleService.uploadCredentials(jsonContent)
      if (result.ok) {
        await persistGoogleConfig({
          clientId: result.clientId,
          projectId: result.projectId,
          credentialsStored: true
        })
      }
      return result
    }
  )

  ipcMain.handle('google:authAdd', async (event, email: string): Promise<GoogleAuthResult> => {
    // Capture the auth list before the OAuth flow so we can detect which
    // email gogcli actually stored — Google's OAuth returns the user's
    // real email, which often differs from whatever the user typed.
    const before = await googleService.listAccounts()
    const result = await googleService.authAdd(email, (url) => {
      event.sender.send('google:authUrl', { url })
    })
    if (result.ok) {
      const after = await googleService.listAccounts()
      const newlyAdded = after.find((a) => !before.includes(a))
      const actual = newlyAdded ?? (after.includes(email) ? email : (after[0] ?? email))
      await persistGoogleConfig({ status: 'active' })
      return { ok: true as const, account: actual }
    }
    return result
  })

  ipcMain.handle('google:listAccounts', (): Promise<string[]> => googleService.listAccounts())

  ipcMain.handle('google:cancelAuth', (): boolean => googleService.cancelAuth())

  ipcMain.handle(
    'google:deleteCredentials',
    async (): Promise<{ ok: true } | { ok: false; message: string }> => {
      const result = await googleService.deleteCredentials()
      if (result.ok) {
        await persistGoogleConfig({
          status: 'inactive',
          clientId: '',
          projectId: '',
          credentialsStored: false
        })
        googleService.resetCache()
      }
      return result
    }
  )

  ipcMain.handle(
    'google:removeAccount',
    async (
      _e,
      email: string
    ): Promise<{ ok: true; accounts: string[] } | { ok: false; message: string }> => {
      const result = await googleService.removeAccount(email)
      if (!result.ok) return result
      const remaining = await googleService.listAccounts()
      // Status follows whether any account is still authorized — there is
      // no "primary" to promote anymore. The cerebellum plugin requires
      // an explicit `account` parameter on every call.
      await persistGoogleConfig({
        status: remaining.length > 0 ? 'active' : 'inactive'
      })
      googleService.resetCache()
      return { ok: true as const, accounts: remaining }
    }
  )

  // STT/TTS — persisted defaults the cerebellum plugins read on every
  // tool call, so users' panel choices override the plugin's
  // hard-coded fallbacks without restarting anything. Both stay
  // optional in config.json: an empty string means "use the plugin's
  // own default," which is what every existing config will have until
  // the user touches the panel.
  ipcMain.handle('mic:checkAccess', (): 'granted' | 'denied' | 'not-determined' | 'restricted' => {
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const status = systemPreferences.getMediaAccessStatus('microphone')
      return status === 'unknown' ? 'granted' : status
    }
    return 'granted'
  })

  ipcMain.handle('mic:requestAccess', async (): Promise<boolean> => {
    if (process.platform === 'darwin') {
      return systemPreferences.askForMediaAccess('microphone')
    }
    return true
  })

  ipcMain.handle('stt:getConfig', (): Promise<SttConfig> => getSttConfig())
  ipcMain.handle(
    'stt:setConfig',
    async (_e, patch: Partial<SttConfig>): Promise<{ ok: true; config: SttConfig }> => {
      const updated = await persistSttConfig(patch)
      return { ok: true as const, config: updated.stt ?? { defaultModel: '' } }
    }
  )
  ipcMain.handle(
    'stt:transcribe',
    async (
      _e,
      payload: { filePath: string; conversationId?: string }
    ): Promise<{ ok: true; transcript: string } | { ok: false; error: string }> => {
      try {
        if (payload.conversationId) {
          agent.cerebellum.setCurrentConversationId(payload.conversationId)
        }
        const result = await agent.cerebellum.executeTool('stt_transcribe', {
          filePath: payload.filePath
        })
        if (payload.conversationId) {
          agent.cerebellum.setCurrentConversationId(null)
        }
        if (!result.success) {
          return { ok: false, error: result.error ?? 'Transcription failed' }
        }
        const raw = result.output ?? ''
        const match =
          raw.match(/"transcript"\s*:\s*"([^"]*)"/) ?? raw.match(/"text"\s*:\s*"([^"]*)"/)
        const transcript = match ? match[1] : raw.replace(/[{}"\n]/g, '').trim()
        if (!transcript) {
          return { ok: false, error: 'Transcription returned empty' }
        }
        return { ok: true, transcript }
      } catch (err) {
        if (payload.conversationId) {
          agent.cerebellum.setCurrentConversationId(null)
        }
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('tts:getConfig', (): Promise<TtsConfig> => getTtsConfig())
  ipcMain.handle(
    'tts:setConfig',
    async (_e, patch: Partial<TtsConfig>): Promise<{ ok: true; config: TtsConfig }> => {
      const updated = await persistTtsConfig(patch)
      return {
        ok: true as const,
        config: updated.tts ?? { defaultVoice: '', defaultSpeed: '' }
      }
    }
  )

  nativeTheme.on('updated', () => broadcastThemeUpdate())

  // System
  ipcMain.handle('system:getInfo', (): Promise<SystemInfo> => detectSystem())

  // Workspace
  ipcMain.handle('workspace:getStatus', (): Promise<WorkspaceStatus> => getStatus())
  ipcMain.handle('workspace:completeOnboarding', () => markOnboardingComplete())

  // Wipe all data on disk but preserve API keys, model selection, locale,
  // theme, and runtime toggles. The relaunch ensures no stale handles
  // (cortex.db, brainstem watcher, corpus flush timer) survive the wipe.
  ipcMain.handle('app:factoryReset', async () => {
    activePull?.abort()
    electronChannel.abort()
    telegramChannel.abort()
    whatsappChannel.abort()
    await telegramChannel.stop('factory reset').catch(() => undefined)
    await whatsappChannel.stop('factory reset').catch(() => undefined)
    await agent.stop().catch(() => undefined)
    if (lockAcquired) {
      releaseLockSync(lockfilePath())
      lockAcquired = false
    }
    await factoryReset().catch(() => undefined)
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('data:getAnalytics', (): Promise<DataAnalytics> => getDataAnalytics())

  const serializeCapabilities = async (): Promise<
    Array<{
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
    }>
  > => {
    const bundled = await bundledCapabilityNames()
    return agent.cerebellum
      .getCapabilities()
      .filter((c) => !c.inProcess)
      .map((c) => ({
        name: c.name,
        description: c.description,
        status: c.status,
        hasPlugin: c.hasPlugin,
        toolCount: c.tools.length,
        triggers: c.triggers.keywords,
        requires: c.requires,
        official: bundled.has(c.name),
        enabled: !agent.cerebellum.isDisabled(c.name),
        error: c.error
      }))
  }

  ipcMain.handle('cerebellum:listCapabilities', async () => {
    await agent.init()
    return serializeCapabilities()
  })

  ipcMain.handle('cerebellum:reload', async () => {
    await agent.cerebellum.reload()
    return serializeCapabilities()
  })

  ipcMain.handle('cerebellum:toggleCapability', async (_e, name: string, enabled: boolean) => {
    const cfg = await readConfig()
    const disabled = new Set(cfg?.disabledCapabilities ?? [])
    if (enabled) disabled.delete(name)
    else disabled.add(name)
    const list = [...disabled]
    await patchConfig((c) => ({ ...c, disabledCapabilities: list }))
    agent.cerebellum.setDisabled(list)
  })

  // Voice — read TTS-generated audio files for the renderer's AudioPlayer
  // (source="voice"), download via save dialog, and check existence for
  // past conversations.
  ipcMain.handle('voice:readFile', async (_e, filePath: string): Promise<Buffer> => {
    const { readFile } = await import('node:fs/promises')
    return readFile(filePath)
  })
  ipcMain.handle('voice:download', async (_e, filePath: string): Promise<{ ok: boolean }> => {
    const { basename } = await import('node:path')
    const { readFile } = await import('node:fs/promises')
    const mainWin = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!mainWin) return { ok: false }
    const result = await dialog.showSaveDialog(mainWin, {
      defaultPath: basename(filePath),
      filters: [{ name: 'Audio', extensions: ['mp3'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false }
    const { writeFile } = await import('node:fs/promises')
    const data = await readFile(filePath)
    await writeFile(result.filePath, data)
    return { ok: true }
  })
  ipcMain.handle('voice:exists', async (_e, filePath: string): Promise<boolean> => {
    const { access, constants } = await import('node:fs/promises')
    try {
      await access(filePath, constants.F_OK)
      return true
    } catch {
      return false
    }
  })

  // Uploads — file picker, copy-to-workspace, read for renderer playback,
  // existence check for past conversations, metadata for "deleted"
  // placeholders. All paths returned to the renderer are relative to
  // workspace root so the same conversation file plays back identically
  // when the workspace is moved (rare, but the cost of doing it right is
  // zero).
  ipcMain.handle('upload:pickFile', async (): Promise<string[]> => {
    const mainWin = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!mainWin) return []
    const result = await dialog.showOpenDialog(mainWin, {
      title: 'Attach files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'All supported',
          extensions: [
            'jpg',
            'jpeg',
            'png',
            'gif',
            'webp',
            'pdf',
            'docx',
            'xlsx',
            'xls',
            'csv',
            'tsv',
            'txt',
            'md',
            'json',
            'pptx',
            'mp3',
            'wav',
            'ogg',
            'm4a',
            'flac',
            'webm'
          ]
        },
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
        {
          name: 'Documents',
          extensions: ['pdf', 'docx', 'xlsx', 'xls', 'csv', 'tsv', 'txt', 'md', 'json', 'pptx']
        },
        { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'webm'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle('upload:pickFolder', async (): Promise<string | null> => {
    const mainWin = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!mainWin) return null
    const result = await dialog.showOpenDialog(mainWin, {
      title: 'Select working folder',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    'upload:saveFile',
    async (
      _e,
      payload: { conversationId: string; sourcePath: string }
    ): Promise<UploadedFileMetadata> => {
      if (!payload?.conversationId) throw new Error('conversationId is required')
      if (!payload?.sourcePath) throw new Error('sourcePath is required')
      const meta = await saveUpload(payload.conversationId, payload.sourcePath)
      agent.corpus.emit('upload.completed', {
        filePath: meta.filePath,
        type: meta.type,
        sizeBytes: meta.sizeBytes
      })
      return meta
    }
  )

  ipcMain.handle(
    'upload:saveBuffer',
    async (
      _e,
      payload: { conversationId: string; buffer: ArrayBuffer; fileName: string }
    ): Promise<UploadedFileMetadata> => {
      if (!payload?.conversationId) throw new Error('conversationId is required')
      if (!payload?.buffer) throw new Error('buffer is required')
      if (!payload?.fileName) throw new Error('fileName is required')
      const meta = await saveUploadFromBuffer(
        payload.conversationId,
        Buffer.from(payload.buffer),
        payload.fileName
      )
      agent.corpus.emit('upload.completed', {
        filePath: meta.filePath,
        type: meta.type,
        sizeBytes: meta.sizeBytes
      })
      return meta
    }
  )

  ipcMain.handle('upload:readFile', async (_e, relativePath: string): Promise<Buffer> => {
    return readUpload(relativePath)
  })

  ipcMain.handle('upload:exists', async (_e, relativePath: string): Promise<boolean> => {
    return uploadExists(relativePath)
  })

  ipcMain.handle(
    'upload:getMetadata',
    async (
      _e,
      relativePath: string
    ): Promise<{ sizeBytes: number; mtimeMs: number; mimeType: string } | null> => {
      const stat = await statUpload(relativePath)
      if (!stat) return null
      const { mimeType } = classifyFile(relativePath)
      return { ...stat, mimeType }
    }
  )

  ipcMain.handle('upload:isSupported', (_e, fileName: string): boolean => {
    return isSupportedExtension(fileName) || categorizeFile(fileName) !== 'unknown'
  })

  ipcMain.handle(
    'upload:validate',
    (
      _e,
      payload: {
        fileName: string
        sizeBytes: number
        currentCount: number
        currentTotalBytes: number
      }
    ): ValidationError | null => {
      return validateFile(
        payload.fileName,
        payload.sizeBytes,
        payload.currentCount,
        payload.currentTotalBytes
      )
    }
  )

  ipcMain.handle(
    'upload:openExternal',
    async (_e, relativePath: string): Promise<{ ok: boolean; error?: string }> => {
      const abs = resolveUploadPath(relativePath)
      if (!abs) return { ok: false, error: 'invalid path' }
      try {
        const error = await shell.openPath(abs)
        if (error) return { ok: false, error }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('upload:download', async (_e, relativePath: string): Promise<{ ok: boolean }> => {
    const abs = resolveUploadPath(relativePath)
    if (!abs) return { ok: false }
    const mainWin = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!mainWin) return { ok: false }
    const { basename } = await import('node:path')
    const result = await dialog.showSaveDialog(mainWin, {
      defaultPath: basename(abs)
    })
    if (result.canceled || !result.filePath) return { ok: false }
    const { copyFile } = await import('node:fs/promises')
    await copyFile(abs, result.filePath)
    return { ok: true }
  })

  ipcMain.handle('runtime:setUpdatesEnabled', async (_e, value: boolean) => {
    await patchConfig((c) => ({
      ...c,
      updates: { ...(c.updates ?? { enabled: true }), enabled: value }
    }))
    return { value }
  })

  ipcMain.handle('runtime:setLastSettingsState', async (_e, patch: Record<string, string>) => {
    await patchConfig((c) => ({
      ...c,
      lastSettingsState: { ...c.lastSettingsState, ...patch }
    }))
  })

  ipcMain.handle('runtime:setWeekStartsOn', async (_e, value: WeekStartsOn) => {
    await persistWeekStartsOn(value)
    return { value }
  })
  ipcMain.handle('runtime:getCompactionConfig', async () => {
    return getCompactionConfig()
  })
  ipcMain.handle(
    'runtime:setCompactionConfig',
    async (_e, patch: Partial<import('@main/workspace/workspace').CompactionConfig>) => {
      const updated = await persistCompactionConfig(patch)
      const cfg = updated.compaction!
      agent.brainstem.setCompactionConfig(cfg)
      return cfg
    }
  )

  ipcMain.handle('updater:install', async () => {
    if (is.dev) return
    await stampPreUpdateVersion()
    await shutdownGracefully()
    quitInProgress = false
    installUpdate()
  })

  ipcMain.handle('updater:consumePostUpdate', async () => {
    const cfg = await readConfig()
    const last = cfg?.updates?.lastVersion
    if (!last || last === app.getVersion()) return false
    await patchConfig((c) => {
      const { lastVersion, ...rest } = c.updates ?? { enabled: true }
      void lastVersion
      return { ...c, updates: rest as typeof c.updates }
    })
    return true
  })

  ipcMain.handle('updater:listChangelogMonths', async () => {
    const { readdir } = await import('node:fs/promises')
    const base = is.dev
      ? join(app.getAppPath(), 'src', 'changelog')
      : join(process.resourcesPath, 'changelog')
    try {
      const entries = await readdir(base, { withFileTypes: true })
      return entries
        .filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name))
        .map((e) => e.name)
        .sort()
        .reverse()
    } catch {
      return []
    }
  })

  ipcMain.handle('updater:readChangelog', async (_event, month: string, locale?: string) => {
    const { readFile } = await import('node:fs/promises')
    const lang = locale ?? 'en'
    const base = is.dev
      ? join(app.getAppPath(), 'src', 'changelog')
      : join(process.resourcesPath, 'changelog')
    for (const l of [lang, 'en']) {
      try {
        return await readFile(join(base, month, `${l}.md`), 'utf8')
      } catch {
        // try next
      }
    }
    return ''
  })

  ipcMain.handle('workspace:getModelCatalog', () => MODEL_CATALOG)

  // Viewer — read-only tree + read/write of individual workspace files.
  ipcMain.handle('viewer:readTree', (): Promise<ViewerTreeNode[]> => readViewerTree())
  ipcMain.handle('viewer:resync', (): Promise<ViewerTreeNode[]> => readViewerTree())
  ipcMain.handle(
    'viewer:readFile',
    (_e, relativePath: string): Promise<string> => readViewerFile(relativePath)
  )
  ipcMain.handle(
    'viewer:writeFile',
    (_e, relativePath: string, content: string): Promise<void> =>
      writeViewerFile(relativePath, content)
  )
  ipcMain.handle(
    'viewer:hasDefault',
    (_e, relativePath: string): Promise<boolean> => hasBundledDefault(relativePath)
  )
  ipcMain.handle(
    'viewer:readDefault',
    (_e, relativePath: string): Promise<string> => readBundledDefault(relativePath)
  )
  ipcMain.handle(
    'viewer:stat',
    (_e, relativePath: string): Promise<{ mtimeMs: number }> => statViewerFile(relativePath)
  )
  ipcMain.handle(
    'viewer:readBinaryFile',
    (_e, relativePath: string): Promise<Buffer> => readViewerBinaryFile(relativePath)
  )
  ipcMain.handle('viewer:download', async (_e, relativePath: string): Promise<{ ok: boolean }> => {
    const mainWin = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!mainWin) return { ok: false }
    const fileName = relativePath.split('/').pop() ?? relativePath
    const result = await dialog.showSaveDialog(mainWin, { defaultPath: fileName })
    if (result.canceled || !result.filePath) return { ok: false }
    const buf = await readViewerBinaryFile(relativePath)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(result.filePath, buf)
    return { ok: true }
  })

  // Heartbeat
  ipcMain.handle('heartbeat:getJobs', () => {
    const jobs = agent.brainstem.getActiveJobs()
    const now = Date.now()
    return jobs.map((j) => ({
      ...j,
      nextRunMs: j.cron ? nextCronMs(j.cron, now) : null
    }))
  })

  ipcMain.handle('heartbeat:getRunningJob', () => {
    return agent.brainstem.getRunningJob()
  })

  agent.brainstem.setListener({
    onJobStarted: (info) => broadcast('heartbeat:jobStarted', info),
    onJobEnded: (payload) => broadcast('heartbeat:jobEnded', payload),
    onJobLog: (entry) => broadcast('heartbeat:jobLog', entry)
  })

  // Conversations
  ipcMain.handle('conversation:list', (): Promise<ConversationMeta[]> => listConversations())
  ipcMain.handle(
    'conversation:load',
    (_e, id: string): Promise<ConversationFile | null> => loadConversation(id)
  )
  ipcMain.handle('conversation:save', (_e, conv: ConversationFile): Promise<{ ok: true }> => {
    return trackBackgroundTask(async () => {
      await saveConversation(conv)
      return { ok: true as const }
    })
  })
  ipcMain.handle('conversation:delete', async (_e, id: string): Promise<{ ok: true }> => {
    await deleteConversation(id)
    return { ok: true }
  })
  ipcMain.handle(
    'conversation:create',
    (_e, model: string | null): ConversationFile => createConversation(model)
  )
  ipcMain.handle('conversation:generateTitle', (_e, conv: ConversationFile): { title: string } => {
    return { title: generateTitle(conv) }
  })

  // Ollama
  ipcMain.handle('ollama:detect', async () => {
    const reachable = await detectOllama()
    const installed = isOllamaInstalled()
    return { reachable, installed }
  })
  ipcMain.handle('ollama:installUrl', () => platformInstallUrl(process.platform))
  ipcMain.handle('ollama:openInstallPage', async () => {
    await shell.openExternal(platformInstallUrl(process.platform))
    return { opened: true }
  })
  ipcMain.handle('ollama:start', () => startOllama())
  ipcMain.handle('ollama:listInstalled', async () => {
    try {
      return await listTags()
    } catch {
      return []
    }
  })

  // Model selection — pulls (if needed) and persists. Streams progress to
  // every renderer; final 'success' or error is also broadcast.
  ipcMain.handle('model:select', async (_e, modelName: string) => {
    if (activePull && activePullModel !== modelName) {
      activePull.abort()
    }
    if (activePull && activePullModel === modelName) {
      return { ok: true, alreadyRunning: true }
    }

    const installed = await listTags().catch(() => [])
    const alreadyDownloaded = installed.some((t) => t.name === modelName)

    if (alreadyDownloaded) {
      await selectLocalModel(modelName)
      const updated = await readConfig()
      if (updated?.llm.local.model) {
        localProvider.configure(updated.llm.local.model, updated.llm.local.endpoint)
      }
      broadcast('model:pullDone', { modelName, ok: true as const })
      return { ok: true, alreadyDownloaded: true }
    }

    const controller = new AbortController()
    activePull = controller
    activePullModel = modelName

    try {
      await pullModel({
        model: modelName,
        signal: controller.signal,
        onStatus: (status: OllamaPullStatus) => {
          if (status.kind === 'success') {
            broadcast('model:pullProgress', {
              modelName,
              status: 'success',
              completed: null,
              total: null
            })
          } else {
            broadcast('model:pullProgress', {
              modelName,
              status: status.status,
              completed: status.completed,
              total: status.total
            })
          }
        }
      })
      await selectLocalModel(modelName)
      const updated = await readConfig()
      if (updated?.llm.local.model) {
        localProvider.configure(updated.llm.local.model, updated.llm.local.endpoint)
      }
      broadcast('model:pullDone', { modelName, ok: true as const })
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const aborted = controller.signal.aborted
      broadcast('model:pullDone', {
        modelName,
        ok: false as const,
        error: message,
        aborted
      })
      return { ok: false, error: message, aborted }
    } finally {
      if (activePull === controller) {
        activePull = null
        activePullModel = null
      }
    }
  })

  ipcMain.handle('model:cancelPull', () => {
    activePull?.abort()
    return { canceled: !!activePull }
  })

  ipcMain.handle('model:clear', async () => {
    activePull?.abort()
    await clearLocalModel()
    localProvider.configure(null)
    return { cleared: true }
  })

  ipcMain.handle('model:status', () => ({
    model: localProvider.currentModel
  }))

  // Active-model capability check used by the renderer to decide whether
  // to allow image uploads. Cloud providers all support vision today; for
  // local Ollama we ask /api/show whether the model declares a "vision"
  // capability (cached in LocalProvider). Returns false when no model is
  // available at all so the renderer can dim the upload button.
  ipcMain.handle(
    'model:capabilities',
    async (): Promise<{
      provider: string | null
      model: string | null
      supportsVision: boolean
    }> => {
      const provider = agent.thalamus.getActiveProvider()
      if (!provider) return { provider: null, model: null, supportsVision: false }
      if (provider === 'local') {
        const model = agent.thalamus.getLocalModelName()
        const supportsVision = await agent.thalamus.localSupportsVision()
        return { provider, model, supportsVision }
      }
      const cloudProviders = agent.thalamus.getCloudProviders()
      const active = cloudProviders.find((p) => p.id === provider)
      return { provider, model: active?.model ?? null, supportsVision: true }
    }
  )

  // Cloud providers — list/save/remove persist to config.json and re-seed
  // the thalamus cascade in-place. test hits the provider's /v1/models
  // endpoint, which validates auth without spending tokens and returns the
  // catalogue used to populate the model dropdown.
  ipcMain.handle('provider:list', async (): Promise<ProviderListEntry[]> => {
    const cfg = await readConfig()
    const providers = cfg?.llm.providers ?? []
    return providers.map((p) => ({
      id: p.id,
      model: p.model,
      apiKey: p.apiKey,
      models: p.models
    }))
  })

  ipcMain.handle(
    'provider:test',
    async (
      _e,
      payload: { id: CloudProviderConfig['id']; apiKey?: string }
    ): Promise<ProviderTestResult> => {
      // No apiKey from the renderer means "re-validate the key already on
      // disk" — used by the panel's silent refresh on mount. The stored key
      // never round-trips back to the renderer.
      let apiKey = payload.apiKey
      const usingStored = !apiKey
      if (!apiKey) {
        const cfg = await readConfig()
        apiKey = cfg?.llm.providers.find((p) => p.id === payload.id)?.apiKey
      }
      if (!apiKey) return { ok: false, kind: 'invalid_key' }

      const result = await fetchProviderModels(payload.id, apiKey)
      if (result.ok && usingStored) {
        const cfg = await readConfig()
        const existing = cfg?.llm.providers.find((p) => p.id === payload.id)
        if (existing) {
          await setCloudProvider({ ...existing, models: result.models })
          const next = await readConfig()
          if (next?.llm.providers) {
            thalamus.setCloudProviders(next.llm.providers)
            thalamus.setCloudPriority(next.llm.cloudPriority ?? next.llm.providers.map((p) => p.id))
          }
          broadcast('provider:updated', { id: payload.id })
        }
      }
      return result
    }
  )

  // Save accepts an optional apiKey — if omitted, we keep what's already on
  // disk. Lets the user change just the model selection without re-pasting
  // their key.
  ipcMain.handle(
    'provider:save',
    async (
      _e,
      payload: {
        id: CloudProviderConfig['id']
        model: string
        apiKey?: string
        models?: string[]
      }
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const cfg = await readConfig()
      const existing = cfg?.llm.providers.find((p) => p.id === payload.id)
      const apiKey = payload.apiKey ?? existing?.apiKey
      if (!apiKey) {
        return { ok: false, error: 'no_key' }
      }
      const updated = await setCloudProvider({
        id: payload.id,
        model: payload.model,
        apiKey,
        models: payload.models ?? existing?.models
      })
      thalamus.setCloudProviders(updated.llm.providers)
      thalamus.setCloudPriority(updated.llm.cloudPriority ?? updated.llm.providers.map((p) => p.id))
      broadcast('provider:updated', { id: payload.id })
      return { ok: true }
    }
  )

  ipcMain.handle(
    'provider:remove',
    async (_e, id: CloudProviderConfig['id']): Promise<{ ok: true }> => {
      const updated = await removeCloudProvider(id)
      thalamus.setCloudProviders(updated.llm.providers)
      thalamus.setCloudPriority(updated.llm.cloudPriority ?? updated.llm.providers.map((p) => p.id))
      broadcast('provider:updated', { id })
      return { ok: true }
    }
  )

  ipcMain.handle('provider:getPriority', async (): Promise<CloudProviderConfig['id'][]> => {
    const cfg = await readConfig()
    const providers = cfg?.llm.providers ?? []
    return cfg?.llm.cloudPriority ?? providers.map((p) => p.id)
  })

  ipcMain.handle(
    'provider:setPriority',
    async (_e, order: CloudProviderConfig['id'][]): Promise<{ ok: true }> => {
      const updated = await persistCloudPriority(order)
      thalamus.setCloudPriority(updated.llm.cloudPriority ?? updated.llm.providers.map((p) => p.id))
      // Broadcast so any open settings panel reloads its priority view.
      for (const p of updated.llm.providers) {
        broadcast('provider:updated', { id: p.id })
      }
      return { ok: true }
    }
  )

  // Chat — delegated to ElectronChannel. The handler returns the turnId
  // synchronously so the renderer can register listeners before any
  // segment fires. Streaming continues in the background inside the
  // channel.
  ipcMain.handle(
    'chat:send',
    (
      e,
      payload: {
        history: Array<{ role: 'user' | 'assistant'; content: string }>
        conversationId?: string | null
      }
    ) => electronChannel.send(e.sender, payload)
  )

  ipcMain.handle('chat:cancel', () => electronChannel.cancel())

  ipcMain.handle(
    'chat:approvalRespond',
    (_e, payload: { id: string; decision: ApprovalDecision }) =>
      electronChannel.respondApproval(payload)
  )

  // Usage — aggregated token & cost data from markdown files.
  // Fire-and-forget load so the cache is warm by the time the user opens
  // the usage tab. Does not block window creation.
  void agent.usage.load().catch(() => undefined)

  ipcMain.handle('usage:getSummary', async (_e, range: UsageTimeRange) => {
    return agent.usage.getSummary(range)
  })
  ipcMain.handle('usage:getStats', async (_e, range: UsageTimeRange) => {
    const stats = await agent.usage.getStats(range)
    const cutoffMs = rangeCutoffMs(range)
    const conversations = await countConversationsSince(cutoffMs)
    return { ...stats, conversations }
  })
  ipcMain.handle('usage:getDaily', async (_e, year: number) => {
    return agent.usage.getDaily(year)
  })
  ipcMain.handle('usage:sync', async () => {
    await agent.usage.sync()
    return { ok: true as const }
  })

  protocol.handle('wolffish-media', (request) => {
    const relativePath = decodeURIComponent(request.url.replace('wolffish-media://', ''))
    const absolutePath = join(workspaceRoot(), relativePath)
    return net.fetch(`file://${absolutePath}`)
  })

  createTray(cfg?.locale ?? 'en')
  createWindow()

  app.on('activate', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.show()
      showDock()
    } else {
      createWindow()
      showDock()
    }
  })
})

app.on('before-quit', (event) => {
  isQuittingFromTray = true
  if (quitInProgress) {
    event.preventDefault()
    return
  }
  if (isShuttingDown || !hasInflightWork()) return

  wlog.info('[quit]', 'inflight work — draining before quit')
  event.preventDefault()
  quitInProgress = true
  broadcast('app:closingPending', { tasks: pendingBackgroundTasks })
  void drainAndQuit()
})

app.on('will-quit', () => {
  if (lockAcquired) {
    releaseLockSync(lockfilePath())
    lockAcquired = false
  }
})

app.on('window-all-closed', () => {
  // Keep the app alive in the tray on all platforms
})

function nextCronMs(expr: string, nowMs: number): number | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minute, hour, dom, , dow] = parts
  const now = new Date(nowMs)

  if (minute.startsWith('*/') && hour === '*') {
    const interval = parseInt(minute.slice(2))
    if (!interval) return null
    const cur = now.getMinutes()
    const next = Math.ceil((cur + 1) / interval) * interval
    const d = new Date(now)
    d.setSeconds(0, 0)
    if (next >= 60) {
      d.setHours(d.getHours() + 1)
      d.setMinutes(next % 60)
    } else {
      d.setMinutes(next)
    }
    return d.getTime()
  }

  if (hour.startsWith('*/')) {
    const interval = parseInt(hour.slice(2))
    if (!interval) return null
    const mm = minute === '*' ? 0 : parseInt(minute)
    const curH = now.getHours()
    const nextH = Math.ceil((curH + 1) / interval) * interval
    const d = new Date(now)
    d.setSeconds(0, 0)
    d.setMinutes(mm)
    if (nextH >= 24) {
      d.setDate(d.getDate() + 1)
      d.setHours(nextH % 24)
    } else {
      d.setHours(nextH)
    }
    return d.getTime()
  }

  const mm = minute === '*' ? 0 : parseInt(minute)
  const hh = hour === '*' ? -1 : parseInt(hour)

  if (hh >= 0 && dom === '*' && dow === '*') {
    const d = new Date(now)
    d.setSeconds(0, 0)
    d.setHours(hh, mm)
    if (d.getTime() <= nowMs) d.setDate(d.getDate() + 1)
    return d.getTime()
  }

  if (hh < 0) {
    const d = new Date(now)
    d.setSeconds(0, 0)
    d.setMinutes(mm)
    if (d.getTime() <= nowMs) d.setHours(d.getHours() + 1)
    return d.getTime()
  }

  return null
}

function rangeCutoffMs(range: UsageTimeRange): number {
  const now = new Date()
  switch (range) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    case 'this_month':
      return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    case '3_months':
      return new Date(now.getFullYear(), now.getMonth() - 3, 1).getTime()
    case '6_months':
      return new Date(now.getFullYear(), now.getMonth() - 6, 1).getTime()
    case 'ytd':
      return new Date(now.getFullYear(), 0, 1).getTime()
    case 'all_time':
      return 0
  }
}
