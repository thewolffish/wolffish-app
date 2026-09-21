import { formatRelative, isLiveState } from '@components/common/process-card/format'
import { ProcessRow } from '@components/common/process-card/ProcessCard'
import { Badge } from '@components/core/Badge'
import { Button } from '@components/core/Button'
import { Modal } from '@components/core/Modal'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn'
import type { ProcessAutostart, ProcessRecord, RestartPolicy } from '@preload/index'
import { useLocale } from '@providers/locale/useLocale'
import { Delete02Icon, Edit02Icon, File01Icon } from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const iconButtonClass = cn(
  'text-muted hover:text-fg flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg',
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
)

const fieldClass =
  'border-border bg-bg text-fg w-full rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'

const AUTOSTART: ProcessAutostart[] = ['off', 'wolffish', 'system']
const RESTART: RestartPolicy[] = ['never', 'on-failure', 'always']

/**
 * Processes — one tab of the Library page. Every process the manager knows
 * (started by the model, by the shell's background path, or adopted), grouped
 * by working folder, with the same Stop / Restart the chat card offers plus
 * the definition editor, a log drawer, the autostart switch and Remove. The
 * list is the registry itself: `processes:changed` re-fetches on every write,
 * whoever wrote it.
 */
export function Processes(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const toast = useToast()
  const [records, setRecords] = useState<ProcessRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<ProcessRecord | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProcessRecord | null>(null)
  const [logsFor, setLogsFor] = useState<ProcessRecord | null>(null)
  const [logText, setLogText] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const refresh = useCallback((): void => {
    void window.api.processes
      .list()
      .then((list) => {
        setRecords(list)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
    return window.api.processes.onChanged(refresh)
  }, [refresh])

  // The log drawer re-reads on every registry change while open (a running
  // process writes, the registry does not — so also poll gently).
  useEffect(() => {
    if (!logsFor) return
    let disposed = false
    const read = (): void => {
      void window.api.processes.logs(logsFor.name, 300).then((text) => {
        if (!disposed) setLogText(text)
      })
    }
    read()
    const id = setInterval(read, 2000)
    return () => {
      disposed = true
      clearInterval(id)
    }
  }, [logsFor])

  const groups = useMemo(() => {
    const map = new Map<string, ProcessRecord[]>()
    for (const r of records) {
      const list = map.get(r.cwd) ?? []
      list.push(r)
      map.set(r.cwd, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [records])

  const running = records.filter((r) => isLiveState(r.run.state)).length

  const handleStopAll = useCallback(async () => {
    const results = await window.api.processes.stopAll()
    toast.show({
      tone: 'success',
      message: t('processes.stoppedCount', { count: results.filter((r) => r.stopped).length })
    })
  }, [t, toast])

  const handleDelete = useCallback(async () => {
    const target = deleteTarget
    if (!target) return
    const res = await window.api.processes.remove(target.name)
    if (res.ok)
      toast.show({ tone: 'success', message: t('processes.removed', { name: target.name }) })
    else toast.show({ tone: 'error', message: res.error ?? t('processes.error') })
    setDeleteTarget(null)
  }, [deleteTarget, t, toast])

  const setAutostart = useCallback(
    async (record: ProcessRecord, autostart: ProcessAutostart) => {
      if (record.autostart === autostart) return
      const res = await window.api.processes.update({ name: record.name, autostart })
      if (!res.ok) toast.show({ tone: 'error', message: res.error ?? t('processes.error') })
      else if (res.warning) toast.show({ tone: 'info', message: res.warning })
    },
    [t, toast]
  )

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10">
          <header className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h1 className="text-fg text-2xl font-semibold tracking-tight">
                  {t('processes.title')}
                </h1>
                {!loading && (
                  <Badge variant="default" size="sm">
                    {t('processes.runningBadge', { running, total: records.length })}
                  </Badge>
                )}
              </div>
              <p className="text-muted text-sm leading-relaxed">{t('processes.subtitle')}</p>
            </div>
            {running > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleStopAll()}
                className="shrink-0"
              >
                {t('processes.stopAll')}
              </Button>
            )}
          </header>

          {loading ? (
            <div className="text-muted py-10 text-center text-sm">{t('common.loading')}</div>
          ) : records.length === 0 ? (
            <div className="border-border text-muted rounded-2xl border border-dashed px-6 py-12 text-center text-sm">
              {t('processes.empty')}
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map(([cwd, list]) => (
                <section key={cwd} className="flex flex-col gap-2">
                  <h2
                    dir="ltr"
                    className="text-muted truncate text-xs font-medium tracking-wide"
                    title={cwd}
                  >
                    {cwd}
                  </h2>
                  <ul className="flex flex-col gap-3">
                    {list.map((record) => (
                      <li
                        key={record.id}
                        className="border-border bg-surface flex flex-col gap-2 rounded-2xl border px-4 py-3 text-sm"
                      >
                        <ProcessRow record={record} now={now} />
                        <div className="text-muted flex flex-wrap items-center justify-between gap-2 ps-4 text-xs">
                          <div className="flex items-center gap-2">
                            <span>{t('processes.autostartLabel')}</span>
                            <div
                              role="radiogroup"
                              className="border-border bg-bg inline-flex items-center rounded-lg border p-0.5"
                            >
                              {AUTOSTART.map((mode) => (
                                <button
                                  key={mode}
                                  type="button"
                                  role="radio"
                                  aria-checked={record.autostart === mode}
                                  onClick={() => void setAutostart(record, mode)}
                                  className={cn(
                                    'cursor-pointer rounded-md px-2 py-0.5 text-xs',
                                    record.autostart === mode
                                      ? 'bg-primary text-primary-fg'
                                      : 'text-muted hover:text-fg'
                                  )}
                                >
                                  {t(`processes.autostart.${mode}`)}
                                </button>
                              ))}
                            </div>
                            <span>
                              {t('processes.restartLabel')}{' '}
                              {t(`processes.restart.${record.restart}`)}
                            </span>
                            {record.createdAt > 0 && (
                              <span>
                                {t('processes.createdAt', {
                                  time: formatRelative(record.createdAt, now, locale)
                                })}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center">
                            {record.run.logPath && (
                              <button
                                type="button"
                                onClick={() => setLogsFor(record)}
                                aria-label={t('processes.logs')}
                                className={iconButtonClass}
                              >
                                <File01Icon size={16} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setEditing(record)}
                              aria-label={t('processes.edit')}
                              className={iconButtonClass}
                            >
                              <Edit02Icon size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(record)}
                              aria-label={t('processes.remove')}
                              className={cn(iconButtonClass, 'hover:text-red-600')}
                            >
                              <Delete02Icon size={16} />
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && <EditDialog record={editing} onClose={() => setEditing(null)} />}

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('processes.removeTitle')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" size="sm" onClick={() => void handleDelete()}>
              {t('processes.remove')}
            </Button>
          </div>
        }
      >
        <p className="text-muted text-sm">
          {t('processes.removeConfirm', { name: deleteTarget?.name ?? '' })}
        </p>
      </Modal>

      <Modal
        open={logsFor !== null}
        onClose={() => setLogsFor(null)}
        title={logsFor ? t('processes.logsTitle', { name: logsFor.name }) : ''}
        className="max-w-3xl"
      >
        <pre
          dir="ltr"
          className="bg-bg border-border text-fg max-h-[60vh] overflow-auto rounded-lg border p-3 font-mono text-xs whitespace-pre-wrap"
        >
          {logText || t('processes.logsEmpty')}
        </pre>
      </Modal>
    </>
  )
}

function EditDialog({
  record,
  onClose
}: {
  record: ProcessRecord
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()
  const [command, setCommand] = useState(record.command)
  const [cwd, setCwd] = useState(record.cwd)
  const [restart, setRestart] = useState<RestartPolicy>(record.restart)
  const [onQuit, setOnQuit] = useState<'keep' | 'stop'>(record.onQuit)
  const [saving, setSaving] = useState(false)
  const live = isLiveState(record.run.state)

  const save = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    const res = await window.api.processes.update({
      name: record.name,
      command: command.trim() !== record.command ? command.trim() : undefined,
      cwd: cwd.trim() !== record.cwd ? cwd.trim() : undefined,
      restart: restart !== record.restart ? restart : undefined,
      onQuit: onQuit !== record.onQuit ? onQuit : undefined
    })
    setSaving(false)
    if (!res.ok) {
      toast.show({ tone: 'error', message: res.error ?? t('processes.error') })
      return
    }
    toast.show({
      tone: 'success',
      message:
        live && (command.trim() !== record.command || cwd.trim() !== record.cwd)
          ? t('processes.savedRestartHint')
          : t('processes.saved')
    })
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('processes.editTitle', { name: record.name })}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving || !command.trim()}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted text-xs">{t('processes.command')}</span>
          <input
            dir="ltr"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            className={cn(fieldClass, 'font-mono')}
            spellCheck={false}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted text-xs">{t('processes.cwd')}</span>
          <input
            dir="ltr"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            className={cn(fieldClass, 'font-mono')}
            spellCheck={false}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs">{t('processes.restartLabel')}</span>
            <select
              value={restart}
              onChange={(e) => setRestart(e.target.value as RestartPolicy)}
              className={fieldClass}
            >
              {RESTART.map((r) => (
                <option key={r} value={r}>
                  {t(`processes.restart.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted text-xs">{t('processes.onQuitLabel')}</span>
            <select
              value={onQuit}
              onChange={(e) => setOnQuit(e.target.value as 'keep' | 'stop')}
              className={fieldClass}
            >
              <option value="keep">{t('processes.onQuit.keep')}</option>
              <option value="stop">{t('processes.onQuit.stop')}</option>
            </select>
          </label>
        </div>
        <p className="text-muted text-xs">{t('processes.portHint')}</p>
      </div>
    </Modal>
  )
}
