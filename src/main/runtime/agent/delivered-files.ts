/**
 * Delivered-file note — the in-context reinforcement that stops the agent
 * re-delivering a file a tool already surfaced (e.g. `browser_pdf` returns
 * `{"path":"x.pdf"}` which the renderer + channels auto-attach, and the model
 * then redundantly calls `send_file` on the same file → it shows twice).
 *
 * When a tool result carries a deliverable file, we append a short `[System: …]`
 * note to the MODEL's copy of that tool result only (Agent.ts `toolMsg.content`)
 * — never the UI card or the channel send. So the model gets concrete, per-call
 * evidence that the file is already on the user's screen, reinforcing the
 * agents.core.md rule ("most file-producing tools already deliver it — let
 * them"). This is a source-level nudge, not a render-time filter: nothing is
 * hidden; the model is simply told what already happened.
 *
 * Detection mirrors the four delivery surfaces (renderer + both channels +
 * emitters): the explicit `[wolffish-output: <path> (type)]` marker (any type,
 * emitted by send_file / shell `open` / ffmpeg), and the bare `{path}` /
 * `{files:[{path}]}` JSON that every file-GENERATION tool returns (browser_pdf,
 * pdf_create/merge, image gen). The bare-JSON form only auto-delivers for known
 * media/document extensions, so we gate it the same way the channels do; the
 * explicit marker already covers any extension.
 */

const MARKER_RE = /\[wolffish-output:\s*([^\]]+?)\s+\((?:image|audio|video|document|file)\)\]/g

// Extensions auto-delivered from a bare {path} JSON on EVERY surface — DOCUMENTS
// and IMAGES only. Both the renderer (extractToolResultDocuments/Image) and the
// channels (extractDocumentPaths/extractWolffishMediaPaths) parse a bare
// {"path": ...} for these regardless of location, so a generation tool that
// returns {path} (browser_pdf, pdf_create, image gen) is genuinely already
// shown. Audio/video are deliberately EXCLUDED here: the renderer only renders
// bare-path media when it's workspace-anchored (a regex, not JSON parsing), so
// claiming "delivered" for a bare {path:x.mp3} risks a false positive → the
// model skips send_file → a MISSING file. A missing file is worse than a rare
// redundant send, so we stay conservative. Marker-delivered audio/video is
// still caught by MARKER_RE below (any type) — that path IS delivered on every
// surface. Generic/other extensions likewise only deliver via the explicit
// (file) marker, never a bare {path}.
const DELIVERABLE_EXTS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.csv',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.tiff',
  '.tif'
])

function basename(p: string): string {
  const cleaned = p.trim().replace(/[/\\]+$/, '')
  const cut = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'))
  return cut >= 0 ? cleaned.slice(cut + 1) : cleaned
}

function extname(p: string): string {
  const b = basename(p)
  const dot = b.lastIndexOf('.')
  return dot > 0 ? b.slice(dot).toLowerCase() : ''
}

/**
 * The file names a successful tool result delivered to the user, in order,
 * deduped. Empty when the output carries no auto-delivered file.
 */
export function deliveredFileNames(output: string): string[] {
  if (!output) return []
  const names = new Set<string>()

  MARKER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MARKER_RE.exec(output)) !== null) {
    const name = basename(m[1])
    if (name) names.add(name)
  }

  // Bare {path} / {files:[{path}]} only when the output IS that JSON (a tool
  // that merely mentions a path in prose isn't delivering it). Skip if a marker
  // already accounted for the delivery.
  if (names.size === 0) {
    const trimmed = output.trim()
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { path?: unknown; files?: unknown }
        const paths: unknown[] = []
        if (typeof parsed.path === 'string') paths.push(parsed.path)
        if (Array.isArray(parsed.files)) {
          for (const f of parsed.files) {
            if (f && typeof (f as { path?: unknown }).path === 'string') {
              paths.push((f as { path: string }).path)
            }
          }
        }
        for (const p of paths) {
          if (typeof p === 'string' && DELIVERABLE_EXTS.has(extname(p))) {
            const name = basename(p)
            if (name) names.add(name)
          }
        }
      } catch {
        /* not JSON — no delivery */
      }
    }
  }

  return [...names]
}

/**
 * One-line reminder listing the files already delivered this turn, or null when
 * none. Rides the outbound VOLATILE TAIL (formatRuntimeStatus) / the legacy
 * `<runtime>` block — both rendered strictly AFTER every cache breakpoint, so
 * this per-iteration fact never perturbs the cached prefix. Turn-scoped: the
 * caller accumulates names across the turn and resets each turn, so a later
 * turn starts clean (a fresh "send me that again" is never suppressed by a
 * stale note). This is why the reminder is NOT appended to tool-result messages
 * — that would sit inside the cached history and force a cross-turn cache miss.
 */
export function deliveredFilesReminder(names: string[]): string | null {
  if (names.length === 0) return null
  const list = names.join(', ')
  const one = names.length === 1
  return (
    `Files already delivered to the user THIS turn (shown in the conversation): ${list}. ` +
    `This applies ONLY to ${one ? 'that file' : 'those files'}: don't re-send ${one ? 'it' : 'them'} this turn unless you've edited ${one ? 'it' : 'them'} since ` +
    `(if changed, re-send the updated version). ALWAYS call send_file for any OTHER new, edited, or not-yet-shown file — delivering the file is the default.`
  )
}
