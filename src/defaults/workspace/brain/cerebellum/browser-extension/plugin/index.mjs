import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

let sharp = null

async function loadSharp() {
  if (sharp) return sharp
  try {
    sharp = (await import('sharp')).default
    return sharp
  } catch {
    return null
  }
}

/**
 * Bridge to the Wolffish extension WebSocket server.
 * The core server exposes this on globalThis when the extension connects.
 * null when disconnected.
 */
function getBridge() {
  return globalThis.__wolffishExtensionBridge ?? null
}

/**
 * Strip data URL prefix and return raw base64.
 * e.g. "data:image/png;base64,iVBOR..." → "iVBOR..."
 */
function stripDataUrl(dataUrl) {
  const idx = dataUrl.indexOf(',')
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl
}

/**
 * Map plugin tool names (ext_*) to extension command names (browser_*).
 * This mapping lets the SKILL.md use clean ext_ prefixed names while
 * the extension's service worker expects browser_ commands.
 */
function toCommand(toolName) {
  if (toolName.startsWith('ext_')) {
    return 'browser_' + toolName.slice(4)
  }
  return toolName
}

let workspaceRoot = ''

const toolDefinitions = [
  { name: 'ext_navigate', description: 'Navigate to a URL in the active tab of the connected browser.', parameters: { type: 'object', properties: { url: { type: 'string' }, waitUntil: { type: 'string' } }, required: ['url'] } },
  { name: 'ext_back', description: 'Navigate back in browser history.', parameters: { type: 'object', properties: { tabId: { type: 'number' } }, required: [] } },
  { name: 'ext_forward', description: 'Navigate forward in browser history.', parameters: { type: 'object', properties: { tabId: { type: 'number' } }, required: [] } },
  { name: 'ext_reload', description: 'Reload the current page.', parameters: { type: 'object', properties: { hard: { type: 'boolean' }, tabId: { type: 'number' } }, required: [] } },
  { name: 'ext_click', description: 'Click an element by CSS selector.', parameters: { type: 'object', properties: { selector: { type: 'string' }, tabId: { type: 'number' } }, required: ['selector'] } },
  { name: 'ext_type', description: 'Type text into an input element.', parameters: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' }, clearFirst: { type: 'boolean' }, humanize: { type: 'boolean' }, tabId: { type: 'number' } }, required: ['selector', 'text'] } },
  { name: 'ext_select', description: 'Select a dropdown value.', parameters: { type: 'object', properties: { selector: { type: 'string' }, value: { type: 'string' }, tabId: { type: 'number' } }, required: ['selector', 'value'] } },
  { name: 'ext_hover', description: 'Hover over an element.', parameters: { type: 'object', properties: { selector: { type: 'string' }, tabId: { type: 'number' } }, required: ['selector'] } },
  { name: 'ext_scroll', description: 'Scroll the page or element.', parameters: { type: 'object', properties: { direction: { type: 'string' }, amount: { type: 'number' }, selector: { type: 'string' }, tabId: { type: 'number' } }, required: ['direction'] } },
  { name: 'ext_focus', description: 'Focus an element.', parameters: { type: 'object', properties: { selector: { type: 'string' }, tabId: { type: 'number' } }, required: ['selector'] } },
  { name: 'ext_keypress', description: 'Press a key or shortcut.', parameters: { type: 'object', properties: { key: { type: 'string' }, modifiers: { type: 'string' }, tabId: { type: 'number' } }, required: ['key'] } },
  { name: 'ext_drag_drop', description: 'Drag and drop elements.', parameters: { type: 'object', properties: { sourceSelector: { type: 'string' }, targetSelector: { type: 'string' }, tabId: { type: 'number' } }, required: ['sourceSelector', 'targetSelector'] } },
  { name: 'ext_file_upload', description: 'Upload files to an input.', parameters: { type: 'object', properties: { selector: { type: 'string' }, files: { type: 'string' }, tabId: { type: 'number' } }, required: ['selector', 'files'] } },
  { name: 'ext_read_page', description: 'Extract page content as text, markdown, or HTML.', parameters: { type: 'object', properties: { format: { type: 'string' }, selector: { type: 'string' }, tabId: { type: 'number' } }, required: [] } },
  { name: 'ext_query_selector', description: 'Query DOM elements by CSS selector.', parameters: { type: 'object', properties: { selector: { type: 'string' }, attributes: { type: 'string' }, limit: { type: 'number' }, tabId: { type: 'number' } }, required: ['selector'] } },
  { name: 'ext_get_attribute', description: 'Read element attributes.', parameters: { type: 'object', properties: { selector: { type: 'string' }, attributes: { type: 'string' }, tabId: { type: 'number' } }, required: ['selector', 'attributes'] } },
  { name: 'ext_get_value', description: 'Read form field value.', parameters: { type: 'object', properties: { selector: { type: 'string' }, tabId: { type: 'number' } }, required: ['selector'] } },
  { name: 'ext_get_url', description: 'Get current URL and title.', parameters: { type: 'object', properties: { tabId: { type: 'number' } }, required: [] } },
  { name: 'ext_get_page_info', description: 'Get page metadata, links, headings, forms.', parameters: { type: 'object', properties: { tabId: { type: 'number' } }, required: [] } },
  { name: 'ext_tabs_list', description: 'List all open tabs.', parameters: { type: 'object', properties: { windowId: { type: 'number' } }, required: [] } },
  { name: 'ext_tab_open', description: 'Open a new tab.', parameters: { type: 'object', properties: { url: { type: 'string' }, active: { type: 'boolean' } }, required: [] } },
  { name: 'ext_tab_close', description: 'Close a tab.', parameters: { type: 'object', properties: { tabId: { type: 'number' } }, required: ['tabId'] } },
  { name: 'ext_tab_switch', description: 'Switch to a tab.', parameters: { type: 'object', properties: { tabId: { type: 'number' } }, required: ['tabId'] } },
  { name: 'ext_tab_duplicate', description: 'Duplicate a tab.', parameters: { type: 'object', properties: { tabId: { type: 'number' } }, required: ['tabId'] } },
  { name: 'ext_tab_move', description: 'Move a tab.', parameters: { type: 'object', properties: { tabId: { type: 'number' }, index: { type: 'number' }, windowId: { type: 'number' } }, required: ['tabId', 'index'] } },
  { name: 'ext_windows_list', description: 'List all windows.', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'ext_window_open', description: 'Open a new window.', parameters: { type: 'object', properties: { url: { type: 'string' }, incognito: { type: 'boolean' }, width: { type: 'number' }, height: { type: 'number' } }, required: [] } },
  { name: 'ext_window_close', description: 'Close a window.', parameters: { type: 'object', properties: { windowId: { type: 'number' } }, required: ['windowId'] } },
  { name: 'ext_window_resize', description: 'Resize or reposition a window.', parameters: { type: 'object', properties: { windowId: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, left: { type: 'number' }, top: { type: 'number' }, state: { type: 'string' } }, required: ['windowId'] } },
  { name: 'ext_screenshot', description: 'Screenshot the page or an element.', parameters: { type: 'object', properties: { format: { type: 'string' }, quality: { type: 'number' }, fullPage: { type: 'boolean' }, selector: { type: 'string' }, tabId: { type: 'number' } }, required: [] } },
  { name: 'ext_pdf', description: 'Save the page as PDF.', parameters: { type: 'object', properties: { tabId: { type: 'number' } }, required: [] } },
  { name: 'ext_cookies_get', description: 'Get cookies for a domain.', parameters: { type: 'object', properties: { domain: { type: 'string' }, name: { type: 'string' } }, required: ['domain'] } },
  { name: 'ext_cookies_set', description: 'Set a cookie.', parameters: { type: 'object', properties: { url: { type: 'string' }, name: { type: 'string' }, value: { type: 'string' }, domain: { type: 'string' }, path: { type: 'string' }, expires: { type: 'number' }, httpOnly: { type: 'boolean' }, secure: { type: 'boolean' } }, required: ['url', 'name', 'value'] } },
  { name: 'ext_cookies_remove', description: 'Remove a cookie.', parameters: { type: 'object', properties: { url: { type: 'string' }, name: { type: 'string' } }, required: ['url', 'name'] } },
  { name: 'ext_storage_get', description: 'Read localStorage or sessionStorage.', parameters: { type: 'object', properties: { type: { type: 'string' }, keys: { type: 'string' }, tabId: { type: 'number' } }, required: ['type'] } },
  { name: 'ext_storage_set', description: 'Write to localStorage or sessionStorage.', parameters: { type: 'object', properties: { type: { type: 'string' }, data: { type: 'string' }, tabId: { type: 'number' } }, required: ['type', 'data'] } },
  { name: 'ext_clipboard_read', description: 'Read clipboard text.', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'ext_clipboard_write', description: 'Write text to clipboard.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'ext_download', description: 'Download a file from a URL.', parameters: { type: 'object', properties: { url: { type: 'string' }, filename: { type: 'string' } }, required: ['url'] } },
  { name: 'ext_execute_js', description: 'Execute JavaScript in the page.', parameters: { type: 'object', properties: { code: { type: 'string' }, tabId: { type: 'number' }, world: { type: 'string' } }, required: ['code'] } },
  { name: 'ext_wait_for', description: 'Wait for an element to appear.', parameters: { type: 'object', properties: { selector: { type: 'string' }, timeout: { type: 'number' }, visible: { type: 'boolean' }, tabId: { type: 'number' } }, required: ['selector'] } },
  { name: 'ext_wait_for_navigation', description: 'Wait for page navigation.', parameters: { type: 'object', properties: { timeout: { type: 'number' }, tabId: { type: 'number' } }, required: [] } },
  { name: 'ext_wait_for_network_idle', description: 'Wait for network to settle.', parameters: { type: 'object', properties: { timeout: { type: 'number' }, idleTime: { type: 'number' }, tabId: { type: 'number' } }, required: [] } },
  { name: 'ext_notify', description: 'Show a browser notification.', parameters: { type: 'object', properties: { title: { type: 'string' }, message: { type: 'string' }, iconUrl: { type: 'string' } }, required: ['title', 'message'] } },
  { name: 'ext_debugger_attach', description: 'Attach Chrome debugger to a tab for trusted input events.', parameters: { type: 'object', properties: { tabId: { type: 'number' } }, required: ['tabId'] } },
  { name: 'ext_debugger_detach', description: 'Detach the debugger from the currently attached tab.', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'ext_debugger_status', description: 'Check whether the debugger is attached and to which tab.', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'ext_mouse_move', description: 'Move cursor to coordinates along a bezier curve path.', parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, tabId: { type: 'number' } }, required: ['x', 'y'] } },
  { name: 'ext_humanize', description: 'Inject a random human micro-action between real actions.', parameters: { type: 'object', properties: { intensity: { type: 'string' }, tabId: { type: 'number' } }, required: [] } }
]

const plugin = {
  name: 'browser-extension',
  tools: toolDefinitions,

  async init(context) {
    workspaceRoot = context?.workspaceRoot ?? ''
  },

  async execute(toolName, args) {
    const bridge = getBridge()
    if (!bridge) {
      return {
        success: false,
        error: 'Browser extension is not connected. Install and connect the Wolffish browser extension to use ext_* tools.'
      }
    }
    if (!bridge.isConnected()) {
      return {
        success: false,
        error: 'Browser extension is not connected. The extension may have disconnected — check the side panel.'
      }
    }

    const commandName = toCommand(toolName)

    try {
      const response = await bridge.sendCommand(commandName, args)

      if (!response.success) {
        return { success: false, error: response.error ?? 'Extension command failed' }
      }

      // Screenshot — resize, optimize, return inline
      if (toolName === 'ext_screenshot' && response.data) {
        const { image, width, height } = response.data
        const rawBase64 = stripDataUrl(image)
        const inputBuffer = Buffer.from(rawBase64, 'base64')

        const cfg = await bridge.getConfig?.() ?? {}
        const maxWidth = cfg.screenshotMaxWidth || 1280
        const format = cfg.screenshotFormat || 'jpeg'
        const quality = cfg.screenshotQuality || 80

        const sharpLib = await loadSharp()
        if (sharpLib) {
          let pipeline = sharpLib(inputBuffer)
          if (width > maxWidth) {
            pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true })
          }
          const finalWidth = width > maxWidth ? maxWidth : width
          const finalHeight = Math.round(height * (finalWidth / width))

          let buffer, mediaType
          if (format === 'png') {
            buffer = await pipeline.png().toBuffer()
            mediaType = 'image/png'
          } else {
            buffer = await pipeline.jpeg({ quality }).toBuffer()
            mediaType = 'image/jpeg'
          }

          return {
            success: true,
            output: `Screenshot taken (${finalWidth}x${finalHeight}, ${format}, ${(buffer.length / 1024).toFixed(0)}KB)`,
            images: [{ mediaType, data: buffer.toString('base64') }]
          }
        }

        // Fallback without sharp — pass through raw
        return {
          success: true,
          output: `Screenshot taken (${width}x${height})`,
          images: [{ mediaType: 'image/png', data: rawBase64 }]
        }
      }

      // PDF — save to workspace and return path
      if (toolName === 'ext_pdf' && response.data) {
        const pdfData = response.data.data
        const root = workspaceRoot || path.join(os.homedir(), '.wolffish', 'workspace')
        const filePath = path.join(root, 'files', `page-${Date.now()}.pdf`)
        await fs.writeFile(filePath, Buffer.from(pdfData, 'base64'))
        return { success: true, output: `PDF saved to ${filePath}` }
      }

      return { success: true, output: JSON.stringify(response.data ?? {}) }
    } catch (err) {
      return { success: false, error: err?.message || String(err) }
    }
  }
}

export default plugin
