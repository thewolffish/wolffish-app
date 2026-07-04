---
name: utilities
description: Small built-in utility tools that don't belong to a bigger capability — currently delivering files to the user as attachments.
triggers:
  - send file
  - send the file
  - attach
  - attachment
  - deliver file
  - share file
  - upload file
  - here is the file
  - here's the file
tools:
  - name: send_file
    description: "Deliver a file to the user as a downloadable attachment in the conversation they are talking to you in — it renders in the in-app chat and is uploaded/sent natively on WhatsApp and Telegram. Works for ANY file type (documents, images, audio, video, archives, code, text, etc.). THIS IS THE ONLY WAY A FILE REACHES THE USER: no tool auto-delivers its output, so every file you create, convert, edit, or download for the user MUST be sent with this call once the work is done. Never end a task by just naming a saved path. Up to 50 MB. Pass the file path — absolute, ~/-relative, or workspace-relative."
    parameters:
      file:
        type: string
        description: "Path to the file to deliver. Absolute (/Users/you/report.pdf), home-relative (~/Desktop/report.pdf), or workspace-relative (files/report.pdf)."
        required: true
---

# Utilities

A grab-bag of small, always-available helpers that are too small to each be
their own capability. Add new general-purpose utility tools here rather than
spinning up a new capability for every one-off.

## `send_file` — deliver a file to the user

Use `send_file` to actually hand a file to the user inside the conversation. Saving a
file to disk and telling the user "saved to …/files/report.pdf" is **not** delivery —
on WhatsApp and Telegram the user never sees the file, and even in the app the path is
not the file. `send_file` closes that gap on every channel at once.

### When to call it — the default, every time

Call `send_file` for **any** file you created, edited, converted, downloaded, or saved — a
Python/PIL image edit, an ImageMagick call, a shell/script output, a download, a file saved
outside the workspace (the Desktop, etc.), a pre-existing file the user asked for. Deliver it as
the last real step, then write your short wrap-up. A file the user can't see is a failed task —
**when in doubt, send it.**

**Re-deliver every version when the user is iterating.** If they're refining a file — you edit,
regenerate, "make it red", "now orange" — call `send_file` on the **updated** file each time,
even if you delivered a file at that same path in an earlier turn. Each new version is a new
result the user must see. A new turn, a different file, or an edited version always gets sent.

### When NOT to call it — almost never

NOTHING auto-attaches anymore: no generation tool (pdf, browser_pdf, ffmpeg, image/meme
generation, shell `open`) delivers its own output. If you don't call `send_file`, the user
receives nothing — on every channel. The only reasons to skip it: (1) you already sent this
exact file this turn (the runtime status lists your sends), or (2) the user explicitly asked
for the file to be placed somewhere without delivery — and if you're merely unsure, ASK
whether they want it sent rather than silently withholding it.

### Notes

- Pass any path: absolute, `~/`-relative, or workspace-relative. Files outside the
  workspace are copied into `files/` automatically so the in-app viewer can load them.
- Limit is 50 MB (the WhatsApp/Telegram bot ceiling). Larger files stay on disk; tell the
  user where to find them.
