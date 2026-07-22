import { EmojiPicker } from '@components/common/emoji-picker/EmojiPicker'
import { Badge } from '@components/core/Badge'
import { Button } from '@components/core/Button'
import { CodeEditor } from '@components/core/CodeEditor'
import { Modal } from '@components/core/Modal'
import { Select } from '@components/core/Select'
import { useToast } from '@components/core/toast/useToast'
import { RTL_LOCALES } from '@lib/i18n'
import { cn } from '@lib/utils/cn'
import { pageTopPadding } from '@lib/utils/platform'
import type { Procedure, Project } from '@preload/index'
import { useFlow } from '@providers/flow/useFlow'
import { useLocale } from '@providers/locale/useLocale'
import { useSessions } from '@providers/sessions/useSessions'
import { useTheme } from '@providers/theme/useTheme'
import {
  Add01Icon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  Delete02Icon,
  Edit02Icon,
  PlayIcon
} from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

/** Card emoji fallback for procedures that never picked one. */
const DEFAULT_PROCEDURE_ICON = '📋'

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
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Procedure | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftPrompt, setDraftPrompt] = useState('')
  const [draftIcon, setDraftIcon] = useState('')
  const [draftProjectId, setDraftProjectId] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  // Same contract as ProjectDialog: the required-title error arms on the
  // first edit to any field, never on open — a fresh procedure starts
  // untitled, and with an empty title autosave suspends + the stub is
  // discarded on close, so edits elsewhere are what the warning protects.
  const [touched, setTouched] = useState(false)
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
    void window.api.projects
      .list()
      .then((list) => {
        if (!cancelled) setProjects(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Live refresh: the agent's procedure_* tools mutate the store outside any
  // renderer action (mid-conversation, or from an autonomous run while this
  // page sits open) — re-fetch so cards and their "edited …" stamps follow.
  // Project pushes ride along for the card's project-title/emoji joins.
  useEffect(() => {
    const refetch = (): void => {
      void window.api.procedures
        .list()
        .then(setProcedures)
        .catch(() => {})
      void window.api.projects
        .list()
        .then(setProjects)
        .catch(() => {})
    }
    const offProcedures = window.api.procedures.onChanged(refetch)
    const offProjects = window.api.projects.onChanged(refetch)
    return () => {
      offProcedures()
      offProjects()
    }
  }, [])

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  // Card emoji: a project-bound procedure wears its PROJECT's emoji; an
  // unbound one wears its own, else the page default.
  const procedureCardIcon = useCallback(
    (procedure: Procedure): string =>
      (procedure.projectId ? projectsById.get(procedure.projectId)?.icon : undefined) ||
      procedure.icon ||
      DEFAULT_PROCEDURE_ICON,
    [projectsById]
  )

  const draftProject = draftProjectId ? projectsById.get(draftProjectId) : undefined

  // The last values dispatched to disk for the open procedure. Used as the
  // auto-save baseline: comparing the draft against this (updated synchronously
  // at dispatch) stops an idle dialog from re-saving in a loop AND stops a close
  // from re-writing an edit the debounce already sent.
  const savedRef = useRef<{ title: string; prompt: string; icon: string; projectId: string }>({
    title: '',
    prompt: '',
    icon: '',
    projectId: ''
  })

  const openEditor = useCallback((procedure: Procedure) => {
    setEditing(procedure)
    setDraftTitle(procedure.title)
    setDraftPrompt(procedure.prompt)
    setDraftIcon(procedure.icon ?? '')
    setDraftProjectId(procedure.projectId ?? '')
    setEmojiOpen(false)
    setTouched(false)
    savedRef.current = {
      title: procedure.title,
      prompt: procedure.prompt,
      icon: procedure.icon ?? '',
      projectId: procedure.projectId ?? ''
    }
  }, [])

  const persist = useCallback(
    (id: string, title: string, prompt: string, icon: string, projectId: string) => {
      savedRef.current = { title, prompt, icon, projectId }
      return window.api.procedures
        .update({ id, title, prompt, icon, projectId })
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
    if (
      draftTitle === savedRef.current.title &&
      draftPrompt === savedRef.current.prompt &&
      draftIcon === savedRef.current.icon &&
      draftProjectId === savedRef.current.projectId
    ) {
      return
    }
    const handle = setTimeout(
      () => void persist(editing.id, draftTitle, draftPrompt, draftIcon, draftProjectId),
      600
    )
    return () => clearTimeout(handle)
  }, [editing, draftTitle, draftPrompt, draftIcon, draftProjectId, persist])

  const closeEditor = useCallback(() => {
    const current = editing
    setEditing(null)
    setEmojiOpen(false)
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
    if (
      draftTitle !== savedRef.current.title ||
      draftPrompt !== savedRef.current.prompt ||
      draftIcon !== savedRef.current.icon ||
      draftProjectId !== savedRef.current.projectId
    ) {
      void persist(current.id, draftTitle, draftPrompt, draftIcon, draftProjectId)
    }
  }, [editing, draftTitle, draftPrompt, draftIcon, draftProjectId, persist])

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
      // keeps running untouched. The icon rides along so the conversation's
      // rail badge shows this procedure's emoji, and a project binding runs
      // the turn inside that project (overlay + conversation registration).
      newSession({
        procedure: {
          prompt: procedure.prompt,
          mode: procedure.mode,
          icon: procedure.icon || DEFAULT_PROCEDURE_ICON
        },
        projectId: procedure.projectId ?? null
      })
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
              <div className="flex items-center gap-2">
                <h1 className="text-fg text-2xl font-semibold tracking-tight">
                  {t('procedures.title')}
                </h1>
                {!loading && (
                  <Badge variant="default" size="sm">
                    {procedures.length}
                  </Badge>
                )}
              </div>
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
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <span aria-hidden className="text-2xl leading-none">
                          {procedureCardIcon(procedure)}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span title={name} className="text-fg truncate text-sm font-medium">
                            {name}
                          </span>
                          <span className="text-muted text-xs">
                            {t('procedures.editedAt', {
                              time: formatFromNow(procedure.updatedAt, now, locale)
                            })}
                            {procedure.projectId &&
                              projectsById.get(procedure.projectId) &&
                              ` · ${
                                projectsById.get(procedure.projectId)!.title.trim() ||
                                t('projects.untitled')
                              }`}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
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
                        <div
                          role="tablist"
                          aria-label={t('procedures.modeAria')}
                          className="border-border bg-bg/40 ms-1 inline-flex items-center gap-0.5 rounded-lg border p-0.5"
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
                      </div>
                    </div>
                    {runnable ? (
                      <pre
                        dir="auto"
                        className="bg-bg border-border text-muted max-h-40 overflow-auto rounded-lg border px-3 py-2 font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap"
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
          <div className="flex items-start gap-2">
            <div className="relative">
              {/* A project-bound procedure wears the project's emoji — the
                  button shows it and disables (the procedure's own icon
                  returns when the binding is removed). */}
              <button
                type="button"
                disabled={draftProject !== undefined}
                onClick={() => setEmojiOpen((v) => !v)}
                aria-label={draftProject ? t('procedures.projectIcon') : t('procedures.pickIcon')}
                title={draftProject ? t('procedures.projectIcon') : t('procedures.pickIcon')}
                className={cn(
                  'bg-bg border-border flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border text-lg',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
                  'disabled:cursor-default'
                )}
              >
                {draftProject ? draftProject.icon || '📁' : draftIcon || DEFAULT_PROCEDURE_ICON}
              </button>
              {emojiOpen && (
                <EmojiPicker
                  onPick={(emoji) => {
                    setTouched(true)
                    setDraftIcon(emoji)
                    setEmojiOpen(false)
                  }}
                  onClose={() => setEmojiOpen(false)}
                />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <input
                value={draftTitle}
                onChange={(e) => {
                  setTouched(true)
                  setDraftTitle(e.target.value)
                }}
                placeholder={t('procedures.titlePlaceholder')}
                aria-required
                aria-invalid={touched && draftTitle.trim() === ''}
                className={cn(
                  fieldClass,
                  touched && draftTitle.trim() === '' && 'border-rose-500/70'
                )}
              />
              {touched && draftTitle.trim() === '' && (
                <p className="text-xs text-rose-500">{t('procedures.titleRequired')}</p>
              )}
            </div>
          </div>
          <span className="text-muted text-xs font-medium">{t('procedures.project')}</span>
          {/* Bind/unbind a project: the run gets the project's context and its
              conversation registers under the project. */}
          <Select
            value={draftProjectId}
            onChange={(v) => {
              setTouched(true)
              setDraftProjectId(v)
              setEmojiOpen(false)
            }}
            options={[
              { value: '', label: t('procedures.projectNone') },
              ...projects.map((p) => ({
                value: p.id,
                label: p.title.trim() || t('projects.untitled'),
                icon: (
                  <span aria-hidden className="text-base leading-none">
                    {p.icon || '📁'}
                  </span>
                )
              }))
            ]}
          />
          {/* Scoped to this dialog only: override the CodeEditor's built-in
              surface background to --color-bg so the prompt field matches the
              card code block. Important + layered (Tailwind utilities) beats
              CodeMirror's normal, unlayered inline theme rule. */}
          <div className="border-border h-[320px] overflow-hidden rounded-lg border [&_.cm-editor]:bg-bg!">
            <CodeEditor
              value={draftPrompt}
              language="markdown"
              isDark={isDark}
              onChange={(value) => {
                setTouched(true)
                setDraftPrompt(value)
              }}
              placeholder={t('procedures.promptPlaceholder')}
              className="h-full"
              spellcheck
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
