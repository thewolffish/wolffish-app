import { Select, type SelectOption } from '@components/core/Select'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn'
import type { CompactionConfig } from '@preload/index'
import { useFlow } from '@providers/flow/useFlow'
import { useLocale } from '@providers/locale/useLocale'
import { Refresh01Icon } from 'hugeicons-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const HOUR_OPTIONS: SelectOption<string>[] = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${String(i).padStart(2, '0')}:00`
}))

export function CompactionPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()
  const { locale } = useLocale()
  const { refreshStatus } = useFlow()

  const [config, setConfig] = useState<CompactionConfig | null>(null)
  const [saving, setSaving] = useState<'daily' | 'weekly' | null>(null)
  const [resyncing, setResyncing] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    void window.api.runtime.getCompactionConfig().then((cfg) => {
      if (!cancelled) setConfig(cfg)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const onResync = async (): Promise<void> => {
    setResyncing(true)
    try {
      const cfg = await window.api.runtime.getCompactionConfig()
      setConfig(cfg)
      setNow(Date.now())
      toast.show({
        tone: 'success',
        message: t('settings.hippocampus.compaction.resyncSuccessToast')
      })
    } catch {
      toast.show({ tone: 'error', message: t('settings.hippocampus.compaction.resyncErrorToast') })
    } finally {
      setResyncing(false)
    }
  }

  // Tick every 60s so the "runs in …" label stays fresh
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const persist = async (
    patch: Partial<CompactionConfig>,
    key: 'daily' | 'weekly'
  ): Promise<void> => {
    if (saving !== null) return
    setSaving(key)
    try {
      const updated = await window.api.runtime.setCompactionConfig(patch)
      setConfig(updated)
      await refreshStatus()
    } finally {
      setSaving(null)
    }
  }

  const dayOptions = useMemo<SelectOption<string>[]>(
    () =>
      [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        value: String(d),
        label: t(`settings.hippocampus.compaction.days.${d}`)
      })),
    [t]
  )

  if (!config) return <div />

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-fg text-2xl font-semibold tracking-tight">
              {t('settings.hippocampus.compaction.title')}
            </h1>
            <p className="text-muted text-sm leading-relaxed">
              {t('settings.hippocampus.compaction.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onResync()}
            disabled={resyncing}
            aria-label={t('settings.hippocampus.compaction.resync')}
            className={cn(
              'inline-flex items-center gap-1 rounded-md text-xs cursor-pointer transition-colors',
              'text-muted hover:text-fg px-1.5 py-0.5',
              'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              'disabled:cursor-not-allowed disabled:opacity-40'
            )}
          >
            <Refresh01Icon size={14} />
            <span>{t('settings.hippocampus.compaction.resync')}</span>
          </button>
        </header>

        <section className="bg-surface border-border flex items-center justify-between rounded-2xl border px-6 py-4">
          <span className="text-fg text-sm font-medium">
            {new Date(now).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
          </span>
          <code className="text-muted bg-bg/60 border-border/40 rounded border px-2 py-1 text-[11px]">
            {new Intl.DateTimeFormat(locale, { timeZoneName: 'long' })
              .formatToParts(now)
              .find((p) => p.type === 'timeZoneName')?.value ??
              Intl.DateTimeFormat().resolvedOptions().timeZone}
          </code>
        </section>

        <section className="bg-surface border-border flex flex-col gap-6 rounded-2xl border p-6">
          {/* Daily compaction */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-fg text-sm font-medium">
                {t('settings.hippocampus.compaction.daily.label')}
              </span>
              <Select<string>
                className="min-w-28"
                value={String(config.dailyHour)}
                options={HOUR_OPTIONS}
                onChange={(v) => persist({ dailyHour: Number(v) }, 'daily')}
                disabled={saving === 'daily'}
              />
            </div>
            <p className="text-muted text-xs leading-relaxed">
              {t('settings.hippocampus.compaction.daily.description')}
            </p>
            <NextRun ms={nextDailyMs(config.dailyHour, now)} locale={locale} />
          </div>

          <div className="border-border/60 border-t" />

          {/* Weekly consolidation */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-fg text-sm font-medium">
                {t('settings.hippocampus.compaction.weekly.label')}
              </span>
              <div className="flex items-center gap-2">
                <Select<string>
                  className="min-w-32"
                  value={String(config.weeklyDay)}
                  options={dayOptions}
                  onChange={(v) => persist({ weeklyDay: Number(v) }, 'weekly')}
                  disabled={saving === 'weekly'}
                />
                <Select<string>
                  className="min-w-28"
                  value={String(config.weeklyHour)}
                  options={HOUR_OPTIONS}
                  onChange={(v) => persist({ weeklyHour: Number(v) }, 'weekly')}
                  disabled={saving === 'weekly'}
                />
              </div>
            </div>
            <p className="text-muted text-xs leading-relaxed">
              {t('settings.hippocampus.compaction.weekly.description')}
            </p>
            <NextRun ms={nextWeeklyMs(config.weeklyDay, config.weeklyHour, now)} locale={locale} />
          </div>
        </section>
      </div>
    </div>
  )
}

// ── "runs in …" helpers ──────────────────────────────────────────────

function nextDailyMs(hour: number, nowMs: number): number {
  const d = new Date(nowMs)
  d.setHours(hour, 0, 0, 0)
  if (d.getTime() <= nowMs) d.setDate(d.getDate() + 1)
  return d.getTime() - nowMs
}

function nextWeeklyMs(day: number, hour: number, nowMs: number): number {
  const d = new Date(nowMs)
  d.setHours(hour, 0, 0, 0)
  const diff = (day - d.getDay() + 7) % 7
  d.setDate(d.getDate() + (diff === 0 && d.getTime() <= nowMs ? 7 : diff))
  return d.getTime() - nowMs
}

function formatFromNow(ms: number, locale: string): string {
  const totalMinutes = Math.round(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const days = Math.floor(hours / 24)

  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    if (days > 0) return rtf.format(days, 'day')
    if (hours > 0) return rtf.format(hours, 'hour')
    return rtf.format(totalMinutes, 'minute')
  } catch {
    if (days > 0) return `in ${days}d`
    if (hours > 0) return `in ${hours}h`
    return `in ${totalMinutes}m`
  }
}

function NextRun({ ms, locale }: { ms: number; locale: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <code className="text-muted bg-bg/60 border-border/40 inline-block self-start rounded border px-2 py-1 text-[11px]">
      {t('settings.hippocampus.compaction.nextRun', { time: formatFromNow(ms, locale) })}
    </code>
  )
}
