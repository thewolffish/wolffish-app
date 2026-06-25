// Shared Python runtime plumbing for Wolffish cerebellum plugins.
//
// This is the reusable core that lets ANY plugin run native Python code on a
// non-developer machine with zero pre-installed tooling. It never depends on a
// system Python, pip, or pipx — instead it provisions a fully self-contained,
// hermetic interpreter under ~/.wolffish/bin/python using `uv`:
//
//   ~/.wolffish/bin/python/
//     uv[.exe]            the uv binary (system copy reused, else downloaded)
//     cpython/            uv-managed standalone CPython builds
//     cache/              uv's download/build cache
//     venvs/<name>/       one isolated venv per consumer (kokoro-tts, whisper…)
//
// Acquisition mirrors the ffmpeg capability's ladder: reuse a system binary if
// present, otherwise download a static build straight into ~/.wolffish/bin —
// no package manager, no root, no PATH surgery required. `uv` is ideal here
// because it is a single static binary that itself downloads standalone CPython
// (python-build-standalone), so one download bootstraps the entire toolchain.
//
// Usage from a consumer plugin (text-to-speech, speech-to-text, …):
//   const py = pythonRuntime(workspaceRoot)
//   await py.ensureVenv('kokoro-tts', ['kokoro-onnx==0.4.9', 'soundfile'])
//   const { code, stdout, stderr } = await py.runInVenv('kokoro-tts',
//     [scriptPath, '--text-file', t, '--out', o, ...])

import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { access, chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

// Pinned interpreter. uv downloads this exact standalone CPython on first use,
// so every machine runs the identical Python regardless of what (if anything)
// is installed system-wide.
export const PY_VERSION = '3.12'

const MAX_OUTPUT = 50_000
// Idle/connect timeout for downloads (socket inactivity, NOT wall-clock) and an
// upper bound for local archive extraction. A progressing download keeps the
// socket active, so a slow-but-working download is never aborted by this.
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000

const IS_WIN = process.platform === 'win32'

function clampOutput(buf, chunk) {
  if (buf.length >= MAX_OUTPUT) return buf
  return buf + chunk.toString().slice(0, MAX_OUTPUT - buf.length)
}

async function fileExists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function which(cmd) {
  try {
    const bin = IS_WIN ? 'where' : 'which'
    const { stdout } = await execFileP(bin, [cmd])
    return stdout.trim().split('\n')[0].trim() || null
  } catch {
    return null
  }
}

// Spawn a command, collect clamped stdout/stderr, never reject. A non-zero exit
// is reported via `code`, not thrown — callers branch on it.
//
// NO wall-clock timeout by default (timeout = 0): a slow but progressing
// download/install (uv python install, uv pip install) must never be SIGKILLed
// for being slow. Only callers that genuinely want a bound — quick `--version`
// checks, local archive extraction — pass an explicit positive `timeout`.
function runSpawn(cmd, args, { env = process.env, cwd, timeout = 0 } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: err?.message ?? String(err) })
      return
    }
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (r) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve(r)
    }
    const timer =
      timeout > 0
        ? setTimeout(() => {
            try {
              child.kill('SIGKILL')
            } catch {
              /* already gone */
            }
            finish({
              code: -1,
              stdout,
              stderr: stderr + `\n[timed out after ${Math.round(timeout / 1000)}s]`
            })
          }, timeout)
        : null
    child.stdout?.on('data', (c) => {
      stdout = clampOutput(stdout, c)
    })
    child.stderr?.on('data', (c) => {
      stderr = clampOutput(stderr, c)
    })
    child.on('error', (err) =>
      finish({ code: -1, stdout, stderr: stderr + '\n' + (err?.message ?? String(err)) })
    )
    child.on('close', (code) => finish({ code: code ?? -1, stdout, stderr }))
  })
}

// Follow redirects (GitHub release assets 302 to objects.githubusercontent.com)
// and stream to disk. Pure Node so it works identically on all platforms with
// no curl/PowerShell dependency.
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) {
      reject(new Error(`too many redirects fetching ${url}`))
      return
    }
    const req = https.get(url, { headers: { 'User-Agent': 'wolffish' }, timeout: DOWNLOAD_TIMEOUT_MS }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        const next = new URL(res.headers.location, url).toString()
        download(next, dest, redirects + 1).then(resolve, reject)
        return
      }
      if (status !== 200) {
        res.resume()
        reject(new Error(`HTTP ${status} fetching ${url}`))
        return
      }
      const expected = Number(res.headers['content-length'] || 0)
      pipeline(res, createWriteStream(dest)).then(async () => {
        // A dropped connection still "completes" the pipeline with a partial
        // body — verify the byte count so we never cache a truncated archive.
        if (expected) {
          const { size } = await stat(dest)
          if (size !== expected) {
            reject(new Error(`incomplete download (${size}/${expected} bytes) for ${url}`))
            return
          }
        }
        resolve()
      }, reject)
    })
    req.on('timeout', () => req.destroy(new Error(`timeout fetching ${url}`)))
    req.on('error', reject)
  })
}

// Extract a downloaded archive into destDir. Windows ships a .zip; macOS/Linux
// a .tar.gz. We avoid assuming `tar` can read zips (GNU tar can't, and bsdtar's
// tar.exe only ships on Windows 10 1803+), so on Windows we use PowerShell's
// Expand-Archive (present on every supported Windows, same approach the ffmpeg
// capability uses), falling back to tar if PowerShell is somehow unavailable.
async function extractArchive(archive, destDir) {
  if (IS_WIN) {
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`
    const ps =
      `$ProgressPreference='SilentlyContinue'; ` +
      `Expand-Archive -LiteralPath ${q(archive)} -DestinationPath ${q(destDir)} -Force`
    const res = await runSpawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: DOWNLOAD_TIMEOUT_MS }
    )
    if (res.code === 0) return
    const tarRes = await runSpawn('tar', ['-xf', archive, '-C', destDir], {
      timeout: DOWNLOAD_TIMEOUT_MS
    })
    if (tarRes.code !== 0) {
      throw new Error(
        `failed to extract ${archive}: ${(res.stderr || tarRes.stderr || tarRes.stdout).slice(-400)}`
      )
    }
    return
  }
  const res = await runSpawn('tar', ['-xzf', archive, '-C', destDir], {
    timeout: DOWNLOAD_TIMEOUT_MS
  })
  if (res.code !== 0) {
    throw new Error(`failed to extract ${archive}: ${res.stderr.slice(-400) || res.stdout.slice(-400)}`)
  }
}

// Passive integrity check for a downloaded uv archive against its published
// `.sha256` sibling. Returns 'verified' | 'mismatch' | 'unverified'. Never throws
// and never blocks — informational only.
async function verifyUv(archiveUrl, filePath) {
  try {
    const res = await fetch(`${archiveUrl}.sha256`, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return 'unverified'
    const expected = (await res.text()).trim().split(/\s+/)[0].toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(expected)) return 'unverified'
    const actual = createHash('sha256').update(await readFile(filePath)).digest('hex').toLowerCase()
    return actual === expected ? 'verified' : 'mismatch'
  } catch {
    return 'unverified'
  }
}

// Detect a musl-based Linux (Alpine): on glibc, the Node report exposes a glibc
// runtime version; on musl it doesn't. Falls back to the Alpine marker file.
function isMuslLinux() {
  if (process.platform !== 'linux') return false
  try {
    const glibc = process.report?.getReport?.()?.header?.glibcVersionRuntime
    if (glibc) return false
  } catch {
    /* fall through to marker check */
  }
  return existsSync('/etc/alpine-release')
}

// Platform facts consumer plugins use to (a) gate genuinely-unsupported targets
// with a clear message instead of a raw pip failure, and (b) pin onnxruntime on
// Intel Macs, where the latest onnxruntime dropped x86_64 wheels.
export function platformInfo() {
  return {
    platform: process.platform,
    arch: process.arch,
    isMuslLinux: isMuslLinux(),
    isIntelMac: process.platform === 'darwin' && process.arch === 'x64',
    isWindowsArm: process.platform === 'win32' && process.arch === 'arm64'
  }
}

// onnxruntime ships macOS x86_64 wheels only up to 1.23.2 (1.24+ are arm64-only).
// Intel Macs pin to this last good version so onnxruntime-based engines (Kokoro,
// faster-whisper's VAD) install. It satisfies kokoro-onnx (>=1.20.1) and
// faster-whisper (>=1.14,<2). Verified against PyPI, June 2026.
export const ONNXRUNTIME_INTEL_MAC = 'onnxruntime==1.23.2'

// The uv release asset target triple for this OS/arch. uv ships fully-static
// musl builds too, so an Alpine host gets a working binary.
function uvTarget() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'darwin') return `${arch}-apple-darwin`
  if (IS_WIN) return `${arch}-pc-windows-msvc`
  return `${arch}-unknown-linux-${isMuslLinux() ? 'musl' : 'gnu'}`
}

// Coalesce concurrent provisioning of the same venv, keyed by its absolute path
// and shared across pythonRuntime() instances (which are created per call). Two
// simultaneous ensureVenv calls for one venv then share a single promise instead
// of both rm-ing + recreating the directory and corrupting it.
const inFlightVenvs = new Map()

export function pythonRuntime(workspaceRoot = '') {
  // Mirror the node/ffmpeg capabilities: managed tools live under
  // ~/.wolffish/bin (a sibling of the workspace), so all no-root software
  // sits in one predictable tree.
  const BIN = workspaceRoot
    ? path.join(path.dirname(workspaceRoot), 'bin')
    : path.join(os.homedir(), '.wolffish', 'bin')
  const HOME = path.join(BIN, 'python')
  const UV = path.join(HOME, IS_WIN ? 'uv.exe' : 'uv')
  const CPYTHON_DIR = path.join(HOME, 'cpython')
  const CACHE_DIR = path.join(HOME, 'cache')
  const VENVS_DIR = path.join(HOME, 'venvs')
  // Passive integrity of a uv we DOWNLOADED this session; null when uv was
  // reused from the system (nothing fetched to verify).
  let lastUvIntegrity = null

  // Redirect ALL of uv's state into our tree and force it to use ONLY its own
  // managed standalone CPython — never a system Python. This is what makes the
  // runtime hermetic and reproducible, and sidesteps every system-Python
  // failure mode (wrong version, PEP 668, missing pip, mismatched arch).
  function uvEnv() {
    return {
      ...process.env,
      UV_PYTHON_INSTALL_DIR: CPYTHON_DIR,
      UV_CACHE_DIR: CACHE_DIR,
      UV_PYTHON_PREFERENCE: 'only-managed',
      UV_NO_CONFIG: '1',
      UV_NO_PROGRESS: '1'
    }
  }

  function venvDir(name) {
    return path.join(VENVS_DIR, name)
  }
  function venvPython(name) {
    return IS_WIN
      ? path.join(venvDir(name), 'Scripts', 'python.exe')
      : path.join(venvDir(name), 'bin', 'python')
  }
  // Path to a console script installed into a venv (e.g. the `whisper` CLI that
  // openai-whisper provides). Windows puts scripts in Scripts\<name>.exe.
  function venvBin(name, binName) {
    return IS_WIN
      ? path.join(venvDir(name), 'Scripts', `${binName}.exe`)
      : path.join(venvDir(name), 'bin', binName)
  }

  // Locate a uv we can use: our managed copy, then a system one, else null.
  async function findUv() {
    if (await fileExists(UV)) return UV
    const sys = await which('uv')
    return sys || null
  }

  // Download + unpack the uv static binary into HOME. Extraction is delegated to
  // extractArchive: PowerShell Expand-Archive for the Windows .zip, tar -xzf for
  // the mac/Linux .tar.gz (tar is NOT assumed to read zips — see extractArchive).
  async function downloadUv() {
    await mkdir(HOME, { recursive: true })
    const target = uvTarget()
    const ext = IS_WIN ? 'zip' : 'tar.gz'
    const url = `https://github.com/astral-sh/uv/releases/latest/download/uv-${target}.${ext}`
    const archive = path.join(HOME, `uv-download.${ext}`)
    const extractDir = path.join(HOME, 'uv-extract')

    await rm(extractDir, { recursive: true, force: true }).catch(() => {})
    await mkdir(extractDir, { recursive: true })
    await download(url, archive)
    lastUvIntegrity = await verifyUv(url, archive)
    if (lastUvIntegrity === 'mismatch') {
      console.warn('[python] uv sha256 mismatch against the published .sha256 — using it anyway')
    }
    await extractArchive(archive, extractDir)

    const found = await findFileRecursive(extractDir, IS_WIN ? 'uv.exe' : 'uv')
    if (!found) throw new Error('uv binary not found in downloaded archive')
    await rm(UV, { force: true }).catch(() => {})
    await rename(found, UV).catch(async () => {
      // rename across devices can fail; fall back to copy via readFile/writeFile
      await writeFile(UV, await readFile(found))
    })
    if (!IS_WIN) await chmod(UV, 0o755)

    await rm(archive, { force: true }).catch(() => {})
    await rm(extractDir, { recursive: true, force: true }).catch(() => {})
    return UV
  }

  // Ensure a usable uv binary. Reuse system/managed first; only download when
  // neither exists (the ffmpeg-style last resort that always works no-root).
  async function ensureUv() {
    const existing = await findUv()
    if (existing) {
      // Sanity-check it actually runs.
      const res = await runSpawn(existing, ['--version'], { timeout: 30_000 })
      if (res.code === 0) return existing
    }
    return downloadUv()
  }

  // Ensure a managed CPython is present (idempotent; uv no-ops if so). `python`
  // is a uv request — the pinned version by default, or a full cross-arch key
  // like 'cpython-3.12-windows-x86_64-none' (used to run x64 wheels under
  // Windows-on-ARM's built-in emulation).
  async function ensurePython(python = PY_VERSION) {
    const uv = await ensureUv()
    const res = await runSpawn(uv, ['python', 'install', python], { env: uvEnv() })
    if (res.code !== 0) {
      throw new Error(
        `uv could not install Python '${python}': ${res.stderr.slice(-500) || res.stdout.slice(-500)}`
      )
    }
    return { uv }
  }

  // Create (if needed) an isolated venv and install `packages` into it. A marker
  // file records the requirement set + interpreter request so repeat calls are
  // free and a change triggers a clean rebuild — same idea as the host's
  // npm-install marker. `python` selects the interpreter (see ensurePython).
  async function ensureVenv(name, packages = [], python = PY_VERSION) {
    const key = venvDir(name)
    const inflight = inFlightVenvs.get(key)
    if (inflight) return inflight
    const promise = provisionVenv(name, packages, python)
    inFlightVenvs.set(key, promise)
    try {
      return await promise
    } finally {
      inFlightVenvs.delete(key)
    }
  }

  async function provisionVenv(name, packages, python) {
    const { uv } = await ensurePython(python)
    await mkdir(VENVS_DIR, { recursive: true })

    const marker = path.join(venvDir(name), '.wolffish-install.json')
    const want = JSON.stringify({ py: python, pkgs: [...packages].sort() })
    const haveVenv = await fileExists(venvPython(name))
    if (haveVenv && (await fileExists(marker))) {
      const have = await readFile(marker, 'utf8').catch(() => '')
      if (have === want) return { python: venvPython(name), uv }
    }

    // The interpreter request or package set changed — delete the old venv so
    // its now-unused dependencies (e.g. a multi-GB PyTorch from a previous
    // engine) are reclaimed rather than left orphaned. Safe: we recreate it next.
    if (haveVenv) {
      await rm(venvDir(name), { recursive: true, force: true }).catch(() => {})
    }

    const mk = await runSpawn(uv, ['venv', '--python', python, venvDir(name)], { env: uvEnv() })
    if (mk.code !== 0) {
      throw new Error(`failed to create venv '${name}': ${mk.stderr.slice(-500) || mk.stdout.slice(-500)}`)
    }

    if (packages.length) {
      const install = await runSpawn(
        uv,
        ['pip', 'install', '--python', venvPython(name), ...packages],
        { env: uvEnv() }
      )
      if (install.code !== 0) {
        throw new Error(
          `failed to install [${packages.join(', ')}] into venv '${name}': ` +
            (install.stderr.slice(-800) || install.stdout.slice(-800))
        )
      }
    }

    await writeFile(marker, want, 'utf8')
    return { python: venvPython(name), uv }
  }

  // Run a script/args with the venv's interpreter.
  async function runInVenv(name, args, opts = {}) {
    const py = venvPython(name)
    if (!(await fileExists(py))) {
      throw new Error(`venv '${name}' is not provisioned — call ensureVenv first`)
    }
    return runSpawn(py, args, { env: uvEnv(), ...opts })
  }

  // For the python_check tool: is the runtime usable, and what version?
  async function check() {
    const uv = await findUv()
    if (!uv) return { installed: false }
    const list = await runSpawn(uv, ['python', 'list', '--only-installed'], { env: uvEnv(), timeout: 30_000 })
    // Match the managed interpreter token precisely (e.g. "cpython-3.12.13-…"),
    // not a bare "3.12" substring that could also appear in a filesystem path
    // or a future "3.120" release.
    const verRe = new RegExp(`cpython-${PY_VERSION.replace(/\./g, '\\.')}\\.\\d`)
    const ready = list.code === 0 && verRe.test(list.stdout)
    return { installed: ready, uv, pinned: PY_VERSION, managedPythonReady: ready, uvIntegrity: lastUvIntegrity }
  }

  return {
    paths: { HOME, UV, CPYTHON_DIR, VENVS_DIR, venvDir, venvPython, venvBin },
    PY_VERSION,
    ensureUv,
    ensurePython,
    ensureVenv,
    runInVenv,
    check
  }
}

async function findFileRecursive(dir, name, depth = 0) {
  if (depth > 6) return null
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return full
    if (entry.isDirectory()) {
      const found = await findFileRecursive(full, name, depth + 1)
      if (found) return found
    }
  }
  return null
}

// NOTE: consumer plugins (text-to-speech, speech-to-text, …) cannot statically
// import this module, because bundled capabilities are renamed `python` ->
// `.python` in the user workspace and a static specifier can't span that. Each
// consumer instead probes both `.python`/`python` and dynamic-imports this file
// — see the `locatePythonRuntime()` helper in those plugins.
