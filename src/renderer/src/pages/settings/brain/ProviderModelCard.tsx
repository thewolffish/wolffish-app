import { useDraggable } from '@dnd-kit/core'
import { cn } from '@lib/utils/cn'
import { ModelCardContent } from '@pages/settings/brain/ModelCardContent'
import { dragId } from '@pages/settings/brain/dragIds'
import type { ModelSpec } from '@pages/settings/modelCatalog'
import type { CloudProviderConfig } from '@preload/index'
import { useTranslation } from 'react-i18next'

type ProviderId = CloudProviderConfig['id']

/**
 * One model in a provider's list. Draggable (into the Brain slot) and
 * clickable — both do the exact same thing via `onSelect`. While dragging the
 * card itself fades; the floating preview is owned by the page's DragOverlay.
 */
export function ProviderModelCard({
  providerId,
  modelId,
  spec,
  isSelected,
  onSelect
}: {
  providerId: ProviderId
  modelId: string
  spec: ModelSpec | null
  isSelected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId(providerId, modelId)
  })

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onSelect}
      aria-label={t('settings.brain.cardAria', { model: modelId })}
      className={cn(
        'block h-full w-full touch-none rounded-2xl text-start transition-transform',
        'cursor-grab hover:-translate-y-0.5 active:cursor-grabbing',
        'focus-visible:ring-accent focus-visible:ring-offset-bg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        isSelected && 'ring-accent ring-2',
        isDragging && 'opacity-40'
      )}
      {...listeners}
      {...attributes}
    >
      <ModelCardContent
        providerId={providerId}
        modelId={modelId}
        spec={spec}
        variant="card"
        active={isSelected}
      />
    </button>
  )
}
