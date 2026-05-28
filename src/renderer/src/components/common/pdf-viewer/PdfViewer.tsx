import { useUploadBlob } from '@hooks/use-upload-blob/useUploadBlob'
import { cn } from '@lib/utils/cn'
import { Download01Icon, LinkSquare02Icon, Pdf02Icon } from 'hugeicons-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export type PdfViewerProps = {
  filePath: string
  fileExists: boolean
  fileName: string
  sizeBytes: number
}

export function PdfViewer({ filePath, fileExists, fileName }: PdfViewerProps): React.JSX.Element {
  if (!fileExists) {
    return <DeletedPdf fileName={fileName} />
  }

  return <ActivePdf filePath={filePath} fileName={fileName} />
}

function DeletedPdf({ fileName }: { fileName: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'border-border bg-surface flex w-full max-w-[85%] items-center gap-3 self-start',
        'rounded-2xl border px-4 py-3 opacity-50'
      )}
    >
      <div className="bg-muted/20 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
        <Pdf02Icon size={18} className="text-muted" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-muted truncate text-sm font-medium" title={fileName}>
          {fileName}
        </span>
        <span className="text-muted text-xs italic">{t('chat.pdfViewer.deleted')}</span>
      </div>
    </div>
  )
}

function ActivePdf({
  filePath,
  fileName
}: {
  filePath: string
  fileName: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const { url, error } = useUploadBlob(filePath, 'application/pdf')

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

  if (error) {
    return <DeletedPdf fileName={fileName} />
  }

  return (
    <div
      className={cn(
        'border-border bg-surface flex w-full max-w-[85%] flex-col self-start',
        'overflow-hidden rounded-2xl border'
      )}
    >
      {url ? (
        <iframe src={url} title={fileName} className="h-[400px] w-full border-0" />
      ) : (
        <div className="flex h-[400px] w-full items-center justify-center">
          <span className="text-muted text-xs">{t('chat.pdfViewer.loading')}</span>
        </div>
      )}
      <div className="flex items-center gap-2 px-3 py-2">
        <Pdf02Icon size={14} className="text-muted shrink-0" />
        <span
          className="text-muted min-w-0 flex-1 truncate text-[11px] font-medium"
          title={fileName}
        >
          {fileName}
        </span>
        <button
          type="button"
          onClick={openExternal}
          title={t('chat.pdfViewer.openExternal')}
          className={cn(
            'text-muted hover:text-fg flex shrink-0 cursor-pointer items-center justify-center rounded p-1',
            'focus-visible:ring-2 focus-visible:ring-accent'
          )}
        >
          <LinkSquare02Icon size={14} />
        </button>
        <button
          type="button"
          onClick={download}
          title={t('chat.pdfViewer.download')}
          className={cn(
            'text-muted hover:text-fg flex shrink-0 cursor-pointer items-center justify-center rounded p-1',
            'focus-visible:ring-2 focus-visible:ring-accent'
          )}
        >
          <Download01Icon size={14} />
        </button>
      </div>
    </div>
  )
}
