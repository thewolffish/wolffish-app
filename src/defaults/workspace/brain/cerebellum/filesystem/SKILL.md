---
name: filesystem
description: Read, write, and edit files on the local system
triggers:
  - file
  - files
  - read
  - write
  - edit
  - create
  - save
  - open
  - patch
  - modify
  - content
  - folder
  - directory
  - rename
  - move
  - copy
  - delete
  - remove
  - path
  - text
  - overwrite
  - append
  - list files
  - show file
  - update file
  - change file
  - what's in
  - replace
  - find and replace
  - look at
  - check file
  - config
  - configuration
  - log
  - document
  - txt
  - json
  - yaml
  - yml
  - xml
  - env
  - dotfile
  - gitignore
  - readme
  - makefile
  - toml
  - ini
  - csv
  - properties
  - source code
  - snippet
  - template
  - backup
  - archive
  - workspace
  - project
  - codebase
  - cat
  - head
  - tail
  - wc
  - line count
  - show contents
  - print file
  - what does this file say
  - read the file
  - write to file
  - save to file
  - create a file
  - new file
  - update config
  - edit config
tools:
  - name: file_read
    description: Read a file's text contents, optionally restricted to a line range.
    parameters:
      path:
        type: string
        description: Absolute path or path starting with ~
      startLine:
        type: number
        description: 1-based first line to include (optional)
      endLine:
        type: number
        description: 1-based last line to include (optional)
  - name: file_write
    description: Create or overwrite a text file. Use mode=append to append instead.
    parameters:
      path:
        type: string
        description: Absolute path or path starting with ~
      content:
        type: string
        description: Text to write
      mode:
        type: string
        description: 'overwrite (default) or append'
        enum:
          - overwrite
          - append
  - name: file_patch
    description: Find a literal string in a file and replace every occurrence.
    parameters:
      path:
        type: string
        description: Absolute path or path starting with ~
      find:
        type: string
        description: Literal text to search for
      replace:
        type: string
        description: Replacement text
danger_patterns:
  - pattern: '\.\./'
    level: destructive
    reason: Path traversal attempt
confirm_patterns:
  - pattern: '/etc/'
    reason: Modifying system configuration
  - pattern: '/usr/'
    reason: Modifying system files
  - pattern: '/private/'
    reason: Modifying protected system area
---

# Filesystem

## Interface

- Tools: `file_read`, `file_write`, `file_patch`
- Paths may use `~` for the user's home directory.
- Writes always create parent directories as needed.

## Rules

- **Verify before reading.** Before calling `file_read`, confirm the file
  exists — use a directory listing, `file_read` on the parent dir, or prior
  context that proves the path is real. Skip the check only when you have
  high certainty the file exists (e.g. you just created it, it appeared in
  a recent directory listing, or the user pasted its path). Never guess
  a path and attempt the read blind.
- Read before you write. Use `file_read` to see what's there before editing.
- Prefer `file_patch` for surgical edits — it preserves the rest of the file
  exactly as the user wrote it.
- For `file_patch`, the `find` string must match exactly (whitespace included).
- Never write to system paths (`/etc/`, `/usr/`, `/private/`) without
  asking — the safety gate will prompt the user, but be transparent about
  what you're doing first.
- When showing file contents back to the user, format them as a code block.
