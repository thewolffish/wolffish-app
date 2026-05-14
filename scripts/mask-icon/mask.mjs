/**
 * Prepare the macOS/Windows/Linux icon master.
 *
 * Pipeline:
 *   1. Read the original full-bleed square master (resources/images/icon.png).
 *   2. Downscale it to 824×824 — matching Apple's ~80% inner artwork ratio so
 *      the icon renders at the same visual footprint as native apps (Finder,
 *      Safari) in the Dock.
 *   3. Apply the Apple-style squircle mask (superellipse, n≈5) to that 824
 *      artwork so macOS renders the right shape — macOS does not auto-mask.
 *   4. Composite the masked 824 artwork centered onto a 1024×1024 transparent
 *      canvas, yielding 100px transparent padding on each side.
 *
 * Output:  resources/images/icon-master.png (1024×1024, padded, masked)
 * The original resources/images/icon.png is never modified.
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import Jimp from 'jimp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..', '..')

const CANVAS = 1024
const ARTWORK = 824
const PAD = (CANVAS - ARTWORK) / 2
const SUPERELLIPSE_N = 5

const input = resolve(projectRoot, 'resources/images/icon.png')
const output = resolve(projectRoot, 'resources/images/icon-master.png')

const artwork = await Jimp.read(input)
artwork.resize(ARTWORK, ARTWORK, Jimp.RESIZE_BEZIER)

const r = ARTWORK / 2
artwork.scan(0, 0, ARTWORK, ARTWORK, function (x, y, idx) {
  const dx = Math.abs(x + 0.5 - r) / r
  const dy = Math.abs(y + 0.5 - r) / r
  const v = dx ** SUPERELLIPSE_N + dy ** SUPERELLIPSE_N
  if (v > 1) {
    this.bitmap.data[idx + 3] = 0
    return
  }
  const edge = 1 - v
  if (edge < 0.02) {
    const t = edge / 0.02
    this.bitmap.data[idx + 3] = Math.round(this.bitmap.data[idx + 3] * t)
  }
})

const canvas = new Jimp(CANVAS, CANVAS, 0x00000000)
canvas.composite(artwork, PAD, PAD)

await canvas.writeAsync(output)
console.log(`wrote ${output} (${CANVAS}x${CANVAS}, ${ARTWORK}x${ARTWORK} centered)`)
