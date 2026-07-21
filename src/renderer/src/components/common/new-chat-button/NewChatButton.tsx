import { cn } from '@lib/utils/cn'
import type { Project } from '@preload/index'
import { PlusSignIcon } from 'hugeicons-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Composer New-chat button with a hover card (the ChatModeButton recipe:
 * 150ms open / 200ms close timers, Escape + outside-click dismiss). Clicking
 * the button creates a plain no-project conversation, exactly as before;
 * hovering reveals the projects as cards — picking one starts the new
 * conversation inside that project. Projects load lazily on first reveal;
 * with none, the card never shows and this stays a plain New button.
 */
export function NewChatButton({
  onNew,
  onNewInProject
}: {
  onNew: () => void
  onNewInProject: (projectId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<Project[] | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  // Fetch on EVERY reveal, not once per mount: Chat instances stay mounted
  // for the whole app session (keepalive), so a one-shot cache pinned the
  // project list to whatever existed at the FIRST hover — projects created
  // later never appeared. The call is a ~1ms IPC; the previous list stays
  // rendered while the refresh lands, so there's no flicker.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void window.api.projects
      .list()
      .then((list) => {
        if (!cancelled) setProjects(list)
      })
      .catch(() => {
        if (!cancelled) setProjects((prev) => prev ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
    }
  }, [])

  const onEnter = (): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setOpen(true), 150)
  }
  const onLeave = (): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setOpen(false), 200)
  }

  const cardVisible = open && projects !== null && projects.length > 0

  return (
    <span
      ref={rootRef}
      className="relative inline-flex shrink-0"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <button
        type="button"
        onClick={() => {
          setOpen(false)
          onNew()
        }}
        onFocus={onEnter}
        onBlur={onLeave}
        title={t('chat.newChat')}
        aria-label={t('chat.newChat')}
        aria-expanded={cardVisible}
        className={cn(
          'flex w-14 flex-col items-center gap-0.5 rounded-md px-1.5 py-1',
          'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          'text-muted cursor-pointer hover:text-fg'
        )}
      >
        <PlusSignIcon size={14} />
        <span className="text-[10px] leading-tight font-medium">{t('chat.newChatShort')}</span>
      </button>

      {cardVisible && (
        <div
          role="dialog"
          className="border-border bg-surface absolute bottom-full inset-s-0 z-50 mb-2 flex w-80 max-w-[90vw] flex-col gap-1.5 rounded-xl border p-1.5 shadow-xl"
        >
          <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
            {projects.map((p) => {
              // Single truncated line of the project's instructions — the
              // same name + description shape as the mode/thinking cards.
              const instructions = p.instructions.trim().replace(/\s+/g, ' ')
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onNewInProject(p.id)
                  }}
                  className={cn(
                    'flex w-full cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2 text-start',
                    'focus-visible:ring-2 focus-visible:ring-accent',
                    'border-border hover:bg-border/40'
                  )}
                >
                  <span aria-hidden className="mt-0.5 shrink-0 text-base leading-none">
                    {p.icon || '📁'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-fg block truncate text-xs font-medium">
                      {p.title.trim() || t('projects.untitled')}
                    </span>
                    {instructions !== '' && (
                      <span
                        dir="auto"
                        className="text-muted block truncate text-[11px] leading-snug"
                      >
                        {instructions}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </span>
  )
}
