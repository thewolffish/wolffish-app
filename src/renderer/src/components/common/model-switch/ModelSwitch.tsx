import { OllamaLogo } from '@components/core/ProviderLogos'
import { cn } from '@lib/utils/cn'
import {
  BADGE_STYLES,
  isModelDisabled,
  findModelSpec,
  PROVIDER_LOGOS,
  PROVIDER_ORDER,
  shortModelName,
  sortOpenRouterModelIds
} from '@pages/settings/modelCatalog'
import type { BrainSelection, CloudProviderConfig } from '@preload/index'
import { CloudIcon, Search01Icon, Tick02Icon } from 'hugeicons-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Composer model switch: ONE control that is both the Local/Cloud switch and
 * the model selector. Two tabs — Local (Ollama logo + the local model's name)
 * and Cloud (active provider's logo + the cloud model's name) — with the
 * searchable, scrollable model-picker card built in (the ContextMeter
 * hover/pin recipe). Hovering previews the card; clicking the ACTIVE cloud
 * tab pins it; clicking the inactive tab switches runtime. Picking a model
 * writes the Brain (and switches to cloud when local was active) — the card
 * is the ONLY model-selection surface; settings keeps just the API keys.
 */
export function ModelSwitch({
  localOnly,
  localModel,
  providers,
  brain,
  disabled,
  onModeChange,
  onSelectModel
}: {
  localOnly: boolean
  localModel: string | null
  providers: CloudProviderConfig[]
  brain: BrainSelection | null
  disabled: boolean
  onModeChange: (localOnly: boolean) => void
  onSelectModel: (sel: BrainSelection) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [query, setQuery] = useState('')
  const [optimistic, setOptimistic] = useState<BrainSelection | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

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

  // Autofocus the search only when pinned (deliberate open), never on hover —
  // mousing across the composer must not steal focus from the textarea.
  useEffect(() => {
    if (!pinned) return
    const id = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [pinned])

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

  const shown = optimistic ?? brain
  const connected = useMemo(() => {
    const withKey = providers.filter((p) => p.apiKey && p.apiKey.length > 0)
    return [...withKey].sort((a, b) => PROVIDER_ORDER.indexOf(a.id) - PROVIDER_ORDER.indexOf(b.id))
  }, [providers])

  const activeCloud = useMemo(() => {
    if (!shown) return null
    return connected.some((p) => p.id === shown.providerId) ? shown : null
  }, [shown, connected])

  const q = query.trim().toLowerCase()
  const groups = useMemo(
    () =>
      connected
        .map((p) => {
          let ids = (p.models ?? []).filter(Boolean)
          if (ids.length === 0 && p.model) ids = [p.model]
          if (p.id === 'openrouter') ids = sortOpenRouterModelIds(ids)
          ids = ids.filter((m) => !isModelDisabled(m))
          if (q) {
            ids = ids.filter((m) => m.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
          }
          return { provider: p, ids }
        })
        .filter((g) => g.ids.length > 0),
    [connected, q]
  )

  // The tab text is the MODEL name (the icons already say local vs cloud) —
  // with nothing configured it must say so, not echo the mode name as if
  // "Local"/"Cloud" were a model.
  const CloudLogo = activeCloud ? PROVIDER_LOGOS[activeCloud.providerId] : CloudIcon
  const cloudName = activeCloud
    ? shortModelName(activeCloud.model)
    : t('chat.modeToggle.noModelShort')
  const localName = localModel ? shortModelName(localModel) : t('chat.modeToggle.noModelShort')

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

  const tabClass = (active: boolean): string =>
    cn(
      'flex w-24 flex-col items-center gap-0.5 rounded-md px-1.5 py-1',
      'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
      active ? 'bg-primary text-primary-fg' : cn('text-muted', !disabled && 'hover:text-fg'),
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
        className="border-border bg-surface inline-flex items-center gap-0.5 rounded-lg border p-0.5"
      >
        <button
          role="tab"
          type="button"
          disabled={disabled}
          aria-selected={localOnly}
          onClick={() => {
            if (disabled || localOnly) return
            setPinned(false)
            setOpen(false)
            onModeChange(true)
          }}
          className={tabClass(localOnly)}
        >
          <OllamaLogo size={14} />
          <span
            className="max-w-full truncate text-[10px] leading-tight font-medium"
            dir={localModel ? 'ltr' : 'auto'}
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
            className="max-w-full truncate text-[10px] leading-tight font-medium"
            dir={activeCloud ? 'ltr' : 'auto'}
          >
            {cloudName}
          </span>
        </button>
      </div>

      {cardVisible && (
        <div
          role="dialog"
          className="border-border bg-surface absolute bottom-full inset-s-0 z-50 mb-2 w-96 max-w-[90vw] rounded-xl border shadow-xl"
        >
          <div className="border-border flex items-center gap-2 border-b px-3 py-2">
            <Search01Icon size={14} className="text-muted shrink-0" />
            <input
              ref={searchRef}
              value={query}
              // Engaging the search is a deliberate open — pin the card so the
              // hover-leave timer can't close it out from under the typing.
              onFocus={() => {
                if (hoverTimer.current) clearTimeout(hoverTimer.current)
                setPinned(true)
                setOpen(true)
              }}
              onChange={(e) => {
                setQuery(e.target.value)
                setPinned(true)
              }}
              placeholder={t('chat.modelPicker.search')}
              className="bg-transparent text-fg placeholder:text-muted/50 w-full text-sm outline-none"
            />
          </div>
          {/* Model ids are technical LTR identifiers — the whole list renders
              LTR (logo → id → badges → context → check) even in the RTL UI,
              so rows never mirror around the ids. */}
          <div className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5" dir="ltr">
            {groups.length === 0 && (
              <div className="text-muted px-2 py-4 text-center text-xs" dir="auto">
                {connected.length === 0
                  ? t('chat.modelPicker.noProviders')
                  : t('chat.modelPicker.noResults')}
              </div>
            )}
            {groups.map(({ provider, ids }) => {
              const Logo = PROVIDER_LOGOS[provider.id]
              return (
                <div key={provider.id} className="mb-1.5 flex flex-col gap-1 last:mb-0">
                  <div className="text-muted flex items-center gap-1.5 px-2 pt-1.5 pb-0.5 text-[10px] font-medium tracking-wide uppercase">
                    {Logo ? <Logo size={12} /> : null}
                    <span dir="auto">{t(`settings.model.providers.${provider.id}`)}</span>
                  </div>
                  {ids.map((m) => {
                    const active =
                      activeCloud?.providerId === provider.id && activeCloud?.model === m
                    const spec = findModelSpec(provider.id, m)
                    return (
                      <button
                        key={`${provider.id}::${m}`}
                        type="button"
                        onClick={() => void pick(provider.id, m)}
                        className={cn(
                          'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-start',
                          'focus-visible:ring-2 focus-visible:ring-accent',
                          active ? 'bg-primary/10 text-fg' : 'text-fg hover:bg-border/40'
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate text-xs" dir="ltr">
                          {m}
                        </span>
                        {spec?.badges?.slice(0, 2).map((b) => (
                          <span
                            key={b}
                            dir="auto"
                            className={cn(
                              'inline-flex shrink-0 items-center rounded px-1 text-[9px] font-medium',
                              BADGE_STYLES[b]
                            )}
                          >
                            {t(`settings.model.cloud.breakdown.badges.${b}`)}
                          </span>
                        ))}
                        {spec?.context ? (
                          <span className="text-muted shrink-0 text-[10px] tabular-nums" dir="ltr">
                            {spec.context}
                          </span>
                        ) : null}
                        <span className="w-4 shrink-0">
                          {active ? <Tick02Icon size={14} className="text-primary" /> : null}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </span>
  )
}
