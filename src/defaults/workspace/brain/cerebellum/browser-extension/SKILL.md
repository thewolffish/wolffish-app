---
name: browser-extension
description: Control the user's connected Chrome/Brave browser via the Wolffish extension — navigate pages, click elements, fill forms, take screenshots, read content, manage tabs, and execute JavaScript in the user's real browser session.
triggers:
  - browser
  - extension
  - chrome
  - brave
  - web
  - navigate
  - click
  - tab
  - screenshot
  - cookie
  - page
  - url
  - form
  - download
  - scrape
  - open page
  - go to
  - visit
  - site
  - website
  - webpage
  - link
  - browse
  - surf
  - search
  - fill
  - submit
  - button
  - input
  - type
  - scroll
  - reload
  - refresh
  - bookmark
  - history
  - javascript
  - console
  - inspect
  - element
  - selector
  - dom
  - html
  - content
  - extract
  - read page
  - capture
  - new tab
  - close tab
  - switch tab
  - my browser
  - real browser
  - actual browser
  - connected browser
  - active tab
  - current tab
  - current page
  - open tabs
  - window management
  - browser window
  - resize window
  - full screen
  - developer tools
  - devtools
  - network tab
  - local storage
  - session storage
  - clear cache
  - clear cookies
  - notification
  - popup
  - in my browser
  - on this page
  - what's on the page
  - copy from page
  - read this page
  - grab from page
  - save this page
  - print this page
tools:
  # Navigation
  - name: ext_navigate
    description: Navigate to a URL in the active tab of the connected browser.
    parameters:
      url:
        type: string
        description: URL to navigate to.
      waitUntil:
        type: string
        description: When to consider navigation done.
        enum: [load, domcontentloaded]
        required: false
  - name: ext_back
    description: Navigate back in browser history.
    parameters:
      tabId:
        type: number
        description: Target tab. Default active tab.
        required: false
  - name: ext_forward
    description: Navigate forward in browser history.
    parameters:
      tabId:
        type: number
        description: Target tab. Default active tab.
        required: false
  - name: ext_reload
    description: Reload the current page.
    parameters:
      hard:
        type: boolean
        description: Hard reload (bypass cache). Default false.
        required: false
      tabId:
        type: number
        description: Target tab. Default active tab.
        required: false
  # Page Interaction
  - name: ext_click
    description: Click an element on the page by CSS selector.
    parameters:
      selector:
        type: string
        description: CSS selector of the element to click.
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_type
    description: Type text into an input element with optional human-like keystroke simulation.
    parameters:
      selector:
        type: string
        description: CSS selector of the input element.
      text:
        type: string
        description: Text to type.
      clearFirst:
        type: boolean
        description: Clear the field before typing. Default false.
        required: false
      humanize:
        type: boolean
        description: Simulate human typing with random delays. Default false.
        required: false
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_select
    description: Select a value from a dropdown/select element.
    parameters:
      selector:
        type: string
        description: CSS selector of the select element.
      value:
        type: string
        description: Value to select.
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_hover
    description: Hover over an element to trigger hover states.
    parameters:
      selector:
        type: string
        description: CSS selector of the element to hover.
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_scroll
    description: Scroll the page or a specific element.
    parameters:
      direction:
        type: string
        description: Scroll direction.
        enum: [up, down, left, right]
      amount:
        type: number
        description: Pixels to scroll. Default 500.
        required: false
      selector:
        type: string
        description: Element to scroll within. Default page.
        required: false
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_focus
    description: Focus an element on the page.
    parameters:
      selector:
        type: string
        description: CSS selector of the element to focus.
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_keypress
    description: Press a keyboard key or combination with optional modifiers.
    parameters:
      key:
        type: string
        description: Key to press (e.g. Enter, Tab, Escape, a).
      modifiers:
        type: string
        description: 'JSON array of modifier keys: ["ctrl"], ["shift"], ["alt"], ["meta"].'
        required: false
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_drag_drop
    description: Drag an element and drop it on another.
    parameters:
      sourceSelector:
        type: string
        description: CSS selector of the drag source.
      targetSelector:
        type: string
        description: CSS selector of the drop target.
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_file_upload
    description: Upload files to a file input element.
    parameters:
      selector:
        type: string
        description: CSS selector of the file input.
      files:
        type: string
        description: 'JSON array of files: [{"name":"file.txt","content":"base64data","mimeType":"text/plain"}].'
      tabId:
        type: number
        description: Target tab.
        required: false
  # Page Reading
  - name: ext_read_page
    description: Extract page content as text, markdown, or HTML.
    parameters:
      format:
        type: string
        description: Output format.
        enum: [text, markdown, html]
        required: false
      selector:
        type: string
        description: Extract only from this element. Default whole page.
        required: false
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_query_selector
    description: Query DOM elements matching a CSS selector. Returns tag, text, attributes, rect.
    parameters:
      selector:
        type: string
        description: CSS selector to query.
      attributes:
        type: string
        description: JSON array of attribute names to extract.
        required: false
      limit:
        type: number
        description: Max elements to return. Default 20.
        required: false
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_get_attribute
    description: Get specific attributes from an element.
    parameters:
      selector:
        type: string
        description: CSS selector of the element.
      attributes:
        type: string
        description: JSON array of attribute names to read.
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_get_value
    description: Get the current value of an input/textarea/select element.
    parameters:
      selector:
        type: string
        description: CSS selector of the form element.
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_get_url
    description: Get the current URL and title of the active tab.
    parameters:
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_get_page_info
    description: Get comprehensive page info — URL, title, description, favicon, language, links, headings, forms.
    parameters:
      tabId:
        type: number
        description: Target tab.
        required: false
  # Tab Management
  - name: ext_tabs_list
    description: List all open tabs with id, url, title, active state.
    parameters:
      windowId:
        type: number
        description: Filter to a specific window. Default all windows.
        required: false
  - name: ext_tab_open
    description: Open a new tab, optionally with a URL.
    parameters:
      url:
        type: string
        description: URL to open. Default blank tab.
        required: false
      active:
        type: boolean
        description: Make the new tab active. Default true.
        required: false
  - name: ext_tab_close
    description: Close a specific tab.
    parameters:
      tabId:
        type: number
        description: ID of the tab to close.
  - name: ext_tab_switch
    description: Switch to a specific tab.
    parameters:
      tabId:
        type: number
        description: ID of the tab to activate.
  - name: ext_tab_duplicate
    description: Duplicate a tab.
    parameters:
      tabId:
        type: number
        description: ID of the tab to duplicate.
  - name: ext_tab_move
    description: Move a tab to a different position or window.
    parameters:
      tabId:
        type: number
        description: ID of the tab to move.
      index:
        type: number
        description: Target position index.
      windowId:
        type: number
        description: Target window. Default current window.
        required: false
  # Window Management
  - name: ext_windows_list
    description: List all open browser windows.
    parameters: {}
  - name: ext_window_open
    description: Open a new browser window.
    parameters:
      url:
        type: string
        description: URL to open.
        required: false
      incognito:
        type: boolean
        description: Open in incognito mode.
        required: false
      width:
        type: number
        description: Window width.
        required: false
      height:
        type: number
        description: Window height.
        required: false
  - name: ext_window_close
    description: Close a browser window.
    parameters:
      windowId:
        type: number
        description: ID of the window to close.
  - name: ext_window_resize
    description: Resize or reposition a browser window.
    parameters:
      windowId:
        type: number
        description: ID of the window.
      width:
        type: number
        description: New width.
        required: false
      height:
        type: number
        description: New height.
        required: false
      left:
        type: number
        description: New X position.
        required: false
      top:
        type: number
        description: New Y position.
        required: false
      state:
        type: string
        description: Window state.
        enum: [normal, minimized, maximized, fullscreen]
        required: false
  # Screenshots & Visual
  - name: ext_screenshot
    description: Take a screenshot of the current page or a specific element. Returns the image inline.
    parameters:
      format:
        type: string
        description: Image format.
        enum: [png, jpeg]
        required: false
      quality:
        type: number
        description: JPEG quality 0-100. Only for jpeg.
        required: false
      fullPage:
        type: boolean
        description: Capture the full scrollable page.
        required: false
      selector:
        type: string
        description: CSS selector to screenshot a specific element.
        required: false
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_pdf
    description: Save the current page as a PDF. Returns the file path.
    parameters:
      tabId:
        type: number
        description: Target tab.
        required: false
  # Cookies & Storage
  - name: ext_cookies_get
    description: Get cookies for a domain.
    parameters:
      domain:
        type: string
        description: Cookie domain to query.
      name:
        type: string
        description: Filter by cookie name.
        required: false
  - name: ext_cookies_set
    description: Set a cookie.
    parameters:
      url:
        type: string
        description: URL to associate the cookie with.
      name:
        type: string
        description: Cookie name.
      value:
        type: string
        description: Cookie value.
      domain:
        type: string
        description: Cookie domain.
        required: false
      path:
        type: string
        description: Cookie path.
        required: false
      expires:
        type: number
        description: Expiry timestamp.
        required: false
      httpOnly:
        type: boolean
        description: HTTP-only flag.
        required: false
      secure:
        type: boolean
        description: Secure flag.
        required: false
  - name: ext_cookies_remove
    description: Remove a cookie.
    parameters:
      url:
        type: string
        description: URL of the cookie.
      name:
        type: string
        description: Cookie name to remove.
  - name: ext_storage_get
    description: Get data from the page's localStorage or sessionStorage.
    parameters:
      type:
        type: string
        description: Storage type.
        enum: [local, session]
      keys:
        type: string
        description: JSON array of key names. Default all keys.
        required: false
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_storage_set
    description: Set data in the page's localStorage or sessionStorage.
    parameters:
      type:
        type: string
        description: Storage type.
        enum: [local, session]
      data:
        type: string
        description: JSON object of key-value pairs to set.
      tabId:
        type: number
        description: Target tab.
        required: false
  # Clipboard
  - name: ext_clipboard_read
    description: Read the clipboard text content.
    parameters: {}
  - name: ext_clipboard_write
    description: Write text to the clipboard.
    parameters:
      text:
        type: string
        description: Text to write to the clipboard.
  # Downloads
  - name: ext_download
    description: Download a file from a URL.
    parameters:
      url:
        type: string
        description: URL of the file to download.
      filename:
        type: string
        description: Suggested filename.
        required: false
  # JavaScript Execution
  - name: ext_execute_js
    description: Execute JavaScript code in the page context. DANGEROUS — requires user approval.
    parameters:
      code:
        type: string
        description: JavaScript code to execute.
      tabId:
        type: number
        description: Target tab.
        required: false
      world:
        type: string
        description: Execution world.
        enum: [ISOLATED, MAIN]
        required: false
  # Wait & Polling
  - name: ext_wait_for
    description: Wait for an element to appear on the page.
    parameters:
      selector:
        type: string
        description: CSS selector to wait for.
      timeout:
        type: number
        description: Max wait time in ms. Default 30000.
        required: false
      visible:
        type: boolean
        description: Wait for the element to be visible. Default false.
        required: false
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_wait_for_navigation
    description: Wait for the next page navigation to complete.
    parameters:
      timeout:
        type: number
        description: Max wait time in ms. Default 30000.
        required: false
      tabId:
        type: number
        description: Target tab.
        required: false
  - name: ext_wait_for_network_idle
    description: Wait until network activity settles.
    parameters:
      timeout:
        type: number
        description: Max wait time in ms. Default 30000.
        required: false
      idleTime:
        type: number
        description: Time with no requests to consider idle. Default 500ms.
        required: false
      tabId:
        type: number
        description: Target tab.
        required: false
  # Notifications
  - name: ext_notify
    description: Show a browser notification.
    parameters:
      title:
        type: string
        description: Notification title.
      message:
        type: string
        description: Notification body text.
      iconUrl:
        type: string
        description: URL of the notification icon.
        required: false
  # Debugger Mode
  - name: ext_debugger_attach
    description: 'Attach Chrome debugger to a tab for trusted input events (isTrusted: true). All subsequent interactions on that tab use CDP instead of content scripts.'
    parameters:
      tabId:
        type: number
        description: ID of the tab to attach the debugger to.
  - name: ext_debugger_detach
    description: Detach the debugger from the currently attached tab. No-op if nothing is attached.
    parameters: {}
  - name: ext_debugger_status
    description: Check whether the debugger is currently attached and to which tab.
    parameters: {}
  # Mouse Move
  - name: ext_mouse_move
    description: Move the cursor to target coordinates along a bezier curve path. In debugger mode, produces real mouse movement events.
    parameters:
      x:
        type: number
        description: Target X coordinate (pixels from left).
      y:
        type: number
        description: Target Y coordinate (pixels from top).
      tabId:
        type: number
        description: Target tab.
        required: false
  # Humanize
  - name: ext_humanize
    description: Inject a single random human-like micro-action (pause, scroll, cursor drift) between real actions to break robotic patterns.
    parameters:
      intensity:
        type: string
        description: How pronounced the micro-action should be.
        enum: [light, moderate, heavy]
        required: false
      tabId:
        type: number
        description: Target tab.
        required: false
danger_patterns:
  - pattern: 'ext_execute_js\s.*document\.cookie'
    level: block
    reason: Cookie exfiltration via JS
  - pattern: 'ext_execute_js\s.*navigator\.sendBeacon'
    level: block
    reason: Beacon data exfiltration
confirm_patterns:
  - pattern: '^ext_execute_js\s'
    reason: Executing arbitrary JavaScript in the page
  - pattern: '^ext_download\s'
    reason: Downloading a file from the web
  - pattern: 'ext_cookies_set'
    reason: Modifying browser cookies
  - pattern: 'ext_navigate\s.*(?:bank|paypal|venmo|stripe\.com|checkout|payment)'
    reason: Navigating to a financial or payment site
version: 1.1.0
---

# Browser Extension

Control the user's real Chrome or Brave browser through the Wolffish extension. This operates in the user's actual browser — their cookies, logins, extensions, and open tabs are all available.

## Tool Naming

All tools use the `ext_` prefix. The wire protocol translates these to `browser_` commands. For example `ext_navigate` sends `browser_navigate` to the extension.

## Selectors

Only standard CSS selectors work: `#id`, `.class`, `input[name="email"]`, `div.container > a.link`. Playwright pseudo-selectors like `:has-text()`, `text=`, `role=` are NOT supported.

## Reading Pages

- `ext_read_page` with `format: text` is the most reliable for extracting visible content. Scripts, styles, and hidden elements are automatically stripped.
- For large/complex pages (LinkedIn, Gmail, etc.), target a specific container with the `selector` param instead of reading the whole page — e.g. `selector: "main"` or `selector: ".content"`.
- Modern sites lazy-load content as you scroll. If a section is empty, scroll down with `ext_scroll` then read again.

## Tab Management

Don't navigate away from the user's current tab. If the task involves looking something up, researching, or visiting a different site — open a new tab with `ext_tab_open` instead of using `ext_navigate` on the active tab. The user may be in the middle of something. Use `ext_navigate` only when the user explicitly asks to go somewhere, or when you're already in a tab you opened yourself. For multi-step work across different sites, open each in its own tab and switch between them with `ext_tab_switch`.

## Screenshots

`ext_screenshot` returns the image inline. Use `fullPage: true` for full scrollable page captures, or `selector` for a specific element.

## Debugger Mode

Before any interaction sequence on a webpage, call `ext_debugger_status` to check current state.

If no debugger is attached and you need to interact with the page (click, scroll, type, move cursor), call `ext_debugger_attach` with the target tab's tabId first. If attach fails, proceed without it — all interaction commands fall back to content script mode automatically.

When you are done with all browser interactions for the current turn, call `ext_debugger_detach`. Always detach. Never leave the debugger attached between turns.

Debugger mode makes all interactions use trusted browser input events identical to real human input. Always prefer it for any page where detection matters — social media platforms, banking sites, or any page that may check for automated input.

The sequence is always: `ext_debugger_status` → `ext_debugger_attach` (if needed) → do your work → `ext_debugger_detach`.

## Humanize

When interacting with social media platforms, e-commerce sites, or any page that may detect automation, call the `ext_humanize` command BETWEEN your real actions.

Do not call humanize before your first action or after your last action. Call it between actions. Example flow:

1. ext_click (on comment menu)
2. ext_humanize
3. ext_click (on delete button)
4. ext_humanize
5. ext_scroll (to next comment)
6. ext_click (on comment menu)
7. ext_humanize
8. ext_click (on delete button)

Use intensity `light` for fast tasks with few actions. Use `moderate` for longer sequences. Use `heavy` only when interacting with platforms known for aggressive bot detection.

Humanize is not needed for DOM reading, screenshots, or non-interaction commands. Only use it between physical interaction commands (click, type, scroll, mouse_move).

## Typing text

`ext_type` types **character by character**, firing real keydown/keypress/input/keyup events for each one. This is on by default (`humanize: true`) and is what makes input look typed rather than pasted — keep it on for any page where detection matters.

- **It is not instant.** A short field is sub-second; a long post body takes a few seconds. That is expected — let the command finish. There is **no execution timeout**, so even a very long body will complete. Do not "give up" and retry, and do not split the text into chunks to beat a timeout — that just stacks duplicated, garbled text.
- **One `ext_type` per field.** Send the entire value in a single call. Don't loop character-by-character yourself.
- **Replacing existing text:** pass `clearFirst: true` to clear the field first. Without it, text is *appended* to whatever is already there — so never re-send a failed/partial `ext_type` without `clearFirst`, or you'll pile a partial on top of a partial.
- **When speed matters more than realism** (long text on a page that doesn't fingerprint input, or a plain form), pass `humanize: false` to insert the whole string at once.
- Don't sprinkle `ext_humanize` inside a single `ext_type` — the per-keystroke timing is already built in. `ext_humanize` is only for pauses *between separate* interaction commands.

## Selectors

`ext_*` selectors are plain **CSS** (passed to `querySelectorAll`). Playwright/jQuery-style extensions are **not** supported and throw "not a valid selector":

- ❌ `button:has-text("Post")`, `:contains("Submit")`, `text=Post`
- ✅ `button[type="submit"]`, `[aria-label="Post"]`, `[name="title"]`

To act on an element by its visible text (e.g. a "Post"/"Submit" button with no stable selector), query a broad set with `ext_query_selector` (e.g. `button`) and pick the one whose returned `text` matches, or use `ext_execute_js` to find and click it. Don't guess Playwright-style text selectors.

## Capturing the page

To see what's on a web page, use **`ext_screenshot`** — it captures the browser tab through the extension. Do **not** use `computer_screenshot` / desktop capture for web content: that's for native desktop apps, it needs OS screen-recording permission, and it grabs the whole screen instead of the page. If you only need the page's content (not a picture), prefer `ext_read_page` (text/markdown) over a screenshot.

## Safety

- Never attempt to bypass CAPTCHAs
- Warn before automating sites that may prohibit automated access
- Never automate financial transactions without explicit per-action approval
- Screenshots may contain sensitive information — warn when appropriate
