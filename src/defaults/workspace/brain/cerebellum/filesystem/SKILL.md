---
name: filesystem
description: Read, write, and edit files on the local system
triggers:
  - file
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

- Read before you write. Use `file_read` to see what's there before editing.
- Prefer `file_patch` for surgical edits — it preserves the rest of the file
  exactly as the user wrote it.
- For `file_patch`, the `find` string must match exactly (whitespace included).
- Never write to system paths (`/etc/`, `/usr/`, `/private/`) without
  asking — the safety gate will prompt the user, but be transparent about
  what you're doing first.
- When showing file contents back to the user, format them as a code block.
