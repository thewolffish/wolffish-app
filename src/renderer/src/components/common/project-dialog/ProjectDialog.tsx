import { EmojiPicker } from '@components/common/emoji-picker/EmojiPicker'
import { Button } from '@components/core/Button'
import { CodeEditor } from '@components/core/CodeEditor'
import { Modal } from '@components/core/Modal'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn'
import type { Project, ProjectFileRef } from '@preload/index'
import { useTheme } from '@providers/theme/useTheme'
import { Add01Icon, Copy01Icon, Delete02Icon } from 'hugeicons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Middle truncation that keeps the extension visible: the base name gets the
 * CSS ellipsis while ".pdf" stays pinned — "quarterly-report-fin….pdf".
 */
function splitFileName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return { base: name, ext: '' }
  return { base: name.slice(0, dot), ext: name.slice(dot) }
}

const fieldClass = cn(
  'bg-bg border-border text-fg placeholder:text-muted/60 block w-full rounded-lg border px-3 py-2 text-sm leading-5',
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg focus-visible:outline-none'
)

export type ProjectDialogProps = {
  project: Project | null
  onClose: () => void
  /** Every persisted change flows back so callers keep list/active state fresh. */
  onChanged: (project: Project) => void
  /** Chat project-mode extras: start a fresh conversation in this project. */
  onNewConversation?: (project: Project) => void
  /** Chat project-mode extras: leave the project (back to the projects list). */
  onExitProject?: () => void
  /**
   * A turn is executing in this project's session — execution-affecting
   * controls lock (close project, instructions editing, file add/remove)
   * so the base can't shift under a running turn.
   */
  busy?: boolean
}

/**
 * Edit dialog for one project — title, emoji icon, instructions (auto-saved
 * with the procedures editor's debounce discipline) and the referenced-files
 * list (persisted immediately per add/remove). Shared by the Projects page
 * and chat's project mode.
 */
export function ProjectDialog(props: ProjectDialogProps): React.JSX.Element | null {
  // Keyed remount per project: draft state seeds from props in useState
  // initializers (no seeding effect, no cascading setState), and switching
  // projects can never leak one project's drafts into another's editor.
  if (!props.project) return null
  return <ProjectDialogBody key={props.project.id} {...props} project={props.project} />
}

function ProjectDialogBody({
  project,
  onClose,
  onChanged,
  onNewConversation,
  onExitProject,
  busy = false
}: ProjectDialogProps & { project: Project }): React.JSX.Element {
  const { t } = useTranslation()
  const { isDark } = useTheme()
  const toast = useToast()

  const [draftTitle, setDraftTitle] = useState(project.title)
  const [draftIcon, setDraftIcon] = useState(project.icon)
  const [draftInstructions, setDraftInstructions] = useState(project.instructions)
  const [files, setFiles] = useState<ProjectFileRef[]>(project.files)
  const [emojiOpen, setEmojiOpen] = useState(false)
  // The required-title error stays hidden until the user edits SOMETHING —
  // a fresh project opens with an empty title, and scolding before any input
  // is noise. Any edit arms it (not just title edits): with an empty title
  // autosave is suspended and the stub is discarded on close, so icon/
  // instructions/file work is exactly what the warning protects.
  const [touched, setTouched] = useState(false)
  const titleInvalid = touched && draftTitle.trim() === ''
  // Last values dispatched to disk — the auto-save baseline (same contract as
  // the procedures editor: stops idle re-saves and close-time double writes).
  const savedRef = useRef<{ title: string; icon: string; instructions: string }>({
    title: project.title,
    icon: project.icon,
    instructions: project.instructions
  })

  const persist = useCallback(
    (id: string, title: string, icon: string, instructions: string) => {
      savedRef.current = { title, icon, instructions }
      return window.api.projects
        .update({ id, title, icon, instructions })
        .then(onChanged)
        .catch(() => toast.show({ tone: 'error', message: t('projects.saveError') }))
    },
    [onChanged, t, toast]
  )

  useEffect(() => {
    if (!project) return
    if (draftTitle.trim() === '') return
    const saved = savedRef.current
    if (
      draftTitle === saved.title &&
      draftIcon === saved.icon &&
      draftInstructions === saved.instructions
    ) {
      return
    }
    const handle = setTimeout(
      () => void persist(project.id, draftTitle, draftIcon, draftInstructions),
      600
    )
    return () => clearTimeout(handle)
  }, [project, draftTitle, draftIcon, draftInstructions, persist])

  const close = useCallback(() => {
    if (project && draftTitle.trim() !== '') {
      const saved = savedRef.current
      if (
        draftTitle !== saved.title ||
        draftIcon !== saved.icon ||
        draftInstructions !== saved.instructions
      ) {
        void persist(project.id, draftTitle, draftIcon, draftInstructions)
      }
    }
    onClose()
  }, [project, draftTitle, draftIcon, draftInstructions, persist, onClose])

  const persistFiles = useCallback(
    (next: ProjectFileRef[]) => {
      if (!project) return
      setTouched(true)
      setFiles(next)
      void window.api.projects
        .update({ id: project.id, files: next })
        .then(onChanged)
        .catch(() => toast.show({ tone: 'error', message: t('projects.saveError') }))
    },
    [project, onChanged, t, toast]
  )

  const addFiles = useCallback(() => {
    // Pick + copy happen main-side in one step (files are copied into the
    // project's uploads dir); the returned project is already persisted.
    void window.api.projects
      .pickFiles(project.id)
      .then((updated) => {
        if (!updated) return
        setTouched(true)
        setFiles(updated.files)
        onChanged(updated)
      })
      .catch(() => toast.show({ tone: 'error', message: t('projects.saveError') }))
  }, [project.id, onChanged, t, toast])

  const copyInstructions = useCallback(() => {
    void navigator.clipboard
      .writeText(draftInstructions)
      .then(() => toast.show({ tone: 'success', message: t('projects.copied') }))
      .catch(() => {})
  }, [draftInstructions, t, toast])

  return (
    <Modal
      open={project !== null}
      onClose={close}
      title={t('projects.editTitle')}
      className="max-w-xl"
      footer={
        <div className="flex w-full items-center gap-2">
          {onExitProject && (
            // Same treatment as the model panels' remove-connection button.
            <Button
              variant="ghost"
              size="sm"
              onClick={onExitProject}
              disabled={busy}
              className="text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-900/30"
            >
              {t('projects.exit')}
            </Button>
          )}
          <div className="flex-1" />
          {onNewConversation && project && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNewConversation(project)}
              className="flex items-center gap-1.5"
            >
              <Add01Icon size={14} />
              <span>{t('projects.newConversation')}</span>
            </Button>
          )}
          {/* Chat's project dialog closes via backdrop/autosave — no Done;
              the Projects page keeps it as the editor's single action. */}
          {!onExitProject && (
            <Button size="sm" onClick={close}>
              {t('projects.done')}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              aria-label={t('projects.pickIcon')}
              title={t('projects.pickIcon')}
              className={cn(
                'bg-bg border-border flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border text-lg',
                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'
              )}
            >
              {draftIcon || '📁'}
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
              placeholder={t('projects.titlePlaceholder')}
              aria-required
              aria-invalid={titleInvalid}
              className={cn(fieldClass, titleInvalid && 'border-rose-500/70')}
            />
            {titleInvalid && <p className="text-xs text-rose-500">{t('projects.titleRequired')}</p>}
          </div>
        </div>

        <span className="text-muted text-xs font-medium">{t('projects.instructions')}</span>
        {/* Same CodeMirror surface override as the procedures editor so the
            instructions block matches the card code block. Copy floats ON
            the block (top corner), like code blocks everywhere else. */}
        <div className="border-border relative h-[220px] overflow-hidden rounded-lg border [&_.cm-editor]:bg-bg!">
          <button
            type="button"
            onClick={copyInstructions}
            aria-label={t('projects.copy')}
            title={t('projects.copy')}
            className="text-muted hover:text-fg bg-surface/90 border-border absolute end-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border"
          >
            <Copy01Icon size={14} />
          </button>
          <CodeEditor
            value={draftInstructions}
            language="markdown"
            isDark={isDark}
            onChange={(value) => {
              setTouched(true)
              setDraftInstructions(value)
            }}
            placeholder={t('projects.instructionsPlaceholder')}
            className="h-full"
            spellcheck
            readOnly={busy}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-muted text-xs font-medium">
            {t('projects.files', { count: files.length })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={addFiles}
            disabled={busy}
            className="flex items-center gap-1"
          >
            <Add01Icon size={13} />
            <span>{t('projects.addFiles')}</span>
          </Button>
        </div>
        {files.length > 0 && (
          <ul className="border-border bg-bg flex max-h-36 flex-col gap-0.5 overflow-y-auto rounded-lg border p-1.5">
            {files.map((file) => {
              const { base, ext } = splitFileName(file.name)
              return (
                <li
                  key={file.path}
                  className="group flex items-center gap-2 rounded-md px-1.5 py-1"
                >
                  {/* dir=ltr pins filename order (and the pinned extension)
                      even in the RTL locale — paths are LTR text. */}
                  <span
                    title={file.path}
                    dir="ltr"
                    className="text-fg flex min-w-0 flex-1 items-baseline text-xs"
                  >
                    <span className="truncate">{base}</span>
                    {ext && <span className="shrink-0">{ext}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => persistFiles(files.filter((f) => f.path !== file.path))}
                    disabled={busy}
                    aria-label={t('projects.removeFile')}
                    title={t('projects.removeFile')}
                    className={cn(
                      'text-muted flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                      busy ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:text-rose-500'
                    )}
                  >
                    <Delete02Icon size={13} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-muted text-xs">{t('projects.autosaveHint')}</p>
      </div>
    </Modal>
  )
}
