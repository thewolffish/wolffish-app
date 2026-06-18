import { ActivityHeatmap } from '@components/charts/activity-heatmap/ActivityHeatmap'
import {
  AnthropicLogo,
  BraveLogo,
  DeepSeekLogo,
  KimiLogo,
  MiniMaxLogo,
  MimoLogo,
  OllamaLogo,
  OpenAILogo,
  OpenRouterLogo,
  XAILogo,
  QwenLogo,
  StepfunLogo
} from '@components/core/ProviderLogos'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn'
import type {
  BraveUsageSummary,
  UsageDailyEntry,
  UsageProviderSummary,
  UsageStats,
  UsageSummary,
  UsageTimeRange
} from '@preload/index'
import { useFlow } from '@providers/flow/useFlow'
import {
  BubbleChatIcon,
  CalendarCheckOut02Icon,
  Database02Icon,
  Fire03Icon,
  MessageMultiple01Icon,
  Refresh01Icon,
  StarIcon
} from 'hugeicons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type IconComp = React.ComponentType<{ size?: number; className?: string }>

type ProviderId =
  | 'local'
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

const TIME_RANGES: UsageTimeRange[] = [
  'today',
  'this_month',
  '3_months',
  '6_months',
  'ytd',
  'all_time'
]

const PROVIDER_ICONS: Record<ProviderId, React.ComponentType<{ size: number }>> = {
  local: OllamaLogo,
  anthropic: AnthropicLogo,
  openai: OpenAILogo,
  openrouter: OpenRouterLogo,
  deepseek: DeepSeekLogo,
  mimo: MimoLogo,
  kimi: KimiLogo,
  minimax: MiniMaxLogo,
  xai: XAILogo,
  qwen: QwenLogo,
  stepfun: StepfunLogo
}

export function UsagePanel(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()
  const { status } = useFlow()
  const weekStartsOn = status?.config?.weekStartsOn ?? 1
  const [range, setRange] = useState<UsageTimeRange>('all_time')
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [daily, setDaily] = useState<UsageDailyEntry[] | null>(null)
  const year = new Date().getFullYear()
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    let stale = false
    Promise.all([window.api.usage.getSummary(range), window.api.usage.getStats(range)]).then(
      ([s, st]) => {
        if (stale) return
        setSummary(s)
        setStats(st)
      }
    )
    return () => {
      stale = true
    }
  }, [range])

  useEffect(() => {
    let stale = false
    window.api.usage.getDaily(year).then((data) => {
      if (!stale) setDaily(data)
    })
    return () => {
      stale = true
    }
  }, [year])

  const onSync = async (): Promise<void> => {
    if (syncing) return
    setSyncing(true)
    try {
      await window.api.usage.sync()
      const [s, st, d] = await Promise.all([
        window.api.usage.getSummary(range),
        window.api.usage.getStats(range),
        window.api.usage.getDaily(year)
      ])
      setSummary(s)
      setStats(st)
      setDaily(d)
      toast.show({ tone: 'success', message: t('settings.usage.syncSuccessToast') })
    } catch {
      toast.show({ tone: 'error', message: t('settings.usage.syncErrorToast') })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-fg text-2xl font-semibold tracking-tight">
              {t('settings.usage.title')}
            </h1>
            <p className="text-muted text-sm leading-relaxed">{t('settings.usage.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => void onSync()}
            disabled={syncing}
            aria-label={t('settings.usage.sync')}
            className={cn(
              'inline-flex items-center gap-1 rounded-md text-xs cursor-pointer transition-colors',
              'text-muted hover:text-fg px-1.5 py-0.5',
              'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              'disabled:cursor-not-allowed disabled:opacity-40'
            )}
          >
            <Refresh01Icon size={14} />
            <span>{t('settings.usage.sync')}</span>
          </button>
        </header>

        <RangeSelector range={range} onChange={setRange} />

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-fg text-sm font-semibold">{t('settings.usage.activity')}</h2>
            <span className="text-muted text-xs font-medium tabular-nums">{year}</span>
          </div>
          {daily === null ? (
            <ActivityMapSkeleton />
          ) : (
            <ActivityHeatmap
              entries={toEntries(daily)}
              year={year}
              weekStartsOn={weekStartsOn}
              showMonthLabels={false}
              showWeekdayLabels={false}
              formatTooltip={(e) =>
                t('settings.usage.activityTooltip', {
                  date: e.date,
                  tokens: formatNumber(e.value)
                })
              }
            />
          )}
        </section>

        {stats === null ? <StatsGridSkeleton /> : <StatsGrid stats={stats} />}

        {summary === null ? (
          <ProviderCardsSkeleton />
        ) : (
          <div className="flex flex-col gap-3">
            {summary.providers.map((p) => (
              <ProviderCard key={p.provider} provider={p} />
            ))}
            <BraveSearchCard brave={summary.brave} />
          </div>
        )}
      </div>
    </div>
  )
}

function toEntries(daily: UsageDailyEntry[]): Array<{ date: string; value: number }> {
  return daily.map((d) => ({ date: d.date, value: d.totalTokens }))
}

function RangeSelector({
  range,
  onChange
}: {
  range: UsageTimeRange
  onChange: (r: UsageTimeRange) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="bg-surface border-border flex rounded-lg border p-0.5">
      {TIME_RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={cn(
            'flex-1 cursor-pointer rounded-md px-2 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors',
            'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            range === r ? 'bg-primary text-primary-fg shadow-sm' : 'text-muted hover:text-fg'
          )}
        >
          {t(`settings.usage.range.${r}`)}
        </button>
      ))}
    </div>
  )
}

function ProviderCard({ provider }: { provider: UsageProviderSummary }): React.JSX.Element {
  const { t } = useTranslation()
  const Logo = PROVIDER_ICONS[provider.provider]
  const totalTokens = provider.totalInputTokens + provider.totalOutputTokens
  const hasUsage = totalTokens > 0

  return (
    <div
      className={cn('bg-surface border-border rounded-xl border p-4', !hasUsage && 'opacity-50')}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo size={16} />
          <span className="text-fg text-sm font-medium">
            {t(`settings.usage.providers.${provider.provider}`)}
          </span>
        </div>
        {hasUsage ? (
          <div className="flex items-center gap-4">
            <span className="text-muted text-xs">
              {formatNumber(totalTokens)} {t('settings.usage.tokens')}
            </span>
            <span className="text-fg text-xs font-medium">${provider.totalCost.toFixed(2)}</span>
          </div>
        ) : (
          <span className="text-muted text-xs">{t('settings.usage.noUsage')}</span>
        )}
      </div>

      {hasUsage && provider.models.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {provider.models.map((m) => (
            <div key={m.model} className="flex items-center justify-between text-xs">
              <span className="text-muted truncate max-w-[200px]">{m.model}</span>
              <div className="flex items-center gap-3">
                <span className="text-muted">
                  {formatNumber(m.inputTokens + m.outputTokens)} {t('settings.usage.tokens')}
                </span>
                <span className="text-muted">${m.cost.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BraveSearchCard({ brave }: { brave: BraveUsageSummary }): React.JSX.Element {
  const { t } = useTranslation()
  const hasUsage = brave.totalQueries > 0

  return (
    <div
      className={cn('bg-surface border-border rounded-xl border p-4', !hasUsage && 'opacity-50')}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BraveLogo size={16} />
          <span className="text-fg text-sm font-medium">{t('settings.usage.providers.brave')}</span>
        </div>
        {hasUsage ? (
          <div className="flex items-center gap-4">
            <span className="text-muted text-xs">
              {formatNumber(brave.totalQueries)} {t('settings.usage.queries')}
            </span>
            <span className="text-fg text-xs font-medium">${brave.totalCost.toFixed(2)}</span>
          </div>
        ) : (
          <span className="text-muted text-xs">{t('settings.usage.noUsage')}</span>
        )}
      </div>
    </div>
  )
}

function StatsGrid({ stats }: { stats: UsageStats }): React.JSX.Element {
  const { t } = useTranslation()
  const items: Array<{ label: string; value: string; icon: IconComp }> = [
    {
      label: t('settings.usage.stats.conversations'),
      value: formatNumber(stats.conversations),
      icon: MessageMultiple01Icon
    },
    {
      label: t('settings.usage.stats.messages'),
      value: formatNumber(stats.messages),
      icon: BubbleChatIcon
    },
    {
      label: t('settings.usage.stats.totalTokens'),
      value: formatNumber(stats.totalTokens),
      icon: Database02Icon
    },
    {
      label: t('settings.usage.stats.activeDays'),
      value: formatNumber(stats.activeDays),
      icon: CalendarCheckOut02Icon
    },
    {
      label: t('settings.usage.stats.longestStreak'),
      value: t(
        stats.longestStreak === 1
          ? 'settings.usage.stats.streakDay'
          : 'settings.usage.stats.streakDays',
        {
          count: stats.longestStreak
        }
      ),
      icon: Fire03Icon
    },
    {
      label: t('settings.usage.stats.favouriteModel'),
      value: stats.favouriteModel ?? t('settings.usage.stats.noModel'),
      icon: StarIcon
    }
  ]
  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map((it) => (
        <StatCard key={it.label} label={it.label} value={it.value} Icon={it.icon} />
      ))}
    </div>
  )
}

function StatCard({
  label,
  value,
  Icon
}: {
  label: string
  value: string
  Icon: IconComp
}): React.JSX.Element {
  return (
    <div className="bg-surface border-border flex flex-col gap-1 rounded-xl border p-3">
      <div className="text-muted flex items-center gap-1.5 text-[11px]">
        <Icon size={12} />
        <span className="truncate">{label}</span>
      </div>
      <span className="text-fg truncate text-sm font-semibold tabular-nums">{value}</span>
    </div>
  )
}

function StatsGridSkeleton(): React.JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="bg-surface border-border flex flex-col gap-2 rounded-xl border p-3">
          <div className="bg-border/60 h-3 w-16 animate-pulse rounded" />
          <div className="bg-border/60 h-4 w-12 animate-pulse rounded" />
        </div>
      ))}
    </div>
  )
}

function ProviderCardsSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-surface border-border rounded-xl border p-4">
          <div className="flex items-center justify-between">
            <div className="bg-border/60 h-4 w-24 animate-pulse rounded" />
            <div className="bg-border/60 h-4 w-20 animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ActivityMapSkeleton(): React.JSX.Element {
  return (
    <div className="bg-surface border-border rounded-xl border p-4">
      <div className="bg-border/60 h-[100px] w-full animate-pulse rounded" />
    </div>
  )
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
