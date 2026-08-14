import type { ToolResultImage } from '@main/runtime/thalamus'

/**
 * Wire-side cap for a single inline image. Decoded (not base64) bytes.
 *
 * Why this number: Anthropic's documented per-image ceiling is 5MB-class;
 * 3MB decoded stays under that after the 4/3 base64 expansion (~4MB on the
 * wire). OpenAI/xAI/Qwen sit at 10–20MB, so this is the conservative
 * intersection, not the loosest vendor. image_view already downscales to
 * 1024px JPEG q75 (typically 50–250KB) and screenshots are 1280px JPEG —
 * they pass. Raw full-page PNGs (browser-extension fallback, computer-use
 * png mode) are what this catches.
 *
 * Oversized images stay as the tool's text (which already names the file
 * on disk for image_view / screenshot tools). Nothing is fetched; nothing
 * is uploaded as a URL.
 */
export const MAX_INLINE_IMAGE_BYTES = 3 * 1024 * 1024

const MAX_INLINE_IMAGE_MB = MAX_INLINE_IMAGE_BYTES / (1024 * 1024)

export function decodedBase64Bytes(data: string): number {
  // Length-first: skip the scan on the empty/whitespace-only case without
  // allocating a trimmed copy of a multi-MB payload on every encode.
  if (data.length === 0) return 0
  let start = 0
  let end = data.length
  while (start < end && data.charCodeAt(start) <= 32) start++
  while (end > start && data.charCodeAt(end - 1) <= 32) end--
  const len = end - start
  if (len === 0) return 0
  const pad =
    data.charCodeAt(end - 1) === 61 /* = */ ? (data.charCodeAt(end - 2) === 61 ? 2 : 1) : 0
  return Math.max(0, Math.floor((len * 3) / 4) - pad)
}

export function inlineOmittedNote(count: number): string {
  const what = count === 1 ? '1 image' : `${count} images`
  return (
    `\n[${what} omitted — too large to send inline ` +
    `(max ${MAX_INLINE_IMAGE_MB}MB decoded). ` +
    `The file path is in this result if the tool saved one; use file tools otherwise.]`
  )
}

export type SelectInlineImagesResult = {
  inline: ToolResultImage[]
  omitted: number
}

/** Session-scoped: one log line per unique over-cap image, not one per encode. */
const loggedDrops = new Set<string>()

export function selectInlineImages(
  images: ToolResultImage[],
  toolName?: string,
  logDrop = false
): SelectInlineImagesResult {
  const inline: ToolResultImage[] = []
  let omitted = 0
  for (const img of images) {
    if (!img.data) continue
    const bytes = decodedBase64Bytes(img.data)
    if (bytes > MAX_INLINE_IMAGE_BYTES) {
      omitted++
      if (logDrop) {
        const key = `${toolName ?? ''}:${bytes}:${img.data.length}`
        if (!loggedDrops.has(key)) {
          loggedDrops.add(key)
          const label = toolName && toolName.length > 0 ? toolName : 'tool'
          console.log(
            `[tool-images] dropped ${label} image: ${bytes} decoded bytes exceeds ${MAX_INLINE_IMAGE_BYTES} cap`
          )
        }
      }
      continue
    }
    inline.push(img)
  }
  return { inline, omitted }
}

/**
 * OpenAI-compat `role: tool` content: text, plus `image_url` data-URI parts
 * for every image that fits the cap. Used by every vision-capable
 * OpenAI-compat encoder so tool-result pixels actually leave the machine.
 */
export function openaiCompatToolContent(
  content: string,
  images?: ToolResultImage[],
  toolName?: string
): string | unknown[] {
  const { inline, omitted } = selectInlineImages(images ?? [], toolName, true)
  const text = omitted > 0 ? content + inlineOmittedNote(omitted) : content
  if (inline.length === 0) return text
  const parts: unknown[] = [{ type: 'text', text }]
  for (const img of inline) {
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${img.mediaType};base64,${img.data}` }
    })
  }
  return parts
}

/** Anthropic `tool_result.content`: text + `image` source blocks. */
export function anthropicToolContent(
  content: string,
  images?: ToolResultImage[],
  toolName?: string
): string | unknown[] {
  const { inline, omitted } = selectInlineImages(images ?? [], toolName, true)
  const text = omitted > 0 ? content + inlineOmittedNote(omitted) : content
  if (inline.length === 0) return text
  const blocks: unknown[] = [{ type: 'text', text }]
  for (const img of inline) {
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data }
    })
  }
  return blocks
}
