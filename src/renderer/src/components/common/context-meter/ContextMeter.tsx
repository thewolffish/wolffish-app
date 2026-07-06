import {
  AnthropicLogo,
  DeepSeekLogo,
  KimiLogo,
  MiniMaxLogo,
  MimoLogo,
  OllamaLogo,
  OpenAILogo,
  OpenRouterLogo,
  QwenLogo,
  StepfunLogo,
  XAILogo,
  ZaiLogo
} from '@components/core/ProviderLogos'
import type { ConversationStats, ConversationTurnStats } from '@preload/index'
import {
  Activity04Icon,
  ArrowDown02Icon,
  ArrowUp02Icon,
  ChartHistogramIcon,
  Clock01Icon,
  CpuIcon,
  Database01Icon,
  Database02Icon,
  DollarCircleIcon,
  HourglassIcon,
  RepeatIcon
} from 'hugeicons-react'
import type { ComponentType } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// provider id → brand logo, for the card header. Local (Ollama) included.
const PROVIDER_LOGOS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  anthropic: AnthropicLogo,
  openai: OpenAILogo,
  openrouter: OpenRouterLogo,
  deepseek: DeepSeekLogo,
  mimo: MimoLogo,
  kimi: KimiLogo,
  minimax: MiniMaxLogo,
  xai: XAILogo,
  qwen: QwenLogo,
  stepfun: StepfunLogo,
  zai: ZaiLogo,
  local: OllamaLogo
}

/** Workflow-agent + summarization spend observed during the live turn. */
export type SideSpend = {
  workerTurns: number
  workerCalls: number
  workerTokens: number
  workerCost: number
  summaryCalls: number
  summaryTokens: number
  summaryCost: number
}

/** Most recent brain API call, including the window composition. */
export type MeterLastCall = {
  provider: string
  model: string
  durationMs: number
  fresh: number
  cacheRead: number
  cacheWrite: number
}

type ContextMeterProps = {
  used: number
  budget: number
  /** Token count where auto-compaction triggers; drawn as a tick on the bar. */
  compactionAt: number | null
  locale: string
  turnStartedAt: number | null
  turnEndedAt: number | null
  turnInputTokens: number | null
  turnOutputTokens: number | null
  turnCacheReadTokens: number | null
  turnCacheWriteTokens: number | null
  lastTurn: ConversationTurnStats | null
  allTime: ConversationStats['allTime'] | null
  sideSpend: SideSpend | null
  lastCall: MeterLastCall | null
  /** Latest call reported no usage — the reading shown is the last known one. */
  usageUnavailable: boolean
  /** Model the current reading was measured under (may differ from active). */
  meterModel: string | null
  activeModel: string | null
  /** Provider id of the meter's model, for the header brand logo. */
  provider: string | null
}

// Segment colors for the context-composition bar. Raw hex on purpose — these
// are data colors (like the ring's green/amber/red), not theme surfaces.
const COLOR_FRESH = '#22c55e'
const COLOR_CACHE_READ = '#60a5fa'
const COLOR_CACHE_WRITE = '#a78bfa'

/** Locale-aware compact token count: 967232 → "967.2k". One format everywhere. */
function formatTokens(n: number, locale: string): string {
  const fmt = (v: number): string => {
    try {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v)
    } catch {
      return String(Math.round(v * 10) / 10)
    }
  }
  if (n >= 1_000_000_000) return `${fmt(n / 1_000_000_000)}b`
  if (n >= 1_000_000) return `${fmt(n / 1_000_000)}m`
  if (n >= 1_000) return `${fmt(n / 1_000)}k`
  return fmt(n)
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes}m ${totalSeconds % 60}s`
  const hours = Math.floor(totalMinutes / 60)
  return `${hours}h ${totalMinutes % 60}m`
}

function formatCost(v: number): string {
  if (v === 0) return '$0'
  if (v < 1) return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}

// Ring color. When the real compaction trigger is known the thresholds track
// it (amber = approaching auto-compact, red = imminent/past); otherwise fall
// back to fractions of the window.
function getColor(used: number, budget: number, compactionAt: number | null): string {
  if (compactionAt && compactionAt > 0) {
    const f = used / compactionAt
    if (f >= 0.95) return '#ef4444'
    if (f >= 0.7) return '#f59e0b'
    return '#22c55e'
  }
  const p = budget > 0 ? used / budget : 0
  if (p >= 0.8) return '#ef4444'
  if (p >= 0.5) return '#f59e0b'
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

// The gauge: a rounded-rect border acting as the card's frame, whose stroke
// fills clockwise with `percent`. The unfilled track is the border color (so
// at 0% it reads like the neighbouring cards); the filled part is the context
// level (green → amber → red). Sized to the card (width × height) so it can
// match a slightly taller neighbour like the New Chat button.
function SquareFrame({
  width,
  height,
  percent,
  color
}: {
  width: number
  height: number
  percent: number
  color: string | undefined
}): React.JSX.Element {
  // 1px stroke so the gauge frame reads as the same weight as the 1px CSS
  // borders on the neighbouring cards (New Chat, mic, etc.).
  const strokeWidth = 1
  const cornerRadius = 8
  const inset = strokeWidth / 2
  const d = roundedRectPath(width, height, cornerRadius, inset)
  const iw = width - inset * 2
  const ih = height - inset * 2
  const cr = Math.min(cornerRadius, iw / 2, ih / 2)
  // Analytic perimeter (not getTotalLength on a detached node): the two
  // straight runs per axis + the four quarter-corner arcs.
  const totalLength = 2 * (iw - 2 * cr) + 2 * (ih - 2 * cr) + 2 * Math.PI * cr
  const offset = totalLength - (Math.min(percent, 100) / 100) * totalLength
  const useBorderColor = color === undefined
  return (
    <svg width={width} height={height} className="absolute inset-0">
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
        stroke={useBorderColor ? 'currentColor' : color}
        strokeWidth={strokeWidth}
        strokeDasharray={totalLength}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className={useBorderColor ? 'text-border' : undefined}
      />
    </svg>
  )
}

function SectionTitle({
  icon,
  label,
  trailing
}: {
  icon: React.ReactNode
  label: string
  trailing?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="text-muted flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
      {icon}
      <span className="flex-1">{label}</span>
      {trailing}
    </div>
  )
}

// One stat line: icon + label on the start side, value on the end side, with
// an optional thin bar underneath showing the value relative to its group.
function StatRow({
  icon,
  label,
  value,
  frac,
  color
}: {
  icon?: React.ReactNode
  label: string
  value: string
  frac?: number
  color?: string
}): React.JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        {icon ? <span className="text-muted shrink-0">{icon}</span> : null}
        <span className="text-muted flex-1 truncate text-[11px]">{label}</span>
        <span className="text-fg font-mono text-[11px] tabular-nums" dir="ltr">
          {value}
        </span>
      </div>
      {frac !== undefined && (
        <div className="bg-border/40 mt-0.5 h-0.5 w-full overflow-hidden rounded-full">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, Math.max(0, frac * 100))}%`,
              backgroundColor: color ?? 'currentColor'
            }}
          />
        </div>
      )}
    </div>
  )
}

export function ContextMeter({
  used,
  budget,
  compactionAt,
  locale,
  turnStartedAt,
  turnEndedAt,
  turnInputTokens,
  turnOutputTokens,
  turnCacheReadTokens,
  turnCacheWriteTokens,
  lastTurn,
  allTime,
  sideSpend,
  lastCall,
  usageUnavailable,
  meterModel,
  activeModel,
  provider
}: ContextMeterProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [now, setNow] = useState<number>(() => Date.now())
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)

  // 1 Hz local tick while a turn runs — the displayed elapsed has 1 s
  // resolution, so anything faster only burns renders.
  useEffect(() => {
    if (turnStartedAt === null || turnEndedAt !== null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [turnStartedAt, turnEndedAt])

  // Escape unpins/closes; clicking outside while pinned closes.
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

  const percent = budget > 0 ? Math.min(Math.round((used / budget) * 100), 100) : 0
  const hasReading = used > 0 && budget > 0
  const color = hasReading ? getColor(used, budget, compactionAt) : undefined

  // Elapsed shown inside the pill: the live turn's clock while running (or
  // frozen at its end), else the persisted last turn's elapsed after reopen.
  const liveElapsedMs =
    turnStartedAt !== null ? Math.max(0, (turnEndedAt ?? now) - turnStartedAt) : null
  const shownElapsedMs = liveElapsedMs ?? lastTurn?.elapsedMs ?? null

  const onEnter = (): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setOpen(true), 150)
  }
  const onLeave = (): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (pinned) return
    hoverTimer.current = setTimeout(() => setOpen(false), 200)
  }
  const cardVisible = open || pinned

  // ── Card data ─────────────────────────────────────────────
  const turnRunning = turnStartedAt !== null && turnEndedAt === null
  // While a turn runs (or just ran without a fold yet) show the live
  // accumulators; otherwise show the persisted last-turn roll-up.
  const showLiveTurn = turnStartedAt !== null
  const liveIn = turnInputTokens ?? 0
  const liveOut = turnOutputTokens ?? 0
  const liveCacheRead = turnCacheReadTokens ?? 0
  const liveCacheWrite = turnCacheWriteTokens ?? 0

  const turnIn = showLiveTurn ? liveIn : (lastTurn?.inputTokens ?? 0)
  const turnOut = showLiveTurn ? liveOut : (lastTurn?.outputTokens ?? 0)
  const turnCacheR = showLiveTurn ? liveCacheRead : (lastTurn?.cacheReadTokens ?? 0)
  const turnCacheW = showLiveTurn ? liveCacheWrite : (lastTurn?.cacheCreationTokens ?? 0)
  const turnMax = Math.max(turnIn, turnOut, turnCacheR, turnCacheW, 1)
  const hasTurnData = showLiveTurn || lastTurn !== null
  const turnCost = !turnRunning ? (lastTurn?.cost ?? null) : null

  const allMax = allTime
    ? Math.max(
        allTime.inputTokens,
        allTime.outputTokens,
        allTime.cacheReadTokens,
        allTime.cacheCreationTokens,
        1
      )
    : 1
  const allIngested = allTime
    ? allTime.inputTokens + allTime.cacheReadTokens + allTime.cacheCreationTokens
    : 0
  const allCachedShare =
    allIngested > 0 ? Math.round(((allTime?.cacheReadTokens ?? 0) / allIngested) * 100) : 0

  // Context-composition segments (of the latest call). Falls back to one
  // opaque "used" segment when composition is unknown (e.g. after reopen).
  const segments =
    lastCall && lastCall.fresh + lastCall.cacheRead + lastCall.cacheWrite > 0
      ? [
          {
            value: lastCall.cacheRead,
            color: COLOR_CACHE_READ,
            label: t('chat.contextCard.cacheRead')
          },
          {
            value: lastCall.cacheWrite,
            color: COLOR_CACHE_WRITE,
            label: t('chat.contextCard.cacheWrite')
          },
          { value: lastCall.fresh, color: COLOR_FRESH, label: t('chat.contextCard.fresh') }
        ].filter((s) => s.value > 0)
      : used > 0
        ? [{ value: used, color: color ?? COLOR_FRESH, label: t('chat.contextCard.inContext') }]
        : []
  const tickPct =
    compactionAt && budget > 0 && compactionAt < budget ? (compactionAt / budget) * 100 : null

  const modelMismatch =
    meterModel !== null && activeModel !== null && meterModel !== activeModel && hasReading

  const hasAnything = hasReading || hasTurnData || allTime !== null
  const HeaderLogo = provider ? PROVIDER_LOGOS[provider] : undefined

  return (
    <span
      ref={rootRef}
      className="relative inline-flex shrink-0"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <button
        type="button"
        aria-label={t('chat.contextCard.aria')}
        aria-expanded={cardVisible}
        onClick={() => {
          setPinned((p) => {
            const next = !p
            if (next) setOpen(true)
            return next
          })
        }}
        onFocus={onEnter}
        onBlur={onLeave}
        className="bg-surface relative flex h-[42.5px] w-[62px] shrink-0 cursor-default items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {/* The gauge frame (colored by context) is the card border. Fixed
            62×42.5 to match the New Chat button. Before any turn runs there's
            no elapsed time, so show just the stats icon (sized like the
            attach/folder/mic icons); once a turn runs, a small icon stacks
            over the elapsed time — mirroring New Chat's plus + label. */}
        <SquareFrame width={62} height={42.5} percent={percent} color={color} />
        {shownElapsedMs !== null ? (
          <span className="relative z-10 flex flex-col items-center gap-0.5 leading-none">
            <ChartHistogramIcon size={14} className="text-muted" />
            <span
              className="text-fg whitespace-nowrap text-[10px] font-medium leading-none tabular-nums"
              dir="ltr"
            >
              {formatElapsed(shownElapsedMs)}
            </span>
          </span>
        ) : (
          <ChartHistogramIcon size={18} className="text-muted relative z-10" />
        )}
      </button>

      {cardVisible && (
        <div
          role="dialog"
          className="border-border bg-surface absolute bottom-full inset-s-0 z-50 mb-2 w-80 max-w-[90vw] rounded-xl border p-3 shadow-xl"
        >
          {/* Header: provider logo + model name. Streaming shows as a pulse
              on the logo; usage-unavailable is called out in the body. */}
          <div className="mb-2 flex items-center gap-2">
            {HeaderLogo ? (
              <HeaderLogo
                size={14}
                className={`text-fg shrink-0 ${turnRunning ? 'animate-pulse' : ''}`}
              />
            ) : null}
            <span className="text-fg min-w-0 flex-1 truncate text-xs font-medium" dir="ltr">
              {meterModel ?? activeModel ?? t('chat.contextCard.noModel')}
            </span>
          </div>

          {!hasAnything ? (
            <p className="text-muted py-2 text-center text-[11px]">{t('chat.contextCard.empty')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Context window */}
              <div>
                <SectionTitle
                  icon={<Database01Icon size={12} />}
                  label={t('chat.contextCard.context')}
                  trailing={
                    <span className="text-fg font-mono text-[10px] tabular-nums" dir="ltr">
                      {t('chat.contextCard.usage', {
                        used: formatTokens(used, locale),
                        max: formatTokens(budget, locale),
                        percent
                      })}
                    </span>
                  }
                />
                <div className="relative mt-1.5">
                  <div
                    className="bg-border/40 flex h-1.5 w-full overflow-hidden rounded-full"
                    dir="ltr"
                  >
                    {segments.map((s, i) => (
                      <div
                        key={i}
                        className="h-full"
                        style={{
                          width: `${budget > 0 ? Math.min(100, (s.value / budget) * 100) : 0}%`,
                          backgroundColor: s.color
                        }}
                      />
                    ))}
                  </div>
                  {tickPct !== null && (
                    <span
                      className="bg-fg/50 absolute -top-0.5 h-2.5 w-px"
                      // Physical `left`, not insetInlineStart: the bar it
                      // annotates is forced dir="ltr", so in Arabic a logical
                      // inset would mirror the tick to the wrong spot.
                      style={{ left: `${tickPct}%` }}
                      title={t('chat.contextCard.compactAt', {
                        value: formatTokens(compactionAt ?? 0, locale)
                      })}
                    />
                  )}
                </div>
                {segments.length > 1 && (
                  <div className="text-muted mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px]">
                    {segments.map((s, i) => (
                      <span key={i} className="inline-flex items-center gap-1">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        {s.label}
                        <span className="font-mono tabular-nums" dir="ltr">
                          {formatTokens(s.value, locale)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
                {tickPct !== null && (
                  <p className="text-muted mt-1 text-[10px]">
                    {t('chat.contextCard.compactAt', {
                      value: formatTokens(compactionAt ?? 0, locale)
                    })}
                  </p>
                )}
                {usageUnavailable && (
                  <p className="mt-1 text-[10px] text-amber-500">
                    {t('chat.contextCard.usageUnavailable')}
                  </p>
                )}
                {modelMismatch && (
                  <p className="text-muted mt-1 text-[10px]">
                    {t('chat.contextCard.measuredUnder', { model: meterModel })}
                  </p>
                )}
              </div>

              {/* This / last turn */}
              {hasTurnData && (
                <div>
                  <SectionTitle
                    icon={<Clock01Icon size={12} />}
                    label={
                      turnRunning ? t('chat.contextCard.thisTurn') : t('chat.contextCard.lastTurn')
                    }
                    trailing={
                      shownElapsedMs !== null ? (
                        <span className="text-fg font-mono text-[10px] tabular-nums" dir="ltr">
                          {formatElapsed(shownElapsedMs)}
                        </span>
                      ) : undefined
                    }
                  />
                  <div className="mt-1.5 flex flex-col gap-1">
                    <StatRow
                      icon={<ArrowUp02Icon size={12} />}
                      label={t('chat.contextCard.input')}
                      value={formatTokens(turnIn, locale)}
                      frac={turnIn / turnMax}
                      color={COLOR_FRESH}
                    />
                    <StatRow
                      icon={<ArrowDown02Icon size={12} />}
                      label={t('chat.contextCard.output')}
                      value={formatTokens(turnOut, locale)}
                      frac={turnOut / turnMax}
                      color="#f59e0b"
                    />
                    <StatRow
                      icon={<Database01Icon size={12} />}
                      label={t('chat.contextCard.cacheRead')}
                      value={formatTokens(turnCacheR, locale)}
                      frac={turnCacheR / turnMax}
                      color={COLOR_CACHE_READ}
                    />
                    <StatRow
                      icon={<Database02Icon size={12} />}
                      label={t('chat.contextCard.cacheWrite')}
                      value={formatTokens(turnCacheW, locale)}
                      frac={turnCacheW / turnMax}
                      color={COLOR_CACHE_WRITE}
                    />
                    {!showLiveTurn && lastTurn && (
                      <StatRow
                        icon={<Activity04Icon size={12} />}
                        label={t('chat.contextCard.calls')}
                        value={`${lastTurn.apiCalls} · ${t('chat.contextCard.tools', { count: lastTurn.toolCalls })}`}
                      />
                    )}
                    {turnCost !== null && turnCost > 0 && (
                      <StatRow
                        icon={<DollarCircleIcon size={12} />}
                        label={t('chat.contextCard.cost')}
                        value={formatCost(turnCost)}
                      />
                    )}
                  </div>
                  {sideSpend && (
                    <div className="text-muted mt-1.5 flex flex-col gap-0.5 text-[10px]">
                      {(sideSpend.workerCalls > 0 || sideSpend.workerTurns > 0) && (
                        <span dir="ltr" className="font-mono tabular-nums">
                          {t('chat.contextCard.workers', {
                            turns: sideSpend.workerTurns,
                            tokens: formatTokens(sideSpend.workerTokens, locale)
                          })}
                          {sideSpend.workerCost > 0 ? ` · ${formatCost(sideSpend.workerCost)}` : ''}
                        </span>
                      )}
                      {sideSpend.summaryCalls > 0 && (
                        <span dir="ltr" className="font-mono tabular-nums">
                          {t('chat.contextCard.summaries', {
                            calls: sideSpend.summaryCalls,
                            tokens: formatTokens(sideSpend.summaryTokens, locale)
                          })}
                          {sideSpend.summaryCost > 0
                            ? ` · ${formatCost(sideSpend.summaryCost)}`
                            : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* All time (this conversation) */}
              {allTime && allTime.turns > 0 && (
                <div>
                  <SectionTitle
                    icon={<HourglassIcon size={12} />}
                    label={t('chat.contextCard.allTime')}
                    trailing={
                      <span className="text-fg font-mono text-[10px] tabular-nums" dir="ltr">
                        {formatElapsed(allTime.processingMs)}
                      </span>
                    }
                  />
                  <div className="mt-1.5 flex flex-col gap-1">
                    <StatRow
                      icon={<RepeatIcon size={12} />}
                      label={t('chat.contextCard.turns')}
                      value={`${allTime.turns}`}
                    />
                    <StatRow
                      icon={<Activity04Icon size={12} />}
                      label={t('chat.contextCard.apiCalls')}
                      value={`${allTime.apiCalls}`}
                    />
                    <StatRow
                      icon={<CpuIcon size={12} />}
                      label={t('chat.contextCard.toolCalls')}
                      value={`${allTime.toolCalls}`}
                    />
                    <StatRow
                      icon={<ArrowUp02Icon size={12} />}
                      label={t('chat.contextCard.input')}
                      value={formatTokens(allTime.inputTokens, locale)}
                      frac={allTime.inputTokens / allMax}
                      color={COLOR_FRESH}
                    />
                    <StatRow
                      icon={<ArrowDown02Icon size={12} />}
                      label={t('chat.contextCard.output')}
                      value={formatTokens(allTime.outputTokens, locale)}
                      frac={allTime.outputTokens / allMax}
                      color="#f59e0b"
                    />
                    <StatRow
                      icon={<Database01Icon size={12} />}
                      label={t('chat.contextCard.cacheRead')}
                      value={formatTokens(allTime.cacheReadTokens, locale)}
                      frac={allTime.cacheReadTokens / allMax}
                      color={COLOR_CACHE_READ}
                    />
                    <StatRow
                      icon={<Database02Icon size={12} />}
                      label={t('chat.contextCard.cacheWrite')}
                      value={formatTokens(allTime.cacheCreationTokens, locale)}
                      frac={allTime.cacheCreationTokens / allMax}
                      color={COLOR_CACHE_WRITE}
                    />
                    <StatRow
                      icon={<DollarCircleIcon size={12} />}
                      label={t('chat.contextCard.cost')}
                      value={formatCost(allTime.cost)}
                    />
                  </div>
                  {allCachedShare > 0 && (
                    <p className="text-muted mt-1 text-[10px]">
                      {t('chat.contextCard.cachedShare', { percent: allCachedShare })}
                    </p>
                  )}
                </div>
              )}

              {/* Last call footnote */}
              {lastCall && (
                <p className="text-muted border-border/60 border-t pt-2 text-[10px]" dir="ltr">
                  {t('chat.contextCard.lastCall')}: {lastCall.provider} · {lastCall.model} ·{' '}
                  {(lastCall.durationMs / 1000).toFixed(1)}s
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </span>
  )
}
