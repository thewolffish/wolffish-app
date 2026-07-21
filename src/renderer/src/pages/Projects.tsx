import { ChannelIcon } from '@components/common/channel-icon/ChannelIcon'
import { ProjectDialog } from '@components/common/project-dialog/ProjectDialog'
import { Badge } from '@components/core/Badge'
import { Button } from '@components/core/Button'
import { Modal } from '@components/core/Modal'
import { useToast } from '@components/core/toast/useToast'
import { CONVERSATION_CHIP_BASE, conversationChipClasses } from '@lib/conversation-chip'
import { mapConversationMessages } from '@lib/conversation-open'
import { RTL_LOCALES } from '@lib/i18n'
import { cn } from '@lib/utils/cn'
import { pageTopPadding } from '@lib/utils/platform'
import type { ConversationMeta, Project } from '@preload/index'
import { useFlow } from '@providers/flow/useFlow'
import { useLocale } from '@providers/locale/useLocale'
import { useSessions } from '@providers/sessions/useSessions'
import {
  Add01Icon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  BubbleChatIcon,
  Delete01Icon,
  Delete02Icon,
  Edit02Icon
} from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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

const iconButtonClass = cn(
  'text-muted flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg',
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
)

/**
 * Projects — glorified conversations: instructions + a maintained file list,
 * from which fresh conversations are spawned. Opening a card activates the
 * project and drops into chat's project mode; everything else (create, edit,
 * delete, cards, autosave) mirrors the Procedures page.
 */
export function Projects(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const isRtl = RTL_LOCALES.has(locale)
  const BackIcon = isRtl ? ArrowRight02Icon : ArrowLeft02Icon
  const { goTo } = useFlow()
  const {
    newSession,
    activeProject,
    setActiveProject,
    runStatuses,
    openConversation,
    activateConversation,
    activeConversationId,
    closeConversation
  } = useSessions()
  const toast = useToast()

  const [projects, setProjects] = useState<Project[]>([])
  const [metas, setMetas] = useState<ConversationMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Project | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  /** Project whose conversations dialog is open. */
  const [convsProject, setConvsProject] = useState<Project | null>(null)
  const [convDeleteTarget, setConvDeleteTarget] = useState<ConversationMeta | null>(null)

  // Per-project conversation stats derived from the conversation index:
  // count + the latest activity timestamp ("last used" beats "last edited"
  // as the card's recency signal — using a project IS its life sign).
  const convStats = useMemo(() => {
    const stats = new Map<string, { count: number; lastUsed: number }>()
    for (const meta of metas) {
      if (!meta.projectId) continue
      const prev = stats.get(meta.projectId)
      stats.set(meta.projectId, {
        count: (prev?.count ?? 0) + 1,
        lastUsed: Math.max(prev?.lastUsed ?? 0, meta.updatedAt)
      })
    }
    return stats
  }, [metas])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([window.api.projects.list(), window.api.conversation.list().catch(() => [])])
      .then(([list, convMetas]) => {
        if (cancelled) return
        setProjects(list)
        setMetas(convMetas)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleCreate = useCallback(() => {
    void window.api.projects
      .create({ title: '' })
      .then((created) => {
        setProjects((prev) => [created, ...prev])
        setEditing(created)
      })
      .catch(() => toast.show({ tone: 'error', message: t('projects.saveError') }))
  }, [t, toast])

  const handleChanged = useCallback(
    (updated: Project) => {
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
      setEditing((prev) => (prev && prev.id === updated.id ? updated : prev))
      // Keep chat's project mode coherent: editing the ACTIVE project here
      // must update the chrome (hero, rail header) it renders from.
      if (activeProject?.id === updated.id) setActiveProject(updated)
    },
    [activeProject, setActiveProject]
  )

  const closeEditor = useCallback(() => {
    const current = editing
    setEditing(null)
    // Title is required — a never-named fresh stub is discarded on close,
    // mirroring the procedures create-then-abandon contract.
    if (current && current.title.trim() === '') {
      setProjects((prev) => prev.filter((p) => p.id !== current.id))
      void window.api.projects.delete(current.id).catch(() => {})
    }
  }, [editing])

  const handleDelete = useCallback(() => {
    const target = deleteTarget
    if (!target) return
    void window.api.projects
      .delete(target.id)
      .then(() => {
        setProjects((prev) => prev.filter((p) => p.id !== target.id))
        setDeleteTarget(null)
        // A deleted project can't stay "active" — chat would render project
        // chrome while turns run with an empty overlay.
        if (activeProject?.id === target.id) setActiveProject(null)
        toast.show({ tone: 'success', message: t('projects.deleteSuccess') })
      })
      .catch(() => toast.show({ tone: 'error', message: t('projects.saveError') }))
  }, [deleteTarget, activeProject, setActiveProject, t, toast])

  const enterProject = useCallback(
    (project: Project) => {
      setActiveProject(project)
      newSession({ projectId: project.id })
      goTo('chat')
    },
    [setActiveProject, newSession, goTo]
  )

  // Resume a project conversation — History's exact open path: a live
  // session wins (no disk load); openConversation re-activates the project.
  const handleResumeConversation = useCallback(
    async (id: string) => {
      if (activateConversation(id)) {
        goTo('chat')
        return
      }
      const conv = await window.api.conversation.load(id)
      if (!conv) return
      openConversation(conv, mapConversationMessages(conv))
      goTo('chat')
    },
    [activateConversation, openConversation, goTo]
  )

  const handleDeleteConversation = useCallback(async () => {
    const target = convDeleteTarget
    if (!target) return
    const result = await window.api.conversation.delete(target.id)
    if (result.ok) {
      closeConversation(target.id)
      // Optimistic drop — the cortex row lingers ~500ms after the file goes;
      // the next page mount re-fetches the reconciled truth.
      setMetas((prev) => prev.filter((m) => m.id !== target.id))
    }
    setConvDeleteTarget(null)
  }, [convDeleteTarget, closeConversation])

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
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
          <header className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h1 className="text-fg text-2xl font-semibold tracking-tight">
                  {t('projects.title')}
                </h1>
                {!loading && (
                  <Badge variant="default" size="sm">
                    {projects.length}
                  </Badge>
                )}
              </div>
              <p className="text-muted text-sm leading-relaxed">{t('projects.subtitle')}</p>
            </div>
            <Button size="sm" onClick={handleCreate} className="shrink-0">
              <Add01Icon size={16} />
              <span>{t('projects.new')}</span>
            </Button>
          </header>

          {loading ? (
            <div className="text-muted py-10 text-center text-sm">{t('common.loading')}</div>
          ) : projects.length === 0 ? (
            <div className="border-border text-muted rounded-2xl border border-dashed px-6 py-12 text-center text-sm">
              {t('projects.empty')}
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {projects.map((project) => {
                const name = project.title.trim() || t('projects.untitled')
                const stats = convStats.get(project.id)
                return (
                  <li key={project.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => enterProject(project)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') enterProject(project)
                      }}
                      title={name}
                      className={cn(
                        'bg-surface border-border hover:border-accent/50 flex h-full cursor-pointer flex-col gap-2.5 rounded-2xl border px-4 py-3 text-start',
                        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span aria-hidden className="text-2xl leading-none">
                            {project.icon || '📁'}
                          </span>
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-fg truncate text-sm font-medium">{name}</span>
                            <span className="text-muted truncate text-xs">
                              {t('projects.usedAt', {
                                time: formatFromNow(
                                  stats?.lastUsed ?? project.updatedAt,
                                  now,
                                  locale
                                )
                              })}
                              {' · '}
                              {t('projects.conversationCount', { count: stats?.count ?? 0 })}
                              {' · '}
                              {t('chat.files.fileCount', { count: project.files.length })}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setConvsProject(project)
                            }}
                            aria-label={t('projects.viewConversations')}
                            title={t('projects.viewConversations')}
                            className={cn(iconButtonClass, 'hover:text-fg')}
                          >
                            <BubbleChatIcon size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditing(project)
                            }}
                            aria-label={t('projects.edit')}
                            title={t('projects.edit')}
                            className={cn(iconButtonClass, 'hover:text-fg')}
                          >
                            <Edit02Icon size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteTarget(project)
                            }}
                            aria-label={t('projects.delete')}
                            title={t('projects.delete')}
                            className={cn(iconButtonClass, 'hover:text-rose-500')}
                          >
                            <Delete02Icon size={15} />
                          </button>
                        </div>
                      </div>
                      {project.instructions.trim() ? (
                        <pre
                          dir="auto"
                          // Scrolling/selecting inside the block must not count
                          // as "open the project" — the card is the click target.
                          onClick={(e) => e.stopPropagation()}
                          className="bg-bg border-border text-muted max-h-40 cursor-auto overflow-auto rounded-lg border px-3 py-2 font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap"
                        >
                          {project.instructions}
                        </pre>
                      ) : (
                        <p className="text-muted text-xs italic">{t('projects.noInstructions')}</p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <ProjectDialog project={editing} onClose={closeEditor} onChanged={handleChanged} />

      {/* Project conversations — single column, History's exact card style,
          scoped to this project: resume on click, delete on hover. */}
      <Modal
        open={convsProject !== null}
        onClose={() => setConvsProject(null)}
        title={
          convsProject
            ? `${convsProject.icon || '📁'} ${convsProject.title.trim() || t('projects.untitled')}`
            : ''
        }
        className="max-w-xl"
      >
        {(() => {
          if (!convsProject) return null
          const rows = metas.filter((m) => m.projectId === convsProject.id)
          if (rows.length === 0) {
            return (
              <p className="text-muted py-6 text-center text-sm">{t('projects.noConversations')}</p>
            )
          }
          return (
            <div className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
              {rows.map((conv, index) => {
                const isActive = activeConversationId === conv.id
                const live = runStatuses[conv.id]
                const phase = live?.phase ?? null
                const processing = phase === 'processing'
                const title =
                  conv.title && conv.title !== 'Untitled'
                    ? conv.title
                    : (live?.title ?? t('chat.conversationsUntitled'))
                return (
                  <div
                    key={conv.id}
                    className={cn(
                      'group flex items-center gap-3 rounded-xl px-4 py-3',
                      // History's row treatment, inverted for the surface-
                      // colored modal card: the fill is bg (not surface),
                      // else hover/active would vanish into the card.
                      'hover:bg-bg cursor-pointer',
                      isActive && 'bg-bg border-border border'
                    )}
                    onClick={() => {
                      setConvsProject(null)
                      void handleResumeConversation(conv.id)
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setConvsProject(null)
                        void handleResumeConversation(conv.id)
                      }
                    }}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        CONVERSATION_CHIP_BASE,
                        conversationChipClasses(phase, isActive)
                      )}
                    >
                      {index + 1}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="text-fg truncate text-sm font-medium">{title}</span>
                        <ChannelIcon
                          channel={conv.channel}
                          size={12}
                          className="text-muted shrink-0"
                        />
                      </div>
                      <span className="text-muted text-xs">
                        {formatFromNow(conv.updatedAt, now, locale)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!processing) setConvDeleteTarget(conv)
                      }}
                      disabled={processing}
                      aria-label={t('history.delete')}
                      title={processing ? t('history.processing') : undefined}
                      className={cn(
                        'text-muted rounded-lg p-1.5 opacity-0',
                        'group-hover:opacity-100',
                        processing
                          ? 'cursor-not-allowed opacity-40'
                          : 'cursor-pointer hover:text-red-600 dark:hover:text-red-400',
                        'focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent'
                      )}
                    >
                      <Delete01Icon size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          )
        })()}
      </Modal>

      <Modal
        open={convDeleteTarget !== null}
        onClose={() => setConvDeleteTarget(null)}
        title={t('history.deleteTitle')}
        footer={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConvDeleteTarget(null)}
              className="flex-1"
            >
              {t('history.deleteCancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleDeleteConversation}
              className="flex-1 border border-transparent bg-red-600 text-white shadow-none hover:bg-red-700"
            >
              {t('history.deleteConfirm')}
            </Button>
          </div>
        }
      >
        <p className="text-muted">{t('history.deleteWarning')}</p>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('projects.deleteTitle')}
        footer={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              className="flex-1"
            >
              {t('projects.deleteCancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleDelete}
              className="flex-1 border border-transparent bg-red-600 text-white shadow-none hover:bg-red-700"
            >
              {t('projects.deleteConfirm')}
            </Button>
          </div>
        }
      >
        <p className="text-muted">
          {t('projects.deleteWarning', {
            name: deleteTarget?.title.trim() || t('projects.untitled')
          })}
        </p>
      </Modal>
    </main>
  )
}
