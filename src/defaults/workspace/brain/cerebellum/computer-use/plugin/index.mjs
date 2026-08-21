import fs from 'node:fs/promises'
import path from 'node:path'

let nutMouse, nutKeyboard, nutButton, nutPoint, nutStraightTo
let electronScreen, electronDesktopCapturer, electronClipboard, electronBrowserWindow
let sharp
let permissionsOK = false
let permissionError = null
let workspaceRoot = ''
let getConversationId = () => null
let screenshotCounter = 0

const DEFAULT_MAX_WIDTH = 1280
const DEFAULT_FORMAT = 'jpeg'
const JPEG_QUALITY = 85

// Magnifier patch: the close-up returned by move/click/drag so the model can
// verify exactly where the cursor landed. Sized in logical pixels, rendered
// at 2x so one image pixel = half a logical pixel (sub-pixel aim on any DPI).
const MAG_W = 240
const MAG_H = 150
const MAG_SCALE = 2

// Zoom output stays within a comfortable model-viewable width.
const ZOOM_MAX_OUT = 1200
const ZOOM_MAX_FACTOR = 4

// The screen glow hides itself after this long without any computer-use
// activity — one rule that covers completion, cancellation, and termination
// alike, with no dependency on turn lifecycle hooks.
const OVERLAY_IDLE_HIDE_MS = 12_000

/**
 * The coordinate frame the model is currently working in: the most recent
 * image this plugin returned (screenshot, zoom, or magnifier). All mouse
 * coordinates arrive in this image's pixel space and are mapped here to
 * global DIP screen space. Keyed per conversation so concurrent
 * conversations cannot trample each other's mapping.
 *
 *   scale    — logical (DIP) pixels per image pixel
 *   offsetX/offsetY — global DIP position of the image's (0,0)
 *   width/height    — image dimensions in image pixels
 *   displayId       — the display the frame was captured from
 */
const frames = new Map()

function frameKey() {
  return getConversationId() ?? 'global'
}

function currentFrame() {
  return frames.get(frameKey()) ?? null
}

function setFrame(frame) {
  frames.set(frameKey(), frame)
}

const KEY_MAP = {
  enter: 'Return',
  return: 'Return',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  space: 'Space',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  pgup: 'PageUp',
  pgdn: 'PageDown',
  insert: 'Insert',
  capslock: 'CapsLock',
  f1: 'F1',
  f2: 'F2',
  f3: 'F3',
  f4: 'F4',
  f5: 'F5',
  f6: 'F6',
  f7: 'F7',
  f8: 'F8',
  f9: 'F9',
  f10: 'F10',
  f11: 'F11',
  f12: 'F12',
  ctrl: 'LeftControl',
  control: 'LeftControl',
  alt: 'LeftAlt',
  option: 'LeftAlt',
  opt: 'LeftAlt',
  shift: 'LeftShift',
  meta: 'LeftSuper',
  cmd: 'LeftSuper',
  command: 'LeftSuper',
  super: 'LeftSuper',
  win: 'LeftSuper',
  '.': 'Period',
  ',': 'Comma',
  '/': 'Slash',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'LeftBracket',
  ']': 'RightBracket',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Grave',
  0: 'Num0',
  1: 'Num1',
  2: 'Num2',
  3: 'Num3',
  4: 'Num4',
  5: 'Num5',
  6: 'Num6',
  7: 'Num7',
  8: 'Num8',
  9: 'Num9'
}

function resolveKey(Key, name) {
  const trimmed = String(name).trim()
  const lower = trimmed.toLowerCase()
  const mapped = KEY_MAP[lower]
  if (mapped && Key[mapped] !== undefined) return Key[mapped]
  if (trimmed.length === 1) {
    const upper = trimmed.toUpperCase()
    if (Key[upper] !== undefined) return Key[upper]
  }
  if (Key[trimmed] !== undefined) return Key[trimmed]
  return null
}

async function readConfig() {
  if (!workspaceRoot) return {}
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, 'config.json'), 'utf8')
    return JSON.parse(raw)?.computerUse ?? {}
  } catch {
    return {}
  }
}

async function checkPermissions() {
  try {
    await nutMouse.getPosition()
    permissionsOK = true
    permissionError = null
  } catch (err) {
    permissionsOK = false
    const msg = err?.message ?? String(err)
    if (process.platform === 'darwin') {
      permissionError =
        'Screen recording and accessibility permissions required. ' +
        'Grant them in System Settings → Privacy & Security → Screen Recording and Accessibility, then restart Wolffish.'
    } else if (process.platform === 'linux') {
      permissionError = msg.includes('X11')
        ? 'X11 is required for computer-use on Linux. Wayland is not supported by the automation library.'
        : `Permission error: ${msg}`
    } else {
      permissionError = `Permission error: ${msg}`
    }
  }
}

function requirePermissions() {
  if (!permissionsOK) {
    return {
      success: false,
      error: permissionError || 'Desktop automation permissions not granted.'
    }
  }
  return null
}

// ─── Coordinate spaces ──────────────────────────────────────────────────
//
// Three spaces are involved and only the plugin ever converts between them:
//   frame  — pixels of the latest image the model saw
//   DIP    — Electron's logical global desktop coordinates
//   native — what the OS input layer expects (macOS: DIP; Windows: physical
//            pixels; Linux/X11: physical pixels)

function frameToDip(frame, x, y) {
  // Center-of-pixel mapping: image pixel x spans [x*s, (x+1)*s) logical px;
  // floor of its midpoint clicks the middle of that span instead of its
  // left edge, which matters when one image pixel covers 2+ screen pixels.
  return {
    x: Math.floor((x + 0.5) * frame.scale + frame.offsetX),
    y: Math.floor((y + 0.5) * frame.scale + frame.offsetY)
  }
}

function dipToNative(x, y) {
  if (process.platform === 'darwin') return { x, y }
  if (process.platform === 'win32' && typeof electronScreen.dipToScreenPoint === 'function') {
    const p = electronScreen.dipToScreenPoint({ x, y })
    return { x: p.x, y: p.y }
  }
  // Linux/X11 (and a Windows fallback without dipToScreenPoint): input
  // events address physical pixels; scale DIP by the containing display's
  // factor around that display's origin.
  const display = electronScreen.getDisplayNearestPoint({ x, y })
  const f = display.scaleFactor || 1
  if (f === 1) return { x, y }
  return {
    x: Math.round(display.bounds.x * f + (x - display.bounds.x) * f),
    y: Math.round(display.bounds.y * f + (y - display.bounds.y) * f)
  }
}

function validateFrameCoords(x, y, label = 'Coordinates') {
  const frame = currentFrame()
  if (!frame) {
    return (
      `${label} (${x}, ${y}) cannot be used yet: there is no current frame. ` +
      'Take a computer_screenshot first, then give coordinates read from that image.'
    )
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
    return (
      `${label} (${x}, ${y}) are outside the current frame. The current frame is the LATEST image you received ` +
      `(a ${frame.width}x${frame.height} ${frame.kind}); valid range is x 0-${frame.width - 1}, y 0-${frame.height - 1}. ` +
      'Coordinates from an older image are invalid — take a fresh computer_screenshot and read new coordinates from it.'
    )
  }
  return null
}

// ─── Capture ────────────────────────────────────────────────────────────

function getDisplayByIndex(index) {
  const displays = electronScreen.getAllDisplays()
  return { displays, display: displays[index] || electronScreen.getPrimaryDisplay() }
}

async function captureNative(display) {
  const targetW = Math.round(display.size.width * display.scaleFactor)
  const targetH = Math.round(display.size.height * display.scaleFactor)
  await overlayBeforeCapture()
  let sources
  try {
    sources = await electronDesktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: targetW, height: targetH }
    })
  } finally {
    overlayAfterCapture()
  }
  const displayId = String(display.id)
  let source = sources.find((s) => s.display_id === displayId)
  if (!source) {
    // display_id can be empty on some platforms; fall back to matching the
    // display's position in the enumeration order.
    const displays = electronScreen.getAllDisplays()
    const index = displays.findIndex((d) => d.id === display.id)
    source = sources[index >= 0 ? index : 0]
  }
  if (!source) throw new Error('No screen source found for capture.')
  const size = source.thumbnail.getSize()
  if (size.width === 0 || size.height === 0) {
    throw new Error(
      'Screenshot returned empty image. Check Screen Recording permission in System Settings → Privacy & Security.'
    )
  }
  return { png: source.thumbnail.toPNG(), nativeW: size.width, nativeH: size.height }
}

function cursorDip() {
  try {
    return electronScreen.getCursorScreenPoint()
  } catch {
    return null
  }
}

// ─── Screen glow overlay ────────────────────────────────────────────────
//
// A soft blue border on the display the agent is working on — visible to
// the human as "the computer is being controlled here", invisible to the
// model: the window is content-protected so it never appears in captures
// (on Linux, where protection is unsupported, it hides for the instant of
// each capture instead). Click-through and non-focusable, so input synthesis
// is completely unaffected. Purely harness-side — no tool exposes it and
// the model never has to know it exists.

const overlay = {
  win: null,
  displayId: null,
  hideTimer: null
}

function overlayHtml() {
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;width:100vw;height:100vh;background:transparent;overflow:hidden;pointer-events:none}' +
    '#g{position:fixed;inset:0;box-shadow:inset 0 0 34px 6px rgba(59,130,246,.32),inset 0 0 10px 2px rgba(96,165,250,.42)}' +
    '#g.pulse{animation:p .7s ease-out}' +
    '@keyframes p{' +
    '0%{box-shadow:inset 0 0 34px 6px rgba(59,130,246,.32),inset 0 0 10px 2px rgba(96,165,250,.42)}' +
    '30%{box-shadow:inset 0 0 64px 16px rgba(59,130,246,.72),inset 0 0 18px 5px rgba(147,197,253,.88)}' +
    '100%{box-shadow:inset 0 0 34px 6px rgba(59,130,246,.32),inset 0 0 10px 2px rgba(96,165,250,.42)}' +
    '}</style></head><body><div id="g"></div><scr' +
    'ipt>window.pulse=function(){var g=document.getElementById("g");g.classList.remove("pulse");void g.offsetWidth;g.classList.add("pulse")}</scr' +
    'ipt></body></html>'
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

function hideOverlay() {
  if (overlay.hideTimer) {
    clearTimeout(overlay.hideTimer)
    overlay.hideTimer = null
  }
  const win = overlay.win
  overlay.win = null
  overlay.displayId = null
  if (win && !win.isDestroyed()) {
    try {
      win.destroy()
    } catch {
      // Already gone — nothing to clean up.
    }
  }
}

/**
 * Show (or move) the glow on the given display and re-arm the idle-hide
 * timer. Every screen-touching tool calls this, so the glow tracks the
 * active display and disappears on its own once the session goes quiet.
 * Never throws — overlay trouble must not fail a tool call.
 */
function overlayKeepAlive(display, holdMs = OVERLAY_IDLE_HIDE_MS) {
  try {
    if (!electronBrowserWindow || !display) return
    if (overlay.win && (overlay.win.isDestroyed() || overlay.displayId !== display.id)) {
      hideOverlay()
    }
    if (!overlay.win) {
      const b = display.bounds
      const win = new electronBrowserWindow({
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        fullscreenable: false,
        show: false,
        title: 'wolffish-screen-glow',
        webPreferences: { contextIsolation: true, nodeIntegration: false }
      })
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.setIgnoreMouseEvents(true)
      // Excluded from every capture path (macOS sharingType none / Windows
      // WDA_EXCLUDEFROMCAPTURE): the human sees the glow, screenshots don't.
      win.setContentProtection(true)
      win.loadURL(overlayHtml())
      win.showInactive()
      overlay.win = win
      overlay.displayId = display.id
      console.log(`[computer-use] screen glow shown on display ${display.id} (${display.bounds.width}x${display.bounds.height})`)
    }
    if (overlay.hideTimer) clearTimeout(overlay.hideTimer)
    overlay.hideTimer = setTimeout(hideOverlay, holdMs)
    if (typeof overlay.hideTimer.unref === 'function') overlay.hideTimer.unref()
  } catch (err) {
    // Glow is cosmetic — never let it break automation. But say why it
    // failed, or a missing glow is undiagnosable.
    console.log(`[computer-use] screen glow failed: ${err?.message ?? String(err)}`)
  }
}

/** Keep-alive on whichever display holds the cursor (typing, key presses). */
function overlayKeepAliveAtCursor(holdMs = OVERLAY_IDLE_HIDE_MS) {
  try {
    const cur = cursorDip()
    if (!cur) return
    overlayKeepAlive(electronScreen.getDisplayNearestPoint(cur), holdMs)
  } catch {
    // Cosmetic only.
  }
}

/**
 * Extend the glow if it is already showing (computer_wait mid-session) —
 * a bare wait never summons the glow on its own.
 */
function overlayExtend(holdMs) {
  if (!overlay.win || overlay.win.isDestroyed()) return
  if (overlay.hideTimer) clearTimeout(overlay.hideTimer)
  overlay.hideTimer = setTimeout(hideOverlay, holdMs)
  if (typeof overlay.hideTimer.unref === 'function') overlay.hideTimer.unref()
}

/** One subtle brighten-and-fade pulse: feedback that a capture happened. */
function overlayPulse() {
  try {
    if (overlay.win && !overlay.win.isDestroyed()) {
      overlay.win.webContents.executeJavaScript('window.pulse && window.pulse()').catch(() => {})
    }
  } catch {
    // Cosmetic only.
  }
}

/**
 * Linux has no content protection: momentarily hide the glow while the
 * capture happens so screenshots stay clean there too. No-op elsewhere.
 */
async function overlayBeforeCapture() {
  if (process.platform !== 'linux') return
  try {
    if (overlay.win && !overlay.win.isDestroyed() && overlay.win.isVisible()) {
      overlay.win.hide()
      await sleep(90)
    }
  } catch {
    // Cosmetic only.
  }
}

function overlayAfterCapture() {
  if (process.platform !== 'linux') return
  try {
    if (overlay.win && !overlay.win.isDestroyed()) overlay.win.showInactive()
  } catch {
    // Cosmetic only.
  }
}

/**
 * Crosshair marker composited onto every returned image at the cursor
 * position: white outer ring + magenta inner ring + center dot + ticks,
 * visible on light and dark backgrounds alike.
 */
function crosshairSvg(imgW, imgH, cx, cy) {
  const c = '#FF1B8D'
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}">` +
      `<g fill="none">` +
      `<circle cx="${cx}" cy="${cy}" r="11" stroke="#FFFFFF" stroke-width="5" opacity="0.9"/>` +
      `<circle cx="${cx}" cy="${cy}" r="11" stroke="${c}" stroke-width="2.5"/>` +
      `<line x1="${cx - 19}" y1="${cy}" x2="${cx - 7}" y2="${cy}" stroke="${c}" stroke-width="2.5"/>` +
      `<line x1="${cx + 7}" y1="${cy}" x2="${cx + 19}" y2="${cy}" stroke="${c}" stroke-width="2.5"/>` +
      `<line x1="${cx}" y1="${cy - 19}" x2="${cx}" y2="${cy - 7}" stroke="${c}" stroke-width="2.5"/>` +
      `<line x1="${cx}" y1="${cy + 7}" x2="${cx}" y2="${cy + 19}" stroke="${c}" stroke-width="2.5"/>` +
      `<circle cx="${cx}" cy="${cy}" r="1.6" fill="${c}"/>` +
      `</g></svg>`
  )
}

async function savePersistedImage(buffer, ext, prefix) {
  try {
    const convId = getConversationId()
    const safe = (convId ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '_')
    const dir = path.join(workspaceRoot, 'screenshots', `conv-${safe}`)
    await fs.mkdir(dir, { recursive: true })
    screenshotCounter++
    const filePath = path.join(dir, `${prefix}-${Date.now()}-${screenshotCounter}.${ext}`)
    await fs.writeFile(filePath, buffer)
    return filePath
  } catch {
    return ''
  }
}

/**
 * Capture a magnified close-up centered on the cursor, crosshair drawn at
 * the exact cursor pixel. Returned after move/click/drag as visual proof of
 * where the action landed, and installed as the new current frame so the
 * model can correct its aim in the close-up's own (finer) coordinates.
 */
async function renderMagnifier() {
  const cur = cursorDip()
  if (!cur) throw new Error('Could not read cursor position.')
  const display = electronScreen.getDisplayNearestPoint(cur)
  overlayKeepAlive(display)
  const { png, nativeW, nativeH } = await captureNative(display)

  const b = display.bounds
  const logicalW = display.size.width
  const logicalH = display.size.height
  const regW = Math.min(MAG_W, logicalW)
  const regH = Math.min(MAG_H, logicalH)
  let rx = Math.round(cur.x - b.x - regW / 2)
  let ry = Math.round(cur.y - b.y - regH / 2)
  rx = Math.max(0, Math.min(logicalW - regW, rx))
  ry = Math.max(0, Math.min(logicalH - regH, ry))

  const fx = nativeW / logicalW
  const fy = nativeH / logicalH
  const crop = {
    left: Math.max(0, Math.round(rx * fx)),
    top: Math.max(0, Math.round(ry * fy)),
    width: Math.min(nativeW, Math.round(regW * fx)),
    height: Math.min(nativeH, Math.round(regH * fy))
  }
  crop.width = Math.min(crop.width, nativeW - crop.left)
  crop.height = Math.min(crop.height, nativeH - crop.top)

  const outW = regW * MAG_SCALE
  const outH = regH * MAG_SCALE
  const cxImg = Math.round((cur.x - b.x - rx) * MAG_SCALE)
  const cyImg = Math.round((cur.y - b.y - ry) * MAG_SCALE)

  const buffer = await sharp(png)
    .extract(crop)
    .resize({ width: outW, height: outH, fit: 'fill' })
    .composite([{ input: crosshairSvg(outW, outH, cxImg, cyImg), left: 0, top: 0 }])
    .png()
    .toBuffer()

  setFrame({
    kind: 'magnifier',
    scale: 1 / MAG_SCALE,
    offsetX: b.x + rx,
    offsetY: b.y + ry,
    width: outW,
    height: outH,
    displayId: display.id
  })

  return {
    image: { mediaType: 'image/png', data: buffer.toString('base64') },
    note:
      `The ${outW}x${outH} magnifier below (${MAG_SCALE}x zoom around the cursor) is now the current frame — ` +
      `the crosshair marks the exact cursor position. To adjust by a small amount, use coordinates read from ` +
      `this magnifier. For anything else, take a fresh computer_screenshot first.`
  }
}

// ─── Tools ──────────────────────────────────────────────────────────────

async function takeScreenshot(args) {
  const denied = requirePermissions()
  if (denied) return denied

  try {
    const cfg = await readConfig()
    const cfgWidth = cfg.screenshotMaxWidth || DEFAULT_MAX_WIDTH
    const format = cfg.screenshotFormat || DEFAULT_FORMAT
    const displayIndex = Number(args?.display_index) || 0
    const { displays, display } = getDisplayByIndex(displayIndex)

    overlayKeepAlive(display)
    const { png, nativeW, nativeH } = await captureNative(display)

    // Very wide displays (ultrawides) would compress unreadably at the
    // configured width; floor the overview at 1/3 of logical width so
    // compression never exceeds ~3x. Zoom still provides native detail.
    const maxWidth = Math.min(2048, Math.max(cfgWidth, Math.ceil(display.size.width / 3)))
    const outW = Math.min(nativeW, maxWidth)
    const outH = Math.round(nativeH * (outW / nativeW))

    let pipeline = sharp(png)
    if (outW < nativeW) pipeline = pipeline.resize({ width: outW, withoutEnlargement: true })

    // Frame maps image pixels to this display's logical space.
    const frame = {
      kind: 'screenshot',
      scale: display.size.width / outW,
      offsetX: display.bounds.x,
      offsetY: display.bounds.y,
      width: outW,
      height: outH,
      displayId: display.id
    }

    // Crosshair at the cursor, when the cursor is on this display.
    const cur = cursorDip()
    let cursorLine = 'Cursor is on another display.'
    if (
      cur &&
      cur.x >= display.bounds.x &&
      cur.x < display.bounds.x + display.size.width &&
      cur.y >= display.bounds.y &&
      cur.y < display.bounds.y + display.size.height
    ) {
      const cx = Math.round((cur.x - frame.offsetX) / frame.scale)
      const cy = Math.round((cur.y - frame.offsetY) / frame.scale)
      pipeline = pipeline.composite([
        { input: crosshairSvg(outW, outH, cx, cy), left: 0, top: 0 }
      ])
      cursorLine = `Cursor at (${cx}, ${cy}), marked with the magenta crosshair.`
    }

    let buffer, mediaType, ext
    if (format === 'png') {
      buffer = await pipeline.png().toBuffer()
      mediaType = 'image/png'
      ext = 'png'
    } else {
      buffer = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer()
      mediaType = 'image/jpeg'
      ext = 'jpg'
    }

    setFrame(frame)
    overlayPulse()

    const displayInfo =
      displays.length > 1
        ? `display ${displayIndex} of ${displays.length} (${display.size.width}x${display.size.height} logical)`
        : `the primary display (${display.size.width}x${display.size.height} logical)`
    const savedPath = await savePersistedImage(buffer, ext, 'shot')
    const pathLine = savedPath ? `\n${savedPath}` : ''

    const compression = frame.scale
    const compressionLine =
      compression >= 2
        ? ` This overview is compressed ${compression.toFixed(1)}x — small text and small controls are degraded in it, so do NOT locate or judge small targets from this image alone: zoom into candidate regions with computer_zoom and find them there.`
        : ''

    return {
      success: true,
      output:
        `Frame ${outW}x${outH} — screenshot of ${displayInfo}. ${cursorLine} ` +
        `Mouse coordinates must be pixel positions read from THIS image (x 0-${outW - 1}, y 0-${outH - 1}); ` +
        `they are translated to the screen automatically. For a small or crowded target, zoom in with computer_zoom before clicking.` +
        compressionLine +
        pathLine,
      images: [{ mediaType, data: buffer.toString('base64') }]
    }
  } catch (err) {
    return { success: false, error: `Screenshot failed: ${err?.message ?? String(err)}` }
  }
}

async function zoomRegion(args) {
  const denied = requirePermissions()
  if (denied) return denied

  const x = Number(args?.x)
  const y = Number(args?.y)
  const w = Number(args?.width)
  const h = Number(args?.height)
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
    return { success: false, error: 'x, y, width, height are required (finite numbers; width/height > 0).' }
  }
  const frame = currentFrame()
  const boundsError =
    validateFrameCoords(x, y, 'Region origin') ??
    validateFrameCoords(Math.min(x + w, (frame?.width ?? 1) - 1), Math.min(y + h, (frame?.height ?? 1) - 1), 'Region corner')
  if (boundsError) return { success: false, error: boundsError }
  if (x + w > frame.width || y + h > frame.height) {
    return {
      success: false,
      error:
        `Region (${x},${y}) ${w}x${h} extends past the current ${frame.width}x${frame.height} frame. ` +
        'Shrink it to fit, or take a fresh computer_screenshot first.'
    }
  }

  try {
    // Region in global logical space.
    const lx = x * frame.scale + frame.offsetX
    const ly = y * frame.scale + frame.offsetY
    const lw = Math.max(12, w * frame.scale)
    const lh = Math.max(8, h * frame.scale)

    const display =
      electronScreen.getAllDisplays().find((d) => d.id === frame.displayId) ??
      electronScreen.getDisplayNearestPoint({ x: Math.round(lx + lw / 2), y: Math.round(ly + lh / 2) })
    const b = display.bounds

    overlayKeepAlive(display)
    const { png, nativeW, nativeH } = await captureNative(display)
    const fx = nativeW / display.size.width
    const fy = nativeH / display.size.height
    const crop = {
      left: Math.max(0, Math.round((lx - b.x) * fx)),
      top: Math.max(0, Math.round((ly - b.y) * fy)),
      width: Math.max(1, Math.round(lw * fx)),
      height: Math.max(1, Math.round(lh * fy))
    }
    crop.width = Math.max(1, Math.min(crop.width, nativeW - crop.left))
    crop.height = Math.max(1, Math.min(crop.height, nativeH - crop.top))

    // Small regions magnify (up to 4x); a region wider than the output cap
    // is re-rendered downscaled to fit — still a fresh native-based view.
    const factor = Math.min(ZOOM_MAX_FACTOR, ZOOM_MAX_OUT / lw)
    const outW = Math.round(lw * factor)
    const outH = Math.round(lh * factor)

    let pipeline = sharp(png).extract(crop).resize({ width: outW, height: outH, fit: 'fill' })

    const newFrame = {
      kind: 'zoom',
      scale: lw / outW,
      offsetX: lx,
      offsetY: ly,
      width: outW,
      height: outH,
      displayId: display.id
    }

    const cur = cursorDip()
    let cursorLine = ''
    if (cur && cur.x >= lx && cur.x < lx + lw && cur.y >= ly && cur.y < ly + lh) {
      const cx = Math.round((cur.x - lx) / newFrame.scale)
      const cy = Math.round((cur.y - ly) / newFrame.scale)
      pipeline = pipeline.composite([{ input: crosshairSvg(outW, outH, cx, cy), left: 0, top: 0 }])
      cursorLine = ` Cursor at (${cx}, ${cy}), marked with the crosshair.`
    }

    const buffer = await pipeline.png().toBuffer()
    setFrame(newFrame)
    overlayPulse()
    const savedPath = await savePersistedImage(buffer, 'png', 'zoom')
    const pathLine = savedPath ? `\n${savedPath}` : ''

    return {
      success: true,
      output:
        `Frame ${outW}x${outH} — ${factor.toFixed(1)}x zoom into the region you selected, captured fresh at native resolution.${cursorLine} ` +
        `Coordinates now refer to THIS zoomed image (x 0-${outW - 1}, y 0-${outH - 1}) — click your target using them for maximum precision. ` +
        `To act outside this region, take a fresh computer_screenshot first.` +
        pathLine,
      images: [{ mediaType: 'image/png', data: buffer.toString('base64') }]
    }
  } catch (err) {
    return { success: false, error: `Zoom failed: ${err?.message ?? String(err)}` }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function moveCursorTo(x, y) {
  const frame = currentFrame()
  const dip = frameToDip(frame, x, y)
  const native = dipToNative(dip.x, dip.y)
  await nutMouse.setPosition(new nutPoint(native.x, native.y))
  await sleep(80)
  return dip
}

async function mouseMove(args) {
  const denied = requirePermissions()
  if (denied) return denied

  const x = Number(args?.x)
  const y = Number(args?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { success: false, error: 'x and y coordinates are required (finite numbers)' }
  }
  const boundsError = validateFrameCoords(x, y)
  if (boundsError) return { success: false, error: boundsError }

  try {
    const dip = await moveCursorTo(x, y)
    const mag = await renderMagnifier()
    return {
      success: true,
      output:
        `Moved cursor to (${x}, ${y}) in the previous frame → screen (${dip.x}, ${dip.y}). ` +
        `Check the magnifier: if the crosshair sits exactly on your target, click it with computer_mouse_click (no coordinates). ` +
        `If it is off, move again using magnifier coordinates. ${mag.note}`,
      images: [mag.image]
    }
  } catch (err) {
    return { success: false, error: `Mouse move failed: ${err?.message ?? String(err)}` }
  }
}

function resolveButton(name) {
  switch (String(name ?? 'left').toLowerCase()) {
    case 'right':
      return { button: nutButton.RIGHT, label: 'right' }
    case 'middle':
      return { button: nutButton.MIDDLE, label: 'middle' }
    default:
      return { button: nutButton.LEFT, label: 'left' }
  }
}

async function mouseClick(args) {
  const denied = requirePermissions()
  if (denied) return denied

  const hasCoords = args?.x !== undefined && args?.y !== undefined
  const x = hasCoords ? Number(args.x) : null
  const y = hasCoords ? Number(args.y) : null
  const { button, label } = resolveButton(args?.button)
  const isDouble = args?.double === true

  if (hasCoords) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { success: false, error: 'x and y must be finite numbers (or omit both to click at the current cursor position).' }
    }
    const boundsError = validateFrameCoords(x, y)
    if (boundsError) return { success: false, error: boundsError }
  }

  try {
    let where = 'at the current cursor position'
    if (hasCoords) {
      const dip = await moveCursorTo(x, y)
      where = `at (${x}, ${y}) in the previous frame → screen (${dip.x}, ${dip.y})`
    }

    if (isDouble) {
      await nutMouse.doubleClick(button)
    } else {
      await nutMouse.click(button)
    }
    await sleep(120)

    const mag = await renderMagnifier()
    const clickType = isDouble ? 'Double-clicked' : 'Clicked'
    return {
      success: true,
      output:
        `${clickType} ${label} ${where}. Verify in the magnifier that the crosshair is on the target you meant — ` +
        `if it shows empty space or a different control under the crosshair, the target was NOT clicked: do not ` +
        `report success; re-locate it (fresh screenshot, then zoom) and click again. ` +
        `If this click should change the screen (menu, dialog, page), take a computer_screenshot to see the result. ${mag.note}`,
      images: [mag.image]
    }
  } catch (err) {
    return { success: false, error: `Mouse click failed: ${err?.message ?? String(err)}` }
  }
}

async function mouseDrag(args) {
  const denied = requirePermissions()
  if (denied) return denied

  const sx = Number(args?.start_x)
  const sy = Number(args?.start_y)
  const ex = Number(args?.end_x)
  const ey = Number(args?.end_y)
  if (![sx, sy, ex, ey].every(Number.isFinite)) {
    return { success: false, error: 'start_x, start_y, end_x, end_y are required (finite numbers).' }
  }
  const startError = validateFrameCoords(sx, sy, 'Start coordinates')
  if (startError) return { success: false, error: startError }
  const endError = validateFrameCoords(ex, ey, 'End coordinates')
  if (endError) return { success: false, error: endError }
  const { button, label } = resolveButton(args?.button)

  try {
    const frame = currentFrame()
    const startDip = await moveCursorTo(sx, sy)
    await nutMouse.pressButton(button)
    await sleep(150)
    const endDip = frameToDip(frame, ex, ey)
    const endNative = dipToNative(endDip.x, endDip.y)
    // Gradual movement (not teleport) so applications register the drag.
    await nutMouse.move(nutStraightTo(new nutPoint(endNative.x, endNative.y)))
    await sleep(120)
    await nutMouse.releaseButton(button)
    await sleep(120)

    const mag = await renderMagnifier()
    return {
      success: true,
      output:
        `Dragged with the ${label} button from (${sx}, ${sy}) to (${ex}, ${ey}) in the previous frame ` +
        `(screen ${startDip.x},${startDip.y} → ${endDip.x},${endDip.y}). The magnifier shows the release point — ` +
        `anything you dragged is now THERE, not at its original position. If the release point missed the ` +
        `destination, correct with a second, short drag: zoom into a region containing both the object's current ` +
        `position and the destination, then drag within that zoom — short drags are precise because both endpoints ` +
        `share one close-up frame. Take a computer_screenshot to verify the final result. ${mag.note}`,
      images: [mag.image]
    }
  } catch (err) {
    try {
      await nutMouse.releaseButton(button)
    } catch {
      // Best-effort: never leave the button held down after a failure.
    }
    return { success: false, error: `Drag failed: ${err?.message ?? String(err)}` }
  }
}

async function mouseScroll(args) {
  const denied = requirePermissions()
  if (denied) return denied

  const direction = String(args?.direction ?? 'down').toLowerCase()
  const amount = Math.max(1, Math.min(100, Number(args?.amount) || 3))
  const hasCoords = args?.x !== undefined && args?.y !== undefined

  if (hasCoords) {
    const x = Number(args.x)
    const y = Number(args.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { success: false, error: 'x and y must be finite numbers when provided.' }
    }
    const boundsError = validateFrameCoords(x, y)
    if (boundsError) return { success: false, error: boundsError }
    try {
      await moveCursorTo(x, y)
    } catch (err) {
      return { success: false, error: `Could not move to scroll position: ${err?.message ?? String(err)}` }
    }
  }

  try {
    switch (direction) {
      case 'up':
        await nutMouse.scrollUp(amount)
        break
      case 'down':
        await nutMouse.scrollDown(amount)
        break
      case 'left':
        await nutMouse.scrollLeft(amount)
        break
      case 'right':
        await nutMouse.scrollRight(amount)
        break
      default:
        return { success: false, error: `Invalid scroll direction: ${direction}` }
    }
    await sleep(150)
    const mag = await renderMagnifier()
    return {
      success: true,
      output:
        `Scrolled ${direction} by ${amount} wheel notches. The magnifier below shows the area under the cursor ` +
        `after the scroll — if the item you were scrolling toward is visible in it, click it directly using the ` +
        `magnifier's coordinates; otherwise scroll again. For the wider picture take a computer_screenshot ` +
        `(pre-scroll coordinates are stale). ${mag.note}`,
      images: [mag.image]
    }
  } catch (err) {
    return { success: false, error: `Scroll failed: ${err?.message ?? String(err)}` }
  }
}

const ASCII_PRINTABLE = /^[\x20-\x7E\r\n\t]*$/

async function keyboardType(args) {
  const denied = requirePermissions()
  if (denied) return denied

  const text = String(args?.text ?? '')
  if (text.length === 0) {
    return { success: false, error: 'text is required and must be non-empty' }
  }
  overlayKeepAliveAtCursor()

  try {
    // Short ASCII goes through real keystrokes. Anything long or non-ASCII
    // (Arabic, emoji, accents) is pasted via the clipboard — keystroke
    // synthesis mangles non-Latin text on several platforms, paste never
    // does. The user's previous clipboard text is restored afterwards.
    if (ASCII_PRINTABLE.test(text) && text.length <= 120) {
      await nutKeyboard.type(text)
      return { success: true, output: `Typed ${text.length} characters. Verify with a screenshot that the text landed in the intended field.` }
    }

    const { Key } = await import('@nut-tree-fork/nut-js')
    const previous = electronClipboard.readText()
    electronClipboard.writeText(text)
    await sleep(100)
    const pasteMod = process.platform === 'darwin' ? Key.LeftSuper : Key.LeftControl
    await nutKeyboard.pressKey(pasteMod)
    await nutKeyboard.pressKey(Key.V)
    await nutKeyboard.releaseKey(Key.V)
    await nutKeyboard.releaseKey(pasteMod)
    await sleep(250)
    electronClipboard.writeText(previous)
    return {
      success: true,
      output: `Typed ${text.length} characters (pasted via clipboard for exact fidelity). Verify with a screenshot that the text landed in the intended field.`
    }
  } catch (err) {
    return { success: false, error: `Keyboard type failed: ${err?.message ?? String(err)}` }
  }
}

async function keyboardPress(args) {
  const denied = requirePermissions()
  if (denied) return denied

  const rawKey = String(args?.key ?? '').trim()
  if (rawKey.length === 0) {
    return { success: false, error: 'key is required' }
  }
  overlayKeepAliveAtCursor()

  // Accept both forms: key:'s' + modifiers:'cmd', and a single combo string
  // key:'cmd+s'. A bare '+' key press still works.
  let keyName = rawKey
  const comboMods = []
  if (rawKey.length > 1 && rawKey.includes('+')) {
    const parts = rawKey.split('+').map((p) => p.trim()).filter((p) => p.length > 0)
    if (parts.length > 1) {
      keyName = parts[parts.length - 1]
      comboMods.push(...parts.slice(0, -1))
    }
  }
  const modifierNames = [
    ...comboMods,
    ...String(args?.modifiers ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m.length > 0)
  ].map((m) => m.toLowerCase())

  try {
    const { Key } = await import('@nut-tree-fork/nut-js')

    const mainKey = resolveKey(Key, keyName)
    if (mainKey === null) {
      return { success: false, error: `Unknown key: ${keyName}` }
    }
    const modKeys = []
    for (const mod of modifierNames) {
      const resolved = resolveKey(Key, mod)
      if (resolved === null) {
        return { success: false, error: `Unknown modifier: ${mod}` }
      }
      modKeys.push(resolved)
    }

    for (const mk of modKeys) {
      await nutKeyboard.pressKey(mk)
    }
    await nutKeyboard.pressKey(mainKey)
    await nutKeyboard.releaseKey(mainKey)
    for (const mk of modKeys.reverse()) {
      await nutKeyboard.releaseKey(mk)
    }

    const desc = modifierNames.length > 0 ? `${modifierNames.join('+')}+${keyName}` : keyName
    return { success: true, output: `Pressed ${desc}` }
  } catch (err) {
    return { success: false, error: `Key press failed: ${err?.message ?? String(err)}` }
  }
}

async function waitMs(args) {
  // No cap — the model decides the duration (see SKILL.md). A wait cannot be
  // interrupted once in flight, so very long waits should be split into
  // several computer_wait calls. A missing, negative, or non-finite value
  // waits 0ms.
  const requested = Number(args?.ms)
  const ms = Number.isFinite(requested) && requested > 0 ? requested : 0
  // Keep the glow alive across the whole wait (plus the normal idle margin)
  // so a long deliberate pause does not read as a finished session.
  overlayExtend(ms + OVERLAY_IDLE_HIDE_MS)
  await new Promise((r) => setTimeout(r, ms))
  return { success: true, output: `Waited ${ms}ms` }
}

async function listDisplays() {
  try {
    const displays = electronScreen.getAllDisplays()
    const primary = electronScreen.getPrimaryDisplay()
    const lines = displays.map((d, i) => {
      const isPrimary = d.id === primary.id ? ' (primary)' : ''
      return `Display ${i}: ${d.size.width}x${d.size.height} logical @ ${d.scaleFactor}x, position (${d.bounds.x},${d.bounds.y})${isPrimary}`
    })
    lines.push(
      'Capture any of them with computer_screenshot display_index. Coordinates are always read from the returned image — never add display offsets yourself.'
    )
    return { success: true, output: lines.join('\n') }
  } catch (err) {
    return { success: false, error: `Failed to list displays: ${err?.message ?? String(err)}` }
  }
}

const TOOL_MAP = {
  computer_screenshot: takeScreenshot,
  computer_zoom: zoomRegion,
  computer_list_displays: listDisplays,
  computer_mouse_move: mouseMove,
  computer_mouse_click: mouseClick,
  computer_mouse_drag: mouseDrag,
  computer_mouse_scroll: mouseScroll,
  computer_keyboard_type: keyboardType,
  computer_keyboard_press: keyboardPress,
  computer_wait: waitMs
}

// Kept in sync with the SKILL.md frontmatter, which is the model-facing
// schema; this mirror exists for tooling that inspects the plugin directly.
const toolDefinitions = [
  {
    name: 'computer_screenshot',
    description:
      'See the screen. Captures a display and returns the image; it becomes the current frame that all mouse coordinates refer to.',
    parameters: {
      type: 'object',
      properties: {
        display_index: {
          type: 'number',
          description: 'Display index (default 0 = primary). Use computer_list_displays to see all displays.'
        }
      },
      required: []
    }
  },
  {
    name: 'computer_zoom',
    description:
      'Magnify a region of the current frame at native resolution for precise clicking and reading small text. The zoom becomes the new current frame.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Region left edge in current-frame pixels' },
        y: { type: 'number', description: 'Region top edge in current-frame pixels' },
        width: { type: 'number', description: 'Region width in current-frame pixels' },
        height: { type: 'number', description: 'Region height in current-frame pixels' }
      },
      required: ['x', 'y', 'width', 'height']
    }
  },
  {
    name: 'computer_list_displays',
    description: 'List all connected displays with resolution, scale factor, and position.',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'computer_mouse_move',
    description:
      'Aim without clicking: move the cursor to x,y in current-frame pixels and get back a magnified view with a crosshair at the new position.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X in current-frame pixels' },
        y: { type: 'number', description: 'Y in current-frame pixels' }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'computer_mouse_click',
    description:
      'Click at x,y in current-frame pixels (or at the current cursor position when omitted). Returns a magnified view proving where the click landed.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X in current-frame pixels (omit both to click in place)' },
        y: { type: 'number', description: 'Y in current-frame pixels (omit both to click in place)' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default left)' },
        double: { type: 'boolean', description: 'Double-click instead of single click' }
      },
      required: []
    }
  },
  {
    name: 'computer_mouse_drag',
    description:
      'Press at the start point, glide to the end point, release — drag-and-drop, sliders, text selection. Coordinates in current-frame pixels.',
    parameters: {
      type: 'object',
      properties: {
        start_x: { type: 'number', description: 'Drag start X in current-frame pixels' },
        start_y: { type: 'number', description: 'Drag start Y in current-frame pixels' },
        end_x: { type: 'number', description: 'Drag end X in current-frame pixels' },
        end_y: { type: 'number', description: 'Drag end Y in current-frame pixels' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default left)' }
      },
      required: ['start_x', 'start_y', 'end_x', 'end_y']
    }
  },
  {
    name: 'computer_mouse_scroll',
    description: 'Scroll the mouse wheel, optionally over a specific point first.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Wheel notches (default 3)' },
        x: { type: 'number', description: 'Optional: move here first (current-frame pixels)' },
        y: { type: 'number', description: 'Optional: move here first (current-frame pixels)' }
      },
      required: ['direction']
    }
  },
  {
    name: 'computer_keyboard_type',
    description: 'Type text into the focused control. Long or non-ASCII text is pasted via the clipboard for exact fidelity.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to type' } },
      required: ['text']
    }
  },
  {
    name: 'computer_keyboard_press',
    description: "Press a key or shortcut — either key:'enter', or a combo string like 'cmd+shift+s'.",
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: "Key or combo (e.g. enter, tab, 'cmd+s')" },
        modifiers: { type: 'string', description: 'Comma-separated modifiers: ctrl, alt, shift, meta, cmd' }
      },
      required: ['key']
    }
  },
  {
    name: 'computer_wait',
    description:
      'Wait the given milliseconds before the next action. No cap — split very long waits into several calls.',
    parameters: {
      type: 'object',
      properties: { ms: { type: 'number', description: 'Milliseconds to wait' } },
      required: ['ms']
    }
  }
]

function describeAction(toolName, args) {
  switch (toolName) {
    case 'computer_screenshot':
      return { title: 'Take screenshot', description: 'Capture the current screen', risk: 'low' }
    case 'computer_zoom':
      return {
        title: 'Zoom into screen',
        description: `Magnify screen region ${args?.width ?? '?'}x${args?.height ?? '?'} at (${args?.x ?? '?'}, ${args?.y ?? '?'})`,
        risk: 'low'
      }
    case 'computer_list_displays':
      return { title: 'List displays', description: 'List all connected displays', risk: 'low' }
    case 'computer_mouse_move': {
      const x = args?.x ?? '?'
      const y = args?.y ?? '?'
      return { title: 'Move cursor', description: `Move mouse to (${x}, ${y})`, risk: 'low' }
    }
    case 'computer_mouse_click': {
      const x = args?.x ?? 'current'
      const y = args?.y ?? 'current'
      const btn = args?.button ?? 'left'
      const dbl = args?.double ? 'Double-click' : 'Click'
      return { title: `${dbl} ${btn}`, description: `${dbl} ${btn} button at (${x}, ${y})`, risk: 'medium' }
    }
    case 'computer_mouse_drag':
      return {
        title: 'Drag',
        description: `Drag from (${args?.start_x ?? '?'}, ${args?.start_y ?? '?'}) to (${args?.end_x ?? '?'}, ${args?.end_y ?? '?'})`,
        risk: 'medium'
      }
    case 'computer_mouse_scroll': {
      const dir = args?.direction ?? 'down'
      const amt = args?.amount ?? 3
      return { title: `Scroll ${dir}`, description: `Scroll ${dir} by ${amt} units`, risk: 'low' }
    }
    case 'computer_keyboard_type':
      return {
        title: 'Type text',
        description: `Type ${String(args?.text ?? '').length} characters`,
        risk: 'medium'
      }
    case 'computer_keyboard_press': {
      const key = args?.key ?? '?'
      const mods = args?.modifiers ? `${args.modifiers}+` : ''
      return { title: 'Press key', description: `Press ${mods}${key}`, command: `${mods}${key}`, risk: 'medium' }
    }
    case 'computer_wait':
      return { title: 'Wait', description: `Wait ${args?.ms ?? 0}ms`, risk: 'low' }
    default:
      return null
  }
}

const plugin = {
  name: 'computer-use',
  tools: toolDefinitions,
  describeAction,

  async init(context) {
    workspaceRoot = context.workspaceRoot
    if (context.getCurrentConversationId) {
      getConversationId = context.getCurrentConversationId
    }

    // On macOS, prompt for Accessibility permission
    if (process.platform === 'darwin') {
      try {
        const { systemPreferences } = await import('electron')
        systemPreferences.isTrustedAccessibilityClient(true)
      } catch {
        // Not fatal — electron import may fail in test environments
      }
    }

    // Load Electron screen capture APIs (screenshots use desktopCapturer, not nut-js)
    try {
      const electron = await import('electron')
      electronScreen = electron.screen
      electronDesktopCapturer = electron.desktopCapturer
      electronClipboard = electron.clipboard
      electronBrowserWindow = electron.BrowserWindow
    } catch {
      // Will fall back to error in takeScreenshot
    }

    try {
      const nut = await import('@nut-tree-fork/nut-js')
      nutMouse = nut.mouse
      nutKeyboard = nut.keyboard
      nutButton = nut.Button
      nutPoint = nut.Point
      nutStraightTo = nut.straightTo

      // nut-js ships with a 300ms delay per keystroke and slow mouse travel;
      // tighten both so actions are crisp without outrunning the OS.
      try {
        nutKeyboard.config.autoDelayMs = 15
        nutMouse.config.autoDelayMs = 25
        nutMouse.config.mouseSpeed = 2500
      } catch {
        // Config shape differs across forks — defaults still work, just slower.
      }

      sharp = (await import('sharp')).default

      await checkPermissions()
    } catch (err) {
      permissionsOK = false
      permissionError = `Failed to load computer-use dependencies: ${err?.message ?? String(err)}`
    }
  },

  async execute(toolName, args) {
    const handler = TOOL_MAP[toolName]
    if (!handler) {
      return { success: false, error: `computer-use: unknown tool ${toolName}` }
    }
    return handler(args)
  }
}

export default plugin
