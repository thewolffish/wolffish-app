import { useUploadBlob } from '@hooks/use-upload-blob/useUploadBlob'
import { cn } from '@lib/utils/cn'
import { Download01Icon, FolderOpenIcon, Image02Icon, LinkSquare02Icon } from 'hugeicons-react'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

export type ImageViewerProps = {
  filePath: string
  fileExists: boolean
  mimeType: string
  fileName: string
  width?: number
  height?: number
}

/**
 * Inline image preview for uploaded files. Click to open at full
 * resolution in a modal overlay. Like the audio/video players, the bytes
 * come back through IPC as a Blob so the renderer doesn't need any
 * special permission to read from disk and the URL is automatically
 * cleaned up when the component unmounts.
 */
export function ImageViewer({
  filePath,
  fileExists,
  mimeType,
  fileName,
  width,
  height
}: ImageViewerProps): React.JSX.Element {
  if (!fileExists) {
    return <DeletedImage width={width} height={height} />
  }
  return (
    <ActiveImage
      filePath={filePath}
      mimeType={mimeType}
      fileName={fileName}
      width={width}
      height={height}
    />
  )
}

function DeletedImage({ width, height }: { width?: number; height?: number }): React.JSX.Element {
  const { t } = useTranslation()
  const ratio = width && height ? `${width} / ${height}` : '1 / 1'
  return (
    <div
      className={cn(
        'border-border bg-surface flex max-w-[85%] flex-col items-center justify-center gap-2 self-start',
        'rounded-2xl border opacity-50'
      )}
      style={{ aspectRatio: ratio, width: width ? Math.max(width, 192) : 320 }}
    >
      <Image02Icon size={32} className="text-muted" />
      <span className="text-muted text-sm italic">{t('chat.imageViewer.deleted')}</span>
    </div>
  )
}

function ActiveImage({
  filePath,
  mimeType,
  fileName,
  width,
  height
}: {
  filePath: string
  mimeType: string
  fileName: string
  width?: number
  height?: number
}): React.JSX.Element {
  const { url, error } = useUploadBlob(filePath, mimeType)
  const [open, setOpen] = useState(false)
  // Seeded from attachment metadata when present; the thumbnail's onLoad
  // overwrites it with the decoded image's real ratio, which wins on mismatch.
  const [ratio, setRatio] = useState<number | null>(width && height ? width / height : null)

  const openExternal = useCallback(async () => {
    try {
      await window.api.upload.openExternal(filePath)
    } catch {
      // best-effort
    }
  }, [filePath])

  const download = useCallback(async () => {
    try {
      await window.api.upload.download(filePath)
    } catch {
      // best-effort
    }
  }, [filePath])

  const revealInFolder = useCallback(async () => {
    try {
      await window.api.upload.revealInFolder(filePath)
    } catch {
      // best-effort
    }
  }, [filePath])

  if (error) {
    return <DeletedImage width={width} height={height} />
  }

  return (
    <>
      <div
        className={cn(
          'border-border bg-surface flex w-fit max-w-[85%] flex-col gap-2 self-start',
          'overflow-hidden rounded-2xl border'
        )}
      >
        {url ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="block cursor-zoom-in"
            aria-label="Open image at full size"
          >
            <img
              src={url}
              alt={fileName}
              className="block max-w-full"
              draggable={false}
              onLoad={(e) => {
                const { naturalWidth, naturalHeight } = e.currentTarget
                if (naturalWidth && naturalHeight) setRatio(naturalWidth / naturalHeight)
              }}
            />
          </button>
        ) : (
          <div
            className="bg-border/30 flex max-w-full items-center justify-center"
            style={{
              aspectRatio: width && height ? `${width} / ${height}` : '4 / 3',
              width: width ?? 320
            }}
          >
            <span className="text-muted text-xs">Loading image…</span>
          </div>
        )}
        {/* w-0 + min-w-full keeps a long filename from widening the card past the image */}
        <div className="flex w-0 min-w-full items-center gap-2 px-3 pb-2">
          <span
            className="text-muted min-w-0 flex-1 truncate text-[11px] font-medium"
            title={fileName}
          >
            {fileName}
          </span>
          <button
            type="button"
            onClick={openExternal}
            title="Open in default viewer"
            className={cn(
              'text-muted hover:text-fg flex shrink-0 cursor-pointer items-center justify-center rounded p-1',
              'focus-visible:ring-2 focus-visible:ring-accent'
            )}
          >
            <LinkSquare02Icon size={14} />
          </button>
          <button
            type="button"
            onClick={revealInFolder}
            title="Reveal in folder"
            className={cn(
              'text-muted hover:text-fg flex shrink-0 cursor-pointer items-center justify-center rounded p-1',
              'focus-visible:ring-2 focus-visible:ring-accent'
            )}
          >
            <FolderOpenIcon size={14} />
          </button>
          <button
            type="button"
            onClick={download}
            title="Download"
            className={cn(
              'text-muted hover:text-fg flex shrink-0 cursor-pointer items-center justify-center rounded p-1',
              'focus-visible:ring-2 focus-visible:ring-accent'
            )}
          >
            <Download01Icon size={14} />
          </button>
        </div>
      </div>

      {url && (
        <ImageLightbox
          open={open}
          onClose={() => setOpen(false)}
          url={url}
          fileName={fileName}
          ratio={ratio}
        />
      )}
    </>
  )
}

export type ImageLightboxProps = {
  open: boolean
  onClose: () => void
  url: string
  fileName: string
  /** Natural width/height ratio; null until the image has decoded once. */
  ratio: number | null
}

/**
 * Click-to-zoom overlay. The card grows to the same limit as the expanded
 * prompt editor (80vw × 80vh) but keeps the image's aspect ratio: width is
 * min(80vw, 80vh · ratio), so whichever axis hits its limit first wins and
 * the card hugs the image with no letterbox bars. Until the ratio is known
 * the image shows at natural size capped to the same limits. Dismissed by
 * backdrop click or Escape, like the core Modal it replaced.
 */
export function ImageLightbox({
  open,
  onClose,
  url,
  fileName,
  ratio
}: ImageLightboxProps): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={fileName}
        onClick={(e) => e.stopPropagation()}
        className="border-border bg-surface overflow-hidden rounded-2xl border shadow-xl"
      >
        <img
          src={url}
          alt={fileName}
          draggable={false}
          className="block object-contain"
          style={
            ratio
              ? { aspectRatio: `${ratio}`, width: `min(80vw, calc(80vh * ${ratio}))` }
              : { maxWidth: '80vw', maxHeight: '80vh' }
          }
        />
      </div>
    </div>,
    document.body
  )
}
