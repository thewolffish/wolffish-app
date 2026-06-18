import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import dns from 'node:dns'

const execFileAsync = promisify(execFileCb)
const dnsResolveAsync = promisify(dns.resolve)

const KNOWLEDGE_FILES = ['projects', 'people', 'preferences', 'technical', 'decisions']

let workspaceRoot = ''

const toolDefinitions = [
  {
    name: 'wolffish_status',
    description:
      'Get current Wolffish status including uptime, active provider, loaded capabilities, and system health.',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'wolffish_performance',
    description:
      'Get performance stats including task success rates, most used tools, and error rates.',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'wolffish_memory',
    description:
      "Get a summary of what Wolffish remembers — recent conversation topics and knowledge areas.",
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days to look back (default 7)' }
      },
      required: []
    }
  }
]

// ---------------------------------------------------------------------------
// wolffish_status
// ---------------------------------------------------------------------------

async function getStatus() {
  const [mem, diskFree, cortexDbSize, capabilities, providers, bootTime, connectivity, feedbackCounts] =
    await Promise.all([
      getMemoryInfo(),
      getDiskFree(),
      fileSize(path.join(workspaceRoot, 'brain', 'cortex.db')),
      listCapabilities(),
      readProviders(),
      getSystemBootTime(),
      checkConnectivity(),
      countFeedback()
    ])

  const uptimeSec = Math.floor(process.uptime())
  const startedAt = new Date(Date.now() - uptimeSec * 1000)

  const lines = ['## Wolffish Status', '']

  lines.push(`- **Running since:** ${formatTimestamp(startedAt)} (${formatUptime(uptimeSec)})`)

  if (providers.all.length > 0) {
    const list = providers.all.map((p) => {
      const tag = p === providers.active ? ' ✦' : p === providers.fallback ? ' (fallback)' : ''
      return `${p.id}/${p.model}${tag}`
    })
    lines.push(`- **Providers:** ${list.join(', ')}`)
  } else {
    lines.push('- **Providers:** none configured')
  }

  const capList = capabilities.length === 0 ? 'none' : capabilities.join(', ')
  lines.push(`- **Capabilities:** ${capList} (${capabilities.length} loaded)`)
  lines.push(`- **Tool calls:** ${feedbackCounts.total} total, ${feedbackCounts.today} today`)

  if (mem.total > 0) {
    lines.push(
      `- **RAM used:** ${formatBytes(mem.used)} / ${formatBytes(mem.total)} (${formatPercent(mem.pressure)})`
    )
    lines.push(`- **RAM available:** ~${formatBytes(mem.available)} (includes reclaimable)`)
    if (mem.swap !== null) {
      lines.push(`- **Swap:** ${formatBytes(mem.swap)}`)
    }
  }

  if (diskFree !== null) {
    lines.push(`- **Disk free:** ${formatBytes(diskFree)}`)
  }
  if (cortexDbSize !== null) {
    lines.push(`- **cortex.db:** ${formatBytes(cortexDbSize)}`)
  }

  lines.push(`- **Platform:** ${process.platform} ${process.arch}`)

  if (bootTime) {
    const sysUptimeSec = Math.floor((Date.now() - bootTime.getTime()) / 1000)
    lines.push(`- **OS restarted:** ${formatTimestamp(bootTime)} (up ${formatUptime(sysUptimeSec)})`)
  } else {
    const sysUp = os.uptime()
    if (Number.isFinite(sysUp) && sysUp > 0) {
      lines.push(`- **OS uptime:** ${formatUptime(Math.floor(sysUp))}`)
    } else {
      lines.push('- **OS uptime:** could not be determined')
    }
  }

  if (connectivity.connected) {
    lines.push(`- **Internet:** connected (${connectivity.latencyMs}ms DNS latency)`)
  } else {
    lines.push('- **Internet:** unreachable or could not be determined')
  }

  return { success: true, output: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// wolffish_performance
// ---------------------------------------------------------------------------

async function getPerformance() {
  const taskStats = await readTaskStats()
  const feedback = await readFeedbackStats()

  const successRate =
    taskStats.allTime.total > 0
      ? taskStats.allTime.succeeded / taskStats.allTime.total
      : feedback.totalCalls > 0
        ? feedback.successCount / feedback.totalCalls
        : 0

  const lines = ['## Performance', '']
  lines.push(
    `- **Tasks today:** ${taskStats.today.total} (${taskStats.today.succeeded} succeeded, ${taskStats.today.failed} failed, ${taskStats.today.stopped} stopped)`
  )
  lines.push(`- **Tasks all time:** ${taskStats.allTime.total}`)
  lines.push(`- **Success rate:** ${formatPercent(successRate)}`)
  lines.push(`- **Total tool calls:** ${feedback.totalCalls}`)
  if (feedback.topTools.length > 0) {
    const used = feedback.topTools.map((t) => `${t.tool} (${t.count})`).join(', ')
    lines.push(`- **Most used:** ${used}`)
  }
  if (feedback.topDenied.length > 0) {
    const denied = feedback.topDenied.map((t) => `${t.tool} x${t.count}`).join(', ')
    lines.push(`- **Denied:** ${denied}`)
  }
  if (taskStats.avgDurationMs !== null) {
    lines.push(`- **Avg task duration:** ${(taskStats.avgDurationMs / 1000).toFixed(1)}s`)
  }

  return { success: true, output: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// wolffish_memory
// ---------------------------------------------------------------------------

async function getMemory(args) {
  const days = typeof args?.days === 'number' && args.days > 0 ? Math.floor(args.days) : 7
  const episodes = await listEpisodes()
  const todayKey = formatDate(new Date())
  const today = episodes.find((ep) => ep.date === todayKey)
  const topics = today ? extractTopics(today.content) : []

  const knowledge = await readKnowledgeFiles()
  const feedbackCounts = await countFeedback()

  const lines = ['## Memory', '']
  lines.push(`- **Episodes:** ${episodes.length} days recorded (window=${days}d)`)
  if (topics.length > 0) {
    lines.push(`- **Today's topics:** ${topics.join(', ')}`)
  } else {
    lines.push(`- **Today's topics:** (none yet)`)
  }
  if (knowledge.length > 0) {
    const summary = knowledge
      .map((kf) => `${kf.name} (${kf.hasContent ? 'has content' : 'empty'})`)
      .join(', ')
    lines.push(`- **Knowledge files:** ${summary}`)
  }
  lines.push(
    `- **Feedback entries:** ${feedbackCounts.today} today, ${feedbackCounts.total} total`
  )

  return { success: true, output: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// System info helpers
// ---------------------------------------------------------------------------

async function getMemoryInfo() {
  const total = os.totalmem()

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('vm_stat', [], { timeout: 5000 })
      const pageSizeMatch = /page size of (\d+) bytes/.exec(stdout)
      const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 16384
      const page = (label) => {
        const m = new RegExp(`"?${label}"?:\\s+(\\d+)`).exec(stdout)
        return m ? parseInt(m[1], 10) * pageSize : 0
      }
      const free = page('Pages free')
      const active = page('Pages active')
      const inactive = page('Pages inactive')
      const wired = page('Pages wired down')
      const compressed = page('Pages occupied by compressor')
      const purgeable = page('Pages purgeable')

      const used = active + wired + compressed
      const available = free + inactive + purgeable

      let swap = null
      try {
        const { stdout: swapOut } = await execFileAsync('sysctl', ['-n', 'vm.swapusage'], {
          timeout: 3000
        })
        const m = /used\s*=\s*([\d.]+)([MG])/i.exec(swapOut)
        if (m) {
          const val = parseFloat(m[1])
          swap = m[2].toUpperCase() === 'G' ? val * 1024 * 1024 * 1024 : val * 1024 * 1024
        }
      } catch {
        // swap info optional
      }

      return { total, used, available, pressure: total > 0 ? used / total : 0, swap }
    } catch {
      // fall through to generic
    }
  }

  if (process.platform === 'linux') {
    try {
      const raw = await fs.readFile('/proc/meminfo', 'utf8')
      const kb = (key) => {
        const m = new RegExp(`${key}:\\s+(\\d+)\\s+kB`).exec(raw)
        return m ? parseInt(m[1], 10) * 1024 : null
      }
      const memTotal = kb('MemTotal') ?? total
      const memAvailable = kb('MemAvailable')
      const swapTotal = kb('SwapTotal')
      const swapFree = kb('SwapFree')
      let swap = null
      if (swapTotal !== null && swapFree !== null) swap = swapTotal - swapFree

      if (memAvailable !== null) {
        const used = memTotal - memAvailable
        return { total: memTotal, used, available: memAvailable, pressure: memTotal > 0 ? used / memTotal : 0, swap }
      }
    } catch {
      // fall through
    }
  }

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-Command', 'Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize,FreeVirtualMemory,TotalVirtualMemorySize | ConvertTo-Json'],
        { timeout: 8000 }
      )
      const info = JSON.parse(stdout)
      const availableKb = parseInt(info.FreePhysicalMemory, 10)
      const totalKb = parseInt(info.TotalVisibleMemorySize, 10)
      if (Number.isFinite(availableKb) && Number.isFinite(totalKb)) {
        const memTotal = totalKb * 1024
        const memAvailable = availableKb * 1024
        const used = memTotal - memAvailable
        const virtualTotalKb = parseInt(info.TotalVirtualMemorySize, 10)
        const virtualFreeKb = parseInt(info.FreeVirtualMemory, 10)
        let swap = null
        if (Number.isFinite(virtualTotalKb) && Number.isFinite(virtualFreeKb)) {
          const pagefileTotal = (virtualTotalKb - totalKb) * 1024
          const pagefileFree = (virtualFreeKb - availableKb) * 1024
          if (pagefileTotal > 0) swap = Math.max(0, pagefileTotal - pagefileFree)
        }
        return { total: memTotal, used, available: memAvailable, pressure: memTotal > 0 ? used / memTotal : 0, swap }
      }
    } catch {
      // fall through
    }
  }

  const free = os.freemem()
  return {
    total,
    used: total - free,
    available: free,
    pressure: total > 0 ? (total - free) / total : 0,
    swap: null
  }
}

async function getDiskFree() {
  try {
    const stats = await fs.statfs(workspaceRoot || os.homedir())
    return stats.bavail * stats.bsize
  } catch {
    return null
  }
}

async function getSystemBootTime() {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('sysctl', ['-n', 'kern.boottime'], { timeout: 3000 })
      const m = /sec\s*=\s*(\d+)/.exec(stdout)
      if (m) return new Date(parseInt(m[1], 10) * 1000)
    } catch {
      // fall through
    }
  }

  if (process.platform === 'linux') {
    try {
      const raw = await fs.readFile('/proc/uptime', 'utf8')
      const upSec = parseFloat(raw.split(/\s/)[0])
      if (Number.isFinite(upSec)) return new Date(Date.now() - upSec * 1000)
    } catch {
      // fall through
    }
  }

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString("o")'],
        { timeout: 5000 }
      )
      const d = new Date(stdout.trim())
      if (Number.isFinite(d.getTime())) return d
    } catch {
      // fall through
    }
  }

  try {
    const up = os.uptime()
    if (Number.isFinite(up) && up > 0) return new Date(Date.now() - up * 1000)
  } catch {
    // give up
  }

  return null
}

async function checkConnectivity() {
  try {
    const start = Date.now()
    await Promise.race([
      dnsResolveAsync('google.com'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
    ])
    return { connected: true, latencyMs: Date.now() - start }
  } catch {
    return { connected: false, latencyMs: null }
  }
}

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

async function readProviders() {
  const configPath = path.join(workspaceRoot, 'config.json')
  let raw
  try {
    raw = await fs.readFile(configPath, 'utf8')
  } catch {
    return { all: [], active: null, fallback: null }
  }
  let cfg
  try {
    cfg = JSON.parse(raw)
  } catch {
    return { all: [], active: null, fallback: null }
  }

  const cloud = Array.isArray(cfg?.llm?.providers) ? cfg.llm.providers : []
  const priority = Array.isArray(cfg?.llm?.cloudPriority) ? cfg.llm.cloudPriority : []
  const local = cfg?.llm?.local

  const all = []
  for (const p of cloud) {
    if (p?.id && p?.model) {
      all.push({ id: p.id, model: p.model, hasKey: Boolean(p.apiKey) })
    }
  }
  if (local?.model) {
    all.push({ id: 'local', model: local.model, hasKey: true })
  }

  const ordered = []
  if (priority.length > 0) {
    for (const id of priority) {
      const match = all.find((p) => p.id === id && p.hasKey)
      if (match && !ordered.includes(match)) ordered.push(match)
    }
  }
  for (const p of all) {
    if (!ordered.includes(p) && p.hasKey) ordered.push(p)
  }

  return {
    all,
    active: ordered[0] ?? null,
    fallback: ordered[1] ?? null
  }
}

// ---------------------------------------------------------------------------
// Task & feedback data
// ---------------------------------------------------------------------------

async function readTaskStats() {
  const empty = { total: 0, succeeded: 0, failed: 0, stopped: 0 }
  const out = {
    today: { ...empty },
    allTime: { ...empty },
    avgDurationMs: null
  }
  const dir = path.join(workspaceRoot, 'brain', 'motor', 'tasks')
  let entries
  try {
    entries = await fs.readdir(dir)
  } catch {
    return out
  }
  const todayKey = formatDate(new Date())
  let durationSum = 0
  let durationCount = 0
  for (const name of entries) {
    if (!/^TASK-[A-Za-z0-9._-]+\.md$/.test(name)) continue
    let raw
    try {
      raw = await fs.readFile(path.join(dir, name), 'utf8')
    } catch {
      continue
    }
    const status = (/\*\*Status:\*\*\s*([A-Za-z]+)/i.exec(raw)?.[1] ?? '').toLowerCase()
    const createdRaw = /\*\*Created:\*\*\s*([\d:\-T.Z]+)/i.exec(raw)?.[1]
    const updatedRaw = /\*\*Updated:\*\*\s*([\d:\-T.Z]+)/i.exec(raw)?.[1]
    const created = createdRaw ? new Date(createdRaw) : null
    const updated = updatedRaw ? new Date(updatedRaw) : null

    out.allTime.total += 1
    if (status === 'succeeded') out.allTime.succeeded += 1
    else if (status === 'failed') out.allTime.failed += 1
    else if (status === 'stopped') out.allTime.stopped += 1

    if (created && formatDate(created) === todayKey) {
      out.today.total += 1
      if (status === 'succeeded') out.today.succeeded += 1
      else if (status === 'failed') out.today.failed += 1
      else if (status === 'stopped') out.today.stopped += 1
    }

    if (created && updated && status !== 'running') {
      const ms = updated.getTime() - created.getTime()
      if (Number.isFinite(ms) && ms >= 0) {
        durationSum += ms
        durationCount += 1
      }
    }
  }
  out.avgDurationMs = durationCount > 0 ? durationSum / durationCount : null
  return out
}

async function readFeedbackStats() {
  const dir = path.join(workspaceRoot, 'brain', 'basalganglia')
  let entries
  try {
    entries = await fs.readdir(dir)
  } catch {
    return {
      totalCalls: 0,
      successCount: 0,
      failedCount: 0,
      deniedCount: 0,
      topTools: [],
      topDenied: []
    }
  }
  const toolCounts = new Map()
  const deniedCounts = new Map()
  let total = 0
  let success = 0
  let failed = 0
  let denied = 0
  for (const name of entries) {
    if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) continue
    let raw
    try {
      raw = await fs.readFile(path.join(dir, name), 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split(/\r?\n/)) {
      const m = /^-\s+\d{2}:\d{2}\s+\|\s+([^|]+?)\s+\|\s+(\S+)\s*$/.exec(line)
      if (!m) continue
      const tool = m[1].trim()
      const outcome = m[2].trim()
      total += 1
      toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1)
      if (outcome === 'success' || outcome === 'approved') success += 1
      else if (outcome === 'failed' || outcome === 'blocked') failed += 1
      else if (outcome === 'denied') {
        denied += 1
        deniedCounts.set(tool, (deniedCounts.get(tool) ?? 0) + 1)
      }
    }
  }
  return {
    totalCalls: total,
    successCount: success,
    failedCount: failed,
    deniedCount: denied,
    topTools: rank(toolCounts, 5),
    topDenied: rank(deniedCounts, 5)
  }
}

// ---------------------------------------------------------------------------
// Episode & knowledge data
// ---------------------------------------------------------------------------

async function listEpisodes() {
  const dir = path.join(workspaceRoot, 'brain', 'hippocampus', 'episodes')
  let entries
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  const dated = entries.filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)).sort()
  const out = []
  for (const name of dated) {
    let raw
    try {
      raw = await fs.readFile(path.join(dir, name), 'utf8')
    } catch {
      continue
    }
    const content = raw.trim()
    if (content.length === 0) continue
    out.push({ date: name.replace(/\.md$/, ''), content })
  }
  return out
}

async function readKnowledgeFiles() {
  const dir = path.join(workspaceRoot, 'brain', 'hippocampus', 'knowledge')
  const out = []
  for (const name of KNOWLEDGE_FILES) {
    let raw
    try {
      raw = await fs.readFile(path.join(dir, `${name}.md`), 'utf8')
    } catch {
      out.push({ name, hasContent: false })
      continue
    }
    const body = raw.replace(/^#[^\n]*\n+/, '').trim()
    out.push({ name, hasContent: body.length > 0 })
  }
  return out
}

async function countFeedback() {
  const dir = path.join(workspaceRoot, 'brain', 'basalganglia')
  let entries
  try {
    entries = await fs.readdir(dir)
  } catch {
    return { today: 0, total: 0 }
  }
  const todayKey = formatDate(new Date())
  let today = 0
  let total = 0
  for (const name of entries) {
    if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) continue
    let raw
    try {
      raw = await fs.readFile(path.join(dir, name), 'utf8')
    } catch {
      continue
    }
    let count = 0
    for (const line of raw.split(/\r?\n/)) {
      if (/^-\s+\d{2}:\d{2}\s+\|/.test(line)) count += 1
    }
    total += count
    if (name === `${todayKey}.md`) today += count
  }
  return { today, total }
}

async function listCapabilities() {
  const dir = path.join(workspaceRoot, 'brain', 'cerebellum')
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const names = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    const skill = path.join(dir, entry.name, 'SKILL.md')
    try {
      await fs.access(skill)
      names.push(entry.name)
    } catch {
      // skip directories without SKILL.md
    }
  }
  names.sort()
  return names
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function extractTopics(episodeMarkdown) {
  const out = []
  for (const line of episodeMarkdown.split(/\r?\n/)) {
    const m = /^##\s+\d{2}:\d{2}\s+—\s+(.+?)\s*$/.exec(line)
    if (m) out.push(m[1].trim())
  }
  return out
}

function rank(counts, limit) {
  return [...counts.entries()]
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

async function fileSize(filepath) {
  try {
    const stat = await fs.stat(filepath)
    return stat.size
  } catch {
    return null
  }
}

function formatDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatTimestamp(d) {
  try {
    const y = d.getFullYear()
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${mo}-${day} ${h}:${mi}`
  } catch {
    return 'unknown'
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  if (hours < 24) return `${hours}h ${remMins}m`
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return `${days}d ${remHours}h`
}

function formatPercent(ratio) {
  return `${Math.round(ratio * 100)}%`
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

const plugin = {
  name: 'introspect',
  tools: toolDefinitions,
  async init(context) {
    workspaceRoot = context?.workspaceRoot ?? ''
  },
  async execute(toolName, args) {
    switch (toolName) {
      case 'wolffish_status':
        return getStatus()
      case 'wolffish_performance':
        return getPerformance()
      case 'wolffish_memory':
        return getMemory(args ?? {})
      default:
        return { success: false, error: `introspect: unknown tool ${toolName}` }
    }
  }
}

export default plugin
