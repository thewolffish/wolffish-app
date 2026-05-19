import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const MAX_OUTPUT_BYTES = 100_000

// Node's child_process treats `~` as a literal directory name, so a cwd
// like "~/Desktop" makes spawn fail with ENOENT. Expand it ourselves.
function resolveCwd(input) {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw || raw === '~') return homedir()
  if (raw.startsWith('~/')) return path.join(homedir(), raw.slice(2))
  return raw
}

const toolDefinitions = [
  {
    name: 'shell_exec',
    description: 'Run a shell command and return its combined stdout+stderr.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        cwd: { type: 'string', description: 'Working directory (default: user home)' },
        timeout: {
          type: 'number',
          description:
            'Optional timeout in ms. If omitted, the command runs until it exits naturally. Use short timeouts (5000–15000) for quick checks, longer ones for builds/installs, or omit entirely for commands with unpredictable duration. Ignored when background is true.'
        },
        background: {
          type: 'boolean',
          description:
            'Start the command detached and return immediately with its PID. Use for dev servers, watchers, daemons, or any process that does not exit on its own (npm run dev, vite, nodemon). stdio is set to /dev/null — redirect inside the command if you want to read output later (e.g. > /tmp/log 2>&1).'
        }
      },
      required: ['command']
    }
  }
]

function clamp(buf, chunk) {
  if (buf.length >= MAX_OUTPUT_BYTES) return buf
  const room = MAX_OUTPUT_BYTES - buf.length
  return buf + chunk.toString().slice(0, room)
}

async function execShell(args) {
  const command = String(args?.command ?? '').trim()
  if (!command) return { success: false, error: 'empty command' }

  const cwd = resolveCwd(args?.cwd)
  // Without this, an invalid cwd (a path the model invented from training
  // data, a typo, or a stale memory) makes spawn fail with a misleading
  // "spawn /bin/sh ENOENT" — the ENOENT is for the cwd, not the shell
  // binary. Reject up front with a clear message so the model can retry.
  try {
    await access(cwd, constants.F_OK)
  } catch {
    return { success: false, error: `cwd does not exist or is not accessible: ${cwd}` }
  }

  const isWindows = process.platform === 'win32'
  const shellBin = isWindows ? 'cmd.exe' : '/bin/sh'
  const flag = isWindows ? '/c' : '-c'

  if (args?.background === true) {
    return execBackground({ command, cwd, shellBin, flag })
  }

  const timeoutMs =
    typeof args?.timeout === 'number' && args.timeout > 0 ? args.timeout : 0

  return execForeground({ command, cwd, shellBin, flag, timeoutMs })
}

// detached + ignored stdio + unref is the load-bearing triple: detached makes
// the child its own process group leader so it survives Node's exit; ignored
// stdio means the child has no pipes to inherit (so the foreground 'close'
// event isn't blocked by descendants holding fd 1/2 open); unref tells Node's
// event loop not to wait for this child. Without all three, the tool hangs
// indefinitely even though the user asked for background launch.
function execBackground({ command, cwd, shellBin, flag }) {
  try {
    const child = spawn(shellBin, [flag, command], {
      cwd,
      env: process.env,
      detached: true,
      stdio: 'ignore'
    })
    const pid = child.pid
    if (!pid) {
      return { success: false, error: 'failed to start background process (no PID returned)' }
    }
    child.unref()
    return { success: true, output: `Started in background, PID: ${pid}` }
  } catch (err) {
    return { success: false, error: err?.message ?? String(err) }
  }
}

function execForeground({ command, cwd, shellBin, flag, timeoutMs }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(shellBin, [flag, command], { cwd, env: process.env })
    } catch (err) {
      resolve({ success: false, error: err?.message ?? String(err) })
      return
    }

    let stdout = ''
    let stderr = ''
    let resolved = false
    let timer = null
    const finish = (result) => {
      if (resolved) return
      resolved = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already dead
        }
        finish({
          success: false,
          error: `Command timed out after ${timeoutMs}ms`,
          output: combine(stdout, stderr)
        })
      }, timeoutMs)
    }

    child.stdout?.on('data', (chunk) => {
      stdout = clamp(stdout, chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = clamp(stderr, chunk)
    })
    child.on('error', (err) => {
      finish({ success: false, error: err?.message ?? String(err) })
    })
    child.on('close', (code) => {
      const output = combine(stdout, stderr)
      if (code === 0) {
        finish({ success: true, output: output || '(no output)' })
      } else {
        const diagnostic = output.slice(0, 500)
        finish({
          success: false,
          error: diagnostic
            ? `Command exited with code ${code}: ${diagnostic}`
            : `Command exited with code ${code}`,
          output
        })
      }
    })
  })
}

function combine(out, err) {
  const parts = []
  if (out) parts.push(out.trim())
  if (err) parts.push(err.trim())
  return parts.join('\n').trim()
}

// Risk inference for shell_exec descriptions. The cerebellum's amygdala
// also runs its own classification for blocking/confirmation; this is just
// for the colored dot on the approval card so the user can read severity
// at a glance.
const HIGH_RISK_RE =
  /\brm\s+(-rf|--recursive)|\bmkfs|\bdd\s+if=|chmod\s+777|curl[^|]*\|\s*(bash|sh|zsh)|:\(\)\s*\{\s*:\|:|shutdown|sudo\s+|git\s+push\s+.*--force|npm\s+publish/i
const MEDIUM_RISK_RE = /\b(npm|pip|brew|apt|dnf|cargo|gem)\s+install\b|git\s+push\b|docker\s+rm\b|rm\s+/i

function describeShellAction(command) {
  const cmd = String(command ?? '').trim()
  let risk = 'low'
  if (HIGH_RISK_RE.test(cmd)) risk = 'high'
  else if (MEDIUM_RISK_RE.test(cmd)) risk = 'medium'

  // Tiny one-liners describing common verbs. Falls back to a generic
  // "Run shell command" when the command is unfamiliar — never empty.
  const verbMap = [
    [/^ls\b/, 'List files'],
    [/^pwd\b/, 'Print working directory'],
    [/^cat\b/, 'Print file contents'],
    [/^cd\b/, 'Change directory'],
    [/^cp\b/, 'Copy files'],
    [/^mv\b/, 'Move/rename files'],
    [/^rm\s+(-rf|--recursive)/, 'Delete directory recursively'],
    [/^rm\b/, 'Delete files'],
    [/^mkdir\b/, 'Create directory'],
    [/^grep\b|^rg\b/, 'Search code'],
    [/^find\b/, 'Find files'],
    [/^git\s+status/, 'Check git status'],
    [/^git\s+diff/, 'Show git diff'],
    [/^git\s+log/, 'Show git log'],
    [/^git\s+push/, 'Push commits to remote'],
    [/^git\s+pull/, 'Pull from remote'],
    [/^git\s+commit/, 'Create git commit'],
    [/^npm\s+install/, 'Install npm dependencies'],
    [/^npm\s+run/, 'Run npm script'],
    [/^pip\s+install/, 'Install Python packages'],
    [/^docker\s+/, 'Run Docker command'],
    [/^brew\s+install/, 'Install with Homebrew'],
    [/^curl\b/, 'Make HTTP request']
  ]
  let description = 'Run shell command'
  for (const [re, label] of verbMap) {
    if (re.test(cmd)) {
      description = label
      break
    }
  }

  let impact
  if (/^rm\s+(-rf|--recursive)/.test(cmd)) {
    impact = 'Permanently deletes files. This cannot be undone.'
  } else if (/sudo\s+/.test(cmd)) {
    impact = 'Runs with elevated privileges.'
  } else if (/git\s+push\s+.*--force/.test(cmd)) {
    impact = 'Force-pushes the branch — may overwrite remote history.'
  }

  const out = {
    title: 'Run shell command',
    description,
    command: cmd,
    risk
  }
  if (impact) out.impact = impact
  return out
}

const plugin = {
  name: 'shell',
  tools: toolDefinitions,
  describeAction(toolName, args) {
    if (toolName !== 'shell_exec') return null
    return describeShellAction(args?.command)
  },
  async execute(toolName, args) {
    if (toolName !== 'shell_exec') {
      return { success: false, error: `shell: unknown tool ${toolName}` }
    }
    return execShell(args)
  }
}

export default plugin
