import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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

async function getStatus() {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free
  const ramRatio = total > 0 ? used / total : 0

  let diskFree = null
  try {
    const stats = await fs.statfs(workspaceRoot || os.homedir())
    diskFree = stats.bavail * stats.bsize
  } catch {
    diskFree = null
  }

  const cortexDbSize = await fileSize(path.join(workspaceRoot, 'brain', 'cortex.db'))
  const capabilities = await listCapabilities()
  const providers = await readProviders()
  const uptimeSec = Math.floor(process.uptime())

  const lines = ['## Wolffish Status', '']
  lines.push(`- **Uptime:** ${formatUptime(uptimeSec)}`)
  if (providers.active) {
    lines.push(`- **Provider:** ${providers.active.id} / ${providers.active.model}`)
  } else {
    lines.push('- **Provider:** none configured')
  }
  if (providers.fallback) {
    lines.push(`- **Fallback:** ${providers.fallback.id} / ${providers.fallback.model}`)
  }
  const capList = capabilities.length === 0 ? 'none' : capabilities.join(', ')
  lines.push(`- **Capabilities:** ${capList} (${capabilities.length} loaded)`)
  if (total > 0) {
    lines.push(
      `- **RAM:** ${formatBytes(used)} / ${formatBytes(total)} (${formatPercent(ramRatio)})`
    )
  }
  if (diskFree !== null) {
    lines.push(`- **Disk:** ${formatBytes(diskFree)} free`)
  }
  if (cortexDbSize !== null) {
    lines.push(`- **cortex.db:** ${formatBytes(cortexDbSize)}`)
  }
  lines.push(`- **Platform:** ${process.platform} ${process.arch}`)

  return { success: true, output: lines.join('\n') }
}

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

async function readProviders() {
  const configPath = path.join(workspaceRoot, 'config.json')
  let raw
  try {
    raw = await fs.readFile(configPath, 'utf8')
  } catch {
    return { active: null, fallback: null }
  }
  let cfg
  try {
    cfg = JSON.parse(raw)
  } catch {
    return { active: null, fallback: null }
  }
  const cloud = Array.isArray(cfg?.llm?.providers) ? cfg.llm.providers : []
  const local = cfg?.llm?.local
  const ordered = []
  const anthropic = cloud.find((p) => p?.id === 'anthropic' && p.apiKey && p.model)
  const openai = cloud.find((p) => p?.id === 'openai' && p.apiKey && p.model)
  if (anthropic) ordered.push({ id: 'anthropic', model: anthropic.model })
  if (openai) ordered.push({ id: 'openai', model: openai.model })
  if (local?.model) ordered.push({ id: 'local', model: local.model })
  return {
    active: ordered[0] ?? null,
    fallback: ordered[1] ?? null
  }
}

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
