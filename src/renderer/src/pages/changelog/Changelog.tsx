import { Markdown } from '@components/core/markdown/Markdown'
import { RTL_LOCALES } from '@lib/i18n'
import { cn } from '@lib/utils/cn/cn'
import { useFlow } from '@providers/flow/useFlow'
import { useLocale } from '@providers/locale/useLocale'
import { ArrowLeft02Icon, ArrowRight02Icon } from 'hugeicons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function Changelog(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const isRtl = RTL_LOCALES.has(locale)
  const BackIcon = isRtl ? ArrowRight02Icon : ArrowLeft02Icon
  const { goTo, returnTo } = useFlow()

  const [content, setContent] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    void window.api.updater.readChangelog(locale).then(setContent)
    void window.api.updater.getVersion().then(setVersion)
  }, [locale])

  return (
    <main className="bg-bg flex h-full w-full flex-col pt-10">
      <header className="flex items-center gap-2 px-6 py-3">
        <button
          type="button"
          onClick={() => goTo(returnTo ?? 'chat')}
          aria-label={t('common.back', 'Back')}
          className={cn(
            'text-muted hover:text-fg flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-2 text-sm',
            'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
          )}
        >
          <BackIcon size={16} />
          <span>{t('common.back', 'Back')}</span>
        </button>

        {version && (
          <code className="bg-border/50 text-muted rounded px-2 py-0.5 text-xs font-mono">
            v{version}
          </code>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl">
          {content ? (
            <article className="prose-sm">
              <Markdown content={content} />
            </article>
          ) : (
            <div className="text-muted flex items-center justify-center py-20 text-sm">
              {t('common.loading', 'Loading...')}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
