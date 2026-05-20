import { Badge } from '@components/core/Badge'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn'
import type { CapabilityEntry } from '@preload/index'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircleIcon,
  CheckmarkBadge01Icon,
  HelpCircleIcon,
  Refresh01Icon,
  SecurityCheckIcon,
  Tick01Icon
} from 'hugeicons-react'

export function CelebrumPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()
  const [capabilities, setCapabilities] = useState<CapabilityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [resyncing, setResyncing] = useState(false)

  useEffect(() => {
    let stale = false
    window.api.cerebellum
      .listCapabilities()
      .then((data) => {
        if (!stale) setCapabilities(data)
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })
    return () => {
      stale = true
    }
  }, [])

  const onResync = async (): Promise<void> => {
    setResyncing(true)
    try {
      const data = await window.api.cerebellum.reload()
      setCapabilities(data)
      toast.show({ tone: 'success', message: t('settings.cellebrum.resyncSuccessToast') })
    } finally {
      setResyncing(false)
    }
  }

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h1 className="text-fg text-2xl font-semibold tracking-tight">
                {t('settings.cellebrum.title')}
              </h1>
              {!loading && (
                <Badge variant="default" size="sm">
                  {capabilities.length}
                </Badge>
              )}
            </div>
            <p className="text-muted text-sm leading-relaxed">
              {t('settings.cellebrum.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onResync()}
            disabled={resyncing}
            aria-label={t('settings.cellebrum.resync')}
            className={cn(
              'text-muted hover:text-fg mt-1 shrink-0 cursor-pointer rounded-lg p-2',
              'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              resyncing && 'animate-spin'
            )}
          >
            <Refresh01Icon size={16} />
          </button>
        </header>

        {loading ? (
          <div className="text-muted py-12 text-center text-sm">
            {t('settings.cellebrum.loading')}
          </div>
        ) : capabilities.length === 0 ? (
          <div className="text-muted py-12 text-center text-sm">
            {t('settings.cellebrum.empty')}
          </div>
        ) : (
          <section className="bg-surface border-border flex flex-col rounded-2xl border">
            {[...capabilities]
              .sort((a, b) => Number(b.official) - Number(a.official))
              .map((cap, i) => (
                <div key={cap.name}>
                  {i > 0 && <div className="border-border/60 border-t" />}
                  <CapabilityRow
                    cap={cap}
                    onToggle={(enabled) => {
                      void window.api.cerebellum.toggleCapability(cap.name, enabled)
                      setCapabilities((prev) =>
                        prev.map((c) => (c.name === cap.name ? { ...c, enabled } : c))
                      )
                    }}
                  />
                </div>
              ))}
          </section>
        )}
      </div>
    </div>
  )
}

function CapabilityRow({
  cap,
  onToggle
}: {
  cap: CapabilityEntry
  onToggle: (enabled: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isOk = cap.status === 'ok'

  return (
    <div className={cn('flex flex-col gap-3 p-5', !cap.enabled && 'opacity-50')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-fg text-sm font-medium">{cap.name}</span>

          <div className="flex items-center gap-1.5">
            {cap.enabled ? (
              isOk ? (
                <Badge variant="success" size="sm">
                  <CheckmarkBadge01Icon size={11} />
                  {t('settings.cellebrum.active')}
                </Badge>
              ) : (
                <Badge variant="danger" size="sm">
                  <AlertCircleIcon size={11} />
                  {t('settings.cellebrum.error')}
                </Badge>
              )
            ) : (
              <Badge variant="default" size="sm">
                {t('settings.cellebrum.inactive')}
              </Badge>
            )}

            {cap.enabled &&
              isOk &&
              (cap.official ? (
                <Badge
                  variant="default"
                  size="sm"
                  className="!bg-primary/10 !text-primary !ring-primary/30"
                >
                  <SecurityCheckIcon size={11} />
                  {t('settings.cellebrum.official')}
                </Badge>
              ) : (
                <Badge variant="default" size="sm">
                  <HelpCircleIcon size={11} />
                  {t('settings.cellebrum.unknown')}
                </Badge>
              ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onToggle(!cap.enabled)}
          className={cn(
            'relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors',
            cap.enabled ? 'bg-primary' : 'bg-border'
          )}
        >
          <span
            className={cn(
              'bg-white absolute top-0.5 left-0.5 flex h-4 w-4 items-center justify-center rounded-full shadow transition-transform',
              cap.enabled && 'translate-x-4'
            )}
          >
            {cap.enabled && <Tick01Icon size={10} className="text-primary" />}
          </span>
        </button>
      </div>

      {cap.description && (
        <p className="text-muted text-xs leading-relaxed">{cap.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {cap.hasPlugin && (
          <span className="text-muted bg-border/30 rounded px-1.5 py-0.5 text-[10px] font-medium">
            {t('settings.cellebrum.plugin')}
          </span>
        )}
        {cap.toolCount > 0 && (
          <span className="text-muted bg-border/30 rounded px-1.5 py-0.5 text-[10px] font-medium">
            {t('settings.cellebrum.tools', { count: cap.toolCount })}
          </span>
        )}
        {cap.requires.length > 0 && (
          <span className="text-muted bg-border/30 rounded px-1.5 py-0.5 text-[10px] font-medium">
            {t('settings.cellebrum.requires', { deps: cap.requires.join(', ') })}
          </span>
        )}
      </div>

      {cap.error && (
        <p className="text-xs text-red-500">{cap.error}</p>
      )}
    </div>
  )
}
