import fs from 'node:fs/promises'
import path from 'node:path'

const FETCH_TIMEOUT_MS = 15_000

let pluginDir = ''
let workspaceRoot = ''
let cacheDir = ''

// Holds the markdown for the most recently generated image so that
// add_to_chat can inject it without the model needing to copy any URL.
let pendingContent = ''

function readConfigSync() {
  const configPath = path.join(workspaceRoot, 'config.json')
  return fs.readFile(configPath, 'utf8').then((raw) => JSON.parse(raw)).catch(() => ({}))
}

async function ensureCacheDir() {
  await fs.mkdir(cacheDir, { recursive: true })
}

function encodeMemgenLine(text) {
  return text
    .replace(/_/g, '__')
    .replace(/-/g, '--')
    .replace(/\?/g, '~q')
    .replace(/#/g, '~h')
    .replace(/"/g, "''")
    .replace(/%/g, '~p')
    .replace(/\//g, '~s')
    .replace(/\s/g, '_')
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    return response
  } finally {
    clearTimeout(timer)
  }
}

async function downloadImage(url, filename) {
  await ensureCacheDir()
  const response = await fetchWithTimeout(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} downloading image`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  const filePath = path.join(cacheDir, filename)
  await fs.writeFile(filePath, buffer)
  return filePath
}

async function memeGenerate(args) {
  const templateId = String(args?.template_id ?? 'fry')
  const lines = Array.isArray(args?.lines) ? args.lines.map(String) : ['', '']
  const provider = String(args?.provider ?? 'memegen')

  if (provider === 'imgflip') {
    return memeGenerateImgflip(templateId, lines)
  }

  const encodedLines = lines.map(encodeMemgenLine)
  const linePath = encodedLines.join('/') || '_'
  const url = `https://api.memegen.link/images/${templateId}/${linePath}.png`

  try {
    const filename = `${templateId}-${Date.now()}.png`
    const filePath = await downloadImage(url, filename)
    const relativePath = path.relative(workspaceRoot, filePath)
    const md = `![${templateId} meme](wolffish-media://${relativePath})`
    pendingContent = md
    return { success: true, output: md }
  } catch (err) {
    return { success: false, error: `Failed to generate meme: ${err?.message ?? err}` }
  }
}

async function memeGenerateImgflip(templateId, lines) {
  const config = await readConfigSync()
  const imgflip = config?.memes?.imgflip
  if (!imgflip?.username || !imgflip?.password) {
    return {
      success: false,
      error: 'Imgflip credentials not configured. Go to Settings → Services → Memes to set them up.'
    }
  }

  const body = new URLSearchParams({
    template_id: templateId,
    username: imgflip.username,
    password: imgflip.password
  })

  if (lines.length <= 2) {
    body.set('text0', lines[0] ?? '')
    body.set('text1', lines[1] ?? '')
  } else {
    lines.forEach((line, i) => {
      body.set(`boxes[${i}][text]`, line)
    })
  }

  try {
    const response = await fetchWithTimeout('https://api.imgflip.com/caption_image', {
      method: 'POST',
      body
    })
    if (!response.ok) {
      return { success: false, error: `Imgflip API returned HTTP ${response.status}` }
    }
    const json = await response.json()
    if (!json.success) {
      return { success: false, error: `Imgflip error: ${json.error_message ?? 'unknown'}` }
    }
    const imageUrl = json.data.url
    const filename = `imgflip-${templateId}-${Date.now()}.png`
    const filePath = await downloadImage(imageUrl, filename)
    const relativePath = path.relative(workspaceRoot, filePath)
    const md = `![${templateId} meme](wolffish-media://${relativePath})`
    pendingContent = md
    return { success: true, output: md }
  } catch (err) {
    return { success: false, error: `Imgflip generation failed: ${err?.message ?? err}` }
  }
}

async function memeTemplates(args) {
  const provider = String(args?.provider ?? 'memegen')
  const query = args?.query ? String(args.query).toLowerCase() : null

  try {
    if (provider === 'imgflip') {
      const response = await fetchWithTimeout('https://api.imgflip.com/get_memes')
      if (!response.ok) {
        return { success: false, error: `Imgflip API returned HTTP ${response.status}` }
      }
      const json = await response.json()
      let memes = json.data?.memes ?? []
      if (query) {
        memes = memes.filter((m) => m.name.toLowerCase().includes(query))
      }
      const list = memes.slice(0, 50).map((m) => ({
        id: String(m.id),
        name: m.name,
        box_count: m.box_count
      }))
      return { success: true, output: JSON.stringify(list) }
    }

    const response = await fetchWithTimeout('https://api.memegen.link/templates/')
    if (!response.ok) {
      return { success: false, error: `memegen API returned HTTP ${response.status}` }
    }
    const templates = await response.json()
    let list = templates.map((t) => ({
      id: t.id,
      name: t.name,
      box_count: t.lines ?? 2
    }))
    if (query) {
      list = list.filter((t) => t.name.toLowerCase().includes(query))
    }
    return { success: true, output: JSON.stringify(list.slice(0, 50)) }
  } catch (err) {
    return { success: false, error: `Failed to fetch templates: ${err?.message ?? err}` }
  }
}

async function gifSearch(args) {
  const query = String(args?.query ?? '')
  const limit = Math.min(Number(args?.limit) || 3, 10)

  const config = await readConfigSync()
  const apiKey = config?.memes?.giphy?.apiKey
  if (!apiKey) {
    return {
      success: false,
      error: 'Giphy API key not configured. Go to Settings → Services → Memes to set it up.'
    }
  }

  try {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&limit=${limit}&rating=pg-13`
    const response = await fetchWithTimeout(url)
    if (!response.ok) {
      return { success: false, error: `Giphy API returned HTTP ${response.status}` }
    }
    const json = await response.json()
    const lines = []
    for (const gif of json.data ?? []) {
      const gifUrl = gif.images?.downsized?.url ?? gif.images?.original?.url
      if (!gifUrl) continue
      const filename = `gif-${gif.id}-${Date.now()}.gif`
      try {
        const filePath = await downloadImage(gifUrl, filename)
        const relativePath = path.relative(workspaceRoot, filePath)
        lines.push(`![${gif.title}](wolffish-media://${relativePath})`)
      } catch {
        // skip this gif if download fails
      }
    }
    if (lines.length === 0) {
      return { success: false, error: `No GIFs found for "${query}"` }
    }
    const md = lines.join('\n')
    pendingContent = md
    return { success: true, output: md }
  } catch (err) {
    return { success: false, error: `Giphy search failed: ${err?.message ?? err}` }
  }
}

async function gifTrending(args) {
  const limit = Math.min(Number(args?.limit) || 5, 10)

  const config = await readConfigSync()
  const apiKey = config?.memes?.giphy?.apiKey
  if (!apiKey) {
    return {
      success: false,
      error: 'Giphy API key not configured. Go to Settings → Services → Memes to set it up.'
    }
  }

  try {
    const url = `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(apiKey)}&limit=${limit}&rating=pg-13`
    const response = await fetchWithTimeout(url)
    if (!response.ok) {
      return { success: false, error: `Giphy API returned HTTP ${response.status}` }
    }
    const json = await response.json()
    const lines = []
    for (const gif of json.data ?? []) {
      const gifUrl = gif.images?.downsized?.url ?? gif.images?.original?.url
      if (!gifUrl) continue
      const filename = `gif-${gif.id}-${Date.now()}.gif`
      try {
        const filePath = await downloadImage(gifUrl, filename)
        const relativePath = path.relative(workspaceRoot, filePath)
        lines.push(`![${gif.title}](wolffish-media://${relativePath})`)
      } catch {
        // skip
      }
    }
    if (lines.length === 0) {
      return { success: false, error: 'No trending GIFs available' }
    }
    const md = lines.join('\n')
    pendingContent = md
    return { success: true, output: md }
  } catch (err) {
    return { success: false, error: `Giphy trending failed: ${err?.message ?? err}` }
  }
}

function addToChat() {
  const content = pendingContent
  pendingContent = ''
  if (!content) return { success: false, error: 'No image to add — call meme_generate or gif_search first' }
  return { success: true, output: content }
}

const toolDefinitions = [
  {
    name: 'add_to_chat',
    description:
      'Insert the most recently generated meme or GIF into the chat message so it renders inline. Always call this after meme_generate, gif_search, or gif_trending.',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'meme_generate',
    description: 'Generate a captioned meme image using a template.',
    parameters: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'Template key (e.g. drake, fry, buzz)' },
        lines: {
          type: 'array',
          items: { type: 'string' },
          description: 'Caption text for each box'
        },
        provider: {
          type: 'string',
          enum: ['memegen', 'imgflip'],
          description: 'Which API to use (default: memegen)'
        }
      },
      required: ['template_id', 'lines']
    }
  },
  {
    name: 'meme_templates',
    description: 'List available meme templates, optionally filtered by name.',
    parameters: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['memegen', 'imgflip'],
          description: 'Which API to query (default: memegen)'
        },
        query: { type: 'string', description: 'Filter templates by name' }
      },
      required: []
    }
  },
  {
    name: 'gif_search',
    description: 'Search Giphy for a GIF by keyword.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for' },
        limit: { type: 'number', description: 'Max results (default 3)' }
      },
      required: ['query']
    }
  },
  {
    name: 'gif_trending',
    description: 'Get trending GIFs from Giphy.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 5)' }
      },
      required: []
    }
  }
]

const plugin = {
  name: 'memes',
  tools: toolDefinitions,
  async init(context) {
    pluginDir = context.pluginDir
    workspaceRoot = context.workspaceRoot
    // Store generated media in uploads/memes/ so it persists alongside user
    // uploads, passes the upload:download security check, and survives
    // capability re-syncs (the capability plugin/ dir is force-overwritten
    // on each launch; uploads/ is never touched by the sync).
    cacheDir = path.join(workspaceRoot, 'uploads', 'memes')
    await ensureCacheDir()
  },
  async execute(toolName, args) {
    switch (toolName) {
      case 'add_to_chat':
        return addToChat()
      case 'meme_generate':
        return memeGenerate(args)
      case 'meme_templates':
        return memeTemplates(args)
      case 'gif_search':
        return gifSearch(args)
      case 'gif_trending':
        return gifTrending(args)
      default:
        return { success: false, error: `memes: unknown tool ${toolName}` }
    }
  }
}

export default plugin
