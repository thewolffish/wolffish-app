import { is } from '@electron-toolkit/utils'
import { wlog } from '@main/workspace/logger'
import { patchConfig, readConfig } from '@main/workspace/workspace'
import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater, type UpdateDownloadedEvent, type UpdateInfo } from 'electron-updater'

const RELEASES_URL = 'https://releases.wolffi.sh'
const tag = '[updater]'

export type UpdateAvailableEvent = {
  version: string
  releaseNotes: string | null
}

export type UpdateDownloadProgressEvent = {
  percent: number
}

export type UpdateReadyEvent = {
  version: string
  releaseNotes: string | null
}

export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'error'

export type UpdaterState = {
  phase: UpdaterPhase
  version: string | null
  percent: number
  releaseNotes: string | null
  error: string | null
}

function extractReleaseNotes(info: UpdateInfo): string | null {
  if (!info.releaseNotes) return null
  if (typeof info.releaseNotes === 'string') return info.releaseNotes
  if (Array.isArray(info.releaseNotes)) {
    return info.releaseNotes.map((n) => (typeof n === 'string' ? n : (n.note ?? ''))).join('\n')
  }
  return null
}

function broadcast<T>(channel: string, payload: T): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload)
  }
}

let lastReady: UpdateReadyEvent | null = null

// Main is the single source of truth for update progress. The renderer panels
// (UpdatesPanel, UpdateCard) are fully unmounted on page navigation, so they
// cannot hold the live state — they pull it via updater:getState on mount and
// subscribe to updater:state for changes. Every mutation goes through setState.
let state: UpdaterState = {
  phase: 'idle',
  version: null,
  percent: 0,
  releaseNotes: null,
  error: null
}

function setState(patch: Partial<UpdaterState>): void {
  state = { ...state, ...patch }
  broadcast<UpdaterState>('updater:state', state)
}

function emitError(message: string): void {
  broadcast<{ message: string }>('updater:error', { message })
}

// Post-100% verification hang watchdog. On Windows the bytes can be fully on
// disk yet the install never arms — Authenticode verification and the
// antivirus EBUSY rename-retry loop both run AFTER progress hits 100%. If we
// sit in 'verifying' with neither an update-downloaded nor an error event,
// surface a recoverable error instead of an eternal "Downloading 100%".
let verifyWatchdog: ReturnType<typeof setTimeout> | null = null
const VERIFY_TIMEOUT_MS = 120_000

function clearVerifyWatchdog(): void {
  if (verifyWatchdog) {
    clearTimeout(verifyWatchdog)
    verifyWatchdog = null
  }
}

export function initUpdater(): void {
  ipcMain.handle('updater:check', async () => {
    if (is.dev) return { ok: true, version: null }
    // Never disturb an in-flight or finished download. Re-running the check
    // would re-emit update-available and snap the UI back to 0% while
    // disabling Install. The renderer recovers live state via updater:getState,
    // so a manual check during/after a download is a safe no-op.
    if (
      state.phase === 'checking' ||
      state.phase === 'downloading' ||
      state.phase === 'verifying' ||
      state.phase === 'ready' ||
      state.phase === 'installing'
    ) {
      return { ok: true, version: state.version }
    }
    try {
      const result = await autoUpdater.checkForUpdates()
      const version = result?.updateInfo.version ?? null
      const current = app.getVersion()
      const hasUpdate = version ? version !== current : false
      return { ok: true, version: hasUpdate ? version : null }
    } catch (err) {
      wlog.error(tag, 'check failed', err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('updater:getVersion', () => app.getVersion())
  ipcMain.handle('updater:getReady', () => lastReady)
  ipcMain.handle('updater:getState', () => state)

  if (is.dev) return

  wlog.separator('Updater Init')
  wlog.info(tag, `version  ${app.getVersion()}`)
  wlog.info(tag, `feed     ${RELEASES_URL}`)

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoRunAppAfterInstall = true
  // Always fetch the full artifact and let electron-updater verify its sha512,
  // mirroring the standalone install scripts. The NSIS differential/blockmap
  // path is a known source of stalled/corrupt Windows downloads, so opt out.
  autoUpdater.disableDifferentialDownload = true
  autoUpdater.setFeedURL({ provider: 'generic', url: RELEASES_URL })

  autoUpdater.on('checking-for-update', () => {
    wlog.separator('Update Check')
    wlog.info(tag, 'checking')
    // Only reflect a check when idle/errored — never clobber an in-flight
    // download already running because of autoDownload.
    if (state.phase === 'idle' || state.phase === 'error') {
      setState({ phase: 'checking', error: null })
    }
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    wlog.info(tag, `up to date (v${info.version})`)
    clearVerifyWatchdog()
    setState({ phase: 'idle', version: null, percent: 0, releaseNotes: null, error: null })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    wlog.separator('Update Available')
    wlog.info(tag, `v${info.version}`)
    // Start every download cycle from a clean watchdog slate — a prior cycle
    // (esp. one whose watchdog self-fired) must never block re-arming.
    clearVerifyWatchdog()
    const releaseNotes = extractReleaseNotes(info)
    // autoDownload is on, so the download starts immediately — go straight to
    // 'downloading'. This percent reset to 0 is the only legitimate reset.
    setState({ phase: 'downloading', version: info.version, percent: 0, releaseNotes, error: null })
    broadcast<UpdateAvailableEvent>('updater:available', { version: info.version, releaseNotes })
  })

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent)
    wlog.info(tag, `download ${pct}%  (${progress.transferred}/${progress.total})`)
    if (pct >= 100 && !verifyWatchdog) {
      verifyWatchdog = setTimeout(() => {
        // The timer has fired — release the handle so a later 100% tick (e.g.
        // after a Retry) can re-arm. Without this, the guard above stays false
        // forever and a second silent post-100% hang would never recover.
        verifyWatchdog = null
        if (state.phase === 'verifying') {
          wlog.warn(tag, 'verification timed out')
          lastReady = null
          setState({ phase: 'error', error: 'Update verification timed out' })
          emitError('Update verification timed out')
        }
      }, VERIFY_TIMEOUT_MS)
    }
    // Monotonic: a late or duplicate low tick must never rewind the bar.
    setState({
      phase: pct >= 100 ? 'verifying' : 'downloading',
      percent: Math.max(state.percent, pct)
    })
    broadcast<UpdateDownloadProgressEvent>('updater:progress', { percent: pct })
  })

  autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
    wlog.separator('Download Complete')
    wlog.info(tag, `version  v${info.version}`)
    wlog.info(tag, `file     ${info.downloadedFile}`)
    clearVerifyWatchdog()
    const event: UpdateReadyEvent = {
      version: info.version,
      releaseNotes: extractReleaseNotes(info)
    }
    lastReady = event
    setState({
      phase: 'ready',
      version: info.version,
      percent: 100,
      releaseNotes: event.releaseNotes,
      error: null
    })
    broadcast<UpdateReadyEvent>('updater:ready', event)
  })

  autoUpdater.on('error', (err) => {
    wlog.error(tag, err)
    clearVerifyWatchdog()
    const message = err instanceof Error ? err.message : String(err)
    if (state.phase === 'downloading' || state.phase === 'verifying') {
      // A download/verify failure has no other surface — drop any stale ready
      // artifact and make it visible + retryable via the error broadcast.
      lastReady = null
      setState({ phase: 'error', error: message })
      emitError(message)
    } else if (state.phase === 'checking') {
      // A check failure is already reported to the renderer via the
      // updater:check reply (manual) or intentionally silent (launch
      // auto-check). Return to idle without a duplicate toast.
      setState({ phase: 'idle', error: message })
    } else {
      // Error outside an active attempt — record it without changing phase.
      setState({ error: message })
    }
  })
}

export async function stampPreUpdateVersion(): Promise<void> {
  try {
    await patchConfig((cfg) => ({
      ...cfg,
      updates: {
        ...cfg.updates,
        enabled: cfg.updates?.enabled ?? true,
        lastVersion: app.getVersion()
      }
    }))
    wlog.info(tag, `stamped pre-update version ${app.getVersion()}`)
  } catch (err) {
    wlog.warn(tag, 'failed to stamp pre-update version', err)
  }
}

export function isUpdateReady(): boolean {
  return lastReady !== null && (state.phase === 'ready' || state.phase === 'installing')
}

// Routes the install transition through main's state machine so a panel that
// remounts during the shutdown grace window (page navigation) keeps the Install
// button disabled instead of re-enabling it. Call only after isUpdateReady().
export function markInstalling(): void {
  setState({ phase: 'installing' })
}

export function installUpdate(): boolean {
  if (!isUpdateReady()) {
    const message = 'No downloaded update is ready to install'
    wlog.warn(tag, message)
    setState({ phase: 'error', error: message })
    emitError(message)
    return false
  }
  wlog.separator('Install')
  wlog.info(tag, 'quitAndInstall(false, true)')
  autoUpdater.quitAndInstall(false, true)
  return true
}

export async function checkForUpdatesIfEnabled(): Promise<void> {
  if (is.dev) return
  const cfg = await readConfig()
  if (cfg?.updates?.enabled === false) return
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    wlog.warn(tag, 'auto-check failed', err)
  }
}
