---
name: computer-use
description: Desktop automation — take screenshots, move/click mouse, type text, press keys. Used for visual tasks where the agent needs to see and interact with the user's screen.
triggers:
  - screenshot
  - click
  - screen
  - desktop
  - browser
  - open app
  - navigate
  - scroll
  - type into
  - mouse
  - keyboard
  - what's on my screen
  - computer use
  - automate
  - UI
  - display
  - monitor
  - window
  - application
  - app
  - cursor
  - pointer
  - drag
  - drop
  - button
  - menu
  - toolbar
  - icon
  - taskbar
  - dock
  - finder
  - right click
  - double click
  - hotkey
  - shortcut
  - press key
  - enter text
  - what do you see
  - show me
  - look at screen
  - visual
  - GUI
  - interface
  - native app
  - system tray
  - notification center
  - control panel
  - system preferences
  - spotlight
  - launchpad
  - activity monitor
  - task manager
  - file explorer
  - terminal app
  - text editor
  - fullscreen
  - minimize
  - maximize
  - resize window
  - switch window
  - alt tab
  - cmd tab
  - copy paste
  - undo redo
  - select all
  - right click menu
  - context menu
  - pixel
  - coordinate
  - position
  - what is on screen
  - see my screen
  - look at my screen
  - interact with desktop
  - control my computer
  - click on
  - move mouse to
requires:
  - node
tools:
  - name: computer_screenshot
    description: Take a screenshot of the full screen. Returns the screenshot as an image the model can see. Always call this first to understand the current screen state before taking any action.
    parameters:
      display_index:
        type: number
        required: false
        description: Index of the display to capture (default 0 for primary monitor)
  - name: computer_mouse_move
    description: Move the mouse cursor to absolute x,y pixel coordinates on screen.
    parameters:
      x:
        type: number
        description: X coordinate (pixels from left edge)
      y:
        type: number
        description: Y coordinate (pixels from top edge)
  - name: computer_mouse_click
    description: Click the mouse at the current cursor position, or at specified x,y coordinates.
    parameters:
      x:
        type: number
        required: false
        description: X coordinate to click at (moves cursor first if provided)
      y:
        type: number
        required: false
        description: Y coordinate to click at (moves cursor first if provided)
      button:
        type: string
        required: false
        enum:
          - left
          - right
          - middle
        description: Mouse button to click (default left)
      double:
        type: boolean
        required: false
        description: Double-click instead of single click
  - name: computer_mouse_scroll
    description: Scroll the mouse wheel in a given direction.
    parameters:
      direction:
        type: string
        enum:
          - up
          - down
          - left
          - right
        description: Scroll direction
      amount:
        type: number
        required: false
        description: Number of scroll units (default 3)
  - name: computer_keyboard_type
    description: Type a string of text at the current cursor position. Use for entering text into fields, search boxes, editors, etc.
    parameters:
      text:
        type: string
        description: The text to type
  - name: computer_keyboard_press
    description: "Press a key or key combination. Use for shortcuts, navigation, and special keys. Key names: enter, tab, escape, backspace, delete, space, up, down, left, right, home, end, pageup, pagedown, f1-f12, plus any single character."
    parameters:
      key:
        type: string
        description: "Key to press (e.g. enter, tab, escape, a, f5)"
      modifiers:
        type: string
        required: false
        description: "Comma-separated modifier keys to hold: ctrl, alt, shift, meta, cmd"
  - name: computer_list_displays
    description: List all connected displays with resolution, scale factor, and position. Use this when you need to find which display an app is on, or when the primary display screenshot doesn't show what you expect.
    parameters: {}
  - name: computer_wait
    description: Wait for a specified duration. Useful between actions to allow UI transitions, page loads, or animations to complete. No cap — you decide. A wait cannot be interrupted once in flight, so split very long waits into several computer_wait calls.
    parameters:
      ms:
        type: number
        description: Milliseconds to wait. No cap; split very long waits across multiple calls.
confirm_patterns:
  - pattern: computer_mouse_click
    reason: Clicking on screen
  - pattern: computer_keyboard_type
    reason: Typing text
  - pattern: computer_keyboard_press
    reason: Pressing keys
  - pattern: computer_mouse_scroll
    reason: Scrolling
danger_patterns:
  - pattern: 'computer_keyboard_press.*(delete|backspace)'
    level: warn
    reason: Pressing delete/backspace key
  - pattern: 'computer_keyboard_type.*(sudo|rm -rf|password|secret|token)'
    level: destructive
    reason: Typing potentially dangerous or sensitive text
---

# Computer Use — Screenshot-Driven Desktop Automation

You can see and control the user's desktop through screenshots and input actions.

## Required Setup (macOS)

macOS sandboxes screen and input access behind system permissions. **All three must be granted to Wolffish before computer-use tools will work.** These are one-time grants that persist across restarts.

| Permission | What it unlocks | System Settings path | Error when missing |
|---|---|---|---|
| **Screen Recording** | `computer_screenshot`, `computer_list_displays` | Privacy & Security › Screen Recording › enable **Wolffish** | `Failed to get sources` |
| **Accessibility** | `computer_mouse_click`, `computer_mouse_move`, `computer_mouse_scroll`, `computer_keyboard_type`, `computer_keyboard_press` | Privacy & Security › Accessibility › enable **Wolffish** | `not permitted` / `assistive access` |
| **Automation** | `osascript` commands (activate apps, list windows) via `shell_exec` | Privacy & Security › Automation › allow **Wolffish** to control target apps | `Not authorized to send Apple events` |

After granting **Screen Recording**, Wolffish must be restarted for the change to take effect (macOS requirement). Accessibility and Automation take effect immediately.

**Windows and Linux** do not require these permissions — computer-use tools work out of the box.

### If a permission is missing

macOS will silently fail the tool call rather than showing a prompt. The tool returns one of the error strings above, and retrying will never succeed. When you see one of these errors:

1. Stop using computer-use tools immediately — do not retry.
2. Tell the user which permission is missing and the exact System Settings path.
3. Finish any non-computer-use parts of the task.
4. Ask the user to grant the permission (and restart Wolffish if it was Screen Recording), then come back and ask you to continue.

## Workflow

1. **Always screenshot first.** Before any action, call `computer_screenshot` to see the current state of the screen. Never guess what's on screen — always look.

2. **Use coordinates from the screenshot.** When you see an element you want to interact with (button, text field, icon), estimate its x,y pixel coordinates from the screenshot and use those coordinates in your click/type actions.

3. **Act, then verify.** After every action (click, type, scroll), take another screenshot to confirm the result. Did the right thing happen? Did a dialog appear? Did the page load?

4. **If something looks wrong, stop.** If the screen doesn't show what you expected, tell the user what happened and ask for guidance. Don't blindly retry.

## Guidelines

- **Start simple.** Screenshot → identify target → single click/type → screenshot to verify. Don't chain many actions without checking.
- **Wait for transitions.** After clicking a button that triggers a page load, animation, or dialog, call `computer_wait` with 500–2000ms before the next screenshot. There's no cap — when waiting on a genuinely long task (a build, an export, a render), wait as long as you need. The only caveat: a wait can't be interrupted once it's in flight, so split very long waits into several sequential `computer_wait` calls rather than one giant sleep.
- **Never type passwords or secrets** unless the user explicitly provides them in the current message. If you need credentials, ask the user to type them directly.
- **Use keyboard shortcuts** when they're more reliable than clicking (e.g. Cmd+C to copy, Ctrl+A to select all).
- **Cap your actions.** If you've taken more than 15 actions without completing the task, pause and ask the user if you're on the right track.
- **Platform awareness.** Use `meta`/`cmd` modifier on macOS, `ctrl` on Windows/Linux for standard shortcuts.

## Multiple Displays

Users often have 2–3 monitors. The app you need to control may not be on the primary display. **Detecting and handling this correctly is critical — clicking with the wrong coordinates will silently land on the wrong monitor.**

### Discovery

1. **Start with `computer_screenshot` (no args).** This captures display 0 (primary).
2. **If the target app isn't visible**, call `computer_list_displays` to see all monitors with their bounds.
3. **Scan each display** with `computer_screenshot` using `display_index` (0, 1, 2, ...) until you find the app.
4. **Lock onto that display** for the rest of the task — take all subsequent screenshots from the same `display_index`.

### Coordinate translation (critical)

Mouse tools use **global** screen coordinates. Screenshots show **local** coordinates relative to that display's origin.

- **Primary display (bounds 0,0):** Local and global are the same. No translation needed.
- **Any other display:** The screenshot output includes the global offset, e.g. `This display starts at global (3648, 0) — add (3648, 0) to all coordinates.` **You must add this offset to every coordinate before clicking.**

Example: You see a button at local (200, 300) on a display with bounds (3648, 0). Click at **(3848, 300)**, not (200, 300). If you forget, your click lands on the primary monitor and nothing happens on the target display.

### Keeping focus on the right monitor

- **Before your first click**, use `osascript` or `shell_exec` to activate the target app so it has keyboard focus: `osascript -e 'tell application "Google Chrome" to activate'`
- **Keyboard shortcuts (Cmd+L, Cmd+A, etc.) go to the focused app**, not to a specific display. Always activate the target app first if you're about to use keyboard input.
- **Don't switch displays mid-task** unless you need to. Every display switch means a new offset to track.
- **After switching displays**, always take a fresh screenshot to re-anchor your coordinates. Never reuse coordinates from a screenshot of a different display.

## Coordinate System

Use the image pixel coordinates from the screenshot — top-left is (0,0), X increases rightward, Y increases downward. The screenshot output tells you the valid range (e.g. x 0–1280, y 0–827). Coordinates are automatically translated to screen position, so never use screen resolution values — always use coordinates within the image dimensions. On multi-display setups, the display offset is also applied automatically after each screenshot.
