import { cn } from '@lib/utils/cn'
import { useCallback, useRef, useState, type ReactNode } from 'react'

type Side = 'top' | 'bottom' | 'left' | 'right'
type Align = 'center' | 'start' | 'end'

type TooltipProps = {
  content: ReactNode
  side?: Side
  align?: Align
  delay?: number
  className?: string
  children: ReactNode
}

const sideBase: Record<Side, string> = {
  top: 'bottom-full mb-1.5',
  bottom: 'top-full mt-1.5',
  left: 'right-full mr-1.5',
  right: 'left-full ml-1.5'
}

const horizontalAlign: Record<Align, string> = {
  center: 'left-1/2 -translate-x-1/2',
  start: 'left-0',
  end: 'right-0'
}

const verticalAlign: Record<Align, string> = {
  center: 'top-1/2 -translate-y-1/2',
  start: 'top-0',
  end: 'bottom-0'
}

const arrowSide: Record<Side, string> = {
  top: 'top-full border-t-surface',
  bottom: 'bottom-full border-b-surface',
  left: 'left-full border-l-surface',
  right: 'right-full border-r-surface'
}

const arrowHAlign: Record<Align, string> = {
  center: 'left-1/2 -translate-x-1/2',
  start: 'left-2',
  end: 'right-2'
}

const arrowVAlign: Record<Align, string> = {
  center: 'top-1/2 -translate-y-1/2',
  start: 'top-2',
  end: 'bottom-2'
}

const arrowBorders: Record<Side, string> = {
  top: 'border-l-transparent border-r-transparent border-b-transparent border-t-4 border-x-4 border-b-0',
  bottom:
    'border-l-transparent border-r-transparent border-t-transparent border-b-4 border-x-4 border-t-0',
  left: 'border-t-transparent border-b-transparent border-r-transparent border-l-4 border-y-4 border-r-0',
  right:
    'border-t-transparent border-b-transparent border-l-transparent border-r-4 border-y-4 border-l-0'
}

function getPositionClasses(side: Side, align: Align): string {
  const isHorizontal = side === 'top' || side === 'bottom'
  return cn(sideBase[side], isHorizontal ? horizontalAlign[align] : verticalAlign[align])
}

function getArrowClasses(side: Side, align: Align): string {
  const isHorizontal = side === 'top' || side === 'bottom'
  return cn(
    arrowSide[side],
    isHorizontal ? arrowHAlign[align] : arrowVAlign[align],
    arrowBorders[side]
  )
}

export function Tooltip({
  content,
  side = 'bottom',
  align = 'center',
  delay = 400,
  className,
  children
}: TooltipProps): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(() => {
    timer.current = setTimeout(() => setVisible(true), delay)
  }, [delay])

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setVisible(false)
  }, [])

  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && (
        <span
          role="tooltip"
          className={cn(
            'absolute z-50 whitespace-nowrap rounded-md bg-surface px-2 py-1 text-[11px] font-medium text-fg shadow-sm ring-1 ring-border',
            'pointer-events-none select-none',
            getPositionClasses(side, align),
            className
          )}
        >
          {content}
          <span className={cn('absolute h-0 w-0 border-solid', getArrowClasses(side, align))} />
        </span>
      )}
    </span>
  )
}
