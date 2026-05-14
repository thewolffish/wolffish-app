import type { ReactNode } from 'react'
import { cn } from '@lib/utils/cn/cn'

/**
 * Forces left-to-right rendering for numeric content (sizes, percentages,
 * speeds, durations). Without `dir="ltr"`, strings like "5 GB" or "1.2 MB/s"
 * get reordered under RTL (Arabic) and end up reading wrong.
 */
export function Num({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <span dir="ltr" className={cn('inline-block tabular-nums', className)}>
      {children}
    </span>
  )
}
