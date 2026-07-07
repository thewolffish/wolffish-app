import { Button } from '@components/core/Button'
import { CodeEditor } from '@components/core/CodeEditor'
import { Modal } from '@components/core/Modal'
import { useToast } from '@components/core/toast/useToast'
import { RTL_LOCALES } from '@lib/i18n'
import { cn } from '@lib/utils/cn'
import { pageTopPadding } from '@lib/utils/platform'
import type { Procedure } from '@preload/index'
import { useFlow } from '@providers/flow/useFlow'
import { useSessions } from '@providers/sessions/useSessions'
import { useLocale } from '@providers/locale/useLocale'
import { useTheme } from '@providers/theme/useTheme'
import {
  Add01Icon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  Delete02Icon,
  Edit02Icon,
  PlayIcon
} from 'hugeicons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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

const fieldClass = cn(
  'bg-bg border-border text-fg placeholder:text-muted/60 block w-full rounded-lg border px-3 py-2 text-sm leading-5',
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg focus-visible:outline-none'
)

const iconButtonClass = cn(
  'text-muted flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg',
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
  'disabled:cursor-not-allowed disabled:opacity-40'
)

export function Procedures(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const { isDark } = useTheme()
  const isRtl = RTL_LOCALES.has(locale)
  const BackIcon = isRtl ? ArrowRight02Icon : ArrowLeft02Icon
  const { goTo, status } = useFlow()
  const { newSession } = useSessions()
  // Rows without a stamp follow the global mode — the pill shows that
  // effective value; clicking a tab stamps the row explicitly.
  const globalMode = status?.config?.llm.mode === 'workflow' ? 'workflow' : 'single'
  const toast = useToast()

  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Procedure | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftPrompt, setDraftPrompt] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Procedure | null>(null)

  // Tick a clock so the "edited …" labels stay fresh without reloading the list.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Load on mount — the page unmounts on navigate-away, so this re-runs on return.
  useEffect(() => {
    let cancelled = false
    window.api.procedures
      .list()
      .then((list) => {
        if (!cancelled) setProcedures(list)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // The last values dispatched to disk for the open procedure. Used as the
  // auto-save baseline: comparing the draft against this (updated synchronously
  // at dispatch) stops an idle dialog from re-saving in a loop AND stops a close
  // from re-writing an edit the debounce already sent.
  const savedRef = useRef<{ title: string; prompt: string }>({ title: '', prompt: '' })

  const openEditor = useCallback((procedure: Procedure) => {
    setEditing(procedure)
    setDraftTitle(procedure.title)
    setDraftPrompt(procedure.prompt)
    savedRef.current = { title: procedure.title, prompt: procedure.prompt }
  }, [])

  const persist = useCallback(
    (id: string, title: string, prompt: string) => {
      savedRef.current = { title, prompt }
      return window.api.procedures
        .update({ id, title, prompt })
        .then((updated) => {
          setProcedures((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
        })
        .catch(() => toast.show({ tone: 'error', message: t('procedures.saveError') }))
    },
    [t, toast]
  )

  // Auto-save ~600ms after the last keystroke. Title is required, so nothing is
  // persisted until one is typed; the backend stores values verbatim (no trim),
  // so the draft compares exactly against savedRef.
  useEffect(() => {
    if (!editing) return
    if (draftTitle.trim() === '') return
    if (draftTitle === savedRef.current.title && draftPrompt === savedRef.current.prompt) return
    const handle = setTimeout(() => void persist(editing.id, draftTitle, draftPrompt), 600)
    return () => clearTimeout(handle)
  }, [editing, draftTitle, draftPrompt, persist])

  const closeEditor = useCallback(() => {
    const current = editing
    setEditing(null)
    if (!current) return
    // Title is required. With a blank title, nothing is persisted: a never-named
    // procedure (fresh stub) is discarded entirely; one that already had a title
    // keeps its last saved state (a cleared title is never written).
    if (draftTitle.trim() === '') {
      if (savedRef.current.title.trim() === '') {
        setProcedures((prev) => prev.filter((p) => p.id !== current.id))
        void window.api.procedures.delete(current.id).catch(() => {})
      }
      return
    }
    // Flush any edit the debounce hasn't dispatched yet.
    if (draftTitle !== savedRef.current.title || draftPrompt !== savedRef.current.prompt) {
      void persist(current.id, draftTitle, draftPrompt)
    }
  }, [editing, draftTitle, draftPrompt, persist])

  // Create with a blank title (the card shows an "Untitled" fallback) and open
  // the editor. If the user closes without writing anything, closeEditor drops
  // it — so a create-then-abandon never leaves an orphan card.
  const handleCreate = useCallback(() => {
    void window.api.procedures
      .create({ title: '', prompt: '' })
      .then((created) => {
        setProcedures((prev) => [created, ...prev])
        openEditor(created)
      })
      .catch(() => toast.show({ tone: 'error', message: t('procedures.saveError') }))
  }, [openEditor, t, toast])

  const handleDelete = useCallback(() => {
    const target = deleteTarget
    if (!target) return
    void window.api.procedures
      .delete(target.id)
      .then(() => {
        setProcedures((prev) => prev.filter((p) => p.id !== target.id))
        setDeleteTarget(null)
        toast.show({ tone: 'success', message: t('procedures.deleteSuccess') })
      })
      .catch(() => toast.show({ tone: 'error', message: t('procedures.saveError') }))
  }, [deleteTarget, t, toast])

  // Play: start a fresh conversation (clear the shared Flow state), queue this
  // procedure's prompt, and reveal Chat — which auto-sends it. Navigating away
  // unmounts this page, so the page closes for free.
  // The mode toggle persists immediately (per-field merge, so a concurrent
  // title/prompt autosave can't clobber it) with optimistic local state.
  const handleSetMode = useCallback(async (procedure: Procedure, mode: 'single' | 'workflow') => {
    if ((procedure.mode ?? 'single') === mode) return
    setProcedures((prev) => prev.map((p) => (p.id === procedure.id ? { ...p, mode } : p)))
    try {
      await window.api.procedures.update({ id: procedure.id, mode })
    } catch {
      // Reload the truth if the write failed.
      void window.api.procedures.list().then(setProcedures)
    }
  }, [])

  const handlePlay = useCallback(
    (procedure: Procedure) => {
      // A fresh SESSION per run: the procedure auto-sends into its own new
      // conversation while every other session (including a streaming one)
      // keeps running untouched.
      newSession({ procedure: { prompt: procedure.prompt, mode: procedure.mode } })
      goTo('chat')
    },
    [goTo, newSession]
  )

  return (
    <main className={cn('bg-bg flex h-full w-full flex-col', pageTopPadding)}>
      <header className="border-border flex items-center justify-between gap-2 border-b px-6 py-3">
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
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
          <header className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h1 className="text-fg text-2xl font-semibold tracking-tight">
                {t('procedures.title')}
              </h1>
              <p className="text-muted text-sm leading-relaxed">{t('procedures.subtitle')}</p>
            </div>
            <Button size="sm" onClick={handleCreate} className="shrink-0">
              <Add01Icon size={16} />
              <span>{t('procedures.new')}</span>
            </Button>
          </header>

          {loading ? (
            <div className="text-muted py-10 text-center text-sm">{t('common.loading')}</div>
          ) : procedures.length === 0 ? (
            <div className="border-border text-muted rounded-2xl border border-dashed px-6 py-12 text-center text-sm">
              {t('procedures.empty')}
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {procedures.map((procedure) => {
                const name = procedure.title.trim() || t('procedures.untitled')
                const runnable = procedure.prompt.trim().length > 0
                return (
                  <li
                    key={procedure.id}
                    className="bg-surface border-border flex flex-col gap-2.5 rounded-2xl border px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span title={name} className="text-fg truncate text-sm font-medium">
                          {name}
                        </span>
                        <span className="text-muted text-xs">
                          {t('procedures.editedAt', {
                            time: formatFromNow(procedure.updatedAt, now, locale)
                          })}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <div
                          role="tablist"
                          aria-label={t('procedures.modeAria')}
                          className="border-border bg-bg/40 me-1 inline-flex items-center gap-0.5 rounded-lg border p-0.5"
                        >
                          {(['single', 'workflow'] as const).map((m) => {
                            const active = (procedure.mode ?? globalMode) === m
                            return (
                              <button
                                key={m}
                                role="tab"
                                type="button"
                                aria-selected={active}
                                onClick={() => void handleSetMode(procedure, m)}
                                className={cn(
                                  'cursor-pointer rounded-md px-2 py-1 text-[10px] font-medium',
                                  'focus-visible:ring-2 focus-visible:ring-accent',
                                  active
                                    ? 'bg-primary text-primary-fg shadow-sm'
                                    : 'text-muted hover:text-fg'
                                )}
                              >
                                {t(
                                  m === 'workflow'
                                    ? 'chat.modePicker.workflow'
                                    : 'chat.modePicker.single'
                                )}
                              </button>
                            )
                          })}
                        </div>
                        <button
                          type="button"
                          onClick={() => handlePlay(procedure)}
                          disabled={!runnable}
                          aria-label={t('procedures.run')}
                          title={runnable ? t('procedures.run') : t('procedures.runEmptyHint')}
                          className={cn(
                            iconButtonClass,
                            'hover:text-emerald-600 disabled:hover:text-muted dark:hover:text-emerald-400'
                          )}
                        >
                          <PlayIcon size={18} />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditor(procedure)}
                          aria-label={t('procedures.edit')}
                          title={t('procedures.edit')}
                          className={cn(iconButtonClass, 'hover:text-fg')}
                        >
                          <Edit02Icon size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(procedure)}
                          aria-label={t('procedures.delete')}
                          title={t('procedures.delete')}
                          className={cn(iconButtonClass, 'hover:text-rose-500')}
                        >
                          <Delete02Icon size={16} />
                        </button>
                      </div>
                    </div>
                    {runnable ? (
                      <pre
                        dir="auto"
                        className="bg-bg border-border text-muted max-h-40 overflow-auto rounded-lg border px-3 py-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
                      >
                        {procedure.prompt}
                      </pre>
                    ) : (
                      <p className="text-muted text-xs italic">{t('procedures.runEmptyHint')}</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <Modal
        open={editing !== null}
        onClose={closeEditor}
        title={t('procedures.editTitle')}
        className="max-w-xl"
        footer={
          <div className="flex justify-end">
            <Button size="sm" onClick={closeEditor}>
              {t('procedures.done')}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder={t('procedures.titlePlaceholder')}
              aria-required
              aria-invalid={draftTitle.trim() === ''}
              className={cn(fieldClass, draftTitle.trim() === '' && 'border-rose-500/70')}
            />
            {draftTitle.trim() === '' && (
              <p className="text-xs text-rose-500">{t('procedures.titleRequired')}</p>
            )}
          </div>
          {/* Scoped to this dialog only: override the CodeEditor's built-in
              surface background to --color-bg so the prompt field matches the
              card code block. Important + layered (Tailwind utilities) beats
              CodeMirror's normal, unlayered inline theme rule. */}
          <div className="border-border h-[320px] overflow-hidden rounded-lg border [&_.cm-editor]:bg-bg!">
            <CodeEditor
              value={draftPrompt}
              language="markdown"
              isDark={isDark}
              onChange={setDraftPrompt}
              placeholder={t('procedures.promptPlaceholder')}
              className="h-full"
            />
          </div>
          <p className="text-muted text-xs">{t('procedures.autosaveHint')}</p>
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('procedures.deleteTitle')}
        footer={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              className="flex-1"
            >
              {t('procedures.deleteCancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleDelete}
              className="flex-1 border border-transparent bg-red-600 text-white shadow-none hover:bg-red-700"
            >
              {t('procedures.deleteConfirm')}
            </Button>
          </div>
        }
      >
        <p className="text-muted">
          {t('procedures.deleteWarning', {
            name: deleteTarget?.title.trim() || t('procedures.untitled')
          })}
        </p>
      </Modal>
    </main>
  )
}
