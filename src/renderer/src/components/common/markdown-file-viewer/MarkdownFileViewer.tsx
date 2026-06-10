import { CodeFileViewer } from '@components/common/code-file-viewer/CodeFileViewer'
import { FileCard } from '@components/common/file-card/FileCard'
import { useUploadText } from '@hooks/use-upload-text/useUploadText'
import { useCallback } from 'react'

export type MarkdownFileViewerProps = {
  filePath: string
  fileExists: boolean
  fileName: string
  sizeBytes: number
  mimeType: string
}

/**
 * Inline renderer for markdown attachments (README.md and friends).
 * Loads the file text over the upload IPC channel and reuses the
 * CodeFileViewer card so attached readmes look identical to tool-result
 * ones: rendered markdown in a max-height scrollable block with copy and
 * download in the footer. Falls back to the plain FileCard while loading,
 * on read failure, or for files too large to render inline.
 */
const MAX_INLINE_BYTES = 512 * 1024

export function MarkdownFileViewer({
  filePath,
  fileExists,
  fileName,
  sizeBytes,
  mimeType
}: MarkdownFileViewerProps): React.JSX.Element {
  const oversized = sizeBytes > MAX_INLINE_BYTES
  const { text, error } = useUploadText(fileExists && !oversized ? filePath : null)

  const download = useCallback(() => {
    window.api.upload.download(filePath).catch(() => {
      // best-effort
    })
  }, [filePath])

  if (text === null) {
    return (
      <FileCard
        filePath={filePath}
        fileExists={fileExists && !error}
        fileName={fileName}
        sizeBytes={sizeBytes}
        mimeType={mimeType}
      />
    )
  }

  return (
    <CodeFileViewer
      content={text}
      fileName={fileName}
      sizeBytes={sizeBytes}
      onDownload={download}
    />
  )
}
