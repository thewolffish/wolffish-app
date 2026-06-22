import { LocaleSelector } from '@components/common/locale-selector/LocaleSelector'
import { ThemeSelector } from '@components/common/theme-selector/ThemeSelector'
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
import { RTL_LOCALES } from '@lib/i18n'
import { cn } from '@lib/utils/cn'
import { ModelPicker } from '@pages/ModelPicker'
import { BravePanel } from '@pages/settings/BravePanel'
import { BrowserExtensionPanel } from '@pages/settings/BrowserExtensionPanel'
import { CelebrumPanel } from '@pages/settings/CelebrumPanel'
import { CloudProviderPanel } from '@pages/settings/CloudProviderPanel'
import { CompactionPanel } from '@pages/settings/CompactionPanel'
import { ComputerUsePanel } from '@pages/settings/ComputerUsePanel'
import { DataPanel } from '@pages/settings/DataPanel'
import { GitHubPanel } from '@pages/settings/GitHubPanel'
import { GooglePanel } from '@pages/settings/GooglePanel'
import { prefetchGooglePanel } from '@pages/settings/googleSnapshot'
import { MemesPanel } from '@pages/settings/MemesPanel'
import { NotionPanel } from '@pages/settings/NotionPanel'
import { SpeechToTextPanel } from '@pages/settings/SpeechToTextPanel'
import { TelegramPanel } from '@pages/settings/TelegramPanel'
import { TextToSpeechPanel } from '@pages/settings/TextToSpeechPanel'
import { UpdatesPanel } from '@pages/settings/UpdatesPanel'
import { UsagePanel } from '@pages/settings/UsagePanel'
import { VariablesPanel } from '@pages/settings/VariablesPanel'
import { WhatsAppPanel } from '@pages/settings/WhatsAppPanel'
import { WolffishPanel } from '@pages/settings/WolffishPanel'
import { useFlow } from '@providers/flow/useFlow'
import { useLocale } from '@providers/locale/useLocale'
import {
  AiBrain01Icon,
  AiMagicIcon,
  AnalyticsUpIcon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  ArrowUp02Icon,
  BrainIcon,
  BrowserIcon,
  BubbleChatIcon,
  CloudIcon,
  ComputerIcon,
  Database02Icon,
  DnaIcon,
  GithubIcon,
  Key01Icon,
  Mic01Icon,
  PaintBoardIcon,
  PuzzleIcon,
  SmileDizzyIcon,
  VolumeHighIcon,
  WhatsappIcon
} from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { IconType } from 'react-icons'

import { consumeNextTab, type TabKey } from '@pages/settings/settingsNav'
export type { TabKey } from '@pages/settings/settingsNav'

type Tab = {
  key: TabKey
  icon: React.ReactNode
  labelKey: string
}

const TABS: Tab[] = [
  { key: 'model', icon: <AiBrain01Icon size={18} />, labelKey: 'settings.tabs.model' },
  { key: 'channels', icon: <BubbleChatIcon size={18} />, labelKey: 'settings.tabs.channels' },
  { key: 'services', icon: <PuzzleIcon size={18} />, labelKey: 'settings.tabs.services' },
  { key: 'variables', icon: <Key01Icon size={18} />, labelKey: 'settings.tabs.variables' },
  { key: 'cellebrum', icon: <BrainIcon size={18} />, labelKey: 'settings.tabs.cellebrum' },
  { key: 'hippocampus', icon: <DnaIcon size={18} />, labelKey: 'settings.tabs.hippocampus' },
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
  hippocampusTab: HippocampusTab
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
      s?.channel && CHANNELS.includes(s.channel as Channel) ? (s.channel as Channel) : 'telegram',
    service: s?.service ? (s.service as Service) : 'browserExtension',
    hippocampusTab:
      s?.hippocampusTab && HIPPOCAMPUS_TABS.includes(s.hippocampusTab as HippocampusTab)
        ? (s.hippocampusTab as HippocampusTab)
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
  const [hippocampusTab, setHippocampusTabRaw] = useState<HippocampusTab>(snapshot.hippocampusTab)

  const setActive = useCallback(
    (key: TabKey) => {
      setActiveRaw(key)
      memo = { ...(memo ?? snapshot), tab: key }
      persistField('tab', key)
    },
    [snapshot]
  )

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

  const setHippocampusTab = useCallback(
    (ht: HippocampusTab) => {
      setHippocampusTabRaw(ht)
      memo = { ...(memo ?? snapshot), hippocampusTab: ht }
      persistField('hippocampusTab', ht)
    },
    [snapshot]
  )

  // The TTS and STT panels only make sense when their cerebellum
  // capabilities are loaded — without the plugin folders, the saved
  // config has no plugin to read it. Telegram is in-process and
  // doesn't need a capability folder, so it's always visible.
  // Probe the cerebellum once on mount and filter the Services
  // sub-tabs to whatever's actually present.
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

  const [loadedCapabilities, setLoadedCapabilities] = useState<Set<string> | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.cerebellum.listCapabilities().then((caps) => {
      if (cancelled) return
      const ok = caps.filter((c) => c.status === 'ok' && c.enabled).map((c) => c.name)
      setLoadedCapabilities(new Set(ok))
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Warm up the Google Workspace snapshot the moment Settings opens, so
  // by the time the user clicks the Google Workspace tab the data is
  // already populated and the panel renders without a flash.
  useEffect(() => {
    void prefetchGooglePanel().catch(() => {})
  }, [])

  const visibleServices = useMemo<Service[]>(() => {
    const caps = loadedCapabilities
    // Brave and Google are always visible — Brave only gates the
    // web-search plugin, and Google depends on an external binary (gog)
    // rather than a cerebellum capability folder.
    if (!caps) return ['browserExtension', 'brave', 'google']
    const out: Service[] = ['browserExtension', 'brave', 'google']
    if (caps.has('memes')) out.push('memes')
    if (caps.has('notion')) out.push('notion')
    if (caps.has('github')) out.push('github')
    if (caps.has('text-to-speech')) out.push('tts')
    if (caps.has('speech-to-text')) out.push('stt')
    if (caps.has('computer-use')) out.push('computerUse')
    return out
  }, [loadedCapabilities])

  // Derive the effective sub-tab at render time. If the user's
  // currently-selected service disappeared (capability got removed
  // mid-session), pretend they're on the first available one
  // without triggering an effect-driven setState.
  const effectiveService: Service = visibleServices.includes(service)
    ? service
    : loadedCapabilities
      ? (visibleServices[0] ?? 'brave')
      : service

  const ttsAvailable = visibleServices.includes('tts')
  const sttAvailable = visibleServices.includes('stt')
  const notionAvailable = visibleServices.includes('notion')
  const githubAvailable = visibleServices.includes('github')
  const memesAvailable = visibleServices.includes('memes')
  const computerUseAvailable = visibleServices.includes('computerUse')

  return (
    <main
      className={cn(
        'bg-bg flex h-full w-full',
        navigator.platform.startsWith('Win') ? 'pt-5' : 'pt-10'
      )}
    >
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

                {/* Nested sub-tabs (currently only Model has them). The
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
                      <div className="flex flex-col gap-0.5 ps-7">
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
                                  className="text-muted ms-auto shrink-0"
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
                      <div className="flex flex-col gap-0.5 ps-7">
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
                              <Icon size={14} />
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
                      <div className="flex flex-col gap-0.5 ps-7">
                        {visibleServices.map((s) => {
                          const subActive = isActive && effectiveService === s
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
                              <Icon size={14} />
                              <span>{t(`settings.services.tabs.${s}`)}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {tab.key === 'hippocampus' && (
                  <div
                    className={cn(
                      'grid transition-[grid-template-rows] duration-200 ease-out',
                      isActive ? 'mt-1 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                    )}
                  >
                    <div className="overflow-hidden">
                      <div className="flex flex-col gap-0.5 ps-7">
                        {HIPPOCAMPUS_TABS.map((ht) => {
                          const subActive = isActive && hippocampusTab === ht
                          return (
                            <button
                              key={ht}
                              type="button"
                              tabIndex={isActive ? 0 : -1}
                              onClick={() => setHippocampusTab(ht)}
                              className={cn(
                                'flex items-center gap-2 rounded-lg px-3 py-1.5 text-start text-sm cursor-pointer whitespace-nowrap',
                                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                                subActive
                                  ? 'bg-border/50 text-fg font-medium'
                                  : 'text-muted hover:bg-border/30 hover:text-fg'
                              )}
                            >
                              <span>{t(`settings.hippocampus.tabs.${ht}`)}</span>
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
        <TabPanel active={active === 'cellebrum'}>
          <CelebrumPanel />
        </TabPanel>
        <TabPanel active={active === 'hippocampus' && hippocampusTab === 'compaction'}>
          <CompactionPanel />
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
        <TabPanel active={active === 'services' && effectiveService === 'tts' && ttsAvailable}>
          <TextToSpeechPanel />
        </TabPanel>
        <TabPanel active={active === 'services' && effectiveService === 'stt' && sttAvailable}>
          <SpeechToTextPanel />
        </TabPanel>
        <TabPanel active={active === 'channels' && channel === 'telegram'}>
          <TelegramPanel />
        </TabPanel>
        <TabPanel active={active === 'channels' && channel === 'whatsapp'}>
          <WhatsAppPanel />
        </TabPanel>
        <TabPanel active={active === 'services' && effectiveService === 'browserExtension'}>
          <BrowserExtensionPanel />
        </TabPanel>
        <TabPanel active={active === 'services' && effectiveService === 'brave'}>
          <BravePanel />
        </TabPanel>
        <TabPanel active={active === 'services' && effectiveService === 'google'}>
          <GooglePanel />
        </TabPanel>
        <TabPanel active={active === 'services' && effectiveService === 'memes' && memesAvailable}>
          <MemesPanel />
        </TabPanel>
        <TabPanel
          active={active === 'services' && effectiveService === 'notion' && notionAvailable}
        >
          <NotionPanel />
        </TabPanel>
        <TabPanel
          active={active === 'services' && effectiveService === 'github' && githubAvailable}
        >
          <GitHubPanel />
        </TabPanel>
        <TabPanel
          active={
            active === 'services' && effectiveService === 'computerUse' && computerUseAvailable
          }
        >
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

type Channel = 'telegram' | 'whatsapp'
const CHANNELS: Channel[] = ['telegram', 'whatsapp']

const CHANNEL_ICONS: Record<Channel, React.ComponentType<{ size?: number }>> = {
  telegram: TelegramLogo,
  whatsapp: WhatsappIcon
}

type HippocampusTab = 'compaction'
const HIPPOCAMPUS_TABS: HippocampusTab[] = ['compaction']

type Service =
  | 'browserExtension'
  | 'brave'
  | 'notion'
  | 'github'
  | 'google'
  | 'memes'
  | 'tts'
  | 'stt'
  | 'computerUse'

const SERVICE_ICONS: Record<Service, React.ComponentType<{ size?: number }>> = {
  browserExtension: BrowserIcon,
  brave: BraveLogo,
  notion: NotionLogo,
  github: GithubIcon,
  google: GoogleLogo,
  memes: SmileDizzyIcon,
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
  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.appearance.title')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">{t('settings.appearance.subtitle')}</p>
        </header>
        <section className="bg-surface border-border flex flex-col gap-5 rounded-2xl border p-6">
          <ThemeSelector />
          <LocaleSelector />
        </section>
      </div>
    </div>
  )
}
