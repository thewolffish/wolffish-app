import { cn } from '@lib/utils/cn'
import { formatBytes } from '@lib/utils/format'
import { Download01Icon, File01Icon } from 'hugeicons-react'
import { useCallback } from 'react'

export type FileCardProps = {
  filePath: string
  fileExists: boolean
  fileName: string
  sizeBytes: number
  mimeType: string
}

/**
 * Fallback renderer for attachments we don't render inline (.zip,
 * .docx, anything outside our audio/video/image/pdf set). Same visual
 * weight as the PDF card so attachments stack uniformly.
 */
export function FileCard({
  filePath,
  fileExists,
  fileName,
  sizeBytes,
  mimeType
}: FileCardProps): React.JSX.Element {
  if (!fileExists) {
    return <DeletedFile fileName={fileName} />
  }
  return (
    <ActiveFile
      filePath={filePath}
      fileName={fileName}
      sizeBytes={sizeBytes}
      mimeType={mimeType}
    />
  )
}

function DeletedFile({ fileName }: { fileName: string }): React.JSX.Element {
  return (
    <div
      className={cn(
        'border-border bg-surface flex w-full max-w-[85%] items-center gap-3 self-start',
        'rounded-2xl border px-4 py-3 opacity-50'
      )}
    >
      <div className="bg-muted/20 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
        <File01Icon size={18} className="text-muted" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-muted truncate text-sm font-medium" title={fileName}>
          {fileName}
        </span>
        <span className="text-muted text-xs italic">File was deleted</span>
      </div>
    </div>
  )
}

function ActiveFile({
  filePath,
  fileName,
  sizeBytes,
  mimeType
}: {
  filePath: string
  fileName: string
  sizeBytes: number
  mimeType: string
}): React.JSX.Element {
  const download = useCallback(async () => {
    try {
      await window.api.upload.download(filePath)
    } catch {
      // best-effort
    }
  }, [filePath])

  return (
    <div
      className={cn(
        'border-border bg-surface flex w-full max-w-[85%] items-center gap-3 self-start',
        'rounded-2xl border px-4 py-3'
      )}
    >
      <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
        <File01Icon size={20} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-fg truncate text-sm font-medium" title={fileName}>
          {fileName}
        </span>
        <span className="text-muted text-xs">
          {mimeType || 'file'} · {formatBytes(sizeBytes)}
        </span>
      </div>
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
  )
}
