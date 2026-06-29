import { useDroppable } from '@dnd-kit/core'
import { cn } from '@lib/utils/cn'
import { ModelCardContent } from '@pages/settings/brain/ModelCardContent'
import type { ModelSpec } from '@pages/settings/modelCatalog'
import type { BrainSelection } from '@preload/index'
import { BrainIcon, Cancel01Icon } from 'hugeicons-react'
import { useTranslation } from 'react-i18next'

/**
 * A model drop target. Used for the single Brain slot (Phase 1) and, in
 * orchestrator mode, the Orchestrator and Worker slots (Phase 2) — all share
 * the drop-or-click-to-fill behavior. Filled with the selected model, or a
 * centered empty target inviting a drop or click.
 */
export function BrainSlot({
  slotId = 'brain-slot',
  brain,
  spec,
  connected,
  onClear,
  heading,
  role,
  emptyTitleKey = 'settings.brain.empty.title',
  emptyHintKey = 'settings.brain.empty.hint',
  icon: Icon = BrainIcon,
  sticky = true
}: {
  slotId?: string
  brain: BrainSelection | null
  spec: ModelSpec | null
  connected: boolean
  onClear: () => void
  heading?: string
  role?: 'orchestrator' | 'worker'
  emptyTitleKey?: string
  emptyHintKey?: string
  icon?: typeof BrainIcon
  sticky?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { setNodeRef, isOver } = useDroppable({ id: slotId })

  return (
    <div ref={setNodeRef} className={cn('bg-bg pb-4', sticky ? 'sticky top-0 z-20 pt-1' : 'pt-0')}>
      {heading ? (
        <h2 className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">{heading}</h2>
      ) : null}
      {brain ? (
        <div className={cn('relative rounded-2xl transition-transform', isOver && 'scale-[1.01]')}>
          <div className={cn('rounded-2xl', isOver && 'ring-accent ring-2')}>
            <ModelCardContent
              providerId={brain.providerId}
              modelId={brain.model}
              spec={spec}
              variant="slot"
              active
              role={role}
            />
          </div>
          <button
            type="button"
            onClick={onClear}
            aria-label={t('settings.brain.clear')}
            className="text-muted hover:text-fg hover:bg-border/40 focus-visible:ring-accent absolute end-3 top-3 inline-flex size-7 items-center justify-center rounded-lg transition-transform focus-visible:ring-2 focus-visible:outline-none"
          >
            <Cancel01Icon size={16} />
          </button>
          {!connected ? (
            <p className="text-muted mt-2 text-xs">{t('settings.brain.unavailable')}</p>
          ) : null}
        </div>
      ) : (
        <div
          className={cn(
            'flex min-h-[150px] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-transform',
            isOver ? 'border-accent text-fg scale-[1.01]' : 'border-border text-muted'
          )}
        >
          <Icon size={32} aria-hidden />
          <div className="flex flex-col gap-1">
            <span className="text-fg text-sm font-medium">{t(emptyTitleKey)}</span>
            <span className="text-xs">{t(emptyHintKey)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
