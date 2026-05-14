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
    description: Wait for a specified duration. Useful between actions to allow UI transitions, page loads, or animations to complete.
    parameters:
      ms:
        type: number
        description: Milliseconds to wait (max 10000)
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

## Workflow

1. **Always screenshot first.** Before any action, call `computer_screenshot` to see the current state of the screen. Never guess what's on screen — always look.

2. **Use coordinates from the screenshot.** When you see an element you want to interact with (button, text field, icon), estimate its x,y pixel coordinates from the screenshot and use those coordinates in your click/type actions.

3. **Act, then verify.** After every action (click, type, scroll), take another screenshot to confirm the result. Did the right thing happen? Did a dialog appear? Did the page load?

4. **If something looks wrong, stop.** If the screen doesn't show what you expected, tell the user what happened and ask for guidance. Don't blindly retry.

## Guidelines

- **Start simple.** Screenshot → identify target → single click/type → screenshot to verify. Don't chain many actions without checking.
- **Wait for transitions.** After clicking a button that triggers a page load, animation, or dialog, call `computer_wait` with 500–2000ms before the next screenshot.
- **Never type passwords or secrets** unless the user explicitly provides them in the current message. If you need credentials, ask the user to type them directly.
- **Use keyboard shortcuts** when they're more reliable than clicking (e.g. Cmd+C to copy, Ctrl+A to select all).
- **Cap your actions.** If you've taken more than 15 actions without completing the task, pause and ask the user if you're on the right track.
- **Platform awareness.** Use `meta`/`cmd` modifier on macOS, `ctrl` on Windows/Linux for standard shortcuts.

## Multiple Displays

- If the screenshot doesn't show the app you're looking for, call `computer_list_displays` to see all connected monitors.
- Use `computer_screenshot` with `display_index` to capture a specific display (0 = primary, 1 = secondary, etc.).
- Mouse coordinates are global across all displays — a second monitor to the right of a 1920px-wide primary starts at x=1920.

## Coordinate System

Coordinates are in screen pixels, with (0,0) at the top-left corner of the primary display. X increases rightward, Y increases downward. Screenshots are resized for the model but coordinates in your actions refer to the original screen resolution reported in the screenshot output.
