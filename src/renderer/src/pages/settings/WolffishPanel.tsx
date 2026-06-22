import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn'
import type { WeekStartsOn } from '@preload/index'
import { useFlow } from '@providers/flow/useFlow'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function WolffishPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const { show } = useToast()
  const { status, refreshStatus } = useFlow()
  const config = status?.config ?? null

  const [launchAtStartup, setLaunchAtStartupState] = useState<boolean | null>(null)
  const [startupActive, setStartupActive] = useState<boolean | null>(null)
  const [blockCredentials, setBlockCredentials] = useState<boolean>(
    config?.safety?.blockCredentials ?? false
  )
  const [bypass, setBypass] = useState<boolean>(config?.safety?.bypassPermissions ?? false)
  const [allowFallback, setAllowFallback] = useState<boolean>(
    config?.llm.allowLocalFallback ?? false
  )
  const [showAnalytics, setShowAnalytics] = useState<boolean>(config?.showChatAnalytics ?? true)
  const [restrictModels, setRestrictModels] = useState<boolean>(
    config?.llm.restrictPowerfulModels ?? true
  )
  const [weekStartsOn, setWeekStartsOnState] = useState<WeekStartsOn>(config?.weekStartsOn ?? 1)
  const [savingKey, setSavingKey] = useState<
    | 'launchAtStartup'
    | 'blockCredentials'
    | 'bypass'
    | 'fallback'
    | 'analytics'
    | 'restrictModels'
    | 'weekStart'
    | null
  >(null)

  useEffect(() => {
    let cancelled = false
    void window.api.runtime.getLaunchAtStartupStatus().then(({ active }) => {
      if (cancelled) return
      setStartupActive(active)
      setLaunchAtStartupState(active)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const onChangeLaunchAtStartup = async (next: boolean): Promise<void> => {
    if (savingKey !== null || next === launchAtStartup) return
    setSavingKey('launchAtStartup')
    try {
      const result = await window.api.runtime.setLaunchAtStartup(next)
      setLaunchAtStartupState(result.value)
      setStartupActive(result.active)
      await refreshStatus()
      if (next && result.active) {
        show({ message: t('settings.wolffish.launchAtStartup.enabledToast'), tone: 'success' })
      }
    } finally {
      setSavingKey(null)
    }
  }

  const onChangeBlockCredentials = async (next: boolean): Promise<void> => {
    if (savingKey !== null || next === blockCredentials) return
    setSavingKey('blockCredentials')
    try {
      await window.api.runtime.setBlockCredentials(next)
      setBlockCredentials(next)
      await refreshStatus()
    } finally {
      setSavingKey(null)
    }
  }

  const onChangeBypass = async (next: boolean): Promise<void> => {
    if (savingKey !== null || next === bypass) return
    setSavingKey('bypass')
    try {
      await window.api.runtime.setBypassPermissions(next)
      setBypass(next)
      await refreshStatus()
    } finally {
      setSavingKey(null)
    }
  }

  const onChangeFallback = async (next: boolean): Promise<void> => {
    if (savingKey !== null || next === allowFallback) return
    setSavingKey('fallback')
    try {
      await window.api.runtime.setAllowLocalFallback(next)
      setAllowFallback(next)
      await refreshStatus()
    } finally {
      setSavingKey(null)
    }
  }

  const onChangeAnalytics = async (next: boolean): Promise<void> => {
    if (savingKey !== null || next === showAnalytics) return
    setSavingKey('analytics')
    try {
      await window.api.runtime.setShowChatAnalytics(next)
      setShowAnalytics(next)
      await refreshStatus()
    } finally {
      setSavingKey(null)
    }
  }

  const onChangeRestrictModels = async (next: boolean): Promise<void> => {
    if (savingKey !== null || next === restrictModels) return
    setSavingKey('restrictModels')
    try {
      await window.api.runtime.setRestrictPowerfulModels(next)
      setRestrictModels(next)
      await refreshStatus()
    } finally {
      setSavingKey(null)
    }
  }

  const onChangeWeekStart = async (next: WeekStartsOn): Promise<void> => {
    if (savingKey !== null || next === weekStartsOn) return
    setSavingKey('weekStart')
    try {
      await window.api.runtime.setWeekStartsOn(next)
      setWeekStartsOnState(next)
      await refreshStatus()
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.wolffish.title')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">{t('settings.wolffish.subtitle')}</p>
        </header>

        <section className="bg-surface border-border flex flex-col gap-6 rounded-2xl border p-6">
          {launchAtStartup !== null && startupActive !== null ? (
            <StartupSetting
              value={launchAtStartup}
              active={startupActive}
              onChange={onChangeLaunchAtStartup}
              disabled={savingKey === 'launchAtStartup'}
            />
          ) : (
            <div className="h-[52px]" />
          )}
          <div className="border-border/60 border-t" />
          <SettingToggle
            label={t('settings.wolffish.blockCredentials.label')}
            description={t('settings.wolffish.blockCredentials.description')}
            value={blockCredentials}
            onChange={onChangeBlockCredentials}
            disabled={savingKey === 'blockCredentials'}
          />
          <div className="border-border/60 border-t" />
          <SettingToggle
            label={t('settings.wolffish.bypassPermissions.label')}
            description={t('settings.wolffish.bypassPermissions.description')}
            value={bypass}
            onChange={onChangeBypass}
            disabled={savingKey === 'bypass'}
          />
          <div className="border-border/60 border-t" />
          <SettingToggle
            label={t('settings.wolffish.allowLocalFallback.label')}
            description={t('settings.wolffish.allowLocalFallback.description')}
            value={allowFallback}
            onChange={onChangeFallback}
            disabled={savingKey === 'fallback'}
          />
          <div className="border-border/60 border-t" />
          <SettingToggle
            label={t('settings.wolffish.restrictPowerfulModels.label')}
            description={t('settings.wolffish.restrictPowerfulModels.description')}
            value={restrictModels}
            onChange={onChangeRestrictModels}
            disabled={savingKey === 'restrictModels'}
          />
          <div className="border-border/60 border-t" />
          <SettingToggle
            label={t('settings.wolffish.showChatAnalytics.label')}
            description={t('settings.wolffish.showChatAnalytics.description')}
            value={showAnalytics}
            onChange={onChangeAnalytics}
            disabled={savingKey === 'analytics'}
          />
          <div className="border-border/60 border-t" />
          <WeekStartChoice
            value={weekStartsOn}
            onChange={onChangeWeekStart}
            disabled={savingKey === 'weekStart'}
          />
        </section>
      </div>
    </div>
  )
}

function WeekStartChoice({
  value,
  onChange,
  disabled
}: {
  value: WeekStartsOn
  onChange: (next: WeekStartsOn) => void
  disabled?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const options = useMemo<Array<{ value: WeekStartsOn; label: string }>>(
    () => [
      { value: 0, label: t('settings.wolffish.weekStartsOn.sunday') },
      { value: 1, label: t('settings.wolffish.weekStartsOn.monday') }
    ],
    [t]
  )
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-fg text-sm font-medium">
          {t('settings.wolffish.weekStartsOn.label')}
        </span>
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
                disabled={disabled}
                aria-selected={active}
                onClick={() => onChange(opt.value)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  active
                    ? 'bg-primary text-primary-fg shadow-sm'
                    : 'text-muted hover:text-fg cursor-pointer',
                  disabled && 'cursor-not-allowed opacity-60'
                )}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
      <p className="text-muted text-xs leading-relaxed">
        {t('settings.wolffish.weekStartsOn.description')}
      </p>
    </div>
  )
}

function SettingToggle({
  label,
  description,
  value,
  onChange,
  disabled
}: {
  label: string
  description: string
  value: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const options = useMemo(
    () => [
      { value: false, label: t('settings.wolffish.toggle.off') },
      { value: true, label: t('settings.wolffish.toggle.on') }
    ],
    [t]
  )
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
                key={String(opt.value)}
                role="tab"
                type="button"
                disabled={disabled}
                aria-selected={active}
                onClick={() => onChange(opt.value)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  active
                    ? 'bg-primary text-primary-fg shadow-sm'
                    : 'text-muted hover:text-fg cursor-pointer',
                  disabled && 'cursor-not-allowed opacity-60'
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

function StartupSetting({
  value,
  active,
  onChange,
  disabled
}: {
  value: boolean
  active: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const options = useMemo(
    () => [
      { value: false, label: t('settings.wolffish.toggle.off') },
      { value: true, label: t('settings.wolffish.toggle.on') }
    ],
    [t]
  )
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="text-fg text-sm font-medium">
            {t('settings.wolffish.launchAtStartup.label')}
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              active
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            )}
          >
            {active
              ? t('settings.wolffish.launchAtStartup.active')
              : t('settings.wolffish.launchAtStartup.inactive')}
          </span>
        </div>
        <div
          role="tablist"
          className="border-border bg-bg/40 inline-flex shrink-0 items-center rounded-lg border p-0.5"
        >
          {options.map((opt) => {
            const isActive = opt.value === value
            return (
              <button
                key={String(opt.value)}
                role="tab"
                type="button"
                disabled={disabled}
                aria-selected={isActive}
                onClick={() => onChange(opt.value)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  isActive
                    ? 'bg-primary text-primary-fg shadow-sm'
                    : 'text-muted hover:text-fg cursor-pointer',
                  disabled && 'cursor-not-allowed opacity-60'
                )}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
      <p className="text-muted text-xs leading-relaxed">
        {t('settings.wolffish.launchAtStartup.description')}
      </p>
    </div>
  )
}
