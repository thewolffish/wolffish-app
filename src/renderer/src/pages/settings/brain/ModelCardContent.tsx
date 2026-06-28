import { cn } from '@lib/utils/cn'
import { BADGE_STYLES, PROVIDER_LOGOS, type ModelSpec } from '@pages/settings/modelCatalog'
import type { CloudProviderConfig } from '@preload/index'
import { BrainIcon } from 'hugeicons-react'
import { useTranslation } from 'react-i18next'

type ProviderId = CloudProviderConfig['id']
type Variant = 'card' | 'slot' | 'overlay'

/**
 * The self-contained visual for one model — brain icon, provider, name,
 * key details, cost, capability badges. Shared by the draggable list card,
 * the filled Brain slot, and the DragOverlay preview so the floating drag
 * image is byte-identical to its source (no ghosting).
 */
export function ModelCardContent({
  providerId,
  modelId,
  spec,
  variant = 'card',
  active = false
}: {
  providerId: ProviderId
  modelId: string
  spec: ModelSpec | null
  variant?: Variant
  active?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const Logo = PROVIDER_LOGOS[providerId]
  const large = variant === 'slot'

  return (
    <div
      className={cn(
        'bg-surface border-border flex items-start gap-4 rounded-2xl border text-start',
        large ? 'p-6' : 'p-4',
        large && 'min-h-[150px]',
        variant === 'card' && 'h-full',
        variant === 'overlay' && 'shadow-2xl'
      )}
    >
      <div
        className={cn(
          'bg-primary/10 text-primary flex shrink-0 items-center justify-center rounded-xl',
          large ? 'size-12' : 'size-9'
        )}
      >
        <BrainIcon size={large ? 26 : 18} aria-hidden />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          {Logo ? <Logo size={large ? 16 : 13} className="text-muted shrink-0" /> : null}
          <span className="text-muted truncate text-[11px] font-medium uppercase tracking-wide">
            {t(`settings.model.providers.${providerId}`)}
          </span>
        </div>

        <span className={cn('text-fg truncate font-semibold', large ? 'text-lg' : 'text-sm')}>
          {modelId}
        </span>

        {spec ? (
          <div className="text-muted flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <span>
              {spec.context} {t('settings.brain.spec.context')}
            </span>
            {spec.input !== '—' ? (
              <span>
                {spec.input} {t('settings.brain.spec.in')}
              </span>
            ) : null}
            {spec.output !== '—' ? (
              <span>
                {spec.output} {t('settings.brain.spec.out')}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-muted text-xs">{t('settings.brain.noDetails')}</span>
        )}

        {active || spec?.badges?.length ? (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {active ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-600 dark:text-emerald-400">
                {t('settings.brain.activeChip')}
              </span>
            ) : null}
            {spec?.badges?.map((b) => (
              <span
                key={b}
                className={cn(
                  'inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                  BADGE_STYLES[b]
                )}
              >
                {t(`settings.model.cloud.breakdown.badges.${b}`)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
