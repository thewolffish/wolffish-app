import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy01Icon, Tick02Icon } from 'hugeicons-react'
import { cn } from '@lib/utils/cn'

export type CopyButtonProps = {
  text: string
  size?: number
  variant?: 'inline' | 'overlay'
  ariaLabelKey?: string
  className?: string
}

export function CopyButton({
  text,
  size = 14,
  variant = 'inline',
  ariaLabelKey = 'chat.copy',
  className
}: CopyButtonProps): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard write can fail in restricted contexts; silently swallow.
    }
  }

  const base =
    'inline-flex items-center gap-1 rounded-md text-xs cursor-pointer transition-colors ' +
    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
  const styles =
    variant === 'overlay'
      ? 'bg-surface/80 text-muted hover:text-fg border border-border/60 px-2 py-1 backdrop-blur'
      : 'text-muted hover:text-fg px-1.5 py-0.5'

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      aria-label={t(ariaLabelKey)}
      className={cn(base, styles, className)}
    >
      {copied ? <Tick02Icon size={size} /> : <Copy01Icon size={size} />}
      {/* Both labels share a single grid cell so the button reserves the
          wider of the two and never resizes when the state flips. */}
      <span className="grid text-center">
        <span
          aria-hidden={!copied}
          className={cn('col-start-1 row-start-1', !copied && 'invisible')}
        >
          {t('chat.copied')}
        </span>
        <span aria-hidden={copied} className={cn('col-start-1 row-start-1', copied && 'invisible')}>
          {t('chat.copy')}
        </span>
      </span>
    </button>
  )
}
