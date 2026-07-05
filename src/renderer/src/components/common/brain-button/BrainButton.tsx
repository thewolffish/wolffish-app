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

/** Full-sentence tooltip per mode. */
const MODE_TOOLTIP_KEY: Record<ReasoningMode, string> = {
  off: 'chat.reasoning.off',
  on: 'chat.reasoning.on',
  high: 'chat.reasoning.high',
  max: 'chat.reasoning.max'
}

/** One-word label shown under the brain icon inside the card. */
const MODE_SHORT_KEY: Record<ReasoningMode, string> = {
  off: 'chat.reasoning.shortOff',
  on: 'chat.reasoning.shortOn',
  high: 'chat.reasoning.shortHigh',
  max: 'chat.reasoning.shortMax'
}

/**
 * Single per-model reasoning control, styled like the composer's other card
 * buttons (new chat / mode toggle): a bordered surface card holding a w-14
 * column button — brain icon on top, one-word mode label (Off / Normal /
 * High / Max) beneath. Clicking cycles through this model's reasoning modes,
 * wrapping. State is conveyed by the label alone (uniform muted text, no
 * per-tier colours) and a localized hover tooltip naming the current mode in
 * one sentence.
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
    ? t(MODE_TOOLTIP_KEY[value] ?? MODE_TOOLTIP_KEY.on)
    : t('chat.reasoning.unsupported')
  const label = t(MODE_SHORT_KEY[value] ?? MODE_SHORT_KEY.off)

  const handleClick = (): void => {
    if (!cyclable) return
    const idx = modes.indexOf(value)
    const next = modes[(idx + 1) % modes.length] ?? modes[0]
    onCycle(next)
  }

  const interactive = cyclable && !disabled

  return (
    <span className="inline-flex shrink-0">
      <Tooltip content={tooltip} side="top" align="start">
        <div className="border-border bg-surface inline-flex shrink-0 items-center rounded-lg border p-0.5">
          <button
            type="button"
            onClick={handleClick}
            disabled={disabled || !cyclable}
            aria-label={t('chat.reasoning.ariaLabel')}
            aria-pressed={active}
            className={cn(
              'flex w-14 flex-col items-center gap-0.5 rounded-md px-1.5 py-1',
              'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              'disabled:pointer-events-none disabled:opacity-60',
              'text-muted',
              interactive ? 'cursor-pointer hover:text-fg' : 'cursor-not-allowed'
            )}
          >
            <BrainIcon size={14} />
            <span className="max-w-full truncate text-[10px] leading-tight font-medium">
              {label}
            </span>
          </button>
        </div>
      </Tooltip>
    </span>
  )
}
