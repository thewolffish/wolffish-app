import { useDroppable } from '@dnd-kit/core'
import { cn } from '@lib/utils/cn'
import { ModelCardContent } from '@pages/settings/brain/ModelCardContent'
import type { ModelSpec } from '@pages/settings/modelCatalog'
import type { BrainSelection } from '@preload/index'
import { BrainIcon, Cancel01Icon } from 'hugeicons-react'
import { useTranslation } from 'react-i18next'

/**
 * The Brain slot — the single drop target, pinned to the top of the page so
 * it never scrolls away while the provider list scrolls under it. Filled with
 * the selected model, or a centered empty drop target inviting drop-or-click.
 */
export function BrainSlot({
  brain,
  spec,
  connected,
  onClear
}: {
  brain: BrainSelection | null
  spec: ModelSpec | null
  connected: boolean
  onClear: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { setNodeRef, isOver } = useDroppable({ id: 'brain-slot' })

  return (
    <div ref={setNodeRef} className="bg-bg sticky top-0 z-20 pt-1 pb-4">
      {brain ? (
        <div className={cn('relative rounded-2xl transition-transform', isOver && 'scale-[1.01]')}>
          <div className={cn('rounded-2xl', isOver && 'ring-accent ring-2')}>
            <ModelCardContent
              providerId={brain.providerId}
              modelId={brain.model}
              spec={spec}
              variant="slot"
              active
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
          <BrainIcon size={32} aria-hidden />
          <div className="flex flex-col gap-1">
            <span className="text-fg text-sm font-medium">{t('settings.brain.empty.title')}</span>
            <span className="text-xs">{t('settings.brain.empty.hint')}</span>
          </div>
        </div>
      )}
    </div>
  )
}
