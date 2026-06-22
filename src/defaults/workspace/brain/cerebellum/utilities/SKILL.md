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
    description: "Deliver a file to the user as a downloadable attachment in the conversation they are talking to you in — it shows up in the in-app chat and is uploaded/sent natively on WhatsApp and Telegram. Works for ANY file type (documents, images, audio, video, archives, code, text, etc.). Call this whenever a task's result is a file you produced, edited, converted, or otherwise handled, unless the producing tool already surfaced the file as an attachment. Up to 50 MB. Pass the file path — absolute, ~/-relative, or workspace-relative."
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

### When to call it

Call `send_file` at the end of any task whose deliverable is a file you created, edited,
downloaded, or converted — a report, a spreadsheet, an image, an archive, a generated
script, etc. Deliver the final artifact, then write your short wrap-up reply.

### When NOT to call it

Some tools already attach their output automatically (the pdf/docx/xlsx/document tools,
image/meme generation, ffmpeg, and `shell` opening a file with `open`). If the file the
user wanted already appeared as an attachment from one of those, you do **not** need to
call `send_file` again — that would deliver it twice. `send_file` is for files that were
produced by other means (writing them directly, generating code, downloading) and would
otherwise only exist as a path.

### Notes

- Pass any path: absolute, `~/`-relative, or workspace-relative. Files outside the
  workspace are copied into `files/` automatically so the in-app viewer can load them.
- Limit is 50 MB (the WhatsApp/Telegram bot ceiling). Larger files stay on disk; tell the
  user where to find them.
