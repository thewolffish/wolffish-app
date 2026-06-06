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
        description: Number of days to look back (default 7)
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

## Rules

- These tools are read-only — they never modify the workspace.
- Prefer the tool over guessing. The numbers come from real files on disk.
- If the user only asked a casual "how are you?", a friendly answer is fine
  too — only call the tool when they want real data.
