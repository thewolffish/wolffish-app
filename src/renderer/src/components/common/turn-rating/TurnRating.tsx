import { cn } from '@lib/utils/cn'
import { useTranslation } from 'react-i18next'

/**
 * The in-app turn score bar — an NPS-style 0-10 strip shown under a
 * completed turn (above the composer). One click records the score and the
 * strip retires: a turn that has a score has no bar, so `score` arrives null
 * in practice and the highlighted state is the caller's to use if it ever
 * shows a scored turn again. Entirely optional: unrated turns are fine, the
 * nightly reflection simply reviews them without a user signal. Channel chats
 * have their own equivalent (a bare-number reply), so this renders for the
 * in-app surface only, gated by Settings → Knowledge → Reflection.
 */
export function TurnRating({
  score,
  onRate
}: {
  score: number | null
  onRate: (score: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="border-border bg-surface/95 flex items-center gap-2 rounded-full border py-1 ps-3 pe-1.5 shadow-sm backdrop-blur">
      <span className="text-muted text-[11px] whitespace-nowrap">{t('chat.rating.label')}</span>
      <div role="radiogroup" aria-label={t('chat.rating.label')} className="flex items-center">
        {Array.from({ length: 11 }, (_, n) => {
          const active = score === n
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={t('chat.rating.rateAs', { score: n })}
              onClick={() => onRate(n)}
              className={cn(
                'h-6 min-w-6 rounded-full px-0.5 text-[11px] font-medium tabular-nums cursor-pointer',
                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
                active ? 'bg-primary text-primary-fg shadow-sm' : 'text-muted hover:text-fg'
              )}
            >
              {n}
            </button>
          )
        })}
      </div>
    </div>
  )
}
