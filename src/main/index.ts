process.noDeprecation = true

import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { braveService, type BraveStatus, type BraveTestResult } from '@main/brave'
import { turnRouter } from '@main/channels/channel'
import { collectChannelStatus } from '@main/channels/status'
import { ElectronChannel } from '@main/channels/electron/channel'
import { ExtensionServer } from '@main/channels/extension/server'
import { TelegramChannel } from '@main/channels/telegram/channel'
import { TurnRunner } from '@main/channels/turn-runner'
import { WhatsAppChannel } from '@main/channels/whatsapp/channel'
import {
  countConversationsSince,
  createConversation,
  deleteConversation,
  listConversations,
  loadConversation,
  mergeConversationOnto,
  updateConversation,
  type ConversationFile,
  type ConversationMeta
} from '@main/conversations'
import { getDataAnalytics, type DataAnalytics } from '@main/data'
import { githubService, type GitHubStatus, type GitHubTestResult } from '@main/github'
import {
  getSttInstallState,
  getTtsInstallState,
  installStt,
  installTts,
  sttStatus,
  ttsStatus,
  type EngineInstallProgress,
  type EngineInstallResult,
  type EngineRuntimeState,
  type EngineStatus
} from '@main/voice-engines'
import {
  googleService,
  type GoogleAuthResult,
  type GoogleBinaryStatus,
  type GoogleCredentialsResult,
  type GoogleSetupResult,
  type GoogleSetupState,
  type GoogleStatus,
  type GoogleUpdateResult
} from '@main/google'
import { acquireLock, releaseLockSync } from '@main/lockfile'
import { memesService, type MemesStatus, type MemesTestResult } from '@main/memes'
import { notionService, type NotionStatus, type NotionTestResult } from '@main/notion'
import { configureSummarizer, queueConversationSummarization } from '@main/conversation-summarizer'
import { createProcedure, deleteProcedure, listProcedures, updateProcedure } from '@main/procedures'
import {
  defaultModelsFolder,
  detect as detectOllama,
  enrichWithDetails,
  isOllamaInstalled,
  listTags,
  platformInstallUrl,
  pullModel,
  scanModelManifests,
  startOllama,
  type OllamaPullStatus
} from '@main/ollama'
import { diskWriter } from '@main/io/diskWriter'
import { Agent } from '@main/runtime/agent'
import type { ApprovalDecision } from '@main/runtime/amygdala'
import { previewSchedule } from '@main/runtime/brainstem'
import { COMPACTION_THRESHOLD } from '@main/runtime/compactor'
import type { AskUserResponse } from '@main/runtime/cerebellum'
import { deleteCapabilityFolder, importCapability } from '@main/runtime/capabilityImport'
import { McpManager } from '@main/runtime/mcp/manager'
import type { McpAddInput, McpHeader } from '@main/runtime/mcp/types'
import { MODEL_CATALOG } from '@main/runtime/models'
import { localProvider } from '@main/runtime/providers/local'
import { sudoSession } from '@main/runtime/sudoSession'
import type { CloudProviderConfig } from '@main/runtime/thalamus'
import { Thalamus } from '@main/runtime/thalamus'
import type { TimeRange as UsageTimeRange } from '@main/runtime/usage'
import { cloudModelSupportsVision } from '@main/runtime/vision'
import { detectSystem, type SystemInfo } from '@main/system'
import {
  checkForUpdatesIfEnabled,
  initUpdater,
  installUpdate,
  isUpdateReady,
  markInstalling,
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
  resolveViewerPath,
  statViewerFile,
  writeViewerFile,
  type ViewerTreeNode
} from '@main/viewer'
import { wlog } from '@main/workspace/logger'
import {
  bundledCapabilityNames,
  clearLocalModel,
  ensureWorkspace,
  extensionFolderPath,
  factoryReset,
  getBraveConfig,
  getBrowserExtensionConfig,
  getCompactionConfig,
  getComputerUseConfig,
  getGitHubConfig,
  getGoogleConfig,
  getInAppConfig,
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
  setBlockCredentials as persistBlockCredentials,
  setBrain as persistBrain,
  setMode as persistMode,
  setBraveConfig as persistBraveConfig,
  setBrowserExtensionConfig as persistBrowserExtensionConfig,
  setBypassPermissions as persistBypassPermissions,
  setCompactionConfig as persistCompactionConfig,
  setComputerUseConfig as persistComputerUseConfig,
  setGitHubConfig as persistGitHubConfig,
  setGoogleConfig as persistGoogleConfig,
  setInAppConfig as persistInAppConfig,
  setLaunchAtStartup as persistLaunchAtStartup,
  setLocale as persistLocale,
  setLocalOnly as persistLocalOnly,
  setMemesConfig as persistMemesConfig,
  setNotionConfig as persistNotionConfig,
  setRestrictPowerfulModels as persistRestrictPowerfulModels,
  setSttConfig as persistSttConfig,
  setTelegramConfig as persistTelegramConfig,
  setTheme as persistTheme,
  setThinkingMode as persistThinkingMode,
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
  type BrowserExtensionConfig,
  type ComputerUseConfig,
  type GitHubConfig,
  type GitHubConnection,
  type GoogleConfig,
  type InAppConfig,
  type MemesConfig,
  type NotionConfig,
  type NotionConnection,
  type SttConfig,
  type TelegramConfig,
  type TtsConfig,
  type Variable,
  type WeekStartsOn,
  type WhatsAppConfig,
  type WorkspaceStatus
} from '@main/workspace/workspace'
import type { ChatHistoryMessage } from '@preload/index'
import icon from '@resources/icons-win/icons/512x512.png?asset'
import dockIcon from '@resources/icons/icons/1024x1024.png?asset'
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
  screen,
  shell,
  systemPreferences,
  Tray
} from 'electron'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import { isAbsolute, join } from 'node:path'

// Redirect Chromium/Electron-managed state into ~/.wolffish so a single
// `rm -rf ~/.wolffish` wipes every byte the app touches. Must run before
// app.whenReady() — Electron resolves these paths on first use.
const WOLFFISH_ROOT = join(os.homedir(), '.wolffish')
app.setPath('userData', join(WOLFFISH_ROOT, 'runtime'))
app.setAppLogsPath(join(WOLFFISH_ROOT, 'logs'))

// Resolve a path the assistant mentioned in chat (which may start with ~) to an
// absolute path. Returns null for anything that isn't a real absolute/home path
// — the renderer only ever passes such paths, but this guards against junk.
function resolveDevicePath(p: string): string | null {
  if (!p || typeof p !== 'string') return null
  const trimmed = p.trim()
  let resolved = trimmed
  if (trimmed === '~') resolved = os.homedir()
  else if (trimmed.startsWith('~/')) resolved = join(os.homedir(), trimmed.slice(2))
  return isAbsolute(resolved) ? resolved : null
}

// Wolffish is a full-access local agent — it runs shell commands, installs
// software, and elevates with sudo on the user's behalf. Chromium's sandbox
// works against that: on Linux it sets the kernel's no_new_privs flag on the
// main process, which the kernel then uses to ignore the setuid bit on `sudo`
// and `pkexec` — so EVERY elevation a plugin spawns fails with
// `sudo: The "no new privileges" flag is set`. `--no-sandbox` runs every
// process unsandboxed: no no_new_privs (sudo works) and no setuid
// chrome-sandbox helper needed in a packaged AppImage/deb. Must run before
// app.whenReady(). Built-in safety lives in the amygdala approval gate.
//
// Do NOT also pass `--disable-setuid-sandbox`: it's redundant under
// `--no-sandbox` and Linux-only, so it only muddies the flag set.
app.commandLine.appendSwitch('no-sandbox')

// Running unsandboxed, Chromium's guest/renderer processes allocate their
// shared memory directly in /dev/shm instead of via the sandbox broker. On some
// Linux hosts a guest process can't access /dev/shm from its context and dies
// FATAL ("Creating shared memory in /dev/shm ... failed"), which leaves the
// <webview> page viewer, PDF preview, and wolffish-media files BLANK while the
// main window (already painted) looks fine. This bit packaged Linux only —
// macOS/Windows don't use /dev/shm, and under the SUID sandbox (before we
// disabled it) the broker handled the shared memory. `--disable-dev-shm-usage`
// routes that shared memory to a regular temp file, fixing the blank guests
// with no effect on the sudo/no_new_privs behavior above.
app.commandLine.appendSwitch('disable-dev-shm-usage')

// The real fix for the blank Linux viewers. Even with --no-sandbox, the
// guest/renderer/GPU child processes in a packaged build still bring up the
// seccomp-bpf filter ("InitializeSandbox() called ... in process gpu-process"),
// and that filter REJECTS the syscall those processes use to allocate their
// compositor shared-memory buffer — failing thousands of times per second with
// the impossible `access(...) /tmp: No such process` (ESRCH = seccomp denial).
// With no buffer, the <webview> page viewer / PDF preview / wolffish-media files
// can't composite → BLANK, while the main window (already painted) looks fine.
// In dev the CLI `--no-sandbox` tears down seccomp too, which is why dev renders;
// macOS/Windows have no seccomp layer. Disabling the seccomp + GPU sandbox layers
// here matches the --no-sandbox intent (fully unsandboxed) and lets the guests
// get their shared memory. No effect on the sudo/no_new_privs behavior above.
app.commandLine.appendSwitch('disable-seccomp-filter-sandbox')
app.commandLine.appendSwitch('disable-gpu-sandbox')
// --no-zygote: child processes are exec'd fresh (each inheriting the current
// command line incl. --no-sandbox) instead of forked from a zygote that may
// have committed to a sandbox before appendSwitch() ran in this main module.
// Belt-and-suspenders for the same blank-guest issue.
app.commandLine.appendSwitch('no-zygote')

// Single-instance guard: if Wolffish is already running (even collapsed to
// tray), focus the existing window instead of showing a lockfile error.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => {
  restoreMainWindow()
})

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
        .filter((m) => isAnthropicChatModel(m.id))
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
        .filter((m) => isMiMoChatModel(m.id))
        .slice()
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
        .map((m) => m.id)
      return { ok: true, models }
    }

    if (id === 'minimax') {
      const res = await fetch('https://api.minimaxi.chat/v1/models', {
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
        .filter((m) => isMiniMaxChatModel(m.id))
        .slice()
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
        .map((m) => m.id)
      return { ok: true, models }
    }

    if (id === 'kimi') {
      const res = await fetch('https://api.moonshot.ai/v1/models', {
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
        .filter((m) => isKimiChatModel(m.id))
        .slice()
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
        .map((m) => m.id)
      return { ok: true, models }
    }

    if (id === 'qwen') {
      const res = await fetch('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models', {
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
        .filter((m) => isQwenChatModel(m.id))
        .slice()
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
        .map((m) => m.id)
      return { ok: true, models }
    }

    if (id === 'stepfun') {
      const res = await fetch('https://api.stepfun.ai/v1/models', {
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
        .filter((m) => isStepfunChatModel(m.id))
        .slice()
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
        .map((m) => m.id)
      return { ok: true, models }
    }

    if (id === 'zai') {
      const res = await fetch('https://api.z.ai/api/paas/v4/models', {
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
        .filter((m) => isZaiChatModel(m.id))
        .slice()
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
        .map((m) => m.id)
      return { ok: true, models }
    }

    if (id === 'xai') {
      const res = await fetch('https://api.x.ai/v1/models', {
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
        .filter((m) => isXAIChatModel(m.id))
        .slice()
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
        .map((m) => m.id)
      return { ok: true, models }
    }

    if (id === 'openrouter') {
      // OpenRouter's /v1/models is public — it returns 200 with no auth at
      // all — so unlike every other provider's catalogue endpoint it can't
      // double as key validation. Probe /v1/key alongside it: that endpoint
      // 401s on a revoked/invalid key.
      const [keyRes, res] = await Promise.all([
        fetch('https://openrouter.ai/api/v1/key', {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` }
        }),
        fetch('https://openrouter.ai/api/v1/models', {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` }
        })
      ])
      if (!keyRes.ok) {
        const text = await keyRes.text().catch(() => '')
        return { ok: false, ...classifyHttpError(keyRes.status, text) }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { ok: false, ...classifyHttpError(res.status, text) }
      }
      const body = (await res.json()) as {
        data?: Array<{ id: string; created?: number; supported_parameters?: string[] }>
      }
      const filtered = (body.data ?? [])
        .filter((m) => isOpenRouterChatModel(m.id))
        .slice()
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
      const models = filtered.map((m) => m.id)
      const reasoningModels = filtered
        .filter((m) => m.supported_parameters?.includes('reasoning'))
        .map((m) => m.id)
      return { ok: true, models, reasoningModels }
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

// Anthropic /v1/models returns the full historical catalog (claude-2, the
// claude-3.x generations, dated snapshots, etc.). Wolffish supports the current
// generation — the Claude 4.x family (opus-4 / sonnet-4 / haiku-4) and Fable —
// which are the models with verified thinking/effort behaviour. Hide the rest so
// the picker stays focused and the user isn't offered unvalidated models.
function isAnthropicChatModel(id: string): boolean {
  return /^claude-(fable|opus-4|sonnet-4|haiku-4)/.test(id)
}

// OpenAI's /v1/models returns 60+ entries. Keep ANY chat-completions-capable
// model — reasoning OR not (non-reasoning models just show the brain button
// off). Omit only what genuinely can't work in Wolffish or adds no value:
//  • non-chat endpoints (image/audio/tts/realtime/etc.)
//  • -pro tiers — Responses-API only, 404 on /v1/chat/completions (verified)
//  • gpt-3.5 — too weak for an agentic assistant
//  • dated snapshots (…-YYYY-MM-DD or -MMDD) — exact duplicates of the alias
function isOpenAIChatModel(id: string): boolean {
  if (id.startsWith('gpt-image-') || id.startsWith('chatgpt-image')) return false
  if (/-(audio|tts|whisper|search|realtime|transcribe|image|instruct)/.test(id)) return false
  if (/-pro($|-)/.test(id)) return false
  if (/(\d{4}-\d{2}-\d{2}|-\d{4})$/.test(id)) return false
  if (/^gpt-3\.5/.test(id)) return false
  return /^(gpt-|chatgpt-|o\d)/.test(id)
}

function isDeepSeekChatModel(id: string): boolean {
  return id.startsWith('deepseek-')
}

function isMiniMaxChatModel(id: string): boolean {
  return id.startsWith('MiniMax-M')
}

function isStepfunChatModel(id: string): boolean {
  if (id.startsWith('step-')) {
    if (/-(image|tts|asr|embed)/.test(id)) return false
    if (/-\d{4}$/.test(id)) return false // dated snapshot (e.g. step-3.5-flash-2603)
    return true
  }
  return false
}

// DashScope returns 150+ models. Keep only the clean Qwen chat/reasoning API
// tiers and drop the noise: non-chat modalities (image/tts/asr/omni/vl/mt/…),
// open-weight size variants (…-8b, -235b-a22b, -next), dated snapshots,
// preview/latest aliases, legacy qwen2 / qwen-coder.
function isQwenChatModel(id: string): boolean {
  if (!/^(qwen|qwq|qvq)/.test(id)) return false
  if (
    /-(image|tts|asr|realtime|embed|livetranslate|captioner|ocr|character|omni|vl|mt|s2s|vc|vd|tingwu)/.test(
      id
    )
  )
    return false
  if (/^(wan|z-image|text-embedding|ccai|tongyi)/.test(id)) return false
  if (id.startsWith('qwen-image') || id.startsWith('qwen-vl') || id.startsWith('qwen-mt'))
    return false
  if (id.startsWith('qwen-coder')) return false // legacy; superseded by qwen3-coder
  if (/(\d{4}-\d{2}-\d{2})$/.test(id) || /-preview$/.test(id) || /-latest$/.test(id)) return false
  if (/-\d+b(-a\d+b)?($|-)/.test(id) || /-next($|-)/.test(id)) return false // open-weight sizes
  if (/^qwen2/.test(id)) return false
  return true
}

function isZaiChatModel(id: string): boolean {
  // Z.ai serves GLM chat/reasoning models. Vision variants (glm-*v) are
  // chat-capable too; only filter out obvious non-chat endpoints.
  if (id.startsWith('glm-')) {
    if (/-(tts|asr|embedding|whisper|image|video|voice|cogview|realtime)/.test(id)) return false
    return true
  }
  return false
}

function isXAIChatModel(id: string): boolean {
  if (!id.startsWith('grok-')) return false
  if (/-(imagine|embed|tts|stt|whisper)/.test(id)) return false
  if (id.includes('multi-agent')) return false // not allowed on /chat/completions
  return true
}

function isOpenRouterChatModel(id: string): boolean {
  if (/(-embed|-tts|-stt|-whisper|-vision-gen|-diffusion|-stable|flux|dall-e|midjourney)/.test(id))
    return false
  if (
    /^(anthropic\/|openai\/|google\/|meta-llama\/|deepseek\/|mistralai\/|qwen\/|x-ai\/|cohere\/|microsoft\/|perplexity\/|amazon\/|nousresearch\/|xiaomi\/|moonshotai\/|minimax\/|stepfun\/|z-ai\/)/.test(
      id
    )
  )
    return true
  return false
}

// MiMo /v1/models is unfiltered and includes TTS / voice-clone / voice-design /
// ASR endpoints, which are not chat models and can't drive Wolffish's agentic
// loop. Keep only the text/omni chat models.
function isMiMoChatModel(id: string): boolean {
  if (!id.startsWith('mimo-')) return false
  if (/-(tts|voiceclone|voicedesign|asr|embed)/.test(id)) return false
  return true
}

function isKimiChatModel(id: string): boolean {
  if (id.startsWith('kimi-') || id.startsWith('moonshot-v1-')) {
    // Drop non-chat endpoints and the redundant vision-preview variants —
    // Kimi's vision is covered by the general k2.x models, so the moonshot
    // *-vision-preview duplicates just clutter the picker.
    if (/-(tts|asr|embedding|whisper|vision)/.test(id)) return false
    return true
  }
  return false
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
    await setCloudProvider({ ...p, models: result.models, reasoningModels: result.reasoningModels })
    broadcast('provider:updated', { id: p.id })
  }
  // Re-seed so any new model selection downstream sees the latest config
  // (apiKey/model haven't changed but the cached model list did).
  const next = await readConfig()
  if (next?.llm.providers) {
    thalamus.setCloudProviders(next.llm.providers)
    thalamus.setBrain(next.llm.brain ?? null)
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
// one TurnRunner, which serializes turns PER CONVERSATION (one ordered
// transcript each) while conversations — across channels and within the
// renderer — run concurrently. Amygdala's approval bridge dispatches to
// the sink of the turn that asked, resolved through the turn-identity
// AsyncLocalStorage via the singleton turnRouter.
const turnRunner = new TurnRunner(agent)
// Every turn's lifecycle (any channel) is broadcast so the renderer's
// Conversations sidebar can show live status chips for in-app, WhatsApp,
// Telegram runs alike.
turnRunner.setLifecycleListener((ev) => broadcast('chat:turnState', ev))
// Relay conversation deletions to the renderer so the sidebar prunes its live
// run-status — a channel-side /delete never touches the renderer otherwise.
agent.corpus.on('conversation.deleted', ({ id }) => broadcast('conversation:deleted', { id }))
// Relay conversation (re)index/remove so the rail + History refresh for every
// create/rename/delete path — including autonomous heartbeat/procedure runs
// that never emit a turn lifecycle. Fires after the cortex row is committed.
agent.corpus.on('conversation.indexed', () => broadcast('conversation:changed', {}))
// Full rebuilds + the startup catch-up index via indexWalkedSync directly, so
// no conversation.indexed fires while they run — a list fetched mid-rebuild
// can be partial (see the getReindexStatus guard in conversation:list). Push
// one list-changed when the pass ends so every surface reconciles.
agent.corpus.on('index.reindexed', () => broadcast('conversation:changed', {}))
const electronChannel = new ElectronChannel(agent, turnRunner)
const telegramChannel = new TelegramChannel(agent, turnRunner, localProvider)
const whatsappChannel = new WhatsAppChannel(agent, turnRunner, localProvider)
const extensionServer = new ExtensionServer()

// MCP server connections. Each connected server registers an in-process
// cerebellum capability (`mcp-<slug>`), so its tools reach the Brain and
// workflow agents through the exact same per-turn selection path as
// every other capability — connect/disconnect just adds/removes the
// registration. All lifecycle noise stays inside the manager.
const mcpManager = new McpManager({
  register: (capability, plugin) =>
    agent.cerebellum.registerInProcessCapability(capability, plugin),
  unregister: (name) => agent.cerebellum.unregisterInProcessCapability(name),
  openExternal: (url) => void shell.openExternal(url),
  appVersion: app.getVersion(),
  onStatusChange: (snapshots) => broadcast('mcp:statusChange', snapshots),
  takenCapabilityNames: () => new Set(agent.cerebellum.getCapabilities().map((c) => c.name))
})

agent.amygdala.setApprovalBridge((req) => turnRouter.dispatchApproval(req))
agent.cerebellum.setAskBridge((req) => turnRouter.dispatchAskUser(req))
// Wire the agent-management bridge the `workflow` capability's plugin
// receives in its init context. It forwards to the Agent's active workflow
// session — the single source of truth for a turn's live subagents.
agent.cerebellum.setWorkflowHost(agent.workflowHost())
// Wire the MCP-management bridge the `mcp` capability's plugin receives in its
// init context. It forwards to the McpManager — the exact same methods the
// Settings → MCP IPC handlers call — so an agent-driven add/test/remove
// reflects in the UI (via mcp:statusChange) exactly like a manual one.
agent.cerebellum.setMcpHost({
  list: () => mcpManager.snapshot(),
  add: (input) => mcpManager.add(input),
  test: (id) => mcpManager.test(id),
  remove: (id) => mcpManager.remove(id),
  setEnabled: (id, enabled) => mcpManager.setEnabled(id, enabled),
  authorize: (id) => mcpManager.authorize(id)
})
// Wire the retrieval bridge the `introspect` capability's plugin receives in
// its init context. It queries the SAME cortex index the ambient context
// assembly reads, so memory_search / conversation_list / usage_report and the
// prompt's memory section can never disagree about what wolffish knows.
agent.cerebellum.setCortexHost({
  searchRecords: (query, opts) => agent.cortex.searchRecords(query, opts),
  getRecordsByRef: (refPrefix, limit) => agent.cortex.getRecordsByRef(refPrefix, limit),
  recordsByDate: (date, sources, limit) => agent.cortex.recordsByDate(date, sources, limit),
  listConversations: (opts) => agent.cortex.listConversations(opts),
  usageSummary: (opts) => agent.cortex.usageSummary(opts),
  searchArtifacts: (opts) => agent.cortex.searchArtifacts(opts),
  coverage: () => agent.cortex.coverage(),
  saveKnowledge: async (file, fact) => {
    // Exact-line dedup here: promoteToKnowledge is append-only by design, so
    // the bridge is where "don't save what's already saved" lives.
    const trimmed = fact.trim()
    if (!trimmed) return { ok: false, deduped: false }
    const line = trimmed.startsWith('-') ? trimmed : `- ${trimmed}`
    try {
      const { readFile } = await import('node:fs/promises')
      const p = join(workspaceRoot(), 'brain', 'hippocampus', 'knowledge', `${file}.md`)
      const existing = await readFile(p, 'utf8').catch(() => '')
      if (existing.split(/\r?\n/).some((l) => l.trim() === line)) {
        return { ok: true, deduped: true }
      }
    } catch {
      // a failed dedup probe must not block the save
    }
    await agent.hippocampus.promoteToKnowledge(file, trimmed)
    return { ok: true, deduped: false }
  }
})
// Feed live channel connectivity to the introspect capability so the agent can
// check whether Telegram/WhatsApp are reachable (via `channel_status` /
// `wolffish_status`) and tell the user how to reconnect a disconnected one.
agent.cerebellum.setChannelStatusProvider(() =>
  collectChannelStatus({
    telegram: () => telegramChannel.getStatus(),
    whatsapp: () => whatsappChannel.getStatus()
  })
)
// Rolling prefix summarizer: fires after conversation persistence (channel
// post-turn saves + the conversation:save IPC). The onUpdated push tells the
// renderer to fold {summary, mark} into its in-memory conversation so its
// next whole-file save preserves rather than clobbers the summary.
configureSummarizer({
  thalamus: agent.thalamus,
  onUpdated: (update) => broadcast('conversation:summaryUpdated', update)
})

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

// --- Custom Windows tray popup menu -----------------------------------------
// Native Win32 tray context menus are sized by the OS, so Electron can't make
// them bigger. On Windows we instead draw our own menu in a small frameless,
// transparent popup window (see src/preload/trayMenu.ts) scaled ~30% larger.
// The window size is fixed to that popup's CSS: a 244px card plus a 14px
// transparent margin on every side for the drop shadow.
const TRAY_POPUP_WIDTH = 272
const TRAY_POPUP_HEIGHT = 136

let trayPopup: BrowserWindow | null = null
let trayPopupShownAt = 0
let trayMenuLocale: Locale = 'en'

// The main app window — never the tray popup. Adding the popup means a bare
// `getAllWindows()[0]` could grab the wrong window, so restore/show paths use
// this helper instead.
function mainBrowserWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((w) => w !== trayPopup && !w.isDestroyed()) ?? null
}

function restoreMainWindow(): void {
  const win = mainBrowserWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    showDock()
  } else {
    createWindow()
    showDock()
  }
}

function buildTrayPopup(): BrowserWindow {
  const popup = new BrowserWindow({
    width: TRAY_POPUP_WIDTH,
    height: TRAY_POPUP_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/trayMenu.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  popup.setMenu(null)
  // Dismiss on click-away. Ignore the blur that can fire as the window first
  // takes focus, otherwise it would hide itself the instant it opens.
  popup.on('blur', () => {
    if (Date.now() - trayPopupShownAt > 120) popup.hide()
  })
  void popup.loadURL(
    'data:text/html;charset=UTF-8,' +
      encodeURIComponent(
        '<!doctype html><html><head><meta charset="utf-8"><title>Wolffish</title></head><body></body></html>'
      )
  )
  return popup
}

function showTrayPopup(bounds: Electron.Rectangle): void {
  const popup = trayPopup ?? (trayPopup = buildTrayPopup())
  const state = { locale: trayMenuLocale, dark: nativeTheme.shouldUseDarkColors }

  const area = screen.getDisplayMatching(bounds).workArea
  // Anchor to the tray icon: right-aligned, opening upward from a bottom
  // taskbar (downward if the tray sits in the top half of the screen).
  let x = Math.round(bounds.x + bounds.width - TRAY_POPUP_WIDTH)
  const openUp = bounds.y + bounds.height / 2 > area.y + area.height / 2
  let y = openUp ? Math.round(bounds.y - TRAY_POPUP_HEIGHT) : Math.round(bounds.y + bounds.height)
  x = Math.min(Math.max(x, area.x), area.x + area.width - TRAY_POPUP_WIDTH)
  y = Math.min(Math.max(y, area.y), area.y + area.height - TRAY_POPUP_HEIGHT)
  popup.setBounds({ x, y, width: TRAY_POPUP_WIDTH, height: TRAY_POPUP_HEIGHT })

  const sendState = (): void => popup.webContents.send('tray-menu:render', state)
  if (popup.webContents.isLoading()) popup.webContents.once('did-finish-load', sendState)
  else sendState()

  trayPopupShownAt = Date.now()
  popup.show()
  popup.focus()
}

// The tray artwork (icon_transparent.png) sits on a large transparent canvas —
// the fish fills only ~79% of the width and ~65% of the height — so at tray
// size it rendered noticeably smaller than neighboring app icons. Trim to the
// opaque content and pad back out to a centered square so Windows draws the
// logo edge-to-edge like other apps, without distorting its aspect ratio.
function trayIconImage(size: number): Electron.NativeImage {
  const source = nativeImage.createFromPath(trayIconDefault)
  const { width, height } = source.getSize()
  const bitmap = source.toBitmap() // BGRA, 4 bytes per pixel; we only read alpha
  const ALPHA = 16
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bitmap[(y * width + x) * 4 + 3] > ALPHA) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  let cropped = source
  if (maxX >= minX && maxY >= minY) {
    // Square holding the content + a little breathing room so the outline
    // isn't clipped, centered on the content's midpoint and clamped to canvas.
    const side = Math.round(Math.max(maxX - minX + 1, maxY - minY + 1) * 1.03)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const x = Math.max(0, Math.min(Math.round(cx - side / 2), width - side))
    const y = Math.max(0, Math.min(Math.round(cy - side / 2), height - side))
    const clamped = Math.min(side, width - x, height - y)
    cropped = source.crop({ x, y, width: clamped, height: clamped })
  }
  return cropped.resize({ width: size, height: size })
}

function createTray(locale: Locale = 'en'): void {
  if (tray) return
  const isAr = locale === 'ar'
  trayMenuLocale = locale
  let img: Electron.NativeImage
  if (process.platform === 'darwin') {
    // Unified with Windows/Linux: show the transparent colored logo (not the white template),
    // keeping the existing 22pt menu-bar size (22x22 @1x, 44x44 @2x for retina).
    const base = nativeImage.createFromPath(trayIconDefault)
    img = nativeImage.createEmpty()
    img.addRepresentation({
      scaleFactor: 1,
      width: 22,
      height: 22,
      buffer: base.resize({ width: 22, height: 22 }).toPNG()
    })
    img.addRepresentation({
      scaleFactor: 2,
      width: 44,
      height: 44,
      buffer: base.resize({ width: 44, height: 44 }).toPNG()
    })
  } else {
    img = trayIconImage(32)
  }
  tray = new Tray(img)
  tray.setToolTip('Wolffish')

  if (process.platform === 'win32') {
    // Windows: open the custom, larger popup on right-click instead of the
    // un-resizable native menu. Left/double click still restore the window.
    ipcMain.on('tray-menu:action', (_event, action: 'show' | 'quit') => {
      trayPopup?.hide()
      if (action === 'quit') {
        isQuittingFromTray = true
        app.quit()
      } else {
        restoreMainWindow()
      }
    })
    ipcMain.on('tray-menu:close', () => trayPopup?.hide())
    tray.on('right-click', (_event, bounds) => showTrayPopup(bounds))
  } else {
    // macOS/Linux keep the OS-native context menu (on macOS it also handles
    // left-click).
    const contextMenu = Menu.buildFromTemplate([
      {
        label: isAr ? 'إظهار وولف فيش' : 'Show Wolffish',
        click: () => restoreMainWindow()
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
  }

  // On Windows/Linux a single left-click restores the window (standard tray
  // behavior); macOS routes clicks through the context menu above.
  if (process.platform !== 'darwin') {
    tray.on('click', restoreMainWindow)
  }
  tray.on('double-click', restoreMainWindow)
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
      plugins: true,
      // Enables the <webview> tag used by the in-chat page viewer to render a
      // fetched website inline (borderless, isolated 'pageviewer' partition).
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.on('show', () => {
    mainWindow.webContents.executeJavaScript('document.activeElement?.blur()').catch(() => {})
  })

  mainWindow.on('close', (event) => {
    if (updateInstallInProgress) return
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

  // Spellcheck. Chromium underlines misspellings for free (webPreferences.spellcheck
  // defaults to true). The engine is per-OS: macOS uses the native OS spellchecker
  // (auto language, offline, and the setters below are no-ops), while Windows/Linux
  // use Hunspell — which needs a language set and downloads its dictionaries from a
  // CDN on first use — so only configure it off macOS.
  if (process.platform !== 'darwin') {
    try {
      const ses = mainWindow.webContents.session
      const available = ses.availableSpellCheckerLanguages
      const wanted = [app.getLocale(), 'en-US'].filter((l, i, a) => !!l && a.indexOf(l) === i)
      const langs = wanted.filter((l) => available.includes(l))
      if (langs.length) ses.setSpellCheckerLanguages(langs)
    } catch (err) {
      console.error('[spellcheck] language setup failed:', err)
    }
  }

  // The misspelled word and its suggestions live ONLY in this main-process event —
  // the DOM 'contextmenu' event the renderer sees carries none of it. Relay the
  // spellcheck fields so the renderer's own styled menu can offer corrections and
  // call back into webContents.replaceMisspelling(). Fires for every right-click the
  // page doesn't preventDefault; the renderer decides whether to surface a menu.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (mainWindow.isDestroyed()) return
    mainWindow.webContents.send('spellcheck:contextMenu', {
      isEditable: params.isEditable,
      misspelledWord: params.misspelledWord,
      dictionarySuggestions: params.dictionarySuggestions
    })
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
  await extensionServer.stop().catch(() => undefined)
  await mcpManager.stop().catch(() => undefined)
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
let updateInstallInProgress = false

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
    thalamus.setBrain(cfg.llm.brain ?? null)
    // Fire-and-forget refresh of each provider's model catalogue. Cheap
    // (a single GET per provider) and doesn't block window creation.
    void refreshAllProviderModels()
  }

  // Fire-and-forget update check. Respects the updates.enabled config flag.
  void checkForUpdatesIfEnabled()
  thalamus.setLocalOnly(cfg?.llm.localOnly ?? false)
  agent.amygdala.setBypassPermissions(cfg?.safety?.bypassPermissions ?? false)
  agent.setMode(cfg?.llm.mode ?? 'single')
  turnRunner.setBlockCredentials(cfg?.safety?.blockCredentials ?? false)
  turnRunner.setLocale(cfg?.locale ?? 'en')
  sudoSession.setLocale(cfg?.locale ?? 'en')
  agent.cerebellum.setDisabled(cfg?.disabledCapabilities ?? [])
  agent.cerebellum.setPinnedCapabilities(cfg?.pinnedCapabilities ?? [])

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

  {
    const extCfg = cfg?.browserExtension ?? { port: 23151 }
    extensionServer.setStatusChangeHandler((status) => {
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('extension:statusChange', status)
      }
    })
    void extensionServer
      .start({ port: extCfg.port })
      .catch((err) => console.error('extension server start failed:', err))
    agent.corpus.on('conversation.changed', (payload) => {
      extensionServer.setConversationId(payload.conversationId, payload.title)
    })
  }

  const lock = await acquireLock(lockfilePath())
  if (lock.acquired) lockAcquired = true

  // MCP connections start only in the instance that owns the workspace
  // lock: stdio servers are real child processes with exclusive side
  // effects (ports, database locks, OAuth token refresh writes), and a
  // dev + packaged instance pair sharing ~/.wolffish must not both
  // spawn them. Channels predate this concern; MCP doesn't inherit it.
  if (lock.acquired) {
    mcpManager.start(cfg?.mcp)
  } else {
    wlog.warn('[mcp]', `connections not started — workspace owned by pid ${lock.runningPid}`)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Spellcheck corrections — the renderer's context menu calls these after the
  // main-process 'context-menu' event handed it the misspelled word + suggestions.
  // replaceMisspelling swaps the word currently selected by the right-click; it's a
  // native edit command, so undo works and controlled React inputs re-sync via input.
  ipcMain.handle('spellcheck:replace', (e, word: string) => {
    e.sender.replaceMisspelling(word)
  })
  ipcMain.handle('spellcheck:addToDictionary', (e, word: string) => {
    // Persists to the app's custom dictionary (and the OS dictionary on macOS/
    // Windows). The default session is persistent, so this is never a no-op here.
    e.sender.session.addWordToSpellCheckerDictionary(word)
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
    sudoSession.setLocale(locale)
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
  ipcMain.handle('runtime:setLocalOnly', async (_e, value: boolean) => {
    await persistLocalOnly(value)
    thalamus.setLocalOnly(value)
    return { value }
  })
  ipcMain.handle('runtime:setRestrictPowerfulModels', async (_e, value: boolean) => {
    await persistRestrictPowerfulModels(value)
    return { value }
  })
  ipcMain.handle('runtime:setThinkingMode', async (_e, model: string, mode: string) => {
    await persistThinkingMode(model, mode)
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
      // A patch that touches only runtime preferences (verbose,
      // autoRefresh, staleHours) needs no bot restart — those are read
      // fresh per message/turn. Restart stays reserved for connection
      // changes (token, allow-list, enable transitions). No existing
      // caller sends a prefs-only patch, so this only adds a new path.
      const touchesConnection =
        patch.enabled !== undefined ||
        patch.botToken !== undefined ||
        patch.allowedUserIds !== undefined
      if (next.enabled) {
        if (touchesConnection) {
          // Re-running start with a different token must restart the
          // long-poll loop, otherwise the old bot keeps replying.
          await telegramChannel.restart(next).catch(() => undefined)
        }
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

  // Push Telegram status changes to the renderer as they happen, the same
  // way WhatsApp does. Without this the settings panel only learns the
  // status on mount or after a manual Save — so a bot that finishes
  // starting in the background reads "starting" forever until the user
  // re-saves. The channel emits `telegram.statusChanged` on every
  // transition; we forward the current snapshot.
  agent.corpus.on('telegram.statusChanged', () => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('telegram:statusChange', telegramChannel.getStatus())
    }
  })

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

  // In-app (desktop) chat — the primary renderer feed, not a remote relay
  // channel. Only a display preference (verbose) to persist; no lifecycle,
  // no restart. After a write we broadcast the new config so an open chat
  // window re-renders its feed immediately, the same way the channel panels
  // react to status changes.
  ipcMain.handle('inapp:getConfig', (): Promise<InAppConfig> => getInAppConfig())

  ipcMain.handle(
    'inapp:setConfig',
    async (_e, patch: Partial<InAppConfig>): Promise<{ ok: true; config: InAppConfig }> => {
      const updated = await persistInAppConfig(patch)
      const next = updated.inapp ?? { verbose: false }
      BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('inapp:configChange', next))
      return { ok: true as const, config: next }
    }
  )

  // MCP server connections. All lifecycle mechanics live in McpManager;
  // these handlers are thin passthroughs. Status flows to the renderer
  // via the 'mcp:statusChange' broadcast wired at manager construction.
  ipcMain.handle('mcp:list', () => mcpManager.snapshot())

  ipcMain.handle('mcp:add', (_e, input: McpAddInput) => mcpManager.add(input))

  ipcMain.handle('mcp:remove', (_e, id: string) => mcpManager.remove(id))

  ipcMain.handle('mcp:setEnabled', (_e, id: string, enabled: boolean) =>
    mcpManager.setEnabled(id, enabled)
  )

  ipcMain.handle('mcp:setHeaders', (_e, id: string, headers: McpHeader[]) =>
    mcpManager.setHeaders(id, headers)
  )

  ipcMain.handle('mcp:test', (_e, id: string) => mcpManager.test(id))

  ipcMain.handle('mcp:authorize', (_e, id: string) => mcpManager.authorize(id))

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
      connections: NotionConnection[]
    ): Promise<{ ok: true; status: NotionStatus; config: NotionConfig }> => {
      const updated = await persistNotionConfig(connections)
      const next = updated.notion ?? { connections: [] }
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
      connections: GitHubConnection[]
    ): Promise<{ ok: true; status: GitHubStatus; config: GitHubConfig }> => {
      const updated = await persistGitHubConfig(connections)
      const next = updated.github ?? { connections: [] }
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

  // Browser Extension — WebSocket server for the Wolffish browser extension.
  ipcMain.handle(
    'browserExtension:getConfig',
    (): Promise<BrowserExtensionConfig> => getBrowserExtensionConfig()
  )

  ipcMain.handle(
    'browserExtension:setConfig',
    async (
      _e,
      patch: Partial<BrowserExtensionConfig>
    ): Promise<{ ok: true; config: BrowserExtensionConfig }> => {
      await persistBrowserExtensionConfig(patch)
      const next = await getBrowserExtensionConfig()
      if (patch.port !== undefined) {
        extensionServer.sendPortUpdate(next.port)
        await extensionServer.stop()
        await extensionServer.start({ port: next.port })
      }
      return { ok: true as const, config: next }
    }
  )

  ipcMain.handle('browserExtension:status', () => extensionServer.getStatus())

  ipcMain.handle('browserExtension:openExtensionFolder', () => {
    shell.showItemInFolder(extensionFolderPath())
  })

  ipcMain.handle('browserExtension:getExtensionPath', () => {
    return extensionFolderPath()
  })

  ipcMain.handle('browserExtension:updateExtension', async () => {
    await extensionServer.requestReload()
    return { ok: true }
  })

  ipcMain.handle('browserExtension:testConnection', () => extensionServer.runTestScenario())

  ipcMain.handle('browserExtension:openExtensionsPage', () => {
    const url = 'chrome://extensions'
    if (process.platform === 'darwin') {
      const browsers = ['Google Chrome', 'Brave Browser', 'Chromium']
      for (const browser of browsers) {
        try {
          execFileSync('open', ['-a', browser, url], { stdio: 'ignore' })
          return
        } catch {
          continue
        }
      }
    } else if (process.platform === 'win32') {
      try {
        execFileSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' })
        return
      } catch {
        /* fallthrough */
      }
    } else {
      try {
        execFileSync('xdg-open', [url], { stdio: 'ignore' })
        return
      } catch {
        /* fallthrough */
      }
    }
  })

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

  // Broadcast setup/update progress as a full {stage, percent} state to ALL
  // windows (not just the invoking sender), so a panel remounted after the user
  // navigates away — in any window — keeps tracking the running install and
  // learns of completion. Paired with google:getSetupState for mount recovery.
  const broadcastGoogleSetupState = (payload: GoogleSetupState): void => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('google:setupState', payload)
    }
  }
  ipcMain.handle('google:getSetupState', (): GoogleSetupState => googleService.getSetupState())
  ipcMain.handle('google:setup', async (): Promise<GoogleSetupResult> => {
    const result = await googleService.setup((percent) =>
      broadcastGoogleSetupState({ stage: 'setup', percent })
    )
    broadcastGoogleSetupState({ stage: 'idle', percent: result.ok ? 100 : 0 })
    return result
  })

  ipcMain.handle('google:update', async (): Promise<GoogleUpdateResult> => {
    const result = await googleService.update((percent) =>
      broadcastGoogleSetupState({ stage: 'updating', percent })
    )
    broadcastGoogleSetupState({ stage: 'idle', percent: result.ok ? 100 : 0 })
    return result
  })

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

  ipcMain.handle(
    'google:checkAccounts',
    (): Promise<Record<string, boolean>> => googleService.checkAccounts()
  )

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
    ): Promise<
      { ok: true; transcript: string; language?: string } | { ok: false; error: string }
    > => {
      try {
        // Whisper decodes audio through ffmpeg. On a fresh machine ffmpeg is
        // absent, so transcription would dead-end with a long install-it-yourself
        // error. This IPC path calls the tool directly (bypassing the agent
        // loop's dependency resolution), so ensure ffmpeg here first — it
        // self-installs silently and continues.
        await agent.cerebellum.ensureSystemTool('ffmpeg')
        // Conversation id rides the ALS scope (not the imperative global) so
        // this out-of-turn call can't clobber the conversation a concurrent
        // turn published.
        const transcribe = (): Promise<Awaited<ReturnType<typeof agent.cerebellum.executeTool>>> =>
          agent.cerebellum.runWithConversation(payload.conversationId ?? null, () =>
            agent.cerebellum.executeTool('stt_transcribe', {
              filePath: payload.filePath
            })
          )
        let result = await transcribe()
        // Belt-and-suspenders: if it still failed on ffmpeg (e.g. a stale PATH),
        // ensure once more and retry exactly once.
        if (!result.success && /ffmpeg/i.test(result.error ?? '')) {
          await agent.cerebellum.ensureSystemTool('ffmpeg')
          result = await transcribe()
        }
        if (!result.success) {
          // Keep the toast to one line — collapse the multi-line plugin message
          // (which spells out manual brew/winget steps) into a short summary.
          const raw = result.error ?? 'Transcription failed'
          const error = /ffmpeg/i.test(raw)
            ? 'Couldn’t set up ffmpeg automatically — please install it and try again.'
            : raw.split('\n')[0]
          return { ok: false, error }
        }
        const raw = result.output ?? ''
        const match =
          raw.match(/"transcript"\s*:\s*"([^"]*)"/) ?? raw.match(/"text"\s*:\s*"([^"]*)"/)
        const transcript = match ? match[1] : raw.replace(/[{}"\n]/g, '').trim()
        if (!transcript) {
          return { ok: false, error: 'Transcription returned empty' }
        }
        // Whisper's detected language (ISO 639-1) — surfaced so the renderer
        // can tag the <voice_note lang="…"> history entry, giving the model a
        // deterministic reply-language signal instead of guessing.
        const language = raw.match(/"language"\s*:\s*"([^"]*)"/)?.[1] ?? ''
        return { ok: true, transcript, language }
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

  // Local voice-engine provisioning, surfaced to the Settings panels so users
  // can install Kokoro (TTS) / faster-whisper (STT) on demand with a progress
  // bar — and so the panels can gate voice/model selection until ready. Install
  // is idempotent and converges with the plugins' lazy first-use install.
  ipcMain.handle('tts:installStatus', (): Promise<EngineStatus> => ttsStatus())
  ipcMain.handle('tts:getInstallState', (): EngineRuntimeState => getTtsInstallState())
  ipcMain.handle('stt:getInstallState', (): EngineRuntimeState => getSttInstallState())
  // Progress (and the terminal 'done') is BROADCAST to every window, not just
  // the invoking sender. A panel that remounted mid-install — or a renderer that
  // fully reloaded (its original sender is now dead) — must still receive live
  // updates and the terminal signal, otherwise it can stick on "Installing".
  // The terminal 'done' fires after the install settles (success OR failure), so
  // a non-initiating panel also stops showing "Installing" (idempotent duplicate
  // on the success path, which already emits its own 'done').
  const broadcastEngineProgress = (channel: string, payload: EngineInstallProgress): void => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(channel, payload)
    }
  }
  ipcMain.handle('tts:install', async (): Promise<EngineInstallResult> => {
    const res = await installTts(
      (p: EngineInstallProgress) => broadcastEngineProgress('tts:installProgress', p),
      { ensureFfmpeg: () => agent.cerebellum.ensureSystemTool('ffmpeg').then(() => undefined) }
    )
    broadcastEngineProgress('tts:installProgress', { phase: 'done', percent: 100 })
    return res
  })
  ipcMain.handle('stt:installStatus', (): Promise<EngineStatus> => sttStatus())
  ipcMain.handle('stt:install', async (): Promise<EngineInstallResult> => {
    const res = await installStt((p: EngineInstallProgress) =>
      broadcastEngineProgress('stt:installProgress', p)
    )
    broadcastEngineProgress('stt:installProgress', { phase: 'done', percent: 100 })
    return res
  })

  // Real Kokoro preview for the TTS panel: synthesize a short sample with the
  // selected voice/speed and hand back the audio file path for the renderer to
  // play. Gated in the UI behind an installed engine, so this is fast.
  ipcMain.handle(
    'tts:preview',
    async (
      _e,
      payload: { text?: string; voice?: string; speed?: string }
    ): Promise<{ ok: true; filePath: string } | { ok: false; error: string }> => {
      try {
        await agent.cerebellum.ensureSystemTool('ffmpeg')
        const result = await agent.cerebellum.executeTool('voice_generate', {
          text: payload.text?.trim() || 'Hello! This is a preview of how this voice sounds.',
          voice: payload.voice,
          speed: payload.speed
        })
        if (!result.success) {
          return { ok: false, error: (result.error ?? 'Preview failed').split('\n')[0] }
        }
        const raw = result.output ?? ''
        // voice_generate returns pure JSON; JSON.parse unescapes Windows paths
        // natively. Fall back to a regex only if the shape ever changes.
        let filePath: string | undefined
        try {
          filePath = (JSON.parse(raw) as { filePath?: string }).filePath
        } catch {
          filePath = raw.match(/"filePath"\s*:\s*"([^"]*)"/)?.[1]?.replace(/\\\\/g, '\\')
        }
        if (!filePath) return { ok: false, error: 'Preview produced no audio' }
        return { ok: true, filePath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
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
    // app.exit() below skips before-quit/will-quit, so MCP children must
    // be torn down here or they survive into the relaunched instance.
    await mcpManager.stop().catch(() => undefined)
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

  // Import a user-supplied capability (SKILL.md / folder / .zip) into
  // brain/cerebellum/. Validation + staging + copy all happen in the
  // importCapability module; on success the renderer calls cerebellum:reload
  // to pick up the new folder and refresh the list.
  ipcMain.handle('cerebellum:importCapability', async (_e, sourcePath: string) => {
    await agent.init()
    const existingNames = new Set(agent.cerebellum.getCapabilities().map((c) => c.name))
    return importCapability({
      sourcePath,
      cerebellumDir: join(workspaceRoot(), 'brain', 'cerebellum'),
      existingNames
    })
  })

  // Native picker for the import dropzone's "browse" affordance. On macOS the
  // dialog accepts a file (SKILL.md/.zip) or a folder; on Windows only files
  // (folders still arrive via drag-and-drop). Returns null when canceled.
  ipcMain.handle(
    'cerebellum:pickImport',
    async (_e, options?: { title?: string; filterName?: string }): Promise<string | null> => {
      const mainWin = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!mainWin) return null
      // Labels are localized in the renderer and passed in; English fallbacks
      // keep the dialog sane if the call ever arrives without them.
      const result = await dialog.showOpenDialog(mainWin, {
        title: options?.title ?? 'Import capability',
        properties: ['openFile', 'openDirectory'],
        filters: [{ name: options?.filterName ?? 'Capability', extensions: ['md', 'zip'] }]
      })
      if (result.canceled || !result.filePaths[0]) return null
      return result.filePaths[0]
    }
  )

  // Delete a user-imported capability — cleanly nuke its folder. Official
  // (bundled) and built-in in-process capabilities are refused so a stray
  // click can't wipe a core feature. A path-containment guard ensures we only
  // ever remove a direct child of brain/cerebellum/, never a folder reached
  // through a crafted path. Returns the refreshed list on success.
  ipcMain.handle('cerebellum:deleteCapability', async (_e, name: string) => {
    await agent.init()
    const cap = agent.cerebellum.getCapabilities().find((c) => c.name === name)
    if (!cap) return { ok: false as const, error: `Capability "${name}" not found.` }

    const bundled = await bundledCapabilityNames()
    const outcome = await deleteCapabilityFolder({
      name,
      dir: cap.dir,
      cerebellumDir: join(workspaceRoot(), 'brain', 'cerebellum'),
      isOfficial: bundled.has(name),
      isInProcess: Boolean(cap.inProcess)
    })
    if (!outcome.ok) return outcome

    // Forget any disabled-toggle for the gone capability, then reload so the
    // in-memory cerebellum (and the plugin's destroy hook) reflect the removal.
    await patchConfig((c) => ({
      ...c,
      disabledCapabilities: (c.disabledCapabilities ?? []).filter((n) => n !== name)
    }))
    await agent.cerebellum.reload()
    const cfg = await readConfig()
    agent.cerebellum.setDisabled(cfg?.disabledCapabilities ?? [])
    return { ok: true as const, capabilities: await serializeCapabilities() }
  })

  // Capability-management bridge handed to the `skills` capability's plugin
  // via its init context. Every method mirrors a `cerebellum:*` IPC handler
  // above so the agent manages skills through the exact same atomic config
  // writes, official-capability guards, and reload path the settings panel
  // uses — there is one implementation of "disable a skill", not two.
  agent.cerebellum.setPluginHost({
    listCapabilities: async () => {
      const bundled = await bundledCapabilityNames()
      return agent.cerebellum.getCapabilities().map((c) => ({
        name: c.name,
        description: c.description,
        triggers: c.triggers.keywords,
        tools: c.tools.map((t) => ({ name: t.name, description: t.description })),
        hasPlugin: c.hasPlugin,
        status: c.status,
        enabled: !agent.cerebellum.isDisabled(c.name),
        official: Boolean(c.inProcess) || bundled.has(c.name),
        inProcess: Boolean(c.inProcess),
        dir: c.dir,
        error: c.error
      }))
    },
    setCapabilityEnabled: async (name, enabled) => {
      const cfg = await readConfig()
      const disabled = new Set(cfg?.disabledCapabilities ?? [])
      if (enabled) disabled.delete(name)
      else disabled.add(name)
      const list = [...disabled]
      await patchConfig((c) => ({ ...c, disabledCapabilities: list }))
      agent.cerebellum.setDisabled(list)
    },
    deleteCapability: async (name) => {
      const cap = agent.cerebellum.getCapabilities().find((c) => c.name === name)
      if (!cap) return { ok: false, error: `Capability "${name}" not found.` }
      const bundled = await bundledCapabilityNames()
      const outcome = await deleteCapabilityFolder({
        name,
        dir: cap.dir,
        cerebellumDir: join(workspaceRoot(), 'brain', 'cerebellum'),
        isOfficial: bundled.has(name),
        isInProcess: Boolean(cap.inProcess)
      })
      if (!outcome.ok) return outcome
      await patchConfig((c) => ({
        ...c,
        disabledCapabilities: (c.disabledCapabilities ?? []).filter((n) => n !== name)
      }))
      await agent.cerebellum.reload()
      const cfg = await readConfig()
      agent.cerebellum.setDisabled(cfg?.disabledCapabilities ?? [])
      return { ok: true }
    },
    importCapability: async (sourcePath) => {
      const existingNames = new Set(agent.cerebellum.getCapabilities().map((c) => c.name))
      return importCapability({
        sourcePath,
        cerebellumDir: join(workspaceRoot(), 'brain', 'cerebellum'),
        existingNames
      })
    },
    reload: async () => {
      await agent.cerebellum.reload()
      const cfg = await readConfig()
      agent.cerebellum.setDisabled(cfg?.disabledCapabilities ?? [])
    }
  })

  // Automation-management bridge handed to the `automations` capability's
  // plugin via its init context. Every method runs over the live Brainstem so
  // the agent edits the same heartbeat.md the scheduler reads, validates a
  // schedule with the exact parser that registers it, and reloads through the
  // one serialized path the file-watcher uses — there is one source of truth
  // for "what automations exist and when they fire", not two.
  const heartbeatPath = (): string => join(workspaceRoot(), 'brain', 'brainstem', 'heartbeat.md')
  const snapshotAutomations = (): import('@main/runtime/cerebellum').AutomationJobInfo[] => {
    const running = agent.brainstem.getRunningJob()
    const statuses = agent.brainstem.getJobStatuses()
    return agent.brainstem.getActiveJobs().map((j) => {
      const preview = previewSchedule(j.label)
      const status = statuses[j.label]
      return {
        id: j.id,
        kind: j.type,
        cron: j.cron,
        label: j.label,
        body: j.body,
        human: preview.ok ? preview.human : '(unrecognized schedule)',
        running: running?.id === j.id,
        lastRunAt: status?.lastRunAt ?? null,
        lastStatus: status?.lastStatus ?? null,
        ...(status?.lastError ? { lastError: status.lastError } : {}),
        mode: j.mode
      }
    })
  }
  agent.cerebellum.setAutomationsHost({
    getGlobalMode: async () =>
      (await readConfig().catch(() => null))?.llm.mode === 'workflow' ? 'workflow' : 'single',
    readHeartbeat: async () => {
      const { readFile } = await import('node:fs/promises')
      try {
        return await readFile(heartbeatPath(), 'utf8')
      } catch {
        return ''
      }
    },
    writeHeartbeat: async (raw) => {
      try {
        await diskWriter.writeFileAtomic(heartbeatPath(), raw)
      } catch (err) {
        return {
          ok: false,
          jobs: snapshotAutomations(),
          error: err instanceof Error ? err.message : String(err)
        }
      }
      // Apply live in the same turn rather than waiting on the chokidar watcher,
      // so the agent can verify the new job list immediately. The watcher's
      // own reload on this write is harmless — reloadScheduler is serialized.
      await agent.brainstem.reloadScheduler()
      return { ok: true, jobs: snapshotAutomations() }
    },
    listJobs: () => snapshotAutomations(),
    previewSchedule: (heading) => previewSchedule(heading),
    getRunningJob: () => agent.brainstem.getRunningJob(),
    runJobNow: (idOrLabel) => agent.brainstem.runJobNow(idOrLabel)
  })

  // Procedures — the same store the renderer/IPC use, plus a detached run that
  // fires a procedure's prompt through the Brainstem's single-flight queue so it
  // runs exactly like a triggered automation (sealed conversation, in history).
  agent.cerebellum.setProceduresHost({
    list: () => listProcedures(),
    create: (title, prompt) => createProcedure({ title, prompt }),
    update: (id, patch) => updateProcedure({ id, ...patch }),
    delete: async (id) => {
      await deleteProcedure(id)
      return { ok: true as const }
    },
    run: async (id) => {
      const proc = (await listProcedures()).find((p) => p.id === id)
      if (!proc) return { ok: false, started: false, error: 'Procedure not found.' }
      if (proc.prompt.trim().length === 0) {
        return {
          ok: false,
          started: false,
          error: `Procedure "${proc.title}" has no prompt to run.`
        }
      }
      return agent.brainstem.runDetached(
        proc.prompt,
        proc.title || 'Procedure',
        `procedure:${proc.id}`,
        proc.mode ?? null
      )
    }
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
  ipcMain.handle('voice:revealInFolder', (_e, filePath: string): { ok: boolean } => {
    if (!filePath) return { ok: false }
    shell.showItemInFolder(filePath)
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
            'html',
            'htm',
            'mp3',
            'wav',
            'ogg',
            'm4a',
            'flac',
            'webm',
            'mp4',
            'mov',
            'avi',
            'mkv',
            'm4v',
            'wmv',
            'flv'
          ]
        },
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
        {
          name: 'Documents',
          extensions: [
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
            'html',
            'htm'
          ]
        },
        { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'webm'] },
        { name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'm4v', 'wmv', 'flv'] },
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

  // Stat a path the assistant mentioned in chat so the renderer can decide
  // whether to show a card (and which kind). Resolves a leading ~. Not
  // workspace-scoped: assistant-referenced paths live anywhere on the user's
  // own machine, and this only reads existence/type, never contents.
  ipcMain.handle(
    'upload:statPath',
    async (_e, p: string): Promise<{ exists: boolean; isDirectory: boolean }> => {
      const abs = resolveDevicePath(p)
      if (!abs) return { exists: false, isDirectory: false }
      try {
        const { stat } = await import('node:fs/promises')
        const st = await stat(abs)
        return { exists: true, isDirectory: st.isDirectory() }
      } catch {
        return { exists: false, isDirectory: false }
      }
    }
  )

  // List the immediate (top-level) contents of a directory so the chat can
  // attach a working folder's structure to each turn's context. Resolves a
  // leading ~. Not workspace-scoped — working folders are arbitrary absolute
  // paths the user picked. Directories sort first, then alphabetical; the entry
  // count is capped so a huge directory can't blow up the prompt.
  ipcMain.handle(
    'upload:listFolder',
    async (
      _e,
      p: string
    ): Promise<{
      entries: { name: string; isDirectory: boolean }[]
      truncated: boolean
      omittedDirectories?: number
      omittedFiles?: number
      error?: string
    }> => {
      const abs = resolveDevicePath(p)
      if (!abs) return { entries: [], truncated: false, error: 'invalid path' }
      try {
        const { readdir } = await import('node:fs/promises')
        const dirents = await readdir(abs, { withFileTypes: true })
        const sorted = dirents
          .map((d) => ({ name: d.name, isDirectory: d.isDirectory() }))
          .sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
            return a.name.localeCompare(b.name)
          })
        const LIMIT = 200
        const omitted = sorted.slice(LIMIT)
        const omittedDirectories = omitted.filter((e) => e.isDirectory).length
        return {
          entries: sorted.slice(0, LIMIT),
          truncated: omitted.length > 0,
          omittedDirectories,
          omittedFiles: omitted.length - omittedDirectories
        }
      } catch (err) {
        return {
          entries: [],
          truncated: false,
          error: err instanceof Error ? err.message : String(err)
        }
      }
    }
  )

  // Reveal a path in the OS file manager: a directory opens directly, a file is
  // revealed in its parent folder (selected), like "Reveal in Finder". Resolves
  // a leading ~. Intentionally not workspace-scoped — see statPath.
  ipcMain.handle(
    'upload:revealPath',
    async (_e, p: string): Promise<{ ok: boolean; error?: string }> => {
      const abs = resolveDevicePath(p)
      if (!abs) return { ok: false, error: 'invalid path' }
      try {
        const { stat } = await import('node:fs/promises')
        const st = await stat(abs)
        if (st.isDirectory()) {
          const error = await shell.openPath(abs)
          if (error) return { ok: false, error }
        } else {
          shell.showItemInFolder(abs)
        }
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

  // Save a copy of a device path (a file the assistant read/wrote anywhere on
  // the user's machine) to a location the user picks. Device counterpart to
  // upload:download — intentionally not workspace-scoped, same as revealPath.
  ipcMain.handle(
    'upload:downloadPath',
    async (_e, p: string): Promise<{ ok: boolean; error?: string }> => {
      const abs = resolveDevicePath(p)
      if (!abs) return { ok: false, error: 'invalid path' }
      const mainWin = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!mainWin) return { ok: false, error: 'no window' }
      try {
        const { stat } = await import('node:fs/promises')
        const st = await stat(abs)
        if (!st.isFile()) return { ok: false, error: 'not a file' }
        const { basename, resolve } = await import('node:path')
        const result = await dialog.showSaveDialog(mainWin, { defaultPath: basename(abs) })
        if (result.canceled || !result.filePath) return { ok: false }
        // Saving back onto the source is a no-op — skip the copy so we never
        // risk clobbering the original (the file is already where they asked).
        if (resolve(result.filePath) === resolve(abs)) return { ok: true }
        const { copyFile } = await import('node:fs/promises')
        await copyFile(abs, result.filePath)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('upload:revealInFolder', (_e, relativePath: string): { ok: boolean } => {
    const abs = resolveUploadPath(relativePath)
    if (!abs) return { ok: false }
    shell.showItemInFolder(abs)
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
    if (is.dev || updateInstallInProgress) return
    // Bail before tearing anything down if there's no verified artifact —
    // otherwise a failed arm would force-exit the app with nothing installed.
    // installUpdate() surfaces the error to the renderer so it can recover.
    if (!isUpdateReady()) {
      installUpdate()
      return
    }
    updateInstallInProgress = true
    // Broadcast 'installing' so a panel remounted during the grace window
    // (page navigation) restores the disabled state instead of re-enabling.
    markInstalling()
    await stampPreUpdateVersion()
    void shutdownGracefully()
    // Grace period: let in-flight work finish, then force through
    await new Promise((resolve) => setTimeout(resolve, 4_000))
    quitInProgress = false
    installUpdate()
    // Safety net: force exit if quitAndInstall silently failed
    setTimeout(() => {
      wlog.warn('[updater]', 'quitAndInstall did not exit — forcing')
      if (lockAcquired) {
        releaseLockSync(lockfilePath())
        lockAcquired = false
      }
      app.exit(0)
    }, 5_000)
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

  ipcMain.handle('viewer:revealInFolder', (_e, relativePath: string): { ok: boolean } => {
    const abs = resolveViewerPath(relativePath)
    if (!abs) return { ok: false }
    shell.showItemInFolder(abs)
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

  // Run an automation on demand from the Heartbeat page's run button. Goes
  // through the same FIFO queue a cron fire uses, so it serializes with
  // scheduled runs and coalesces if the job is already running or queued.
  ipcMain.handle('heartbeat:runJob', (_event, idOrLabel: string) => {
    return agent.brainstem.runJobNow(idOrLabel)
  })

  agent.brainstem.setListener({
    onJobStarted: (info) => broadcast('heartbeat:jobStarted', info),
    onJobEnded: (payload) => broadcast('heartbeat:jobEnded', payload),
    onJobLog: (entry) => broadcast('heartbeat:jobLog', entry)
  })

  // Procedures — saved prompts the user runs on demand from the Procedures page.
  // Plain CRUD over a JSON file; the renderer re-fetches after each mutation, so
  // there are no push events to broadcast (unlike heartbeat's job lifecycle).
  ipcMain.handle('procedures:list', () => listProcedures())
  ipcMain.handle(
    'procedures:create',
    (_event, payload: { title: string; prompt: string; mode?: 'single' | 'workflow' }) =>
      createProcedure(payload)
  )
  ipcMain.handle(
    'procedures:update',
    (
      _event,
      payload: { id: string; title?: string; prompt?: string; mode?: 'single' | 'workflow' }
    ) => updateProcedure(payload)
  )
  ipcMain.handle('procedures:delete', async (_event, id: string) => {
    await deleteProcedure(id)
    return { ok: true as const }
  })

  // Memory reindex — the cortex search index is rebuilt from scratch after an
  // app update (and on launch). On a large workspace that takes a while, so we
  // surface a blocking overlay with live progress, mirroring the heartbeat one.
  ipcMain.handle('reindex:getStatus', () => agent.cortex.getReindexStatus())
  agent.corpus.on('index.reindexStarted', (p) => broadcast('reindex:started', p))
  agent.corpus.on('index.reindexProgress', (p) => broadcast('reindex:progress', p))
  agent.corpus.on('index.reindexed', (p) => broadcast('reindex:ended', p))

  // Conversations
  ipcMain.handle('conversation:list', async (): Promise<ConversationMeta[]> => {
    // Fast path: the cortex conversations table answers in <1ms vs the
    // legacy JSON.parse-every-file scan (~140ms today, linear in history).
    // Fall back to the scan when the index is cold/empty (first boot,
    // rebuild in flight) so History is never blank.
    try {
      // A full rebuild DELETEs the conversations table then re-inserts in
      // event-loop-yielded batches — mid-rebuild the table is non-empty but
      // INCOMPLETE, and the >0-rows check below would happily return the
      // partial list. Prefer the disk scan for the rebuild's duration
      // (~140ms per call, rare: schema bumps + explicit rebuilds only).
      if (agent.cortex.getReindexStatus()) return listConversations()
      const rows = agent.cortex.listConversations({ limit: 500 })
      if (rows.length > 0) {
        return rows.map((r) => ({
          id: r.id,
          title: r.title,
          updatedAt: r.updatedAt,
          channel: r.channel as ConversationMeta['channel'],
          messageCount: r.messageCount
        }))
      }
    } catch {
      // index not ready — fall through
    }
    return listConversations()
  })
  ipcMain.handle(
    'conversation:load',
    (_e, id: string): Promise<ConversationFile | null> => loadConversation(id)
  )
  ipcMain.handle('conversation:save', (_e, conv: ConversationFile): Promise<{ ok: true }> => {
    return trackBackgroundTask(async () => {
      // Titling is done up front by the TurnRunner (a pure LLM call that
      // persists the title before processing), so there's nothing to generate
      // here — just persist. Merge-write: the renderer's copy owns
      // messages/stats, but the disk holds the LLM title and any rolling
      // summary the summarizer advanced since the renderer last synced — a
      // blind whole-file save would clobber those.
      let effectiveTitle = conv.title
      await updateConversation(conv.id, (disk) => {
        const merged = mergeConversationOnto(disk, conv)
        effectiveTitle = merged.title
        return merged
      })
      extensionServer.updateTitle(conv.id, effectiveTitle)
      // Post-persist rolling-summary check (fire-and-forget). When it writes
      // a summary, the onUpdated push folds it into the renderer's in-memory
      // conversation so the NEXT whole-file save keeps it.
      queueConversationSummarization(conv.id)
      return { ok: true as const }
    })
  })
  ipcMain.handle('conversation:delete', async (_e, id: string): Promise<{ ok: boolean }> => {
    // Deleting a conversation whose turn is still running would race the
    // end-of-turn persist and resurrect the file (or strand a live stream
    // with no home). The sidebar disables delete for processing rows; this
    // is the authoritative backstop.
    if (turnRunner.isConversationActive(id)) {
      return { ok: false }
    }
    await deleteConversation(id)
    agent.corpus.emit('conversation.deleted', { id })
    return { ok: true }
  })
  ipcMain.handle(
    'conversation:create',
    (_e, model: string | null): ConversationFile => createConversation(model)
  )

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

  ipcMain.handle('ollama:scanAvailable', async () => {
    const cfg = await readConfig()
    const folder = cfg?.ollamaModelsFolder || defaultModelsFolder()
    const scanned = await scanModelManifests(folder)
    return enrichWithDetails(scanned)
  })

  ipcMain.handle('ollama:getModelsFolder', async () => {
    const cfg = await readConfig()
    return cfg?.ollamaModelsFolder || defaultModelsFolder()
  })

  ipcMain.handle('ollama:setModelsFolder', async (_e, folder: string) => {
    await patchConfig((c) => ({ ...c, ollamaModelsFolder: folder }))
    return { ok: true as const, folder }
  })

  ipcMain.handle('ollama:pickModelsFolder', async () => {
    const mainWin = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!mainWin) return null
    const result = await dialog.showOpenDialog(mainWin, {
      title: 'Select Ollama models folder',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
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
  // to allow image uploads. Cloud models go through the well-known-family
  // check in vision.ts (text-only APIs like DeepSeek reject image parts
  // with HTTP 400); for local Ollama we ask /api/show whether the model
  // declares a "vision" capability (cached in LocalProvider). Returns
  // false when no model is available at all so the renderer can dim the
  // upload button.
  ipcMain.handle(
    'model:capabilities',
    async (): Promise<{
      provider: string | null
      model: string | null
      supportsVision: boolean
      contextWindow: number
      compactionAt: number
    }> => {
      const contextWindow = await agent.thalamus.resolveActiveContextWindow()
      // Real auto-compaction trigger point for the active model, in tokens —
      // the meter draws it as a tick so the visible % and the compaction
      // trigger share one denominator story.
      const compactionAt = Math.floor(agent.thalamus.getContextBudget() * COMPACTION_THRESHOLD)
      const provider = agent.thalamus.getActiveProvider()
      if (!provider)
        return { provider: null, model: null, supportsVision: false, contextWindow, compactionAt }
      if (provider === 'local') {
        const model = agent.thalamus.getLocalModelName()
        const supportsVision = await agent.thalamus.localSupportsVision()
        return { provider, model, supportsVision, contextWindow, compactionAt }
      }
      const cloudProviders = agent.thalamus.getCloudProviders()
      const active = cloudProviders.find((p) => p.id === provider)
      const model = active?.model ?? null
      const supportsVision = model !== null && cloudModelSupportsVision(provider, model)
      return { provider, model, supportsVision, contextWindow, compactionAt }
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
      models: p.models,
      reasoningModels: p.reasoningModels
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
          await setCloudProvider({
            ...existing,
            models: result.models,
            reasoningModels: result.reasoningModels
          })
          const next = await readConfig()
          if (next?.llm.providers) {
            thalamus.setCloudProviders(next.llm.providers)
            thalamus.setBrain(next.llm.brain ?? null)
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
        reasoningModels?: string[]
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
        models: payload.models ?? existing?.models,
        reasoningModels: payload.reasoningModels ?? existing?.reasoningModels
      })
      thalamus.setCloudProviders(updated.llm.providers)
      thalamus.setBrain(updated.llm.brain ?? null)
      broadcast('provider:updated', { id: payload.id })
      return { ok: true }
    }
  )

  ipcMain.handle(
    'provider:remove',
    async (_e, id: CloudProviderConfig['id']): Promise<{ ok: true }> => {
      const updated = await removeCloudProvider(id)
      thalamus.setCloudProviders(updated.llm.providers)
      thalamus.setBrain(updated.llm.brain ?? null)
      broadcast('provider:updated', { id })
      return { ok: true }
    }
  )

  ipcMain.handle(
    'provider:setBrain',
    async (
      _e,
      brain: { providerId: CloudProviderConfig['id']; model: string } | null
    ): Promise<{ ok: true }> => {
      const updated = await persistBrain(brain)
      thalamus.setBrain(updated.llm.brain ?? null)
      // Broadcast so the Brain page, the chat mode switcher, and the
      // reasoning button all reflect the new Brain immediately.
      broadcast('provider:updated', { id: brain?.providerId ?? null })
      return { ok: true }
    }
  )

  ipcMain.handle(
    'provider:setMode',
    async (_e, mode: 'single' | 'workflow'): Promise<{ ok: true }> => {
      await persistMode(mode === 'workflow' ? 'workflow' : 'single')
      agent.setMode(mode === 'workflow' ? 'workflow' : 'single')
      broadcast('provider:updated', { id: null })
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
        history: ChatHistoryMessage[]
        conversationId?: string | null
        workingFolders?: string[]
        thinkingMode?: string
        modeOverride?: 'single' | 'workflow'
      }
    ) => electronChannel.send(e.sender, payload)
  )

  ipcMain.handle('chat:cancel', (_e, payload?: { conversationId?: string | null }) =>
    electronChannel.cancel(payload?.conversationId ?? null)
  )

  ipcMain.handle(
    'chat:approvalRespond',
    (_e, payload: { id: string; decision: ApprovalDecision }) =>
      electronChannel.respondApproval(payload)
  )

  ipcMain.handle('chat:askRespond', (_e, payload: { id: string; response: AskUserResponse }) =>
    electronChannel.respondAsk(payload)
  )

  // Export the current conversation as a paginated PDF. The renderer builds a
  // self-contained transcript HTML (content + print stylesheet); main renders
  // it in a hidden, script-less window and prints it via Chromium's print
  // pipeline — same engine as the browser's "Save as PDF", so page-break CSS
  // in the stylesheet drives clean pagination. The HTML goes through a temp
  // file because data: URLs cap out below real conversation sizes.
  ipcMain.handle(
    'chat:exportPdf',
    async (
      _e,
      payload: { html: string; fileName: string }
    ): Promise<{ ok: boolean; canceled?: boolean; error?: string }> => {
      const mainWin = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!mainWin) return { ok: false, error: 'no window' }
      const safeName = payload.fileName.replace(/[\\/:*?"<>|]/g, '-')
      const result = await dialog.showSaveDialog(mainWin, {
        defaultPath: join(app.getPath('downloads'), safeName),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }

      const { writeFile, unlink } = await import('node:fs/promises')
      const tmpPath = join(app.getPath('temp'), `wolffish-chat-export-${Date.now()}.html`)
      let printWin: BrowserWindow | null = null
      try {
        await writeFile(tmpPath, payload.html, 'utf8')
        printWin = new BrowserWindow({
          show: false,
          webPreferences: {
            javascript: false,
            nodeIntegration: false,
            contextIsolation: true
          }
        })
        await printWin.loadFile(tmpPath)
        const pdf = await printWin.webContents.printToPDF({
          pageSize: 'A4',
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate:
            '<div style="width:100%;text-align:center;font-family:Helvetica,Arial,sans-serif;font-size:8px;color:#9ca3af;">' +
            '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
          margins: { top: 0.55, bottom: 0.65, left: 0.55, right: 0.55 }
        })
        await writeFile(result.filePath, pdf)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        printWin?.destroy()
        void unlink(tmpPath).catch(() => undefined)
      }
    }
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
    const win = mainBrowserWindow()
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
  if (updateInstallInProgress) return
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
  // Last-resort synchronous sweep for stdio MCP children: the idle quit
  // path never runs the async drain, and Node does not kill children on
  // parent exit — a server that ignores stdin EOF would orphan.
  mcpManager.killAllSync()
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
