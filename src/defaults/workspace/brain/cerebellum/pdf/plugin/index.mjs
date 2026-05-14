import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { PDFDocument, StandardFonts, rgb, degrees, PageSizes } from 'pdf-lib'

const MAX_FILE_SIZE = 100 * 1024 * 1024

const toolDefinitions = [
  {
    name: 'pdf_read',
    description: 'Extract text, metadata, page count, and structure from a PDF file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the PDF file' },
        pages: { type: 'string', description: 'Optional page range like "1-3,5,8-10"' }
      },
      required: ['path']
    }
  },
  {
    name: 'pdf_create',
    description: 'Create a new PDF with text, headings, images, tables, page numbers.',
    parameters: {
      type: 'object',
      properties: {
        output_path: { type: 'string', description: 'Absolute path for the output PDF' },
        content: { type: 'string', description: 'JSON array of content blocks' },
        options: { type: 'string', description: 'Optional JSON page options' }
      },
      required: ['output_path', 'content']
    }
  },
  {
    name: 'pdf_merge',
    description: 'Merge multiple PDF files into a single PDF.',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'string', description: 'JSON array of PDF paths' },
        output_path: { type: 'string', description: 'Absolute path for the merged PDF' },
        page_ranges: { type: 'string', description: 'Optional JSON array of page ranges per file' }
      },
      required: ['paths', 'output_path']
    }
  },
  {
    name: 'pdf_split',
    description: 'Split a PDF into multiple files by page ranges.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the source PDF' },
        ranges: { type: 'string', description: 'JSON array of page ranges' },
        output_dir: { type: 'string', description: 'Absolute path to output directory' }
      },
      required: ['path', 'ranges', 'output_dir']
    }
  },
  {
    name: 'pdf_modify',
    description: 'Add watermark, headers, footers, or page numbers to a PDF.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the source PDF' },
        output_path: { type: 'string', description: 'Absolute path for the output PDF' },
        modifications: { type: 'string', description: 'JSON object with modifications' }
      },
      required: ['path', 'output_path', 'modifications']
    }
  },
  {
    name: 'pdf_form',
    description: 'Read or fill form fields in a PDF.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the PDF' },
        action: { type: 'string', enum: ['read', 'fill'] },
        output_path: { type: 'string', description: 'Output path (required for fill)' },
        fields: { type: 'string', description: 'JSON object of field name->value pairs' }
      },
      required: ['path', 'action']
    }
  },
  {
    name: 'pdf_secure',
    description: 'Encrypt or decrypt a PDF with a password.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the source PDF' },
        output_path: { type: 'string', description: 'Absolute path for the output PDF' },
        action: { type: 'string', enum: ['encrypt', 'decrypt'] },
        password: { type: 'string', description: 'Password' },
        permissions: { type: 'string', description: 'Optional JSON array of permissions' }
      },
      required: ['path', 'output_path', 'action', 'password']
    }
  },
  {
    name: 'pdf_extract_images',
    description: 'Extract embedded images from a PDF.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the PDF' },
        output_dir: { type: 'string', description: 'Directory to save extracted images' },
        format: { type: 'string', enum: ['png', 'jpg'] }
      },
      required: ['path', 'output_dir']
    }
  },
  {
    name: 'pdf_compress',
    description: 'Reduce PDF file size by removing unused objects.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the source PDF' },
        output_path: { type: 'string', description: 'Absolute path for the compressed PDF' },
        quality: { type: 'string', enum: ['low', 'medium', 'high'] }
      },
      required: ['path', 'output_path']
    }
  }
]

function resolvePath(input) {
  if (!input || typeof input !== 'string') throw new Error('path is required')
  if (input === '~') return os.homedir()
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2))
  }
  return path.resolve(input)
}

function parsePageRanges(rangeStr, totalPages) {
  if (!rangeStr) return Array.from({ length: totalPages }, (_, i) => i)
  const indices = []
  const parts = rangeStr.split(',').map((s) => s.trim())
  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-')
      const start = Math.max(1, parseInt(startStr, 10)) - 1
      const end = Math.min(totalPages, parseInt(endStr, 10)) - 1
      for (let i = start; i <= end; i++) indices.push(i)
    } else {
      const idx = parseInt(part, 10) - 1
      if (idx >= 0 && idx < totalPages) indices.push(idx)
    }
  }
  return indices
}

async function checkFileSize(filePath) {
  const stat = await fs.stat(filePath)
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`File exceeds 100MB limit (${(stat.size / 1024 / 1024).toFixed(1)}MB)`)
  }
  return stat.size
}

function getPageSize(name) {
  const sizes = {
    A4: PageSizes.A4,
    Letter: PageSizes.Letter,
    Legal: PageSizes.Legal
  }
  return sizes[name] || PageSizes.A4
}

function parseColor(colorStr) {
  if (!colorStr) return rgb(0, 0, 0)
  if (colorStr.startsWith('#') && colorStr.length === 7) {
    const r = parseInt(colorStr.slice(1, 3), 16) / 255
    const g = parseInt(colorStr.slice(3, 5), 16) / 255
    const b = parseInt(colorStr.slice(5, 7), 16) / 255
    return rgb(r, g, b)
  }
  const named = { red: rgb(1, 0, 0), blue: rgb(0, 0, 1), green: rgb(0, 0.5, 0), gray: rgb(0.5, 0.5, 0.5), grey: rgb(0.5, 0.5, 0.5) }
  return named[colorStr.toLowerCase()] || rgb(0, 0, 0)
}

async function pdfRead(args) {
  const filePath = resolvePath(args.path)
  try {
    await checkFileSize(filePath)
  } catch (err) {
    return { success: false, error: err.message }
  }

  let buffer
  try {
    buffer = await fs.readFile(filePath)
  } catch (err) {
    if (err.code === 'ENOENT') return { success: false, error: `File not found: ${filePath}` }
    if (err.code === 'EBUSY' || err.code === 'EPERM') return { success: false, error: 'File is open in another application' }
    return { success: false, error: err.message }
  }

  try {
    const { PDFParse } = await import('pdf-parse')
    const uint8 = new Uint8Array(buffer)
    const parser = new PDFParse(uint8)
    await parser.load()

    const totalPages = parser.doc?.numPages || 0
    const pageIndices = parsePageRanges(args.pages, totalPages)
    const requestedSet = new Set(pageIndices.map((i) => i + 1))

    let fullText = ''
    const pageTexts = []
    for (let i = 1; i <= totalPages; i++) {
      const page = await parser.doc.getPage(i)
      const content = await page.getTextContent()
      const pageText = content.items.map((item) => item.str).join(' ')
      if (!args.pages || requestedSet.has(i)) {
        pageTexts.push({ page: i, text: pageText })
        fullText += `--- Page ${i} ---\n${pageText}\n`
      }
    }

    const info = parser.getInfo() || {}
    const result = {
      pages: totalPages,
      metadata: {
        title: info.Title || null,
        author: info.Author || null,
        subject: info.Subject || null,
        creator: info.Creator || null,
        producer: info.Producer || null
      },
      text: fullText,
      requestedPages: args.pages || 'all',
      fileSize: buffer.length
    }

    return { success: true, output: JSON.stringify(result, null, 2) }
  } catch (err) {
    return { success: false, error: `Failed to parse PDF: ${err.message}` }
  }
}

async function pdfCreate(args) {
  const outputPath = resolvePath(args.output_path)
  let content, options
  try {
    content = JSON.parse(args.content)
  } catch {
    return { success: false, error: 'Invalid JSON in content parameter' }
  }
  try {
    options = args.options ? JSON.parse(args.options) : {}
  } catch {
    return { success: false, error: 'Invalid JSON in options parameter' }
  }

  try {
    const pdfDoc = await PDFDocument.create()
    const pageSize = getPageSize(options.page_size || 'A4')
    const isLandscape = options.orientation === 'landscape'
    const [baseW, baseH] = pageSize
    const [pageW, pageH] = isLandscape ? [baseH, baseW] : [baseW, baseH]
    const margins = options.margins || { top: 72, bottom: 72, left: 72, right: 72 }
    const fontSize = options.font_size || 12
    const lineHeight = options.line_height || 1.5

    let font
    if (options.font_path) {
      try {
        const fontBytes = await fs.readFile(resolvePath(options.font_path))
        font = await pdfDoc.embedFont(fontBytes)
      } catch {
        font = await pdfDoc.embedFont(StandardFonts.Helvetica)
      }
    } else {
      font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    }
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    let currentPage = pdfDoc.addPage([pageW, pageH])
    let yPos = pageH - margins.top
    const contentWidth = pageW - margins.left - margins.right

    function ensureSpace(needed) {
      if (yPos - needed < margins.bottom) {
        currentPage = pdfDoc.addPage([pageW, pageH])
        yPos = pageH - margins.top
      }
    }

    function drawWrappedText(text, textFont, textSize, x, maxWidth, options = {}) {
      const words = text.split(' ')
      let line = ''
      const lines = []
      for (const word of words) {
        const testLine = line ? `${line} ${word}` : word
        const width = textFont.widthOfTextAtSize(testLine, textSize)
        if (width > maxWidth && line) {
          lines.push(line)
          line = word
        } else {
          line = testLine
        }
      }
      if (line) lines.push(line)

      for (const l of lines) {
        const lHeight = textSize * lineHeight
        ensureSpace(lHeight)
        let drawX = x
        if (options.alignment === 'center') {
          const lWidth = textFont.widthOfTextAtSize(l, textSize)
          drawX = x + (maxWidth - lWidth) / 2
        } else if (options.alignment === 'right') {
          const lWidth = textFont.widthOfTextAtSize(l, textSize)
          drawX = x + maxWidth - lWidth
        }
        currentPage.drawText(l, {
          x: drawX,
          y: yPos,
          size: textSize,
          font: textFont,
          color: options.color || rgb(0, 0, 0)
        })
        yPos -= lHeight
      }
    }

    for (const block of content) {
      switch (block.type) {
        case 'heading': {
          const level = block.level || 1
          const headingSizes = { 1: 24, 2: 20, 3: 16 }
          const hSize = headingSizes[level] || 14
          const spacing = hSize * 0.8
          ensureSpace(hSize + spacing)
          yPos -= spacing / 2
          drawWrappedText(block.text || '', boldFont, hSize, margins.left, contentWidth, { alignment: block.alignment })
          yPos -= spacing / 2
          break
        }
        case 'paragraph': {
          const pSize = block.fontSize || fontSize
          const pFont = block.bold ? boldFont : font
          drawWrappedText(block.text || '', pFont, pSize, margins.left, contentWidth, { alignment: block.alignment })
          yPos -= pSize * 0.5
          break
        }
        case 'image': {
          if (block.path) {
            try {
              const imgPath = resolvePath(block.path)
              const imgBytes = await fs.readFile(imgPath)
              let image
              const ext = path.extname(imgPath).toLowerCase()
              if (ext === '.png') {
                image = await pdfDoc.embedPng(imgBytes)
              } else {
                image = await pdfDoc.embedJpg(imgBytes)
              }
              const imgWidth = block.width || Math.min(image.width, contentWidth)
              const scale = imgWidth / image.width
              const imgHeight = block.height || image.height * scale
              ensureSpace(imgHeight)
              currentPage.drawImage(image, {
                x: margins.left,
                y: yPos - imgHeight,
                width: imgWidth,
                height: imgHeight
              })
              yPos -= imgHeight + 10
            } catch (err) {
              drawWrappedText(`[Image error: ${err.message}]`, font, fontSize, margins.left, contentWidth)
            }
          }
          break
        }
        case 'table': {
          const headers = block.headers || []
          const rows = block.rows || []
          const colCount = headers.length || (rows[0] ? rows[0].length : 0)
          if (colCount === 0) break
          const colWidth = contentWidth / colCount
          const rowHeight = fontSize * 2
          const totalRows = (headers.length ? 1 : 0) + rows.length
          ensureSpace(rowHeight * Math.min(totalRows, 3))

          if (headers.length) {
            for (let i = 0; i < headers.length; i++) {
              currentPage.drawText(String(headers[i]).slice(0, 40), {
                x: margins.left + i * colWidth + 4,
                y: yPos - fontSize,
                size: fontSize,
                font: boldFont
              })
            }
            yPos -= rowHeight
          }
          for (const row of rows) {
            ensureSpace(rowHeight)
            for (let i = 0; i < Math.min(row.length, colCount); i++) {
              currentPage.drawText(String(row[i]).slice(0, 40), {
                x: margins.left + i * colWidth + 4,
                y: yPos - fontSize,
                size: fontSize,
                font
              })
            }
            yPos -= rowHeight
          }
          yPos -= 10
          break
        }
        case 'page_break': {
          currentPage = pdfDoc.addPage([pageW, pageH])
          yPos = pageH - margins.top
          break
        }
        case 'header': {
          const pages = pdfDoc.getPages()
          for (const pg of pages) {
            pg.drawText(block.text || '', {
              x: margins.left,
              y: pageH - 30,
              size: block.fontSize || 9,
              font,
              color: rgb(0.4, 0.4, 0.4)
            })
          }
          break
        }
        case 'footer': {
          const pages = pdfDoc.getPages()
          for (const pg of pages) {
            pg.drawText(block.text || '', {
              x: margins.left,
              y: 30,
              size: block.fontSize || 9,
              font,
              color: rgb(0.4, 0.4, 0.4)
            })
          }
          break
        }
      }
    }

    if (options.page_numbers) {
      const pages = pdfDoc.getPages()
      const total = pages.length
      for (let i = 0; i < total; i++) {
        const pg = pages[i]
        const format = (options.page_numbers.format || 'Page {n} of {total}')
          .replace('{n}', String(i + 1))
          .replace('{total}', String(total))
        const numFont = font
        const numSize = options.page_numbers.fontSize || 9
        const textWidth = numFont.widthOfTextAtSize(format, numSize)
        let x = pageW / 2 - textWidth / 2
        if (options.page_numbers.position === 'bottom-right') {
          x = pageW - margins.right - textWidth
        }
        pg.drawText(format, { x, y: 20, size: numSize, font: numFont, color: rgb(0.4, 0.4, 0.4) })
      }
    }

    const pdfBytes = await pdfDoc.save()
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, pdfBytes)

    return {
      success: true,
      output: JSON.stringify({
        path: outputPath,
        pages: pdfDoc.getPageCount(),
        size: pdfBytes.length
      })
    }
  } catch (err) {
    return { success: false, error: `Failed to create PDF: ${err.message}` }
  }
}

async function pdfMerge(args) {
  let paths, pageRanges
  try {
    paths = JSON.parse(args.paths)
  } catch {
    return { success: false, error: 'Invalid JSON in paths parameter' }
  }
  try {
    pageRanges = args.page_ranges ? JSON.parse(args.page_ranges) : null
  } catch {
    return { success: false, error: 'Invalid JSON in page_ranges parameter' }
  }

  const outputPath = resolvePath(args.output_path)
  const tempFiles = []

  try {
    const mergedDoc = await PDFDocument.create()

    for (let i = 0; i < paths.length; i++) {
      const filePath = resolvePath(paths[i])
      await checkFileSize(filePath)
      const bytes = await fs.readFile(filePath)
      const srcDoc = await PDFDocument.load(bytes)
      const totalPages = srcDoc.getPageCount()
      const rangeStr = pageRanges ? pageRanges[i] || '' : ''
      const indices = rangeStr ? parsePageRanges(rangeStr, totalPages) : Array.from({ length: totalPages }, (_, j) => j)
      const copiedPages = await mergedDoc.copyPages(srcDoc, indices)
      for (const page of copiedPages) {
        mergedDoc.addPage(page)
      }
    }

    const mergedBytes = await mergedDoc.save()
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, mergedBytes)

    return {
      success: true,
      output: JSON.stringify({
        path: outputPath,
        pages: mergedDoc.getPageCount(),
        size: mergedBytes.length,
        sources: paths.length
      })
    }
  } catch (err) {
    return { success: false, error: `Failed to merge PDFs: ${err.message}` }
  } finally {
    for (const f of tempFiles) {
      try { await fs.unlink(f) } catch {}
    }
  }
}

async function pdfSplit(args) {
  const filePath = resolvePath(args.path)
  const outputDir = resolvePath(args.output_dir)
  let ranges
  try {
    ranges = JSON.parse(args.ranges)
  } catch {
    return { success: false, error: 'Invalid JSON in ranges parameter' }
  }

  try {
    await checkFileSize(filePath)
    const bytes = await fs.readFile(filePath)
    const srcDoc = await PDFDocument.load(bytes)
    const totalPages = srcDoc.getPageCount()
    await fs.mkdir(outputDir, { recursive: true })

    const outputs = []
    for (let i = 0; i < ranges.length; i++) {
      const indices = parsePageRanges(ranges[i], totalPages)
      const newDoc = await PDFDocument.create()
      const copiedPages = await newDoc.copyPages(srcDoc, indices)
      for (const page of copiedPages) {
        newDoc.addPage(page)
      }
      const newBytes = await newDoc.save()
      const baseName = path.basename(filePath, '.pdf')
      const outPath = path.join(outputDir, `${baseName}_part${i + 1}.pdf`)
      await fs.writeFile(outPath, newBytes)
      outputs.push({ path: outPath, pages: newDoc.getPageCount(), size: newBytes.length })
    }

    return {
      success: true,
      output: JSON.stringify({ files: outputs, totalParts: outputs.length })
    }
  } catch (err) {
    return { success: false, error: `Failed to split PDF: ${err.message}` }
  }
}

async function pdfModify(args) {
  const filePath = resolvePath(args.path)
  const outputPath = resolvePath(args.output_path)
  let modifications
  try {
    modifications = JSON.parse(args.modifications)
  } catch {
    return { success: false, error: 'Invalid JSON in modifications parameter' }
  }

  try {
    await checkFileSize(filePath)
    const bytes = await fs.readFile(filePath)
    const pdfDoc = await PDFDocument.load(bytes)
    const pages = pdfDoc.getPages()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

    if (modifications.watermark) {
      const wm = modifications.watermark
      const wmText = wm.text || 'WATERMARK'
      const wmSize = wm.fontSize || 60
      const wmOpacity = wm.opacity ?? 0.3
      const wmRotation = wm.rotation ?? 45
      const wmColor = parseColor(wm.color)

      for (const page of pages) {
        const { width, height } = page.getSize()
        const textWidth = font.widthOfTextAtSize(wmText, wmSize)
        page.drawText(wmText, {
          x: width / 2 - textWidth / 2,
          y: height / 2,
          size: wmSize,
          font,
          color: wmColor,
          opacity: wmOpacity,
          rotate: degrees(wmRotation)
        })
      }
    }

    if (modifications.header) {
      const h = modifications.header
      for (const page of pages) {
        const { height } = page.getSize()
        page.drawText(h.text || '', {
          x: 72,
          y: height - 30,
          size: h.fontSize || 9,
          font,
          color: rgb(0.3, 0.3, 0.3)
        })
      }
    }

    if (modifications.footer) {
      const f = modifications.footer
      for (const page of pages) {
        page.drawText(f.text || '', {
          x: 72,
          y: 30,
          size: f.fontSize || 9,
          font,
          color: rgb(0.3, 0.3, 0.3)
        })
      }
    }

    if (modifications.page_numbers) {
      const pn = modifications.page_numbers
      const total = pages.length
      for (let i = 0; i < total; i++) {
        const page = pages[i]
        const { width } = page.getSize()
        const format = (pn.format || 'Page {n} of {total}')
          .replace('{n}', String(i + 1))
          .replace('{total}', String(total))
        const numSize = pn.fontSize || 9
        const textWidth = font.widthOfTextAtSize(format, numSize)
        let x = width / 2 - textWidth / 2
        if (pn.position === 'bottom-right') {
          x = width - 72 - textWidth
        }
        page.drawText(format, { x, y: 20, size: numSize, font, color: rgb(0.3, 0.3, 0.3) })
      }
    }

    const modifiedBytes = await pdfDoc.save()
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, modifiedBytes)

    return {
      success: true,
      output: JSON.stringify({
        path: outputPath,
        pages: pages.length,
        size: modifiedBytes.length,
        applied: Object.keys(modifications)
      })
    }
  } catch (err) {
    return { success: false, error: `Failed to modify PDF: ${err.message}` }
  }
}

async function pdfForm(args) {
  const filePath = resolvePath(args.path)

  try {
    await checkFileSize(filePath)
    const bytes = await fs.readFile(filePath)
    const pdfDoc = await PDFDocument.load(bytes)
    const form = pdfDoc.getForm()

    if (args.action === 'read') {
      const fields = form.getFields()
      const fieldData = fields.map((field) => {
        const name = field.getName()
        const type = field.constructor.name
        let value = null
        try {
          if (field.getText) value = field.getText()
          else if (field.isChecked) value = field.isChecked()
          else if (field.getSelected) value = field.getSelected()
        } catch {}
        return { name, type, value }
      })
      return { success: true, output: JSON.stringify({ fields: fieldData, count: fieldData.length }) }
    }

    if (args.action === 'fill') {
      if (!args.output_path) return { success: false, error: 'output_path required for fill action' }
      if (!args.fields) return { success: false, error: 'fields required for fill action' }

      let fields
      try {
        fields = JSON.parse(args.fields)
      } catch {
        return { success: false, error: 'Invalid JSON in fields parameter' }
      }

      for (const [name, value] of Object.entries(fields)) {
        try {
          const field = form.getTextField(name)
          field.setText(String(value))
        } catch {
          try {
            const field = form.getCheckBox(name)
            if (value) field.check()
            else field.uncheck()
          } catch {
            try {
              const field = form.getDropdown(name)
              field.select(String(value))
            } catch {}
          }
        }
      }

      const outputPath = resolvePath(args.output_path)
      const filledBytes = await pdfDoc.save()
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, filledBytes)

      return {
        success: true,
        output: JSON.stringify({ path: outputPath, filledFields: Object.keys(fields).length })
      }
    }

    return { success: false, error: `Unknown action: ${args.action}` }
  } catch (err) {
    return { success: false, error: `Form operation failed: ${err.message}` }
  }
}

async function pdfSecure(args) {
  const filePath = resolvePath(args.path)
  const outputPath = resolvePath(args.output_path)

  try {
    await checkFileSize(filePath)
    const bytes = await fs.readFile(filePath)

    if (args.action === 'encrypt') {
      const pdfDoc = await PDFDocument.load(bytes)
      const encryptedBytes = await pdfDoc.save({
        userPassword: args.password,
        ownerPassword: args.password
      })
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, encryptedBytes)
      return {
        success: true,
        output: JSON.stringify({ path: outputPath, action: 'encrypted', size: encryptedBytes.length })
      }
    }

    if (args.action === 'decrypt') {
      const pdfDoc = await PDFDocument.load(bytes, { password: args.password })
      const decryptedBytes = await pdfDoc.save()
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, decryptedBytes)
      return {
        success: true,
        output: JSON.stringify({ path: outputPath, action: 'decrypted', size: decryptedBytes.length })
      }
    }

    return { success: false, error: `Unknown action: ${args.action}` }
  } catch (err) {
    if (err.message.includes('password')) {
      return { success: false, error: 'Incorrect password or password-protected PDF' }
    }
    return { success: false, error: `Security operation failed: ${err.message}` }
  }
}

async function pdfExtractImages(args) {
  const filePath = resolvePath(args.path)
  const outputDir = resolvePath(args.output_dir)
  const format = args.format || 'png'

  try {
    await checkFileSize(filePath)
    const bytes = await fs.readFile(filePath)
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    await fs.mkdir(outputDir, { recursive: true })

    const extracted = []
    const pages = pdfDoc.getPages()

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const page = pages[pageIdx]
      const xObjects = page.node.Resources()?.lookup(page.node.Resources().get('XObject')?.constructor?.name === 'PDFName' ? undefined : undefined)

      // pdf-lib doesn't have a direct image extraction API.
      // We'll attempt to find embedded images via the document's indirect objects.
    }

    // Fallback: iterate through all objects in the PDF looking for image streams
    const enumeratedObjects = pdfDoc.context.enumerateIndirectObjects()
    let imgCount = 0

    for (const [ref, obj] of enumeratedObjects) {
      if (obj?.constructor?.name === 'PDFRawStream' || obj?.constructor?.name === 'PDFStream') {
        try {
          const dict = obj.dict
          if (!dict) continue
          const subtype = dict.get(dict.context?.obj('Subtype') || Symbol())
          const subtypeStr = subtype?.toString?.() || ''
          if (!subtypeStr.includes('Image')) continue

          const contents = obj.contents || obj.getContents?.()
          if (!contents || contents.length === 0) continue

          imgCount++
          const ext = format === 'jpg' ? 'jpg' : 'png'
          const outPath = path.join(outputDir, `image_${imgCount}.${ext}`)
          await fs.writeFile(outPath, contents)
          extracted.push({ path: outPath, size: contents.length })
        } catch {}
      }
    }

    return {
      success: true,
      output: JSON.stringify({
        outputDir,
        imagesFound: extracted.length,
        images: extracted
      })
    }
  } catch (err) {
    return { success: false, error: `Image extraction failed: ${err.message}` }
  }
}

async function pdfCompress(args) {
  const filePath = resolvePath(args.path)
  const outputPath = resolvePath(args.output_path)

  try {
    const originalSize = await checkFileSize(filePath)
    const bytes = await fs.readFile(filePath)
    const pdfDoc = await PDFDocument.load(bytes)

    // pdf-lib's save() with certain options can reduce size:
    // - useObjectStreams compresses internal structure
    // - We remove metadata for more aggressive compression
    const saveOptions = { useObjectStreams: true }

    if (args.quality === 'low') {
      // Most aggressive: strip metadata
      pdfDoc.setTitle('')
      pdfDoc.setAuthor('')
      pdfDoc.setSubject('')
      pdfDoc.setKeywords([])
      pdfDoc.setProducer('')
      pdfDoc.setCreator('')
    }

    const compressedBytes = await pdfDoc.save(saveOptions)
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, compressedBytes)

    const savings = ((1 - compressedBytes.length / originalSize) * 100).toFixed(1)

    return {
      success: true,
      output: JSON.stringify({
        path: outputPath,
        originalSize,
        compressedSize: compressedBytes.length,
        savings: `${savings}%`
      })
    }
  } catch (err) {
    return { success: false, error: `Compression failed: ${err.message}` }
  }
}

function describeAction(toolName, args) {
  const targetPath = String(args?.path || args?.output_path || '')
  const basename = path.basename(targetPath)
  switch (toolName) {
    case 'pdf_read':
      return { title: 'Read PDF', description: `Extract text from ${basename}`, risk: 'low' }
    case 'pdf_create':
      return { title: 'Create PDF', description: `Create ${basename}`, command: targetPath, risk: 'medium' }
    case 'pdf_merge':
      return { title: 'Merge PDFs', description: `Merge PDFs into ${basename}`, command: targetPath, risk: 'medium' }
    case 'pdf_split':
      return { title: 'Split PDF', description: `Split ${basename} into parts`, risk: 'medium' }
    case 'pdf_modify':
      return { title: 'Modify PDF', description: `Add modifications to ${basename}`, command: targetPath, risk: 'medium' }
    case 'pdf_form':
      return { title: args?.action === 'read' ? 'Read Form' : 'Fill Form', description: `${args?.action === 'read' ? 'Read' : 'Fill'} form in ${basename}`, risk: args?.action === 'read' ? 'low' : 'medium' }
    case 'pdf_secure':
      return { title: `${args?.action === 'encrypt' ? 'Encrypt' : 'Decrypt'} PDF`, description: `${args?.action} ${basename}`, command: targetPath, risk: 'medium' }
    case 'pdf_extract_images':
      return { title: 'Extract Images', description: `Extract images from ${basename}`, risk: 'low' }
    case 'pdf_compress':
      return { title: 'Compress PDF', description: `Compress ${basename}`, command: targetPath, risk: 'medium' }
    default:
      return null
  }
}

const plugin = {
  name: 'pdf',
  tools: toolDefinitions,
  describeAction,
  async execute(toolName, args) {
    switch (toolName) {
      case 'pdf_read': return pdfRead(args)
      case 'pdf_create': return pdfCreate(args)
      case 'pdf_merge': return pdfMerge(args)
      case 'pdf_split': return pdfSplit(args)
      case 'pdf_modify': return pdfModify(args)
      case 'pdf_form': return pdfForm(args)
      case 'pdf_secure': return pdfSecure(args)
      case 'pdf_extract_images': return pdfExtractImages(args)
      case 'pdf_compress': return pdfCompress(args)
      default: return { success: false, error: `pdf: unknown tool ${toolName}` }
    }
  }
}

export default plugin
