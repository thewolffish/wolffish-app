---
name: shell
description: Execute shell commands on the local system
triggers:
  - run
  - execute
  - command
  - terminal
  - shell
  - bash
  - npm
  - npx
  - git
  - pip
  - docker
  - brew
  - curl
  - wget
tools:
  - name: shell_exec
    description: Run a shell command and return its output. Default cwd is the user home directory. No default timeout — commands run until they exit. Set background=true for long-lived processes (dev servers, watchers).
    parameters:
      command:
        type: string
        description: The command to execute
      cwd:
        type: string
        required: false
        description: Working directory (default user home). If you set cwd, it must be an absolute path that exists on the system. Otherwise omit it — defaults to the user's home directory.
      timeout:
        type: number
        required: false
        description: Optional timeout in ms. If omitted, the command runs until it exits naturally. Use short timeouts (5000–15000) for quick checks where you want fast failure, or omit for commands with unpredictable duration. Ignored when background is true.
      background:
        type: boolean
        required: false
        description: Start the command detached and return immediately with its PID. Use for any process that does not exit on its own (npm run dev, vite, nodemon, http servers, watchers). stdio is set to /dev/null — redirect inside the command (e.g. > /tmp/log 2>&1) if you want to read output later.
danger_patterns:
  - pattern: 'rm\s+(-rf|--recursive)'
    level: destructive
    reason: Recursive force delete
  - pattern: 'sudo\s+'
    level: destructive
    reason: Privilege escalation
  - pattern: 'mkfs'
    level: block
    reason: Format disk
  - pattern: 'dd\s+if='
    level: block
    reason: Raw disk write
  - pattern: 'chmod\s+777'
    level: destructive
    reason: Open permissions
  - pattern: 'curl[^|]*\|\s*(bash|sh|zsh)'
    level: block
    reason: Remote shell execution
  - pattern: 'npm\s+publish'
    level: destructive
    reason: Publish to registry
  - pattern: 'git\s+push\s+.*--force'
    level: destructive
    reason: Force push
  - pattern: ':\(\)\s*\{\s*:\|:'
    level: block
    reason: Fork bomb
  - pattern: 'shutdown'
    level: destructive
    reason: System shutdown
confirm_patterns:
  - pattern: 'npm\s+install'
    reason: Installing packages
  - pattern: 'pip\s+install'
    reason: Installing packages
  - pattern: 'git\s+push'
    reason: Pushing code
  - pattern: 'docker\s+rm'
    reason: Removing containers
---

# Shell

## Interface

- Tool: `shell_exec`
- Method: runs commands via the system's default shell (`/bin/sh` on Unix, `cmd.exe` on Windows)
- Timeout: none by default — commands run until they exit. You may pass an explicit timeout if you want fast failure on a command you expect to finish quickly.
- Returns combined stdout+stderr; truncated past ~100 KB

## Timeout guidelines

There is no enforced floor or default. You decide based on the command:

- **Omit timeout entirely** for commands with unpredictable duration:
  installs (`npm install`, `pip install`, `brew install`), builds
  (`npm run build`, `cargo build`, `tsc`), large git operations,
  test suites, media processing. Let them run to completion.
- **Short timeout (5000–15000 ms)** for instant checks where you want
  fast failure: `which ffmpeg`, `node -v`, `git --version`, `ls`.
  If these don't finish in seconds, something is wrong.
- **Medium timeout (30000–60000 ms)** for network-dependent commands
  where you don't want to wait forever on a dead connection:
  `curl`, `git fetch`, `git push`.
- **Use background mode** for processes that never exit on their own
  (dev servers, watchers, daemons). Timeout is irrelevant here.

## Long-lived processes (dev servers, watchers, daemons)

`npm run dev`, `next dev`, `vite`, `vite preview`, `nodemon`, `python -m http.server`,
`cargo watch`, `live-server`, and any process that serves on a port or watches
files will never exit on its own. Set `background: true` and the tool returns
immediately with the PID — no `nohup`, no `&`, no `disown`.

Call 1 — start in background (returns in < 1 second with the PID):
```
command: "npm run dev > /tmp/myapp.log 2>&1"
cwd:     "/Users/me/Desktop/projects/myapp"
background: true
```

Call 2 — verify in a SEPARATE tool call (not chained with `&&`, not `;`):
```
command: "sleep 10 && curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 && echo ' up' || tail -30 /tmp/myapp.log"
timeout: 30000
```

Notes:
- With `background: true`, stdio is `/dev/null`. Redirect inside the command
  (`> /tmp/log 2>&1`) if you want to read output later.
- The PID is in the output. Save it if you may need to stop the process
  (`kill <pid>`).
- Never set `background: true` on a command that needs to return output
  (build steps, tests, status checks). Foreground is correct for those.
- Don't chain start + curl in a single foreground call — the server needs a
  moment to bind. Use one background call to start, then a foreground call
  to verify.

## Rules

- Always show the command to the user before running it.
- Chain dependent commands with `&&` (fail fast), not `;`.
- Prefer `git status` / `git diff` over `git status .` / `git diff .` (cleaner output).
- For long-running commands (builds, installs), warn the user first.
- If a command fails, read the error and try to fix it before retrying.
- Never run destructive commands without user approval — the safety gate
  enforces this, but assume nothing.

## Common patterns

- Inspect the cwd: `ls -la`, `pwd`, `git status`.
- Inspect a file: `cat <path>` for short files, `wc -l <path>` for size.
- Search the codebase: `grep -rn 'foo' .` (or `rg 'foo'` if ripgrep is installed).
- Check Node version: `node -v`. Check Git version: `git --version`.
