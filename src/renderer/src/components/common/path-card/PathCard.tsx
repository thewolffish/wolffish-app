import { cn } from '@lib/utils/cn'
import { File01Icon, Folder01Icon, FolderOpenIcon, LinkSquare02Icon } from 'hugeicons-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cachedPathInfo, statPathOnce, type PathInfo } from './pathStat'

/**
 * Renders a filesystem location mentioned in an assistant message as a card —
 * folder name (or file name) + the path in a code block + a button to open it
 * in the OS file manager. A folder opens directly; a file is revealed in its
 * parent folder (selected), like "Reveal in Finder".
 *
 * The path is verified on the device first: if it doesn't exist (a path the
 * model invented, or one since deleted) the card renders nothing, so prose
 * paths only surface a card when they point at something real.
 */
export function PathCard({ path }: { path: string }): React.JSX.Element | null {
  const { t } = useTranslation()
  // Seed from the shared cache so a path already verified this session paints
  // its final state immediately — no empty flash. statPathOnce then confirms
  // (instantly for a cache hit, one shared IPC otherwise), so a changed path
  // still re-resolves without a synchronous setState in the effect body.
  const [info, setInfo] = useState<PathInfo | null>(() => cachedPathInfo(path) ?? null)

  useEffect(() => {
    let cancelled = false
    statPathOnce(path).then((r) => {
      if (!cancelled) setInfo(r)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  const reveal = useCallback(async () => {
    try {
      await window.api.upload.revealPath(path)
    } catch {
      // best-effort
    }
  }, [path])

  // Render nothing until verified, and nothing at all if the path isn't real.
  if (!info || !info.exists) return null

  const isDir = info.isDirectory
  const name = displayName(path, isDir)
  const actionLabel = isDir ? t('chat.pathCard.open') : t('chat.pathCard.reveal')

  return (
    <div
      className={cn(
        'border-border bg-surface flex w-full max-w-[85%] flex-col gap-2 self-start',
        'rounded-2xl border px-4 py-3'
      )}
    >
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
          {isDir ? <Folder01Icon size={20} /> : <File01Icon size={20} />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-fg truncate text-sm font-medium" title={name}>
            {name}
          </span>
          <span className="text-muted text-xs">
            {isDir ? t('chat.pathCard.folder') : t('chat.pathCard.file')}
          </span>
        </div>
        <button
          type="button"
          onClick={reveal}
          title={actionLabel}
          className={cn(
            'bg-primary/10 text-primary hover:bg-primary/20 flex shrink-0 cursor-pointer items-center',
            'gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium',
            'focus-visible:ring-2 focus-visible:ring-accent'
          )}
        >
          {isDir ? <FolderOpenIcon size={14} /> : <LinkSquare02Icon size={14} />}
          {actionLabel}
        </button>
      </div>
      <code
        dir="ltr"
        className={cn(
          'border-border/60 bg-muted/10 text-muted block rounded-lg border px-3 py-2',
          'text-start font-mono text-xs break-all'
        )}
        title={path}
      >
        {path}
      </code>
    </div>
  )
}

function displayName(path: string, isDir: boolean): string {
  const trimmed = isDir ? path.replace(/\/+$/, '') : path
  return trimmed.split('/').pop() || trimmed
}
