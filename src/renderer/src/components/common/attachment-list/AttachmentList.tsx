import { AudioPlayer } from '@components/common/audio-player/AudioPlayer'
import { FileCard } from '@components/common/file-card/FileCard'
import { ImageViewer } from '@components/common/image-viewer/ImageViewer'
import { MarkdownFileViewer } from '@components/common/markdown-file-viewer/MarkdownFileViewer'
import { PdfViewer } from '@components/common/pdf-viewer/PdfViewer'
import { VideoPlayer } from '@components/common/video-player/VideoPlayer'
import { cn } from '@lib/utils/cn'
import type { MessageAttachment } from '@preload/index'
import { useEffect, useState } from 'react'

export type AttachmentListProps = {
  attachments: MessageAttachment[]
  /**
   * Alignment of each attachment card within the parent flex column.
   * Defaults to 'start' (assistant-side rendering); pass 'end' under
   * user bubbles so cards line up against the right edge instead of
   * inheriting the renderer components' built-in self-start.
   */
  align?: 'start' | 'end'
}

/**
 * Render each attachment with the type-appropriate renderer. Existence is
 * checked in parallel via IPC at mount time so a chat message that
 * references a since-deleted file shows the per-type "deleted" state
 * instead of a broken player. When a check is in flight the renderer is
 * told `fileExists=true` — the underlying components fall back to a
 * "deleted" state on read failure anyway, so the user never sees a
 * broken-load flash.
 */
export function AttachmentList({
  attachments,
  align = 'start'
}: AttachmentListProps): React.JSX.Element | null {
  const existence = useExistenceMap(attachments)
  if (attachments.length === 0) return null

  return (
    <div
      className={cn(
        // w-full lets each renderer's `w-full max-w-[85%]` resolve against
        // the parent bubble's full width instead of the AttachmentList's
        // intrinsic content width — without this, the audio/video players
        // collapse to the size of their controls.
        'flex w-full flex-col gap-2',
        align === 'end' ? 'items-end [&>*]:self-end' : 'items-start [&>*]:self-start'
      )}
    >
      {attachments.map((att, idx) => {
        const exists = existence[att.filePath] ?? true
        const key = `${att.filePath}-${idx}`
        if (att.type === 'audio') {
          return (
            <AudioPlayer
              key={key}
              filePath={att.filePath}
              fileExists={exists}
              mimeType={att.mimeType}
              fileName={att.originalName}
            />
          )
        }
        if (att.type === 'video') {
          return (
            <VideoPlayer
              key={key}
              filePath={att.filePath}
              fileExists={exists}
              mimeType={att.mimeType}
              fileName={att.originalName}
            />
          )
        }
        if (att.type === 'image') {
          return (
            <ImageViewer
              key={key}
              filePath={att.filePath}
              fileExists={exists}
              mimeType={att.mimeType}
              fileName={att.originalName}
              width={att.width}
              height={att.height}
            />
          )
        }
        if (att.type === 'pdf') {
          return (
            <PdfViewer
              key={key}
              filePath={att.filePath}
              fileExists={exists}
              fileName={att.originalName}
              sizeBytes={att.sizeBytes}
            />
          )
        }
        if (isMarkdownAttachment(att)) {
          return (
            <MarkdownFileViewer
              key={key}
              filePath={att.filePath}
              fileExists={exists}
              fileName={att.originalName}
              sizeBytes={att.sizeBytes}
              mimeType={att.mimeType}
            />
          )
        }
        return (
          <FileCard
            key={key}
            filePath={att.filePath}
            fileExists={exists}
            fileName={att.originalName}
            sizeBytes={att.sizeBytes}
            mimeType={att.mimeType}
          />
        )
      })}
    </div>
  )
}

function isMarkdownAttachment(att: MessageAttachment): boolean {
  return att.mimeType === 'text/markdown' || /\.(md|mdx|markdown)$/i.test(att.originalName)
}

function useExistenceMap(attachments: MessageAttachment[]): Record<string, boolean> {
  const [map, setMap] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    const paths = attachments.map((a) => a.filePath)
    if (paths.length === 0) return

    void (async () => {
      const results = await Promise.all(
        paths.map((p) => window.api.upload.exists(p).catch(() => false))
      )
      if (cancelled) return
      const next: Record<string, boolean> = {}
      paths.forEach((p, i) => {
        next[p] = results[i]
      })
      setMap(next)
    })()

    return () => {
      cancelled = true
    }
    // attachments identity changes per render but file paths are stable for
    // a given message — depending on a stringified key avoids needless
    // refetches without forcing the parent to memoize the array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments.map((a) => a.filePath).join('|')])

  return map
}
