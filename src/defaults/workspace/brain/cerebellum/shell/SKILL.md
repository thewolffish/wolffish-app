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
    description: Run a shell command and return its output. Default cwd is the user home directory. Commands run until they exit — only set a timeout when you have a good reason to expect fast completion. Elevation commands (sudo, doas) are handled automatically via native OS password dialog — no TTY needed. Set background=true for long-lived processes (dev servers, watchers).
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
        description: Optional timeout in ms. Default is no timeout — commands run until they exit. Only set this when you have a good reason to expect fast completion. Ignored when background is true.
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
    reason: Privilege escalation — user will see native OS password dialog
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
- Method: runs commands via the host's preferred shell, detected once at startup:
  - **Unix:** `/bin/sh -c`
  - **Windows:** PowerShell 7+ (`pwsh`) if installed, else Windows PowerShell 5.1 (`powershell.exe`), else `cmd.exe`. Check the `<device>` block in your system prompt to see which one is active — it's reported as `shell:`.
- Timeout: none by default — commands run until they exit. You may pass an explicit timeout if you want fast failure on a command you expect to finish quickly.
- Elevation: `sudo` and `doas` commands are **fully supported**. The plugin detects them, pops a native OS password dialog (macOS: system dialog via osascript, Linux: zenity or kdialog), caches the credential for ~5 minutes, and injects the `-A` flag so no TTY is needed. The user sees one password prompt per session, not per command.
- stdin: set to `/dev/null` (EOF) so commands that unexpectedly wait for input fail fast instead of hanging.
- Returns combined stdout+stderr; truncated past ~100 KB

## Writing commands for the active shell

The selected shell determines the syntax that works. Mismatched syntax fails fast (the runtime classifies "is not recognized" / "syntax is incorrect" as non-retryable) — so you'll see one fast error rather than minutes of retries, but you still wasted a call.

- **PowerShell (pwsh or powershell.exe)** — use PowerShell cmdlets and operators. `Get-ChildItem` (or its alias `ls`/`dir`), `Get-Content` (`cat`/`type`), `Start-Process`, `$env:NAME` for env vars, `2>$null` to discard stderr.
  - On Windows PowerShell 5.1 specifically, `&&` and `||` chain operators do NOT exist — use `;` for unconditional chaining, or wrap in `if ($?) { ... }` for conditional. pwsh 7+ supports `&&`/`||` natively.
  - `where` is an alias for `Where-Object`; to find an executable use `where.exe foo` or `Get-Command foo`.
- **cmd.exe** — classic cmd syntax. `dir`, `type`, `set FOO=bar`, `%ENV%` expansion, `2>nul`, `&&` / `||` work.
- **/bin/sh** — POSIX. `ls`, `cat`, `export FOO=bar`, `$ENV`, `2>/dev/null`, `&&` / `||`.

If you're unsure which dialect a command needs, prefer external `.exe` invocations (`where.exe`, `findstr.exe`, `cloudflared.exe`) — those work identically across all three shells.

## Timeout guidelines

**Default: no timeout.** Let commands run until they finish. Long
execution is normal in an agentic workflow — nothing is wasted while the
device runs a command, and most things self-terminate anyway.

Only set a timeout when you have a really good reason — when you know
for a fact the command should finish quickly and hanging would mean
something is wrong. For most commands, just let them run.

For processes that never exit on their own (dev servers, watchers,
daemons), use `background: true` — timeout is irrelevant.

## Elevation commands (sudo, doas, etc.)

`sudo` and `doas` commands **work normally** — no special handling needed
from your side. The plugin automatically:

1. Detects elevation keywords in the command
2. Pops a native OS password dialog (macOS system dialog, Linux zenity/kdialog)
3. Caches the credential for ~5 minutes (one prompt per session, not per command)
4. Injects the `-A` flag so sudo uses the dialog instead of a TTY
5. Runs the original command with the cached credential

If the user cancels the dialog or no GUI tool is available, the plugin
returns a non-retryable error immediately — it never hangs.

On Windows, sudo does not exist. If a task requires admin privileges on
Windows (modifying system files, changing firewall rules, installing
system-wide services, editing the registry, etc.), do NOT use `sudo`,
`gsudo`, or `runas` in the command. Instead:

1. Tell the user: "This task requires administrator privileges. Please
   close Wolffish and relaunch it by right-clicking → Run as Administrator,
   then try this task again."
2. Do NOT retry the command or attempt workarounds — the user must restart
   Wolffish with elevated privileges first.
3. Once Wolffish is running as admin, all commands automatically have full
   privileges — just run them normally without any elevation prefix.

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
