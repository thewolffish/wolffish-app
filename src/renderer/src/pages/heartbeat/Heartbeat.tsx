import { Badge } from '@components/core/badge/Badge'
import { CodeEditor } from '@components/core/code-editor/CodeEditor'
import { CopyButton } from '@components/core/copy-button/CopyButton'
import { Modal } from '@components/core/modal/Modal'
import { useToast } from '@components/core/toast/useToast'
import { RTL_LOCALES } from '@lib/i18n'
import { cn } from '@lib/utils/cn/cn'
import type { HeartbeatJobView } from '@preload/index'
import { useFlow } from '@providers/flow/useFlow'
import { useLocale } from '@providers/locale/useLocale'
import { useTheme } from '@providers/theme/useTheme'
import {
  ArrowLeft02Icon,
  ArrowRight02Icon,
  EyeIcon,
  FloppyDiskIcon,
  Refresh01Icon
} from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const HEARTBEAT_PATH = 'brain/brainstem/heartbeat.md'

const FROM_NOW_RANGES: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000]
]

function formatFromNow(targetMs: number, nowMs: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const diff = targetMs - nowMs
  for (const [unit, ms] of FROM_NOW_RANGES) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit)
  }
  return rtf.format(Math.round(diff / 1000), 'second')
}


const DAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
}

function parseSchedule(heading: string): { type: string; cron: string | null } | null {
  if (/^Startup$/i.test(heading)) return { type: 'startup', cron: null }

  const every = /^Every\s*\((\d+)(m|h)\)$/i.exec(heading)
  if (every) {
    const n = Number(every[1])
    return {
      type: 'every',
      cron: every[2].toLowerCase() === 'm' ? `*/${n} * * * *` : `0 */${n} * * *`
    }
  }

  const hourly = /^Hourly\s*\(:?(\d{1,2})\)$/i.exec(heading)
  if (hourly) return { type: 'hourly', cron: `${Number(hourly[1])} * * * *` }

  const daily = /^(?:Nightly|Daily)\s*\((\d{1,2}):(\d{2})\)$/i.exec(heading)
  if (daily) return { type: 'daily', cron: `${Number(daily[2])} ${Number(daily[1])} * * *` }

  const weekday = /^Weekday\s*\((\d{1,2}):(\d{2})\)$/i.exec(heading)
  if (weekday)
    return { type: 'weekday', cron: `${Number(weekday[2])} ${Number(weekday[1])} * * 1-5` }

  const weekly =
    /^Weekly\s*\((Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+(\d{1,2}):(\d{2})\)/i.exec(
      heading
    )
  if (weekly)
    return {
      type: 'weekly',
      cron: `${Number(weekly[3])} ${Number(weekly[2])} * * ${DAY_MAP[weekly[1].toLowerCase()] ?? 0}`
    }

  const monthly = /^Monthly\s*\((\d{1,2})\s+(\d{1,2}):(\d{2})\)$/i.exec(heading)
  if (monthly)
    return {
      type: 'monthly',
      cron: `${Number(monthly[3])} ${Number(monthly[2])} ${Number(monthly[1])} * *`
    }

  const cronMatch = /^Cron\s*\((.+)\)$/i.exec(heading)
  if (cronMatch) return { type: 'cron', cron: cronMatch[1].trim() }

  return null
}

function nextCronMs(expr: string, nowMs: number): number | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minute, hour, dom, , dow] = parts
  const now = new Date(nowMs)

  if (minute.startsWith('*/') && hour === '*') {
    const interval = parseInt(minute.slice(2))
    if (!interval) return null
    const next = Math.ceil((now.getMinutes() + 1) / interval) * interval
    const d = new Date(now)
    d.setSeconds(0, 0)
    if (next >= 60) {
      d.setHours(d.getHours() + 1)
      d.setMinutes(next % 60)
    } else {
      d.setMinutes(next)
    }
    return d.getTime()
  }

  if (hour.startsWith('*/')) {
    const interval = parseInt(hour.slice(2))
    if (!interval) return null
    const mm = minute === '*' ? 0 : parseInt(minute)
    const nextH = Math.ceil((now.getHours() + 1) / interval) * interval
    const d = new Date(now)
    d.setSeconds(0, 0)
    d.setMinutes(mm)
    if (nextH >= 24) {
      d.setDate(d.getDate() + 1)
      d.setHours(nextH % 24)
    } else {
      d.setHours(nextH)
    }
    return d.getTime()
  }

  const mm = minute === '*' ? 0 : parseInt(minute)
  const hh = hour === '*' ? -1 : parseInt(hour)

  if (hh >= 0 && dom === '*' && dow === '*') {
    const d = new Date(now)
    d.setSeconds(0, 0)
    d.setHours(hh, mm)
    if (d.getTime() <= nowMs) d.setDate(d.getDate() + 1)
    return d.getTime()
  }

  if (hh < 0) {
    const d = new Date(now)
    d.setSeconds(0, 0)
    d.setMinutes(mm)
    if (d.getTime() <= nowMs) d.setHours(d.getHours() + 1)
    return d.getTime()
  }

  return null
}

type SidebarJob = {
  label: string
  type: string
  active: boolean
  nextRunMs: number | null
  body: string
  cron: string | null
  lineIndex: number
  endLineIndex: number
}

function parseSidebarJobs(
  content: string,
  activeJobs: HeartbeatJobView[],
  nowMs: number
): SidebarJob[] {
  const lines = content.split('\n')
  const result: SidebarJob[] = []
  const activeByLabel = new Map(activeJobs.map((j) => [j.label, j]))

  for (let i = 0; i < lines.length; i++) {
    const activeLine = lines[i].match(/^##\s+(.+?)\s*$/)
    const inactiveSingle = lines[i].match(/^<!--\s*##\s+(.+?)\s*-->$/)
    const inactiveBlock = !inactiveSingle && lines[i].match(/^<!--\s*##\s+(.+?)\s*$/)
    if (!activeLine && !inactiveSingle && !inactiveBlock) continue

    const label = (activeLine ?? inactiveSingle ?? inactiveBlock)![1]
    const schedule = parseSchedule(label)
    if (!schedule) continue

    const isBlock = !!inactiveBlock
    const bodyLines: string[] = []
    let endIdx = i

    for (let j = i + 1; j < lines.length; j++) {
      if (isBlock && /^\s*-->\s*$/.test(lines[j])) {
        endIdx = j
        break
      }
      if (/^##\s+/.test(lines[j]) || /^<!--\s*##/.test(lines[j])) break
      bodyLines.push(lines[j])
      if (!isBlock && lines[j].trim() !== '') endIdx = j
    }

    const body = bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    const activeJob = activeByLabel.get(label)
    const cron = activeJob?.cron ?? schedule.cron

    result.push({
      label,
      type: schedule.type,
      active: !!activeLine,
      nextRunMs: activeJob?.nextRunMs ?? (cron ? nextCronMs(cron, nowMs) : null),
      body: activeJob?.body ?? body,
      cron,
      lineIndex: i,
      endLineIndex: endIdx
    })
  }

  return result
}

export function Heartbeat(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const { isDark } = useTheme()
  const isRtl = RTL_LOCALES.has(locale)
  const BackIcon = isRtl ? ArrowRight02Icon : ArrowLeft02Icon
  const { goTo } = useFlow()
  const toast = useToast()

  const [jobs, setJobs] = useState<HeartbeatJobView[]>([])
  const [detailJob, setDetailJob] = useState<SidebarJob | null>(null)
  const [content, setContent] = useState<string>('')
  const [originalContent, setOriginalContent] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const loadedRef = useRef(false)

  const loadData = useCallback(async () => {
    try {
      const [jobList, raw] = await Promise.all([
        window.api.heartbeat.getJobs(),
        window.api.viewer.readFile(HEARTBEAT_PATH)
      ])
      setJobs(jobList)
      if (!loadedRef.current) {
        setContent(raw)
        setOriginalContent(raw)
        loadedRef.current = true
      }
    } catch {
      // heartbeat.md may not exist yet
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleSave = useCallback(async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      await window.api.viewer.writeFile(HEARTBEAT_PATH, content)
      setOriginalContent(content)
      toast.show({ tone: 'success', message: t('workspace.saved') })
      const jobList = await window.api.heartbeat.getJobs()
      setJobs(jobList)
    } catch {
      toast.show({ tone: 'error', message: t('workspace.saveError') })
    } finally {
      setSaving(false)
    }
  }, [content, saving, t, toast])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  const handleRefresh = useCallback(async (): Promise<void> => {
    loadedRef.current = false
    setLoading(true)
    await loadData()
  }, [loadData])

  const handleToggle = useCallback(
    async (job: SidebarJob): Promise<void> => {
      const lines = content.split('\n')
      if (job.active) {
        if (job.endLineIndex > job.lineIndex) {
          lines[job.lineIndex] = `<!-- ${lines[job.lineIndex]}`
          lines.splice(job.endLineIndex + 1, 0, '-->')
        } else {
          lines[job.lineIndex] = `<!-- ${lines[job.lineIndex]} -->`
        }
      } else {
        lines[job.lineIndex] = lines[job.lineIndex].replace(/^<!--\s*/, '')
        if (/\s*-->$/.test(lines[job.lineIndex])) {
          lines[job.lineIndex] = lines[job.lineIndex].replace(/\s*-->$/, '')
        } else {
          for (let j = job.lineIndex + 1; j < lines.length; j++) {
            if (/^\s*-->\s*$/.test(lines[j])) {
              lines.splice(j, 1)
              break
            }
            if (/^##\s+/.test(lines[j]) || /^<!--\s*##/.test(lines[j])) break
          }
        }
      }
      const newContent = lines.join('\n')
      setContent(newContent)
      setOriginalContent(newContent)
      try {
        await window.api.viewer.writeFile(HEARTBEAT_PATH, newContent)
        const jobList = await window.api.heartbeat.getJobs()
        setJobs(jobList)
      } catch {
        toast.show({ tone: 'error', message: t('workspace.saveError') })
      }
    },
    [content, t, toast]
  )

  const isDirty = content !== originalContent
  const sidebarJobs = useMemo(() => parseSidebarJobs(content, jobs, now), [content, jobs, now])

  return (
    <main className="bg-bg flex h-full w-full flex-col pt-10">
      <header className="border-border flex items-center justify-between gap-2 border-b px-6 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => goTo('chat')}
            aria-label={t('common.back')}
            className={cn(
              'text-muted hover:text-fg flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-2 text-sm',
              'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
            )}
          >
            <BackIcon size={16} />
            <span>{t('common.back')}</span>
          </button>
        </div>
        <div className="flex items-center gap-2" />
      </header>

      {loading ? (
        <div className="text-muted flex flex-1 items-center justify-center text-sm">
          {t('common.loading')}
        </div>
      ) : (
        <div dir="ltr" className="flex min-h-0 flex-1">
          <aside
            dir={isRtl ? 'rtl' : 'ltr'}
            className="border-border w-72 shrink-0 overflow-y-auto border-r p-3"
          >
            {sidebarJobs.length === 0 ? (
              <p className="text-muted px-2 py-6 text-center text-xs">
                {t('heartbeat.noJobs')}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {sidebarJobs.map((job) => (
                  <li key={job.label}>
                    <div
                      className={cn(
                        'bg-surface rounded-lg border border-border px-3 py-2.5',
                        !job.active && 'opacity-60'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-fg truncate text-sm font-medium">
                          {job.label}
                        </span>
                        <div
                          role="tablist"
                          className="border-border bg-bg/40 inline-flex shrink-0 items-center rounded-lg border p-0.5"
                        >
                          <button
                            role="tab"
                            type="button"
                            aria-selected={job.active}
                            onClick={() => {
                              if (!job.active) void handleToggle(job)
                            }}
                            className={cn(
                              'rounded-md px-2 py-0.5 text-[10px] font-medium',
                              job.active
                                ? 'bg-primary text-primary-fg shadow-sm'
                                : 'text-muted hover:text-fg cursor-pointer'
                            )}
                          >
                            {t('settings.wolffish.toggle.on')}
                          </button>
                          <button
                            role="tab"
                            type="button"
                            aria-selected={!job.active}
                            onClick={() => {
                              if (job.active) void handleToggle(job)
                            }}
                            className={cn(
                              'rounded-md px-2 py-0.5 text-[10px] font-medium',
                              !job.active
                                ? 'bg-primary text-primary-fg shadow-sm'
                                : 'text-muted hover:text-fg cursor-pointer'
                            )}
                          >
                            {t('settings.wolffish.toggle.off')}
                          </button>
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="primary" size="sm">
                            {t(`heartbeat.type.${job.type}`)}
                          </Badge>
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                              job.active
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            )}
                          >
                            {job.active ? t('heartbeat.active') : t('heartbeat.inactive')}
                          </span>
                          {job.active && job.nextRunMs != null && (
                            <span className="text-muted text-[11px]">
                              {formatFromNow(job.nextRunMs, now, locale)}
                            </span>
                          )}
                          {job.active && job.type === 'startup' && (
                            <span className="text-muted text-[11px]">on launch</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setDetailJob(job)}
                          className="text-muted hover:text-fg cursor-pointer rounded p-0.5"
                        >
                          <EyeIcon size={14} />
                        </button>
                      </div>
                      {job.body && (
                        <pre className="bg-bg mt-2 max-h-12 overflow-auto rounded border border-border px-2 py-1.5 text-[10px] font-mono text-muted leading-relaxed whitespace-pre-wrap">
                          {job.body}
                        </pre>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="border-border flex items-center justify-between gap-2 border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-fg text-sm font-medium">heartbeat.md</span>
                {isDirty && (
                  <span className="text-muted text-xs italic">(unsaved)</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  disabled={loading}
                  className={cn(
                    'text-muted hover:text-fg inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition-colors',
                    'disabled:cursor-not-allowed disabled:opacity-40'
                  )}
                >
                  <Refresh01Icon size={14} className={cn(loading && 'animate-spin')} />
                  <span>{t('workspace.resync')}</span>
                </button>
                <CopyButton text={content} variant="inline" />
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!isDirty || saving}
                  aria-label={saving ? t('workspace.saving') : t('workspace.save')}
                  title={saving ? t('workspace.saving') : t('workspace.save')}
                  className={cn(
                    'text-muted hover:text-fg hover:bg-border/40 flex h-8 w-8 items-center justify-center rounded-lg cursor-pointer',
                    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                    'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted'
                  )}
                >
                  <FloppyDiskIcon size={16} />
                </button>
              </div>
            </div>
            <CodeEditor
              value={content}
              language="markdown"
              isDark={isDark}
              readOnly={false}
              onChange={setContent}
              className="h-full w-full"
            />
          </section>
        </div>
      )}
      {detailJob && (
        <Modal open onClose={() => setDetailJob(null)} title={detailJob.label} className="!max-w-3xl">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge variant="primary" size="sm">
                {t(`heartbeat.type.${detailJob.type}`)}
              </Badge>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                  detailJob.active
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                )}
              >
                {detailJob.active ? t('heartbeat.active') : t('heartbeat.inactive')}
              </span>
              {detailJob.cron && (
                <code className="bg-bg rounded border border-border px-1.5 py-0.5 text-[10px] font-mono text-muted">{detailJob.cron}</code>
              )}
              {detailJob.active && detailJob.nextRunMs != null && (
                <span className="text-muted ms-auto text-[11px]">
                  {formatFromNow(detailJob.nextRunMs, now, locale)}
                </span>
              )}
              {detailJob.active && detailJob.type === 'startup' && (
                <span className="text-muted ms-auto text-[11px]">on launch</span>
              )}
            </div>
            <div className="relative">
              <div className="absolute top-2 end-2 z-10">
                <CopyButton text={detailJob.body} variant="overlay" />
              </div>
              <pre className="bg-bg max-h-[60vh] overflow-auto rounded-lg border border-border p-4 text-xs font-mono text-fg leading-relaxed whitespace-pre-wrap">
                {detailJob.body}
              </pre>
            </div>
          </div>
        </Modal>
      )}
    </main>
  )
}
