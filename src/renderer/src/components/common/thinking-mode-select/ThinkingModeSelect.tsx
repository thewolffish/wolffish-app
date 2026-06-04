import { cn } from '@lib/utils/cn'
import { ArrowDown01Icon, Tick02Icon } from 'hugeicons-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type ThinkingModeOption = {
  value: string
  labelKey: string
  tooltipKey?: string
}

type ThinkingModeSelectProps = {
  value: string
  options: readonly ThinkingModeOption[]
  onChange: (value: string) => void
  disabled?: boolean
}

export function ThinkingModeSelect({
  value,
  options,
  onChange,
  disabled = false
}: ThinkingModeSelectProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const selected = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (options.length === 0) return null

  return (
    <div ref={rootRef} className="relative self-stretch">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('chat.thinkingMode.ariaLabel')}
        title={selected ? t(selected.tooltipKey ?? selected.labelKey) : ''}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'border-border bg-surface inline-flex h-full items-center gap-1 rounded-lg border px-2.5',
          'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          disabled && 'cursor-not-allowed opacity-60',
          !disabled && 'cursor-pointer',
          open && 'border-accent'
        )}
      >
        <span className="relative text-[10px] leading-tight font-medium text-fg">
          {selected ? t(selected.labelKey) : ''}
          {options.map((o) => (
            <span key={o.value} aria-hidden className="pointer-events-none invisible block h-0">
              {t(o.labelKey)}
            </span>
          ))}
        </span>
        <ArrowDown01Icon
          size={10}
          className={cn(
            'text-muted shrink-0 transition-transform duration-150',
            open && 'rotate-180'
          )}
        />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={t('chat.thinkingMode.ariaLabel')}
          className={cn(
            'bg-bg border-border absolute bottom-full z-20 mb-1.5 min-w-full overflow-y-auto',
            'rounded-lg border shadow-lg',
            'py-1'
          )}
          style={{ maxHeight: 200 }}
        >
          {options.map((option) => {
            const isSelected = option.value === value
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                  buttonRef.current?.focus()
                }}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-3 whitespace-nowrap px-3 py-1.5 text-[11px]',
                  'hover:bg-border/50',
                  isSelected && 'text-primary font-medium'
                )}
              >
                <span className="truncate">{t(option.labelKey)}</span>
                {isSelected && <Tick02Icon size={12} className="text-primary shrink-0" />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
