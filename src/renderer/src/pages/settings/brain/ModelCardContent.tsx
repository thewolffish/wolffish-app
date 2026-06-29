import { cn } from '@lib/utils/cn'
import { BADGE_STYLES, PROVIDER_LOGOS, type ModelSpec } from '@pages/settings/modelCatalog'
import type { CloudProviderConfig } from '@preload/index'
import { BrainIcon, NeuralNetworkIcon } from 'hugeicons-react'
import { useTranslation } from 'react-i18next'

type ProviderId = CloudProviderConfig['id']
type Variant = 'card' | 'slot' | 'overlay'
export type CardRole = 'orchestrator' | 'worker' | 'both'

/** A colored, icon'd chip naming a model's role. Orchestrator and Worker get
 * distinct icons + colors so the role reads at a glance. */
function RoleChip({ kind }: { kind: 'orchestrator' | 'worker' }): React.JSX.Element {
  const { t } = useTranslation()
  const Icon = kind === 'orchestrator' ? BrainIcon : NeuralNetworkIcon
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
        kind === 'orchestrator'
          ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400'
          : 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
      )}
    >
      <Icon size={11} aria-hidden />
      {t(kind === 'orchestrator' ? 'settings.brain.orchestratorSlot' : 'settings.brain.workerSlot')}
    </span>
  )
}

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
  active = false,
  role
}: {
  providerId: ProviderId
  modelId: string
  spec: ModelSpec | null
  variant?: Variant
  active?: boolean
  /** When set on an active card, icon'd role chip(s) render in place of the
   * generic Active chip. Omitted in single mode. */
  role?: CardRole
}): React.JSX.Element {
  const { t } = useTranslation()
  const Logo = PROVIDER_LOGOS[providerId]
  const large = variant === 'slot'
  // The card's main icon mirrors the role: the worker slot uses the worker icon,
  // everything else (orchestrator / single Brain / list) uses the Brain icon.
  const MainIcon = role === 'worker' ? NeuralNetworkIcon : BrainIcon

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
        <MainIcon size={large ? 26 : 18} aria-hidden />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          {Logo ? <Logo size={large ? 16 : 13} className="text-muted shrink-0" /> : null}
          <span className="text-muted truncate text-[11px] font-medium uppercase tracking-wide">
            {t(`settings.model.providers.${providerId}`)}
          </span>
        </div>

        <span className={cn('text-fg truncate font-semibold', large ? 'text-base' : 'text-sm')}>
          {modelId}
        </span>

        {spec ? (
          <div className="text-muted flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
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
          <span className="text-muted text-[11px]">{t('settings.brain.noDetails')}</span>
        )}

        {active || (variant !== 'slot' && spec?.badges?.length) ? (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {/* In orchestrator mode the role chip(s) (Orchestrator/Worker) already
                signal the card is set, so the generic "Active" chip is shown
                only when there's no role (single mode). */}
            {active && !role ? (
              <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-600 dark:text-emerald-400">
                {t('settings.brain.activeChip')}
              </span>
            ) : null}
            {active && (role === 'orchestrator' || role === 'both') ? (
              <RoleChip kind="orchestrator" />
            ) : null}
            {active && (role === 'worker' || role === 'both') ? <RoleChip kind="worker" /> : null}
            {/* Capability badges only on list/overlay cards — the filled slot
                stays clean (no "other chips"). */}
            {variant !== 'slot'
              ? spec?.badges?.map((b) => (
                  <span
                    key={b}
                    className={cn(
                      'inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                      BADGE_STYLES[b]
                    )}
                  >
                    {t(`settings.model.cloud.breakdown.badges.${b}`)}
                  </span>
                ))
              : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
