import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, chmod, constants, copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const MAX_OUTPUT_BYTES = 100_000

function resolveCwd(input) {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw || raw === '~') return homedir()
  if (raw.startsWith('~/')) return path.join(homedir(), raw.slice(2))
  return raw
}

// ---------------------------------------------------------------------------
// Shell detection (cached)
// ---------------------------------------------------------------------------

let shellPromise = null

async function probeWindowsShell() {
  const candidates = [
    { name: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command'] },
    { name: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command'] }
  ]
  for (const c of candidates) {
    try {
      await execFileP('where', [c.name], { windowsHide: true })
      return { bin: c.name, args: c.args }
    } catch {
      // not on PATH
    }
  }
  return { bin: 'cmd.exe', args: ['/c'] }
}

function detectShell() {
  if (shellPromise) return shellPromise
  if (process.platform !== 'win32') {
    shellPromise = Promise.resolve({ bin: '/bin/sh', args: ['-c'] })
    return shellPromise
  }
  shellPromise = probeWindowsShell().catch(() => ({ bin: 'cmd.exe', args: ['/c'] }))
  return shellPromise
}

// ---------------------------------------------------------------------------
// Elevation detection
// ---------------------------------------------------------------------------

// Matches sudo, doas, pkexec, gsudo, runas anywhere in a command — at the
// start, after &&, after ||, after ;, or after whitespace.
const ELEVATION_RE = /(?:^|\s|&&|\|\||;)\s*(?:sudo|doas|pkexec|gsudo|runas)\s/i

// Narrower regex that captures the elevation keyword so we can rewrite it.
// Used to inject the -A flag into sudo/doas invocations.
const SUDO_INJECT_RE = /(?<=^|\s|&&|\|\||;)(\s*)(sudo|doas)(\s)/gi

// ---------------------------------------------------------------------------
// Cross-platform askpass: native OS password dialog
// ---------------------------------------------------------------------------

// Cached state so the user sees at most one password dialog per ~5 min window.
// After a successful prime, subsequent sudo calls within the cache window
// succeed silently. The askpass helper stays on disk until cleanup.
let askpassState = null // { askpassPath, tmpDir, env, primedAt }

// Injected at plugin init by the main process. On macOS we route elevation
// through this shared, app-lifetime password session so the user is prompted
// once per app run instead of per command. Null until init runs, and unused on
// non-macOS where the legacy per-session askpass path below still applies.
let sudoCtx = null

async function cleanupAskpass() {
  if (!askpassState) return
  const { tmpDir } = askpassState
  askpassState = null
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
}

// Returns the shell script body for the askpass helper on the current platform.
// The script must print the password to stdout and exit 0 on success, or
// exit non-zero on cancellation.
async function buildAskpassScript(message) {
  const escaped = (message || 'Wolffish needs admin access to run this command.').replace(
    /"/g,
    '\\"'
  )

  if (process.platform === 'darwin') {
    return `#!/bin/bash
set -e
osascript \\
  -e 'tell application "System Events" to activate' \\
  -e 'display dialog "${escaped}" default answer "" with hidden answer with title "Wolffish" buttons {"Cancel", "Authorize"} default button "Authorize"' \\
  -e 'text returned of result' 2>/dev/null
`
  }

  if (process.platform === 'linux') {
    // Probe for a GUI password tool. Wolffish is an Electron app so a
    // desktop environment is always present.
    const tools = [
      { cmd: 'zenity', args: () => `zenity --password --title="Wolffish" --text="${escaped}" 2>/dev/null` },
      { cmd: 'kdialog', args: () => `kdialog --password "${escaped}" --title "Wolffish" 2>/dev/null` },
      { cmd: 'ssh-askpass', args: () => `SSH_ASKPASS_REQUIRE=force ssh-askpass "${escaped}" 2>/dev/null` }
    ]

    for (const tool of tools) {
      try {
        await execFileP('which', [tool.cmd])
        return `#!/bin/bash\nset -e\n${tool.args()}\n`
      } catch {
        // not available
      }
    }

    return null // no GUI tool found
  }

  // Windows: sudo doesn't exist natively. Return null to trigger the
  // fast-fail path.
  return null
}

// Run a command and collect its output. Same pattern as the package-manager
// plugin's runSpawn — non-blocking, Promise-based.
function runCollect(cmd, args, env = process.env) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: err?.message ?? String(err) })
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (c) => { stdout += c.toString().slice(0, 10_000) })
    child.stderr?.on('data', (c) => { stderr += c.toString().slice(0, 10_000) })
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: err?.message ?? String(err) }))
  })
}

/**
 * Ensure sudo credentials are cached. Shows a native OS password dialog
 * on the first call; subsequent calls within ~5 minutes are free.
 *
 * Returns { ok, env, error?, cancelled? }.
 * On success, `env` contains SUDO_ASKPASS pointing at the helper script.
 * The caller passes this env to the spawned command.
 */
async function ensureElevation() {
  // The askpass helper lives for the entire Wolffish session. We create it
  // once and reuse it. Since every sudo command gets the -A flag injected,
  // sudo itself will call the helper whenever its OS-level cache expires —
  // we don't need to proactively re-prime. The user sees a native password
  // dialog only when the OS actually needs credentials (controlled by
  // sudoers timestamp_timeout, typically 5–15 min, configurable by the user).
  if (askpassState) {
    return { ok: true, env: askpassState.env }
  }

  const script = await buildAskpassScript()
  if (!script) {
    if (process.platform === 'win32') {
      return {
        ok: false,
        error:
          'operation not permitted (elevation required). ' +
          'Windows does not use sudo. Run this command in an elevated terminal (Run as Administrator), ' +
          'or ask the user to execute it manually.'
      }
    }
    return {
      ok: false,
      error:
        'operation not permitted (elevation required). ' +
        'No GUI password tool found (tried zenity, kdialog, ssh-askpass). ' +
        'Install zenity (`apt install zenity`) or ask the user to run the command in their terminal.'
    }
  }

  const tmpDir = await mkdtemp(path.join(tmpdir(), 'wolffish-askpass-'))
  const askpassPath = path.join(tmpDir, 'askpass.sh')

  try {
    await writeFile(askpassPath, script, 'utf8')
    await chmod(askpassPath, 0o700)
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: `failed to create askpass helper: ${err?.message ?? String(err)}` }
  }

  const env = { ...process.env, SUDO_ASKPASS: askpassPath }

  // Prime sudo's credential cache on first use so the user sees the dialog
  // now rather than mid-command. After this, sudo re-prompts via the askpass
  // helper automatically when the OS cache expires.
  const auth = await runCollect('sudo', ['-A', '-v'], env)

  if (auth.code !== 0) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    const detail = (auth.stderr || '').trim()
    if (!detail || /cancel/i.test(detail)) {
      return {
        ok: false,
        cancelled: true,
        error:
          'operation not permitted (user cancelled the password dialog). ' +
          'Admin access is required to run this command. Try again when ready, ' +
          'or ask the user to run it in their terminal.'
      }
    }
    return {
      ok: false,
      error: `operation not permitted (sudo authentication failed): ${detail.slice(0, 300)}`
    }
  }

  askpassState = { askpassPath, tmpDir, env }
  return { ok: true, env }
}

/**
 * Rewrite a command so that bare `sudo` / `doas` invocations include the
 * -A flag, forcing them to use the SUDO_ASKPASS helper instead of a TTY.
 * This handles chained commands like `sudo cmd1 && sudo cmd2`.
 */
function injectAskpassFlag(command) {
  return command.replace(SUDO_INJECT_RE, (_, ws, keyword, trail) => {
    return `${ws}${keyword} -A${trail}`
  })
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

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
            'Optional timeout in ms. Default: omit and let the command run until it exits. Only set this when you have a good reason to expect fast completion. Ignored when background is true.'
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

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function clamp(buf, chunk) {
  if (buf.length >= MAX_OUTPUT_BYTES) return buf
  const room = MAX_OUTPUT_BYTES - buf.length
  return buf + chunk.toString().slice(0, room)
}

function combine(out, err) {
  const parts = []
  if (out) parts.push(out.trim())
  if (err) parts.push(err.trim())
  return parts.join('\n').trim()
}

// ---------------------------------------------------------------------------
// Core execution
// ---------------------------------------------------------------------------

async function execShell(args) {
  const command = String(args?.command ?? '').trim()
  if (!command) return { success: false, error: 'empty command' }

  const cwd = resolveCwd(args?.cwd)
  try {
    await access(cwd, constants.F_OK)
  } catch {
    return { success: false, error: `cwd does not exist or is not accessible: ${cwd}` }
  }

  const shell = await detectShell()
  const needsElevation = ELEVATION_RE.test(command)

  // --- Elevation handling ---
  // When the command contains sudo/doas/pkexec, we:
  // 1. Prime the credential cache via a native OS password dialog
  // 2. Inject the -A flag so sudo uses the askpass helper (not a TTY)
  // 3. Pass SUDO_ASKPASS in the environment
  // This guarantees the command never hangs waiting for terminal input.
  let execEnv = process.env
  let execCommand = command

  if (needsElevation) {
    let handled = false

    // Preferred path (macOS + Linux): the shared in-memory password session.
    // Acquire once, reuse for the app's lifetime — no dialog after the first
    // capture. Windows has no sudo, so we skip straight to the legacy guidance.
    if (sudoCtx && process.platform !== 'win32') {
      const auth = await sudoCtx.ensurePassword()
      if (auth.ok) {
        execEnv = { ...process.env, ...sudoCtx.getElevatedEnv() }
        execCommand = injectAskpassFlag(command)
        handled = true
      } else if (!auth.unsupported) {
        // The session attempted and was rejected (cancelled, wrong password,
        // not in sudoers). Surface that — don't fall back, which would just
        // re-prompt. Only `unsupported` (no GUI tool, infra error) falls
        // through to the legacy path below.
        return {
          success: false,
          error: auth.error ?? 'operation not permitted (elevation required)'
        }
      }
    }

    // Fallback: legacy per-session askpass dialog. Runs on Windows, when the
    // session is unavailable, or when the session reported it couldn't attempt
    // (e.g. no GUI password tool on Linux). Byte-for-byte the pre-session flow.
    if (!handled) {
      const elevation = await ensureElevation()
      if (!elevation.ok) {
        return { success: false, error: elevation.error }
      }
      execEnv = elevation.env
      execCommand = injectAskpassFlag(command)

      // Refresh the OS credential cache right before execution so the timer
      // resets. This is silent (no dialog) as long as the cache hasn't already
      // expired. If it has, sudo calls the askpass helper automatically.
      await runCollect('sudo', ['-A', '-v'], execEnv)
    }
  }

  if (args?.background === true) {
    return execBackground({ command: execCommand, cwd, shell, env: execEnv })
  }

  const timeoutMs =
    typeof args?.timeout === 'number' && args.timeout > 0 ? args.timeout : 0

  const result = await execForeground({ command: execCommand, cwd, shell, timeoutMs, env: execEnv })
  if (result.success) {
    result.output = await surfaceOpenedFiles(command, cwd, result.output)
  }
  return result
}

function execBackground({ command, cwd, shell, env }) {
  try {
    const child = spawn(shell.bin, [...shell.args, command], {
      cwd,
      env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
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

function execForeground({ command, cwd, shell, timeoutMs, env }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(shell.bin, [...shell.args, command], {
        cwd,
        env,
        // stdin is 'ignore' so processes that unexpectedly block on input
        // get EOF immediately instead of hanging forever. stdout/stderr are
        // piped for capture.
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
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
        return
      }
      // Exit code 1 with no output at all is the universal "no match / nothing
      // found" signal for query tools — grep (1 = no lines matched), find/ls on
      // an absent path, test, and any pipeline ending in one of them. That is a
      // valid empty result, not a failure. Reporting it as a failure made the
      // motor retry a deterministic no-match three times and handed the model a
      // blind "(unknown)" error with zero signal. Surface it as a clean empty
      // result. Exit codes >= 2 still mean a real error (e.g. grep 2 = read
      // error) and fall through to the failure path below.
      if (code === 1 && !stdout.trim() && !stderr.trim()) {
        finish({ success: true, output: '(no matches — command exited 1 with no output)' })
        return
      }
      const diagnostic = buildDiagnostic(stdout, stderr, command)
      const partial = stdout.trim().length > 100
      finish({
        success: false,
        exitCode: code,
        partial,
        error: diagnostic
          ? `Command exited with code ${code}: ${diagnostic}`
          : `Command exited with code ${code} (no output captured — if you redirected stderr with 2>/dev/null, drop it so the cause is visible)`,
        output
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function buildDiagnostic(stdout, stderr, command) {
  const err = stderr.trim()
  const out = stdout.trim()

  if (!err && ELEVATION_RE.test(command) && out.length < 200) {
    return `operation not permitted (non-interactive shell, elevation required)\n${out}`
  }

  if (err) {
    const errPart = err.slice(0, 300)
    const outPart = out.slice(0, 200)
    return outPart ? `${errPart}\n---\n${outPart}` : errPart
  }

  if (out.length <= 500) return out
  return `${out.slice(0, 250)}\n…\n${out.slice(-250)}`
}

// ---------------------------------------------------------------------------
// Opened-file detection
// ---------------------------------------------------------------------------

// A file-opening command (open/xdg-open/start) hands the file to the OS
// viewer and prints nothing — so the chat has nothing to render, and remote
// channels (Telegram/WhatsApp) never see the file at all. Detect these
// commands after a successful run and append the same
// `[wolffish-output: path (type)]` markers the ffmpeg plugin emits; every
// channel already knows how to render or send those.

const OPENER_BINS = new Set(['open', 'xdg-open', 'start', 'start-process', 'invoke-item'])

// macOS `open` flags whose next token is an app name / bundle id, not a file.
const OPENER_FLAGS_WITH_VALUE = new Set(['-a', '-b'])

const OPEN_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif'])
const OPEN_AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.wma', '.opus'])
const OPEN_VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.m4v', '.wmv', '.flv', '.webm'])
const OPEN_DOCUMENT_EXTS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.pptx', '.csv'])

// Bot APIs cap uploads around this size; bigger files stay local-only.
const MAX_SURFACE_BYTES = 50 * 1024 * 1024

function classifyOpenedFile(ext) {
  if (OPEN_IMAGE_EXTS.has(ext)) return 'image'
  if (OPEN_AUDIO_EXTS.has(ext)) return 'audio'
  if (OPEN_VIDEO_EXTS.has(ext)) return 'video'
  if (OPEN_DOCUMENT_EXTS.has(ext)) return 'document'
  return null
}

// Minimal quote-aware splitter. Backslash escaping is a POSIX-ism — on
// Windows backslash is the path separator and must pass through.
function tokenizeCommand(cmd) {
  const tokens = []
  const escapes = process.platform !== 'win32'
  let cur = ''
  let quote = null
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (escapes && ch === '\\' && quote === '"' && i + 1 < cmd.length) cur += cmd[++i]
      else cur += ch
    } else if (ch === "'" || ch === '"') {
      quote = ch
    } else if (escapes && ch === '\\' && i + 1 < cmd.length) {
      cur += cmd[++i]
    } else if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur)
        cur = ''
      }
    } else {
      cur += ch
    }
  }
  if (cur) tokens.push(cur)
  return tokens
}

export async function detectOpenedFiles(command, cwd) {
  const found = []
  const seen = new Set()
  // A `cd` anywhere in the chain makes relative resolution unreliable —
  // only absolute and ~ paths are trusted in that case.
  const hasCd = /(?:^|&&|\|\||;|\|)\s*cd\s/.test(command)
  for (const sub of command.split(/&&|\|\||;|\|/)) {
    const tokens = tokenizeCommand(sub.trim())
    if (tokens.length < 2) continue
    const bin = path.basename(tokens[0]).toLowerCase().replace(/\.exe$/, '')
    if (!OPENER_BINS.has(bin)) continue
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i]
      // Everything after `open --args` belongs to the launched app.
      if (tok === '--args') break
      if (OPENER_FLAGS_WITH_VALUE.has(tok.toLowerCase())) {
        i++
        continue
      }
      if (tok.startsWith('-')) continue
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(tok)) continue
      // cmd.exe `start` switches (/min, /wait, …) — a real unix path has
      // more than one segment, so this never matches one.
      if (bin === 'start' && /^\/\w+$/.test(tok)) continue
      let resolved = tok
      if (tok === '~') resolved = homedir()
      else if (tok.startsWith('~/')) resolved = path.join(homedir(), tok.slice(2))
      else if (!path.isAbsolute(tok)) {
        if (hasCd) continue
        resolved = path.resolve(cwd, tok)
      }
      const type = classifyOpenedFile(path.extname(resolved).toLowerCase())
      if (!type || seen.has(resolved)) continue
      let st
      try {
        st = await stat(resolved)
      } catch {
        continue
      }
      if (!st.isFile() || st.size > MAX_SURFACE_BYTES) continue
      seen.add(resolved)
      found.push({ path: resolved, type })
      if (found.length >= 5) return found
    }
  }
  return found
}

async function surfaceOpenedFiles(command, cwd, output) {
  let opened
  try {
    opened = await detectOpenedFiles(command, cwd)
  } catch {
    return output
  }
  if (opened.length === 0) return output

  const wsRoot = path.join(homedir(), '.wolffish', 'workspace')
  const markers = []
  for (const file of opened) {
    let markerPath = file.path
    if (!file.path.startsWith(wsRoot + path.sep)) {
      // The in-app renderer can only read inside the workspace — copy
      // outside files into workspace/files/, same as the ffmpeg plugin.
      try {
        const filesDir = path.join(wsRoot, 'files')
        await mkdir(filesDir, { recursive: true })
        const ext = path.extname(file.path)
        const baseName = path.basename(file.path)
        const stem = path.basename(baseName, ext)
        const srcSize = (await stat(file.path)).size
        let destPath = path.join(filesDir, baseName)
        let suffix = 0
        let reuse = false
        while (existsSync(destPath)) {
          const destSize = await stat(destPath)
            .then((s) => s.size)
            .catch(() => -1)
          // Same name and size ⇒ the same file re-opened; don't pile up copies.
          if (destSize === srcSize) {
            reuse = true
            break
          }
          suffix++
          destPath = path.join(filesDir, `${stem}_${suffix}${ext}`)
        }
        if (!reuse) await copyFile(file.path, destPath)
        markerPath = destPath
      } catch {
        // copy failed — remote channels can still send the original path
      }
    }
    markers.push(`[wolffish-output: ${markerPath} (${file.type})]`)
  }

  const base = output && output !== '(no output)' ? output : ''
  return base ? `${base}\n${markers.join('\n')}` : markers.join('\n')
}

// ---------------------------------------------------------------------------
// Risk descriptions (for the approval card UI)
// ---------------------------------------------------------------------------

const HIGH_RISK_RE =
  /\brm\s+(-rf|--recursive)|\bmkfs|\bdd\s+if=|chmod\s+777|curl[^|]*\|\s*(bash|sh|zsh)|:\(\)\s*\{\s*:\|:|shutdown|sudo\s+|git\s+push\s+.*--force|npm\s+publish/i
const MEDIUM_RISK_RE = /\b(npm|pip|brew|apt|dnf|cargo|gem)\s+install\b|git\s+push\b|docker\s+rm\b|rm\s+/i

function describeShellAction(command) {
  const cmd = String(command ?? '').trim()
  let risk = 'low'
  if (HIGH_RISK_RE.test(cmd)) risk = 'high'
  else if (MEDIUM_RISK_RE.test(cmd)) risk = 'medium'

  const verbMap = [
    [/^ls\b/, 'List files'],
    [/^pwd\b/, 'Print working directory'],
    [/^cat\b/, 'Print file contents'],
    [/^(?:open|xdg-open|start)\b/, 'Open file'],
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
    impact = 'Runs with elevated privileges (will prompt for your password via system dialog).'
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

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

const plugin = {
  name: 'shell',
  tools: toolDefinitions,
  async init(context) {
    sudoCtx = context?.sudo ?? null
  },
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
