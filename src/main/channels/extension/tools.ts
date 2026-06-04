import type { Capability, SkillToolDescriptor, WolffishPlugin } from '@main/runtime/cerebellum'
import { workspaceRoot } from '@main/workspace/workspace'
import fs from 'node:fs/promises'
import path from 'node:path'

export const EXTENSION_CAPABILITY_NAME = 'browser-extension'

interface WolffishResponse {
  id: string
  success: boolean
  data?: unknown
  error?: string
}

type ToolDeps = {
  sendCommand: (type: string, params: Record<string, unknown>) => Promise<WolffishResponse>
  isConnected: () => boolean
}

export function buildExtensionCapability(deps: ToolDeps): {
  capability: Capability
  plugin: WolffishPlugin
} {
  const tools: SkillToolDescriptor[] = [
    // ── Navigation ──
    {
      name: 'browser_navigate',
      description: 'Navigate to a URL in the active tab of the connected browser.',
      parameters: {
        url: { type: 'string', description: 'URL to navigate to.' },
        waitUntil: {
          type: 'string',
          description: 'When to consider navigation done.',
          enum: ['load', 'domcontentloaded'],
          required: false
        }
      }
    },
    {
      name: 'browser_back',
      description: 'Navigate back in browser history.',
      parameters: {
        tabId: { type: 'number', description: 'Target tab. Default active tab.', required: false }
      }
    },
    {
      name: 'browser_forward',
      description: 'Navigate forward in browser history.',
      parameters: {
        tabId: { type: 'number', description: 'Target tab. Default active tab.', required: false }
      }
    },
    {
      name: 'browser_reload',
      description: 'Reload the current page.',
      parameters: {
        hard: {
          type: 'boolean',
          description: 'Hard reload (bypass cache). Default false.',
          required: false
        },
        tabId: { type: 'number', description: 'Target tab. Default active tab.', required: false }
      }
    },
    // ── Page Interaction ──
    {
      name: 'browser_click',
      description: 'Click an element on the page by CSS selector.',
      parameters: {
        selector: { type: 'string', description: 'CSS selector of the element to click.' },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_type',
      description:
        'Type text into an input element. Simulates human-like keystroke events when humanize is true.',
      parameters: {
        selector: { type: 'string', description: 'CSS selector of the input element.' },
        text: { type: 'string', description: 'Text to type.' },
        clearFirst: {
          type: 'boolean',
          description: 'Clear the field before typing. Default false.',
          required: false
        },
        humanize: {
          type: 'boolean',
          description: 'Simulate human typing with random delays. Default false.',
          required: false
        },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_select',
      description: 'Select a value from a dropdown/select element.',
      parameters: {
        selector: { type: 'string', description: 'CSS selector of the select element.' },
        value: { type: 'string', description: 'Value to select.' },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_hover',
      description: 'Hover over an element to trigger hover states.',
      parameters: {
        selector: { type: 'string', description: 'CSS selector of the element to hover.' },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_scroll',
      description: 'Scroll the page or a specific element.',
      parameters: {
        direction: {
          type: 'string',
          description: 'Scroll direction.',
          enum: ['up', 'down', 'left', 'right']
        },
        amount: {
          type: 'number',
          description: 'Pixels to scroll. Default 500.',
          required: false
        },
        selector: {
          type: 'string',
          description: 'Element to scroll within. Default page.',
          required: false
        },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_focus',
      description: 'Focus an element on the page.',
      parameters: {
        selector: { type: 'string', description: 'CSS selector of the element to focus.' },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_keypress',
      description:
        'Press a keyboard key or combination (Enter, Tab, Escape, etc.) with optional modifiers.',
      parameters: {
        key: { type: 'string', description: 'Key to press (e.g. Enter, Tab, Escape, a).' },
        modifiers: {
          type: 'string',
          description: 'JSON array of modifier keys: ["ctrl"], ["shift"], ["alt"], ["meta"].',
          required: false
        },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_drag_drop',
      description: 'Drag an element and drop it on another.',
      parameters: {
        sourceSelector: { type: 'string', description: 'CSS selector of the drag source.' },
        targetSelector: { type: 'string', description: 'CSS selector of the drop target.' },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_file_upload',
      description: 'Upload files to a file input element.',
      parameters: {
        selector: { type: 'string', description: 'CSS selector of the file input.' },
        files: {
          type: 'string',
          description:
            'JSON array of files: [{"name":"file.txt","content":"base64data","mimeType":"text/plain"}].'
        },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    // ── Page Reading ──
    {
      name: 'browser_read_page',
      description: 'Extract text, markdown, or HTML content from the current page or an element.',
      parameters: {
        format: {
          type: 'string',
          description: 'Output format.',
          enum: ['text', 'markdown', 'html'],
          required: false
        },
        selector: {
          type: 'string',
          description: 'Extract only from this element. Default whole page.',
          required: false
        },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_query_selector',
      description:
        'Query DOM elements matching a CSS selector. Returns tag, text, attributes, rect.',
      parameters: {
        selector: { type: 'string', description: 'CSS selector to query.' },
        attributes: {
          type: 'string',
          description: 'JSON array of attribute names to extract.',
          required: false
        },
        limit: {
          type: 'number',
          description: 'Max elements to return. Default 20.',
          required: false
        },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_get_attribute',
      description: 'Get specific attributes from an element.',
      parameters: {
        selector: { type: 'string', description: 'CSS selector of the element.' },
        attributes: { type: 'string', description: 'JSON array of attribute names to read.' },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_get_value',
      description: 'Get the current value of an input/textarea/select element.',
      parameters: {
        selector: { type: 'string', description: 'CSS selector of the form element.' },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_get_url',
      description: 'Get the current URL and title of the active tab.',
      parameters: {
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_get_page_info',
      description:
        'Get comprehensive page info: URL, title, description, favicon, language, links, headings, forms.',
      parameters: {
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    // ── Tab Management ──
    {
      name: 'browser_tabs_list',
      description: 'List all open tabs with id, url, title, active state.',
      parameters: {
        windowId: {
          type: 'number',
          description: 'Filter to a specific window. Default all windows.',
          required: false
        }
      }
    },
    {
      name: 'browser_tab_open',
      description: 'Open a new tab, optionally with a URL.',
      parameters: {
        url: { type: 'string', description: 'URL to open. Default blank tab.', required: false },
        active: {
          type: 'boolean',
          description: 'Make the new tab active. Default true.',
          required: false
        }
      }
    },
    {
      name: 'browser_tab_close',
      description: 'Close a specific tab.',
      parameters: {
        tabId: { type: 'number', description: 'ID of the tab to close.' }
      }
    },
    {
      name: 'browser_tab_switch',
      description: 'Switch to a specific tab.',
      parameters: {
        tabId: { type: 'number', description: 'ID of the tab to activate.' }
      }
    },
    {
      name: 'browser_tab_duplicate',
      description: 'Duplicate a tab.',
      parameters: {
        tabId: { type: 'number', description: 'ID of the tab to duplicate.' }
      }
    },
    {
      name: 'browser_tab_move',
      description: 'Move a tab to a different position or window.',
      parameters: {
        tabId: { type: 'number', description: 'ID of the tab to move.' },
        index: { type: 'number', description: 'Target position index.' },
        windowId: {
          type: 'number',
          description: 'Target window. Default current window.',
          required: false
        }
      }
    },
    // ── Window Management ──
    {
      name: 'browser_windows_list',
      description: 'List all open browser windows.',
      parameters: {}
    },
    {
      name: 'browser_window_open',
      description: 'Open a new browser window.',
      parameters: {
        url: { type: 'string', description: 'URL to open.', required: false },
        incognito: {
          type: 'boolean',
          description: 'Open in incognito mode.',
          required: false
        },
        width: { type: 'number', description: 'Window width.', required: false },
        height: { type: 'number', description: 'Window height.', required: false }
      }
    },
    {
      name: 'browser_window_close',
      description: 'Close a browser window.',
      parameters: {
        windowId: { type: 'number', description: 'ID of the window to close.' }
      }
    },
    {
      name: 'browser_window_resize',
      description: 'Resize or reposition a browser window.',
      parameters: {
        windowId: { type: 'number', description: 'ID of the window.' },
        width: { type: 'number', description: 'New width.', required: false },
        height: { type: 'number', description: 'New height.', required: false },
        left: { type: 'number', description: 'New X position.', required: false },
        top: { type: 'number', description: 'New Y position.', required: false },
        state: {
          type: 'string',
          description: 'Window state.',
          enum: ['normal', 'minimized', 'maximized', 'fullscreen'],
          required: false
        }
      }
    },
    // ── Screenshots & Visual ──
    {
      name: 'browser_screenshot',
      description:
        'Take a screenshot of the current page or a specific element. Returns the image inline.',
      parameters: {
        format: {
          type: 'string',
          description: 'Image format.',
          enum: ['png', 'jpeg'],
          required: false
        },
        quality: {
          type: 'number',
          description: 'JPEG quality 0-100. Only for jpeg.',
          required: false
        },
        fullPage: {
          type: 'boolean',
          description: 'Capture the full scrollable page.',
          required: false
        },
        selector: {
          type: 'string',
          description: 'CSS selector to screenshot a specific element.',
          required: false
        },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_pdf',
      description: 'Save the current page as a PDF. Returns the file path.',
      parameters: {
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    // ── Cookies & Storage ──
    {
      name: 'browser_cookies_get',
      description: 'Get cookies for a domain.',
      parameters: {
        domain: { type: 'string', description: 'Cookie domain to query.' },
        name: {
          type: 'string',
          description: 'Filter by cookie name.',
          required: false
        }
      }
    },
    {
      name: 'browser_cookies_set',
      description: 'Set a cookie.',
      parameters: {
        url: { type: 'string', description: 'URL to associate the cookie with.' },
        name: { type: 'string', description: 'Cookie name.' },
        value: { type: 'string', description: 'Cookie value.' },
        domain: { type: 'string', description: 'Cookie domain.', required: false },
        path: { type: 'string', description: 'Cookie path.', required: false },
        expires: { type: 'number', description: 'Expiry timestamp.', required: false },
        httpOnly: { type: 'boolean', description: 'HTTP-only flag.', required: false },
        secure: { type: 'boolean', description: 'Secure flag.', required: false }
      }
    },
    {
      name: 'browser_cookies_remove',
      description: 'Remove a cookie.',
      parameters: {
        url: { type: 'string', description: 'URL of the cookie.' },
        name: { type: 'string', description: 'Cookie name to remove.' }
      }
    },
    {
      name: 'browser_storage_get',
      description: "Get data from the page's localStorage or sessionStorage.",
      parameters: {
        type: {
          type: 'string',
          description: 'Storage type.',
          enum: ['local', 'session']
        },
        keys: {
          type: 'string',
          description: 'JSON array of key names. Default all keys.',
          required: false
        },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_storage_set',
      description: "Set data in the page's localStorage or sessionStorage.",
      parameters: {
        type: {
          type: 'string',
          description: 'Storage type.',
          enum: ['local', 'session']
        },
        data: {
          type: 'string',
          description: 'JSON object of key-value pairs to set.'
        },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    // ── Clipboard ──
    {
      name: 'browser_clipboard_read',
      description: 'Read the clipboard text content.',
      parameters: {}
    },
    {
      name: 'browser_clipboard_write',
      description: 'Write text to the clipboard.',
      parameters: {
        text: { type: 'string', description: 'Text to write to the clipboard.' }
      }
    },
    // ── Downloads ──
    {
      name: 'browser_download',
      description: 'Download a file from a URL.',
      parameters: {
        url: { type: 'string', description: 'URL of the file to download.' },
        filename: {
          type: 'string',
          description: 'Suggested filename.',
          required: false
        }
      }
    },
    // ── JavaScript Execution ──
    {
      name: 'browser_execute_js',
      description:
        'Execute JavaScript code in the page context. DANGEROUS — requires user approval.',
      parameters: {
        code: { type: 'string', description: 'JavaScript code to execute.' },
        tabId: { type: 'number', description: 'Target tab.', required: false },
        world: {
          type: 'string',
          description: 'Execution world.',
          enum: ['ISOLATED', 'MAIN'],
          required: false
        }
      }
    },
    // ── Wait & Polling ──
    {
      name: 'browser_wait_for',
      description: 'Wait for an element to appear on the page.',
      parameters: {
        selector: { type: 'string', description: 'CSS selector to wait for.' },
        timeout: {
          type: 'number',
          description: 'Max wait time in ms. Default 30000.',
          required: false
        },
        visible: {
          type: 'boolean',
          description: 'Wait for the element to be visible. Default false.',
          required: false
        },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_wait_for_navigation',
      description: 'Wait for the next page navigation to complete.',
      parameters: {
        timeout: {
          type: 'number',
          description: 'Max wait time in ms. Default 30000.',
          required: false
        },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    {
      name: 'browser_wait_for_network_idle',
      description: 'Wait until network activity settles.',
      parameters: {
        timeout: {
          type: 'number',
          description: 'Max wait time in ms. Default 30000.',
          required: false
        },
        idleTime: {
          type: 'number',
          description: 'Time with no requests to consider idle. Default 500ms.',
          required: false
        },
        tabId: { type: 'number', description: 'Target tab.', required: false }
      }
    },
    // ── Notifications ──
    {
      name: 'browser_notify',
      description: 'Show a browser notification.',
      parameters: {
        title: { type: 'string', description: 'Notification title.' },
        message: { type: 'string', description: 'Notification body text.' },
        iconUrl: {
          type: 'string',
          description: 'URL of the notification icon.',
          required: false
        }
      }
    }
  ]

  const capability: Capability = {
    name: EXTENSION_CAPABILITY_NAME,
    dir: '<in-process>',
    description:
      "Control the user's connected Chrome/Brave browser via the Wolffish extension. Navigate pages, click elements, fill forms, take screenshots, read page content, manage tabs/windows, and execute JavaScript — all in the user's real browser session with their cookies, logins, and extensions. ALWAYS prefer these tools over the Playwright-based browser tools when available — the extension operates in the user's actual browser, not an isolated session.",
    triggers: {
      keywords: [
        'browser',
        'extension',
        'chrome',
        'brave',
        'web',
        'navigate',
        'click',
        'tab',
        'screenshot',
        'cookie',
        'page',
        'url',
        'form',
        'download',
        'scrape'
      ]
    },
    tools,
    body: '',
    hasPlugin: true,
    status: 'ok',
    requires: [],
    packages: {},
    npmDependencies: {}
  }

  const plugin: WolffishPlugin = {
    name: EXTENSION_CAPABILITY_NAME,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: toJsonSchema(t.parameters)
    })),
    execute: async (toolName, args) => {
      if (!deps.isConnected()) {
        return {
          success: false,
          error:
            'Browser extension is not connected. The user needs to install and connect the Wolffish browser extension.'
        }
      }
      try {
        const response = await deps.sendCommand(toolName, args)
        if (!response.success) {
          return { success: false, error: response.error ?? 'Extension command failed' }
        }

        if (toolName === 'browser_screenshot' && response.data) {
          const { image, width, height } = response.data as {
            image: string
            width: number
            height: number
          }
          return {
            success: true,
            output: `Screenshot taken (${width}x${height})`,
            images: [{ mediaType: 'image/png', data: image }]
          }
        }

        if (toolName === 'browser_pdf' && response.data) {
          const pdfData = (response.data as { data: string }).data
          const root = workspaceRoot()
          const filePath = path.join(root, 'files', `page-${Date.now()}.pdf`)
          await fs.writeFile(filePath, Buffer.from(pdfData, 'base64'))
          return { success: true, output: `PDF saved to ${filePath}` }
        }

        return { success: true, output: JSON.stringify(response.data ?? {}) }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    }
  }

  return { capability, plugin }
}

function toJsonSchema(
  parameters: Record<
    string,
    { type?: string; description?: string; enum?: string[]; required?: boolean }
  >
): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, spec] of Object.entries(parameters)) {
    const prop: Record<string, unknown> = { type: spec.type ?? 'string' }
    if (spec.description) prop.description = spec.description
    if (spec.enum) prop.enum = spec.enum
    properties[key] = prop
    if (spec.required !== false) required.push(key)
  }
  return { type: 'object', properties, required }
}
