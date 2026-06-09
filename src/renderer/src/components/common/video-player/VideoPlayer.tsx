import { useUploadBlob } from '@hooks/use-upload-blob/useUploadBlob'
import { cn } from '@lib/utils/cn'
import { Download01Icon, VideoOffIcon } from 'hugeicons-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export type VideoPlayerProps = {
  filePath: string
  fileExists: boolean
  mimeType: string
  fileName: string
}

/**
 * Inline video player for uploaded files. Native `<video controls>` is
 * the right primitive here — Electron's Chromium handles every codec we
 * accept (mp4/h264, webm/vp9, mov/h264). The blob source decouples
 * playback from the IPC channel; the workspace path is purely metadata.
 */
export function VideoPlayer({
  filePath,
  fileExists,
  mimeType,
  fileName
}: VideoPlayerProps): React.JSX.Element {
  if (!fileExists) {
    return <DeletedVideo />
  }
  return <ActiveVideo filePath={filePath} mimeType={mimeType} fileName={fileName} />
}

function DeletedVideo(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'border-border bg-surface relative flex w-full max-w-[85%] flex-col gap-2 self-start',
        'aspect-video items-center justify-center rounded-2xl border opacity-50'
      )}
    >
      <VideoOffIcon size={32} className="text-muted" />
      <span className="text-muted text-sm italic">{t('chat.videoPlayer.deleted')}</span>
    </div>
  )
}

function ActiveVideo({
  filePath,
  mimeType,
  fileName
}: {
  filePath: string
  mimeType: string
  fileName: string
}): React.JSX.Element {
  const { url, error } = useUploadBlob(filePath, mimeType)

  const download = useCallback(async () => {
    try {
      await window.api.upload.download(filePath)
    } catch {
      // best-effort
    }
  }, [filePath])

  if (error) {
    return <DeletedVideo />
  }

  return (
    <div
      className={cn(
        'border-border bg-surface flex w-full max-w-[85%] flex-col gap-2 self-start',
        'overflow-hidden rounded-2xl border'
      )}
    >
      {url ? (
        <video
          src={url}
          controls
          preload="metadata"
          className="bg-black w-full"
          style={{ maxHeight: '60vh' }}
        />
      ) : (
        <div
          className="bg-border/30 flex w-full items-center justify-center"
          style={{ aspectRatio: '16 / 9' }}
        >
          <span className="text-muted text-xs">Loading video…</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 px-3 pb-2">
        <span className="text-muted truncate text-[11px] font-medium" title={fileName}>
          {fileName}
        </span>
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
  )
}
