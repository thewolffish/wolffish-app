import { cn } from '@lib/utils/cn'
import type { ReasoningMode } from '@main/runtime/reasoning'
import { AiBrain01Icon, BrainIcon, FireIcon, FlashIcon } from 'hugeicons-react'
import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

type BrainButtonProps = {
  /** Ordered reasoning modes this model honours (from reasoningModesFor). */
  modes: readonly ReasoningMode[]
  /** Currently-selected mode (already clamped to `modes`). */
  value: ReasoningMode
  /** Called with the mode the user picked from the card. */
  onSelect: (next: ReasoningMode) => void
  disabled?: boolean
}

/** One-word title shown on the pill and as each card row's name. */
const MODE_SHORT_KEY: Record<ReasoningMode, string> = {
  off: 'chat.reasoning.shortOff',
  on: 'chat.reasoning.shortOn',
  high: 'chat.reasoning.shortHigh',
  max: 'chat.reasoning.shortMax'
}

/** One-line description per mode, shown under the title on its card row. */
const MODE_DESC_KEY: Record<ReasoningMode, string> = {
  off: 'chat.reasoning.off',
  on: 'chat.reasoning.on',
  high: 'chat.reasoning.high',
  max: 'chat.reasoning.max'
}

/**
 * Effort ladder, one icon per mode: instant (no thinking) → brain →
 * amped brain → full burn. The pill wears the ACTIVE mode's icon.
 */
const MODE_ICON: Record<ReasoningMode, typeof BrainIcon> = {
  off: FlashIcon,
  on: BrainIcon,
  high: AiBrain01Icon,
  max: FireIcon
}

/**
 * Per-model reasoning control, matching the mode button's UX: a card-style
 * pill (brain icon + the current effort's one-word label) opening a hover/pin
 * card that lists every effort this model supports — title + one-line
 * description each, active row highlighted, one click to switch.
 *
 * Rendered for every provider. When the model has no adjustable reasoning the
 * pill is disabled rather than hidden (stable composer layout) and the hover
 * card explains why instead of listing modes.
 */
export function BrainButton({
  modes,
  value,
  onSelect,
  disabled = false
}: BrainButtonProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)

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

  const supported = modes.length > 0
  const switchable = modes.length > 1

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

  const label = t(MODE_SHORT_KEY[supported ? value : 'off'])
  const PillIcon = supported ? MODE_ICON[value] : BrainIcon

  const pick = (next: ReasoningMode): void => {
    if (next !== value) onSelect(next)
    setPinned(false)
    setOpen(false)
  }

  return (
    <span
      ref={rootRef}
      className="relative inline-flex shrink-0"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <span className="border-border bg-surface inline-flex shrink-0 items-center rounded-lg border p-0.5">
        <button
          type="button"
          disabled={disabled}
          aria-label={t('chat.reasoning.ariaLabel')}
          aria-expanded={cardVisible}
          onClick={() => {
            if (disabled) return
            setPinned((p) => {
              const next = !p
              if (next) setOpen(true)
              return next
            })
          }}
          onFocus={onEnter}
          onBlur={onLeave}
          className={cn(
            'flex w-14 flex-col items-center gap-0.5 rounded-md px-1.5 py-1',
            'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            'text-muted',
            !disabled && 'cursor-pointer hover:text-fg',
            disabled && 'cursor-not-allowed opacity-60'
          )}
        >
          <PillIcon size={14} />
          <span className="max-w-full truncate text-[10px] leading-tight font-medium">{label}</span>
        </button>
      </span>

      {cardVisible && (
        <div
          role="dialog"
          className="border-border bg-surface absolute bottom-full inset-s-0 z-50 mb-2 flex w-80 max-w-[90vw] flex-col gap-1.5 rounded-xl border p-1.5 shadow-xl"
        >
          {!supported ? (
            <div className="text-muted px-2.5 py-2 text-[11px] leading-snug" dir="auto">
              {t('chat.reasoning.unsupported')}
            </div>
          ) : (
            modes.map((m) => {
              const isActive = m === value
              const RowIcon = MODE_ICON[m]
              return (
                <button
                  key={m}
                  type="button"
                  disabled={!switchable}
                  onClick={() => pick(m)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-start',
                    'focus-visible:ring-2 focus-visible:ring-accent',
                    isActive ? 'border-primary/40 bg-primary/10' : 'border-border',
                    switchable && !isActive && 'hover:bg-border/40',
                    switchable ? 'cursor-pointer' : 'cursor-default'
                  )}
                >
                  <RowIcon
                    size={16}
                    className={cn('mt-0.5 shrink-0', isActive ? 'text-primary' : 'text-muted')}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-xs font-medium',
                        isActive ? 'text-primary' : 'text-fg'
                      )}
                    >
                      {t(MODE_SHORT_KEY[m])}
                    </span>
                    <span className="text-muted block text-[11px] leading-snug">
                      {t(MODE_DESC_KEY[m])}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}
    </span>
  )
}
