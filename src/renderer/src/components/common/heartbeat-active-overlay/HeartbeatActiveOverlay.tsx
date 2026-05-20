import { cn } from '@lib/utils/cn/cn'
import type { HeartbeatLogEntry, HeartbeatRunningJob } from '@preload/index'
import { Activity04Icon } from 'hugeicons-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const MAX_LOG_ENTRIES = 50

export function HeartbeatActiveOverlay(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [runningJob, setRunningJob] = useState<HeartbeatRunningJob | null>(null)
  const [logs, setLogs] = useState<HeartbeatLogEntry[]>([])
  const [now, setNow] = useState(() => Date.now())
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    window.api.heartbeat.getRunningJob().then((job) => {
      if (cancelled) return
      setRunningJob(job)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const offStarted = window.api.heartbeat.onJobStarted((job) => {
      setRunningJob(job)
      setLogs([])
    })
    const offEnded = window.api.heartbeat.onJobEnded(() => {
      setRunningJob(null)
    })
    const offLog = window.api.heartbeat.onJobLog((entry) => {
      setLogs((prev) => {
        const next = [...prev, entry]
        return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next
      })
    })
    return () => {
      offStarted()
      offEnded()
      offLog()
    }
  }, [])

  useEffect(() => {
    if (!runningJob) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [runningJob])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  if (!runningJob) return null

  const elapsed = Math.max(0, Math.floor((now - runningJob.startedAt) / 1000))
  const mm = Math.floor(elapsed / 60)
  const ss = elapsed % 60
  const elapsedStr = `${mm}:${ss.toString().padStart(2, '0')}`
  const startedStr = new Date(runningJob.startedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })

  return (
    <main className="bg-bg flex h-full w-full flex-col items-center justify-center pt-10">
      <div className="flex w-full max-w-md flex-col items-center gap-6 px-6">
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-full bg-emerald-500/20" />
          <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15">
            <Activity04Icon size={20} className="text-emerald-500 animate-pulse" />
          </div>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <h2 className="text-fg text-sm font-medium">{runningJob.label}</h2>
          <div className="text-muted flex items-center gap-2 text-xs">
            <span>{t('heartbeat.overlay.startedAt', { time: startedStr })}</span>
            <span className="text-border">·</span>
            <span className="tabular-nums font-mono">{elapsedStr}</span>
          </div>
        </div>

        <pre className="text-muted bg-surface border-border w-full rounded-lg border px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap max-h-16 overflow-hidden">
          {runningJob.body}
        </pre>

        <div className="border-border bg-surface/50 w-full rounded-lg border">
          <div className="text-muted border-border border-b px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide">
            {t('heartbeat.overlay.activity')}
          </div>
          <div className="max-h-48 overflow-y-auto px-3 py-2">
            {logs.length === 0 ? (
              <div className="text-muted/50 flex items-center gap-2 py-2 text-[11px]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                {t('heartbeat.overlay.waiting')}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {logs.map((entry, i) => {
                  const isLast = i === logs.length - 1
                  return (
                    <div
                      key={`${entry.timestamp}-${i}`}
                      className={cn(
                        'flex items-start gap-2 rounded px-1 py-0.5 text-[11px] leading-relaxed transition-opacity',
                        isLast ? 'text-fg' : 'text-muted/40'
                      )}
                    >
                      <LogKindDot kind={entry.kind} active={isLast} />
                      <span className="min-w-0 flex-1 truncate">{entry.summary}</span>
                    </div>
                  )
                })}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        </div>

        <p className="text-muted/50 text-center text-[11px]">
          {t('heartbeat.overlay.blocked')}
        </p>
      </div>
    </main>
  )
}

function LogKindDot({
  kind,
  active
}: {
  kind: HeartbeatLogEntry['kind']
  active: boolean
}): React.JSX.Element {
  const color = (() => {
    switch (kind) {
      case 'tool_call':
        return 'bg-blue-500'
      case 'tool_result':
        return 'bg-violet-500'
      case 'completed':
        return 'bg-emerald-500'
      case 'failed':
        return 'bg-red-500'
      case 'skipped':
        return 'bg-amber-500'
      default:
        return 'bg-muted/40'
    }
  })()
  return (
    <span
      className={cn(
        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
        color,
        active && 'animate-pulse'
      )}
    />
  )
}
