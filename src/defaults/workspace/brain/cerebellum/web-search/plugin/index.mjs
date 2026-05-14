import * as cheerio from 'cheerio'
import fs from 'node:fs/promises'
import path from 'node:path'

const FETCH_TIMEOUT_MS = 10_000
const SEARCH_TIMEOUT_MS = 8_000
const DEFAULT_MAX_RESULTS = 5
const MAX_RESULTS_CAP = 10
const DEFAULT_MAX_LENGTH = 15_000
const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'

// Workspace root captured at init() so we can read the live brave config
// on every search. Re-reading on each call (instead of caching) means
// users see config changes take effect without restarting the app.
let workspaceRoot = null

// Real browser UA — DDG rate-limits requests with bot-looking UAs.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const PRIVATE_IP_RE =
  /^https?:\/\/(127\.\d+\.\d+\.\d+|localhost|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\]|.*\.local)(:\d+)?(\/|$)/i

const toolDefinitions = [
  {
    name: 'web_search',
    description: 'Search the web for information. Returns titles, snippets, and URLs.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default 5, max 10)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'web_fetch',
    description:
      'Fetch and read the full text content of a web page. Use after web_search to read a specific result in detail.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL of the web page to fetch' },
        maxLength: {
          type: 'number',
          description: 'Maximum characters to return (default 15000)'
        }
      },
      required: ['url']
    }
  }
]

// Helpers

// DDG wraps outbound URLs in /l/?uddg=<encoded>. Unwrap them so callers get
// the real destination, not the redirector.
function unwrapDdgUrl(url) {
  if (!url) return url
  const m = url.match(/[?&]uddg=([^&]+)/)
  if (m) {
    try {
      return decodeURIComponent(m[1])
    } catch {
      return url
    }
  }
  if (url.startsWith('//')) return `https:${url}`
  return url
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Search providers — both scrape DuckDuckGo via different endpoints. They are
// independent CDNs/hosts, so rate-limiting one rarely affects the other.

const PROVIDERS = [
  {
    name: 'duckduckgo-html',
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse: ($, max) => {
      const results = []
      $('.result, .web-result').each((_, el) => {
        if (results.length >= max) return
        const $el = $(el)
        const $a = $el.find('.result__title a, h2 a').first()
        const title = $a.text().trim()
        const url = unwrapDdgUrl($a.attr('href') || '')
        const snippet = $el.find('.result__snippet').text().trim()
        if (title && /^https?:/i.test(url)) results.push({ title, snippet, url })
      })
      return results
    }
  },
  {
    name: 'duckduckgo-lite',
    url: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
    parse: ($, max) => {
      const results = []
      $('a.result-link').each((_, el) => {
        if (results.length >= max) return
        const $el = $(el)
        const title = $el.text().trim()
        const url = unwrapDdgUrl($el.attr('href') || '')
        const snippet = $el
          .closest('tr')
          .nextAll('tr')
          .find('.result-snippet')
          .first()
          .text()
          .trim()
        if (title && /^https?:/i.test(url)) results.push({ title, snippet, url })
      })
      return results
    }
  }
]

async function runProvider(provider, query, maxResults) {
  const res = await fetchWithTimeout(
    provider.url(query),
    {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    },
    SEARCH_TIMEOUT_MS
  )
  if (!res.ok) throw new Error(`${provider.name} returned HTTP ${res.status}`)
  const html = await res.text()
  if (/anomaly|unusual traffic|rate limit/i.test(html)) {
    throw new Error(`${provider.name} rate-limited (anomaly detected)`)
  }
  return provider.parse(cheerio.load(html), maxResults)
}

// Brave Search — used when the user has enabled it and supplied a key in
// the settings panel. Falls through to DDG providers on any failure.
async function searchBrave(apiKey, query, maxResults) {
  const url = `${BRAVE_SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}&count=${maxResults}`
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey
      }
    },
    SEARCH_TIMEOUT_MS
  )
  if (res.status === 401 || res.status === 403) {
    throw new Error('brave: invalid API key')
  }
  if (res.status === 429) throw new Error('brave: rate limited')
  if (!res.ok) throw new Error(`brave: HTTP ${res.status}`)
  const json = await res.json()
  const raw = Array.isArray(json?.web?.results) ? json.web.results : []
  return raw
    .slice(0, maxResults)
    .map((r) => ({
      title: r.title ?? '',
      snippet: r.description ?? '',
      url: r.url ?? ''
    }))
    .filter((r) => r.title && /^https?:/i.test(r.url))
}

// Read brave config from <workspaceRoot>/config.json. Returns null when
// disabled, key is empty, or anything goes wrong reading the file —
// callers fall through to the DDG providers in that case.
async function readBraveConfig() {
  if (!workspaceRoot) return null
  try {
    const raw = await fs.readFile(path.join(workspaceRoot, 'config.json'), 'utf8')
    const cfg = JSON.parse(raw)
    const brave = cfg?.brave
    if (!brave?.enabled) return null
    const apiKey = String(brave.apiKey ?? '').trim()
    if (!apiKey) return null
    return { apiKey }
  } catch {
    return null
  }
}

// Brave usage tracking — appends one line per successful query to the
// workspace usage directory so the Usage panel can show search cost.
async function recordBraveUsage(query) {
  if (!workspaceRoot) return
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const date = `${yyyy}-${mm}-${dd}`
  const time = `${hh}:${mi}:${ss}`

  const dir = path.join(workspaceRoot, 'usage', 'providers')
  const filepath = path.join(dir, 'brave.md')

  const safe = query.replace(/[|\n\r]/g, ' ').slice(0, 120)
  const line = `- ${date} ${time} | web_search | ${safe}\n`

  try {
    await fs.mkdir(dir, { recursive: true })
  } catch { return }

  let existing = ''
  try { existing = await fs.readFile(filepath, 'utf8') } catch { existing = '' }

  const dateHeader = `## ${date}`
  if (!existing.includes(dateHeader)) {
    const body = existing.length === 0
      ? `# Brave Search\n\n${dateHeader}\n\n${line}`
      : `\n${dateHeader}\n\n${line}`
    try { await fs.appendFile(filepath, body, 'utf8') } catch { return }
  } else {
    try { await fs.appendFile(filepath, line, 'utf8') } catch { return }
  }
}

// web_search

async function executeSearch(args) {
  const query = String(args?.query ?? '').trim()
  if (!query) return { success: false, error: 'empty search query' }

  const maxResults = Math.min(
    Math.max(1, Math.round(Number(args?.maxResults) || DEFAULT_MAX_RESULTS)),
    MAX_RESULTS_CAP
  )

  let results
  let provider
  const errors = []

  // Try Brave first when the user has enabled it. On any failure, fall
  // through to the DDG providers — surface the brave error so the user
  // can debug their key but still return useful results.
  const brave = await readBraveConfig()
  if (brave) {
    try {
      results = await searchBrave(brave.apiKey, query, maxResults)
      provider = 'brave'
      void recordBraveUsage(query)
    } catch (err) {
      errors.push(`brave: ${err?.message ?? err}`)
    }
  }

  if (!provider) {
    for (const p of PROVIDERS) {
      try {
        results = await runProvider(p, query, maxResults)
        provider = p.name
        break
      } catch (err) {
        errors.push(`${p.name}: ${err?.message ?? err}`)
      }
    }
  }

  if (!provider) {
    return {
      success: false,
      error: `All search providers failed.\n${errors.join('\n')}\nTry a different query or wait 30 seconds before retrying.`
    }
  }

  if (!results || results.length === 0) {
    return {
      success: true,
      output: JSON.stringify({
        provider,
        results: [],
        message: 'No results found. Try a different or more specific query.'
      })
    }
  }

  return { success: true, output: JSON.stringify({ provider, results }) }
}

// web_fetch

const HEADING_PREFIX = { h1: '# ', h2: '## ', h3: '### ', h4: '#### ', h5: '##### ', h6: '###### ' }

function extractContent($) {
  $('script, style, nav, footer, header, aside, iframe, noscript, svg').remove()
  let root = $('article').first()
  if (!root.length) root = $('main').first()
  if (!root.length) root = $('body')

  const lines = []
  root.find('h1, h2, h3, h4, h5, h6, p, li, td, th, pre, code, blockquote').each((_, el) => {
    const tag = el.tagName?.toLowerCase()
    let text = $(el).text().trim()
    if (!text) return
    if (HEADING_PREFIX[tag]) text = HEADING_PREFIX[tag] + text
    else if (tag === 'li') text = `- ${text}`
    else if (tag === 'blockquote') text = `> ${text}`
    else if (tag === 'pre' || tag === 'code') text = `\`\`\`\n${text}\n\`\`\``
    lines.push(text)
  })
  return lines.join('\n\n')
}

async function executeFetch(args) {
  const url = String(args?.url ?? '').trim()
  if (!url) return { success: false, error: 'empty URL' }

  if (!/^https?:\/\//i.test(url)) {
    return { success: false, error: 'URL must start with http:// or https://' }
  }
  if (PRIVATE_IP_RE.test(url)) {
    return { success: false, error: 'Blocked: cannot fetch private/local network addresses' }
  }

  const maxLength = Math.max(1000, Number(args?.maxLength) || DEFAULT_MAX_LENGTH)

  let response
  try {
    response = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        redirect: 'follow'
      },
      FETCH_TIMEOUT_MS
    )
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { success: false, error: `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s` }
    }
    return { success: false, error: `Fetch failed: ${err?.message ?? err}` }
  }

  if (!response.ok) {
    return { success: false, error: `HTTP ${response.status}: ${response.statusText}` }
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase()

  if (
    contentType.startsWith('image/') ||
    contentType.startsWith('audio/') ||
    contentType.startsWith('video/') ||
    contentType.startsWith('application/octet-stream') ||
    contentType.startsWith('application/zip') ||
    contentType.startsWith('application/pdf')
  ) {
    return { success: false, error: `Cannot read binary content (Content-Type: ${contentType})` }
  }

  let text
  try {
    const buffer = await response.arrayBuffer()
    const charsetMatch = contentType.match(/charset=([^\s;]+)/i)
    const charset = charsetMatch ? charsetMatch[1] : 'utf-8'
    text = new TextDecoder(charset).decode(buffer)
  } catch (err) {
    return { success: false, error: `Failed to decode response: ${err?.message ?? err}` }
  }

  if (!contentType.includes('html')) {
    const truncated = text.slice(0, maxLength)
    if (!truncated.trim()) return { success: true, output: '(Page returned no readable content)' }
    return { success: true, output: truncated }
  }

  const $ = cheerio.load(text)
  let content = extractContent($)
  content = content.replace(/\n{3,}/g, '\n\n').trim()

  if (!content) return { success: true, output: '(Page returned no readable content)' }
  return { success: true, output: content.slice(0, maxLength) }
}

// Plugin export

export default {
  name: 'web-search',
  tools: toolDefinitions,

  async init(context) {
    workspaceRoot = context?.workspaceRoot ?? null
  },

  describeAction(toolName, args) {
    if (toolName === 'web_search') {
      return {
        title: 'Web search',
        description: `Search for: ${args?.query ?? '(empty)'}`,
        risk: 'low'
      }
    }
    if (toolName === 'web_fetch') {
      return {
        title: 'Fetch web page',
        description: `Read: ${args?.url ?? '(empty)'}`,
        risk: 'low'
      }
    }
    return null
  },

  async execute(toolName, args) {
    if (toolName === 'web_search') return executeSearch(args)
    if (toolName === 'web_fetch') return executeFetch(args)
    return { success: false, error: `web-search: unknown tool ${toolName}` }
  }
}
