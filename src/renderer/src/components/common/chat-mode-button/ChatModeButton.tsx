import { cn } from '@lib/utils/cn'
import { BubbleChatIcon, WorkflowSquare03Icon } from 'hugeicons-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type ChatMode = 'single' | 'workflow'

/**
 * Composer mode picker: a card-style pill showing the active chat mode's icon
 * + name, opening a hover/pin card (the ContextMeter recipe) with the two
 * modes — Single (solo turns, today's loop) and Workflow (the model plans
 * phases and drives live parallel agents). One click switches; the setting is
 * global and applies from the next turn.
 */
export function ChatModeButton({
  mode,
  disabled,
  onSelect
}: {
  mode: ChatMode
  disabled: boolean
  onSelect: (mode: ChatMode) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [optimistic, setOptimistic] = useState<ChatMode | null>(null)
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

  const shown = optimistic ?? mode

  const MODES: Array<{
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
  const active = MODES.find((m) => m.key === shown) ?? MODES[0]
  const ActiveIcon = active.Icon

  const pick = async (next: ChatMode): Promise<void> => {
    setOptimistic(next)
    try {
      await onSelect(next)
    } finally {
      setOptimistic(null)
      setPinned(false)
      setOpen(false)
    }
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
          aria-label={t('chat.modePicker.ariaLabel')}
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
          <ActiveIcon size={14} />
          <span className="max-w-full truncate text-[10px] leading-tight font-medium">
            {active.name}
          </span>
        </button>
      </span>

      {cardVisible && (
        <div
          role="dialog"
          className="border-border bg-surface absolute bottom-full inset-s-0 z-50 mb-2 flex w-80 max-w-[90vw] flex-col gap-1.5 rounded-xl border p-1.5 shadow-xl"
        >
          {MODES.map(({ key, Icon, name, desc }) => {
            const isActive = key === shown
            return (
              <button
                key={key}
                type="button"
                onClick={() => void pick(key)}
                className={cn(
                  'flex w-full cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2 text-start',
                  'focus-visible:ring-2 focus-visible:ring-accent',
                  isActive ? 'border-primary/40 bg-primary/10' : 'border-border hover:bg-border/40'
                )}
              >
                <Icon
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
                    {name}
                  </span>
                  <span className="text-muted block text-[11px] leading-snug">{desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}
