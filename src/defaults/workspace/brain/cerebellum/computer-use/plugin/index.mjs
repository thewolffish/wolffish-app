import fs from 'node:fs/promises'
import path from 'node:path'

let nutMouse, nutKeyboard, nutKey, nutButton, nutPoint, nutStraightTo
let electronScreen, electronDesktopCapturer, electronNativeImage
let sharp
let permissionsOK = false
let permissionError = null
let workspaceRoot = ''
let getConversationId = () => null
let screenshotCounter = 0
let lastScreenshotMapping = null
let lastScreenshotSize = null

const DEFAULT_MAX_WIDTH = 1280
const DEFAULT_FORMAT = 'jpeg'

const KEY_MAP = {
  enter: 'Return',
  return: 'Return',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  space: 'Space',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
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
  shift: 'LeftShift',
  meta: 'LeftSuper',
  cmd: 'LeftSuper',
  command: 'LeftSuper',
  super: 'LeftSuper',
  win: 'LeftSuper'
}

function resolveKey(Key, name) {
  const lower = name.toLowerCase().trim()
  const mapped = KEY_MAP[lower]
  if (mapped && Key[mapped] !== undefined) return Key[mapped]
  if (name.length === 1) {
    const upper = name.toUpperCase()
    if (Key[upper] !== undefined) return Key[upper]
  }
  const direct = Key[name]
  if (direct !== undefined) return direct
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

function validateCoordinates(x, y) {
  if (!lastScreenshotSize) return null
  const { width, height } = lastScreenshotSize
  if (x < 0 || x > width || y < 0 || y > height) {
    return `Coordinates (${x}, ${y}) are outside the screenshot bounds. Valid range: x 0–${width}, y 0–${height}. Use the image pixel coordinates from the screenshot, not screen coordinates.`
  }
  return null
}

function scaleToScreen(x, y) {
  if (!lastScreenshotMapping) return { x, y }
  const { scale, offsetX, offsetY } = lastScreenshotMapping
  return {
    x: Math.round(x * scale + offsetX),
    y: Math.round(y * scale + offsetY)
  }
}

async function takeScreenshot(args) {
  const denied = requirePermissions()
  if (denied) return denied

  try {
    const cfg = await readConfig()
    const maxWidth = cfg.screenshotMaxWidth || DEFAULT_MAX_WIDTH
    const format = cfg.screenshotFormat || DEFAULT_FORMAT
    const displayIndex = Number(args?.display_index) || 0

    const displays = electronScreen.getAllDisplays()
    const display = displays[displayIndex] || electronScreen.getPrimaryDisplay()

    const sources = await electronDesktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: display.size.width * display.scaleFactor, height: display.size.height * display.scaleFactor }
    })

    const displayId = String(display.id)
    let source = sources.find((s) => s.display_id === displayId)
    if (!source) source = sources[displayIndex] || sources[0]
    if (!source) {
      return { success: false, error: 'No screen source found for capture.' }
    }

    const thumbnail = source.thumbnail
    const nativeWidth = thumbnail.getSize().width
    const nativeHeight = thumbnail.getSize().height

    if (nativeWidth === 0 || nativeHeight === 0) {
      return { success: false, error: 'Screenshot returned empty image. Check Screen Recording permission in System Settings → Privacy & Security.' }
    }

    const pngBuffer = thumbnail.toPNG()
    const finalImageWidth = nativeWidth > maxWidth ? maxWidth : nativeWidth

    let pipeline = sharp(pngBuffer)
    if (nativeWidth > maxWidth) {
      pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true })
    }

    const finalImageHeight = Math.round(nativeHeight * (finalImageWidth / nativeWidth))

    lastScreenshotMapping = {
      scale: display.size.width / finalImageWidth,
      offsetX: display.bounds.x,
      offsetY: display.bounds.y
    }
    lastScreenshotSize = { width: finalImageWidth, height: finalImageHeight }

    let buffer, mediaType
    if (format === 'png') {
      buffer = await pipeline.png().toBuffer()
      mediaType = 'image/png'
    } else {
      buffer = await pipeline.jpeg({ quality: 80 }).toBuffer()
      mediaType = 'image/jpeg'
    }

    const base64 = buffer.toString('base64')
    const displayInfo = displays.length > 1 ? ` (display ${displayIndex + 1} of ${displays.length})` : ''
    const ext = format === 'png' ? 'png' : 'jpg'

    // Persist screenshot to disk for chat rendering and Telegram/WhatsApp media
    let savedPath = ''
    try {
      const convId = getConversationId()
      const safe = (convId ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '_')
      const dir = path.join(workspaceRoot, 'screenshots', `conv-${safe}`)
      await fs.mkdir(dir, { recursive: true })
      screenshotCounter++
      const filename = `shot-${Date.now()}-${screenshotCounter}.${ext}`
      const filePath = path.join(dir, filename)
      await fs.writeFile(filePath, buffer)
      savedPath = filePath
    } catch {
      // Non-fatal — image is still returned inline via base64
    }

    const pathLine = savedPath ? `\n${savedPath}` : ''
    return {
      success: true,
      output: `Screenshot captured (${finalImageWidth}x${finalImageHeight}, ${format})${displayInfo}. Click coordinates must be within this image: x 0–${finalImageWidth}, y 0–${finalImageHeight}. Coordinates are automatically translated to screen position.${pathLine}`,
      images: [{ mediaType, data: base64 }]
    }
  } catch (err) {
    return { success: false, error: `Screenshot failed: ${err?.message ?? String(err)}` }
  }
}

async function listDisplays() {
  try {
    const displays = electronScreen.getAllDisplays()
    const primary = electronScreen.getPrimaryDisplay()
    const lines = displays.map((d, i) => {
      const isPrimary = d.id === primary.id ? ' (primary)' : ''
      return `Display ${i}: ${d.size.width}x${d.size.height} @ ${d.scaleFactor}x, bounds (${d.bounds.x},${d.bounds.y})${isPrimary}`
    })
    return { success: true, output: lines.join('\n') }
  } catch (err) {
    return { success: false, error: `Failed to list displays: ${err?.message ?? String(err)}` }
  }
}

async function mouseMove(args) {
  const denied = requirePermissions()
  if (denied) return denied

  const x = Number(args?.x)
  const y = Number(args?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { success: false, error: 'x and y coordinates are required (finite numbers)' }
  }

  const boundsError = validateCoordinates(x, y)
  if (boundsError) return { success: false, error: boundsError }

  try {
    const scaled = scaleToScreen(x, y)
    await nutMouse.move(nutStraightTo(new nutPoint(scaled.x, scaled.y)))
    return { success: true, output: `Moved cursor to (${x}, ${y}) → screen (${scaled.x}, ${scaled.y})` }
  } catch (err) {
    return { success: false, error: `Mouse move failed: ${err?.message ?? String(err)}` }
  }
}

async function mouseClick(args) {
  const denied = requirePermissions()
  if (denied) return denied

  const x = args?.x !== undefined ? Number(args.x) : null
  const y = args?.y !== undefined ? Number(args.y) : null
  const buttonName = String(args?.button ?? 'left').toLowerCase()
  const isDouble = args?.double === true

  let button
  switch (buttonName) {
    case 'right':
      button = nutButton.RIGHT
      break
    case 'middle':
      button = nutButton.MIDDLE
      break
    default:
      button = nutButton.LEFT
  }

  if (x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y)) {
    const boundsError = validateCoordinates(x, y)
    if (boundsError) return { success: false, error: boundsError }
  }

  try {
    if (x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y)) {
      const scaled = scaleToScreen(x, y)
      await nutMouse.move(nutStraightTo(new nutPoint(scaled.x, scaled.y)))
    }

    if (isDouble) {
      await nutMouse.doubleClick(button)
    } else {
      await nutMouse.click(button)
    }

    const pos = await nutMouse.getPosition()
    const clickType = isDouble ? 'Double-clicked' : 'Clicked'
    return {
      success: true,
      output: `${clickType} ${buttonName} button at (${Math.round(pos.x)}, ${Math.round(pos.y)})`
    }
  } catch (err) {
    return { success: false, error: `Mouse click failed: ${err?.message ?? String(err)}` }
  }
}

async function mouseScroll(args) {
  const denied = requirePermissions()
  if (denied) return denied

  const direction = String(args?.direction ?? 'down').toLowerCase()
  const amount = Math.max(1, Math.min(100, Number(args?.amount) || 3))

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
    return { success: true, output: `Scrolled ${direction} by ${amount} units` }
  } catch (err) {
    return { success: false, error: `Scroll failed: ${err?.message ?? String(err)}` }
  }
}

async function keyboardType(args) {
  const denied = requirePermissions()
  if (denied) return denied

  const text = String(args?.text ?? '')
  if (text.length === 0) {
    return { success: false, error: 'text is required and must be non-empty' }
  }

  try {
    await nutKeyboard.type(text)
    return { success: true, output: `Typed ${text.length} characters` }
  } catch (err) {
    return { success: false, error: `Keyboard type failed: ${err?.message ?? String(err)}` }
  }
}

async function keyboardPress(args) {
  const denied = requirePermissions()
  if (denied) return denied

  const keyName = String(args?.key ?? '').trim()
  if (keyName.length === 0) {
    return { success: false, error: 'key is required' }
  }

  const modifierStr = String(args?.modifiers ?? '')
  const modifierNames = modifierStr
    .split(',')
    .map((m) => m.trim().toLowerCase())
    .filter((m) => m.length > 0)

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
  await new Promise((r) => setTimeout(r, ms))
  return { success: true, output: `Waited ${ms}ms` }
}

const TOOL_MAP = {
  computer_screenshot: takeScreenshot,
  computer_list_displays: listDisplays,
  computer_mouse_move: mouseMove,
  computer_mouse_click: mouseClick,
  computer_mouse_scroll: mouseScroll,
  computer_keyboard_type: keyboardType,
  computer_keyboard_press: keyboardPress,
  computer_wait: waitMs
}

const toolDefinitions = [
  {
    name: 'computer_screenshot',
    description:
      'Take a screenshot of the full screen. Returns the screenshot as an image. Always call this first to see the current state.',
    parameters: {
      type: 'object',
      properties: {
        display_index: { type: 'number', description: 'Display index (default 0 = primary). Use computer_list_displays to see available displays.' }
      },
      required: []
    }
  },
  {
    name: 'computer_list_displays',
    description: 'List all connected displays with their resolution, scale factor, and position.',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'computer_mouse_move',
    description: 'Move the mouse cursor to absolute x,y pixel coordinates.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (pixels from left)' },
        y: { type: 'number', description: 'Y coordinate (pixels from top)' }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'computer_mouse_click',
    description: 'Click the mouse at current position or specified coordinates.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (optional, moves cursor first)' },
        y: { type: 'number', description: 'Y coordinate (optional, moves cursor first)' },
        button: {
          type: 'string',
          enum: ['left', 'right', 'middle'],
          description: 'Mouse button (default left)'
        },
        double: { type: 'boolean', description: 'Double-click instead of single click' }
      },
      required: []
    }
  },
  {
    name: 'computer_mouse_scroll',
    description: 'Scroll the mouse wheel.',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Scroll direction'
        },
        amount: { type: 'number', description: 'Scroll units (default 3)' }
      },
      required: ['direction']
    }
  },
  {
    name: 'computer_keyboard_type',
    description: 'Type a string of text at the current cursor position.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' }
      },
      required: ['text']
    }
  },
  {
    name: 'computer_keyboard_press',
    description: 'Press a key or key combination.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name (e.g. enter, tab, a, f5)' },
        modifiers: {
          type: 'string',
          description: 'Comma-separated modifiers: ctrl, alt, shift, meta, cmd'
        }
      },
      required: ['key']
    }
  },
  {
    name: 'computer_wait',
    description: 'Wait/sleep for the given number of milliseconds before the next action (e.g. 500–2000ms for a UI transition). No cap — you decide. A wait cannot be interrupted once in flight, so split very long waits into several computer_wait calls rather than one giant sleep.',
    parameters: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Milliseconds to wait. No cap; split very long waits across multiple calls.' }
      },
      required: ['ms']
    }
  }
]

function describeAction(toolName, args) {
  switch (toolName) {
    case 'computer_screenshot':
      return { title: 'Take screenshot', description: 'Capture the current screen', risk: 'low' }
    case 'computer_list_displays':
      return { title: 'List displays', description: 'List all connected displays', risk: 'low' }
    case 'computer_mouse_move': {
      const x = args?.x ?? '?'
      const y = args?.y ?? '?'
      return {
        title: 'Move cursor',
        description: `Move mouse to (${x}, ${y})`,
        risk: 'low'
      }
    }
    case 'computer_mouse_click': {
      const x = args?.x ?? 'current'
      const y = args?.y ?? 'current'
      const btn = args?.button ?? 'left'
      const dbl = args?.double ? 'Double-click' : 'Click'
      return {
        title: `${dbl} ${btn}`,
        description: `${dbl} ${btn} button at (${x}, ${y})`,
        risk: 'medium'
      }
    }
    case 'computer_mouse_scroll': {
      const dir = args?.direction ?? 'down'
      const amt = args?.amount ?? 3
      return {
        title: `Scroll ${dir}`,
        description: `Scroll ${dir} by ${amt} units`,
        risk: 'low'
      }
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
      return {
        title: 'Press key',
        description: `Press ${mods}${key}`,
        command: `${mods}${key}`,
        risk: 'medium'
      }
    }
    case 'computer_wait':
      return {
        title: 'Wait',
        description: `Wait ${args?.ms ?? 0}ms`,
        risk: 'low'
      }
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
      electronNativeImage = electron.nativeImage
    } catch {
      // Will fall back to error in takeScreenshot
    }

    try {
      const nut = await import('@nut-tree-fork/nut-js')
      nutMouse = nut.mouse
      nutKeyboard = nut.keyboard
      nutKey = nut.Key
      nutButton = nut.Button
      nutPoint = nut.Point
      nutStraightTo = nut.straightTo

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
