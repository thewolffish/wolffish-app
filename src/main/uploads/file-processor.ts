import { resolveUploadPath } from '@main/uploads/uploads'
import fs from 'node:fs/promises'
import path from 'node:path'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string }
  | { type: 'document'; mediaType: 'application/pdf'; data: string }

export type ProcessedAttachment = {
  originalName: string
  fileType: 'image' | 'pdf' | 'document'
  blocks: ContentBlock[]
}

export type FileProcessorOptions = {
  /**
   * True when the active model cannot ingest raw PDF bytes (local/Ollama):
   * PDFs are flattened to extracted text instead of a base64 document block.
   * A capability flag, not a provider id — cloud providers absent from an
   * enum can never silently misroute onto the lossy path again.
   */
  pdfAsText: boolean
  /**
   * Whether the active model accepts image content parts. False never
   * rejects an upload — images are handed to the model as a text note
   * (name + on-disk path + how to operate on it with tools) instead of
   * a base64 block a text-only API would 400 on.
   */
  supportsVision: boolean
}

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const DOCUMENT_EXTS = new Set([
  '.docx',
  '.xlsx',
  '.xls',
  '.csv',
  '.tsv',
  '.txt',
  '.md',
  '.json',
  '.pptx',
  '.html',
  '.htm'
])

/**
 * Document mimetypes → the extension whose extractor handles them. Used as a
 * fallback when a file arrives with no usable filename extension — inbound
 * channel media (WhatsApp/Telegram) whose sender omitted or stripped the
 * extension. Without this an extension-less docx/xlsx/pptx would reach the
 * model as an opaque path with no extracted text, the same silent drop the
 * channel fix set out to prevent (the PDF case is already handled by the
 * dedicated application/pdf branch).
 */
const DOC_EXT_BY_MIME: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/csv': '.csv',
  'text/tab-separated-values': '.tsv',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
  'text/html': '.html'
}

export async function processAttachment(
  relativePath: string,
  mimeType: string,
  originalName: string,
  options: FileProcessorOptions
): Promise<ProcessedAttachment | null> {
  const abs = resolveUploadPath(relativePath)
  if (!abs) return null

  const ext = path.extname(originalName).toLowerCase()

  if (IMAGE_MIMES.has(mimeType)) {
    if (!options.supportsVision) return imageAsTextNote(abs, originalName)
    return processImage(abs, mimeType, originalName)
  }

  if (mimeType === 'application/pdf') {
    return processPdf(abs, originalName, options)
  }

  if (DOCUMENT_EXTS.has(ext)) {
    return processDocument(abs, originalName, ext)
  }

  // Extension-less document fallback: classifyFile preserves the sender's
  // mimetype, so map that back to the extractor's extension and process by
  // content (mammoth/xlsx/jszip read the bytes, not the name). Covers inbound
  // channel files that arrived without a usable filename extension.
  const docExt = DOC_EXT_BY_MIME[mimeType.split(';')[0].trim().toLowerCase()]
  if (docExt) {
    return processDocument(abs, originalName, docExt)
  }

  if (mimeType.startsWith('audio/')) return null
  if (mimeType.startsWith('video/')) return null

  return null
}

/**
 * Text-only models never receive image bytes (their APIs hard-reject image
 * parts), but the upload is accepted like any other file: instead of a
 * base64 block the model gets this note naming the file on disk, so it can
 * still operate on it with tools — and knows to tell the user it can't see
 * the pixels. Mirrors the <video_instructions> pattern in
 * compose-attachments.ts.
 */
function imageAsTextNote(absPath: string, originalName: string): ProcessedAttachment {
  return {
    originalName,
    fileType: 'image',
    blocks: [
      {
        type: 'text',
        text: `[Image attached: ${originalName} — saved at ${absPath}]\nThe active model is text-only and cannot view this image, but the file is on disk and fully workable. Use your shell tool to inspect or operate on it: metadata via ffprobe/exiftool/sips, conversions/resizes/crops via ffmpeg, plus any move/copy/rename or other file operations the user asks for. Let the user know you can't see the image's content but can still work on the file.`
      }
    ]
  }
}

async function processImage(
  absPath: string,
  _mimeType: string,
  originalName: string
): Promise<ProcessedAttachment> {
  const sharp = (await import('sharp')).default
  const resized = await sharp(absPath)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: false })
    .jpeg({ quality: 75 })
    .toBuffer()

  const data = resized.toString('base64')

  return {
    originalName,
    fileType: 'image',
    blocks: [{ type: 'image', mediaType: 'image/jpeg', data }]
  }
}

/**
 * PDFs follow two paths depending on the active model's capability:
 * - Native ingestion (cloud providers): pass the raw bytes as a base64
 *   document block. The model handles layout, tables, embedded images
 *   natively; we don't pre-flatten anything. Oversized PDFs come back as
 *   an API error the user sees in the chat — that's strictly better than
 *   silently degrading the file to flat extracted text.
 * - pdfAsText (local/Ollama): no native PDF support, so we extract text
 *   with pdf-parse. This is the only place pdf-parse runs.
 */
async function processPdf(
  absPath: string,
  originalName: string,
  options: FileProcessorOptions
): Promise<ProcessedAttachment> {
  const raw = await fs.readFile(absPath)

  if (options.pdfAsText) {
    const text = await extractPdfText(raw)
    return {
      originalName,
      fileType: 'pdf',
      blocks: [{ type: 'text', text: `[PDF: ${originalName}]\n${text}` }]
    }
  }

  const data = raw.toString('base64')
  return {
    originalName,
    fileType: 'pdf',
    blocks: [{ type: 'document', mediaType: 'application/pdf', data }]
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    const result = await parser.getText()
    return result.text || '(no text extracted)'
  } catch {
    return '(PDF text extraction failed)'
  }
}

async function processDocument(
  absPath: string,
  originalName: string,
  ext: string
): Promise<ProcessedAttachment> {
  let text: string

  switch (ext) {
    case '.docx':
      text = await extractDocx(absPath)
      break
    case '.xlsx':
    case '.xls':
      text = await extractSpreadsheet(absPath)
      break
    // Plain-text formats (incl. HTML) are inlined as their raw source — HTML is
    // just text, so every model (vision or not) gets the full markup.
    case '.html':
    case '.htm':
    case '.csv':
    case '.tsv':
    case '.txt':
    case '.md':
    case '.json':
      text = await fs.readFile(absPath, 'utf-8')
      break
    case '.pptx':
      text = await extractPptx(absPath)
      break
    default:
      text = await fs.readFile(absPath, 'utf-8')
  }

  return {
    originalName,
    fileType: 'document',
    blocks: [{ type: 'text', text: `[File: ${originalName}]\n${text}` }]
  }
}

async function extractDocx(absPath: string): Promise<string> {
  try {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ path: absPath })
    return result.value || '(no text extracted)'
  } catch {
    return '(DOCX text extraction failed)'
  }
}

async function extractSpreadsheet(absPath: string): Promise<string> {
  try {
    const XLSX = await import('xlsx')
    const workbook = XLSX.readFile(absPath)
    const sheets: string[] = []
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name]
      const csv = XLSX.utils.sheet_to_csv(sheet)
      sheets.push(`--- Sheet: ${name} ---\n${csv}`)
    }
    return sheets.join('\n\n') || '(no data extracted)'
  } catch {
    return '(spreadsheet extraction failed)'
  }
}

/**
 * PPTX is a ZIP containing per-slide XML at ppt/slides/slide{N}.xml.
 * Each text run lives inside an `<a:t>` element. We unzip with jszip
 * (already a transitive dep through mammoth), enumerate slide XMLs in
 * numeric order, and concatenate the inner text. No PPTX-specific lib
 * needed — the format is stable and the XML is small.
 */
async function extractPptx(absPath: string): Promise<string> {
  try {
    const raw = await fs.readFile(absPath)
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(raw)
    const slideEntries: Array<{ index: number; path: string }> = []
    for (const [filePath] of Object.entries(zip.files)) {
      const match = filePath.match(/^ppt\/slides\/slide(\d+)\.xml$/)
      if (match) slideEntries.push({ index: parseInt(match[1], 10), path: filePath })
    }
    slideEntries.sort((a, b) => a.index - b.index)
    if (slideEntries.length === 0) return '(no slides found in PPTX)'

    const slides: string[] = []
    for (const { index, path: slidePath } of slideEntries) {
      const file = zip.file(slidePath)
      if (!file) continue
      const xml = await file.async('string')
      const parts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) =>
        decodeXmlEntities(m[1])
      )
      const slideText = parts.join(' ').trim()
      if (slideText) slides.push(`--- Slide ${index} ---\n${slideText}`)
    }
    return slides.length > 0 ? slides.join('\n\n') : '(no text in PPTX slides)'
  } catch {
    return '(PPTX text extraction failed)'
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export type MessageAttachmentInput = {
  type: string
  filePath: string
  originalName: string
  mimeType: string
  sizeBytes: number
}

// Processed-attachment cache: processHistoryAttachments re-runs for EVERY
// user message with attachments on EVERY turn — without this, each turn
// re-reads, re-resizes (sharp), and re-base64s every historical image/PDF
// from scratch (measured: a 500KB jpeg re-encoded per turn, a 371KB PDF
// re-base64'd to 495k chars per turn). Keyed on (path, mtime, options) so a
// changed file re-processes; bounded LRU so blobs don't accumulate.
const PROCESSED_CACHE_MAX = 60
const processedCache = new Map<string, ContentBlock[]>()

async function processAttachmentCached(
  att: MessageAttachmentInput,
  options: FileProcessorOptions
): Promise<ContentBlock[]> {
  let mtimeMs = 0
  const abs = resolveUploadPath(att.filePath)
  if (abs) {
    try {
      mtimeMs = Math.floor((await fs.stat(abs)).mtimeMs)
    } catch {
      mtimeMs = 0
    }
  }
  const key = `${att.filePath}|${mtimeMs}|${options.pdfAsText ? 1 : 0}|${options.supportsVision ? 1 : 0}`
  const hit = processedCache.get(key)
  if (hit) {
    // refresh LRU position
    processedCache.delete(key)
    processedCache.set(key, hit)
    return hit
  }
  const result = await processAttachment(att.filePath, att.mimeType, att.originalName, options)
  const blocks = result?.blocks ?? []
  processedCache.set(key, blocks)
  if (processedCache.size > PROCESSED_CACHE_MAX) {
    const oldest = processedCache.keys().next().value
    if (oldest !== undefined) processedCache.delete(oldest)
  }
  return blocks
}

export async function processAttachments(
  attachments: MessageAttachmentInput[],
  options: FileProcessorOptions
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = []

  for (const att of attachments) {
    blocks.push(...(await processAttachmentCached(att, options)))
  }

  return blocks
}
