---
name: pdf
description: Read, create, modify, merge, split, secure, and compress PDF documents
triggers:
  - pdf
  - document
  - merge pdf
  - split pdf
  - combine pdf
  - watermark
  - form fill
  - extract text
  - encrypt pdf
  - compress pdf
  - pdf password
  - read pdf
  - create pdf
  - acrobat
  - portable document
  - scan
  - ocr
  - convert to pdf
  - save as pdf
  - print to pdf
  - sign pdf
  - annotate
  - bookmark
  - page
  - rotate
  - crop
  - stamp
  - redact
  - flatten
  - optimize
  - reduce size
  - invoice
  - receipt
  - contract
  - certificate
  - form
  - fillable
  - digital signature
  - e-sign
  - esign
  - pdf viewer
  - open pdf
  - view pdf
  - print pdf
  - export pdf
  - pdf report
  - pdf invoice
  - scan to pdf
  - photo to pdf
  - image to pdf
  - html to pdf
  - word to pdf
  - excel to pdf
  - ppt to pdf
  - extract pages
  - delete pages
  - rearrange pages
  - page range
  - odd pages
  - even pages
  - metadata
  - author
  - title
  - subject
  - keywords
  - permissions
  - copy protection
  - print protection
  - read only
  - accessibility
  - tagged pdf
tools:
  - name: pdf_read
    description: Extract text, metadata, page count, and structure from a PDF file. Optionally restrict to specific pages.
    parameters:
      path:
        type: string
        description: Absolute path to the PDF file
      pages:
        type: string
        description: 'Optional page range like "1-3,5,8-10". Omit to read all pages.'
        required: false
  - name: pdf_create
    description: Create a new PDF from scratch with text, headings, images, tables, page numbers, headers/footers. Supports RTL text for Arabic when a font path is provided.
    parameters:
      output_path:
        type: string
        description: Absolute path for the output PDF
      content:
        type: string
        description: 'JSON array of content blocks. Each block has a "type" field: heading, paragraph, image, table, page_break, header, footer. Example: [{"type":"heading","text":"Title","level":1},{"type":"paragraph","text":"Body text."}]'
      options:
        type: string
        description: 'Optional JSON object with page options: page_size (A4/Letter/Legal), orientation (portrait/landscape), margins {top,bottom,left,right}, font_path for custom/RTL fonts, font_size, line_height'
        required: false
  - name: pdf_merge
    description: Merge multiple PDF files into a single PDF.
    parameters:
      paths:
        type: string
        description: 'JSON array of absolute paths to PDF files to merge'
      output_path:
        type: string
        description: Absolute path for the merged output PDF
      page_ranges:
        type: string
        description: 'Optional JSON array of page ranges (one per input file), e.g. ["1-3","","2-5"]. Empty string means all pages.'
        required: false
  - name: pdf_split
    description: Split a PDF into multiple files by page ranges.
    parameters:
      path:
        type: string
        description: Absolute path to the source PDF
      ranges:
        type: string
        description: 'JSON array of page ranges, e.g. ["1-5","6-10","11-15"]. Each range produces a separate output file.'
      output_dir:
        type: string
        description: Absolute path to the output directory
  - name: pdf_modify
    description: Add watermark, headers, footers, page numbers, or stamps to an existing PDF.
    parameters:
      path:
        type: string
        description: Absolute path to the source PDF
      output_path:
        type: string
        description: Absolute path for the modified output PDF
      modifications:
        type: string
        description: 'JSON object with modification options: watermark {text, fontSize, opacity, rotation, color}, header {text, fontSize}, footer {text, fontSize}, page_numbers {position: "bottom-center"|"bottom-right", format: "Page {n} of {total}", fontSize}'
  - name: pdf_form
    description: Read form field names/values or fill form fields in a PDF.
    parameters:
      path:
        type: string
        description: Absolute path to the PDF with form fields
      action:
        type: string
        description: '"read" to list fields and values, "fill" to set field values'
        enum:
          - read
          - fill
      output_path:
        type: string
        description: Absolute path for the filled output PDF (required for fill action)
        required: false
      fields:
        type: string
        description: 'JSON object mapping field names to values (required for fill action)'
        required: false
  - name: pdf_secure
    description: Encrypt or decrypt a PDF with a password.
    parameters:
      path:
        type: string
        description: Absolute path to the source PDF
      output_path:
        type: string
        description: Absolute path for the secured output PDF
      action:
        type: string
        description: '"encrypt" to add password protection, "decrypt" to remove it'
        enum:
          - encrypt
          - decrypt
      password:
        type: string
        description: Password for encryption or decryption
      permissions:
        type: string
        description: 'Optional JSON array of allowed permissions when encrypting: ["printing","modify","copy","annotate"]'
        required: false
  - name: pdf_extract_images
    description: Extract all embedded images from a PDF and save them to a directory.
    parameters:
      path:
        type: string
        description: Absolute path to the source PDF
      output_dir:
        type: string
        description: Absolute path to the directory where images will be saved
      format:
        type: string
        description: Output image format
        enum:
          - png
          - jpg
        required: false
  - name: pdf_compress
    description: Reduce PDF file size by optimizing content and removing unused objects.
    parameters:
      path:
        type: string
        description: Absolute path to the source PDF
      output_path:
        type: string
        description: Absolute path for the compressed output PDF
      quality:
        type: string
        description: Compression quality level
        enum:
          - low
          - medium
          - high
        required: false
requires:
  - node
danger_patterns:
  - pattern: '/(System|Windows|Program Files)/'
    level: destructive
    reason: Writing to system directory
  - pattern: '/usr/(bin|lib|local)/'
    level: destructive
    reason: Writing to system directory
confirm_patterns:
  - pattern: 'pdf_(create|merge|split|modify|secure|compress|form)'
    reason: Writing a PDF file
---

# PDF

## Interface

- Tools: `pdf_read`, `pdf_create`, `pdf_merge`, `pdf_split`, `pdf_modify`, `pdf_form`, `pdf_secure`, `pdf_extract_images`, `pdf_compress`
- All paths must be absolute. Use `~` prefix for home directory.
- Complex parameters (arrays, objects) are passed as JSON strings.

## Rules

- Always verify the source file exists before operating on it.
- For `pdf_create`, content blocks support types: heading, paragraph, image, table, page_break, header, footer.
- For large PDFs, do NOT generate the whole document in one `pdf_create` call — a massive content array fails generation. Split the content into chunks of roughly 30–50 pages each, run a separate `pdf_create` per chunk to its own part file (e.g. `part-1.pdf`, `part-2.pdf`), then `pdf_merge` the parts into the final PDF and delete the intermediate parts. Keep page numbering and headers/footers consistent across chunks.
- For RTL/Arabic text in `pdf_create`, provide a font_path to a TTF font that supports Arabic glyphs (e.g. Noto Sans Arabic).
- When merging or splitting, always validate page ranges don't exceed the actual page count.
- Return structured JSON results with metadata (page count, file size, etc).
- On error, return a clear message the user can act on (file not found, locked, corrupt, etc).

## Content Block Types for pdf_create

- `heading`: { type, text, level (1-3), alignment? }
- `paragraph`: { type, text, alignment?, fontSize?, bold?, italic? }
- `image`: { type, path, width?, height?, alignment? }
- `table`: { type, headers: string[], rows: string[][], columnWidths? }
- `page_break`: { type }
- `header`: { type, text, fontSize? }
- `footer`: { type, text, fontSize? }
