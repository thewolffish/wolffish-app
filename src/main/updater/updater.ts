import { is } from '@electron-toolkit/utils'
import { wlog } from '@main/workspace/logger'
import { readConfig } from '@main/workspace/workspace'
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
  ipcMain.handle('updater:check', async () => {
    if (is.dev) return { ok: true, version: null }
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

  if (is.dev) return

  wlog.separator('Updater Init')
  wlog.info(tag, `version  ${app.getVersion()}`)
  wlog.info(tag, `feed     ${RELEASES_URL}`)

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.setFeedURL({ provider: 'generic', url: RELEASES_URL })

  autoUpdater.on('checking-for-update', () => {
    wlog.separator('Update Check')
    wlog.info(tag, 'checking')
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    wlog.info(tag, `up to date (v${info.version})`)
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    wlog.separator('Update Available')
    wlog.info(tag, `v${info.version}`)
    broadcast<UpdateAvailableEvent>('updater:available', {
      version: info.version,
      releaseNotes: extractReleaseNotes(info)
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent)
    wlog.info(tag, `download ${pct}%  (${progress.transferred}/${progress.total})`)
    broadcast<UpdateDownloadProgressEvent>('updater:progress', { percent: pct })
  })

  autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
    wlog.separator('Download Complete')
    wlog.info(tag, `version  v${info.version}`)
    wlog.info(tag, `file     ${info.downloadedFile}`)
    broadcast<UpdateReadyEvent>('updater:ready', {
      version: info.version,
      releaseNotes: extractReleaseNotes(info)
    })
  })

  autoUpdater.on('error', (err) => {
    wlog.error(tag, err)
  })
}

export function installUpdate(): void {
  wlog.separator('Install')
  wlog.info(tag, 'quitAndInstall(false, true)')
  autoUpdater.quitAndInstall(false, true)
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
