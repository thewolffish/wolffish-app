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
  provider: 'anthropic' | 'openai' | 'deepseek' | 'mimo' | 'kimi' | 'local'
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
  '.pptx'
])

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
    if (!options.supportsVision) return null
    return processImage(abs, mimeType, originalName)
  }

  if (mimeType === 'application/pdf') {
    return processPdf(abs, originalName, options)
  }

  if (DOCUMENT_EXTS.has(ext)) {
    return processDocument(abs, originalName, ext)
  }

  // Audio: no code preprocessing. The renderer's <attachments> block
  // already exposes filename, mime, size, and absolute path to the
  // model — that's enough for it to decide whether to invoke a
  // cerebellum tool (e.g. stt_transcribe_upload) or ask the user.
  // Returning null leaves the user message untouched: the file still
  // renders as an AudioPlayer in chat (driven by attachments state),
  // and the LLM still sees the metadata via the original text content.
  if (mimeType.startsWith('audio/')) return null

  return null
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
 * PDFs follow two paths depending on the active provider:
 * - Cloud (Anthropic/OpenAI): pass the raw bytes as a base64 document
 *   block. The model handles layout, tables, embedded images natively;
 *   we don't pre-flatten anything. Oversized PDFs come back as an API
 *   error the user sees in the chat — that's strictly better than
 *   silently degrading the file to flat extracted text.
 * - Local (Ollama): no native PDF support, so we extract text with
 *   pdf-parse. This is the only place pdf-parse runs.
 */
async function processPdf(
  absPath: string,
  originalName: string,
  options: FileProcessorOptions
): Promise<ProcessedAttachment> {
  const raw = await fs.readFile(absPath)

  if (options.provider === 'local') {
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

export async function processAttachments(
  attachments: MessageAttachmentInput[],
  options: FileProcessorOptions
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = []

  for (const att of attachments) {
    const result = await processAttachment(att.filePath, att.mimeType, att.originalName, options)
    if (result) {
      blocks.push(...result.blocks)
    }
  }

  return blocks
}
