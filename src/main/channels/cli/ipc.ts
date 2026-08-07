/**
 * The `cli:*` and `service:*` IPC channels — everything the terminal needs
 * that the desktop never did.
 *
 * Everything ELSE the CLI does goes through the app's existing 200-odd
 * handlers untouched (see ipc-registry). What lands here is only the work that
 * has no renderer equivalent: describing a setting as text, staging a file
 * from a path instead of a picker, running a turn without a WebContents, and
 * the two installers (autostart, PATH) that a windowless box needs and a
 * desktop never asked for.
 */
import type { CliChannel } from '@main/channels/cli/channel'
import type { CliServer } from '@main/channels/cli/server'
import {
  CLI_SETTINGS,
  coerceSettingValue,
  readPath,
  settingArgs,
  type CliSetting,
  type CliSettingGroup
} from '@main/channels/cli/settings'
import { autostartMechanism, isHeadlessHost, type AutostartMode } from '@main/autostart/autostart'
import {
  cliPathStatus,
  installCliPath,
  uninstallCliPath,
  type CliPathStatus
} from '@main/autostart/cli-path'
import type { MessageAttachmentType } from '@main/conversations'
import type { IpcHandler } from '@main/ipc-registry'
import type { ApprovalDecision } from '@main/runtime/amygdala'
import type { AskUserResponse } from '@main/runtime/cerebellum'
import { validateFile } from '@main/uploads/validation'
import { saveUploadFromFile } from '@main/uploads/uploads'
import { getCliConfig, localesPath, setCliConfig, type CliConfig } from '@main/workspace/workspace'
import { wlog } from '@main/workspace/logger'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const TAG = '[cli]'

/** One settings row, ready to print. */
export type CliSettingCard = {
  id: string
  group: CliSettingGroup
  kind: CliSetting['kind']
  label: string
  description: string
  /** Current value, straight from the config snapshot. */
  value: unknown
  /** Rendered form of `value` — enum labels resolved, secrets already masked. */
  display: string
  /**
   * For settings whose real state lives outside config.json: what is ACTUALLY
   * registered. Only launchAtStartup has one, and it is the whole reason the
   * Linux autostart bug was invisible for so long.
   */
  actual?: string | null
  options?: Array<{ value: string; label: string }>
}

type LocaleBundle = Record<string, unknown>

const localeCache = new Map<string, LocaleBundle>()

/**
 * Read one locale bundle off disk. Cached — the file is ~100 KB and a settings
 * listing would otherwise re-read it per row. English is the fallback for a
 * key a translation hasn't reached yet, exactly as i18next behaves.
 */
async function loadLocale(locale: string): Promise<LocaleBundle> {
  const cached = localeCache.get(locale)
  if (cached) return cached
  try {
    const raw = await fs.readFile(path.join(localesPath(), `${locale}.json`), 'utf8')
    const parsed = JSON.parse(raw) as LocaleBundle
    localeCache.set(locale, parsed)
    return parsed
  } catch {
    if (locale !== 'en') return loadLocale('en')
    return {}
  }
}

function lookup(bundle: LocaleBundle, dotted: string): string | null {
  const value = readPath(bundle, dotted)
  return typeof value === 'string' ? value : null
}

/**
 * Card text in the user's locale, falling back to English, then to the key's
 * own last segment. Strips the inline <cmd> markup a couple of labels carry
 * for the web renderer — a terminal wants the words, not the tags.
 */
function text(
  bundle: LocaleBundle,
  fallback: LocaleBundle,
  dotted: string,
  ifMissing: string
): string {
  const raw = lookup(bundle, dotted) ?? lookup(fallback, dotted) ?? ifMissing
  return raw.replace(/<\/?[a-z][^>]*>/gi, '')
}

function displayValue(
  setting: CliSetting,
  value: unknown,
  options?: CliSettingCard['options']
): string {
  if (value === undefined || value === null || value === '') return '—'
  if (setting.kind === 'boolean') return value === true ? 'On' : 'Off'
  if (setting.kind === 'enum') {
    const match = options?.find((o) => o.value === String(value))
    return match ? match.label : String(value)
  }
  return String(value)
}

export type CliIpcDeps = {
  handle: (channel: string, listener: IpcHandler) => void
  handlers: Map<string, IpcHandler>
  channel: CliChannel
  server: CliServer
  /** The phone's snapshot builder — the CLI's source for current values. */
  snapshot: () => Promise<Record<string, unknown>>
  /** Broadcast a config change, so open panels + the phone stay in step. */
  broadcast: (channel: string, payload: unknown) => void
  /** Everything `wolffish status` prints that isn't config. */
  status: () => Promise<Record<string, unknown>>
  /** Binary a service manager should launch, and the client entry it runs. */
  execPath: string
  cliEntry: string
  /**
   * The ONE autostart dispatcher, shared with the Wolffish tab's toggle. Each
   * call moves both halves together — the stored `launchAtStartup` intent and
   * the OS registration — and knows about the Electron login item, which the
   * autostart module deliberately does not.
   */
  autostart: {
    enable: () => Promise<AutostartFacts>
    disable: () => Promise<AutostartFacts>
    read: () => Promise<AutostartFacts>
  }
}

export type AutostartFacts = {
  active: boolean
  mechanism: string
  warning: string | null
  location: string | null
}

export function registerCliIpc(deps: CliIpcDeps): void {
  const { handle, channel, server } = deps

  // ── Settings, as printable cards ─────────────────────────────────────────
  handle('cli:describeSettings', async (_e, locale?: string): Promise<CliSettingCard[]> => {
    const snapshot = await deps.snapshot()
    const active = typeof locale === 'string' && locale.length > 0 ? locale : 'en'
    const bundle = await loadLocale(active)
    const fallback = active === 'en' ? bundle : await loadLocale('en')

    return CLI_SETTINGS.map((setting) => {
      const options = setting.options?.map((option) => ({
        value: option.value,
        label: option.i18n
          ? text(bundle, fallback, option.i18n, option.value)
          : option.value.charAt(0).toUpperCase() + option.value.slice(1)
      }))
      const value = readPath(snapshot, setting.read)
      const card: CliSettingCard = {
        id: setting.id,
        group: setting.group,
        kind: setting.kind,
        label: text(bundle, fallback, `${setting.i18n}.label`, setting.id),
        description: text(bundle, fallback, `${setting.i18n}.description`, ''),
        value,
        display: displayValue(setting, value, options),
        options
      }
      if (setting.actualRead) {
        const actual = readPath(snapshot, setting.actualRead)
        card.actual =
          actual === undefined
            ? null
            : actual === true
              ? text(bundle, fallback, 'settings.wolffish.launchAtStartup.active', 'Active')
              : text(bundle, fallback, 'settings.wolffish.launchAtStartup.inactive', 'Inactive')
      }
      return card
    })
  })

  /**
   * Write one setting by id. Routed to the SAME handler the desktop panel
   * calls, so a CLI write and a UI write are one code path — including the
   * broadcast that tells every other open surface.
   */
  handle(
    'cli:setSetting',
    async (
      _e,
      payload: { id: string; value: string }
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const setting = CLI_SETTINGS.find((s) => s.id === payload?.id)
      if (!setting) return { ok: false, error: `unknown setting: ${payload?.id}` }
      const coerced = coerceSettingValue(setting, String(payload.value ?? ''))
      if (!coerced.ok) return { ok: false, error: coerced.error }
      const handler = deps.handlers.get(setting.channel)
      if (!handler) return { ok: false, error: `no handler for ${setting.channel}` }
      try {
        await handler(null, ...settingArgs(setting, coerced.value))
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  /**
   * The raw config snapshot. `cli:describeSettings` covers the scalar rows;
   * this is for the list-shaped state a table can't model (which provider is
   * the Brain, connected services, capability roster).
   */
  handle('cli:snapshot', () => deps.snapshot())

  // ── The CLI channel's own preferences ────────────────────────────────────
  handle('cli:getConfig', (): Promise<CliConfig> => getCliConfig())
  handle('cli:setConfig', async (_e, patch: Partial<CliConfig>) => {
    await setCliConfig(patch ?? {})
    const config = await getCliConfig()
    deps.broadcast('cli:configChange', config)
    return { ok: true as const, config }
  })

  // ── Turns ────────────────────────────────────────────────────────────────
  handle(
    'cli:send',
    async (
      _e,
      payload: {
        text: string
        conversationId?: string | null
        attachmentPaths?: string[]
        workingFolders?: string[]
        projectId?: string | null
        thinkingMode?: 'off' | 'on' | 'high' | 'max'
        modeOverride?: 'single' | 'workflow'
      }
    ) => {
      const attachments = payload?.attachmentPaths?.length
        ? await stageAttachments(payload.attachmentPaths, payload.conversationId ?? null)
        : []
      return channel.send({
        text: String(payload?.text ?? ''),
        conversationId: payload?.conversationId ?? null,
        attachments,
        workingFolders: payload?.workingFolders,
        projectId: payload?.projectId ?? null,
        thinkingMode: payload?.thinkingMode,
        modeOverride: payload?.modeOverride
      })
    }
  )

  handle('cli:cancel', (_e, conversationId?: string | null) => channel.cancel(conversationId))

  handle('cli:approvalRespond', (_e, payload: { id: string; decision: ApprovalDecision }) => ({
    ok: channel.respondApproval(payload?.id, payload?.decision)
  }))

  handle('cli:askRespond', (_e, payload: { id: string; response: AskUserResponse }) => ({
    ok: channel.respondAsk(payload?.id, payload?.response)
  }))

  handle('cli:pendingRequests', () => channel.pendingRequests())

  /**
   * Stage a file the user named by path. This is the whole of "file upload" in
   * the CLI: the bytes are already on the machine the agent runs on, so the
   * work is a validated copy into the conversation's uploads folder — the same
   * one the composer's drag-and-drop performs.
   */
  handle(
    'cli:attach',
    async (
      _e,
      payload: { conversationId: string; paths: string[] }
    ): Promise<
      | { ok: true; attachments: Awaited<ReturnType<typeof stageAttachments>> }
      | { ok: false; error: string }
    > => {
      try {
        const attachments = await stageAttachments(payload.paths, payload.conversationId)
        return { ok: true, attachments }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // ── Status ───────────────────────────────────────────────────────────────
  handle('cli:status', async () => ({
    ...(await deps.status()),
    cli: {
      socket: server.isListening(),
      clients: server.clientCount(),
      pid: process.pid
    }
  }))

  // ── Autostart (the Linux fix, and the headless story everywhere) ─────────
  /**
   * Autostart. This panel and the Wolffish tab's "Launch at startup" toggle
   * are TWO CONTROLS OVER ONE REGISTRATION, so they share one dispatcher
   * (deps.autostart, defined in index.ts) rather than each reaching for the
   * autostart module directly. Two reasons, both learned the hard way:
   *
   *  - Only the dispatcher knows that a GUI install on macOS/Windows uses
   *    Electron's own login item, which lives outside this module entirely.
   *    Calling autostartStatus() straight would report "not registered" on a
   *    Mac whose login item is registered — a confident, wrong answer.
   *  - Both halves have to move together: the stored intent
   *    (`config.launchAtStartup`) AND the OS registration. Writing one leaves
   *    the two screens disagreeing, and the disagreement stays invisible until
   *    a reboot settles which was telling the truth.
   *
   * What genuinely belongs to THIS screen is `mode` — whether "start
   * automatically" means a login item (needs a desktop session, opens a
   * window) or a background service (starts with the machine, no session, no
   * window). That choice only matters to someone running headless.
   */
  handle('service:status', async () => {
    const mode = await runMode()
    return { ...(await deps.autostart.read()), mode }
  })

  handle('service:install', async (_e, requested?: AutostartMode) => {
    if (requested) await setCliConfig({ runMode: requested })
    const status = await deps.autostart.enable()
    return { ...status, mode: await runMode() }
  })

  handle('service:uninstall', async () => {
    const status = await deps.autostart.disable()
    return { ...status, mode: await runMode() }
  })

  /**
   * Change the mechanism without changing whether autostart is on. The old
   * registration is torn down BEFORE the new one is written, so switching
   * from a login item to a service unit can never leave both registered and
   * racing to launch the app twice.
   */
  handle('service:setMode', async (_e, mode: AutostartMode) => {
    const previous = await runMode()
    if (previous === mode) return { ...(await deps.autostart.read()), mode }
    const wasActive = (await deps.autostart.read()).active
    if (wasActive) await deps.autostart.disable()
    await setCliConfig({ runMode: mode })
    const status = wasActive ? await deps.autostart.enable() : await deps.autostart.read()
    return { ...status, mode }
  })

  /**
   * What each mode WOULD register on this machine, plus whether the host even
   * has a desktop session. The panel uses it to label the two choices with the
   * real mechanism (`launchd` / `systemd` / `schtasks`) instead of generic
   * words, and to recommend the service on a box with no display.
   */
  handle('service:mechanism', async () => ({
    gui: autostartMechanism('gui'),
    headless: autostartMechanism('headless'),
    current: autostartMechanism(await runMode()),
    headlessHost: isHeadlessHost()
  }))

  // ── PATH ─────────────────────────────────────────────────────────────────
  handle('cli:pathStatus', (): Promise<CliPathStatus> => cliPathStatus())
  handle('cli:installPath', async (): Promise<CliPathStatus> => {
    const status = await installCliPath(deps.execPath, deps.cliEntry)
    deps.broadcast('cli:pathChanged', status)
    return status
  })
  handle('cli:uninstallPath', async (): Promise<CliPathStatus> => {
    const status = await uninstallCliPath()
    deps.broadcast('cli:pathChanged', status)
    return status
  })
  handle('cli:entryPath', () => ({ execPath: deps.execPath, entry: deps.cliEntry }))

  wlog.info(TAG, 'ipc registered')
}

async function runMode(): Promise<AutostartMode> {
  const config = await getCliConfig()
  return config.runMode === 'headless' ? 'headless' : 'gui'
}

/**
 * Validate then copy each path into the conversation's uploads folder.
 * Validation is the same call the composer makes, so the CLI inherits the
 * per-message file count and byte ceilings rather than inventing its own.
 */
async function stageAttachments(
  paths: string[],
  conversationId: string | null
): Promise<
  Array<{
    type: MessageAttachmentType
    filePath: string
    originalName: string
    mimeType: string
    sizeBytes: number
  }>
> {
  if (!conversationId) throw new Error('conversationId is required to attach files')
  const staged: Array<{
    type: MessageAttachmentType
    filePath: string
    originalName: string
    mimeType: string
    sizeBytes: number
  }> = []
  let totalBytes = 0
  for (const raw of paths) {
    const absolute = resolveUserPath(raw)
    const stat = await fs.stat(absolute)
    if (!stat.isFile()) throw new Error(`not a file: ${absolute}`)
    const invalid = validateFile(path.basename(absolute), stat.size, staged.length, totalBytes)
    if (invalid) throw new Error(`${path.basename(absolute)}: ${invalid.code}`)
    const meta = await saveUploadFromFile(conversationId, absolute, path.basename(absolute))
    totalBytes += meta.sizeBytes
    staged.push({
      type: meta.type,
      filePath: meta.filePath,
      originalName: meta.originalName,
      mimeType: meta.mimeType,
      sizeBytes: meta.sizeBytes
    })
  }
  return staged
}

/** Accept `~/…` and relative paths the way every other Wolffish path input does. */
function resolveUserPath(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  return path.resolve(trimmed)
}
