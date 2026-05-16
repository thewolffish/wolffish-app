import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const PROBE_TIMEOUT_MS = 10_000
const MAX_OUTPUT = 50_000

let workspaceRoot = ''
// One of: { type: 'binary', path: string } | { type: 'module', python: string }
let executor = null
// Set during init from the cerebellum's PluginContext. Returns the current
// conversation id at call time (closes over the cerebellum's internal
// state), or null when no turn is active. Defaulted to a no-op so the
// plugin still loads under older host versions that don't pass it.
let getConversationId = () => null

const toolDefinitions = [
  {
    name: 'voice_generate',
    description:
      'Convert text to a voice memo (MP3). Returns the file path of the generated audio.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to convert to speech' },
        voice: { type: 'string', description: 'Voice name (default: en-US-AriaNeural)' },
        speed: { type: 'string', description: 'Speech rate (default: +0%)' }
      },
      required: ['text']
    }
  },
  {
    name: 'voice_respond',
    description: 'Respond entirely as a voice memo. The voice IS the response.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The full response text to speak' },
        voice: { type: 'string', description: 'Voice name (default: en-US-AriaNeural)' },
        speed: { type: 'string', description: 'Speech rate (default: +0%)' }
      },
      required: ['text']
    }
  },
  {
    name: 'voice_list',
    description: 'List all voice memo files in the workspace.',
    parameters: { type: 'object', properties: {}, required: [] }
  }
]

// Speech files are scoped to their conversation: workspace/speech/conv-<id>/.
// The folder name mirrors the conversations/ filename convention (conv-<id>.json)
// so it's obvious at a glance which audio belongs to which conversation, and
// deleting the conversation file naturally pairs with deleting the folder.
// When no conversation is active (synthetic tool calls outside a turn,
// older host versions without the getter), files land in a flat
// speech/orphan/ folder so they aren't lost — but every normal chat-driven
// call sees a real id.
function speechDir() {
  const base = path.join(workspaceRoot, 'speech')
  const id = (getConversationId() ?? '').trim()
  if (!id) return path.join(base, 'orphan')
  // Defensive: ids are timestamps but treat as untrusted just in case.
  // Strip anything that isn't safe for a folder name on every platform.
  const safe = id.replace(/[^A-Za-z0-9._-]/g, '_')
  return path.join(base, `conv-${safe}`)
}

function shortHash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 8)
}

function clampOutput(buf, chunk) {
  if (buf.length >= MAX_OUTPUT) return buf
  return buf + chunk.toString().slice(0, MAX_OUTPUT - buf.length)
}

// Standard which/where wrapper — same shape used by ffmpeg, node, cloudflared,
// package-manager. Searches the inherited PATH; returns null on miss.
async function which(cmd) {
  try {
    const bin = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileP(bin, [cmd])
    return stdout.trim().split('\n')[0].trim() || null
  } catch {
    return null
  }
}

// Check whether a hardcoded path actually points at a runnable binary.
// Cheaper and more reliable than `which` for canonical install locations
// because it doesn't depend on PATH being populated correctly — Electron
// apps launched from Finder/Dock get a stripped PATH without the user's
// shell additions, so PATH-based lookups miss brew/pipx installs that the
// user can clearly see in Terminal.
async function isExecutable(p) {
  try {
    await execFileP(p, ['--help'], { timeout: PROBE_TIMEOUT_MS })
    return true
  } catch (err) {
    // Some CLIs exit non-zero on --help (rare). Treat ENOENT as missing,
    // anything else as present-but-quirky → still callable.
    return err?.code !== 'ENOENT'
  }
}

// Canonical locations where `edge-tts` lands across the three install
// paths we support: pipx (modern, isolated venv), pip --user (legacy
// per-user), and brew (macOS only, packaged as a pipx target). Order
// matters: cheapest/most-likely first.
function edgeTtsCandidates() {
  const home = homedir()
  if (process.platform === 'win32') {
    const exe = (p) => p + '.exe'
    return [
      exe(path.join(home, '.local', 'bin', 'edge-tts')),
      exe(path.join(home, 'AppData', 'Roaming', 'Python', 'Scripts', 'edge-tts')),
      exe(path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Scripts', 'edge-tts'))
    ]
  }
  const candidates = [
    path.join(home, '.local', 'bin', 'edge-tts'),
    '/opt/homebrew/bin/edge-tts',
    '/usr/local/bin/edge-tts',
    '/usr/bin/edge-tts'
  ]
  if (process.platform === 'darwin') {
    // pip install --user on stock macOS Python lands here, versioned by
    // the active Python minor version.
    for (const v of ['3.13', '3.12', '3.11', '3.10', '3.9']) {
      candidates.push(path.join(home, 'Library', 'Python', v, 'bin', 'edge-tts'))
    }
  }
  return candidates
}

function pythonCandidates() {
  const home = homedir()
  if (process.platform === 'win32') {
    return ['python', 'py', 'python3']
  }
  return [
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
    path.join(home, '.local', 'bin', 'python3'),
    'python3',
    'python'
  ]
}

function pipxCandidates() {
  const home = homedir()
  if (process.platform === 'win32') {
    return [
      path.join(home, '.local', 'bin', 'pipx.exe'),
      path.join(home, 'AppData', 'Roaming', 'Python', 'Scripts', 'pipx.exe'),
      'pipx'
    ]
  }
  return [
    path.join(home, '.local', 'bin', 'pipx'),
    '/opt/homebrew/bin/pipx',
    '/usr/local/bin/pipx',
    '/usr/bin/pipx',
    'pipx'
  ]
}

// Find the first candidate that's actually executable. Bare names (no
// path separator) are looked up via `which`; absolute paths are probed
// directly. Returns null if nothing in the list works.
async function firstExecutable(candidates) {
  for (const c of candidates) {
    const isPath = c.includes(path.sep) || c.startsWith('/')
    if (isPath) {
      try {
        await access(c)
      } catch {
        continue
      }
      if (await isExecutable(c)) return c
    } else {
      const found = await which(c)
      if (found) return found
    }
  }
  return null
}

async function detectEdgeTtsBinary() {
  return firstExecutable(edgeTtsCandidates())
}

async function detectPython() {
  return firstExecutable(pythonCandidates())
}

async function detectPipx() {
  return firstExecutable(pipxCandidates())
}

async function detectEdgeTtsModule(python) {
  if (!python) return false
  try {
    await execFileP(python, ['-m', 'edge_tts', '--help'], { timeout: PROBE_TIMEOUT_MS })
    return true
  } catch {
    return false
  }
}

// Try every install path that doesn't need user interaction. pipx is the
// modern blessed way to install Python CLI tools — works on every platform
// without PEP 668 hassles. pip --user is the fallback for systems where
// pipx isn't yet bootstrapped; --break-system-packages handles modern
// Linux/Brew Python that hard-error on naive --user installs.
async function tryInstall() {
  const pipx = await detectPipx()
  if (pipx) {
    const result = await runInstall(pipx, ['install', 'edge-tts'])
    if (result.ok) return { ok: true, via: 'pipx' }
  }

  const python = await detectPython()
  if (python) {
    // pipx via python module — works when pipx is installed but not on PATH
    const m1 = await runInstall(python, ['-m', 'pipx', 'install', 'edge-tts'])
    if (m1.ok) return { ok: true, via: 'python -m pipx' }

    const m2 = await runInstall(python, [
      '-m',
      'pip',
      'install',
      'edge-tts',
      '--user',
      '--break-system-packages',
      '--quiet'
    ])
    if (m2.ok) return { ok: true, via: 'pip --user --break-system-packages' }

    const m3 = await runInstall(python, [
      '-m',
      'pip',
      'install',
      'edge-tts',
      '--user',
      '--quiet'
    ])
    if (m3.ok) return { ok: true, via: 'pip --user' }
  }

  return { ok: false }
}

function runInstall(bin, args) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(bin, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ ok: false, error: err?.message ?? String(err) })
      return
    }
    let stdout = ''
    let stderr = ''
    let resolved = false
    const finish = (r) => {
      if (resolved) return
      resolved = true
      resolve(r)
    }
    child.stdout?.on('data', (c) => {
      stdout = clampOutput(stdout, c)
    })
    child.stderr?.on('data', (c) => {
      stderr = clampOutput(stderr, c)
    })
    child.on('error', (err) => finish({ ok: false, error: err?.message ?? String(err) }))
    child.on('close', (code) => {
      if (code === 0) finish({ ok: true })
      else finish({ ok: false, error: (stderr || stdout).slice(-500) })
    })
  })
}

// Find an edge-tts executor (binary or python module). Re-runs detection
// every call so a manual install mid-session picks up automatically — same
// reason ensure-style functions exist throughout the codebase.
async function ensureReady() {
  if (executor) return { ok: true }

  // 1. Already-installed binary via canonical path or PATH
  const binary = await detectEdgeTtsBinary()
  if (binary) {
    executor = { type: 'binary', path: binary }
    return { ok: true }
  }

  // 2. Already-installed module via system Python
  const python = await detectPython()
  if (await detectEdgeTtsModule(python)) {
    executor = { type: 'module', python }
    return { ok: true }
  }

  // 3. Not installed — attempt automatic install
  const installed = await tryInstall()
  if (!installed.ok) {
    if (!python) {
      return {
        ok: false,
        error:
          'Python 3 is required for voice memos. Install it from https://python.org and try again.'
      }
    }
    return {
      ok: false,
      error:
        'edge-tts could not be installed automatically. Install it manually:\n' +
        '  pipx install edge-tts   (recommended)\n' +
        `  ${python} -m pip install --user --break-system-packages edge-tts`
    }
  }

  // 4. Re-detect after install
  const installedBinary = await detectEdgeTtsBinary()
  if (installedBinary) {
    executor = { type: 'binary', path: installedBinary }
    return { ok: true }
  }
  if (await detectEdgeTtsModule(python)) {
    executor = { type: 'module', python }
    return { ok: true }
  }
  return {
    ok: false,
    error:
      'edge-tts installed via ' +
      installed.via +
      ' but the binary could not be located. Restart the app and try again.'
  }
}

async function generateVoice(text, voice, speed, isResponse) {
  const ready = await ensureReady()
  if (!ready.ok) return { success: false, error: ready.error }

  const trimmed = (text ?? '').trim()
  if (!trimmed) return { success: false, error: 'Text is required' }

  const voiceName = voice || 'en-US-AriaNeural'
  const rate = speed || '+0%'
  const dir = speechDir()
  await mkdir(dir, { recursive: true })

  const timestamp = Date.now()
  const hash = shortHash(trimmed)
  const fileName = `${timestamp}-${hash}.mp3`
  const filePath = path.join(dir, fileName)

  // Pass text via temp file to sidestep all shell-quoting and arg-length
  // concerns (Windows command-line limit, special chars, newlines).
  const tmpFile = path.join(tmpdir(), `wolffish-tts-${timestamp}-${hash}.txt`)
  try {
    await writeFile(tmpFile, trimmed, 'utf8')
  } catch (err) {
    return { success: false, error: `Failed to write temp file: ${err?.message ?? err}` }
  }

  try {
    const result = await runEdgeTts(tmpFile, filePath, voiceName, rate)
    if (!result.ok) return { success: false, error: result.error || 'edge-tts failed' }

    let st
    try {
      st = await stat(filePath)
    } catch {
      return { success: false, error: 'Output file was not created' }
    }
    if (st.size === 0) {
      await unlink(filePath).catch(() => {})
      return { success: false, error: 'Output file is empty' }
    }

    return {
      success: true,
      output: JSON.stringify({
        filePath,
        fileName,
        sizeBytes: st.size,
        voice: voiceName,
        speed: rate,
        isResponse: !!isResponse,
        textLength: trimmed.length
      })
    }
  } finally {
    await unlink(tmpFile).catch(() => {})
  }
}

function runEdgeTts(inputFile, outputFile, voice, rate) {
  const ttsArgs = [
    '--file',
    inputFile,
    '--write-media',
    outputFile,
    '--voice',
    voice,
    '--rate',
    rate
  ]

  const bin = executor.type === 'binary' ? executor.path : executor.python
  const args = executor.type === 'binary' ? ttsArgs : ['-m', 'edge_tts', ...ttsArgs]

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(bin, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ ok: false, error: `Failed to spawn edge-tts: ${err?.message ?? err}` })
      return
    }

    let stderr = ''
    let resolved = false
    const finish = (r) => {
      if (resolved) return
      resolved = true
      resolve(r)
    }

    child.stderr?.on('data', (c) => {
      stderr = clampOutput(stderr, c)
    })
    child.on('error', (err) => finish({ ok: false, error: err?.message ?? String(err) }))
    child.on('close', (code) => {
      if (code === 0) finish({ ok: true })
      else
        finish({
          ok: false,
          error: `edge-tts exited with code ${code}${stderr ? ': ' + stderr.slice(-500) : ''}`
        })
    })
  })
}

async function listSpeechFiles() {
  const root = path.join(workspaceRoot, 'speech')
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return { success: true, output: JSON.stringify({ files: [], count: 0 }) }
  }

  const files = []
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.mp3')) {
      // Loose top-level files (legacy from before per-conversation folders)
      await collectFile(path.join(root, entry.name), null, files)
    } else if (entry.isDirectory()) {
      const conv = entry.name.startsWith('conv-') ? entry.name.slice('conv-'.length) : null
      const subDir = path.join(root, entry.name)
      let subEntries
      try {
        subEntries = await readdir(subDir)
      } catch {
        continue
      }
      for (const name of subEntries) {
        if (!name.endsWith('.mp3')) continue
        await collectFile(path.join(subDir, name), conv, files)
      }
    }
  }
  files.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { success: true, output: JSON.stringify({ files, count: files.length }) }
}

async function collectFile(filePath, conversationId, sink) {
  try {
    const st = await stat(filePath)
    sink.push({
      name: path.basename(filePath),
      path: filePath,
      conversationId,
      sizeBytes: st.size,
      createdAt: st.birthtime.toISOString()
    })
  } catch {
    // skip unreadable
  }
}

const plugin = {
  name: 'text-to-speech',
  tools: toolDefinitions,

  async init(context) {
    workspaceRoot = context.workspaceRoot
    if (typeof context.getCurrentConversationId === 'function') {
      getConversationId = context.getCurrentConversationId
    }
    // Best-effort: probe quietly so the first user request doesn't pay the
    // detection cost. Silent on failure — ensureReady() retries on every
    // execute() so a manual install mid-session picks up automatically.
    await ensureReady().catch(() => {})
  },

  async execute(toolName, args) {
    // Read user-selected defaults from config.json on each call so
    // changes made in Settings → Services → Text-to-Speech take
    // effect without a reload. Best-effort — missing or malformed
    // config falls through to the in-function defaults.
    let cfgVoice = ''
    let cfgSpeed = ''
    try {
      const raw = await readFile(path.join(workspaceRoot, 'config.json'), 'utf8')
      const cfg = JSON.parse(raw)
      if (typeof cfg?.tts?.defaultVoice === 'string') cfgVoice = cfg.tts.defaultVoice
      if (typeof cfg?.tts?.defaultSpeed === 'string') cfgSpeed = cfg.tts.defaultSpeed
    } catch {
      // keep empty fallbacks
    }
    const voice = args?.voice || cfgVoice || undefined
    const speed = args?.speed || cfgSpeed || undefined
    switch (toolName) {
      case 'voice_generate':
        return generateVoice(args?.text, voice, speed, false)
      case 'voice_respond':
        return generateVoice(args?.text, voice, speed, true)
      case 'voice_list':
        return listSpeechFiles()
      default:
        return { success: false, error: `text-to-speech: unknown tool ${toolName}` }
    }
  }
}

export default plugin
