/**
 * Google Workspace integration. Downloads the prebuilt gogcli binary
 * from GitHub releases for the current platform/arch and installs it
 * to ~/.wolffish/bin/gog. Cross-platform (macOS, Linux, Windows).
 * No package manager dependency, no admin password.
 */

import { getGoogleConfig } from '@main/workspace/workspace'
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { access, appendFile, chmod, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import os, { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const WOLFFISH_BIN = join(homedir(), '.wolffish', 'bin')
const IS_WINDOWS = os.platform() === 'win32'
const GOG_NAME = IS_WINDOWS ? 'gog.exe' : 'gog'
const GOG_PATH = join(WOLFFISH_BIN, GOG_NAME)

const EXEC_TIMEOUT_MS = 15_000
// gogcli's `auth add` blocks until the user finishes the OAuth flow in
// the browser (sign-in + consent + redirect back to gogcli's local
// server). Allow plenty of time — the previous 2-minute cap fired
// before some users finished consent.
const AUTH_TIMEOUT_MS = 10 * 60_000
const INSTALL_TIMEOUT_MS = 2 * 60_000

// gogcli release assets are named: gogcli_<version>_<platform>_<arch>.<ext>
const PLATFORM_MAP: Record<string, string> = { darwin: 'darwin', linux: 'linux', win32: 'windows' }
const ARCH_MAP: Record<string, string> = { arm64: 'arm64', x64: 'amd64' }

export type GoogleErrorKind =
  | 'platform_unsupported'
  | 'install_failed'
  | 'credentials_invalid'
  | 'auth_failed'
  | 'auth_timeout'
  | 'network'
  | 'unknown'

export type GoogleStatus = {
  status: 'inactive' | 'active' | 'error'
  errorKind: GoogleErrorKind | null
  error: string | null
}

export type GoogleBinaryStatus = {
  gogInstalled: boolean
  gogVersion: string | null
}

export type GoogleSetupResult =
  | { ok: true; binary: GoogleBinaryStatus }
  | { ok: false; kind: GoogleErrorKind; message?: string }

export type GoogleUpdateResult =
  | {
      ok: true
      updated: boolean
      version: string | null
      previousVersion?: string | null
    }
  | { ok: false; kind: GoogleErrorKind; message?: string }

export type GoogleCredentialsResult =
  | { ok: true; clientId: string; projectId: string }
  | { ok: false; kind: GoogleErrorKind; message?: string }

export type GoogleAuthResult =
  | { ok: true; account: string }
  | { ok: false; kind: GoogleErrorKind; message?: string }

function exec(cmd: string, args: string[], timeout = EXEC_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message || String(err)))
      else resolve(stdout ?? '')
    })
  })
}

const runGog = (args: string[], timeout = EXEC_TIMEOUT_MS): Promise<string> =>
  exec(GOG_PATH, args, timeout)

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function checkGog(): Promise<{ installed: boolean; version: string | null }> {
  if (!(await fileExists(GOG_PATH))) return { installed: false, version: null }
  try {
    const stdout = await exec(GOG_PATH, ['--version'], 5_000)
    const cleaned = stdout
      .trim()
      .replace(/^gog\s+/i, '')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim()
    return { installed: true, version: cleaned || null }
  } catch {
    return { installed: false, version: null }
  }
}

async function fetchLatestAsset(): Promise<{
  url: string
  name: string
  version: string | null
} | null> {
  const platform = PLATFORM_MAP[os.platform()]
  const arch = ARCH_MAP[os.arch()]
  if (!platform || !arch) return null
  const ext = platform === 'windows' ? '.zip' : '.tar.gz'
  const suffix = `_${platform}_${arch}${ext}`

  const res = await fetch('https://api.github.com/repos/steipete/gogcli/releases/latest', {
    headers: { 'User-Agent': 'wolffish', Accept: 'application/vnd.github+json' }
  })
  if (!res.ok) throw new Error(`GitHub API error: HTTP ${res.status}`)
  const release = (await res.json()) as {
    tag_name?: string
    assets?: Array<{ name: string; browser_download_url: string }>
  }
  const asset = release.assets?.find((a) => a.name.endsWith(suffix))
  if (!asset) return null
  // Asset names look like "gogcli_0.14.0_darwin_arm64.tar.gz" — pull the
  // semver out of the middle. Falls back to the release's tag_name (e.g.
  // "v0.14.0") if the asset filename doesn't match the expected shape.
  const versionMatch = asset.name.match(/_(\d+\.\d+\.\d+(?:[-+][\w.]+)?)_/)
  const version = versionMatch ? versionMatch[1] : (release.tag_name ?? null)
  return { url: asset.browser_download_url, name: asset.name, version }
}

function normalizeVersion(v: string | null | undefined): string {
  return (v ?? '').trim().replace(/^v/i, '')
}

/**
 * gogcli's stdout/stderr on a failed `auth add` includes the boilerplate
 * "Opening browser…", the long OAuth URL, and finally the real error
 * line. Surfacing that whole blob in the status pre-block is noisy and
 * confusing — pick the last meaningful line instead.
 */
function cleanGogError(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const meaningful = lines.filter((l) => {
    if (l.startsWith('https://') || l.startsWith('http://')) return false
    if (/^opening browser/i.test(l)) return false
    if (/^if the browser/i.test(l)) return false
    return true
  })
  return (meaningful.pop() ?? lines.pop() ?? trimmed).trim()
}

async function downloadAndExtract(
  url: string,
  name: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  await mkdir(WOLFFISH_BIN, { recursive: true })
  const tmpFile = join(tmpdir(), `wolffish-${randomBytes(8).toString('hex')}-${name}`)

  const res = await fetch(url, { headers: { 'User-Agent': 'wolffish' } })
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)

  // Track byte progress when Content-Length is known. Cap the streamed
  // value at 99 so the UI can move the bar to 100 only after extract+verify.
  const total = Number(res.headers.get('content-length') ?? 0)
  let received = 0
  const tracker = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length
      if (total > 0 && onProgress) {
        onProgress(Math.min(99, Math.floor((received / total) * 100)))
      }
      cb(null, chunk)
    }
  })

  await pipeline(Readable.fromWeb(res.body as never), tracker, createWriteStream(tmpFile))

  try {
    // System tar handles .tar.gz on Unix and .zip on Windows 10+ (libarchive-based).
    const flag = name.endsWith('.zip') ? '-xf' : '-xzf'
    await exec('tar', [flag, tmpFile, '-C', WOLFFISH_BIN, GOG_NAME], INSTALL_TIMEOUT_MS)
    if (!IS_WINDOWS) await chmod(GOG_PATH, 0o755)
  } finally {
    await rm(tmpFile, { force: true }).catch(() => {})
  }
}

/**
 * Best-effort: add ~/.wolffish/bin to the user's PATH so `gog` is also
 * available outside Wolffish. Internal calls always use the absolute
 * path, so PATH is purely a UX nicety. Errors are swallowed.
 */
async function ensureInUserPath(): Promise<void> {
  try {
    if (IS_WINDOWS) {
      const ps =
        "$p = [Environment]::GetEnvironmentVariable('Path', 'User'); " +
        "$b = (Join-Path $HOME '.wolffish\\bin'); " +
        "if ($p -and $p.Split(';') -contains $b) { return } " +
        "[Environment]::SetEnvironmentVariable('Path', ($(if ($p) { \"$p;$b\" } else { $b })), 'User')"
      await exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], 10_000)
    } else {
      const marker = '# Wolffish — gogcli'
      const line = `\n${marker}\nexport PATH="$HOME/.wolffish/bin:$PATH"\n`
      for (const rc of ['.zshrc', '.bashrc', '.profile']) {
        const p = join(homedir(), rc)
        if (!(await fileExists(p))) continue
        const existing = await readFile(p, 'utf8').catch(() => '')
        if (existing.includes(marker)) continue
        await appendFile(p, line).catch(() => {})
      }
    }
  } catch {
    /* ignore */
  }
}

class GoogleService {
  private lastError: { kind: GoogleErrorKind; message: string | null } | null = null
  private authChild: ReturnType<typeof spawn> | null = null

  cancelAuth(): boolean {
    const child = this.authChild
    if (!child) return false
    this.authChild = null
    try {
      child.kill('SIGTERM')
    } catch {
      /* already dead */
    }
    return true
  }

  async getStatus(): Promise<GoogleStatus> {
    const cfg = await getGoogleConfig()
    // Derive status from reality: credentials on disk + gogcli accounts.
    // Don't gate on cfg.status — it's a cached hint that easily drifts
    // (e.g. credentials uploaded but status never flipped to 'active').
    if (!cfg.credentialsStored) {
      return { status: 'inactive', errorKind: null, error: null }
    }
    const accounts = await this.listAccounts()
    if (accounts.length === 0) {
      return { status: 'inactive', errorKind: null, error: null }
    }
    if (this.lastError) {
      return {
        status: 'error',
        errorKind: this.lastError.kind,
        error: this.lastError.message
      }
    }
    return { status: 'active', errorKind: null, error: null }
  }

  async checkBinary(): Promise<GoogleBinaryStatus> {
    const { installed, version } = await checkGog()
    return { gogInstalled: installed, gogVersion: version }
  }

  async update(onProgress?: (percent: number) => void): Promise<GoogleUpdateResult> {
    try {
      const current = await checkGog()
      if (!current.installed) {
        return {
          ok: false,
          kind: 'install_failed',
          message: 'gogcli is not installed yet. Run setup first.'
        }
      }
      const asset = await fetchLatestAsset()
      if (!asset) {
        return {
          ok: false,
          kind: 'platform_unsupported',
          message: `No prebuilt gogcli for ${os.platform()}/${os.arch()}.`
        }
      }
      const currentVer = normalizeVersion(current.version)
      const latestVer = normalizeVersion(asset.version)
      if (currentVer && latestVer && currentVer === latestVer) {
        return { ok: true, updated: false, version: current.version }
      }
      onProgress?.(0)
      await downloadAndExtract(asset.url, asset.name, onProgress)
      onProgress?.(100)
      const after = await checkGog()
      return {
        ok: true,
        updated: true,
        version: after.version,
        previousVersion: current.version
      }
    } catch (err) {
      return { ok: false, kind: 'install_failed', message: (err as Error).message }
    }
  }

  async setup(onProgress?: (percent: number) => void): Promise<GoogleSetupResult> {
    try {
      onProgress?.(0)
      const asset = await fetchLatestAsset()
      if (!asset) {
        return {
          ok: false,
          kind: 'platform_unsupported',
          message: `No prebuilt gogcli for ${os.platform()}/${os.arch()}.`
        }
      }
      onProgress?.(5)
      await downloadAndExtract(asset.url, asset.name, onProgress)
      const binary = await this.checkBinary()
      if (!binary.gogInstalled) {
        return {
          ok: false,
          kind: 'install_failed',
          message: 'Binary did not run after extraction.'
        }
      }
      void ensureInUserPath()
      onProgress?.(100)
      return { ok: true, binary }
    } catch (err) {
      return { ok: false, kind: 'install_failed', message: (err as Error).message }
    }
  }

  async uploadCredentials(jsonContent: string): Promise<GoogleCredentialsResult> {
    let parsed: {
      installed?: { client_id?: string; project_id?: string }
      web?: { client_id?: string; project_id?: string }
    }
    try {
      parsed = JSON.parse(jsonContent)
    } catch {
      const message = 'Invalid JSON'
      this.lastError = { kind: 'credentials_invalid', message }
      return { ok: false, kind: 'credentials_invalid', message }
    }
    const creds = parsed.installed ?? parsed.web
    if (!creds?.client_id) {
      const message = 'Missing client_id — does not look like a GCP OAuth client JSON.'
      this.lastError = { kind: 'credentials_invalid', message }
      return { ok: false, kind: 'credentials_invalid', message }
    }

    const tmpFile = join(tmpdir(), `wolffish-gog-creds-${randomBytes(8).toString('hex')}.json`)
    try {
      await writeFile(tmpFile, jsonContent, 'utf8')
      // `set` replaces any existing credentials for the same client name
      // (default), which is exactly what we want for both first-upload and
      // rotation flows.
      await runGog(['auth', 'credentials', 'set', tmpFile])
    } catch (err) {
      const message = (err as Error).message
      this.lastError = { kind: 'credentials_invalid', message }
      return { ok: false, kind: 'credentials_invalid', message }
    } finally {
      await unlink(tmpFile).catch(() => {})
    }

    this.lastError = null
    return { ok: true, clientId: creds.client_id, projectId: creds.project_id ?? '' }
  }

  authAdd(email: string, onAuthUrl?: (url: string) => void): Promise<GoogleAuthResult> {
    const trimmed = email.trim()
    if (!trimmed) {
      const message = 'Email is required'
      this.lastError = { kind: 'auth_failed', message }
      return Promise.resolve({ ok: false, kind: 'auth_failed', message })
    }
    return new Promise((resolve) => {
      // Use spawn so we can stream stdout and pull the OAuth URL out the
      // instant gog prints it ("If the browser doesn't open, visit this
      // URL: …"). The buffered execFile path would only return the full
      // output after gog exits, which is too late for the panel.
      // Match gogcli's internal OAuth deadline to our outer wrapper —
      // its default (~3 min) is shorter and fires first, killing the
      // local callback server before the user finishes consent.
      const child = spawn(GOG_PATH, ['auth', 'add', trimmed, '--timeout=10m'], {
        stdio: ['ignore', 'pipe', 'pipe']
      })
      this.authChild = child
      let stdoutBuf = ''
      let stderrBuf = ''
      let urlEmitted = false
      const urlRegex = /https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?\S+/

      const tryEmitUrl = (): void => {
        if (urlEmitted || !onAuthUrl) return
        const m = stdoutBuf.match(urlRegex) ?? stderrBuf.match(urlRegex)
        if (m) {
          urlEmitted = true
          onAuthUrl(m[0])
        }
      }

      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        stdoutBuf += chunk
        tryEmitUrl()
      })
      child.stderr?.on('data', (chunk: string) => {
        stderrBuf += chunk
        tryEmitUrl()
      })

      const timer = setTimeout(() => {
        child.kill('SIGTERM')
      }, AUTH_TIMEOUT_MS)

      child.on('error', (err) => {
        clearTimeout(timer)
        if (this.authChild === child) this.authChild = null
        const message = err.message
        this.lastError = { kind: 'auth_failed', message }
        resolve({ ok: false, kind: 'auth_failed', message })
      })

      child.on('close', async (code) => {
        clearTimeout(timer)
        if (this.authChild === child) this.authChild = null
        if (code === 0) {
          this.lastError = null
          resolve({ ok: true, account: trimmed })
          return
        }
        // gog sometimes exits non-zero (or our timeout fires) even after
        // the OAuth flow succeeded in the browser. Verify before failing.
        if (await this.isAccountAuthorized(trimmed)) {
          this.lastError = null
          resolve({ ok: true, account: trimmed })
          return
        }
        const raw = stderrBuf.trim() || stdoutBuf.trim() || `gog exited with code ${code ?? 'null'}`
        const message = cleanGogError(raw)
        const kind: GoogleErrorKind = /(timeout|deadline)/i.test(message)
          ? 'auth_timeout'
          : 'auth_failed'
        this.lastError = { kind, message }
        resolve({ ok: false, kind, message })
      })
    })
  }

  /**
   * Wipe everything tied to the current OAuth client: revoke each
   * authorized account from the keyring, then drop the stored
   * credentials.json. Leaving accounts behind would just orphan refresh
   * tokens that the user can no longer use.
   */
  async deleteCredentials(): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const accounts = await this.listAccounts()
      for (const email of accounts) {
        await runGog(['auth', 'remove', email, '--force']).catch(() => {})
      }
      await runGog(['auth', 'credentials', 'remove', 'default', '--force'])
      this.lastError = null
      return { ok: true }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }

  async removeAccount(email: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const trimmed = email.trim()
    if (!trimmed) return { ok: false, message: 'Email is required' }
    try {
      // gogcli refuses to delete a stored token without an interactive
      // confirmation or --force; we're past the user's click in the panel
      // so skip the prompt explicitly.
      await runGog(['auth', 'remove', trimmed, '--force'])
      return { ok: true }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }

  async listAccounts(): Promise<string[]> {
    try {
      const stdout = await runGog(['auth', 'list', '--json'], 10_000)
      const parsed = JSON.parse(stdout) as
        | Array<{ email?: string; account?: string }>
        | { accounts?: Array<{ email?: string; account?: string }> }
      // gogcli wraps the list as `{ "accounts": [{ "email": "..." }, ...] }`
      // but tolerate a top-level array too in case the format ever changes.
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.accounts)
          ? parsed.accounts
          : []
      return items
        .map((a) => String(a?.email ?? a?.account ?? '').trim())
        .filter((s) => s.length > 0)
    } catch {
      return []
    }
  }

  private async isAccountAuthorized(email: string): Promise<boolean> {
    return (await this.listAccounts()).includes(email)
  }

  resetCache(): void {
    this.lastError = null
  }
}

export const googleService = new GoogleService()
