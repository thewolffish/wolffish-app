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

## Choosing how to make a PDF — read this first

There are two ways to produce a PDF. Pick deliberately:

- **HTML → PDF — the default for anything a person will read.** Build a self-contained,
  styled HTML document (colored header bands, chips/badges, cards, tables) and render it to
  PDF through the browser capability: write the `.html` file → `browser_launch` (headless is
  fine) → `browser_navigate` to its `file://` path → `browser_pdf`. This is the only way to get
  clean, modern, **colored** documents. Use it for reports, summaries, invoices, proposals,
  briefs, dashboards — the vast majority of requests.
- **`pdf_create` — plain fallback.** The native builder emits plain black-on-white text and
  tables with no design. Reach for it **only** when the user explicitly wants a plain / no-frills
  document, for a quick throwaway data dump, or when speed clearly matters more than looks.

Do **not** default to `pdf_create` just because the word "PDF" appears — that yields the boring
black-and-white output most requests do NOT want. **When in doubt, go HTML → PDF.**

## HTML → PDF: the rules that make it come out right

The browser renders with **zero page margin** (full bleed). That is what makes crisp
edge-to-edge color possible, but it means you — not the page margins — control every bit of
spacing. Follow these three rules; they eliminate the failure modes that ruin generated PDFs.

### 1. Never put a gradient on text — solid text colors only

Gradient-text tricks (`background-clip: text` / `-webkit-background-clip: text` with
`-webkit-text-fill-color: transparent` or `color: transparent`) are **unreliable** in PDF
rendering: they frequently print as a solid colored rectangle covering the words — the
"purple block where the title should be" failure. The outcome is unpredictable across Chromium
versions, so never use them. So:

- **Every piece of text uses one solid `color`** — titles, headings, body, labels, all of it.
- **Gradients belong on surfaces, never on text**: element `background`s, header/hero bands,
  cards, chips, badges, buttons, dividers. Put the gradient on `background`; keep the element's
  `color` a solid value (e.g. white text on a gradient band).
- Never use `background-clip: text`, `-webkit-background-clip: text`,
  `-webkit-text-fill-color: transparent`, or `color: transparent` anywhere.

### 2. Full-bleed color, no white borders or bars

- **Paint the page background yourself.** Put the base color (solid or a gradient) on
  `html, body` and set `@page { margin: 0 }`. With `print_background: true` (the default) that
  color reaches every edge on every page — no white border, no white bar.
- **Add breathing room with padding on an inner wrapper, never page margins.** A `.page` wrapper
  with `padding: 56px 64px` keeps content off the edges while the background still bleeds out.
- Include `-webkit-print-color-adjust: exact; print-color-adjust: exact;` on `body` so colors
  are never dropped.

### 3. Top spacing on every page, and no clipped content

Because there is no page margin, a plain continuous flow gets sliced at the page edge — content
jammed against the top and lines cut in half. Structure the document so breaks land in the gaps:

- **Wrap every logical block** (card, section, figure, table) in a container with
  `break-inside: avoid;`. Chromium then moves the whole block to the next page instead of cutting
  it. Give each block vertical margin (e.g. `margin: 22px 0;`) — that margin becomes the top
  spacing when the block happens to start a page.
- **Start each major part on a fresh page** with `break-before: page;`, and give that part's top
  element generous `padding-top` so it opens with air instead of hugging the edge.
- **Keep headings with their content:** `h1, h2, h3 { break-after: avoid; }`.
- Breaks can't be pixel-perfect everywhere, but break-avoid blocks + per-part page breaks remove
  essentially all of the jammed-against-the-top and clipped-line cases.

### Reusable skeleton

Start from this and adapt — it already encodes all three rules:

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root {
    --ink:#e5e7eb; --muted:#94a3b8; --card:#1e293b; --accent:#6366f1;
  }
  @page { margin: 0; size: A4; }             /* full bleed — no white margin */
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink);                       /* solid text color */
    background: linear-gradient(160deg,#0f172a,#111827);  /* gradient OK on a background */
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page { padding: 56px 64px; }
  h1, h2, h3 { break-after: avoid; }
  .hero {
    background: linear-gradient(135deg,#6366f1,#8b5cf6); /* gradient on a surface, not text */
    color: #ffffff;                                      /* solid text over the gradient */
    border-radius: 20px; padding: 40px 44px; margin-bottom: 30px;
    break-inside: avoid;
  }
  .hero h1 { margin: 0; font-size: 38px; font-weight: 800; color: #ffffff; }
  .hero p  { margin: 10px 0 0; color: rgba(255,255,255,.85); }
  .chip {
    display: inline-block; padding: 6px 14px; border-radius: 999px;
    background: rgba(255,255,255,.16); color: #ffffff; font-size: 13px; font-weight: 600;
    margin: 12px 8px 0 0;
  }
  .card {
    background: var(--card); border: 1px solid rgba(255,255,255,.07);
    border-radius: 16px; padding: 24px 28px; margin: 22px 0;
    break-inside: avoid;                     /* never split a card across pages */
  }
  .card h2 { margin: 0 0 8px; font-size: 20px; color: #ffffff; }
  .card p  { margin: 0; color: var(--muted); }
  .badge {
    display: inline-block; padding: 4px 10px; border-radius: 8px;
    font-size: 12px; font-weight: 700; background: #dcfce7; color: #166534;
  }
  .part { break-before: page; padding-top: 8px; } /* start a major part on a new page */
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.08); }
  th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
</style>
</head>
<body>
  <div class="page">
    <div class="hero">
      <h1>Report title</h1>
      <p>One-line subtitle in a solid color.</p>
      <span class="chip">Chip one</span><span class="chip">Chip two</span>
    </div>

    <div class="card">
      <h2>A section card <span class="badge">Ready</span></h2>
      <p>Body copy in a single solid color. The whole card stays on one page.</p>
    </div>

    <div class="part">
      <div class="card">
        <h2>This part opens on a fresh page</h2>
        <table>
          <tr><th>Item</th><th>Value</th></tr>
          <tr><td>Alpha</td><td>1</td></tr>
        </table>
      </div>
    </div>
  </div>
</body>
</html>
```

### Rendering and delivering it

1. Save the HTML to the workspace (e.g. `files/report.html`).
2. `browser_launch` (headless is fine) → `browser_navigate` to the absolute `file:///…/report.html`
   → `browser_pdf` with `output_path`, `print_background: true` (default), and `format: "A4"`
   (or `"Letter"`).
3. `send_file` the resulting `.pdf` — `browser_pdf` does **not** auto-deliver its output.

## Interface

- Tools: `pdf_read`, `pdf_create`, `pdf_merge`, `pdf_split`, `pdf_modify`, `pdf_form`, `pdf_secure`, `pdf_extract_images`, `pdf_compress`
- All paths must be absolute. Use `~` prefix for home directory.
- Complex parameters (arrays, objects) are passed as JSON strings.

## Rules

- Always verify the source file exists before operating on it.
- For `pdf_create`, content blocks support types: heading, paragraph, image, table, page_break, header, footer.
- For large PDFs, do NOT generate the whole document in one `pdf_create` call — a massive content array fails generation. Split the content into chunks of roughly 30–50 pages each, run a separate `pdf_create` per chunk to its own part file (e.g. `part-1.pdf`, `part-2.pdf`), then `pdf_merge` the parts into the final PDF and delete the intermediate parts. Keep page numbering and headers/footers consistent across chunks.
- For RTL/Arabic text in `pdf_create`, provide a font_path to a TTF font that supports Arabic glyphs (e.g. Noto Sans Arabic). Look for a font you already downloaded before fetching a fresh one — `wolffish_list_files` with `dir: "files"`, `depth: 5`, `pattern: ".ttf"` (depth 2 is the default and hides nested files). Keep new font downloads in `files/assets/fonts/` so the next PDF reuses them.
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
