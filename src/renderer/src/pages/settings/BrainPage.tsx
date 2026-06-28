import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { cn } from '@lib/utils/cn'
import { BrainSlot } from '@pages/settings/brain/BrainSlot'
import { decodeDragId } from '@pages/settings/brain/dragIds'
import { ModelCardContent } from '@pages/settings/brain/ModelCardContent'
import { ProviderModelCard } from '@pages/settings/brain/ProviderModelCard'
import {
  findModelSpec,
  isModelDisabled,
  PROVIDER_LOGOS,
  sortOpenRouterModelIds
} from '@pages/settings/modelCatalog'
import type { BrainSelection, CloudProviderConfig } from '@preload/index'
import { useFlow } from '@providers/flow/useFlow'
import { ArrowDown01Icon } from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type ProviderId = CloudProviderConfig['id']

// Display order for the provider sections: Chinese providers first (deepseek,
// z.ai, then the rest), Western next, the OpenRouter aggregator last. Anything
// not listed falls to the end in its natural order.
const PROVIDER_ORDER: ProviderId[] = [
  'deepseek',
  'zai',
  'qwen',
  'kimi',
  'minimax',
  'mimo',
  'stepfun',
  'anthropic',
  'openai',
  'xai',
  'openrouter'
]

/**
 * The Brain page — the centerpiece for choosing the single model that powers
 * Wolffish in the cloud. A pinned slot at the top holds the selected model; a
 * scrollable list of connected providers below offers their models as cards.
 * Set the Brain by dragging a card into the slot or clicking it — both are
 * first-class and take effect immediately. Local models stay reachable only
 * via the chat switcher.
 */
export function BrainPage(): React.JSX.Element {
  const { t } = useTranslation()
  const { status, refreshStatus } = useFlow()

  // Read providers + Brain straight from the synced flow status — already
  // loaded when Settings opened, so the page paints fully on first render (no
  // empty flash). The model lists are the catalogs persisted on each provider
  // test and refreshed passively in the background on launch.
  const providers = useMemo(
    () => status?.config?.llm.providers ?? [],
    [status?.config?.llm.providers]
  )
  const configBrain = status?.config?.llm.brain ?? null

  // Optimistic override so a click/drag fills the slot instantly, before the
  // config round-trips back through the flow status. Cleared once the write
  // settles — it rolls back to the config value if the write fails.
  const [optimisticBrain, setOptimisticBrain] = useState<{ value: BrainSelection | null } | null>(
    null
  )
  const brain = optimisticBrain ? optimisticBrain.value : configBrain

  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Provider sections collapse by default; the active model's provider starts
  // expanded. Clicking a header toggles it.
  const [expanded, setExpanded] = useState<Set<ProviderId>>(() => {
    const b = status?.config?.llm.brain
    return new Set(b ? [b.providerId] : [])
  })
  const toggleProvider = useCallback((id: ProviderId) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Pull the latest config when a provider/Brain changes elsewhere — e.g. the
  // background model refresh broadcasts provider:updated on launch.
  useEffect(() => {
    const off = window.api.provider.onUpdated(() => void refreshStatus())
    return off
  }, [refreshStatus])

  // A press under 6px is a click, not a drag — this is what makes click and
  // drag both first-class without one stealing the other.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  )

  const commitBrain = useCallback(
    async (next: BrainSelection | null) => {
      if (saving) return
      setOptimisticBrain({ value: next })
      setSaving(true)
      try {
        await window.api.provider.setBrain(next)
        await refreshStatus()
      } finally {
        setSaving(false)
        setOptimisticBrain(null)
      }
    },
    [saving, refreshStatus]
  )

  const onDragStart = useCallback((e: DragStartEvent) => {
    setActiveDragId(String(e.active.id))
  }, [])
  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveDragId(null)
      if (e.over?.id === 'brain-slot') {
        void commitBrain(decodeDragId(String(e.active.id)))
      }
    },
    [commitBrain]
  )
  const onDragCancel = useCallback(() => setActiveDragId(null), [])

  // Connected cloud providers only (a saved API key). list() never returns
  // the local provider, so cloud-only falls out naturally.
  const connectedProviders = useMemo(() => {
    const rank = (id: ProviderId): number => {
      const i = PROVIDER_ORDER.indexOf(id)
      return i === -1 ? PROVIDER_ORDER.length : i
    }
    return providers
      .filter((p) => p.apiKey && p.apiKey.length > 0)
      .sort((a, b) => rank(a.id) - rank(b.id))
  }, [providers])

  const modelsFor = useCallback((p: CloudProviderConfig): string[] => {
    const ids = p.models ?? []
    if (p.id === 'openrouter') {
      return sortOpenRouterModelIds(ids).filter((id) => !isModelDisabled(id))
    }
    return ids
  }, [])

  const brainConnected = brain ? connectedProviders.some((p) => p.id === brain.providerId) : true
  const brainSpec = brain ? findModelSpec(brain.providerId, brain.model) : null
  const dragged = activeDragId ? decodeDragId(activeDragId) : null

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-fg text-2xl font-semibold tracking-tight">
              {t('settings.brain.title')}
            </h1>
            <p className="text-muted text-sm leading-relaxed">{t('settings.brain.subtitle')}</p>
          </div>

          <BrainSlot
            brain={brain}
            spec={brainSpec}
            connected={brainConnected}
            onClear={() => void commitBrain(null)}
          />

          {connectedProviders.length === 0 ? (
            <p className="text-muted text-sm leading-relaxed">{t('settings.brain.noProviders')}</p>
          ) : (
            <div className="flex flex-col gap-8">
              {connectedProviders.map((p) => {
                const Logo = PROVIDER_LOGOS[p.id]
                const models = modelsFor(p)
                const isExpanded = expanded.has(p.id)
                return (
                  <section key={p.id} className="flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={() => toggleProvider(p.id)}
                      aria-expanded={isExpanded}
                      className="focus-visible:ring-accent focus-visible:ring-offset-bg hover:bg-border/30 -mx-2 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-start focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                    >
                      {Logo ? <Logo size={15} className="text-muted shrink-0" /> : null}
                      <h2 className="text-fg text-sm font-semibold">
                        {t(`settings.model.providers.${p.id}`)}
                      </h2>
                      <ArrowDown01Icon
                        size={15}
                        aria-hidden
                        className={cn(
                          'text-muted ms-auto shrink-0 transition-transform',
                          isExpanded ? '' : '-rotate-90'
                        )}
                      />
                    </button>
                    {isExpanded ? (
                      models.length === 0 ? (
                        <p className="text-muted text-xs">{t('settings.brain.providerNoModels')}</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {models.map((modelId) => (
                            <ProviderModelCard
                              key={modelId}
                              providerId={p.id}
                              modelId={modelId}
                              spec={findModelSpec(p.id, modelId)}
                              isSelected={brain?.providerId === p.id && brain?.model === modelId}
                              onSelect={() =>
                                void commitBrain({ providerId: p.id, model: modelId })
                              }
                            />
                          ))}
                        </div>
                      )
                    ) : null}
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <DragOverlay>
        {dragged ? (
          <ModelCardContent
            providerId={dragged.providerId}
            modelId={dragged.model}
            spec={findModelSpec(dragged.providerId, dragged.model)}
            variant="overlay"
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
