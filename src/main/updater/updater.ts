import { autoUpdater, type UpdateDownloadedEvent, type UpdateInfo } from 'electron-updater'
import { app, BrowserWindow, ipcMain } from 'electron'
import { readConfig } from '@main/workspace/workspace'

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
    return info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note ?? '')).join('\n')
  }
  return null
}

function broadcast<T>(channel: string, payload: T): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload)
  }
}

export function initUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: RELEASES_URL
  })

  // TODO: code signing — once signing is configured, remove this line
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

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return { ok: true, version: result?.updateInfo.version ?? null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('updater:getVersion', () => {
    return app.getVersion()
  })
}

export async function checkForUpdatesIfEnabled(): Promise<void> {
  const cfg = await readConfig()
  if (cfg?.updates?.enabled === false) return
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // silent — don't bother the user with update check failures
  }
}
