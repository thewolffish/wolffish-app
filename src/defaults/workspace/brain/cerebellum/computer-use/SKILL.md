---
name: computer-use
description: Desktop automation — see the screen and control mouse/keyboard with a verified-aim loop. Screenshots, native-resolution zoom for precise targeting, clicks that return a magnified proof of where they landed, typing, shortcuts, scrolling, drag-and-drop.
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
  - zoom in
  - magnify
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
    description: 'See the screen. Captures the chosen display (default 0 = primary) and returns the image plus a Frame line stating its exact pixel size and the cursor position (marked with a magenta crosshair). This image becomes the CURRENT FRAME. Every mouse coordinate you give afterwards must be a pixel position read from the current frame, with (0,0) at its top-left — translation to real screen position (display scaling, Retina, monitor offsets) is fully automatic, so never use screen-resolution values and never add display offsets yourself. Screenshot again whenever the screen may have changed (after clicks that open things, typing, scrolling, app switches, page loads) — acting on an outdated image is the main cause of wrong clicks. If the target is small, crowded, or you are not certain of its exact position, do not guess: zoom into it with computer_zoom first. If this tool ever reports that its image was omitted because the active model cannot view images, computer use is impossible — stop immediately and tell the user to switch to a vision-capable model.'
    parameters:
      display_index:
        type: number
        required: false
        description: 'Index of the display to capture (default 0 = primary). Use computer_list_displays to see all of them, and screenshot each index in turn to find the app you need.'
  - name: computer_zoom
    description: 'Magnify a rectangular region of the current frame, captured fresh at up to native resolution — the precision instrument for small targets and small text. Pass the region in current-frame pixels; you get back a sharp close-up that becomes the NEW current frame, so you then click using the close-up''s own coordinates (far more accurate than clicking from the full screenshot). Recommended flow for any small target: screenshot → locate it roughly → zoom a region around it (for example 300x200) → click its exact pixel in the zoom. To act outside the zoomed region, take a fresh computer_screenshot first.'
    parameters:
      x:
        type: number
        description: 'Left edge of the region, in current-frame pixels'
      y:
        type: number
        description: 'Top edge of the region, in current-frame pixels'
      width:
        type: number
        description: 'Region width in current-frame pixels'
      height:
        type: number
        description: 'Region height in current-frame pixels'
  - name: computer_mouse_click
    description: 'Click at (x, y) in CURRENT-FRAME pixels — or omit both to click at the cursor''s present position (use that after aiming with computer_mouse_move). The result includes a magnified close-up taken right after the click with a crosshair on the exact point pressed: CHECK IT. If the crosshair is not on your intended target, the click missed — the close-up is now the current frame, so click again using its coordinates to correct with surgical precision. If the click should change the screen (open a menu, dialog, page), follow up with computer_screenshot to see the result; clicking a window of another app also focuses that app. Never click coordinates you have not read from the current frame.'
    parameters:
      x:
        type: number
        required: false
        description: 'X in current-frame pixels (omit x and y to click at the current cursor position)'
      y:
        type: number
        required: false
        description: 'Y in current-frame pixels (omit x and y to click at the current cursor position)'
      button:
        type: string
        required: false
        enum:
          - left
          - right
          - middle
        description: 'Mouse button to click (default left)'
      double:
        type: boolean
        required: false
        description: 'Double-click instead of single click'
  - name: computer_mouse_move
    description: 'Aim without clicking: moves the cursor to (x, y) in current-frame pixels and returns a magnified close-up with a crosshair at the new position so you can verify the aim before committing. The close-up becomes the current frame — if the aim is off, move again using its finer coordinates; once the crosshair sits exactly on the target, call computer_mouse_click with no coordinates to press that exact point. Also useful to trigger hover states (tooltips, hover menus).'
    parameters:
      x:
        type: number
        description: 'X in current-frame pixels'
      y:
        type: number
        description: 'Y in current-frame pixels'
  - name: computer_mouse_drag
    description: 'Press and hold at the start point, glide to the end point, and release — for drag-and-drop, sliders, resizing, and selecting text. All four coordinates are current-frame pixels, so for a precise drag first zoom into a region that contains BOTH endpoints and drag within that zoom; when source and destination are far apart, do a rough long drag first, then a short corrective drag inside one zoom. The dragged object ends up at the release point. Returns a magnified close-up of the release point (which becomes the current frame); take a computer_screenshot afterwards to confirm the result.'
    parameters:
      start_x:
        type: number
        description: 'Drag start X in current-frame pixels'
      start_y:
        type: number
        description: 'Drag start Y in current-frame pixels'
      end_x:
        type: number
        description: 'Drag end X in current-frame pixels'
      end_y:
        type: number
        description: 'Drag end Y in current-frame pixels'
      button:
        type: string
        required: false
        enum:
          - left
          - right
          - middle
        description: 'Mouse button to hold (default left)'
  - name: computer_mouse_scroll
    description: 'Scroll the mouse wheel. Direction ''down'' reveals content below. Scrolling affects whatever is UNDER the cursor, so pass x,y (current-frame pixels) to scroll a specific pane or list. The result includes a magnified view of the area under the cursor after the scroll, which becomes the current frame — when scrolling to find an item, look for it there and click it directly in the magnifier''s coordinates the moment it appears, scrolling again in small amounts otherwise. Pre-scroll coordinates are stale; take a fresh computer_screenshot for the wider picture.'
    parameters:
      direction:
        type: string
        enum:
          - up
          - down
          - left
          - right
        description: 'Scroll direction (''down'' reveals content below)'
      amount:
        type: number
        required: false
        description: 'Wheel notches to scroll (default 3)'
      x:
        type: number
        required: false
        description: 'Optional: move the cursor here first, in current-frame pixels'
      y:
        type: number
        required: false
        description: 'Optional: move the cursor here first, in current-frame pixels'
  - name: computer_keyboard_type
    description: 'Type text into the focused control. Click the target field first and make sure it has focus (a screenshot shows the caret), or the text goes somewhere else. Long or non-ASCII text (Arabic, emoji, accents) is pasted via the clipboard automatically so it arrives exactly as written. This does not press Enter — use computer_keyboard_press for that. Never type passwords or secrets unless the user explicitly provided them in the current conversation.'
    parameters:
      text:
        type: string
        description: 'The text to type'
  - name: computer_keyboard_press
    description: 'Press one key or a shortcut. Accepts a single key (enter, tab, escape, backspace, delete, space, up/down/left/right, home, end, pageup, pagedown, f1-f12, letters, digits, punctuation) or a combo in one string like ''cmd+s'', ''ctrl+shift+t'', ''alt+f4'' (a separate comma-separated modifiers parameter also works). Use cmd on macOS and ctrl on Windows/Linux. Shortcuts go to the FOCUSED app — click its window first if unsure. Prefer a reliable shortcut over clicking when both work (Enter to submit, Esc to dismiss, cmd+l for the address bar).'
    parameters:
      key:
        type: string
        description: 'Key or combo string (e.g. enter, tab, ''cmd+shift+4'')'
      modifiers:
        type: string
        required: false
        description: 'Comma-separated modifier keys to hold: ctrl, alt, shift, meta, cmd'
  - name: computer_list_displays
    description: 'List all connected displays with resolution, scale factor, position, and which one is primary. When the app you need is not on the display-0 screenshot, capture each display_index in turn until you find it, then keep using that index. Coordinates never need display offsets — they always refer to the latest returned image.'
    parameters: {}
  - name: computer_wait
    description: 'Wait for a specified duration before the next action — use 500-2000ms after actions that trigger animations, page loads, or dialogs. No cap; a wait cannot be interrupted once in flight, so split very long waits into several computer_wait calls.'
    parameters:
      ms:
        type: number
        description: 'Milliseconds to wait. No cap; split very long waits across multiple calls.'
confirm_patterns:
  - pattern: computer_mouse_click
    reason: Clicking on screen
  - pattern: computer_mouse_drag
    reason: Dragging on screen
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

# Computer Use — Verified-Aim Desktop Automation

The agent sees and controls the desktop through a closed feedback loop designed for
surgical accuracy with any vision-capable model:

1. **One coordinate space, owned by the plugin.** Every image the tools return
   (screenshot, zoom, or click magnifier) becomes the *current frame*. The model
   always gives coordinates as pixels read off the latest image; the plugin does all
   translation to real screen position — screenshot downscaling, Retina/HiDPI scale
   factors, and multi-monitor offsets. The model never does coordinate math, which
   removes the entire class of "right target, wrong space" misses.
2. **A crosshair marks the cursor** on every returned image, so the model always
   knows where the pointer actually is.
3. **Zoom for small targets.** `computer_zoom` re-captures a chosen region at native
   resolution (up to 4x magnification). The zoomed image becomes the frame, so tiny
   controls are clicked in a space where they are dozens of pixels wide.
4. **Every click returns proof.** `computer_mouse_click`, `computer_mouse_move`, and
   `computer_mouse_drag` return a 2x-magnified close-up with the crosshair on the
   exact pixel acted on. A miss is visible immediately and corrected in the
   close-up's own finer coordinate space instead of by re-guessing on the full
   screenshot.

This mirrors the practices Anthropic uses for Claude's own computer use: act on the
latest image only, verify after every action, zoom rather than squint, prefer
keyboard shortcuts when they are more reliable than pointing.

**Computer use requires a vision-capable model.** If the active Brain model cannot
accept images (for example DeepSeek's chat API, which is text-only), the runtime
strips the screenshots and the tools tell the model to stop and ask the user to
switch models — a text-only model cannot click accurately and is not allowed to
guess.

## Required Setup (macOS)

macOS sandboxes screen and input access behind system permissions. **All three must
be granted to Wolffish before computer-use tools will work.** These are one-time
grants that persist across restarts.

| Permission | What it unlocks | System Settings path | Error when missing |
|---|---|---|---|
| **Screen Recording** | `computer_screenshot`, `computer_zoom`, magnifier images | Privacy & Security › Screen Recording › enable **Wolffish** | `Failed to get sources` |
| **Accessibility** | mouse and keyboard tools | Privacy & Security › Accessibility › enable **Wolffish** | `not permitted` / `assistive access` |
| **Automation** | `osascript` commands (activate apps, list windows) via `shell_exec` | Privacy & Security › Automation › allow **Wolffish** to control target apps | `Not authorized to send Apple events` |

After granting **Screen Recording**, Wolffish must be restarted for the change to
take effect (macOS requirement). Accessibility and Automation take effect
immediately.

**Windows and Linux (X11)** do not require these permissions — computer-use tools
work out of the box. Wayland is not supported by the automation library.

### If a permission is missing

macOS silently fails the tool call rather than showing a prompt. The tool returns
one of the error strings above, and retrying will never succeed. The agent is
expected to stop using computer-use tools, name the missing permission and its
System Settings path, finish any non-visual parts of the task, and resume when the
user has granted it (restarting Wolffish if it was Screen Recording).

## Screen Glow

While the agent controls the screen, the active display shows a soft blue
border glow — the human-facing signal that computer use is running there, on
that monitor. It pulses briefly on every screenshot and zoom capture as
feedback that the screen was just captured.

The glow is pure harness logic, invisible to the model in every sense: the
overlay window is content-protected so it never appears in captures (on Linux
it hides for the instant of each capture instead), it is click-through and
non-focusable so input synthesis is unaffected, and no tool exposes it. It
follows whichever display the agent works on, and it removes itself after 12
seconds without computer-use activity — which covers task completion,
cancellation, and termination with no extra bookkeeping.

## Multiple Displays

`computer_screenshot` captures display 0 (primary) by default. When the target app
is elsewhere, `computer_list_displays` shows every monitor and the agent screenshots
each `display_index` until it finds the app, then stays on that index. Coordinate
translation to the right monitor — including monitors with negative origins or
different DPI — is automatic. There is deliberately no manual offset arithmetic
anywhere in the contract.

## Configuration

`config.json → computerUse`:

- `screenshotMaxWidth` — full-screenshot width cap in pixels (default 1280).
  Zoom and magnifier images are unaffected; they always render from the
  native-resolution capture.
- `screenshotFormat` — `jpeg` (default) or `png` for full screenshots. Zoom and
  magnifier images are always PNG for crisp text.

Screenshots and zooms are also saved under `screenshots/conv-<id>/` in the
workspace for chat rendering and channel (Telegram/WhatsApp) delivery.

## Safety

- Clicking, dragging, typing, key presses, and scrolling are approval-gated
  (`confirm_patterns`); screenshots, zooms, and display listing are read-only.
- Typing text matching sensitive patterns (passwords, destructive commands) is
  flagged as destructive.
- The agent must never type credentials it was not explicitly given in the
  current conversation.
