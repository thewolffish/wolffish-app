/**
 * Delivered-file note tests — pins the detector that tells the model, in
 * context, when a tool result already delivered a file to the user, so it
 * doesn't redundantly call send_file (the PDF-shown-twice cause: browser_pdf
 * returns {path} which auto-attaches, then send_file re-delivers the same file).
 *
 * Standalone — no vitest/jest in this repo. Run:
 *   npx tsx src/main/runtime/__tests__/delivered-files.test.ts
 *
 * The helper is a pure, Electron-free leaf module.
 */

import { deliveredFileNames, deliveredFilesReminder } from '../agent/delivered-files'

let passed = 0
let failed = 0

function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
    return
  }
  failed++
  console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`)
}

const PDF = '/Users/me/.wolffish/workspace/files/organic-growth-plan-2026-06-30.pdf'

// 1. The real double-delivery scenario. browser_pdf returns bare {path}; both it
//    and a later send_file marker must be recognized as delivering the SAME file
//    — so the model sees "already delivered" before it decides to send_file.
const browserPdfResult = JSON.stringify({ path: PDF })
const sendFileResult = `[wolffish-output: ${PDF} (document)]`
ok('browser_pdf {path} counts as delivered', deliveredFileNames(browserPdfResult).length === 1)
ok(
  'names the pdf by basename',
  deliveredFileNames(browserPdfResult)[0] === 'organic-growth-plan-2026-06-30.pdf'
)
ok('send_file marker counts as delivered', deliveredFileNames(sendFileResult).length === 1)
ok(
  'both mechanisms resolve to the same file',
  deliveredFileNames(browserPdfResult)[0] === deliveredFileNames(sendFileResult)[0]
)

// 2. The turn-level reminder (rides the runtime tail, built from accumulated
//    names) lists the files and forbids re-sending.
const reminder = deliveredFilesReminder(deliveredFileNames(browserPdfResult))
ok('reminder is produced', reminder !== null)
ok('reminder names the file', reminder?.includes('organic-growth-plan-2026-06-30.pdf') === true)
ok('reminder forbids resending', reminder?.includes('send_file') === true)
ok('empty list yields no reminder', deliveredFilesReminder([]) === null)
ok(
  'reminder lists multiple files',
  deliveredFilesReminder(['a.pdf', 'b.png'])?.includes('a.pdf, b.png') === true
)

// 3. Marker types: document, image, audio, video, and the (file) catch-all.
ok('image marker delivers', deliveredFileNames('[wolffish-output: /w/a.png (image)]').length === 1)
ok('audio marker delivers', deliveredFileNames('[wolffish-output: /w/a.mp3 (audio)]').length === 1)
ok('video marker delivers', deliveredFileNames('[wolffish-output: /w/a.mp4 (video)]').length === 1)
ok(
  '(file) catch-all delivers any ext',
  deliveredFileNames('[wolffish-output: /w/archive.zip (file)]')[0] === 'archive.zip'
)

// 4. Bare {path}: fire ONLY for docs+images (unconditionally auto-delivered on
//    every surface). A .txt returned as {path} is not auto-attached, so no fire.
ok(
  'bare {path} image delivers',
  deliveredFileNames(JSON.stringify({ path: '/w/x.png' })).length === 1
)
ok(
  'bare {path} pdf delivers',
  deliveredFileNames(JSON.stringify({ path: '/w/x.pdf' })).length === 1
)
ok(
  'bare {path} .txt does NOT deliver',
  deliveredFileNames(JSON.stringify({ path: '/w/notes.txt' })).length === 0
)
// Audio/video are marker-only (renderer renders bare-path media only when
// workspace-anchored). Claiming a bare {path} audio/video as delivered would
// risk the model skipping send_file → a missing file, so it must NOT fire here.
ok(
  'bare {path} .mp3 does NOT deliver (marker-only)',
  deliveredFileNames(JSON.stringify({ path: '/w/voice.mp3' })).length === 0
)
ok(
  'bare {path} .mp4 does NOT deliver (marker-only)',
  deliveredFileNames(JSON.stringify({ path: '/w/clip.mp4' })).length === 0
)
// ...but an audio/video MARKER still counts — that path IS delivered everywhere.
ok(
  'audio via marker still delivers',
  deliveredFileNames('[wolffish-output: /w/voice.mp3 (audio)]').length === 1
)
ok(
  '{files:[{path}]} array delivers each',
  deliveredFileNames(JSON.stringify({ files: [{ path: '/w/a.pdf' }, { path: '/w/b.docx' }] }))
    .length === 2
)

// 5. No over-firing. Prose that merely mentions a path is not a delivery, and
//    plain/empty output produces no note.
ok(
  'prose mentioning a path does not fire',
  deliveredFileNames('Saved the report to /w/x.pdf').length === 0
)
ok('plain success output does not fire', deliveredFileNames('Done. 3 files changed.').length === 0)
ok('empty output does not fire', deliveredFileNames('').length === 0)
ok('non-delivering output yields no names', deliveredFileNames('ok').length === 0)

// 6. Dedup: the same path named twice in one result collapses to one name.
ok(
  'duplicate paths in one result dedupe',
  deliveredFileNames(`${sendFileResult}\n${sendFileResult}`).length === 1
)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
