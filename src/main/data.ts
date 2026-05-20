import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { workspaceRoot } from '@main/workspace/workspace'

export type DataAnalytics = {
  workspaceBytes: number
  hippocampusBytes: number
  corpusBytes: number
  prefrontalBytes: number
  ramBytes: number
  cpuPercent: number
  totalRamBytes: number
  cpuCount: number
}

/**
 * Walk a directory tree and sum every regular file's size in bytes.
 * Returns 0 for missing directories so a never-touched region (e.g. a
 * fresh prefrontal/.debug/ that hasn't been written to yet) shows as
 * 0 B instead of erroring.
 */
async function dirSize(dir: string): Promise<number> {
  let total = 0
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await dirSize(child)
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(child)
        total += stat.size
      } catch {
        // skip unreadable entries
      }
    }
  }
  return total
}

/**
 * Sample CPU usage of the main process over a short interval. Returns a
 * percentage of one core; >100% means the process is using more than one
 * core's worth of CPU. Sampling synchronously over 250ms keeps the IPC
 * call snappy while still giving a representative reading.
 */
async function sampleCpuPercent(intervalMs = 250): Promise<number> {
  const start = process.cpuUsage()
  const startWall = Date.now()
  await new Promise((resolve) => setTimeout(resolve, intervalMs))
  const diff = process.cpuUsage(start)
  const elapsedMicros = (Date.now() - startWall) * 1000
  if (elapsedMicros <= 0) return 0
  return ((diff.user + diff.system) / elapsedMicros) * 100
}

export async function getDataAnalytics(): Promise<DataAnalytics> {
  const root = workspaceRoot()
  const brainDir = path.join(root, 'brain')

  const [workspaceBytes, hippocampusBytes, corpusBytes, prefrontalBytes, cpuPercent] =
    await Promise.all([
      dirSize(root),
      dirSize(path.join(brainDir, 'hippocampus')),
      dirSize(path.join(brainDir, 'corpus')),
      dirSize(path.join(brainDir, 'prefrontal')),
      sampleCpuPercent()
    ])

  return {
    workspaceBytes,
    hippocampusBytes,
    corpusBytes,
    prefrontalBytes,
    ramBytes: process.memoryUsage().rss,
    cpuPercent,
    totalRamBytes: os.totalmem(),
    cpuCount: os.cpus().length
  }
}
