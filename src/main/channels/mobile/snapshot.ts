/**
 * Builds the config snapshot the phone renders.
 *
 * The shape is `ConfigSnapshot` in wolffish-mobile (`src/state/demoConfig.ts`)
 * — the exact object demo mode already ingests. Serving the same shape live is
 * what lets every settings screen on the phone work in paired mode without a
 * single change: the phone calls `applySnapshot()` either way and cannot tell
 * a downloaded demo bundle from a live desktop.
 *
 * Every optional field in that contract is genuinely optional ("absent in
 * bundles published before X shipped"), so a section this builder cannot
 * resolve is omitted rather than faked, and the phone falls back to its
 * documented default instead of rendering an invented number.
 */
import type { Agent } from '@main/runtime/agent'
import { readConfig } from '@main/workspace/workspace'
import { app } from 'electron'

/** Mirrors wolffish-mobile's ConfigSnapshot. Kept structural on purpose: the
 * phone owns the canonical type, and over-typing it here would mean editing
 * two repos for every field the phone learns to render. */
export type ConfigSnapshot = Record<string, unknown>

/** Untyped JSON read from the workspace: every access goes through a coercion
 * helper below, so the shape is deliberately loose rather than a lie. */
type Cfg = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

type CapabilitySerializer = () => Promise<
  Array<{
    name: string
    description: string
    enabled: boolean
    official: boolean
    core: boolean
    hasPlugin: boolean
    toolCount: number
    requires: string[]
  }>
>

export type SnapshotSources = {
  agent: Agent
  /** index.ts already has this closure for the settings IPC; reuse it rather
   * than reaching into cerebellum a second way. */
  serializeCapabilities: CapabilitySerializer
  /** Optional extras — omitted from the snapshot when they throw or are absent. */
  dataAnalytics?: () => Promise<Record<string, unknown>>
  usageDays?: () => Promise<unknown[]>
  ollamaRunning?: () => Promise<boolean>
  ollamaModels?: () => Promise<string[]>
}

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback

const bool = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback

/** Never let one unavailable section fail the whole snapshot. */
async function attempt<T>(fn: (() => Promise<T>) | undefined): Promise<T | undefined> {
  if (!fn) return undefined
  try {
    return await fn()
  } catch {
    return undefined
  }
}

export async function buildConfigSnapshot(sources: SnapshotSources): Promise<ConfigSnapshot> {
  const config = ((await readConfig()) ?? {}) as Cfg
  const capabilities = await sources.serializeCapabilities().catch(() => [])

  const llm = (config.llm ?? {}) as Cfg
  const brain = (llm.brain ?? {}) as Cfg
  const local = (llm.local ?? {}) as Cfg
  const telegram = (config.telegram ?? {}) as Cfg
  const whatsapp = (config.whatsapp ?? {}) as Cfg
  const google = (config.google ?? {}) as Cfg
  const tts = (config.tts ?? {}) as Cfg
  const mcp = (config.mcp ?? {}) as Cfg
  const compaction = (config.compaction ?? {}) as Cfg
  const safety = (config.safety ?? {}) as Cfg

  const [data, usageDays, ollamaRunning, ollamaModels] = await Promise.all([
    attempt(sources.dataAnalytics),
    attempt(sources.usageDays),
    attempt(sources.ollamaRunning),
    attempt(sources.ollamaModels)
  ])

  const snapshot: Record<string, unknown> = {
    capabilities: capabilities.map((capability) => ({
      name: capability.name,
      description: capability.description,
      enabled: capability.enabled,
      official: capability.official,
      core: capability.core,
      hasPlugin: capability.hasPlugin,
      toolCount: capability.toolCount,
      requires: capability.requires
    })),

    // The phone renders name + enabled only; server definitions stay desktop-side.
    mcpServers: Object.entries((mcp.servers ?? {}) as Record<string, Cfg>).map(
      ([name, server]) => ({
        name,
        enabled: bool(server?.enabled, true)
      })
    ),

    variables: Object.entries((config.variables ?? {}) as Record<string, unknown>).map(
      ([key, value]) => ({ key, value: str(value) })
    ),

    services: {
      google: {
        status: google.refreshToken ? 'connected' : 'disconnected',
        projectId: str(google.projectId)
      },
      // Connection lists are desktop-managed; an absent integration is an
      // empty list rather than a missing key, so the phone renders "none".
      github: Array.isArray(config.github?.connections) ? config.github.connections : [],
      notion: Array.isArray(config.notion?.connections) ? config.notion.connections : [],
      braveEnabled: bool(config.brave?.enabled),
      memesEnabled: bool(config.memes?.enabled),
      sttModel: str(config.stt?.model, 'whisper-1'),
      ttsVoice: str(tts.voice),
      ttsSpeed: str(tts.speed, '1.0'),
      screenshotMaxWidth: str(config.screenshots?.maxWidth, '1280'),
      screenshotFormat: str(config.screenshots?.format, 'webp')
    },

    channels: {
      inapp: { verbose: bool(config.inapp?.verbose) },
      telegram: {
        enabled: bool(telegram.enabled),
        allowedUserIds: str(telegram.allowedUserIds),
        autoRefresh: bool(telegram.autoRefresh, true),
        staleHours: str(telegram.staleHours, '12'),
        verbose: bool(telegram.verbose),
        hideAutomations: bool(telegram.hideAutomations)
      },
      whatsapp: {
        enabled: bool(whatsapp.enabled),
        allowedNumbers: str(whatsapp.allowedNumbers),
        autoRefresh: bool(whatsapp.autoRefresh, true),
        staleHours: str(whatsapp.staleHours, '12'),
        verbose: bool(whatsapp.verbose),
        hideAutomations: bool(whatsapp.hideAutomations)
      }
    },

    llm: {
      brainProvider: str(brain.providerId),
      brainModel: str(brain.model),
      chatMode: str(llm.mode, 'single'),
      localOnly: bool(llm.localOnly),
      restrictPowerfulModels: bool(llm.restrictPowerfulModels, true),
      local: {
        enabled: bool(local.enabled),
        model: typeof local.model === 'string' ? local.model : null,
        ...(ollamaRunning === undefined ? {} : { running: ollamaRunning }),
        ...(ollamaModels === undefined ? {} : { models: ollamaModels })
      },
      // API keys never leave the desktop: the phone shows which providers exist
      // and which model each runs, never the credential.
      providers: (Array.isArray(llm.providers) ? llm.providers : []).map((provider: Cfg) => ({
        id: str(provider?.id),
        model: typeof provider?.model === 'string' ? provider.model : null,
        connected: Boolean(provider?.apiKey)
      }))
    },

    preferences: {
      launchAtStartup: bool(config.launchAtStartup, true),
      bypassPermissions: bool(safety.bypassPermissions),
      blockCredentials: bool(safety.blockCredentials, true),
      weekStartsOn: config.weekStartsOn === 1 ? 1 : 0,
      updatesEnabled: bool(config.updates?.enabled, true),
      ...(typeof config.ollamaModelsFolder === 'string'
        ? { ollamaModelsFolder: config.ollamaModelsFolder }
        : {})
    },

    desktop: {
      version: app.getVersion(),
      platform: process.platform,
      syncedAt: new Date().toISOString()
    },

    compaction: {
      dailyHour: typeof compaction.dailyHour === 'number' ? compaction.dailyHour : 3,
      weeklyDay: typeof compaction.weeklyDay === 'number' ? compaction.weeklyDay : 0,
      weeklyHour: typeof compaction.weeklyHour === 'number' ? compaction.weeklyHour : 4
    }
  }

  if (data) snapshot.data = data
  if (Array.isArray(usageDays)) snapshot.usage = { days: usageDays }

  if (Array.isArray(config.projects)) snapshot.projects = config.projects

  return snapshot
}
