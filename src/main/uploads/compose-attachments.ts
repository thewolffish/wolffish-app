import type { MessageAttachment } from '@main/conversations'
import { workspaceRoot } from '@main/workspace/root'

/**
 * Build the LLM-facing user-message content with an `<attachments>`
 * metadata block appended. Mirrors the renderer's
 * `composeHistoryContent` so non-renderer channels (Telegram) deliver
 * the same shape to the agent: the model gets filename, mime, size,
 * and absolute path for every attached file regardless of which
 * channel sent the turn.
 *
 * The absolute path matters — tools (stt_transcribe, ffprobe shell
 * calls, etc.) need a real path on disk, not a workspace-relative
 * one. Channels that don't run preprocessing of their own (Telegram)
 * call this; the renderer composes inline because it can stay closer
 * to its own `working_folder` UI state.
 */
export function composeAttachmentContext(
  text: string,
  attachments: readonly MessageAttachment[]
): string {
  if (attachments.length === 0) return text
  const root = workspaceRoot()
  const lines = attachments.map((a) => {
    // URL reference (no local file): the model passes the URL itself to
    // URL-capable tools (video_generate). KEEP IDENTICAL to the renderer
    // twin in Chat.tsx composeHistoryContent.
    if (a.remoteUrl) {
      return `  - ${a.originalName} (type=${a.type}, mime=${a.mimeType}, url=${a.remoteUrl})`
    }
    const ext = a.originalName.includes('.')
      ? a.originalName.slice(a.originalName.lastIndexOf('.'))
      : ''
    const abs = toAbsoluteUploadPath(a.filePath, root)
    return `  - ${a.originalName} (type=${a.type}, mime=${a.mimeType}, size=${a.sizeBytes}b, path=${abs}${ext ? `, ext=${ext}` : ''})`
  })
  const block = `<attachments>\nThe user attached ${attachments.length} file${attachments.length === 1 ? '' : 's'} to this message:\n${lines.join('\n')}\n</attachments>`
  // URL-only video references carry no local file to probe — the ffmpeg
  // inspection instructions apply to on-disk uploads only.
  const hasVideo = attachments.some((a) => a.type === 'video' && !a.remoteUrl)
  const videoPrompt = hasVideo
    ? `<video_instructions>\nOne or more attached files are videos. You cannot view or process video content directly. Instead, use ffmpeg via your shell tool to read the video metadata and inspect the file. Start by running: ffmpeg -hide_banner -i "<path>" for each video file — its stderr reports duration, resolution, codecs and streams. (If ffprobe is available it gives structured JSON: ffprobe -v quiet -print_format json -show_format -show_streams "<path>".) Use ffmpeg for any further video operations the user requests.\n</video_instructions>`
    : ''
  const parts = [text, block, videoPrompt].filter(Boolean)
  return parts.join('\n\n')
}

function toAbsoluteUploadPath(relativePath: string, root: string): string {
  const r = root.replace(/[\\/]+$/, '')
  const rel = relativePath.replace(/^[\\/]+/, '')
  return `${r}/${rel}`
}
