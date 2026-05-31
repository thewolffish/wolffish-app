import { cn } from '@lib/utils/cn'
import { ArrowDown01Icon, Tick02Icon } from 'hugeicons-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export type SelectOption<T extends string> = {
  value: T
  label: string
  icon?: ReactNode
  disabled?: boolean
}

export type SelectProps<T extends string> = {
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  label?: string
  disabled?: boolean
  placeholder?: string
  className?: string
  id?: string
  /** Max height of the dropdown list in pixels. Beyond this, the list scrolls. */
  maxHeight?: number
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  placeholder,
  className,
  id,
  maxHeight = 300
}: SelectProps<T>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const generatedId = useId()
  const buttonId = id ?? `select-${generatedId}`
  const listboxId = `${buttonId}-listbox`
  const labelId = `${buttonId}-label`

  const selected = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) setOpen(false)
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

  return (
    <div ref={rootRef} className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label id={labelId} htmlFor={buttonId} className="text-muted text-sm font-medium">
          {label}
        </label>
      )}
      <div className="relative">
        <button
          ref={buttonRef}
          id={buttonId}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-labelledby={label ? labelId : undefined}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'bg-bg text-fg border-border hover:border-muted w-full',
            'flex h-10 items-center justify-between gap-2 rounded-lg border px-3 text-sm',
            'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            'disabled:cursor-not-allowed disabled:opacity-50',
            open && 'border-accent'
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected?.icon && (
              <span className="text-muted flex shrink-0 items-center">{selected.icon}</span>
            )}
            <span className={cn('truncate', !selected && placeholder && 'text-muted')}>
              {selected?.label ?? placeholder}
            </span>
          </span>
          <ArrowDown01Icon
            size={16}
            className={cn(
              'text-muted shrink-0 transition-transform duration-150',
              open && 'rotate-180'
            )}
          />
        </button>
        {open && (
          <ul
            id={listboxId}
            role="listbox"
            aria-labelledby={label ? labelId : undefined}
            style={{ maxHeight }}
            className={cn(
              'bg-bg border-border absolute z-20 mt-1.5 w-full overflow-y-auto',
              'rounded-lg border shadow-lg',
              'py-1'
            )}
          >
            {options.map((option) => {
              const isSelected = option.value === value
              const isDisabled = option.disabled === true
              return (
                <li
                  key={option.value}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={isDisabled || undefined}
                  onClick={() => {
                    if (isDisabled) return
                    onChange(option.value)
                    setOpen(false)
                    buttonRef.current?.focus()
                  }}
                  className={cn(
                    'flex items-center justify-between gap-2 px-3 py-2 text-sm',
                    isDisabled
                      ? 'cursor-not-allowed opacity-40'
                      : cn('cursor-pointer hover:bg-border/50'),
                    isSelected && 'text-primary font-medium'
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {option.icon && (
                      <span
                        className={cn(
                          'flex shrink-0 items-center',
                          isSelected ? 'text-primary' : 'text-muted'
                        )}
                      >
                        {option.icon}
                      </span>
                    )}
                    <span className="truncate">{option.label}</span>
                  </span>
                  {isSelected && <Tick02Icon size={16} className="text-primary shrink-0" />}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
