import { spawn, execFile } from 'node:child_process'
import { access, mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const PROBE_TIMEOUT_MS = 10_000
const MAX_OUTPUT = 200_000
const MAX_FILE_BYTES = 500 * 1024 * 1024

let workspaceRoot = ''
// One of: { type: 'binary', path: string } | { type: 'module', python: string }
let executor = null
// Discovered ffmpeg path (used to inject into the whisper subprocess PATH so
// whisper's internal subprocess call to ffmpeg works even when Electron
// inherited a stripped PATH from a Finder/Dock launch).
let ffmpegPath = null
let initError = null
let defaultModel = 'base'
let getConversationId = () => null

const toolDefinitions = [
  {
    name: 'stt_transcribe',
    description:
      'Transcribe an audio file by absolute or workspace-relative path. Returns text, language, and segments.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path or workspace-relative path' },
        language: { type: 'string', description: 'ISO 639-1 language code, optional' },
        model: { type: 'string', description: 'tiny/base/small/medium/large, default base' }
      },
      required: ['filePath']
    }
  },
  {
    name: 'stt_transcribe_upload',
    description:
      'Transcribe an uploaded audio file in the current conversation. Resolves the path inside workspace/uploads/{conversationDir}/.',
    parameters: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: 'Filename of the uploaded audio' },
        language: { type: 'string', description: 'ISO 639-1 language code, optional' },
        model: { type: 'string', description: 'tiny/base/small/medium/large, default base' }
      },
      required: ['fileName']
    }
  },
  {
    name: 'stt_transcribe_voice_memo',
    description: 'Transcribe a voice memo file under workspace/voice/.',
    parameters: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: 'Voice memo filename (.mp3)' },
        language: { type: 'string', description: 'ISO 639-1 language code, optional' },
        model: { type: 'string', description: 'tiny/base/small/medium/large, default base' }
      },
      required: ['fileName']
    }
  },
  {
    name: 'stt_detect_language',
    description:
      "Detect the spoken language of an audio file using Whisper's first-30-second probe.",
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path or workspace-relative path' }
      },
      required: ['filePath']
    }
  }
]

// ---------- detection helpers (mirror text-to-speech patterns) ----------

async function which(cmd) {
  try {
    const bin = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileP(bin, [cmd])
    return stdout.trim().split('\n')[0].trim() || null
  } catch {
    return null
  }
}

async function isExecutable(p) {
  try {
    await execFileP(p, ['--help'], { timeout: PROBE_TIMEOUT_MS })
    return true
  } catch (err) {
    return err?.code !== 'ENOENT'
  }
}

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

// Canonical locations where the `whisper` CLI lands across the install
// paths we support: pipx (modern, isolated venv), pip --user (legacy
// per-user), and brew (macOS, packaged as a pipx target). pipx is the
// most likely path on a modern system because it sidesteps PEP 668.
function whisperCandidates() {
  const home = homedir()
  if (process.platform === 'win32') {
    const exe = (p) => p + '.exe'
    return [
      exe(path.join(home, '.local', 'bin', 'whisper')),
      exe(path.join(home, 'AppData', 'Roaming', 'Python', 'Scripts', 'whisper')),
      exe(path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Scripts', 'whisper'))
    ]
  }
  const candidates = [
    path.join(home, '.local', 'bin', 'whisper'),
    '/opt/homebrew/bin/whisper',
    '/usr/local/bin/whisper',
    '/usr/bin/whisper'
  ]
  if (process.platform === 'darwin') {
    // pip install --user on stock macOS Python lands here, versioned by
    // the active Python minor version.
    for (const v of ['3.13', '3.12', '3.11', '3.10', '3.9']) {
      candidates.push(path.join(home, 'Library', 'Python', v, 'bin', 'whisper'))
    }
  }
  return candidates
}

function ffmpegCandidates() {
  if (process.platform === 'win32') return ['ffmpeg', 'ffmpeg.exe']
  return ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']
}

async function detectPython() {
  return firstExecutable(pythonCandidates())
}

async function detectPipx() {
  return firstExecutable(pipxCandidates())
}

async function detectWhisperBinary() {
  return firstExecutable(whisperCandidates())
}

async function detectFfmpegPath() {
  return firstExecutable(ffmpegCandidates())
}

async function detectWhisperModule(python) {
  if (!python) return false
  try {
    await execFileP(python, ['-c', 'import whisper'], { timeout: PROBE_TIMEOUT_MS })
    return true
  } catch {
    return false
  }
}

function ffmpegInstallMessage() {
  if (process.platform === 'darwin') {
    return 'ffmpeg is required for transcription. Install it with: brew install ffmpeg'
  }
  if (process.platform === 'win32') {
    return 'ffmpeg is required for transcription. Install it with: winget install ffmpeg (or download from https://ffmpeg.org)'
  }
  return "ffmpeg is required for transcription. Install it with: sudo apt install ffmpeg (or your distro's package manager)"
}

// Try every install path that doesn't need user interaction. pipx is the
// modern blessed way to install Python CLI tools — works on every platform
// without PEP 668 hassles (the Homebrew/Debian Python 3.12+ "externally
// managed environment" error). pip --break-system-packages is the next
// fallback for systems where pipx isn't yet bootstrapped, and plain
// pip --user is the last resort for older Pythons that don't recognize
// --break-system-packages.
async function tryInstall(corpus) {
  corpus?.('stt.dep.installing', {
    dependency: 'whisper',
    note: 'first install pulls PyTorch (~2GB), can take several minutes'
  })

  const pipx = await detectPipx()
  if (pipx) {
    const r = await runInstall(pipx, ['install', 'openai-whisper'])
    if (r.ok) return { ok: true, via: 'pipx' }
  }

  const python = await detectPython()
  if (python) {
    // pipx via python module — works when pipx is installed but not on PATH
    const m1 = await runInstall(python, ['-m', 'pipx', 'install', 'openai-whisper'])
    if (m1.ok) return { ok: true, via: 'python -m pipx' }

    const m2 = await runInstall(python, [
      '-m',
      'pip',
      'install',
      'openai-whisper',
      '--user',
      '--break-system-packages',
      '--quiet'
    ])
    if (m2.ok) return { ok: true, via: 'pip --user --break-system-packages' }

    const m3 = await runInstall(python, [
      '-m',
      'pip',
      'install',
      'openai-whisper',
      '--user',
      '--quiet'
    ])
    if (m3.ok) return { ok: true, via: 'pip --user' }
  }

  return { ok: false, error: 'no working installer found (tried pipx, python -m pipx, pip)' }
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
      if (stdout.length < MAX_OUTPUT) stdout += c.toString()
    })
    child.stderr?.on('data', (c) => {
      if (stderr.length < MAX_OUTPUT) stderr += c.toString()
    })
    child.on('error', (err) => finish({ ok: false, error: err?.message ?? String(err) }))
    child.on('close', (code) => {
      if (code === 0) finish({ ok: true })
      else finish({ ok: false, error: (stderr || stdout).slice(-1000) || `exited with code ${code}` })
    })
  })
}

async function ensureReady(corpus) {
  // ffmpeg is mandatory regardless of executor mode.
  if (!ffmpegPath) {
    corpus?.('stt.dep.checking', { dependency: 'ffmpeg' })
    ffmpegPath = await detectFfmpegPath()
    if (!ffmpegPath) {
      initError = ffmpegInstallMessage()
      corpus?.('stt.dep.failed', { dependency: 'ffmpeg', error: initError })
      return { ok: false, error: initError }
    }
    corpus?.('stt.dep.ready', { dependency: 'ffmpeg' })
  }

  if (executor) return { ok: true }

  // 1. Already-installed binary via canonical path or PATH. Covers pipx,
  //    brew, pip --user — all of them drop a `whisper` script somewhere
  //    in our candidate list.
  corpus?.('stt.dep.checking', { dependency: 'whisper' })
  const binary = await detectWhisperBinary()
  if (binary) {
    executor = { type: 'binary', path: binary }
    corpus?.('stt.dep.ready', { dependency: 'whisper' })
    return { ok: true }
  }

  // 2. Already-installed module via system Python (pre-pipx era installs).
  const python = await detectPython()
  if (await detectWhisperModule(python)) {
    executor = { type: 'module', python }
    corpus?.('stt.dep.ready', { dependency: 'whisper' })
    return { ok: true }
  }

  // 3. Not installed — attempt automatic install.
  const installed = await tryInstall(corpus)
  if (!installed.ok) {
    if (!python) {
      initError =
        'Python 3 is required for speech-to-text. Install it from https://python.org and restart Wolffish.'
    } else {
      initError =
        `Could not install whisper automatically: ${installed.error || 'unknown'}\n` +
        'Install it manually:\n' +
        '  pipx install openai-whisper   (recommended)\n' +
        `  ${python} -m pip install --user --break-system-packages openai-whisper`
    }
    corpus?.('stt.dep.failed', { dependency: 'whisper', error: initError })
    return { ok: false, error: initError }
  }

  // 4. Re-detect after install — pipx puts the binary in ~/.local/bin even
  //    though the Python module isn't importable from system Python, so
  //    the binary check has to come first here too.
  const installedBinary = await detectWhisperBinary()
  if (installedBinary) {
    executor = { type: 'binary', path: installedBinary }
    corpus?.('stt.dep.ready', { dependency: 'whisper' })
    return { ok: true }
  }
  if (await detectWhisperModule(python)) {
    executor = { type: 'module', python }
    corpus?.('stt.dep.ready', { dependency: 'whisper' })
    return { ok: true }
  }

  initError =
    `whisper installed via ${installed.via} but the binary could not be located on PATH or in canonical install dirs. ` +
    'Restart Wolffish so it picks up the new install.'
  corpus?.('stt.dep.failed', { dependency: 'whisper', error: initError })
  return { ok: false, error: initError }
}

// ---------- path resolution ----------

function conversationDirName(id) {
  const safe = (id ?? '').replace(/[^A-Za-z0-9._-]/g, '_')
  return `conv-${safe}`
}

function resolveAbsolute(filePath) {
  if (!filePath) return null
  if (path.isAbsolute(filePath)) return filePath
  if (workspaceRoot) return path.resolve(workspaceRoot, filePath)
  return path.resolve(filePath)
}

async function resolveUploadByName(fileName) {
  const id = getConversationId()
  if (!id) {
    return {
      ok: false,
      error:
        'No active conversation — stt_transcribe_upload can only run during a chat turn. Use stt_transcribe with an absolute path instead.'
    }
  }
  const dir = path.join(workspaceRoot, 'uploads', conversationDirName(id))
  const candidate = path.join(dir, fileName)
  try {
    await access(candidate)
    return { ok: true, path: candidate }
  } catch {
    return { ok: false, error: `Uploaded file not found: ${fileName} (in ${dir})` }
  }
}

async function resolveVoiceMemoByName(fileName) {
  const root = path.join(workspaceRoot, 'voice')
  const found = await findFileRecursive(root, fileName)
  if (found) return { ok: true, path: found }
  // Fall back to speech/ — some installs put TTS output there.
  const altRoot = path.join(workspaceRoot, 'speech')
  const altFound = await findFileRecursive(altRoot, fileName)
  if (altFound) return { ok: true, path: altFound }
  return { ok: false, error: `Voice memo not found: ${fileName}` }
}

async function findFileRecursive(dir, target) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === target) return full
    if (entry.isDirectory()) {
      const nested = await findFileRecursive(full, target)
      if (nested) return nested
    }
  }
  return null
}

// ---------- whisper invocation ----------

const SUPPORTED_AUDIO_EXTS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.ogg',
  '.oga',
  '.flac',
  '.webm',
  '.aac',
  '.mp4',
  '.mov'
])

function escapeForPyString(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

function pickModel(model) {
  const allowed = new Set(['tiny', 'base', 'small', 'medium', 'large'])
  if (typeof model === 'string' && allowed.has(model.toLowerCase())) return model.toLowerCase()
  return defaultModel
}

// Whisper internally invokes ffmpeg as a subprocess. When we found ffmpeg
// at a non-PATH location (common on macOS Electron launches that inherit a
// stripped PATH), prepend its dir to PATH for the child env so whisper's
// internal call resolves it.
function envWithFfmpeg() {
  if (!ffmpegPath) return process.env
  const dir = path.dirname(ffmpegPath)
  const sep = process.platform === 'win32' ? ';' : ':'
  const cur = process.env.PATH || ''
  if (cur.split(sep).filter(Boolean).includes(dir)) return process.env
  return { ...process.env, PATH: cur ? `${dir}${sep}${cur}` : dir }
}

function runChild(bin, args, timeoutMs, label) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(bin, args, { env: envWithFfmpeg(), stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ ok: false, error: err?.message ?? String(err) })
      return
    }
    let stdout = ''
    let stderr = ''
    let resolved = false
    let timer = null
    const finish = (r) => {
      if (resolved) return
      resolved = true
      if (timer) clearTimeout(timer)
      resolve(r)
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already dead
        }
        finish({ ok: false, error: `${label} timed out after ${Math.round(timeoutMs / 1000)}s` })
      }, timeoutMs)
    }
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString()
    })
    child.on('error', (err) => finish({ ok: false, error: err?.message ?? String(err) }))
    child.on('close', (code) => {
      if (code === 0) finish({ ok: true, stdout })
      else finish({ ok: false, error: stderr.slice(-2000) || `${label} exited with code ${code}` })
    })
  })
}

async function runWhisperBinary(absPath, model, language, outputDir, timeoutMs) {
  const args = [
    absPath,
    '--model',
    model,
    '--output_format',
    'json',
    '--output_dir',
    outputDir,
    '--fp16',
    'False'
  ]
  if (typeof language === 'string' && language.trim().length > 0) {
    args.push('--language', language.trim())
  }
  return runChild(executor.path, args, timeoutMs, 'whisper')
}

async function readBinaryOutputJson(audioPath, outputDir) {
  // The whisper CLI writes <basename-no-ext>.json into output_dir.
  const base = path.basename(audioPath, path.extname(audioPath))
  const jsonPath = path.join(outputDir, `${base}.json`)
  try {
    const raw = await readFile(jsonPath, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      ok: true,
      data: {
        text: typeof parsed.text === 'string' ? parsed.text.trim() : '',
        language: parsed.language || '',
        segments: Array.isArray(parsed.segments)
          ? parsed.segments.map((s) => ({
              start: typeof s.start === 'number' ? s.start : 0,
              end: typeof s.end === 'number' ? s.end : 0,
              text: typeof s.text === 'string' ? s.text.trim() : ''
            }))
          : []
      }
    }
  } catch (err) {
    return { ok: false, error: `Could not read whisper JSON output: ${err?.message ?? err}` }
  }
}

async function runWhisperModule(scriptPath, timeoutMs) {
  return runChild(executor.python, [scriptPath], timeoutMs, 'whisper')
}

async function transcribeFile(absPath, language, model, corpus) {
  const ready = await ensureReady(corpus)
  if (!ready.ok) return { success: false, error: ready.error }

  let st
  try {
    st = await stat(absPath)
  } catch {
    return { success: false, error: `File not found: ${absPath}` }
  }
  if (!st.isFile()) return { success: false, error: `Not a file: ${absPath}` }
  if (st.size > MAX_FILE_BYTES) {
    return {
      success: false,
      error: `File too large (${Math.round(st.size / 1024 / 1024)} MB). Whisper accepts up to ${MAX_FILE_BYTES / 1024 / 1024}MB; split the audio first.`
    }
  }

  const ext = path.extname(absPath).toLowerCase()
  if (!SUPPORTED_AUDIO_EXTS.has(ext)) {
    return {
      success: false,
      error: `Unsupported extension ${ext}. Supported: ${[...SUPPORTED_AUDIO_EXTS].join(', ')}`
    }
  }

  const chosenModel = pickModel(model)
  corpus?.('stt.transcribing', { filePath: absPath, model: chosenModel })

  const timeout = 0

  let parsed
  if (executor.type === 'binary') {
    const tmpOutDir = path.join(
      tmpdir(),
      `wolffish-stt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    )
    await mkdir(tmpOutDir, { recursive: true })
    try {
      const res = await runWhisperBinary(absPath, chosenModel, language, tmpOutDir, timeout)
      if (!res.ok) {
        corpus?.('stt.failed', { error: res.error })
        return { success: false, error: res.error }
      }
      const out = await readBinaryOutputJson(absPath, tmpOutDir)
      if (!out.ok) {
        corpus?.('stt.failed', { error: out.error })
        return { success: false, error: out.error }
      }
      parsed = out.data
    } finally {
      await rm(tmpOutDir, { recursive: true, force: true }).catch(() => undefined)
    }
  } else {
    const langArg =
      typeof language === 'string' && language.trim().length > 0
        ? `"${escapeForPyString(language.trim())}"`
        : 'None'

    const script = `import whisper, json, sys
try:
    model = whisper.load_model("${escapeForPyString(chosenModel)}")
    result = model.transcribe("${escapeForPyString(absPath)}", language=${langArg}, fp16=False)
    out = {
        "text": result["text"].strip(),
        "language": result.get("language") or "",
        "segments": [
            {"start": float(s["start"]), "end": float(s["end"]), "text": s["text"].strip()}
            for s in result.get("segments", [])
        ],
    }
    json.dump(out, sys.stdout)
except Exception as exc:
    sys.stderr.write(str(exc))
    sys.exit(1)
`

    const tmpScript = path.join(
      tmpdir(),
      `wolffish-stt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.py`
    )
    try {
      await writeFile(tmpScript, script, 'utf8')
    } catch (err) {
      return { success: false, error: `Failed to write temp script: ${err?.message ?? err}` }
    }

    let result
    try {
      result = await runWhisperModule(tmpScript, timeout)
    } finally {
      await unlink(tmpScript).catch(() => undefined)
    }

    if (!result.ok) {
      corpus?.('stt.failed', { error: result.error ?? 'unknown error' })
      return { success: false, error: result.error ?? 'whisper failed' }
    }

    try {
      parsed = JSON.parse(result.stdout)
    } catch (err) {
      corpus?.('stt.failed', { error: 'parse failure' })
      return {
        success: false,
        error: `Could not parse whisper output: ${err?.message ?? err}\n${result.stdout.slice(-500)}`
      }
    }
  }

  const outputPath = await persistTranscription(absPath, parsed)
  corpus?.('stt.transcribed', {
    language: parsed.language ?? '',
    segmentCount: parsed.segments?.length ?? 0,
    textLength: parsed.text?.length ?? 0
  })

  return {
    success: true,
    output: JSON.stringify({
      text: parsed.text,
      language: parsed.language,
      segmentCount: parsed.segments?.length ?? 0,
      filePath: absPath,
      model: chosenModel,
      outputPath
    })
  }
}

async function persistTranscription(audioPath, parsed) {
  const id = getConversationId()
  const baseDir = id
    ? path.join(workspaceRoot, 'speech', conversationDirName(id))
    : path.join(workspaceRoot, 'speech', 'orphan')
  await mkdir(baseDir, { recursive: true }).catch(() => undefined)
  const audioName = path.basename(audioPath)
  const outPath = path.join(baseDir, `${audioName}.txt`)
  const header = `# Transcription of ${audioName}\n\nLanguage: ${parsed.language || 'unknown'}\nGenerated: ${new Date().toISOString()}\n\n`
  const body = parsed.text || ''
  try {
    await writeFile(outPath, header + body + '\n', 'utf8')
  } catch {
    return null
  }
  return outPath
}

async function detectLanguage(absPath, corpus) {
  const ready = await ensureReady(corpus)
  if (!ready.ok) return { success: false, error: ready.error }

  try {
    await access(absPath)
  } catch {
    return { success: false, error: `File not found: ${absPath}` }
  }

  corpus?.('stt.detecting', { filePath: absPath })

  if (executor.type === 'binary') {
    // The whisper CLI doesn't expose Whisper's fast `detect_language()`
    // primitive — it only does full transcription. We run a normal
    // transcribe and read .language from the output JSON. For typical
    // detection use-cases (short clips), this is fine; for very long
    // files the module path is significantly faster.
    const tmpOutDir = path.join(
      tmpdir(),
      `wolffish-lang-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    )
    await mkdir(tmpOutDir, { recursive: true })
    try {
      const res = await runWhisperBinary(absPath, defaultModel, '', tmpOutDir, 0)
      if (!res.ok) {
        corpus?.('stt.failed', { error: res.error })
        return { success: false, error: res.error }
      }
      const out = await readBinaryOutputJson(absPath, tmpOutDir)
      if (!out.ok) return { success: false, error: out.error }
      const result = {
        detected: out.data.language || '',
        confidence: out.data.language ? 1 : 0,
        top5: out.data.language ? [{ lang: out.data.language, prob: 1 }] : []
      }
      corpus?.('stt.detected', { language: result.detected, confidence: result.confidence })
      return { success: true, output: JSON.stringify(result) }
    } finally {
      await rm(tmpOutDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  const script = `import whisper, json, sys
try:
    model = whisper.load_model("${escapeForPyString(defaultModel)}")
    audio = whisper.load_audio("${escapeForPyString(absPath)}")
    audio = whisper.pad_or_trim(audio)
    mel = whisper.log_mel_spectrogram(audio).to(model.device)
    _, probs = model.detect_language(mel)
    items = sorted(probs.items(), key=lambda x: -x[1])[:5]
    json.dump({
        "detected": items[0][0],
        "confidence": round(float(items[0][1]), 4),
        "top5": [{"lang": l, "prob": round(float(p), 4)} for l, p in items],
    }, sys.stdout)
except Exception as exc:
    sys.stderr.write(str(exc))
    sys.exit(1)
`

  const tmpScript = path.join(
    tmpdir(),
    `wolffish-lang-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.py`
  )
  try {
    await writeFile(tmpScript, script, 'utf8')
  } catch (err) {
    return { success: false, error: `Failed to write temp script: ${err?.message ?? err}` }
  }

  let result
  try {
    result = await runWhisperModule(tmpScript, 0)
  } finally {
    await unlink(tmpScript).catch(() => undefined)
  }

  if (!result.ok) {
    corpus?.('stt.failed', { error: result.error ?? 'unknown' })
    return { success: false, error: result.error ?? 'language detection failed' }
  }
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch (err) {
    return { success: false, error: `Parse failure: ${err?.message ?? err}` }
  }
  corpus?.('stt.detected', { language: parsed.detected, confidence: parsed.confidence })
  return { success: true, output: JSON.stringify(parsed) }
}

// ---------- plugin shell ----------

const plugin = {
  name: 'speech-to-text',
  tools: toolDefinitions,

  async init(context) {
    workspaceRoot = context.workspaceRoot
    if (typeof context.getCurrentConversationId === 'function') {
      getConversationId = context.getCurrentConversationId
    }
    // Best-effort warm-up: probe ffmpeg + whisper so the first transcribe
    // call doesn't pay the detection cost. Whisper install (which can take
    // minutes to pull PyTorch) is deferred to that first call so we don't
    // surprise users with a 2GB download on app launch.
    try {
      ffmpegPath = await detectFfmpegPath()
      const binary = await detectWhisperBinary()
      if (binary) {
        executor = { type: 'binary', path: binary }
        return
      }
      const python = await detectPython()
      if (await detectWhisperModule(python)) {
        executor = { type: 'module', python }
      }
    } catch {
      // silent — ensureReady() retries on every execute()
    }
  },

  async execute(toolName, args) {
    // Read the default model from config on each call so changes take
    // effect without a reload. Best-effort.
    try {
      const cfgPath = path.join(workspaceRoot, 'config.json')
      const raw = await readFile(cfgPath, 'utf8')
      const cfg = JSON.parse(raw)
      const m = cfg?.stt?.defaultModel
      if (typeof m === 'string') defaultModel = m
    } catch {
      // keep default
    }

    switch (toolName) {
      case 'stt_transcribe': {
        const filePath = args?.filePath
        if (typeof filePath !== 'string' || filePath.trim().length === 0) {
          return { success: false, error: 'filePath is required' }
        }
        const abs = resolveAbsolute(filePath)
        if (!abs) return { success: false, error: `Could not resolve path: ${filePath}` }
        return transcribeFile(abs, args?.language, args?.model)
      }
      case 'stt_transcribe_upload': {
        const fileName = args?.fileName
        if (typeof fileName !== 'string' || fileName.trim().length === 0) {
          return { success: false, error: 'fileName is required' }
        }
        const resolved = await resolveUploadByName(fileName)
        if (!resolved.ok) return { success: false, error: resolved.error }
        return transcribeFile(resolved.path, args?.language, args?.model)
      }
      case 'stt_transcribe_voice_memo': {
        const fileName = args?.fileName
        if (typeof fileName !== 'string' || fileName.trim().length === 0) {
          return { success: false, error: 'fileName is required' }
        }
        const resolved = await resolveVoiceMemoByName(fileName)
        if (!resolved.ok) return { success: false, error: resolved.error }
        return transcribeFile(resolved.path, args?.language, args?.model)
      }
      case 'stt_detect_language': {
        const filePath = args?.filePath
        if (typeof filePath !== 'string' || filePath.trim().length === 0) {
          return { success: false, error: 'filePath is required' }
        }
        const abs = resolveAbsolute(filePath)
        if (!abs) return { success: false, error: `Could not resolve path: ${filePath}` }
        return detectLanguage(abs)
      }
      default:
        return { success: false, error: `speech-to-text: unknown tool ${toolName}` }
    }
  }
}

export default plugin
