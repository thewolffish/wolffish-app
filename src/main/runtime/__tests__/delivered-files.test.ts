/**
 * Delivered-file note tests — MARKER-ONLY contract.
 *
 * Delivery is 100% the model's act: only the `[wolffish-output: <path>
 * (type)]` marker (send_file's transport) counts as "delivered". A tool that
 * merely GENERATES a file — bare `{path}` / `{files:[{path}]}` JSON, prose
 * paths, screenshots — delivers nothing, and this module must never claim it
 * did (the old bare-JSON detection talked the model out of sending its own
 * outputs; that whole auto-delivery world is gone).
 *
 * Standalone — no vitest/jest in this repo.
 * Run: npx tsx --tsconfig tsconfig.node.json src/main/runtime/__tests__/delivered-files.test.ts
 */
import { deliveredFileNames, deliveredFilesReminder } from '../agent/delivered-files'

let passed = 0
let failed = 0

function ok(label: string, cond: boolean): void {
  if (cond) {
    passed++
  } else {
    failed++
    console.error(`FAIL ${label}`)
  }
}

// ── 1. Explicit markers (send_file) deliver — any type ─────────────────
ok(
  'document marker delivers',
  deliveredFileNames(
    '[wolffish-output: /Users/y/.wolffish/workspace/files/report.pdf (document)]'
  ).join() === 'report.pdf'
)
ok(
  'image marker delivers',
  deliveredFileNames('done!\n[wolffish-output: /tmp/chart.png (image)]').join() === 'chart.png'
)
ok(
  'audio marker delivers',
  deliveredFileNames('[wolffish-output: /w/voice.mp3 (audio)]').join() === 'voice.mp3'
)
ok(
  'video marker delivers',
  deliveredFileNames('[wolffish-output: /w/clip.mp4 (video)]').join() === 'clip.mp4'
)
ok(
  'generic file marker delivers',
  deliveredFileNames('[wolffish-output: /w/data.tar.gz (file)]').join() === 'data.tar.gz'
)
ok(
  'multiple markers dedupe and keep order',
  deliveredFileNames(
    '[wolffish-output: /a/one.pdf (document)]\n[wolffish-output: /b/two.png (image)]\n[wolffish-output: /a/one.pdf (document)]'
  ).join() === 'one.pdf,two.png'
)
ok(
  'marker path with spaces survives',
  deliveredFileNames('[wolffish-output: /w/files/World Cup On Top.pdf (document)]').join() ===
    'World Cup On Top.pdf'
)

// ── 2. Generation is NOT delivery — bare JSON/paths never fire ──────────
ok(
  'bare {path} pdf does NOT deliver',
  deliveredFileNames('{"path":"/w/files/out.pdf"}').length === 0
)
ok(
  'bare {path} image does NOT deliver',
  deliveredFileNames('{"path":"/w/shot.png","size":123}').length === 0
)
ok(
  'bare {files:[{path}]} does NOT deliver',
  deliveredFileNames('{"files":[{"path":"/w/a.pdf"},{"path":"/w/b.docx"}]}').length === 0
)
ok('bare {path} .mp3 does NOT deliver', deliveredFileNames('{"path":"/w/song.mp3"}').length === 0)
ok(
  'prose path does NOT deliver',
  deliveredFileNames('Saved the report to /w/files/report.pdf successfully.').length === 0
)
ok('plain text does NOT deliver', deliveredFileNames('conversion finished OK').length === 0)
ok('empty output does NOT deliver', deliveredFileNames('').length === 0)

// ── 3. The reminder (rides the volatile tail) ───────────────────────────
const reminder = deliveredFilesReminder(['report.pdf', 'chart.png'])
ok('reminder is produced', typeof reminder === 'string' && reminder.length > 0)
ok(
  'reminder names the files',
  /report\.pdf/.test(reminder ?? '') && /chart\.png/.test(reminder ?? '')
)
ok('reminder forbids resending', /already|re-send|resend/i.test(reminder ?? ''))
ok('empty list yields no reminder', deliveredFilesReminder([]) === null)

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
