import {
  AnthropicLogo,
  BraveLogo,
  DeepSeekLogo,
  GoogleLogo,
  KimiLogo,
  MimoLogo,
  MiniMaxLogo,
  NotionLogo,
  OllamaLogo,
  OpenAILogo,
  OpenRouterLogo,
  QwenLogo,
  StepfunLogo,
  TelegramLogo,
  XAILogo,
  ZaiLogo
} from '@components/core/ProviderLogos'
import { RTL_LOCALES, type SupportedLocale } from '@lib/i18n'
import { cn } from '@lib/utils/cn'
import { pageTopPadding } from '@lib/utils/platform'
import { ModelPicker } from '@pages/ModelPicker'
import { BravePanel } from '@pages/settings/BravePanel'
import { BrowserExtensionPanel } from '@pages/settings/BrowserExtensionPanel'
import { CapabilitiesPanel } from '@pages/settings/CapabilitiesPanel'
import { CloudProviderPanel } from '@pages/settings/CloudProviderPanel'
import { CompactionPanel } from '@pages/settings/CompactionPanel'
import { ReflectionPanel } from '@pages/settings/ReflectionPanel'
import { ComputerUsePanel } from '@pages/settings/ComputerUsePanel'
import { DataPanel } from '@pages/settings/DataPanel'
import { GitHubPanel } from '@pages/settings/GitHubPanel'
import { GooglePanel } from '@pages/settings/GooglePanel'
import { prefetchGooglePanel } from '@pages/settings/googleSnapshot'
import { CliPanel } from '@pages/settings/CliPanel'
import { InAppPanel } from '@pages/settings/InAppPanel'
import { McpPanel } from '@pages/settings/McpPanel'
import { MemesPanel } from '@pages/settings/MemesPanel'
import { VideoPanel } from '@pages/settings/VideoPanel'
import { NotionPanel } from '@pages/settings/NotionPanel'
import { SpeechToTextPanel } from '@pages/settings/SpeechToTextPanel'
import { MobilePanel } from '@pages/settings/MobilePanel'
import { TelegramPanel } from '@pages/settings/TelegramPanel'
import { TextToSpeechPanel } from '@pages/settings/TextToSpeechPanel'
import { UpdatesPanel } from '@pages/settings/UpdatesPanel'
import { UsagePanel } from '@pages/settings/UsagePanel'
import { VariablesPanel } from '@pages/settings/VariablesPanel'
import { WhatsAppPanel } from '@pages/settings/WhatsAppPanel'
import { WolffishPanel } from '@pages/settings/WolffishPanel'
import { useFlow } from '@providers/flow/useFlow'
import { useLocale } from '@providers/locale/useLocale'
import { useTheme, type ThemeSource } from '@providers/theme/useTheme'
import {
  AiMagicIcon,
  Video01Icon,
  AnalyticsUpIcon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  ArrowUp02Icon,
  BrainIcon,
  BrowserIcon,
  BubbleChatIcon,
  CloudIcon,
  ComputerIcon,
  ComputerTerminal01Icon,
  Database02Icon,
  DnaIcon,
  GithubIcon,
  Key01Icon,
  McpServerIcon,
  Mic01Icon,
  NeuralNetworkIcon,
  PaintBoardIcon,
  PuzzleIcon,
  SmartPhone01Icon,
  SmileDizzyIcon,
  VolumeHighIcon,
  WhatsappIcon
} from 'hugeicons-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { IconType } from 'react-icons'

import { prefetchCapabilityGate } from '@pages/settings/capabilityGate'
import { consumeNextTab, onTabRequest, type TabKey } from '@pages/settings/settingsNav'
export type { TabKey } from '@pages/settings/settingsNav'

type Tab = {
  key: TabKey
  icon: React.ReactNode
  labelKey: string
}

const TABS: Tab[] = [
  { key: 'model', icon: <NeuralNetworkIcon size={18} />, labelKey: 'settings.tabs.model' },
  { key: 'channels', icon: <BubbleChatIcon size={18} />, labelKey: 'settings.tabs.channels' },
  { key: 'services', icon: <PuzzleIcon size={18} />, labelKey: 'settings.tabs.services' },
  { key: 'mcp', icon: <McpServerIcon size={18} />, labelKey: 'settings.tabs.mcp' },
  { key: 'variables', icon: <Key01Icon size={18} />, labelKey: 'settings.tabs.variables' },
  { key: 'capabilities', icon: <BrainIcon size={18} />, labelKey: 'settings.tabs.capabilities' },
  { key: 'knowledge', icon: <DnaIcon size={18} />, labelKey: 'settings.tabs.knowledge' },
  { key: 'usage', icon: <AnalyticsUpIcon size={18} />, labelKey: 'settings.tabs.usage' },
  { key: 'data', icon: <Database02Icon size={18} />, labelKey: 'settings.tabs.data' },
  { key: 'updates', icon: <ArrowUp02Icon size={18} />, labelKey: 'settings.tabs.updates' },
  { key: 'wolffish', icon: <AiMagicIcon size={18} />, labelKey: 'settings.tabs.wolffish' },
  { key: 'appearance', icon: <PaintBoardIcon size={18} />, labelKey: 'settings.tabs.appearance' }
]

const TAB_KEYS = new Set<string>(TABS.map((t) => t.key))

type SettingsSnapshot = {
  tab: TabKey
  provider: Provider
  channel: Channel
  service: Service
  knowledgeTab: KnowledgeTab
}

let memo: SettingsSnapshot | null = null

function restoreSnapshot(
  cfg: { lastSettingsState?: Record<string, string> } | null
): SettingsSnapshot {
  if (memo) return memo
  const s = cfg?.lastSettingsState
  const result: SettingsSnapshot = {
    tab: s?.tab && TAB_KEYS.has(s.tab) ? (s.tab as TabKey) : 'model',
    provider:
      s?.provider && PROVIDERS.includes(s.provider as Provider)
        ? (s.provider as Provider)
        : 'ollama',
    channel:
      s?.channel && CHANNELS.includes(s.channel as Channel) ? (s.channel as Channel) : 'inapp',
    service:
      s?.service && SERVICES.includes(s.service as Service)
        ? (s.service as Service)
        : 'browserExtension',
    knowledgeTab:
      s?.knowledgeTab && KNOWLEDGE_TABS.includes(s.knowledgeTab as KnowledgeTab)
        ? (s.knowledgeTab as KnowledgeTab)
        : 'compaction'
  }
  memo = result
  return result
}

function persistField(key: string, value: string): void {
  void window.api.runtime.setLastSettingsState({ [key]: value })
}

export function Settings(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const isRtl = RTL_LOCALES.has(locale)
  const BackIcon = isRtl ? ArrowRight02Icon : ArrowLeft02Icon
  const { goTo, status } = useFlow()

  const [snapshot] = useState(() => restoreSnapshot(status?.config ?? null))

  const [active, setActiveRaw] = useState<TabKey>(() => {
    return consumeNextTab() ?? snapshot.tab
  })
  const [provider, setProviderRaw] = useState<Provider>(snapshot.provider)
  const [channel, setChannelRaw] = useState<Channel>(snapshot.channel)
  const [service, setServiceRaw] = useState<Service>(snapshot.service)
  const [knowledgeTab, setKnowledgeTabRaw] = useState<KnowledgeTab>(snapshot.knowledgeTab)

  const setActive = useCallback(
    (key: TabKey) => {
      setActiveRaw(key)
      memo = { ...(memo ?? snapshot), tab: key }
      persistField('tab', key)
    },
    [snapshot]
  )

  // The provider panels link to the Brain page for model selection.

  const setProvider = useCallback(
    (p: Provider) => {
      setProviderRaw(p)
      memo = { ...(memo ?? snapshot), provider: p }
      persistField('provider', p)
    },
    [snapshot]
  )

  const setChannel = useCallback(
    (ch: Channel) => {
      setChannelRaw(ch)
      memo = { ...(memo ?? snapshot), channel: ch }
      persistField('channel', ch)
    },
    [snapshot]
  )

  const setService = useCallback(
    (s: Service) => {
      setServiceRaw(s)
      memo = { ...(memo ?? snapshot), service: s }
      persistField('service', s)
    },
    [snapshot]
  )

  const setKnowledgeTab = useCallback(
    (kt: KnowledgeTab) => {
      setKnowledgeTabRaw(kt)
      memo = { ...(memo ?? snapshot), knowledgeTab: kt }
      persistField('knowledgeTab', kt)
    },
    [snapshot]
  )

  const [ollamaReachable, setOllamaReachable] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.ollama.detect().then((r) => {
      if (!cancelled) setOllamaReachable(r.reachable)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Cloud providers with a saved key get their cloud badge tinted in the
  // sub-nav. provider:updated fires on every save/remove, so the set stays
  // current while the user edits keys in the panels.
  const [keyedProviders, setKeyedProviders] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    const reload = (): void => {
      void window.api.provider.list().then((entries) => {
        if (cancelled) return
        setKeyedProviders(
          new Set(entries.filter((e) => e.apiKey.trim().length > 0).map((e) => e.id))
        )
      })
    }
    reload()
    const off = window.api.provider.onUpdated(reload)
    return () => {
      cancelled = true
      off()
    }
  }, [])

  // Warm up the Google Workspace snapshot and the capability gate the
  // moment Settings opens, so by the time the user clicks a Services tab
  // the data is already populated and the panel renders without a flash.
  useEffect(() => {
    void prefetchGooglePanel().catch(() => {})
    prefetchCapabilityGate()
  }, [])

  // Nested panels (capability gate cards) can ask to jump to another tab.
  useEffect(() => onTabRequest(setActive), [setActive])

  return (
    <main className={cn('bg-bg flex h-full w-full', pageTopPadding)}>
      <aside className="flex w-56 min-w-56 shrink-0 flex-col gap-2 overflow-y-auto p-3">
        <button
          type="button"
          onClick={() => goTo('chat')}
          aria-label={t('common.back')}
          className={cn(
            'text-muted hover:text-fg flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-2 text-sm',
            'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
          )}
        >
          <BackIcon size={16} />
          <span>{t('common.back')}</span>
        </button>

        <nav role="tablist" aria-orientation="vertical" className="mt-2 flex flex-col gap-1">
          {TABS.map((tab) => {
            const isActive = active === tab.key
            return (
              <div key={tab.key} className="flex flex-col">
                <button
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  onClick={() => setActive(tab.key)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-start text-sm cursor-pointer whitespace-nowrap',
                    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                    isActive
                      ? 'bg-primary text-primary-fg shadow-sm'
                      : 'text-muted hover:bg-border/40 hover:text-fg'
                  )}
                >
                  {tab.icon}
                  <span>{t(tab.labelKey)}</span>
                </button>

                {/* Nested sub-tabs (Models and Channels have them). The
                    grid-rows trick gives us a smooth height collapse without
                    measuring, and the 200ms ease keeps it subtle. */}
                {tab.key === 'model' && (
                  <div
                    className={cn(
                      'grid transition-[grid-template-rows] duration-200 ease-out',
                      isActive ? 'mt-1 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                    )}
                  >
                    <div className="overflow-hidden">
                      <div className="flex flex-col gap-0.5 ps-7 pe-1 py-1">
                        {PROVIDERS.map((p) => {
                          const subActive = isActive && provider === p
                          const Logo = PROVIDER_ICONS[p]
                          const isCloud = p !== 'ollama'
                          return (
                            <button
                              key={p}
                              type="button"
                              tabIndex={isActive ? 0 : -1}
                              onClick={() => setProvider(p)}
                              className={cn(
                                'flex items-center gap-2 rounded-lg px-3 py-1.5 text-start text-sm cursor-pointer whitespace-nowrap',
                                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                                subActive
                                  ? 'bg-border/50 text-fg font-medium'
                                  : 'text-muted hover:bg-border/30 hover:text-fg'
                              )}
                            >
                              <Logo size={14} />
                              <span>{t(`settings.model.providers.${p}`)}</span>
                              {isCloud && (
                                <CloudIcon
                                  size={12}
                                  className={cn(
                                    'ms-auto shrink-0',
                                    keyedProviders.has(p)
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-muted'
                                  )}
                                  aria-label={t('settings.model.cloudBadge')}
                                />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {tab.key === 'channels' && (
                  <div
                    className={cn(
                      'grid transition-[grid-template-rows] duration-200 ease-out',
                      isActive ? 'mt-1 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                    )}
                  >
                    <div className="overflow-hidden">
                      <div className="flex flex-col gap-0.5 ps-7 pe-1 py-1">
                        {CHANNELS.map((ch) => {
                          const subActive = isActive && channel === ch
                          const Icon = CHANNEL_ICONS[ch]
                          return (
                            <button
                              key={ch}
                              type="button"
                              tabIndex={isActive ? 0 : -1}
                              onClick={() => setChannel(ch)}
                              className={cn(
                                'flex items-center gap-2 rounded-lg px-3 py-1.5 text-start text-sm cursor-pointer whitespace-nowrap',
                                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                                subActive
                                  ? 'bg-border/50 text-fg font-medium'
                                  : 'text-muted hover:bg-border/30 hover:text-fg'
                              )}
                            >
                              <NavIcon icon={Icon} />
                              <span>{t(`settings.channels.tabs.${ch}`)}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {tab.key === 'services' && (
                  <div
                    className={cn(
                      'grid transition-[grid-template-rows] duration-200 ease-out',
                      isActive ? 'mt-1 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                    )}
                  >
                    <div className="overflow-hidden">
                      <div className="flex flex-col gap-0.5 ps-7 pe-1 py-1">
                        {SERVICES.map((s) => {
                          const subActive = isActive && service === s
                          const Icon = SERVICE_ICONS[s]
                          return (
                            <button
                              key={s}
                              type="button"
                              tabIndex={isActive ? 0 : -1}
                              onClick={() => setService(s)}
                              className={cn(
                                'flex items-center gap-2 rounded-lg px-3 py-1.5 text-start text-sm cursor-pointer whitespace-nowrap',
                                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                                subActive
                                  ? 'bg-border/50 text-fg font-medium'
                                  : 'text-muted hover:bg-border/30 hover:text-fg'
                              )}
                            >
                              <NavIcon icon={Icon} />
                              <span>{t(`settings.services.tabs.${s}`)}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {tab.key === 'knowledge' && (
                  <div
                    className={cn(
                      'grid transition-[grid-template-rows] duration-200 ease-out',
                      isActive ? 'mt-1 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                    )}
                  >
                    <div className="overflow-hidden">
                      <div className="flex flex-col gap-0.5 ps-7 pe-1 py-1">
                        {KNOWLEDGE_TABS.map((kt) => {
                          const subActive = isActive && knowledgeTab === kt
                          return (
                            <button
                              key={kt}
                              type="button"
                              tabIndex={isActive ? 0 : -1}
                              onClick={() => setKnowledgeTab(kt)}
                              className={cn(
                                'flex items-center gap-2 rounded-lg px-3 py-1.5 text-start text-sm cursor-pointer whitespace-nowrap',
                                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                                subActive
                                  ? 'bg-border/50 text-fg font-medium'
                                  : 'text-muted hover:bg-border/30 hover:text-fg'
                              )}
                            >
                              <span>{t(`settings.knowledge.tabs.${kt}`)}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      </aside>

      <div className="flex-1 overflow-y-auto">
        <TabPanel active={active === 'appearance'}>
          <AppearancePanel />
        </TabPanel>
        <TabPanel active={active === 'updates'}>
          <UpdatesPanel />
        </TabPanel>
        <TabPanel active={active === 'wolffish'}>
          <WolffishPanel />
        </TabPanel>
        <TabPanel active={active === 'variables'}>
          <VariablesPanel />
        </TabPanel>
        <TabPanel active={active === 'capabilities'}>
          <CapabilitiesPanel />
        </TabPanel>
        <TabPanel active={active === 'knowledge' && knowledgeTab === 'compaction'}>
          <CompactionPanel />
        </TabPanel>
        <TabPanel active={active === 'knowledge' && knowledgeTab === 'reflection'}>
          <ReflectionPanel />
        </TabPanel>
        <TabPanel active={active === 'usage'}>
          <UsagePanel />
        </TabPanel>
        <TabPanel active={active === 'data'}>
          <DataPanel />
        </TabPanel>
        <TabPanel active={active === 'model' && provider === 'ollama'}>
          {ollamaReachable === false ? (
            <OllamaNotAvailableNotice goTo={goTo} t={t} />
          ) : (
            <ModelPicker />
          )}
        </TabPanel>
        <TabPanel active={active === 'model' && provider === 'anthropic'}>
          <CloudProviderPanel provider="anthropic" />
        </TabPanel>
        <TabPanel active={active === 'model' && provider === 'openai'}>
          <CloudProviderPanel provider="openai" />
        </TabPanel>
        <TabPanel active={active === 'model' && provider === 'zai'}>
          <CloudProviderPanel provider="zai" />
        </TabPanel>
        <TabPanel active={active === 'model' && provider === 'deepseek'}>
          <CloudProviderPanel provider="deepseek" />
        </TabPanel>
        <TabPanel active={active === 'model' && provider === 'mimo'}>
          <CloudProviderPanel provider="mimo" />
        </TabPanel>
        <TabPanel active={active === 'model' && provider === 'kimi'}>
          <CloudProviderPanel provider="kimi" />
        </TabPanel>
        <TabPanel active={active === 'model' && provider === 'minimax'}>
          <CloudProviderPanel provider="minimax" />
        </TabPanel>
        <TabPanel active={active === 'model' && provider === 'xai'}>
          <CloudProviderPanel provider="xai" />
        </TabPanel>
        <TabPanel active={active === 'model' && provider === 'qwen'}>
          <CloudProviderPanel provider="qwen" />
        </TabPanel>
        <TabPanel active={active === 'model' && provider === 'stepfun'}>
          <CloudProviderPanel provider="stepfun" />
        </TabPanel>
        <TabPanel active={active === 'model' && provider === 'openrouter'}>
          <CloudProviderPanel provider="openrouter" />
        </TabPanel>
        <TabPanel active={active === 'services' && service === 'tts'}>
          <TextToSpeechPanel />
        </TabPanel>
        <TabPanel active={active === 'services' && service === 'stt'}>
          <SpeechToTextPanel />
        </TabPanel>
        <TabPanel active={active === 'channels' && channel === 'mobile'}>
          <MobilePanel />
        </TabPanel>
        <TabPanel active={active === 'channels' && channel === 'telegram'}>
          <TelegramPanel />
        </TabPanel>
        <TabPanel active={active === 'channels' && channel === 'whatsapp'}>
          <WhatsAppPanel />
        </TabPanel>
        <TabPanel active={active === 'channels' && channel === 'inapp'}>
          <InAppPanel />
        </TabPanel>
        <TabPanel active={active === 'channels' && channel === 'cli'}>
          <CliPanel />
        </TabPanel>
        <TabPanel active={active === 'mcp'}>
          <McpPanel />
        </TabPanel>
        <TabPanel active={active === 'services' && service === 'browserExtension'}>
          <BrowserExtensionPanel />
        </TabPanel>
        <TabPanel active={active === 'services' && service === 'brave'}>
          <BravePanel />
        </TabPanel>
        <TabPanel active={active === 'services' && service === 'google'}>
          <GooglePanel />
        </TabPanel>
        <TabPanel active={active === 'services' && service === 'memes'}>
          <MemesPanel />
        </TabPanel>
        <TabPanel active={active === 'services' && service === 'video'}>
          <VideoPanel />
        </TabPanel>
        <TabPanel active={active === 'services' && service === 'notion'}>
          <NotionPanel />
        </TabPanel>
        <TabPanel active={active === 'services' && service === 'github'}>
          <GitHubPanel />
        </TabPanel>
        <TabPanel active={active === 'services' && service === 'computerUse'}>
          <ComputerUsePanel />
        </TabPanel>
      </div>
    </main>
  )
}

function TabPanel({
  active,
  children
}: {
  active: boolean
  children: ReactNode
}): React.JSX.Element | null {
  if (!active) return null
  return <>{children}</>
}

type Provider =
  | 'ollama'
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
const PROVIDERS: Provider[] = [
  'qwen',
  'mimo',
  'zai',
  'deepseek',
  'kimi',
  'minimax',
  'stepfun',
  'anthropic',
  'xai',
  'openai',
  'openrouter',
  'ollama'
]

const PROVIDER_ICONS: Record<
  Provider,
  IconType | React.ComponentType<{ size?: number; className?: string }>
> = {
  ollama: OllamaLogo,
  anthropic: AnthropicLogo,
  openai: OpenAILogo,
  openrouter: OpenRouterLogo,
  deepseek: DeepSeekLogo,
  mimo: MimoLogo,
  kimi: KimiLogo,
  minimax: MiniMaxLogo,
  xai: XAILogo,
  qwen: QwenLogo,
  stepfun: StepfunLogo,
  zai: ZaiLogo
}

type NavIconComponent = React.ComponentType<{ size?: number }>

/**
 * Sub-nav glyphs come from two families that do not agree on how much of the
 * 24-unit box the art fills: hugeicons line icons draw into roughly 86/96,
 * while Simple Icons brand marks are solid and run the full 96. Drawn at one
 * size the brand marks read a size larger than everything around them, and the
 * few sparser line icons read a size smaller, so those outliers get nudged
 * until every glyph lands on the same optical size. Sizes are measured ink
 * extents, not guesses — see NavIcon for why the box stays fixed.
 */
const NAV_ICON_SIZE = 14
const NAV_ICON_SIZE_OVERRIDES = new Map<NavIconComponent, number>([
  [BraveLogo, 13],
  [GoogleLogo, 13],
  [NotionLogo, 13],
  [TelegramLogo, 13],
  [BrowserIcon, 15],
  [ComputerTerminal01Icon, 15]
])

/**
 * The glyph resizes but its box does not — a 13px mark and a 15px icon both
 * occupy 14px, so labels stay flush down the column instead of stepping in and
 * out by a pixel per row.
 */
function NavIcon({ icon: Icon }: { icon: NavIconComponent }): React.JSX.Element {
  return (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <Icon size={NAV_ICON_SIZE_OVERRIDES.get(Icon) ?? NAV_ICON_SIZE} />
    </span>
  )
}

type Channel = 'inapp' | 'cli' | 'mobile' | 'telegram' | 'whatsapp'
const CHANNELS: Channel[] = ['inapp', 'cli', 'mobile', 'telegram', 'whatsapp']

const CHANNEL_ICONS: Record<Channel, NavIconComponent> = {
  inapp: ComputerIcon,
  cli: ComputerTerminal01Icon,
  mobile: SmartPhone01Icon,
  telegram: TelegramLogo,
  whatsapp: WhatsappIcon
}

type KnowledgeTab = 'compaction' | 'reflection'
const KNOWLEDGE_TABS: KnowledgeTab[] = ['compaction', 'reflection']

type Service =
  | 'browserExtension'
  | 'brave'
  | 'notion'
  | 'github'
  | 'google'
  | 'memes'
  | 'video'
  | 'tts'
  | 'stt'
  | 'computerUse'

// Every service, always. Pages that depend on a cerebellum capability
// gate themselves with an alert card instead of vanishing from the nav.
const SERVICES: Service[] = [
  'browserExtension',
  'brave',
  'google',
  'memes',
  'video',
  'notion',
  'github',
  'tts',
  'stt',
  'computerUse'
]

const SERVICE_ICONS: Record<Service, NavIconComponent> = {
  browserExtension: BrowserIcon,
  brave: BraveLogo,
  notion: NotionLogo,
  github: GithubIcon,
  google: GoogleLogo,
  memes: SmileDizzyIcon,
  video: Video01Icon,
  tts: VolumeHighIcon,
  stt: Mic01Icon,
  computerUse: ComputerIcon
}

function OllamaNotAvailableNotice({
  goTo,
  t
}: {
  goTo: (screen: 'ollama-setup', returnTo: 'settings') => void
  t: (k: string) => string
}): React.JSX.Element {
  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.model.providers.ollama')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">
            {t('settings.model.ollamaNotAvailable.subtitle')}
          </p>
        </header>
        <section className="border-border bg-surface flex flex-col items-center gap-4 rounded-2xl border p-8 text-center">
          <OllamaLogo size={36} className="text-muted" />
          <p className="text-fg text-sm leading-relaxed">
            {t('settings.model.ollamaNotAvailable.description')}
          </p>
          <button
            type="button"
            onClick={() => goTo('ollama-setup', 'settings')}
            className={cn(
              'bg-primary text-primary-fg cursor-pointer rounded-lg px-5 py-2 text-sm font-medium',
              'hover:brightness-110',
              'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
            )}
          >
            {t('settings.model.ollamaNotAvailable.setup')}
          </button>
        </section>
      </div>
    </div>
  )
}

function AppearancePanel(): React.JSX.Element {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { locale, setLocale } = useLocale()
  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.appearance.title')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">{t('settings.appearance.subtitle')}</p>
        </header>
        <section className="bg-surface border-border flex flex-col gap-6 rounded-2xl border p-6">
          <AppearanceChoice<ThemeSource>
            label={t('theme.label')}
            description={t('settings.appearance.theme.description')}
            value={theme}
            options={[
              { value: 'system', label: t('theme.system') },
              { value: 'light', label: t('theme.light') },
              { value: 'dark', label: t('theme.dark') }
            ]}
            onChange={(next) => void setTheme(next)}
          />
          <div className="border-border/60 border-t" />
          <AppearanceChoice<SupportedLocale>
            label={t('locale.label')}
            description={t('settings.appearance.language.description')}
            value={locale}
            options={[
              { value: 'en', label: t('locale.en') },
              { value: 'ar', label: t('locale.ar') }
            ]}
            onChange={(next) => void setLocale(next)}
          />
        </section>
      </div>
    </div>
  )
}

function AppearanceChoice<T extends string>({
  label,
  description,
  value,
  options,
  onChange
}: {
  label: string
  description: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (next: T) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-fg text-sm font-medium">{label}</span>
        <div
          role="tablist"
          className="border-border bg-bg/40 inline-flex shrink-0 items-center rounded-lg border p-0.5"
        >
          {options.map((opt) => {
            const active = opt.value === value
            return (
              <button
                key={opt.value}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => onChange(opt.value)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  active
                    ? 'bg-primary text-primary-fg shadow-sm'
                    : 'text-muted hover:text-fg cursor-pointer'
                )}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
      <p className="text-muted text-xs leading-relaxed">{description}</p>
    </div>
  )
}
