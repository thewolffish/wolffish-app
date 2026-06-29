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
import { ArrowDown01Icon, BrainIcon, NeuralNetworkIcon } from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type ProviderId = CloudProviderConfig['id']
type OrchestratorMode = 'single' | 'orchestrator'
type ClickTarget = 'orchestrator' | 'worker'

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

const sameModel = (a: BrainSelection | null, p: ProviderId, m: string): boolean =>
  a?.providerId === p && a?.model === m

/**
 * A preference row — a bordered card with a title + detailed description on the
 * start side and a segmented toggle on the (top) end side. Matches the Off|On
 * settings toggle used across the panels (rounded border, bg-primary active).
 */
function PrefRow({
  title,
  description,
  options,
  value,
  onChange
}: {
  title: string
  description: string
  options: ReadonlyArray<{ value: string; label: string }>
  value: string
  onChange: (next: string) => void
}): React.JSX.Element {
  return (
    <div className="border-border flex items-start justify-between gap-4 rounded-2xl border p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-fg text-sm font-medium">{title}</span>
        <p className="text-muted text-xs leading-relaxed">{description}</p>
      </div>
      <div
        role="tablist"
        className="border-border bg-bg/40 inline-flex shrink-0 items-center rounded-lg border p-0.5"
      >
        {options.map((opt) => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => onChange(opt.value)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium',
                'focus-visible:ring-accent focus-visible:ring-offset-bg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
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
    </div>
  )
}

/**
 * The Brain page — choose the model(s) that power Wolffish in the cloud. One
 * full-width column: a mode toggle, the slot(s) to fill (one Brain in single
 * mode, an Orchestrator + Worker pair in orchestrator mode), then the list of
 * connected providers and their models. Set a slot by dragging a model card up
 * into it, or by clicking a card (which fills the slot the click-target tabs
 * point at). Local models stay reachable via the chat switcher only.
 */
export function BrainPage(): React.JSX.Element {
  const { t } = useTranslation()
  const { status, refreshStatus } = useFlow()

  // Read providers + selections straight from the synced flow status — already
  // loaded when Settings opened, so the page paints fully on first render.
  const providers = useMemo(
    () => status?.config?.llm.providers ?? [],
    [status?.config?.llm.providers]
  )
  const configBrain = status?.config?.llm.brain ?? null
  const configWorker = status?.config?.llm.workerModel ?? null
  const configMode: OrchestratorMode = status?.config?.llm.orchestratorMode ?? 'single'

  // Optimistic overrides so a click/drag/toggle takes effect instantly, before
  // the config round-trips back through the flow status. Cleared once settled.
  const [optimisticBrain, setOptimisticBrain] = useState<{ value: BrainSelection | null } | null>(
    null
  )
  const [optimisticWorker, setOptimisticWorker] = useState<{
    value: BrainSelection | null
  } | null>(null)
  const [optimisticMode, setOptimisticMode] = useState<OrchestratorMode | null>(null)
  const [optimisticGreedy, setOptimisticGreedy] = useState<boolean | null>(null)
  const [optimisticAutonomous, setOptimisticAutonomous] = useState<boolean | null>(null)
  const brain = optimisticBrain ? optimisticBrain.value : configBrain
  const worker = optimisticWorker ? optimisticWorker.value : configWorker
  const mode = optimisticMode ?? configMode
  const greedy = optimisticGreedy ?? status?.config?.llm.greedy ?? false
  const autonomous = optimisticAutonomous ?? status?.config?.llm.autonomous ?? false

  const [clickTarget, setClickTarget] = useState<ClickTarget>('orchestrator')
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

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

  // Pull the latest config when a provider/selection changes elsewhere — e.g.
  // the background model refresh broadcasts provider:updated on launch.
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

  // No in-flight guard: a click/drop updates the optimistic value instantly and
  // always registers (the config write is atomic + serialized, and refreshStatus
  // reconciles to the last write), so rapid re-selection is never swallowed.
  const commitBrain = useCallback(
    async (next: BrainSelection | null) => {
      setOptimisticBrain({ value: next })
      try {
        await window.api.provider.setBrain(next)
        await refreshStatus()
      } finally {
        setOptimisticBrain(null)
      }
    },
    [refreshStatus]
  )

  const commitWorker = useCallback(
    async (next: BrainSelection | null) => {
      setOptimisticWorker({ value: next })
      try {
        await window.api.provider.setWorkerModel(next)
        await refreshStatus()
      } finally {
        setOptimisticWorker(null)
      }
    },
    [refreshStatus]
  )

  const commitMode = useCallback(
    async (next: OrchestratorMode) => {
      setOptimisticMode(next)
      // Restart the click rotation at Orchestrator each time the mode is entered.
      if (next === 'orchestrator') setClickTarget('orchestrator')
      try {
        await window.api.provider.setOrchestratorMode(next)
        await refreshStatus()
      } finally {
        setOptimisticMode(null)
      }
    },
    [refreshStatus]
  )

  const commitGreedy = useCallback(
    async (next: boolean) => {
      setOptimisticGreedy(next)
      try {
        await window.api.provider.setGreedy(next)
        await refreshStatus()
      } finally {
        setOptimisticGreedy(null)
      }
    },
    [refreshStatus]
  )

  const commitAutonomous = useCallback(
    async (next: boolean) => {
      setOptimisticAutonomous(next)
      try {
        await window.api.provider.setAutonomous(next)
        await refreshStatus()
      } finally {
        setOptimisticAutonomous(null)
      }
    },
    [refreshStatus]
  )

  // Clicking models in orchestrator mode ALTERNATES which slot fills: first
  // click → Orchestrator, next → Worker, then back, and so on. (Drag-and-drop
  // is explicit — it always fills the slot the card is dropped on.) Single mode
  // always sets the one Brain.
  const commitClick = useCallback(
    (sel: BrainSelection) => {
      if (mode !== 'orchestrator') {
        void commitBrain(sel)
        return
      }
      if (clickTarget === 'worker') void commitWorker(sel)
      else void commitBrain(sel)
      setClickTarget((prev) => (prev === 'orchestrator' ? 'worker' : 'orchestrator'))
    },
    [mode, clickTarget, commitBrain, commitWorker]
  )

  const onDragStart = useCallback((e: DragStartEvent) => {
    setActiveDragId(String(e.active.id))
  }, [])
  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveDragId(null)
      const sel = decodeDragId(String(e.active.id))
      if (e.over?.id === 'brain-slot') void commitBrain(sel)
      else if (e.over?.id === 'worker-slot') void commitWorker(sel)
    },
    [commitBrain, commitWorker]
  )
  const onDragCancel = useCallback(() => setActiveDragId(null), [])

  // Connected cloud providers only (a saved API key). list() never returns the
  // local provider, so cloud-only falls out naturally.
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

  const isOrchestrator = mode === 'orchestrator'
  const brainConnected = brain ? connectedProviders.some((p) => p.id === brain.providerId) : true
  const workerConnected = worker ? connectedProviders.some((p) => p.id === worker.providerId) : true
  const brainSpec = brain ? findModelSpec(brain.providerId, brain.model) : null
  const workerSpec = worker ? findModelSpec(worker.providerId, worker.model) : null
  const dragged = activeDragId ? decodeDragId(activeDragId) : null

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.brain.title')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">{t('settings.brain.subtitle')}</p>
        </div>

        {/* Preferences: orchestrator mode + behavior toggles. */}
        <div className="flex flex-col gap-3">
          <PrefRow
            title={t('settings.brain.prefs.mode.title')}
            description={t('settings.brain.prefs.mode.description')}
            options={[
              { value: 'single', label: t('settings.brain.mode.single') },
              { value: 'orchestrator', label: t('settings.brain.mode.orchestrator') }
            ]}
            value={mode}
            onChange={(v) => void commitMode(v as OrchestratorMode)}
          />
          <PrefRow
            title={t('settings.brain.prefs.greedy.title')}
            description={t('settings.brain.prefs.greedy.description')}
            options={[
              { value: 'default', label: t('settings.brain.prefs.default') },
              { value: 'greedy', label: t('settings.brain.prefs.greedy.label') }
            ]}
            value={greedy ? 'greedy' : 'default'}
            onChange={(v) => void commitGreedy(v === 'greedy')}
          />
          <PrefRow
            title={t('settings.brain.prefs.autonomy.title')}
            description={t('settings.brain.prefs.autonomy.description')}
            options={[
              { value: 'default', label: t('settings.brain.prefs.default') },
              { value: 'autonomous', label: t('settings.brain.prefs.autonomy.label') }
            ]}
            value={autonomous ? 'autonomous' : 'default'}
            onChange={(v) => void commitAutonomous(v === 'autonomous')}
          />
        </div>

        {/* The slot(s) to fill: two side by side in orchestrator mode, one in
            single mode. Drop a model card onto a slot, or click a card below. */}
        {isOrchestrator ? (
          <div className="grid grid-cols-2 gap-4">
            <BrainSlot
              slotId="brain-slot"
              heading={t('settings.brain.orchestratorSlot')}
              role="orchestrator"
              brain={brain}
              spec={brainSpec}
              connected={brainConnected}
              onClear={() => void commitBrain(null)}
              icon={BrainIcon}
              sticky={false}
            />
            <BrainSlot
              slotId="worker-slot"
              heading={t('settings.brain.workerSlot')}
              role="worker"
              brain={worker}
              spec={workerSpec}
              connected={workerConnected}
              onClear={() => void commitWorker(null)}
              emptyTitleKey="settings.brain.workerEmpty.title"
              emptyHintKey="settings.brain.workerEmpty.hint"
              icon={NeuralNetworkIcon}
              sticky={false}
            />
          </div>
        ) : (
          <BrainSlot
            slotId="brain-slot"
            brain={brain}
            spec={brainSpec}
            connected={brainConnected}
            onClear={() => void commitBrain(null)}
            sticky={false}
          />
        )}

        {/* Connected providers + their models. */}
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
                    className="focus-visible:ring-accent focus-visible:ring-offset-bg hover:bg-border/30 -mx-2 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2.5 text-start focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    {Logo ? <Logo size={17} className="text-muted shrink-0" /> : null}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <h2 className="text-fg text-sm font-semibold">
                        {t(`settings.model.providers.${p.id}`)}
                      </h2>
                      <span className="text-muted truncate text-xs leading-snug">
                        {t(`settings.model.providers.descriptions.${p.id}`)}
                      </span>
                    </span>
                    <ArrowDown01Icon
                      size={15}
                      aria-hidden
                      className={cn(
                        'text-muted shrink-0 transition-transform',
                        isExpanded ? '' : '-rotate-90'
                      )}
                    />
                  </button>
                  {isExpanded ? (
                    models.length === 0 ? (
                      <p className="text-muted text-xs">{t('settings.brain.providerNoModels')}</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {models.map((modelId) => {
                          const isBrain = sameModel(brain, p.id, modelId)
                          const isWorker = isOrchestrator && sameModel(worker, p.id, modelId)
                          return (
                            <ProviderModelCard
                              key={modelId}
                              providerId={p.id}
                              modelId={modelId}
                              spec={findModelSpec(p.id, modelId)}
                              isSelected={isBrain || isWorker}
                              onSelect={() => commitClick({ providerId: p.id, model: modelId })}
                            />
                          )
                        })}
                      </div>
                    )
                  ) : null}
                </section>
              )
            })}
          </div>
        )}
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
