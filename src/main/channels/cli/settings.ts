/**
 * The settings surface the terminal renders — the same cards the desktop
 * panels show, described as data instead of as React.
 *
 * Three things already exist and are reused verbatim rather than restated:
 *
 *  1. CURRENT VALUES come from `buildConfigSnapshot()`, the phone's config
 *     snapshot. It already assembles every panel's state for a non-renderer
 *     client, with API keys masked to a recognizable prefix. A second reader
 *     would be a second thing to keep true.
 *  2. WRITES go through the app's own IPC channels — the exact handlers the
 *     desktop panels call. Nothing here writes config.json.
 *  3. LABELS AND DESCRIPTIONS come from the renderer's i18n bundle, so the
 *     terminal prints the same sentences the cards do, in the user's locale,
 *     Arabic included.
 *
 * What did NOT exist is the BINDING between those three — which label goes
 * with which value and which setter. That lived inside 26 React panels, and
 * this table is it, written once. A setting added here is immediately
 * readable, writable, and documented in the CLI.
 *
 * List-shaped state (providers, capabilities, variables, MCP servers,
 * projects, procedures, automations) is deliberately NOT modelled here: a
 * table row is a poor way to edit a list, and each of those already has a
 * dedicated command with its own verbs.
 */

export type CliSettingKind = 'boolean' | 'enum' | 'number' | 'string' | 'secret'

export type CliSettingOption = {
  value: string
  /** i18n key for the option's label; falls back to `value` when absent. */
  i18n?: string
}

export type CliSetting = {
  /** What the user types: `wolffish config set wolffish.bypassPermissions on`. */
  id: string
  /** Groups rows under a heading — mirrors the desktop's settings tabs. */
  group: CliSettingGroup
  /** i18n prefix; `.label` and `.description` hang off it. */
  i18n: string
  kind: CliSettingKind
  options?: CliSettingOption[]
  /** Dot path into the config snapshot holding the current value. */
  read: string
  /** The IPC channel that writes it. */
  channel: string
  /**
   * How the value reaches the handler. `null` = passed bare
   * (`runtime:setLocalOnly(true)`); a string = wrapped in a one-key patch
   * (`telegram:setConfig({ verbose: true })`), which is how every `*:setConfig`
   * handler on the app takes a partial.
   */
  wrap: string | null
  /**
   * Reported next to the value but not writable from here — a setting whose
   * real state lives outside config.json. Only `launchAtStartup` has one
   * today: the intent is stored, the REGISTRATION is what actually matters,
   * and the two can disagree (see the autostart module).
   */
  actualRead?: string
}

export type CliSettingGroup =
  | 'wolffish'
  | 'model'
  | 'appearance'
  | 'channels'
  | 'services'
  | 'knowledge'
  | 'updates'

const ON_OFF: CliSettingOption[] = [{ value: 'on' }, { value: 'off' }]

export const CLI_SETTINGS: CliSetting[] = [
  // ── Wolffish: runtime behavior ───────────────────────────────────────────
  {
    id: 'wolffish.launchAtStartup',
    group: 'wolffish',
    i18n: 'settings.wolffish.launchAtStartup',
    kind: 'boolean',
    read: 'preferences.launchAtStartup',
    actualRead: 'preferences.launchAtStartupActive',
    channel: 'runtime:setLaunchAtStartup',
    wrap: null
  },
  {
    id: 'wolffish.blockCredentials',
    group: 'wolffish',
    i18n: 'settings.wolffish.blockCredentials',
    kind: 'boolean',
    read: 'preferences.blockCredentials',
    channel: 'runtime:setBlockCredentials',
    wrap: null
  },
  {
    id: 'wolffish.bypassPermissions',
    group: 'wolffish',
    i18n: 'settings.wolffish.bypassPermissions',
    kind: 'boolean',
    read: 'preferences.bypassPermissions',
    channel: 'runtime:setBypassPermissions',
    wrap: null
  },
  {
    id: 'wolffish.restrictPowerfulModels',
    group: 'wolffish',
    i18n: 'settings.wolffish.restrictPowerfulModels',
    kind: 'boolean',
    read: 'llm.restrictPowerfulModels',
    channel: 'runtime:setRestrictPowerfulModels',
    wrap: null
  },
  {
    id: 'wolffish.weekStartsOn',
    group: 'wolffish',
    i18n: 'settings.wolffish.weekStartsOn',
    kind: 'enum',
    options: [
      { value: '1', i18n: 'settings.wolffish.weekStartsOn.monday' },
      { value: '0', i18n: 'settings.wolffish.weekStartsOn.sunday' }
    ],
    read: 'preferences.weekStartsOn',
    channel: 'runtime:setWeekStartsOn',
    wrap: null
  },

  // ── Model ────────────────────────────────────────────────────────────────
  {
    id: 'model.mode',
    group: 'model',
    i18n: 'chat.mode',
    kind: 'enum',
    options: [{ value: 'single' }, { value: 'workflow' }],
    read: 'llm.chatMode',
    channel: 'provider:setMode',
    wrap: null
  },
  {
    id: 'model.localOnly',
    group: 'model',
    i18n: 'chat.localOnly',
    kind: 'boolean',
    read: 'llm.localOnly',
    channel: 'runtime:setLocalOnly',
    wrap: null
  },

  // ── Appearance ───────────────────────────────────────────────────────────
  {
    id: 'appearance.theme',
    group: 'appearance',
    i18n: 'theme',
    kind: 'enum',
    options: [{ value: 'system' }, { value: 'light' }, { value: 'dark' }],
    read: 'preferences.theme',
    channel: 'theme:set',
    wrap: null
  },
  {
    id: 'appearance.locale',
    group: 'appearance',
    i18n: 'locale',
    kind: 'enum',
    options: [{ value: 'en' }, { value: 'ar' }],
    read: 'preferences.locale',
    channel: 'locale:set',
    wrap: null
  },

  // ── Channels ─────────────────────────────────────────────────────────────
  {
    id: 'channels.inapp.verbose',
    group: 'channels',
    i18n: 'settings.services.inapp.verbose',
    kind: 'boolean',
    read: 'channels.inapp.verbose',
    channel: 'inapp:setConfig',
    wrap: 'verbose'
  },
  {
    id: 'channels.cli.verbose',
    group: 'channels',
    i18n: 'settings.channels.cli.verbose',
    kind: 'boolean',
    read: 'channels.cli.verbose',
    channel: 'cli:setConfig',
    wrap: 'verbose'
  },
  {
    id: 'channels.telegram.enabled',
    group: 'channels',
    i18n: 'settings.services.telegram.status',
    kind: 'boolean',
    read: 'channels.telegram.enabled',
    channel: 'telegram:setConfig',
    wrap: 'enabled'
  },
  {
    id: 'channels.telegram.verbose',
    group: 'channels',
    i18n: 'settings.services.telegram.verbose',
    kind: 'boolean',
    read: 'channels.telegram.verbose',
    channel: 'telegram:setConfig',
    wrap: 'verbose'
  },
  {
    id: 'channels.telegram.autoRefresh',
    group: 'channels',
    i18n: 'settings.services.telegram.autoRefresh',
    kind: 'boolean',
    read: 'channels.telegram.autoRefresh',
    channel: 'telegram:setConfig',
    wrap: 'autoRefresh'
  },
  {
    id: 'channels.telegram.hideAutomations',
    group: 'channels',
    i18n: 'settings.services.telegram.hideAutomations',
    kind: 'boolean',
    read: 'channels.telegram.hideAutomations',
    channel: 'telegram:setConfig',
    wrap: 'hideAutomationsFromResume'
  },
  {
    id: 'channels.whatsapp.enabled',
    group: 'channels',
    i18n: 'settings.services.whatsapp.status',
    kind: 'boolean',
    read: 'channels.whatsapp.enabled',
    channel: 'whatsapp:setConfig',
    wrap: 'enabled'
  },
  {
    id: 'channels.whatsapp.verbose',
    group: 'channels',
    i18n: 'settings.services.whatsapp.verbose',
    kind: 'boolean',
    read: 'channels.whatsapp.verbose',
    channel: 'whatsapp:setConfig',
    wrap: 'verbose'
  },
  {
    id: 'channels.whatsapp.autoRefresh',
    group: 'channels',
    i18n: 'settings.services.whatsapp.autoRefresh',
    kind: 'boolean',
    read: 'channels.whatsapp.autoRefresh',
    channel: 'whatsapp:setConfig',
    wrap: 'autoRefresh'
  },
  {
    id: 'channels.whatsapp.hideAutomations',
    group: 'channels',
    i18n: 'settings.services.whatsapp.hideAutomations',
    kind: 'boolean',
    read: 'channels.whatsapp.hideAutomations',
    channel: 'whatsapp:setConfig',
    wrap: 'hideAutomationsFromResume'
  },
  {
    id: 'channels.mobile.notifications',
    group: 'channels',
    i18n: 'settings.mobile.notifications',
    kind: 'boolean',
    read: 'channels.mobile.notifications',
    channel: 'mobile:setNotifications',
    wrap: null
  },
  {
    id: 'channels.mobile.verbose',
    group: 'channels',
    i18n: 'settings.mobile.verbose',
    kind: 'boolean',
    read: 'channels.mobile.verbose',
    channel: 'mobile:setVerbose',
    wrap: null
  },

  // ── Services ─────────────────────────────────────────────────────────────
  {
    id: 'services.brave.enabled',
    group: 'services',
    i18n: 'settings.services.brave.status',
    kind: 'boolean',
    read: 'services.braveEnabled',
    channel: 'brave:setConfig',
    wrap: 'enabled'
  },
  {
    id: 'services.brave.apiKey',
    group: 'services',
    i18n: 'settings.services.brave.apiKey',
    kind: 'secret',
    read: 'services.braveApiKey',
    channel: 'brave:setConfig',
    wrap: 'apiKey'
  },
  {
    id: 'services.video.enabled',
    group: 'services',
    i18n: 'settings.services.video.status',
    kind: 'boolean',
    read: 'services.videoEnabled',
    channel: 'video:setConfig',
    wrap: 'enabled'
  },
  {
    id: 'services.video.apiKey',
    group: 'services',
    i18n: 'settings.services.video.apiKey',
    kind: 'secret',
    read: 'services.videoApiKey',
    channel: 'video:setConfig',
    wrap: 'apiKey'
  },
  {
    id: 'services.memes.giphyApiKey',
    group: 'services',
    i18n: 'settings.services.memes.giphy',
    kind: 'secret',
    read: 'services.memes.giphyApiKey',
    channel: 'memes:setConfig',
    wrap: 'giphy'
  },

  // ── Knowledge ────────────────────────────────────────────────────────────
  {
    id: 'knowledge.reflection.hour',
    group: 'knowledge',
    i18n: 'settings.knowledge.reflection.nightly',
    kind: 'number',
    read: 'reflection.hour',
    channel: 'runtime:setReflectionConfig',
    wrap: 'hour'
  },
  {
    id: 'knowledge.reflection.quietHours',
    group: 'knowledge',
    i18n: 'settings.knowledge.reflection.quiet',
    kind: 'number',
    read: 'reflection.quietHours',
    channel: 'runtime:setReflectionConfig',
    wrap: 'quietHours'
  },

  // ── Updates ──────────────────────────────────────────────────────────────
  {
    id: 'updates.enabled',
    group: 'updates',
    i18n: 'settings.updates.auto',
    kind: 'boolean',
    read: 'preferences.updatesEnabled',
    channel: 'runtime:setUpdatesEnabled',
    wrap: null
  }
]

export const CLI_SETTING_GROUPS: CliSettingGroup[] = [
  'wolffish',
  'model',
  'appearance',
  'channels',
  'services',
  'knowledge',
  'updates'
]

/** Read a dot path out of the snapshot. Missing anywhere yields undefined. */
export function readPath(source: unknown, dotted: string): unknown {
  let node: unknown = source
  for (const part of dotted.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

/**
 * Turn what a user typed into what the handler expects. Strict on booleans
 * (`on/off/true/false/yes/no/1/0`) and numbers, because a silently
 * misinterpreted setting is worse than a refusal — `--verbose maybe` should
 * fail loudly rather than quietly meaning `false`.
 */
export function coerceSettingValue(
  setting: CliSetting,
  raw: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  const text = raw.trim()
  switch (setting.kind) {
    case 'boolean': {
      if (/^(on|true|yes|y|1|enabled)$/i.test(text)) return { ok: true, value: true }
      if (/^(off|false|no|n|0|disabled)$/i.test(text)) return { ok: true, value: false }
      return { ok: false, error: `expected on or off, got "${text}"` }
    }
    case 'number': {
      const n = Number(text)
      if (!Number.isFinite(n)) return { ok: false, error: `expected a number, got "${text}"` }
      return { ok: true, value: n }
    }
    case 'enum': {
      const allowed = setting.options?.map((o) => o.value) ?? []
      if (!allowed.includes(text)) {
        return { ok: false, error: `expected one of ${allowed.join(', ')}, got "${text}"` }
      }
      // weekStartsOn is numeric on the wire but an enum to the user.
      if (setting.id === 'wolffish.weekStartsOn') return { ok: true, value: Number(text) }
      return { ok: true, value: text }
    }
    default:
      return { ok: true, value: text }
  }
}

/** Build the handler arguments for a write. */
export function settingArgs(setting: CliSetting, value: unknown): unknown[] {
  if (setting.wrap === null) return [value]
  return [{ [setting.wrap]: value }]
}

export const BOOLEAN_OPTIONS = ON_OFF
