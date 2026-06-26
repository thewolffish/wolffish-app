import { Tooltip } from '@components/core/Tooltip'
import { cn } from '@lib/utils/cn'
import type { ReasoningMode } from '@main/runtime/reasoning'
import { BrainIcon } from 'hugeicons-react'
import type React from 'react'
import { useTranslation } from 'react-i18next'

type BrainButtonProps = {
  /** Ordered reasoning modes this model honours (from reasoningModesFor). */
  modes: readonly ReasoningMode[]
  /** Currently-selected mode (already clamped to `modes`). */
  value: ReasoningMode
  /** Called with the next mode when the user cycles. */
  onCycle: (next: ReasoningMode) => void
  disabled?: boolean
}

const MODE_LABEL_KEY: Record<ReasoningMode, string> = {
  off: 'chat.reasoning.off',
  on: 'chat.reasoning.on',
  high: 'chat.reasoning.high',
  max: 'chat.reasoning.max'
}

// Escalating reasoning tiers (4 total, no 5th yet): gray (off) → primary
// (on / high — the first active level; a model never exposes both, so they
// share this tier) → purple (max) → orange (reserved for a future tier above
// max — no mode maps to it today).
const MODE_STYLE: Record<ReasoningMode, string> = {
  off: 'border-border bg-surface text-muted',
  on: 'border-primary/40 bg-primary/10 text-primary',
  high: 'border-primary/40 bg-primary/10 text-primary',
  max: 'border-purple-500/50 bg-purple-500/10 text-purple-500 dark:border-purple-400/50 dark:text-purple-400'
}

/**
 * Single per-model reasoning control: a ghost/outline icon button that
 * mirrors the send button's size and shape. Clicking cycles through this
 * model's reasoning modes, wrapping. State is conveyed by colour (gray off →
 * primary on/high → purple max, with orange reserved for a future tier) and a
 * localized hover tooltip naming the current mode in one sentence.
 *
 * Uses the shared Tooltip so it is byte-for-byte the same as every other
 * tooltip in the app (e.g. the cloud/local model switch). `pointer-events-none`
 * on the disabled button lets the tooltip wrapper still receive hover, so the
 * tooltip shows for unsupported/always-on models too.
 *
 * Rendered for every provider. When the model has no reasoning modes ([]) or
 * exactly one always-on mode (['on']) the button is disabled rather than hidden
 * so the control's position stays stable across model switches.
 */
export function BrainButton({
  modes,
  value,
  onCycle,
  disabled = false
}: BrainButtonProps): React.JSX.Element {
  const { t } = useTranslation()

  const supported = modes.length > 0
  const cyclable = modes.length > 1
  const active = supported && value !== 'off'

  const tooltip = supported
    ? t(MODE_LABEL_KEY[value] ?? MODE_LABEL_KEY.on)
    : t('chat.reasoning.unsupported')

  const handleClick = (): void => {
    if (!cyclable) return
    const idx = modes.indexOf(value)
    const next = modes[(idx + 1) % modes.length] ?? modes[0]
    onCycle(next)
  }

  const interactive = cyclable && !disabled

  return (
    <span className="inline-flex shrink-0">
      <Tooltip content={tooltip} side="top">
        <button
          type="button"
          onClick={handleClick}
          disabled={disabled || !cyclable}
          aria-label={t('chat.reasoning.ariaLabel')}
          aria-pressed={active}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border',
            'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            'disabled:pointer-events-none disabled:opacity-50',
            interactive ? 'cursor-pointer' : 'cursor-not-allowed',
            MODE_STYLE[value] ?? MODE_STYLE.off,
            interactive && active && 'hover:brightness-110',
            interactive && !active && 'hover:text-fg hover:border-muted'
          )}
        >
          <BrainIcon size={18} />
        </button>
      </Tooltip>
    </span>
  )
}
