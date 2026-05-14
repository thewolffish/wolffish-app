import { Tooltip } from '@components/core/tooltip/Tooltip'
import { useTranslation } from 'react-i18next'

type ContextMeterProps = {
  used: number
  budget: number
  locale: string
  size?: number
}

function formatCompact(n: number, locale: string): string {
  const fmt = (v: number): string => {
    try {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v)
    } catch {
      return String(v)
    }
  }
  if (n >= 1_000_000) return `${fmt(n / 1_000_000)}m`
  if (n >= 1_000) return `${fmt(n / 1_000)}k`
  return fmt(n)
}

function getColor(percent: number): string {
  if (percent >= 80) return '#ef4444'
  if (percent >= 50) return '#f59e0b'
  return '#22c55e'
}

function roundedRectPath(w: number, h: number, r: number, inset: number): string {
  const x = inset
  const y = inset
  const iw = w - inset * 2
  const ih = h - inset * 2
  const cr = Math.min(r, iw / 2, ih / 2)
  return [
    `M ${x + cr} ${y}`,
    `H ${x + iw - cr}`,
    `A ${cr} ${cr} 0 0 1 ${x + iw} ${y + cr}`,
    `V ${y + ih - cr}`,
    `A ${cr} ${cr} 0 0 1 ${x + iw - cr} ${y + ih}`,
    `H ${x + cr}`,
    `A ${cr} ${cr} 0 0 1 ${x} ${y + ih - cr}`,
    `V ${y + cr}`,
    `A ${cr} ${cr} 0 0 1 ${x + cr} ${y}`
  ].join(' ')
}

export function ContextMeter({
  used,
  budget,
  locale,
  size = 40
}: ContextMeterProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const percent = budget > 0 ? Math.min(Math.round((used / budget) * 100), 100) : 0
  const color = getColor(percent)

  const strokeWidth = 2.5
  const cornerRadius = 8
  const inset = strokeWidth / 2
  const d = roundedRectPath(size, size, cornerRadius, inset)

  const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  pathEl.setAttribute('d', d)
  const totalLength = pathEl.getTotalLength()
  const offset = totalLength - (percent / 100) * totalLength

  const tooltipText = t('chat.contextMeter.tooltip', {
    used: formatCompact(used, locale),
    max: formatCompact(budget, locale)
  })

  return (
    <Tooltip content={tooltipText} side="top">
      <span className="relative inline-flex h-10 w-10 shrink-0 cursor-default items-center justify-center">
        <svg width={size} height={size}>
          <path
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-border"
          />
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={totalLength}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <span
          className="absolute text-[10px] font-semibold leading-none"
          style={{ color }}
        >
          {percent}%
        </span>
      </span>
    </Tooltip>
  )
}
