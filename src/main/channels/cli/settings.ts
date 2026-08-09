/**
 * Every scalar setting the desktop panels expose, described as data.
 *
 * Three things already exist and are reused verbatim rather than restated:
 *
 *  1. CURRENT VALUES come from `buildConfigSnapshot()`, the phone's config
 *     snapshot. It already assembles every panel's state for a non-renderer
 *     client. A second reader would be a second thing to keep true.
 *  2. WRITES go through the app's own IPC channels — the exact handlers the
 *     desktop panels call. Nothing here writes config.json.
 *  3. LABELS come from the renderer's i18n bundle, so the terminal prints the
 *     same sentences the cards do, in the user's locale, Arabic included.
 *     `fallback` covers the rows whose panel renders a label inline and has no
 *     key of its own — better an English word than a raw id.
 *
 * What did NOT exist is the BINDING between those three. That table is this
 * file. A setting added here is immediately listable, readable, writable and
 * documented in the CLI, with no further wiring.
 *
 * THE SHAPE IS THE WINDOW'S SHAPE: page → card → row. The desktop nav has a
 * tab (`CLI_SETTING_GROUPS`), the tab has cards (`CLI_SETTING_SECTIONS`), and
 * a card holds rows. Flattening that away is not a simplification — it is what
 * produced a terminal listing with "Verbose task results" four times and no
 * way to tell which was Telegram's. Labels are card-scoped in the app
 * ("Status" inside a Telegram card is unambiguous), so a row's label is only
 * meaningful UNDER ITS SECTION, and `fallback` no longer repeats the channel
 * name the section heading already prints.
 *
 * LIST-SHAPED state is deliberately absent: providers and their keys, local
 * models, capabilities, variables, MCP servers, Notion/GitHub/Google
 * connections, channel pairing. A table row is a poor way to edit a list, and
 * each of those has an interactive flow instead (see the CLI's ACTIONS, which
 * are registered against these same group + section ids so they land on the
 * card the user is already looking at).
 */

export type CliSettingKind = 'boolean' | 'enum' | 'number' | 'string' | 'secret'

export type CliSettingOption = {
  value: string
  /** i18n key for the option's label; falls back to a title-cased value. */
  i18n?: string
  label?: string
}

export type CliSetting = {
  /** What the user types: `wolffish settings set wolffish.bypassPermissions on`. */
  id: string
  group: CliSettingGroup
  /** The card this row sits in — a `CLI_SETTING_SECTIONS` id. */
  section: string
  /** i18n prefix; `.label` and `.description` hang off it. */
  i18n: string
  /** Used when the i18n key does not exist — many panels label inline. */
  fallback: string
  kind: CliSettingKind
  options?: CliSettingOption[]
  /** Dot path into the config snapshot holding the current value. */
  read: string
  /** The IPC channel that writes it. */
  channel: string
  /**
   * How the value reaches the handler. `null` = passed bare
   * (`runtime:setLocalOnly(true)`); a dotted string = wrapped into that shape
   * (`'scoring.inapp'` → `[{ scoring: { inapp: true } }]`), which is how every
   * `*:setConfig` handler takes a partial.
   */
  wrap: string | null
  /** Overrides `wrap` entirely for handlers that take positional arguments. */
  argsFor?: (value: unknown) => unknown[]
  /**
   * Reported next to the value but not writable — a setting whose real state
   * lives outside config.json and can disagree with it.
   */
  actualRead?: string
  /** Units or bounds shown in the prompt, e.g. "0-23". */
  hint?: string
}

export type CliSettingGroup =
  | 'model'
  | 'channels'
  | 'services'
  | 'mcp'
  | 'variables'
  | 'capabilities'
  | 'knowledge'
  | 'usage'
  | 'data'
  | 'updates'
  | 'wolffish'
  | 'appearance'

/**
 * The settings PAGES, in the desktop nav's own order (Settings.tsx `TABS`).
 *
 * `interactive` marks a page whose whole content is a flow rather than rows —
 * MCP servers, variables, capabilities, the usage report, the data tools. They
 * are pages in the window and they are pages here; leaving them out to keep
 * the table tidy would be exactly the "where did that setting go" problem the
 * CLI is supposed to end.
 */
export const CLI_SETTING_GROUPS: Array<{
  id: CliSettingGroup
  i18n: string
  fallback: string
  interactive?: true
}> = [
  { id: 'model', i18n: 'settings.tabs.model', fallback: 'Models' },
  { id: 'channels', i18n: 'settings.tabs.channels', fallback: 'Channels' },
  { id: 'services', i18n: 'settings.tabs.services', fallback: 'Services' },
  { id: 'mcp', i18n: 'settings.tabs.mcp', fallback: 'MCP', interactive: true },
  { id: 'variables', i18n: 'settings.tabs.variables', fallback: 'Variables', interactive: true },
  {
    id: 'capabilities',
    i18n: 'settings.tabs.capabilities',
    fallback: 'Capabilities',
    interactive: true
  },
  { id: 'knowledge', i18n: 'settings.tabs.knowledge', fallback: 'Knowledge' },
  { id: 'usage', i18n: 'settings.tabs.usage', fallback: 'Usage', interactive: true },
  { id: 'data', i18n: 'settings.tabs.data', fallback: 'Data', interactive: true },
  { id: 'updates', i18n: 'settings.tabs.updates', fallback: 'Updates' },
  { id: 'wolffish', i18n: 'settings.tabs.wolffish', fallback: 'Preferences' },
  { id: 'appearance', i18n: 'settings.tabs.appearance', fallback: 'Appearance' }
]

/**
 * The CARDS on each page — the desktop's sub-tabs where it has them
 * (Models → one per provider, Channels → one per channel, Services → one per
 * service, Knowledge → Compaction and Reflection), and the panel's own title
 * where the page is a single card.
 *
 * i18n keys are the window's: a card called Telegram in the app is called
 * Telegram here, in the same language, because someone who knows where a
 * setting lives on screen should not have to learn a second taxonomy.
 */
export type CliSettingSection = {
  id: string
  group: CliSettingGroup
  /**
   * Optional on purpose. A card whose only candidate key is an interpolation
   * template (`settings.model.cloud.title` is literally "{{provider}}") or does
   * not exist at all must fall straight through to `fallback` — printing a
   * template placeholder as a heading is worse than printing English.
   */
  i18n?: string
  fallback: string
}

export const CLI_SETTING_SECTIONS: CliSettingSection[] = [
  // Models — the two chat-wide choices, then the provider keys and the local
  // models, both of which are flows rather than rows.
  { id: 'model.chat', group: 'model', fallback: 'Chat' },
  { id: 'model.providers', group: 'model', fallback: 'Providers' },
  {
    id: 'model.local',
    group: 'model',
    i18n: 'settings.model.providers.ollama',
    fallback: 'Ollama'
  },

  // Channels — the desktop's five sub-tabs, in its order.
  {
    id: 'channels.inapp',
    group: 'channels',
    i18n: 'settings.channels.tabs.inapp',
    fallback: 'In-App'
  },
  { id: 'channels.cli', group: 'channels', i18n: 'settings.channels.tabs.cli', fallback: 'CLI' },
  {
    id: 'channels.mobile',
    group: 'channels',
    i18n: 'settings.channels.tabs.mobile',
    fallback: 'Mobile'
  },
  {
    id: 'channels.telegram',
    group: 'channels',
    i18n: 'settings.channels.tabs.telegram',
    fallback: 'Telegram'
  },
  {
    id: 'channels.whatsapp',
    group: 'channels',
    i18n: 'settings.channels.tabs.whatsapp',
    fallback: 'WhatsApp'
  },

  // Services — the desktop's ten sub-tabs, in its order.
  {
    id: 'services.browserExtension',
    group: 'services',
    i18n: 'settings.services.tabs.browserExtension',
    fallback: 'Browser Extension'
  },
  {
    id: 'services.brave',
    group: 'services',
    i18n: 'settings.services.tabs.brave',
    fallback: 'Brave Search'
  },
  {
    id: 'services.google',
    group: 'services',
    i18n: 'settings.services.tabs.google',
    fallback: 'Google Workspace'
  },
  {
    id: 'services.memes',
    group: 'services',
    i18n: 'settings.services.tabs.memes',
    fallback: 'Memes'
  },
  {
    id: 'services.video',
    group: 'services',
    i18n: 'settings.services.tabs.video',
    fallback: 'Video generation'
  },
  {
    id: 'services.notion',
    group: 'services',
    i18n: 'settings.services.tabs.notion',
    fallback: 'Notion'
  },
  {
    id: 'services.github',
    group: 'services',
    i18n: 'settings.services.tabs.github',
    fallback: 'GitHub'
  },
  {
    id: 'services.tts',
    group: 'services',
    i18n: 'settings.services.tabs.tts',
    fallback: 'Text-to-Speech'
  },
  {
    id: 'services.stt',
    group: 'services',
    i18n: 'settings.services.tabs.stt',
    fallback: 'Speech-to-Text'
  },
  {
    id: 'services.computerUse',
    group: 'services',
    i18n: 'settings.services.tabs.computerUse',
    fallback: 'Computer Use'
  },

  // Single-card pages. The card still exists so the flows registered against
  // it have somewhere to land.
  { id: 'mcp.servers', group: 'mcp', i18n: 'settings.mcp.title', fallback: 'MCP servers' },
  {
    id: 'variables.list',
    group: 'variables',
    i18n: 'settings.variables.title',
    fallback: 'Variables'
  },
  {
    id: 'capabilities.list',
    group: 'capabilities',
    i18n: 'settings.capabilities.title',
    fallback: 'Capabilities'
  },
  {
    id: 'knowledge.compaction',
    group: 'knowledge',
    i18n: 'settings.knowledge.tabs.compaction',
    fallback: 'Compaction'
  },
  {
    id: 'knowledge.reflection',
    group: 'knowledge',
    i18n: 'settings.knowledge.tabs.reflection',
    fallback: 'Reflection'
  },
  { id: 'usage.report', group: 'usage', i18n: 'settings.usage.title', fallback: 'Usage' },
  { id: 'data.workspace', group: 'data', i18n: 'settings.data.title', fallback: 'Data' },
  { id: 'updates.app', group: 'updates', i18n: 'settings.tabs.updates', fallback: 'Updates' },
  {
    id: 'wolffish.general',
    group: 'wolffish',
    i18n: 'settings.tabs.wolffish',
    fallback: 'Preferences'
  },
  {
    id: 'appearance.general',
    group: 'appearance',
    i18n: 'settings.appearance.title',
    fallback: 'Appearance'
  }
]

const HOURS: CliSettingOption[] = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, '0')}:00`
}))

const DAYS: CliSettingOption[] = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' }
]

/**
 * JPEG and PNG, and nothing else.
 *
 * WebP was offered here and exists nowhere else in the app: the stored type is
 * `'jpeg' | 'png'` (workspace.ts) and the writer coerces anything that is not
 * `png` to `jpeg` (index.ts). Picking it was accepted, echoed back as WebP by
 * the enum's own label, and stored as JPEG — a setting that lies about itself
 * in both directions.
 */
const IMAGE_FORMATS: CliSettingOption[] = [
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' }
]

/**
 * The Kokoro voices the TTS panel offers. A closed set in the app and free
 * text here meant a typo was accepted, stored, and only discovered when the
 * agent next tried to speak.
 */
const TTS_VOICES: CliSettingOption[] = [
  { value: 'af_bella', label: 'Bella · English (US)' },
  { value: 'af_heart', label: 'Heart · English (US)' },
  { value: 'af_nicole', label: 'Nicole · English (US)' },
  { value: 'af_sarah', label: 'Sarah · English (US)' },
  { value: 'af_aoede', label: 'Aoede · English (US)' },
  { value: 'af_kore', label: 'Kore · English (US)' },
  { value: 'af_nova', label: 'Nova · English (US)' },
  { value: 'af_sky', label: 'Sky · English (US)' },
  { value: 'am_adam', label: 'Adam · English (US)' },
  { value: 'am_michael', label: 'Michael · English (US)' },
  { value: 'am_eric', label: 'Eric · English (US)' },
  { value: 'am_liam', label: 'Liam · English (US)' },
  { value: 'am_onyx', label: 'Onyx · English (US)' },
  { value: 'am_puck', label: 'Puck · English (US)' },
  { value: 'bf_emma', label: 'Emma · English (UK)' },
  { value: 'bf_isabella', label: 'Isabella · English (UK)' },
  { value: 'bf_alice', label: 'Alice · English (UK)' },
  { value: 'bf_lily', label: 'Lily · English (UK)' },
  { value: 'bm_george', label: 'George · English (UK)' },
  { value: 'bm_lewis', label: 'Lewis · English (UK)' },
  { value: 'bm_daniel', label: 'Daniel · English (UK)' },
  { value: 'bm_fable', label: 'Fable · English (UK)' }
]

const TTS_SPEEDS: CliSettingOption[] = [
  { value: '0.75', label: 'Slow' },
  { value: '1.0', label: 'Normal' },
  { value: '1.25', label: 'Fast' },
  { value: '1.5', label: 'Very fast' }
]

/** faster-whisper sizes, smallest first — the panel's own list. */
const STT_MODELS: CliSettingOption[] = [
  { value: 'tiny', label: 'Tiny' },
  { value: 'base', label: 'Base' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' }
]

/**
 * A comma-separated line the user typed, as the list the handler stores.
 * Both allow-lists are entered and displayed as one line (that is how the
 * snapshot serves them and how the desktop's field takes them), so the split
 * belongs here rather than at every call site.
 */
function splitList(value: unknown): string[] {
  return String(value ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export const CLI_SETTINGS: CliSetting[] = [
  // ── Models ───────────────────────────────────────────────────────────────
  {
    id: 'model.mode',
    group: 'model',
    section: 'model.chat',
    i18n: 'chat.mode',
    fallback: 'Chat mode',
    kind: 'enum',
    options: [
      { value: 'single', label: 'Single' },
      { value: 'workflow', label: 'Workflow' }
    ],
    read: 'llm.chatMode',
    channel: 'provider:setMode',
    wrap: null
  },
  {
    id: 'model.localOnly',
    group: 'model',
    section: 'model.chat',
    i18n: 'chat.localOnly',
    fallback: 'Local only',
    kind: 'boolean',
    read: 'llm.localOnly',
    channel: 'runtime:setLocalOnly',
    wrap: null
  },

  // ── Channels ─────────────────────────────────────────────────────────────
  {
    id: 'channels.inapp.verbose',
    group: 'channels',
    section: 'channels.inapp',
    i18n: 'settings.services.inapp.verbose',
    fallback: 'Verbose task results',
    kind: 'boolean',
    read: 'channels.inapp.verbose',
    channel: 'inapp:setConfig',
    wrap: 'verbose'
  },
  {
    id: 'channels.cli.verbose',
    group: 'channels',
    section: 'channels.cli',
    i18n: 'settings.channels.cli.verbose',
    fallback: 'Verbose task results',
    kind: 'boolean',
    read: 'channels.cli.verbose',
    channel: 'cli:setConfig',
    wrap: 'verbose'
  },
  {
    /**
     * Which autostart registration this machine gets. A login item needs a
     * desktop session and opens a window; a background service starts with the
     * machine and needs neither — the only setting that matters on a headless
     * box, and the one the terminal is most likely to be configuring.
     */
    id: 'channels.cli.runMode',
    group: 'channels',
    section: 'channels.cli',
    i18n: 'settings.channels.cli.service.modeLabel',
    fallback: 'Start it as',
    kind: 'enum',
    options: [
      { value: 'gui', i18n: 'settings.channels.cli.service.mode.gui.label', label: 'Login item' },
      {
        value: 'headless',
        i18n: 'settings.channels.cli.service.mode.headless.label',
        label: 'Background service'
      }
    ],
    read: 'channels.cli.runMode',
    channel: 'service:setMode',
    wrap: null
  },
  {
    id: 'channels.mobile.notifications',
    group: 'channels',
    section: 'channels.mobile',
    i18n: 'settings.mobile.notifications',
    fallback: 'Allow notifications',
    kind: 'boolean',
    read: 'channels.mobile.notifications',
    channel: 'mobile:setNotifications',
    wrap: null
  },
  {
    id: 'channels.mobile.verbose',
    group: 'channels',
    section: 'channels.mobile',
    i18n: 'settings.mobile.verbose',
    fallback: 'Verbose task results',
    kind: 'boolean',
    read: 'channels.mobile.verbose',
    channel: 'mobile:setVerbose',
    wrap: null
  },
  {
    id: 'channels.telegram.enabled',
    group: 'channels',
    section: 'channels.telegram',
    i18n: 'settings.services.telegram.status',
    fallback: 'Status',
    kind: 'boolean',
    read: 'channels.telegram.enabled',
    channel: 'telegram:setConfig',
    wrap: 'enabled'
  },
  {
    id: 'channels.telegram.allowedUserIds',
    group: 'channels',
    section: 'channels.telegram',
    i18n: 'settings.services.telegram.allowedUsers',
    fallback: 'Allowed user IDs',
    kind: 'string',
    hint: 'comma-separated',
    read: 'channels.telegram.allowedUserIds',
    channel: 'telegram:setConfig',
    wrap: 'allowedUserIds',
    // Stored as number[]. A string would be accepted by the handler and then
    // never match an incoming numeric id — a silent allow-list of nobody.
    argsFor: (value) => [
      {
        allowedUserIds: splitList(value)
          .map((entry) => Number(entry))
          .filter((entry) => Number.isFinite(entry))
      }
    ]
  },
  {
    id: 'channels.telegram.verbose',
    group: 'channels',
    section: 'channels.telegram',
    i18n: 'settings.services.telegram.verbose',
    fallback: 'Verbose task results',
    kind: 'boolean',
    read: 'channels.telegram.verbose',
    channel: 'telegram:setConfig',
    wrap: 'verbose'
  },
  {
    id: 'channels.telegram.autoRefresh',
    group: 'channels',
    section: 'channels.telegram',
    i18n: 'settings.services.telegram.autoRefresh',
    fallback: 'Auto-refresh conversations',
    kind: 'boolean',
    read: 'channels.telegram.autoRefresh',
    channel: 'telegram:setConfig',
    wrap: 'autoRefresh'
  },
  {
    id: 'channels.telegram.staleHours',
    group: 'channels',
    section: 'channels.telegram',
    i18n: 'settings.services.telegram.autoRefresh.staleLabel',
    fallback: 'Idle timeout',
    kind: 'number',
    hint: 'hours',
    read: 'channels.telegram.staleHours',
    channel: 'telegram:setConfig',
    wrap: 'staleHours'
  },
  {
    id: 'channels.telegram.hideAutomations',
    group: 'channels',
    section: 'channels.telegram',
    i18n: 'settings.services.telegram.hideAutomations',
    fallback: 'Hide automations from /resume',
    kind: 'boolean',
    read: 'channels.telegram.hideAutomations',
    channel: 'telegram:setConfig',
    wrap: 'hideAutomationsFromResume'
  },
  {
    id: 'channels.whatsapp.enabled',
    group: 'channels',
    section: 'channels.whatsapp',
    i18n: 'settings.services.whatsapp.status',
    fallback: 'Status',
    kind: 'boolean',
    read: 'channels.whatsapp.enabled',
    channel: 'whatsapp:setConfig',
    wrap: 'enabled'
  },
  {
    id: 'channels.whatsapp.allowedNumbers',
    group: 'channels',
    section: 'channels.whatsapp',
    i18n: 'settings.services.whatsapp.allowedPhones',
    fallback: 'Allowed phone numbers',
    kind: 'string',
    hint: 'comma-separated',
    read: 'channels.whatsapp.allowedNumbers',
    channel: 'whatsapp:setConfig',
    wrap: 'allowedPhoneNumbers',
    argsFor: (value) => [{ allowedPhoneNumbers: splitList(value) }]
  },
  {
    id: 'channels.whatsapp.verbose',
    group: 'channels',
    section: 'channels.whatsapp',
    i18n: 'settings.services.whatsapp.verbose',
    fallback: 'Verbose task results',
    kind: 'boolean',
    read: 'channels.whatsapp.verbose',
    channel: 'whatsapp:setConfig',
    wrap: 'verbose'
  },
  {
    id: 'channels.whatsapp.autoRefresh',
    group: 'channels',
    section: 'channels.whatsapp',
    i18n: 'settings.services.whatsapp.autoRefresh',
    fallback: 'Auto-refresh conversations',
    kind: 'boolean',
    read: 'channels.whatsapp.autoRefresh',
    channel: 'whatsapp:setConfig',
    wrap: 'autoRefresh'
  },
  {
    id: 'channels.whatsapp.staleHours',
    group: 'channels',
    section: 'channels.whatsapp',
    i18n: 'settings.services.whatsapp.autoRefresh.staleLabel',
    fallback: 'Idle timeout',
    kind: 'number',
    hint: 'hours',
    read: 'channels.whatsapp.staleHours',
    channel: 'whatsapp:setConfig',
    wrap: 'staleHours'
  },
  {
    id: 'channels.whatsapp.hideAutomations',
    group: 'channels',
    section: 'channels.whatsapp',
    i18n: 'settings.services.whatsapp.hideAutomations',
    fallback: 'Hide automations from /resume',
    kind: 'boolean',
    read: 'channels.whatsapp.hideAutomations',
    channel: 'whatsapp:setConfig',
    wrap: 'hideAutomationsFromResume'
  },

  // ── Services ─────────────────────────────────────────────────────────────
  {
    id: 'services.browserExtension.port',
    group: 'services',
    section: 'services.browserExtension',
    i18n: 'settings.services.browserExtension.portLabel',
    fallback: 'WebSocket port',
    kind: 'number',
    read: 'services.browserExtension.port',
    channel: 'browserExtension:setConfig',
    wrap: 'port'
  },
  {
    id: 'services.browserExtension.screenshotMaxWidth',
    group: 'services',
    section: 'services.browserExtension',
    i18n: 'settings.services.browserExtension.resolutionLabel',
    fallback: 'Screenshot resolution',
    kind: 'number',
    hint: 'pixels',
    read: 'services.browserExtension.screenshotMaxWidth',
    channel: 'browserExtension:setConfig',
    wrap: 'screenshotMaxWidth'
  },
  {
    id: 'services.browserExtension.screenshotFormat',
    group: 'services',
    section: 'services.browserExtension',
    i18n: 'settings.services.browserExtension.formatLabel',
    fallback: 'Screenshot format',
    kind: 'enum',
    options: IMAGE_FORMATS,
    read: 'services.browserExtension.screenshotFormat',
    channel: 'browserExtension:setConfig',
    wrap: 'screenshotFormat'
  },
  {
    id: 'services.browserExtension.screenshotQuality',
    group: 'services',
    section: 'services.browserExtension',
    i18n: 'settings.services.browserExtension.screenshotQuality',
    fallback: 'Screenshot quality',
    kind: 'number',
    hint: '1-100',
    read: 'services.browserExtension.screenshotQuality',
    channel: 'browserExtension:setConfig',
    wrap: 'screenshotQuality'
  },
  {
    id: 'services.brave.enabled',
    group: 'services',
    section: 'services.brave',
    i18n: 'settings.services.brave.status',
    fallback: 'Status',
    kind: 'boolean',
    read: 'services.braveEnabled',
    channel: 'brave:setConfig',
    wrap: 'enabled'
  },
  {
    id: 'services.brave.apiKey',
    group: 'services',
    section: 'services.brave',
    i18n: 'settings.services.brave.apiKey',
    fallback: 'API key',
    kind: 'secret',
    read: 'services.braveApiKey',
    channel: 'brave:setConfig',
    wrap: 'apiKey'
  },
  {
    /**
     * Memes has no enabled flag of its own — the switch IS the capability,
     * which is why this writes the capability toggle rather than a service
     * config. Same path as the Capabilities screen, locked-core guard included.
     */
    id: 'services.memes.enabled',
    group: 'services',
    section: 'services.memes',
    i18n: 'settings.services.memes.status',
    fallback: 'Status',
    kind: 'boolean',
    read: 'services.memesEnabled',
    channel: 'cerebellum:toggleCapability',
    wrap: null,
    argsFor: (value) => ['memes', value === true]
  },
  {
    id: 'services.memes.giphyApiKey',
    group: 'services',
    section: 'services.memes',
    i18n: 'settings.services.memes.giphy',
    fallback: 'Giphy API key',
    kind: 'secret',
    read: 'services.memes.giphyApiKey',
    channel: 'memes:setConfig',
    wrap: 'giphy.apiKey'
  },
  {
    id: 'services.memes.imgflipUsername',
    group: 'services',
    section: 'services.memes',
    i18n: 'settings.services.memes.imgflipUsername',
    fallback: 'Imgflip username',
    kind: 'string',
    read: 'services.memes.imgflipUsername',
    channel: 'memes:setConfig',
    wrap: 'imgflip.username'
  },
  {
    id: 'services.memes.imgflipPassword',
    group: 'services',
    section: 'services.memes',
    i18n: 'settings.services.memes.imgflipPassword',
    fallback: 'Imgflip password',
    kind: 'secret',
    read: 'services.memes.imgflipPassword',
    channel: 'memes:setConfig',
    wrap: 'imgflip.password'
  },
  {
    id: 'services.video.enabled',
    group: 'services',
    section: 'services.video',
    i18n: 'settings.services.video.status',
    fallback: 'Status',
    kind: 'boolean',
    read: 'services.videoEnabled',
    channel: 'cerebellum:toggleCapability',
    wrap: null,
    argsFor: (value) => ['video', value === true]
  },
  {
    id: 'services.video.apiKey',
    group: 'services',
    section: 'services.video',
    i18n: 'settings.services.video.apiKey',
    fallback: 'API key',
    kind: 'secret',
    read: 'services.videoApiKey',
    channel: 'video:setConfig',
    wrap: 'apiKey'
  },
  {
    id: 'services.video.director',
    group: 'services',
    section: 'services.video',
    i18n: 'settings.services.video.director.title',
    fallback: 'Your chat model is the director',
    kind: 'boolean',
    read: 'services.videoDirector',
    channel: 'video:setConfig',
    wrap: 'director'
  },
  {
    id: 'services.tts.voice',
    group: 'services',
    section: 'services.tts',
    i18n: 'settings.services.tts.voice',
    fallback: 'Voice',
    kind: 'enum',
    options: TTS_VOICES,
    read: 'services.ttsVoice',
    channel: 'tts:setConfig',
    wrap: 'defaultVoice'
  },
  {
    id: 'services.tts.speed',
    group: 'services',
    section: 'services.tts',
    i18n: 'settings.services.tts.speed',
    fallback: 'Speed',
    kind: 'enum',
    options: TTS_SPEEDS,
    read: 'services.ttsSpeed',
    channel: 'tts:setConfig',
    wrap: 'defaultSpeed'
  },
  {
    id: 'services.stt.model',
    group: 'services',
    section: 'services.stt',
    i18n: 'settings.services.stt.model',
    fallback: 'Model',
    kind: 'enum',
    options: STT_MODELS,
    read: 'services.sttModel',
    channel: 'stt:setConfig',
    wrap: 'defaultModel'
  },
  {
    id: 'services.computerUse.screenshotMaxWidth',
    group: 'services',
    section: 'services.computerUse',
    i18n: 'settings.services.computerUse.resolutionLabel',
    fallback: 'Screenshot resolution',
    kind: 'number',
    hint: 'pixels',
    read: 'services.screenshotMaxWidth',
    channel: 'computerUse:setConfig',
    wrap: 'screenshotMaxWidth'
  },
  {
    id: 'services.computerUse.screenshotFormat',
    group: 'services',
    section: 'services.computerUse',
    i18n: 'settings.services.computerUse.formatLabel',
    fallback: 'Screenshot format',
    kind: 'enum',
    options: IMAGE_FORMATS,
    read: 'services.screenshotFormat',
    channel: 'computerUse:setConfig',
    wrap: 'screenshotFormat'
  },

  // ── Knowledge ────────────────────────────────────────────────────────────
  {
    id: 'knowledge.compaction.dailyHour',
    group: 'knowledge',
    section: 'knowledge.compaction',
    i18n: 'settings.knowledge.compaction.daily',
    fallback: 'Daily compaction',
    kind: 'enum',
    options: HOURS,
    read: 'compaction.dailyHour',
    channel: 'runtime:setCompactionConfig',
    wrap: 'dailyHour'
  },
  {
    id: 'knowledge.compaction.weeklyDay',
    group: 'knowledge',
    section: 'knowledge.compaction',
    i18n: 'settings.knowledge.compaction.weekly',
    fallback: 'Weekly consolidation',
    kind: 'enum',
    options: DAYS,
    read: 'compaction.weeklyDay',
    channel: 'runtime:setCompactionConfig',
    wrap: 'weeklyDay'
  },
  {
    id: 'knowledge.compaction.weeklyHour',
    group: 'knowledge',
    section: 'knowledge.compaction',
    i18n: 'settings.knowledge.compaction.weeklyHour',
    fallback: 'Weekly consolidation hour',
    kind: 'enum',
    options: HOURS,
    read: 'compaction.weeklyHour',
    channel: 'runtime:setCompactionConfig',
    wrap: 'weeklyHour'
  },
  {
    id: 'knowledge.reflection.hour',
    group: 'knowledge',
    section: 'knowledge.reflection',
    i18n: 'settings.knowledge.reflection.nightly',
    fallback: 'Nightly reflection',
    kind: 'enum',
    options: HOURS,
    read: 'reflection.hour',
    channel: 'runtime:setReflectionConfig',
    wrap: 'hour'
  },
  {
    id: 'knowledge.reflection.quietHours',
    group: 'knowledge',
    section: 'knowledge.reflection',
    i18n: 'settings.knowledge.reflection.quiet',
    fallback: 'Review after quiet for',
    kind: 'number',
    hint: 'hours',
    read: 'reflection.quietHours',
    channel: 'runtime:setReflectionConfig',
    wrap: 'quietHours'
  },
  {
    id: 'knowledge.reflection.scoring.inapp',
    group: 'knowledge',
    section: 'knowledge.reflection',
    i18n: 'settings.knowledge.reflection.scoring',
    fallback: 'Turn scoring · in-app',
    kind: 'boolean',
    read: 'reflection.scoring.inapp',
    channel: 'runtime:setReflectionConfig',
    wrap: 'scoring.inapp'
  },
  {
    id: 'knowledge.reflection.scoring.telegram',
    group: 'knowledge',
    section: 'knowledge.reflection',
    i18n: 'settings.knowledge.reflection.scoringTelegram',
    fallback: 'Turn scoring · Telegram',
    kind: 'boolean',
    read: 'reflection.scoring.telegram',
    channel: 'runtime:setReflectionConfig',
    wrap: 'scoring.telegram'
  },
  {
    id: 'knowledge.reflection.scoring.whatsapp',
    group: 'knowledge',
    section: 'knowledge.reflection',
    i18n: 'settings.knowledge.reflection.scoringWhatsapp',
    fallback: 'Turn scoring · WhatsApp',
    kind: 'boolean',
    read: 'reflection.scoring.whatsapp',
    channel: 'runtime:setReflectionConfig',
    wrap: 'scoring.whatsapp'
  },

  // ── Updates ──────────────────────────────────────────────────────────────
  {
    id: 'updates.enabled',
    group: 'updates',
    section: 'updates.app',
    i18n: 'settings.updates.auto',
    fallback: 'Automatic updates',
    kind: 'boolean',
    read: 'preferences.updatesEnabled',
    channel: 'runtime:setUpdatesEnabled',
    wrap: null
  },

  // ── Preferences ──────────────────────────────────────────────────────────
  {
    id: 'wolffish.launchAtStartup',
    group: 'wolffish',
    section: 'wolffish.general',
    i18n: 'settings.wolffish.launchAtStartup',
    fallback: 'Launch at startup',
    kind: 'boolean',
    read: 'preferences.launchAtStartup',
    actualRead: 'preferences.launchAtStartupActive',
    channel: 'runtime:setLaunchAtStartup',
    wrap: null
  },
  {
    id: 'wolffish.blockCredentials',
    group: 'wolffish',
    section: 'wolffish.general',
    i18n: 'settings.wolffish.blockCredentials',
    fallback: 'Block sensitive data in messages',
    kind: 'boolean',
    read: 'preferences.blockCredentials',
    channel: 'runtime:setBlockCredentials',
    wrap: null
  },
  {
    id: 'wolffish.bypassPermissions',
    group: 'wolffish',
    section: 'wolffish.general',
    i18n: 'settings.wolffish.bypassPermissions',
    fallback: 'Bypass permissions mode',
    kind: 'boolean',
    read: 'preferences.bypassPermissions',
    channel: 'runtime:setBypassPermissions',
    wrap: null
  },
  {
    id: 'wolffish.restrictPowerfulModels',
    group: 'wolffish',
    section: 'wolffish.general',
    i18n: 'settings.wolffish.restrictPowerfulModels',
    fallback: 'Restrict powerful local models',
    kind: 'boolean',
    read: 'llm.restrictPowerfulModels',
    channel: 'runtime:setRestrictPowerfulModels',
    wrap: null
  },
  {
    id: 'wolffish.weekStartsOn',
    group: 'wolffish',
    section: 'wolffish.general',
    i18n: 'settings.wolffish.weekStartsOn',
    fallback: 'Start of week',
    kind: 'enum',
    options: [
      { value: '1', i18n: 'settings.wolffish.weekStartsOn.monday', label: 'Monday' },
      { value: '0', i18n: 'settings.wolffish.weekStartsOn.sunday', label: 'Sunday' }
    ],
    read: 'preferences.weekStartsOn',
    channel: 'runtime:setWeekStartsOn',
    wrap: null
  },

  // ── Appearance ───────────────────────────────────────────────────────────
  {
    id: 'appearance.theme',
    group: 'appearance',
    section: 'appearance.general',
    i18n: 'theme',
    fallback: 'Theme',
    kind: 'enum',
    options: [
      { value: 'system', label: 'System' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' }
    ],
    read: 'preferences.theme',
    channel: 'theme:set',
    wrap: null
  },
  {
    id: 'appearance.locale',
    group: 'appearance',
    section: 'appearance.general',
    i18n: 'locale',
    fallback: 'Language',
    kind: 'enum',
    options: [
      { value: 'en', label: 'English' },
      { value: 'ar', label: 'العربية' }
    ],
    read: 'preferences.locale',
    channel: 'locale:set',
    wrap: null
  }
]

/**
 * Label resolution, shared by the IPC layer that serves the CLI and the test
 * that guards this table. One implementation, because the property being
 * checked — no two rows on the same card read the same — is a property of the
 * RENDERED label, and a test that re-implemented the lookup would be checking
 * its own copy rather than what ships.
 *
 * The bundle is not consistent, because it never had to be: some cards carry
 * `{ label, description }` under their key, and just as many render the label
 * from a bare string at the key itself (`settings.services.brave.apiKey` IS
 * "API key"). A key that resolves to an object is a whole card's sub-tree, not
 * a label, so it falls through to the caller's default.
 */
export function localeString(bundle: unknown, dotted: string): string | null {
  const value = readPath(bundle, dotted)
  return typeof value === 'string' ? value : null
}

/** Strips the inline <cmd> markup a couple of labels carry for the web. */
export function resolveText(
  bundle: unknown,
  fallbackBundle: unknown,
  dotted: string,
  ifMissing: string
): string {
  const raw = localeString(bundle, dotted) ?? localeString(fallbackBundle, dotted) ?? ifMissing
  return raw.replace(/<\/?[a-z][^>]*>/gi, '')
}

/** A row's label: `<key>.label`, then the key itself, then the fallback. */
export function resolveLabel(
  bundle: unknown,
  fallbackBundle: unknown,
  i18n: string,
  ifMissing: string
): string {
  const scoped =
    localeString(bundle, `${i18n}.label`) ?? localeString(fallbackBundle, `${i18n}.label`)
  if (scoped) return scoped.replace(/<\/?[a-z][^>]*>/gi, '')
  return resolveText(bundle, fallbackBundle, i18n, ifMissing)
}

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
 * Turn what a user typed into what the handler expects. Strict on booleans and
 * numbers, because a silently misinterpreted setting is worse than a refusal —
 * `--verbose maybe` should fail loudly rather than quietly meaning `false`.
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
        const shown = allowed.length > 8 ? `${allowed.slice(0, 8).join(', ')}…` : allowed.join(', ')
        return { ok: false, error: `expected one of ${shown}, got "${text}"` }
      }
      // Numeric enums (hours, weekdays, week start) travel as numbers even
      // though the user picks them as text.
      return { ok: true, value: /^\d+$/.test(text) ? Number(text) : text }
    }
    default:
      return { ok: true, value: text }
  }
}

/**
 * Build the handler arguments. `wrap` may be dotted, so a nested partial like
 * `{ scoring: { inapp: true } }` needs no special case at the call site.
 */
export function settingArgs(setting: CliSetting, value: unknown): unknown[] {
  if (setting.argsFor) return setting.argsFor(value)
  if (setting.wrap === null) return [value]
  const parts = setting.wrap.split('.')
  let payload: unknown = value
  for (let i = parts.length - 1; i >= 0; i--) payload = { [parts[i]]: payload }
  return [payload]
}
