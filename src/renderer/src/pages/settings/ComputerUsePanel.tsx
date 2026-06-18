import { Button } from '@components/core/Button'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn'
import type { ComputerUseConfig, ComputerUsePermissions } from '@preload/index'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const RESOLUTION_OPTIONS = [
  { value: 640, label: '640px' },
  { value: 960, label: '960px' },
  { value: 1280, label: '1280px' },
  { value: 1920, label: '1920px' }
]

export function ComputerUsePanel(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()

  const [config, setConfig] = useState<ComputerUseConfig | null>(null)
  const [savedConfig, setSavedConfig] = useState<ComputerUseConfig | null>(null)
  const [permissions, setPermissions] = useState<ComputerUsePermissions | null>(null)
  const [busy, setBusy] = useState(false)
  const loaded = config !== null
  const dirty =
    loaded &&
    savedConfig !== null &&
    (config!.screenshotMaxWidth !== savedConfig.screenshotMaxWidth ||
      config!.screenshotFormat !== savedConfig.screenshotFormat)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [cfg, perms] = await Promise.all([
        window.api.computerUse.getConfig(),
        window.api.computerUse.checkPermissions()
      ])
      if (cancelled) return
      setConfig(cfg)
      setSavedConfig(cfg)
      setPermissions(perms)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSave = useCallback(async () => {
    if (!config) return
    setBusy(true)
    try {
      const result = await window.api.computerUse.setConfig(config)
      setConfig(result.config)
      setSavedConfig(result.config)
      toast.show({ message: t('settings.services.computerUse.saveSuccess'), tone: 'success' })
    } catch {
      toast.show({ message: t('settings.services.computerUse.saveError'), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }, [config, t, toast])

  const handleResolution = useCallback(
    (value: number) => {
      if (!config) return
      setConfig({ ...config, screenshotMaxWidth: value })
    },
    [config]
  )

  const handleFormat = useCallback(
    (format: 'jpeg' | 'png') => {
      if (!config) return
      setConfig({ ...config, screenshotFormat: format })
    },
    [config]
  )

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.services.computerUse.title')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">
            {t('settings.services.computerUse.subtitle')}
          </p>
        </header>

        {loaded && (
          <>
            <section className="bg-surface border-border flex flex-col gap-5 rounded-2xl border p-6">
              {/* Screenshot resolution */}
              <div className="flex flex-col gap-2">
                <label className="text-fg text-sm font-medium">
                  {t('settings.services.computerUse.resolutionLabel')}
                </label>
                <p className="text-muted text-xs">
                  {t('settings.services.computerUse.resolutionHint')}
                </p>
                <div className="flex gap-2">
                  {RESOLUTION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleResolution(opt.value)}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-sm cursor-pointer transition-colors',
                        config!.screenshotMaxWidth === opt.value
                          ? 'bg-primary text-primary-fg border-primary'
                          : 'border-border text-muted hover:bg-border/40 hover:text-fg'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Screenshot format */}
              <div className="flex flex-col gap-2">
                <label className="text-fg text-sm font-medium">
                  {t('settings.services.computerUse.formatLabel')}
                </label>
                <p className="text-muted text-xs">
                  {t('settings.services.computerUse.formatHint')}
                </p>
                <div className="flex gap-2">
                  {(['jpeg', 'png'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => handleFormat(fmt)}
                      className={cn(
                        'rounded-lg border px-3 py-1.5 text-sm cursor-pointer transition-colors uppercase',
                        config!.screenshotFormat === fmt
                          ? 'bg-primary text-primary-fg border-primary'
                          : 'border-border text-muted hover:bg-border/40 hover:text-fg'
                      )}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>

              <Button onClick={handleSave} disabled={busy || !dirty} className="self-start">
                {busy
                  ? t('settings.services.computerUse.saving')
                  : t('settings.services.computerUse.save')}
              </Button>
            </section>

            {/* Permissions */}
            {permissions?.platform === 'darwin' && (
              <section className="bg-surface border-border flex flex-col gap-3 rounded-2xl border p-6">
                <h2 className="text-fg text-sm font-semibold">
                  {t('settings.services.computerUse.permissionsTitle')}
                </h2>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className={permissions.accessibility ? 'text-green-500' : 'text-red-400'}>
                      {permissions.accessibility ? '●' : '○'}
                    </span>
                    <span className="text-fg">
                      {t('settings.services.computerUse.permAccessibility')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      className={permissions.screenRecording ? 'text-green-500' : 'text-red-400'}
                    >
                      {permissions.screenRecording ? '●' : '○'}
                    </span>
                    <span className="text-fg">
                      {t('settings.services.computerUse.permScreenRecording')}
                    </span>
                  </div>
                </div>
                {permissions.hint && (
                  <p className="text-muted text-sm leading-relaxed">{permissions.hint}</p>
                )}
                <Button
                  onClick={async () => {
                    const updated = await window.api.computerUse.checkPermissions()
                    setPermissions(updated)
                  }}
                  className="self-start"
                >
                  {t('settings.services.computerUse.recheckPermissions')}
                </Button>
              </section>
            )}
            {permissions?.platform === 'linux' && permissions.hint && (
              <section className="bg-surface border-border flex flex-col gap-3 rounded-2xl border p-6">
                <h2 className="text-fg text-sm font-semibold">
                  {t('settings.services.computerUse.permissionsTitle')}
                </h2>
                <p className="text-muted text-sm leading-relaxed">{permissions.hint}</p>
              </section>
            )}

            {/* How it works */}
            <section className="bg-surface border-border flex flex-col gap-3 rounded-2xl border p-6">
              <h2 className="text-fg text-sm font-semibold">
                {t('settings.services.computerUse.howItWorksTitle')}
              </h2>
              <ul className="text-muted flex flex-col gap-2 text-sm leading-relaxed">
                <li>{t('settings.services.computerUse.howItWorks.step1')}</li>
                <li>{t('settings.services.computerUse.howItWorks.step2')}</li>
                <li>{t('settings.services.computerUse.howItWorks.step3')}</li>
                <li>{t('settings.services.computerUse.howItWorks.step4')}</li>
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
