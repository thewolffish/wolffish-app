import { cn } from '@lib/utils/cn'
import type { InAppConfig } from '@preload/index'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function InAppPanel(): React.JSX.Element {
  const { t } = useTranslation()

  const [verbose, setVerbose] = useState<boolean | null>(null)
  const loaded = verbose !== null

  useEffect(() => {
    let cancelled = false
    void window.api.inapp.getConfig().then((cfg: InAppConfig) => {
      if (!cancelled) setVerbose(cfg.verbose ?? false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toggleOptions = useMemo(
    () => [
      { value: false, label: t('settings.services.inapp.toggle.off') },
      { value: true, label: t('settings.services.inapp.toggle.on') }
    ],
    [t]
  )

  // Persists immediately and is read fresh per render by the chat feed —
  // no restart. The setConfig handler broadcasts the change so an open chat
  // re-renders at once. Off (default) = clean feed.
  const handleVerbose = useCallback(async (value: boolean) => {
    setVerbose(value)
    await window.api.inapp.setConfig({ verbose: value })
  }, [])

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.services.inapp.title')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">
            {t('settings.services.inapp.subtitle')}
          </p>
        </header>

        <section className="bg-surface border-border flex flex-col gap-5 rounded-2xl border p-6">
          {/* Verbose task results — off (default) shows a clean feed: agent
              replies, file-bearing tool results, errors, and the model chip
              only. On shows every tool call/result/activity and compaction
              card. Display-only — never affects history. */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-fg text-sm font-medium">
                {t('settings.services.inapp.verbose.label')}
              </span>
              <p className="text-muted text-xs">
                {t('settings.services.inapp.verbose.description')}
              </p>
            </div>
            {verbose === null ? (
              <div
                aria-hidden="true"
                className="bg-border/30 h-7 w-[78px] shrink-0 animate-pulse rounded-lg"
              />
            ) : (
              <div
                role="tablist"
                className="border-border bg-bg/40 inline-flex shrink-0 items-center rounded-lg border p-0.5"
              >
                {toggleOptions.map((opt) => {
                  const active = opt.value === verbose
                  return (
                    <button
                      key={String(opt.value)}
                      role="tab"
                      type="button"
                      aria-selected={active}
                      disabled={!loaded}
                      onClick={() => {
                        if (opt.value !== verbose) void handleVerbose(opt.value)
                      }}
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
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
