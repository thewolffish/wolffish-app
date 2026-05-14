import { is } from '@electron-toolkit/utils'
import { readConfig } from '@main/workspace/workspace'
import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater, type UpdateDownloadedEvent, type UpdateInfo } from 'electron-updater'

const RELEASES_URL = 'https://releases.wolffi.sh'

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

export function initUpdater(): void {
  // IPC handlers are always registered so the renderer never calls
  // an unhandled channel. The autoUpdater wiring is production-only.
  ipcMain.handle('updater:install', () => {
    if (is.dev) return
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('updater:check', async () => {
    if (is.dev) return { ok: true, version: null }
    try {
      const result = await autoUpdater.checkForUpdates()
      const remoteVersion = result?.updateInfo.version ?? null
      const currentVersion = app.getVersion()
      const hasUpdate = remoteVersion ? remoteVersion !== currentVersion : false
      return { ok: true, version: hasUpdate ? remoteVersion : null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('updater:getVersion', () => {
    return app.getVersion()
  })

  if (is.dev) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: RELEASES_URL
  })

  autoUpdater.autoRunAppAfterInstall = true

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    broadcast<UpdateAvailableEvent>('updater:available', {
      version: info.version,
      releaseNotes: extractReleaseNotes(info)
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    broadcast<UpdateDownloadProgressEvent>('updater:progress', {
      percent: Math.round(progress.percent)
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
    broadcast<UpdateReadyEvent>('updater:ready', {
      version: info.version,
      releaseNotes: extractReleaseNotes(info)
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message)
  })
}

export async function checkForUpdatesIfEnabled(): Promise<void> {
  if (is.dev) return
  const cfg = await readConfig()
  if (cfg?.updates?.enabled === false) return
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // silent — don't bother the user with update check failures
  }
}
