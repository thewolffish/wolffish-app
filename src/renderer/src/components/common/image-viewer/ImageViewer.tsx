import { Modal } from '@components/core/Modal'
import { useUploadBlob } from '@hooks/use-upload-blob/useUploadBlob'
import { cn } from '@lib/utils/cn'
import { Download01Icon, FolderOpenIcon, Image02Icon, LinkSquare02Icon } from 'hugeicons-react'
import { useCallback, useState } from 'react'
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
            <img src={url} alt={fileName} className="block max-w-full" draggable={false} />
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
        <Modal open={open} onClose={() => setOpen(false)} title={fileName}>
          <div className="flex max-h-[80vh] items-center justify-center overflow-auto">
            <img
              src={url}
              alt={fileName}
              className="max-h-[75vh] w-auto object-contain"
              draggable={false}
            />
          </div>
        </Modal>
      )}
    </>
  )
}
