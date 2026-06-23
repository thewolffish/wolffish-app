---
name: introspect
description: Check Wolffish's own status, performance, and memory
triggers:
  - status
  - health
  - performance
  - how are you
  - what do you know
  - what do you remember
  - uptime
  - stats
  - memory usage
  - how many
  - diagnostics
  - system info
  - capabilities
  - loaded
  - active
  - running
  - wolffish
  - self
  - about
  - version
  - provider
  - model
  - configuration
  - settings
  - error rate
  - success rate
  - tool usage
  - what can you do
  - what tools
  - how many tools
  - how many capabilities
  - list capabilities
  - list tools
  - available tools
  - enabled
  - disabled
  - plugin
  - installed
  - which model
  - which provider
  - current model
  - current provider
  - api key
  - token count
  - context window
  - latency
  - response time
  - are you working
  - are you ok
  - are you alive
  - check yourself
  - self test
  - debug mode
  - verbose
  - log level
  - tell me about yourself
  - who are you
  - what are you
  - recall
  - remember when
  - what did we
  - what did i
  - what did you
  - last time
  - earlier
  - yesterday
  - previously
  - look up
  - search memory
  - find in memory
  - dig up
  - list files
  - what files
  - which files
  - show files
  - files exist
  - what's on disk
  - workspace files
  - find file
  - locate file
tools:
  - name: wolffish_status
    description: Get current Wolffish status including uptime, active provider, loaded capabilities, and system health
    parameters: {}
  - name: wolffish_performance
    description: Get performance stats including task success rates, most used tools, and error rates
    parameters: {}
  - name: wolffish_memory
    description: Get a summary of what Wolffish remembers — recent conversation topics and knowledge areas
    parameters:
      days:
        type: number
        required: false
        description: Number of days to look back (default 7)
  - name: wolffish_recall
    description: Precisely retrieve something from your own memory that is NOT in your current context — what you did on a date, the steps of a past task, an earlier conversation, a learned fact, or a past tool outcome. Search by keyword and/or date. Use this instead of guessing or saying you don't remember.
    parameters:
      query:
        type: string
        required: false
        description: Keywords to search for (case-insensitive). Optional if date is given.
      date:
        type: string
        required: false
        description: Pin results to a single day, format YYYY-MM-DD. Optional.
      source:
        type: string
        required: false
        enum: [episodes, tasks, feedback, knowledge, conversations, all]
        description: 'Where to look: episodes, tasks, feedback, knowledge, conversations, or all (default).'
      limit:
        type: number
        required: false
        description: Max matches to return (default 8, max 30)
  - name: wolffish_list_files
    description: List files inside the Wolffish workspace ONLY (~/.wolffish/workspace — your memory, generated files, capabilities, logs) as a structured tree with sizes. This is NOT a general file browser; it refuses paths outside the workspace. For the user's own files anywhere else (Desktop, Documents, projects, any absolute path), use the filesystem tools or shell instead.
    parameters:
      dir:
        type: string
        required: false
        description: Subdirectory relative to the workspace root (e.g. 'files'). Defaults to the workspace root.
      depth:
        type: number
        required: false
        description: How many levels deep to descend (default 2, max 5)
      pattern:
        type: string
        required: false
        description: Only include files whose name contains this substring (case-insensitive)
---

# Introspection

## When to use

- When the user asks about Wolffish's status, health, or capabilities
- When the user asks what Wolffish remembers or knows
- When the user asks about performance or task history
- When the user asks "how are you" in a way that expects real data, not pleasantries

## Tools

- `wolffish_status` — uptime, provider, capabilities, RAM, disk, cortex.db size
- `wolffish_performance` — task counts, success rate, most used / denied tools
- `wolffish_memory` — episode topics, knowledge file coverage, feedback counts
- `wolffish_recall` — precise retrieval of a specific past detail (a date's
  activity, a task's steps, an old conversation, a learned fact). Search by
  `query` and/or `date`, scoped to a `source` if you know where it lives.
- `wolffish_list_files` — structured tree of **your own workspace** files
  (`~/.wolffish/workspace`) with sizes. Workspace-only — not a general file
  browser (see Rules).

## Recall vs. summary

Your context window carries a **lean summary**, not your whole history — recent
conversation is in the live thread, and a digest of habits/preferences is in
your prompt. Everything else lives on disk and is one tool call away:

- "What did we do on the 18th?" → `wolffish_recall` with `date: "2026-06-18"`.
- "Did that World Cup task finish?" → `wolffish_recall` with `query: "world cup", source: "tasks"`.
- "What's the file you made yesterday?" → `wolffish_list_files` with `dir: "files"`.

Reach for `wolffish_recall` the moment you're about to say "I don't remember" or
guess — it almost certainly knows.

## Rules

- These tools are read-only — they never modify the workspace.
- Prefer the tool over guessing. The numbers come from real files on disk.
- If the user only asked a casual "how are you?", a friendly answer is fine
  too — only call the tool when they want real data.
- **`wolffish_list_files` lists ONLY the Wolffish workspace** (your own memory,
  generated files, logs, capabilities). It is not a general file browser and
  refuses paths outside the workspace. For the user's files anywhere else —
  Desktop, Documents, a project folder, an attachment path, any absolute path —
  use the filesystem tools (`file_read`, etc.) or `shell_exec` (`ls`/`find`)
  instead.
