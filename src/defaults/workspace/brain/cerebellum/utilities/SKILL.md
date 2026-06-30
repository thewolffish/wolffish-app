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

### When NOT to call it (the common case)

Most file-producing tools already attach their output automatically: the pdf/docx/xlsx/document
tools, `browser_pdf` (print-to-PDF), image/meme generation, ffmpeg, and `shell` opening a file
with `open`. If the file the user wanted came from one of those, it's **already delivered** —
calling `send_file` on it is a redundant, wasted step. Default to assuming the producing tool
handled delivery.

### When to call it

Reach for `send_file` only when nothing has surfaced the file yet — typically a file you
produced by other means: one you wrote directly with a raw `shell`/script command, a download,
or a pre-existing file the user asked you to send. Deliver it, then write your short wrap-up reply.

### Notes

- Pass any path: absolute, `~/`-relative, or workspace-relative. Files outside the
  workspace are copied into `files/` automatically so the in-app viewer can load them.
- Limit is 50 MB (the WhatsApp/Telegram bot ceiling). Larger files stay on disk; tell the
  user where to find them.
