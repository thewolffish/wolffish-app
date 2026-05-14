import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn/cn'
import type { UpdateCheckResult } from '@preload/index'
import { useFlow } from '@providers/flow/useFlow'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function UpdatesPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const { show } = useToast()
  const { status, refreshStatus, goTo } = useFlow()
  const updatesEnabled = status?.config?.updates?.enabled !== false

  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [autoUpdates, setAutoUpdates] = useState(updatesEnabled)
  const [checking, setChecking] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState(0)
  const [saving, setSaving] = useState(false)
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    void window.api.updater.getVersion().then(setAppVersion)
  }, [])

  useEffect(() => {
    const unsub = window.api.updater.onReady(() => setUpdateReady(true))
    return unsub
  }, [])

  useEffect(() => {
    return () => {
      if (progressRef.current) clearInterval(progressRef.current)
    }
  }, [])

  const onToggleAutoUpdates = useCallback(
    async (next: boolean) => {
      if (saving || next === autoUpdates) return
      setSaving(true)
      try {
        await window.api.runtime.setUpdatesEnabled(next)
        setAutoUpdates(next)
        await refreshStatus()
      } finally {
        setSaving(false)
      }
    },
    [saving, autoUpdates, refreshStatus]
  )

  const onCheckForUpdates = useCallback(async () => {
    if (checking) return
    setChecking(true)
    try {
      const result: UpdateCheckResult = await window.api.updater.check()
      if (result.ok && result.version) {
        show({ message: t('settings.updates.updateFound', 'Update found'), tone: 'success' })
      } else if (result.ok) {
        show({ message: t('settings.updates.upToDate', 'Up to date'), tone: 'success' })
      } else {
        show({
          message: t('settings.updates.checkFailed', 'Could not check for updates'),
          tone: 'error'
        })
      }
    } finally {
      setChecking(false)
    }
  }, [checking, show, t])

  const onInstall = useCallback(() => {
    setInstalling(true)
    setInstallProgress(0)
    let progress = 0
    progressRef.current = setInterval(() => {
      const remaining = 99 - progress
      progress += remaining * (Math.random() * 0.08 + 0.02)
      setInstallProgress(progress)
    }, 300)
    void window.api.updater.install()
  }, [])

  const toggleOptions = useMemo(
    () => [
      { value: false, label: t('settings.wolffish.toggle.off') },
      { value: true, label: t('settings.wolffish.toggle.on') }
    ],
    [t]
  )

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.updates.title', 'Updates')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">
            {t('settings.updates.subtitle', 'Manage app updates and version info.')}
          </p>
        </header>

        <section className="bg-surface border-border flex flex-col gap-5 rounded-2xl border p-6">
          <div className="flex items-center justify-between gap-4">
            <span className="text-fg text-sm font-medium">
              {t('settings.updates.version', 'Version')}
            </span>
            <div className="flex items-center gap-2">
              <code className="bg-border/50 text-fg rounded px-2 py-0.5 text-xs font-mono">
                {appVersion ? `v${appVersion}` : '...'}
              </code>
              <button
                type="button"
                onClick={() => goTo('changelog', 'settings')}
                className={cn(
                  'text-muted hover:text-fg text-xs underline cursor-pointer',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded'
                )}
              >
                {t('settings.updates.changelog', 'Changelog')}
              </button>
            </div>
          </div>

          <div className="border-border/60 border-t" />

          {/* Auto-updates toggle */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-fg text-sm font-medium">
                {t('settings.updates.autoUpdates', 'Auto-updates')}
              </span>
              <div
                role="tablist"
                className="border-border bg-bg/40 inline-flex shrink-0 items-center rounded-lg border p-0.5"
              >
                {toggleOptions.map((opt) => {
                  const active = opt.value === autoUpdates
                  return (
                    <button
                      key={String(opt.value)}
                      role="tab"
                      type="button"
                      disabled={saving}
                      aria-selected={active}
                      onClick={() => onToggleAutoUpdates(opt.value)}
                      className={cn(
                        'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                        active
                          ? 'bg-primary text-primary-fg shadow-sm'
                          : 'text-muted hover:text-fg cursor-pointer',
                        saving && 'cursor-not-allowed opacity-60'
                      )}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <p className="text-muted text-xs leading-relaxed">
              {t(
                'settings.updates.autoUpdatesDescription',
                'Check for and download updates automatically on launch.'
              )}
            </p>
          </div>

          <div className="border-border/60 border-t" />

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-fg text-sm font-medium">
                  {t('settings.updates.checkManual', 'Check for updates')}
                </span>
                <p className="text-muted text-xs">
                  {t('settings.updates.checkManualDescription', 'Manually check for new versions.')}
                </p>
              </div>
              {updateReady ? (
                <button
                  type="button"
                  onClick={onInstall}
                  disabled={installing}
                  className={cn(
                    'bg-primary text-primary-fg flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm transition-colors',
                    'hover:bg-primary/90 cursor-pointer',
                    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                    installing && 'cursor-not-allowed opacity-60'
                  )}
                >
                  <span>{t('settings.updates.install', 'Install')}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onCheckForUpdates}
                  disabled={checking}
                  className={cn(
                    'border-border text-fg flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    'hover:bg-border/40 cursor-pointer',
                    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                    checking && 'cursor-not-allowed opacity-60'
                  )}
                >
                  <span>{t('settings.updates.check', 'Check')}</span>
                </button>
              )}
            </div>
            {installing && (
              <div className="bg-border/30 h-1 overflow-hidden rounded-full">
                <div
                  className="h-full bg-emerald-500 transition-[width] duration-300 ease-out"
                  style={{ width: `${installProgress}%` }}
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
