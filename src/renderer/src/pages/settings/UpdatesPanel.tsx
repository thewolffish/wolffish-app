import { Button } from '@components/core/Button'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn'
import type { UpdateCheckResult } from '@preload/index'
import { useFlow } from '@providers/flow/useFlow'
import { Download01Icon } from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing'

let cachedReadyVersion: string | null = null
window.api.updater.onReady((event) => {
  cachedReadyVersion = event.version
})

export function UpdatesPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const { show } = useToast()
  const { status, refreshStatus, goTo } = useFlow()
  const updatesEnabled = status?.config?.updates?.enabled !== false

  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [autoUpdates, setAutoUpdates] = useState(updatesEnabled)
  const [phase, setPhase] = useState<UpdatePhase>(cachedReadyVersion ? 'ready' : 'idle')
  const [updateVersion, setUpdateVersion] = useState<string | null>(cachedReadyVersion)
  const [downloadPercent, setDownloadPercent] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.api.updater.getVersion().then(setAppVersion)
  }, [])

  useEffect(() => {
    const unsubAvailable = window.api.updater.onAvailable((event) => {
      setUpdateVersion(event.version)
      setDownloadPercent(0)
      setPhase('downloading')
    })
    const unsubProgress = window.api.updater.onProgress((event) => {
      setDownloadPercent(Math.round(event.percent))
    })
    const unsubReady = window.api.updater.onReady((event) => {
      cachedReadyVersion = event.version
      setUpdateVersion(event.version)
      setPhase('ready')
    })
    return () => {
      unsubAvailable()
      unsubProgress()
      unsubReady()
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
    if (phase !== 'idle') return
    setPhase('checking')
    try {
      const result: UpdateCheckResult = await window.api.updater.check()
      if (result.ok && result.version) {
        // onAvailable event will transition to 'downloading'
        setUpdateVersion(result.version)
      } else if (result.ok) {
        show({ message: t('settings.updates.upToDate', 'Up to date'), tone: 'success' })
        setPhase('idle')
      } else {
        show({
          message: t('settings.updates.checkFailed', 'Could not check for updates'),
          tone: 'error'
        })
        setPhase('idle')
      }
    } catch {
      setPhase('idle')
    }
  }, [phase, show, t])

  const onInstall = useCallback(() => {
    setPhase('installing')
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
              <code className="bg-border/50 text-fg rounded px-2 py-0.5 text-xs font-mono">
                {appVersion ? `v${appVersion}` : '...'}
              </code>
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

          <div className="flex flex-col gap-3 min-h-[52px]">
            {phase === 'downloading' ? (
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-fg text-sm font-medium">
                    {t('settings.updates.downloadingTitle', 'Downloading update')}
                  </span>
                  <p className="text-muted text-xs flex items-center gap-1.5 animate-pulse">
                    <Download01Icon size={12} className="shrink-0" />
                    {t('settings.updates.downloadingSubtitle', 'Your update is downloading')}
                    {downloadPercent > 0 && ` ${downloadPercent}%`}
                  </p>
                </div>
                <button
                  type="button"
                  disabled
                  className={cn(
                    'bg-primary text-primary-fg flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm',
                    'cursor-not-allowed opacity-60'
                  )}
                >
                  <span>{t('settings.updates.install', 'Update')}</span>
                </button>
              </div>
            ) : phase === 'ready' || phase === 'installing' ? (
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-fg text-sm font-medium">
                    {t('settings.updates.installReady', 'Install downloaded update')}
                  </span>
                  <div className="flex items-center gap-2">
                    <code className="bg-border/50 text-fg rounded px-2 py-0.5 text-xs font-mono">
                      v{updateVersion}
                    </code>
                    <span className="text-muted text-xs">
                      {t('settings.updates.updateAvailable', 'Ready to install')}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onInstall}
                  disabled={phase === 'installing'}
                  className={cn(
                    'bg-primary text-primary-fg flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm transition-colors',
                    'hover:bg-primary/90 cursor-pointer',
                    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                    phase === 'installing' && 'cursor-not-allowed opacity-60'
                  )}
                >
                  <span>{t('settings.updates.install', 'Update')}</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-fg text-sm font-medium">
                    {t('settings.updates.checkManual', 'Check for updates')}
                  </span>
                  <p className="text-muted text-xs">
                    {t(
                      'settings.updates.checkManualDescription',
                      'Manually check for new versions.'
                    )}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void onCheckForUpdates()}
                  disabled={phase === 'checking'}
                >
                  {t('settings.updates.check', 'Check')}
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
