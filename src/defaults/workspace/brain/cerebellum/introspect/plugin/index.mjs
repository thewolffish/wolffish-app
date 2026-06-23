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
      'Get a summary of what Wolffish remembers — recent conversation topics and knowledge areas.',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days to look back (default 7)' }
      },
      required: []
    }
  },
  {
    name: 'wolffish_recall',
    description:
      "Precisely retrieve something from your own memory that is NOT in your current context: what you did on a specific date, the steps of a past task, an earlier conversation, a learned fact, or a past tool outcome. Search by keyword (`query`) and/or pin a day (`date`). Use this instead of guessing or saying you don't remember — your context only carries a lean summary, but the full history is on disk and this reads it.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords to search for (case-insensitive). Optional if `date` is given.'
        },
        date: {
          type: 'string',
          description: 'Pin results to a single day, format YYYY-MM-DD. Optional.'
        },
        source: {
          type: 'string',
          description:
            'Where to look: episodes (daily logs), tasks (past multi-step runs), feedback (tool outcomes), knowledge (long-term facts), conversations (full transcripts), or all (default).',
          enum: ['episodes', 'tasks', 'feedback', 'knowledge', 'conversations', 'all']
        },
        limit: { type: 'number', description: 'Max matches to return (default 8, max 30).' }
      },
      required: []
    }
  },
  {
    name: 'wolffish_list_files',
    description:
      "List files inside the Wolffish workspace ONLY (~/.wolffish/workspace — your own memory, generated files, capabilities, logs) as a structured tree with sizes. NOT a general file browser: it refuses paths outside the workspace. For the user's files anywhere else (Desktop, Documents, projects, any absolute path), use the filesystem tools or shell instead.",
    parameters: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description:
            "Subdirectory relative to the workspace root (e.g. 'files', 'brain/hippocampus/episodes'). Defaults to the workspace root."
        },
        depth: {
          type: 'number',
          description: 'How many levels deep to descend (default 2, max 5).'
        },
        pattern: {
          type: 'string',
          description: 'Only include files whose name contains this substring (case-insensitive).'
        }
      },
      required: []
    }
  }
]

// ---------------------------------------------------------------------------
// wolffish_status
// ---------------------------------------------------------------------------

async function getStatus() {
  const [
    mem,
    diskFree,
    cortexDbSize,
    capabilities,
    providers,
    bootTime,
    connectivity,
    feedbackCounts
  ] = await Promise.all([
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
    lines.push(
      `- **OS restarted:** ${formatTimestamp(bootTime)} (up ${formatUptime(sysUptimeSec)})`
    )
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
  lines.push(`- **Feedback entries:** ${feedbackCounts.today} today, ${feedbackCounts.total} total`)

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
        return {
          total: memTotal,
          used,
          available: memAvailable,
          pressure: memTotal > 0 ? used / memTotal : 0,
          swap
        }
      }
    } catch {
      // fall through
    }
  }

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize,FreeVirtualMemory,TotalVirtualMemorySize | ConvertTo-Json'
        ],
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
        return {
          total: memTotal,
          used,
          available: memAvailable,
          pressure: memTotal > 0 ? used / memTotal : 0,
          swap
        }
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
        [
          '-NoProfile',
          '-Command',
          '(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString("o")'
        ],
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
// wolffish_recall — precise on-demand retrieval from memory
// ---------------------------------------------------------------------------

const RECALL_MAX_OUTPUT_CHARS = 6000
const RECALL_SNIPPET_CHARS = 320
// Most records/messages pulled from any single file.
const RECALL_PER_FILE = 6
// Cap on files actually read per source, so a cold miss (no match) over a heavy
// user's history doesn't read+parse hundreds of files (esp. large conversation
// JSON). Files skipped by the filename date-gate don't count against this.
const RECALL_FILES_PER_SOURCE = 80

const RECALL_SOURCES = {
  episodes: ['brain', 'hippocampus', 'episodes'],
  knowledge: ['brain', 'hippocampus', 'knowledge'],
  tasks: ['brain', 'motor', 'tasks'],
  feedback: ['brain', 'basalganglia'],
  conversations: ['brain', 'conversations']
}

// Sources whose filenames embed the YYYY-MM-DD (episodes 2026-06-18.md,
// feedback day files, conv-2026-06-18_…json). For these a date filter can be
// applied cheaply to the filename before reading. Tasks (TASK-<base36>.md) and
// knowledge files carry no date in the name — their date lives in the body
// (e.g. `**Created:** 2026-06-18T…`), so they must be date-matched on content.
const RECALL_DATE_STAMPED = new Set(['episodes', 'feedback', 'conversations'])

async function recall(args) {
  const query = typeof args?.query === 'string' ? args.query.trim() : ''
  const date =
    typeof args?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : ''
  const requested = typeof args?.source === 'string' ? args.source : 'all'
  const limit =
    typeof args?.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 30) : 8

  if (!query && !date) {
    const index = await recallIndex()
    return {
      success: true,
      output:
        'Provide a `query` (keywords) and/or a `date` (YYYY-MM-DD) to recall something specific.\n\n' +
        index
    }
  }

  const sources =
    requested === 'all'
      ? ['episodes', 'tasks', 'feedback', 'knowledge', 'conversations']
      : [requested]
  // Tokenized AND match — every whitespace-separated term must appear (in any
  // order). So "world cup" and "cup world" both hit. Empty for a date-only
  // recall (the whole file's head is returned then).
  const terms = query ? query.toLowerCase().split(/\s+/).filter(Boolean) : []

  // Gather each source's matches independently (up to `limit` each), THEN
  // distribute the global limit round-robin across sources. Without this a busy
  // source processed first (episodes) could consume every slot and shadow a
  // real hit in tasks/feedback/conversations under source:"all".
  const groups = []
  let anyCapped = false
  for (const src of sources) {
    const { matches, capped } = await gatherSource(src, terms, date, limit)
    if (capped) anyCapped = true
    if (matches.length > 0) groups.push(matches)
  }

  const matches = []
  let progressed = true
  while (matches.length < limit && progressed) {
    progressed = false
    for (const g of groups) {
      if (matches.length >= limit) break
      const next = g.shift()
      if (next) {
        matches.push(next)
        progressed = true
      }
    }
  }
  // Lower-bound count of what we found but couldn't show (round-robin leftovers
  // + any per-file/per-source caps hit during gathering).
  let omitted = groups.reduce((n, g) => n + g.length, 0)

  if (matches.length === 0) {
    const scope = date ? ` on ${date}` : ''
    const q = query ? ` matching "${query}"` : ''
    return {
      success: true,
      output: `No memory found${q}${scope}. ${await recallIndex()}`
    }
  }

  const lines = [`## Recall — ${matches.length} match${matches.length === 1 ? '' : 'es'}`, '']
  let used = lines.join('\n').length
  let shown = 0
  for (const m of matches) {
    const block = `### ${m.path}\n${m.snippet}\n`
    if (used + block.length > RECALL_MAX_OUTPUT_CHARS && shown > 0) break
    lines.push(block)
    used += block.length
    shown += 1
  }
  omitted += matches.length - shown
  if (omitted > 0 || anyCapped) {
    const n = omitted > 0 ? `${omitted}+ ` : ''
    lines.push(
      `\n(${n}more match(es) not shown — narrow the query, or pin a \`date\`/\`source\`, to see them.)`
    )
  }
  return { success: true, output: lines.join('\n') }
}

/**
 * Collect up to `cap` matches from one source, newest-likely-first. Returns
 * `capped: true` if a per-file cap or the per-source scan budget was hit (i.e.
 * more matches may exist than were returned).
 */
async function gatherSource(src, terms, date, cap) {
  const segs = RECALL_SOURCES[src]
  if (!segs) return { matches: [], capped: false }
  const dir = path.join(workspaceRoot, ...segs)
  let names
  try {
    names = await fs.readdir(dir)
  } catch {
    return { matches: [], capped: false }
  }
  // Descending filename order. For date-named sources (episodes/feedback/
  // conversations) that's genuine recency; for tasks (TASK-<base36>) and
  // knowledge it's only reverse-alphabetical — best-effort, not true recency.
  names = names
    .filter((n) => !n.startsWith('.'))
    .sort()
    .reverse()
  const dateStamped = RECALL_DATE_STAMPED.has(src)
  const matches = []
  let capped = false
  let scanned = 0
  for (const name of names) {
    if (matches.length >= cap) break
    // Cheap filename date-gate for date-stamped sources (doesn't count against
    // the scan budget); others are gated on content after the read.
    if (date && dateStamped && !name.includes(date)) continue
    if (scanned >= RECALL_FILES_PER_SOURCE) {
      capped = true
      break
    }
    let raw
    try {
      raw = await fs.readFile(path.join(dir, name), 'utf8')
    } catch {
      continue
    }
    scanned++
    if (date && !dateStamped && !fileMatchesDate(src, raw, date)) continue
    const relPath = path.posix.join(...segs, name)
    const res =
      src === 'conversations'
        ? matchConversation(raw, terms)
        : terms.length > 0
          ? matchMarkdown(raw, terms)
          : { snippets: [headExcerpt(raw)], capped: false }
    if (res.capped) capped = true
    for (const snippet of res.snippets) {
      if (matches.length >= cap) break
      matches.push({ source: src, path: relPath, snippet })
    }
  }
  return { matches, capped }
}

/** True when every term is a substring of the (already-lowercased) haystack. */
function termsMatch(hayLower, terms) {
  for (const t of terms) {
    if (!hayLower.includes(t)) return false
  }
  return true
}

/**
 * Date-gate a non-date-stamped source on content. Tasks carry their date in
 * the `**Created:**`/`**Updated:**` header lines, so match those specifically
 * (a task that merely mentions a date in a step output shouldn't surface for
 * "what did we do on that day"). Knowledge files are timeless — a date filter
 * can't meaningfully match them, so they're excluded when a date is pinned.
 */
function fileMatchesDate(src, raw, date) {
  if (src === 'tasks') {
    return raw.includes(`**Created:** ${date}`) || raw.includes(`**Updated:** ${date}`)
  }
  if (src === 'knowledge') return false
  return raw.includes(date)
}

/** Pull matching records out of a markdown memory file (terms required). */
function matchMarkdown(raw, terms) {
  const snippets = []
  let capped = false
  for (const record of splitRecords(raw)) {
    if (!termsMatch(record.toLowerCase(), terms)) continue
    if (snippets.length >= RECALL_PER_FILE) {
      capped = true
      break
    }
    snippets.push(truncate(record.trim(), RECALL_SNIPPET_CHARS))
  }
  return { snippets, capped }
}

/**
 * Break a memory file into the smallest meaningful records so a keyword hit
 * returns just that entry, not the whole day. Episodes/tasks use `## ` blocks;
 * basal-ganglia day files use `- HH:MM | tool | outcome` entries; anything
 * else falls back to blank-line-separated paragraphs.
 */
function splitRecords(raw) {
  if (/\n##\s/.test(raw)) return raw.split(/\n(?=##\s)/)
  if (/\n-\s\d{2}:\d{2}\s\|/.test(raw)) return raw.split(/\n(?=-\s\d{2}:\d{2}\s\|)/)
  return raw.split(/\n\s*\n/)
}

/** Head excerpt of a whole file — used for date-only recall (no keyword). */
function headExcerpt(raw) {
  return truncate(raw.trim(), RECALL_SNIPPET_CHARS * 4)
}

/** Pull matching messages out of a conversation transcript JSON. */
function matchConversation(raw, terms) {
  const snippets = []
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return { snippets, capped: false }
  }
  const messages = Array.isArray(data?.messages) ? data.messages : Array.isArray(data) ? data : []
  let capped = false
  for (const msg of messages) {
    const text = extractText(msg?.content)
    if (!text) continue
    if (terms.length > 0 && !termsMatch(text.toLowerCase(), terms)) continue
    if (snippets.length >= RECALL_PER_FILE) {
      capped = true
      break
    }
    const role = msg?.role ?? 'unknown'
    snippets.push(`[${role}] ${truncate(oneLine(text), RECALL_SNIPPET_CHARS)}`)
  }
  return { snippets, capped }
}

function extractText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b) => (typeof b === 'string' ? b : (b?.text ?? ''))).join(' ')
  }
  return ''
}

/** A short listing of what date-stamped memory exists, for empty results. */
async function recallIndex() {
  const episodes = await safeReaddir(path.join(workspaceRoot, 'brain', 'hippocampus', 'episodes'))
  const dates = episodes
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))
    .map((n) => n.replace(/\.md$/, ''))
    .sort()
    .reverse()
    .slice(0, 14)
  const tasks = (await safeReaddir(path.join(workspaceRoot, 'brain', 'motor', 'tasks'))).filter(
    (n) => /^TASK-.*\.md$/.test(n)
  ).length
  const convos = (await safeReaddir(path.join(workspaceRoot, 'brain', 'conversations'))).filter(
    (n) => n.endsWith('.json')
  ).length
  const parts = []
  if (dates.length > 0) parts.push(`Days with episodes: ${dates.join(', ')}.`)
  parts.push(`${tasks} past task(s), ${convos} saved conversation(s) on disk.`)
  return `Available memory — ${parts.join(' ')}`
}

// ---------------------------------------------------------------------------
// wolffish_list_files — structured workspace tree, no shelling out
// ---------------------------------------------------------------------------

const LIST_MAX_ENTRIES = 400

async function listFiles(args) {
  const sub = typeof args?.dir === 'string' ? args.dir : ''
  const depth =
    typeof args?.depth === 'number' && args.depth > 0 ? Math.min(Math.floor(args.depth), 5) : 2
  const pattern = typeof args?.pattern === 'string' ? args.pattern.toLowerCase() : ''

  // Resolve and confine to the workspace root — never traverse outside it.
  // String-prefix alone is not enough: path.resolve doesn't follow symlinks,
  // so an in-workspace symlink pointing outside would pass a textual check.
  // realpath both sides and compare the canonical paths.
  const root = await fs.realpath(workspaceRoot).catch(() => path.resolve(workspaceRoot))
  const requested = path.resolve(root, sub)
  let target
  try {
    target = await fs.realpath(requested)
  } catch {
    return { success: false, error: `list_files: not found: ${sub || '.'}` }
  }
  if (target !== root && !target.startsWith(root + path.sep)) {
    return { success: false, error: `list_files: path escapes the workspace: ${sub}` }
  }

  let stat
  try {
    stat = await fs.stat(target)
  } catch {
    return { success: false, error: `list_files: not found: ${sub || '.'}` }
  }
  if (!stat.isDirectory()) {
    return {
      success: true,
      output: `${path.relative(root, target) || '.'} — ${formatBytes(stat.size)} (file)`
    }
  }

  const lines = [`## ${path.relative(root, target) || 'workspace root'}`, '']
  let count = 0
  let truncated = false

  async function walk(dir, level, prefix) {
    if (level > depth || count >= LIST_MAX_ENTRIES) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const e of entries) {
      if (e.name === '.DS_Store') continue
      if (count >= LIST_MAX_ENTRIES) {
        truncated = true
        return
      }
      const full = path.join(dir, e.name)
      // Symlinks are listed but never followed — a link could point outside the
      // workspace, and following it (recursing or stat-ing the target) would
      // leak out-of-tree contents/sizes past the confinement check above.
      if (e.isSymbolicLink()) {
        if (pattern && !e.name.toLowerCase().includes(pattern)) continue
        lines.push(`${prefix}${e.name} -> (symlink, not followed)`)
        count += 1
      } else if (e.isDirectory()) {
        lines.push(`${prefix}${e.name}/`)
        count += 1
        await walk(full, level + 1, prefix + '  ')
      } else {
        if (pattern && !e.name.toLowerCase().includes(pattern)) continue
        let size = ''
        try {
          // lstat (not stat) so a regular entry reports its own size and we
          // never dereference anything unexpected.
          size = ` (${formatBytes((await fs.lstat(full)).size)})`
        } catch {
          // size optional
        }
        lines.push(`${prefix}${e.name}${size}`)
        count += 1
      }
    }
  }

  await walk(target, 1, '- ')
  if (truncated)
    lines.push(
      `\n(listing capped at ${LIST_MAX_ENTRIES} entries — narrow with \`dir\` or \`pattern\`.)`
    )
  if (count === 0) lines.push(pattern ? `(no files matching "${pattern}")` : '(empty)')
  return { success: true, output: lines.join('\n') }
}

async function safeReaddir(dir) {
  try {
    return await fs.readdir(dir)
  } catch {
    return []
  }
}

function oneLine(text) {
  return String(text).replace(/\s+/g, ' ').trim()
}

function truncate(text, max) {
  const s = String(text)
  if (s.length <= max) return s
  return `${s.slice(0, max - 1).trimEnd()}…`
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
      case 'wolffish_recall':
        return recall(args ?? {})
      case 'wolffish_list_files':
        return listFiles(args ?? {})
      default:
        return { success: false, error: `introspect: unknown tool ${toolName}` }
    }
  }
}

export default plugin
