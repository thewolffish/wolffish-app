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
    description: "Deliver a file to the user as a downloadable attachment in the conversation they are talking to you in — it shows up in the in-app chat and is uploaded/sent natively on WhatsApp and Telegram. Works for ANY file type (documents, images, audio, video, archives, code, text, etc.). Call this ONLY when a file the user should receive has NOT already been surfaced by the tool that produced it: most file-producing tools (the pdf/docx/xlsx/document tools, browser_pdf, image/meme generation, ffmpeg, shell `open`) already attach their output automatically, so calling send_file on those is redundant. Use it for files produced by other means — a script you ran, a download, a pre-existing file the user asked for. Up to 50 MB. Pass the file path — absolute, ~/-relative, or workspace-relative."
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

### When NOT to call it — only a same-turn duplicate

The one time to skip it: a file-generation tool already attached *this exact file this turn* — the
pdf/docx/xlsx/document tools, `browser_pdf`, image/meme generation, ffmpeg, or `shell` opening a
file with `open` all auto-attach their output, so re-sending that same file the same turn just
duplicates it. That's the **only** exception, and it's strictly **per-turn** — never a reason to
leave a new or edited file undelivered.

### Notes

- Pass any path: absolute, `~/`-relative, or workspace-relative. Files outside the
  workspace are copied into `files/` automatically so the in-app viewer can load them.
- Limit is 50 MB (the WhatsApp/Telegram bot ceiling). Larger files stay on disk; tell the
  user where to find them.
