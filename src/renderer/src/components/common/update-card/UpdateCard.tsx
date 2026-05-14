import { cn } from '@lib/utils/cn/cn'
import type { UpdateReadyEvent } from '@preload/index'
import { useFlow } from '@providers/flow/useFlow'
import { ArrowUp02Icon, Cancel01Icon, FileEditIcon } from 'hugeicons-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Cached outside the component so the event survives mount/unmount
// cycles (e.g. navigating to changelog and back).
let cachedUpdate: UpdateReadyEvent | null = null

export function UpdateCard(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { status, goTo } = useFlow()
  const [update, setUpdate] = useState<UpdateReadyEvent | null>(cachedUpdate)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (status?.config?.updates?.enabled === false) return
    const unsub = window.api.updater.onReady((event) => {
      cachedUpdate = event
      setUpdate(event)
    })
    return unsub
  }, [status?.config?.updates?.enabled])

  const handleInstall = useCallback(() => {
    void window.api.updater.install()
  }, [])

  const handleChangelog = useCallback(() => {
    goTo('changelog', 'chat')
  }, [goTo])

  if (!update || dismissed) return null
  if (status?.config?.updates?.enabled === false) return null

  return (
    <div
      className={cn(
        'bg-surface border-border mx-auto flex w-full max-w-2xl items-center gap-3 rounded-xl border px-4 py-3',
        'shadow-sm'
      )}
    >
      <div className="bg-primary/10 text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
        <ArrowUp02Icon size={18} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-fg text-sm font-medium">
            {t('update.available', 'Update available')}
          </span>
          <code className="bg-border/50 text-fg rounded px-1.5 py-0.5 text-xs font-mono">
            v{update.version}
          </code>
        </div>
        {update.releaseNotes && (
          <p className="text-muted truncate text-xs">{update.releaseNotes}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={handleChangelog}
          className={cn(
            'text-muted hover:text-fg flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
            'hover:bg-border/40 cursor-pointer',
            'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
          )}
        >
          <FileEditIcon size={14} />
          <span>{t('update.changelog', 'Changelog')}</span>
        </button>

        <button
          type="button"
          onClick={handleInstall}
          className={cn(
            'bg-primary text-primary-fg flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm transition-colors',
            'hover:bg-primary/90 cursor-pointer',
            'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
          )}
        >
          <span>{t('update.install', 'Update')}</span>
        </button>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t('common.close', 'Close')}
          className={cn(
            'text-muted hover:text-fg rounded-lg p-1 transition-colors',
            'hover:bg-border/40 cursor-pointer',
            'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
          )}
        >
          <Cancel01Icon size={14} />
        </button>
      </div>
    </div>
  )
}
