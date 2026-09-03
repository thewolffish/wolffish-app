import { ChipRow } from '@components/common/chip-row/ChipRow'
import { OllamaLogo } from '@components/core/ProviderLogos'
import { cn } from '@lib/utils/cn'
import type { ReasoningMode } from '@main/runtime/reasoning'
import {
  isModelDisabled,
  PROVIDER_LOGOS,
  PROVIDER_ORDER,
  shortModelName,
  sortOpenRouterModelIds
} from '@pages/settings/modelCatalog'
import type { BrainSelection, CloudProviderConfig, OllamaTag } from '@preload/index'
import {
  AiBrain01Icon,
  BrainIcon,
  BubbleChatIcon,
  CloudIcon,
  FireIcon,
  FlashIcon,
  WorkflowSquare03Icon
} from 'hugeicons-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type ChatMode = 'single' | 'workflow'

/** One-word title per reasoning mode, worn by its chip. */
const MODE_SHORT_KEY: Record<ReasoningMode, string> = {
  off: 'chat.reasoning.shortOff',
  on: 'chat.reasoning.shortOn',
  high: 'chat.reasoning.shortHigh',
  max: 'chat.reasoning.shortMax'
}

/** One-line description per reasoning mode, carried as the chip's tooltip. */
const MODE_DESC_KEY: Record<ReasoningMode, string> = {
  off: 'chat.reasoning.off',
  on: 'chat.reasoning.on',
  high: 'chat.reasoning.high',
  max: 'chat.reasoning.max'
}

/**
 * Effort ladder, one icon per mode: instant (no thinking) → brain →
 * amped brain → full burn.
 */
const MODE_ICON: Record<ReasoningMode, typeof BrainIcon> = {
  off: FlashIcon,
  on: BrainIcon,
  high: AiBrain01Icon,
  max: FireIcon
}

/**
 * Composer model switch: ONE control that is both the Local/Cloud switch and
 * the model selector. Two tabs — Local (Ollama logo + the local model's name)
 * and Cloud (active provider's logo + the cloud model's name) — with the
 * model-picker card built in (the ContextMeter hover/pin recipe). Hovering
 * previews the card; clicking a tab pins the card open (switching runtime
 * first when that tab wasn't the active one), so "switch to local" and "pick
 * WHICH local model" are one gesture.
 *
 * The card picks with the mobile chat controls' chip rows, not a list: one
 * x-scrolling row of installed Ollama models (read live from
 * `ollama:listInstalled` each time the card opens, so a model pulled in a
 * terminal shows up without a relaunch), one row of connected providers, and
 * one row of the active provider's models. Picking writes the local model or
 * the Brain — and flips the runtime switch when you picked from the other
 * side — the card is the ONLY model-selection surface; settings keeps just
 * the API keys.
 *
 * The card also carries the two per-turn knobs that used to be their own
 * composer pills — reasoning effort and chat mode — as one chip row each,
 * sitting above the search input. Same selections, same handlers, one panel.
 */
export function ModelSwitch({
  localOnly,
  localModel,
  providers,
  brain,
  disabled,
  reasoningModes,
  reasoningMode,
  chatMode,
  showControls,
  onModeChange,
  onSelectModel,
  onSelectLocalModel,
  onSelectReasoning,
  onSelectChatMode
}: {
  localOnly: boolean
  localModel: string | null
  providers: CloudProviderConfig[]
  brain: BrainSelection | null
  disabled: boolean
  /** Ordered reasoning modes this model honours (from reasoningModesFor). */
  reasoningModes: readonly ReasoningMode[]
  /** Active reasoning mode, already clamped to `reasoningModes`. */
  reasoningMode: ReasoningMode
  chatMode: ChatMode
  /** Chip rows hidden while recording, exactly as the old pills were. */
  showControls: boolean
  onModeChange: (localOnly: boolean) => void
  onSelectModel: (sel: BrainSelection) => Promise<void>
  /** Selects an already-installed Ollama model as the local model. */
  onSelectLocalModel: (model: string) => Promise<void>
  onSelectReasoning: (next: ReasoningMode) => void
  onSelectChatMode: (next: ChatMode) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [optimistic, setOptimistic] = useState<BrainSelection | null>(null)
  const [optimisticLocal, setOptimisticLocal] = useState<string | null>(null)
  const [installed, setInstalled] = useState<OllamaTag[]>([])
  const [optimisticChatMode, setOptimisticChatMode] = useState<ChatMode | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)

  // Escape unpins/closes; clicking outside while open closes.
  useEffect(() => {
    if (!open && !pinned) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setPinned(false)
        setOpen(false)
      }
    }
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPinned(false)
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, pinned])

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
    }
  }, [])

  const onEnter = (): void => {
    if (disabled) return
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setOpen(true), 150)
  }
  const onLeave = (): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (pinned) return
    hoverTimer.current = setTimeout(() => setOpen(false), 200)
  }
  const cardVisible = (open || pinned) && !disabled

  // Installed Ollama models, re-read every time the card opens: `ollama pull`
  // in a terminal (or an `ollama rm`) must be reflected without a relaunch.
  // Main already swallows a dead daemon into [], so an unreachable Ollama
  // simply leaves the local group empty.
  useEffect(() => {
    if (!cardVisible) return
    let cancelled = false
    void window.api.ollama
      .listInstalled()
      .then((tags) => {
        if (!cancelled) setInstalled(tags)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [cardVisible])

  const shown = optimistic ?? brain
  const connected = useMemo(() => {
    const withKey = providers.filter((p) => p.apiKey && p.apiKey.length > 0)
    return [...withKey].sort((a, b) => PROVIDER_ORDER.indexOf(a.id) - PROVIDER_ORDER.indexOf(b.id))
  }, [providers])

  const activeCloud = useMemo(() => {
    if (!shown) return null
    return connected.some((p) => p.id === shown.providerId) ? shown : null
  }, [shown, connected])

  const groups = useMemo(
    () =>
      connected
        .map((p) => {
          let ids = (p.models ?? []).filter(Boolean)
          if (ids.length === 0 && p.model) ids = [p.model]
          if (p.id === 'openrouter') ids = sortOpenRouterModelIds(ids)
          ids = ids.filter((m) => !isModelDisabled(m))
          return { provider: p, ids }
        })
        .filter((g) => g.ids.length > 0),
    [connected]
  )

  const shownLocal = optimisticLocal ?? localModel
  const localIds = useMemo(
    () => installed.map((tag) => tag.name).sort((a, b) => a.localeCompare(b)),
    [installed]
  )

  // The tab text is the MODEL name (the icons already say local vs cloud) —
  // with nothing configured it must say so, not echo the mode name as if
  // "Local"/"Cloud" were a model.
  const CloudLogo = activeCloud ? PROVIDER_LOGOS[activeCloud.providerId] : CloudIcon
  const cloudName = activeCloud
    ? shortModelName(activeCloud.model)
    : t('chat.modeToggle.noModelShort')
  const localName = shownLocal ? shortModelName(shownLocal) : t('chat.modeToggle.noModelShort')

  const pick = async (providerId: CloudProviderConfig['id'], model: string): Promise<void> => {
    const sel = { providerId, model }
    setOptimistic(sel)
    try {
      await onSelectModel(sel)
      // Picking a cloud model while running local means "use this model" —
      // flip the switch too instead of leaving the choice inert.
      if (localOnly) onModeChange(false)
    } finally {
      setOptimistic(null)
    }
  }

  const pickLocal = async (model: string): Promise<void> => {
    setOptimisticLocal(model)
    try {
      await onSelectLocalModel(model)
      // Mirror of `pick`: choosing from the other side of the switch means
      // "run this one", so flip the runtime too.
      if (!localOnly) onModeChange(true)
    } finally {
      setOptimisticLocal(null)
    }
  }

  // The chip rows, the mobile ModelSelector's rules. Provider chips: every
  // connected provider with a pickable model, plus a chip for a brain whose
  // provider is missing from that list — a row must never show nothing lit.
  const providerChips = useMemo(() => {
    const chipFor = (
      id: CloudProviderConfig['id']
    ): { value: string; label: string; icon?: React.ReactNode; activeIcon?: React.ReactNode } => {
      const Logo = PROVIDER_LOGOS[id]
      return {
        value: id as string,
        label: t(`settings.model.providers.${id}`),
        icon: Logo ? <Logo size={14} className="text-muted shrink-0" /> : undefined,
        activeIcon: Logo ? <Logo size={14} className="text-primary-fg shrink-0" /> : undefined
      }
    }
    const rows = groups.map(({ provider }) => chipFor(provider.id))
    if (shown && !groups.some(({ provider }) => provider.id === shown.providerId)) {
      rows.push(chipFor(shown.providerId))
    }
    return rows
  }, [groups, shown, t])

  // The shown provider's models. The chosen model can sit outside the list
  // (or the list can be empty) — it still needs a chip.
  const modelChips = useMemo(() => {
    const ids = [...(groups.find(({ provider }) => provider.id === shown?.providerId)?.ids ?? [])]
    if (shown?.model && !ids.includes(shown.model)) ids.push(shown.model)
    return ids.map((m) => ({ value: m, label: m }))
  }, [groups, shown])

  const localChips = useMemo(() => {
    const rows = localIds.map((m) => ({ value: m, label: m }))
    if (shownLocal && !localIds.includes(shownLocal)) {
      rows.push({ value: shownLocal, label: shownLocal })
    }
    return rows
  }, [localIds, shownLocal])

  // A provider chip picks the provider AND a model — its remembered one when
  // still pickable, else the first of its list — exactly like the mobile row.
  const pickProvider = (id: string): void => {
    const group = groups.find(({ provider }) => provider.id === id)
    if (!group) return
    const remembered = group.provider.model
    const model = remembered && group.ids.includes(remembered) ? remembered : group.ids[0]
    void pick(group.provider.id, model)
  }

  // Reasoning: unsupported models get the explanation line instead of chips,
  // and a single-mode model shows its chip inert — the old pill's rules.
  const reasoningSupported = reasoningModes.length > 0
  const reasoningSwitchable = reasoningModes.length > 1

  const pickReasoning = (next: ReasoningMode): void => {
    if (next !== reasoningMode) onSelectReasoning(next)
  }

  const shownChatMode = optimisticChatMode ?? chatMode
  const CHAT_MODES: Array<{
    key: ChatMode
    Icon: typeof BubbleChatIcon
    name: string
    desc: string
  }> = [
    {
      key: 'single',
      Icon: BubbleChatIcon,
      name: t('chat.modePicker.single'),
      desc: t('chat.modePicker.singleDesc')
    },
    {
      key: 'workflow',
      Icon: WorkflowSquare03Icon,
      name: t('chat.modePicker.workflow'),
      desc: t('chat.modePicker.workflowDesc')
    }
  ]

  const pickChatMode = async (next: ChatMode): Promise<void> => {
    setOptimisticChatMode(next)
    try {
      await onSelectChatMode(next)
    } finally {
      setOptimisticChatMode(null)
    }
  }

  const chipClass = (active: boolean, interactive: boolean): string =>
    cn(
      'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium',
      'focus-visible:ring-2 focus-visible:ring-accent',
      active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-fg',
      interactive && !active && 'hover:bg-border/40',
      interactive ? 'cursor-pointer' : 'cursor-default'
    )

  // Quiet footer chips (the composer card supplies the surface): the active
  // runtime reads as a soft primary tint, the inactive one as muted text.
  const tabClass = (active: boolean): string =>
    cn(
      'flex h-7 items-center gap-1.5 rounded-lg px-2',
      'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
      active ? 'bg-primary/10 text-primary' : cn('text-muted', !disabled && 'hover:text-fg'),
      disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
    )

  return (
    <span
      ref={rootRef}
      className="relative inline-flex shrink-0"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div
        role="tablist"
        aria-label={t('chat.modeToggle.ariaLabel')}
        className="inline-flex items-center gap-0.5"
      >
        <button
          role="tab"
          type="button"
          disabled={disabled}
          aria-selected={localOnly}
          aria-expanded={cardVisible}
          onClick={() => {
            if (disabled) return
            // Switching to Local opens the card on the installed-Ollama list:
            // the switch and the choice of which model are one gesture.
            if (!localOnly) {
              onModeChange(true)
              setPinned(true)
              setOpen(true)
              return
            }
            setPinned((p) => {
              const next = !p
              if (next) setOpen(true)
              return next
            })
          }}
          onFocus={onEnter}
          onBlur={onLeave}
          className={tabClass(localOnly)}
        >
          <OllamaLogo size={14} />
          <span
            className="max-w-64 truncate text-[11px] leading-tight font-medium"
            dir={shownLocal ? 'ltr' : 'auto'}
          >
            {localName}
          </span>
        </button>
        <button
          role="tab"
          type="button"
          disabled={disabled}
          aria-selected={!localOnly}
          aria-expanded={cardVisible}
          onClick={() => {
            if (disabled) return
            if (localOnly) {
              onModeChange(false)
              return
            }
            setPinned((p) => {
              const next = !p
              if (next) setOpen(true)
              return next
            })
          }}
          onFocus={onEnter}
          onBlur={onLeave}
          className={tabClass(!localOnly)}
        >
          <CloudLogo size={14} />
          <span
            className="max-w-64 truncate text-[11px] leading-tight font-medium"
            dir={activeCloud ? 'ltr' : 'auto'}
          >
            {cloudName}
          </span>
        </button>
      </div>

      {cardVisible && (
        <div
          role="dialog"
          className="border-border bg-surface absolute bottom-full inset-s-0 z-50 mb-2 w-104 max-w-[90vw] rounded-xl border shadow-xl"
        >
          {showControls && (
            <div className="border-border flex flex-col gap-1.5 border-b px-3 py-2.5">
              <div
                role="group"
                aria-label={t('chat.reasoning.ariaLabel')}
                className="flex items-center gap-1.5"
              >
                <span className="text-muted w-14 shrink-0 text-[10px] font-medium tracking-wide uppercase">
                  {t('chat.reasoning.label')}
                </span>
                {!reasoningSupported ? (
                  <span className="text-muted text-[11px] leading-snug" dir="auto">
                    {t('chat.reasoning.unsupported')}
                  </span>
                ) : (
                  reasoningModes.map((m) => {
                    const isActive = m === reasoningMode
                    const RowIcon = MODE_ICON[m]
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={!reasoningSwitchable}
                        title={t(MODE_DESC_KEY[m])}
                        onClick={() => pickReasoning(m)}
                        className={chipClass(isActive, reasoningSwitchable)}
                      >
                        <RowIcon
                          size={13}
                          className={cn('shrink-0', isActive ? 'text-primary' : 'text-muted')}
                        />
                        {t(MODE_SHORT_KEY[m])}
                      </button>
                    )
                  })
                )}
              </div>
              <div
                role="group"
                aria-label={t('chat.modePicker.ariaLabel')}
                className="flex items-center gap-1.5"
              >
                <span className="text-muted w-14 shrink-0 text-[10px] font-medium tracking-wide uppercase">
                  {t('chat.modePicker.label')}
                </span>
                {CHAT_MODES.map(({ key, Icon, name, desc }) => {
                  const isActive = key === shownChatMode
                  return (
                    <button
                      key={key}
                      type="button"
                      title={desc}
                      onClick={() => void pickChatMode(key)}
                      className={chipClass(isActive, true)}
                    >
                      <Icon
                        size={13}
                        className={cn('shrink-0', isActive ? 'text-primary' : 'text-muted')}
                      />
                      {name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {/* The mobile chat controls' chip rows: local models, providers,
              then the shown provider's models — each the whole list on one
              x-scrolling line. Model ids are technical LTR identifiers, so
              their chips hold LTR even in the RTL UI; the side labels flip
              with the locale like the reasoning and mode labels above. */}
          <div className="flex flex-col gap-2 px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="text-muted flex w-14 shrink-0 items-center gap-1 text-[10px] font-medium tracking-wide uppercase">
                <OllamaLogo size={12} className="shrink-0" />
                <span dir="auto" className="truncate">
                  {t('settings.model.providers.ollama')}
                </span>
              </span>
              {localChips.length === 0 ? (
                <span className="text-muted text-[11px] leading-snug" dir="auto">
                  {t('chat.modelPicker.noLocalModels')}
                </span>
              ) : (
                <ChipRow
                  className="min-w-0 flex-1"
                  ariaLabel={t('settings.model.providers.ollama')}
                  ltrLabels
                  chips={localChips}
                  value={shownLocal ?? ''}
                  onChange={(m) => void pickLocal(m)}
                />
              )}
            </div>
            {connected.length === 0 ? (
              <div className="flex items-center gap-1.5">
                <span className="text-muted w-14 shrink-0 text-[10px] font-medium tracking-wide uppercase">
                  {t('chat.modelPicker.providersLabel')}
                </span>
                <span className="text-muted text-[11px] leading-snug" dir="auto">
                  {t('chat.modelPicker.noProviders')}
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted w-14 shrink-0 text-[10px] font-medium tracking-wide uppercase">
                    {t('chat.modelPicker.providersLabel')}
                  </span>
                  <ChipRow
                    className="min-w-0 flex-1"
                    ariaLabel={t('chat.modelPicker.providersLabel')}
                    chips={providerChips}
                    value={shown?.providerId ?? ''}
                    onChange={pickProvider}
                  />
                </div>
                {modelChips.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted w-14 shrink-0 text-[10px] font-medium tracking-wide uppercase">
                      {t('chat.modelPicker.modelLabel')}
                    </span>
                    {/* Switching provider swaps the whole chip set: remount so
                        the fresh row starts at its edge and carries the new
                        lit chip in. */}
                    <ChipRow
                      key={shown?.providerId ?? 'none'}
                      className="min-w-0 flex-1"
                      ariaLabel={t('chat.modelPicker.modelLabel')}
                      ltrLabels
                      chips={modelChips}
                      value={shown?.model ?? ''}
                      onChange={(m) => {
                        if (shown) void pick(shown.providerId, m)
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </span>
  )
}
