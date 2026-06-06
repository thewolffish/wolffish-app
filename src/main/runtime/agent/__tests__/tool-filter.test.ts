export {}

/**
 * Tool filtering logic tests — 30 scenarios validating that the right
 * capabilities are selected when the tool limit is lower than total tools.
 *
 * Run: npx tsx src/main/runtime/__tests__/tool-filter.test.ts
 *
 * The test harness is self-contained: it re-implements the scoring and
 * filtering algorithm from agent.ts / ras.ts so the tests can run without
 * Electron. If the algorithm changes, update the mirror here.
 */

// ---------------------------------------------------------------------------
// Mirror of RAS.scoreRelevance + tokenize (from ras.ts)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'can',
  'may',
  'might',
  'this',
  'that',
  'it',
  'i',
  'you',
  'we',
  'they',
  'my',
  'your',
  'our',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'from'
])

function tokenize(message: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const tokens = message
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
  for (const t of tokens) {
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function scoreRelevance(message: string, content: string): number {
  const keywords = tokenize(message)
  if (keywords.length === 0) return 0
  const haystack = content.toLowerCase()
  let hits = 0
  for (const kw of keywords) {
    if (haystack.includes(kw)) hits++
  }
  return hits / keywords.length
}

// ---------------------------------------------------------------------------
// Capability / tool definitions (mirrors real SKILL.md data)
// ---------------------------------------------------------------------------

type Tool = { name: string; description: string }
type Cap = { name: string; description: string; keywords: string[]; tools: Tool[] }

const CAPABILITIES: Cap[] = [
  {
    name: 'filesystem',
    description: 'Read, write, and edit files on the local system',
    keywords: [
      'file',
      'files',
      'read',
      'write',
      'edit',
      'create',
      'save',
      'open',
      'patch',
      'modify',
      'content',
      'folder',
      'directory',
      'rename',
      'move',
      'copy',
      'delete',
      'remove',
      'path',
      'text',
      'overwrite',
      'append',
      'list files',
      'show file',
      'update file',
      'change file',
      "what's in",
      'replace',
      'find and replace',
      'look at',
      'check file',
      'config',
      'configuration',
      'log',
      'document',
      'txt',
      'json',
      'yaml',
      'yml',
      'xml',
      'env',
      'dotfile',
      'gitignore',
      'readme',
      'makefile'
    ],
    tools: [
      { name: 'file_read', description: "Read a file's text contents" },
      { name: 'file_write', description: 'Create or overwrite a text file' },
      {
        name: 'file_patch',
        description: 'Find a literal string in a file and replace every occurrence'
      }
    ]
  },
  {
    name: 'shell',
    description: 'Execute shell commands on the local system',
    keywords: [
      'run',
      'execute',
      'command',
      'terminal',
      'shell',
      'bash',
      'npm',
      'npx',
      'git',
      'pip',
      'docker',
      'brew',
      'curl',
      'wget',
      'zsh',
      'powershell',
      'cmd',
      'script',
      'process',
      'grep',
      'find',
      'ls',
      'mkdir',
      'chmod',
      'sudo',
      'ssh',
      'tar',
      'zip',
      'unzip',
      'python',
      'java',
      'go',
      'cargo',
      'yarn',
      'pnpm',
      'make',
      'cmake',
      'install',
      'compile',
      'build',
      'deploy',
      'test',
      'debug',
      'output',
      'background',
      'kill',
      'dev server',
      'start server',
      'port',
      'localhost'
    ],
    tools: [{ name: 'shell_exec', description: 'Run a shell command and return its output' }]
  },
  {
    name: 'web-search',
    description: 'Search the web and read web pages for current information',
    keywords: [
      'search',
      'google',
      'look up',
      'find online',
      'web',
      'browse',
      'website',
      'url',
      'link',
      'news',
      'latest',
      'current',
      'today',
      'recent',
      'article',
      'documentation',
      'docs',
      'what is',
      'who is',
      'how to',
      'fetch',
      'page',
      'site',
      'research',
      'information',
      'learn about',
      'tell me about',
      'explain',
      'find out',
      'look into',
      'check online',
      'weather',
      'price',
      'stock',
      'score',
      'result',
      'update',
      'trending',
      'wiki',
      'wikipedia',
      'tutorial',
      'guide',
      'reference',
      'manual',
      'blog',
      'forum',
      'stackoverflow',
      'api docs'
    ],
    tools: [
      { name: 'web_search', description: 'Search the web for information' },
      { name: 'web_fetch', description: 'Fetch and read the full text content of a web page' }
    ]
  },
  {
    name: 'google',
    description:
      'Google Workspace integration — Gmail, Drive, Calendar, Contacts, Tasks, and Sheets',
    keywords: [
      'google',
      'gmail',
      'email',
      'inbox',
      'send email',
      'compose email',
      'search email',
      'mark as read',
      'mark read',
      'archive email',
      'trash email',
      'forward email',
      'save draft',
      'delete event',
      'update event',
      'reschedule',
      'complete task',
      'delete task',
      'create contact',
      'add contact',
      'create folder',
      'drive',
      'upload file',
      'download file',
      'list files',
      'google drive',
      'calendar',
      'events',
      'schedule',
      'meeting',
      'appointment',
      'create event',
      'contacts',
      'address book',
      'phone number',
      'tasks',
      'todo',
      'task list',
      'sheets',
      'spreadsheet',
      'google sheets',
      'mail',
      'message',
      'reply',
      'draft',
      'label',
      'unread',
      'starred',
      'attachment',
      'invite',
      'attendee',
      'reminder',
      'due date',
      'workspace',
      'cloud storage',
      'shared drive',
      'my drive',
      'check email',
      'new email',
      'read email',
      'write email',
      'any mail',
      'upcoming',
      'next meeting',
      'free time',
      'busy',
      'availability',
      'add task',
      "what's on my calendar",
      'what meetings'
    ],
    tools: Array.from({ length: 29 }, (_, i) => ({
      name: `google_tool_${i}`,
      description: [
        'gmail search',
        'gmail read',
        'gmail send',
        'gmail labels',
        'gmail mark read',
        'gmail archive',
        'gmail mark unread',
        'gmail trash',
        'gmail forward',
        'gmail draft create',
        'drive list',
        'drive search',
        'drive upload',
        'drive download',
        'drive delete',
        'drive mkdir',
        'calendar events',
        'calendar create',
        'calendar update',
        'calendar delete',
        'contacts search',
        'contacts create',
        'tasks list',
        'tasks add',
        'tasks complete',
        'tasks delete',
        'sheets read',
        'sheets write',
        'accounts'
      ][i]
    }))
  },
  {
    name: 'github',
    description: 'GitHub integration — repos, issues, pull requests, branches, CI/Actions',
    keywords: [
      'github',
      'pull request',
      'PR',
      'issue',
      'repo',
      'repository',
      'branch',
      'merge',
      'CI',
      'actions',
      'workflow',
      'commit history',
      'code review',
      'release',
      'gist',
      'organization',
      'org',
      'collaborator',
      'invite',
      'comment',
      'label',
      'milestone',
      'review',
      'reviewer',
      'notification',
      'star',
      'fork',
      'compare',
      'dispatch',
      'topic',
      'clone',
      'commit',
      'push',
      'deploy',
      'pipeline',
      'build status',
      'check',
      'assignee',
      'assign',
      'tag',
      'version',
      'changelog',
      'open issue',
      'close issue',
      'create issue',
      'list issues',
      'list PRs',
      'merge PR',
      'approve',
      'request changes',
      'dependabot',
      'security',
      'vulnerability',
      'contributor',
      'readme',
      'license',
      'gitignore',
      'webhook',
      'secret',
      'environment',
      'pages',
      'discussion',
      'sponsorship'
    ],
    tools: Array.from({ length: 53 }, (_, i) => ({
      name: `github_tool_${i}`,
      description: `GitHub API operation ${i}`
    }))
  },
  {
    name: 'browser',
    description: 'Automate web browsers — navigate sites, fill forms, click buttons, extract data',
    keywords: [
      'browser',
      'web',
      'website',
      'navigate',
      'login',
      'scrape',
      'screenshot',
      'form',
      'download',
      'cookie',
      'tab',
      'click',
      'url',
      'page',
      'crawl',
      'automate',
      'headless',
      'chromium',
      'firefox',
      'webkit',
      'playwright',
      'site',
      'webpage',
      'link',
      'href',
      'submit',
      'button',
      'input',
      'dropdown',
      'select',
      'checkbox',
      'sign in',
      'sign up',
      'register',
      'fill form',
      'extract data',
      'extract text',
      'table',
      'hover',
      'scroll',
      'keyboard',
      'type',
      'credential',
      'password',
      'open website',
      'go to',
      'visit',
      'browse',
      'surf',
      'html',
      'dom',
      'element',
      'selector',
      'xpath',
      'css selector',
      'network',
      'request',
      'response',
      'pdf',
      'print page',
      'capture',
      'automation',
      'bot',
      'web scraping',
      'data extraction'
    ],
    tools: Array.from({ length: 25 }, (_, i) => ({
      name: `browser_tool_${i}`,
      description: `Browser automation operation ${i}`
    }))
  },
  {
    name: 'browser-extension',
    description: "Control the user's connected Chrome/Brave browser via the Wolffish extension",
    keywords: [
      'browser',
      'extension',
      'chrome',
      'brave',
      'web',
      'navigate',
      'click',
      'tab',
      'screenshot',
      'cookie',
      'page',
      'url',
      'form',
      'download',
      'scrape',
      'open page',
      'go to',
      'visit',
      'site',
      'website',
      'webpage',
      'link',
      'browse',
      'surf',
      'search',
      'fill',
      'submit',
      'button',
      'input',
      'type',
      'scroll',
      'reload',
      'refresh',
      'bookmark',
      'history',
      'javascript',
      'console',
      'inspect',
      'element',
      'selector',
      'dom',
      'html',
      'content',
      'extract',
      'read page',
      'capture',
      'new tab',
      'close tab',
      'switch tab'
    ],
    tools: Array.from({ length: 44 }, (_, i) => ({
      name: `ext_tool_${i}`,
      description: `Browser extension operation ${i}`
    }))
  },
  {
    name: 'computer-use',
    description: 'Desktop automation — take screenshots, move/click mouse, type text, press keys',
    keywords: [
      'screenshot',
      'click',
      'screen',
      'desktop',
      'browser',
      'open app',
      'navigate',
      'scroll',
      'type into',
      'mouse',
      'keyboard',
      "what's on my screen",
      'computer use',
      'automate',
      'UI',
      'display',
      'monitor',
      'window',
      'application',
      'app',
      'cursor',
      'pointer',
      'drag',
      'drop',
      'button',
      'menu',
      'toolbar',
      'icon',
      'taskbar',
      'dock',
      'finder',
      'right click',
      'double click',
      'hotkey',
      'shortcut',
      'press key',
      'enter text',
      'what do you see',
      'show me',
      'look at screen',
      'visual',
      'GUI',
      'interface'
    ],
    tools: Array.from({ length: 8 }, (_, i) => ({
      name: `computer_tool_${i}`,
      description: `Desktop automation operation ${i}`
    }))
  },
  {
    name: 'document',
    description: 'Read, create, modify, convert, and merge documents (docx, html, markdown)',
    keywords: [
      'document',
      'word',
      'docx',
      'report',
      'letter',
      'memo',
      'template',
      'write document',
      'create report',
      'fill template',
      'convert document',
      'markdown to word',
      'word to pdf',
      'table of contents',
      'merge documents',
      'compare documents',
      'extract text',
      'doc',
      'rtf',
      'html',
      'txt',
      'plain text',
      'rich text',
      'formatting',
      'heading',
      'paragraph',
      'header',
      'footer',
      'page number',
      'margin',
      'font',
      'style',
      'image',
      'figure',
      'contract',
      'proposal',
      'invoice',
      'resume',
      'cv',
      'cover letter',
      'manuscript',
      'essay',
      'thesis',
      'paper',
      'article',
      'newsletter',
      'brochure',
      'flyer'
    ],
    tools: Array.from({ length: 10 }, (_, i) => ({
      name: `document_tool_${i}`,
      description: `Document operation ${i}`
    }))
  },
  {
    name: 'spreadsheet',
    description: 'Read, create, modify, analyze, and convert spreadsheet files (xlsx, csv, tsv)',
    keywords: [
      'spreadsheet',
      'excel',
      'xlsx',
      'csv',
      'tsv',
      'table',
      'data',
      'workbook',
      'cells',
      'formula',
      'chart',
      'pivot',
      'analyze data',
      'import csv',
      'export csv',
      'columns',
      'rows',
      'filter data',
      'xls',
      'worksheet',
      'cell',
      'range',
      'sum',
      'average',
      'count',
      'sort',
      'vlookup',
      'calculate',
      'computation',
      'statistics',
      'graph',
      'plot',
      'bar chart',
      'line chart',
      'pie chart',
      'data analysis',
      'report',
      'tabular',
      'matrix',
      'grid',
      'merge cells',
      'split cells',
      'conditional formatting',
      'budget',
      'financial',
      'accounting',
      'invoice',
      'inventory',
      'metrics',
      'dashboard'
    ],
    tools: Array.from({ length: 10 }, (_, i) => ({
      name: `spreadsheet_tool_${i}`,
      description: `Spreadsheet operation ${i}`
    }))
  },
  {
    name: 'pdf',
    description: 'Read, create, modify, merge, split, secure, and compress PDF documents',
    keywords: [
      'pdf',
      'document',
      'merge pdf',
      'split pdf',
      'combine pdf',
      'watermark',
      'form fill',
      'extract text',
      'encrypt pdf',
      'compress pdf',
      'pdf password',
      'read pdf',
      'create pdf',
      'acrobat',
      'portable document',
      'scan',
      'ocr',
      'convert to pdf',
      'save as pdf',
      'print to pdf',
      'sign pdf',
      'annotate',
      'bookmark',
      'page',
      'rotate',
      'crop',
      'stamp',
      'redact',
      'flatten',
      'optimize',
      'reduce size',
      'invoice',
      'receipt',
      'contract',
      'certificate',
      'form',
      'fillable'
    ],
    tools: Array.from({ length: 9 }, (_, i) => ({
      name: `pdf_tool_${i}`,
      description: `PDF operation ${i}`
    }))
  },
  {
    name: 'notion',
    description: 'Read, create, update, and manage Notion pages, databases, and blocks',
    keywords: [
      'notion',
      'workspace',
      'wiki',
      'knowledge base',
      'database',
      'page',
      'note',
      'document',
      'kanban',
      'board',
      'table',
      'task tracker',
      'project management',
      'block',
      'property',
      'relation',
      'rollup',
      'filter',
      'sort',
      'view',
      'gallery',
      'list',
      'timeline',
      'calendar',
      'template',
      'backlink',
      'comment',
      'mention',
      'bookmark',
      'embed',
      'toggle',
      'callout',
      'heading',
      'bullet',
      'checkbox',
      'todo',
      'sprint',
      'roadmap',
      'docs',
      'meeting notes',
      'standup',
      'content'
    ],
    tools: Array.from({ length: 15 }, (_, i) => ({
      name: `notion_tool_${i}`,
      description: `Notion operation ${i}`
    }))
  },
  {
    name: 'memes',
    description: 'Find, generate, and share memes and GIFs',
    keywords: [
      'meme',
      'memes',
      'funny',
      'gif',
      'laugh',
      'humor',
      'joke',
      'lighten',
      'mood',
      'reaction',
      'lol',
      'lmao',
      'haha',
      'cheer up',
      'frustrated',
      'celebrate',
      'hilarious',
      'comedy',
      'rofl',
      'emoji',
      'sticker',
      'drake',
      'distracted boyfriend',
      'this is fine',
      'stonks',
      'doge',
      'pepe',
      'sarcasm',
      'irony',
      'send meme',
      'make meme',
      'create meme',
      'trending',
      'viral',
      'entertainment',
      'fun',
      'bored'
    ],
    tools: Array.from({ length: 5 }, (_, i) => ({
      name: `meme_tool_${i}`,
      description: `Meme operation ${i}`
    }))
  },
  {
    name: 'introspect',
    description: "Check Wolffish's own status, performance, and memory",
    keywords: [
      'status',
      'health',
      'performance',
      'how are you',
      'what do you know',
      'what do you remember',
      'uptime',
      'stats',
      'memory usage',
      'how many',
      'diagnostics',
      'system info',
      'capabilities',
      'loaded',
      'active',
      'running',
      'wolffish',
      'self',
      'about',
      'version',
      'provider',
      'model',
      'configuration',
      'settings',
      'error rate',
      'success rate',
      'tool usage',
      'what can you do',
      'what tools'
    ],
    tools: Array.from({ length: 3 }, (_, i) => ({
      name: `introspect_tool_${i}`,
      description: `Introspection operation ${i}`
    }))
  },
  {
    name: 'speech-to-text',
    description: 'Transcribe audio files into text using OpenAI Whisper',
    keywords: [
      'transcribe',
      'transcription',
      'speech to text',
      'stt',
      'whisper',
      'audio to text',
      'convert audio',
      'what does this say',
      "what's in this audio",
      'listen to this',
      'dictation',
      'voice to text',
      'what did they say',
      'recognize speech',
      'subtitle',
      'subtitles',
      'mp3',
      'wav',
      'm4a',
      'ogg',
      'flac',
      'aac',
      'wma',
      'recording',
      'podcast',
      'interview',
      'meeting recording',
      'voice note',
      'voice message',
      'voicemail',
      'caption',
      'transcript',
      'minutes',
      'speech recognition',
      'language detection',
      'audio file'
    ],
    tools: Array.from({ length: 4 }, (_, i) => ({
      name: `stt_tool_${i}`,
      description: `Speech to text operation ${i}`
    }))
  },
  {
    name: 'text-to-speech',
    description: 'Generate voice memos from text using neural TTS',
    keywords: [
      'voice',
      'speak',
      'say',
      'audio',
      'read aloud',
      'voice memo',
      'tts',
      'text to speech',
      'say this',
      'read this',
      'talk',
      'narrate',
      'spoken',
      'pronounce',
      'recite',
      'announce',
      'dictate',
      'speech',
      'sound',
      'mp3',
      'audio file',
      'voice message',
      'voice note',
      'podcast',
      'audiobook',
      'read out loud',
      'tell me',
      'convert to audio',
      'generate audio',
      'generate voice',
      'synthesize'
    ],
    tools: Array.from({ length: 3 }, (_, i) => ({
      name: `tts_tool_${i}`,
      description: `Text to speech operation ${i}`
    }))
  },
  {
    name: 'ffmpeg',
    description: 'FFmpeg multimedia framework for video/audio processing',
    keywords: [
      'ffmpeg',
      'video',
      'audio',
      'convert',
      'transcode',
      'compress',
      'encode',
      'decode',
      'mp4',
      'mkv',
      'avi',
      'mov',
      'webm',
      'mp3',
      'wav',
      'aac',
      'flac',
      'ogg',
      'trim',
      'cut',
      'clip',
      'merge video',
      'concat',
      'resize video',
      'scale',
      'bitrate',
      'codec',
      'h264',
      'h265',
      'hevc',
      'gif',
      'thumbnail',
      'extract audio',
      'extract frame',
      'subtitle',
      'watermark',
      'rotate',
      'crop',
      'filter',
      'resolution',
      'fps',
      'frame rate',
      'media',
      'multimedia',
      'screen recording',
      'stream'
    ],
    tools: Array.from({ length: 3 }, (_, i) => ({
      name: `ffmpeg_tool_${i}`,
      description: `FFmpeg operation ${i}`
    }))
  },
  {
    name: 'cloudflared',
    description: 'Cloudflare Tunnel CLI for exposing local services',
    keywords: [
      'cloudflare',
      'tunnel',
      'cloudflared',
      'expose',
      'public url',
      'ngrok',
      'localhost tunnel',
      'port forward',
      'share locally',
      'public access',
      'reverse proxy',
      'external access',
      'webhook testing',
      'demo',
      'temporary url',
      'secure tunnel'
    ],
    tools: Array.from({ length: 3 }, (_, i) => ({
      name: `cloudflared_tool_${i}`,
      description: `Cloudflared operation ${i}`
    }))
  },
  {
    name: 'node',
    description: 'Node.js runtime and npm package manager',
    keywords: [
      'node',
      'npm',
      'npx',
      'nvm',
      'javascript',
      'js',
      'typescript',
      'ts',
      'nodejs',
      'react',
      'vue',
      'angular',
      'express',
      'next',
      'vite',
      'webpack',
      'eslint',
      'prettier',
      'jest',
      'vitest',
      'mocha',
      'package.json',
      'node_modules',
      'yarn',
      'pnpm',
      'deno',
      'bun'
    ],
    tools: Array.from({ length: 2 }, (_, i) => ({
      name: `node_tool_${i}`,
      description: `Node operation ${i}`
    }))
  },
  {
    name: 'package-manager',
    description: 'Cross-platform system package manager',
    keywords: [
      'install',
      'package',
      'brew',
      'winget',
      'apt',
      'dependency',
      'homebrew',
      'dnf',
      'yum',
      'pacman',
      'snap',
      'flatpak',
      'choco',
      'chocolatey',
      'uninstall',
      'upgrade',
      'update',
      'software',
      'tool',
      'binary',
      'setup',
      'prerequisite',
      'requirement'
    ],
    tools: Array.from({ length: 3 }, (_, i) => ({
      name: `pkg_tool_${i}`,
      description: `Package manager operation ${i}`
    }))
  }
]

// ---------------------------------------------------------------------------
// Mirror of filterToolsForProvider (from agent.ts)
// ---------------------------------------------------------------------------

type ToolDef = { name: string; description: string; parameters: Record<string, unknown> }

function buildContent(cap: Cap): string {
  return [
    cap.name,
    cap.description,
    ...cap.keywords,
    ...cap.tools.map((t) => t.name + ' ' + t.description)
  ].join(' ')
}

function filterToolsForLimit(
  allTools: ToolDef[],
  message: string,
  limit: number,
  capabilities: Cap[]
): { kept: ToolDef[]; dropped: string[] } {
  if (allTools.length <= limit) {
    return { kept: allTools, dropped: [] }
  }

  const toolToCap = new Map<string, string>()
  for (const cap of capabilities) {
    for (const t of cap.tools) {
      toolToCap.set(t.name, cap.name)
    }
  }

  const capToolMap = new Map<string, ToolDef[]>()
  const orphaned: ToolDef[] = []
  for (const tool of allTools) {
    const capName = toolToCap.get(tool.name)
    if (!capName) {
      orphaned.push(tool)
      continue
    }
    const list = capToolMap.get(capName) ?? []
    list.push(tool)
    capToolMap.set(capName, list)
  }

  const capMap = new Map(capabilities.map((c) => [c.name, c]))

  const scored: Array<{ name: string; score: number; tools: ToolDef[] }> = []
  for (const [capName, capTools] of capToolMap) {
    const cap = capMap.get(capName)
    const content = cap ? buildContent(cap) : capName
    scored.push({ name: capName, score: scoreRelevance(message, content), tools: capTools })
  }

  scored.sort((a, b) => b.score - a.score || a.tools.length - b.tools.length)

  const kept: ToolDef[] = [...orphaned]
  const dropped: string[] = []
  let remaining = limit - orphaned.length

  for (const entry of scored) {
    if (remaining <= 0) {
      dropped.push(entry.name)
      continue
    }
    if (entry.tools.length <= remaining) {
      kept.push(...entry.tools)
      remaining -= entry.tools.length
    } else {
      const toolScored = entry.tools
        .map((t) => ({
          tool: t,
          score: scoreRelevance(message, t.name + ' ' + t.description)
        }))
        .sort((a, b) => b.score - a.score)
      const partial = toolScored.slice(0, remaining)
      kept.push(...partial.map((p) => p.tool))
      remaining -= partial.length
      dropped.push(entry.name + '(partial)')
    }
  }

  return { kept, dropped }
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function buildAllTools(): ToolDef[] {
  const out: ToolDef[] = []
  for (const cap of CAPABILITIES) {
    for (const t of cap.tools) {
      out.push({ name: t.name, description: t.description, parameters: {} })
    }
  }
  return out
}

type TestCase = {
  prompt: string
  mustInclude: string[] // capability names that MUST appear
  mustExclude?: string[] // capability names that must NOT appear
}

const TEST_CASES: TestCase[] = [
  // --- 1. Email / Gmail ---
  {
    prompt: 'Check my email for any unread messages',
    mustInclude: ['google'],
    mustExclude: ['ffmpeg', 'memes', 'computer-use']
  },
  // --- 2. Calendar ---
  {
    prompt: 'What meetings do I have tomorrow?',
    mustInclude: ['google'],
    mustExclude: ['github', 'browser', 'ffmpeg']
  },
  // --- 3. GitHub PR ---
  {
    prompt: 'List my open pull requests on GitHub',
    mustInclude: ['github'],
    mustExclude: ['google', 'memes']
  },
  // --- 4. File editing ---
  {
    prompt: 'Read the config.json file and update the port setting',
    mustInclude: ['filesystem'],
    mustExclude: ['memes', 'ffmpeg']
  },
  // --- 5. Shell command ---
  {
    prompt: 'Run npm install and then start the dev server',
    mustInclude: ['shell'],
    mustExclude: ['memes', 'pdf']
  },
  // --- 6. Web search ---
  {
    prompt: 'Search the web for the latest Python documentation',
    mustInclude: ['web-search'],
    mustExclude: ['ffmpeg', 'memes']
  },
  // --- 7. PDF creation ---
  {
    prompt: 'Create a PDF invoice for the client',
    mustInclude: ['pdf'],
    mustExclude: ['memes', 'ffmpeg']
  },
  // --- 8. Meme generation ---
  {
    prompt: 'Make me a funny meme about debugging',
    mustInclude: ['memes'],
    mustExclude: ['github', 'google']
  },
  // --- 9. Spreadsheet analysis ---
  {
    prompt: 'Open the sales.xlsx spreadsheet and calculate the total revenue',
    mustInclude: ['spreadsheet'],
    mustExclude: ['memes', 'github']
  },
  // --- 10. Video conversion ---
  {
    prompt: 'Convert this MP4 video to a smaller resolution',
    mustInclude: ['ffmpeg'],
    mustExclude: ['google', 'github', 'memes']
  },
  // --- 11. Desktop screenshot ---
  {
    prompt: 'Take a screenshot of my screen',
    mustInclude: ['computer-use'],
    mustExclude: ['google', 'github']
  },
  // --- 12. Notion page ---
  {
    prompt: 'Create a new page in my Notion workspace',
    mustInclude: ['notion'],
    mustExclude: ['ffmpeg', 'memes']
  },
  // --- 13. Audio transcription ---
  {
    prompt: 'Transcribe this meeting recording to text',
    mustInclude: ['speech-to-text'],
    mustExclude: ['github', 'memes']
  },
  // --- 14. Text to speech ---
  {
    prompt: 'Generate a voice memo of this paragraph',
    mustInclude: ['text-to-speech'],
    mustExclude: ['github', 'pdf']
  },
  // --- 15. Tunnel / expose ---
  {
    prompt: 'Expose my localhost port 3000 with a public URL',
    mustInclude: ['cloudflared'],
    mustExclude: ['memes', 'ffmpeg']
  },
  // --- 16. Document (Word) ---
  {
    prompt: 'Create a Word document with a cover letter template',
    mustInclude: ['document'],
    mustExclude: ['ffmpeg', 'memes']
  },
  // --- 17. Browser automation ---
  {
    prompt: 'Open a headless browser and scrape product prices from the website',
    mustInclude: ['browser'],
    mustExclude: ['google', 'memes']
  },
  // --- 18. Git workflow (shell is implied but git/branch keywords
  //     match github more strongly at harsh limits — realistic)
  {
    prompt: 'Run git diff in the terminal and create a new branch',
    mustInclude: ['shell'],
    mustExclude: ['memes', 'ffmpeg']
  },
  // --- 19. Node.js check ---
  {
    prompt: 'Check if Node.js is installed on this system',
    mustInclude: ['node'],
    mustExclude: ['memes', 'ffmpeg']
  },
  // --- 20. Introspect ---
  {
    prompt: 'What tools and capabilities do you have available?',
    mustInclude: ['introspect'],
    mustExclude: ['ffmpeg']
  },
  // --- 21. Multi: email + calendar ---
  {
    prompt: 'Check my unread emails and list upcoming calendar events for this week',
    mustInclude: ['google'],
    mustExclude: ['ffmpeg', 'memes']
  },
  // --- 22. Multi: file + shell ---
  {
    prompt: 'Read the package.json file and then run the build command',
    mustInclude: ['filesystem', 'shell'],
    mustExclude: ['memes']
  },
  // --- 23. Multi: search + browser ---
  {
    prompt: 'Search for React documentation online and open the first result in a browser',
    mustInclude: ['web-search'],
    mustExclude: ['memes', 'ffmpeg']
  },
  // --- 24. GitHub issue ---
  {
    prompt: 'Create a new GitHub issue about the login bug',
    mustInclude: ['github'],
    mustExclude: ['ffmpeg', 'memes']
  },
  // --- 25. Drive upload ---
  {
    prompt: 'Upload the report.pdf file to my Google Drive',
    mustInclude: ['google'],
    mustExclude: ['memes', 'computer-use']
  },
  // --- 26. CSV import ---
  {
    prompt: 'Import the data.csv file and show me the first 10 rows',
    mustInclude: ['spreadsheet'],
    mustExclude: ['memes', 'computer-use']
  },
  // --- 27. Audio extraction ---
  {
    prompt: 'Extract the audio track from this video file',
    mustInclude: ['ffmpeg'],
    mustExclude: ['google', 'memes']
  },
  // --- 28. Merge PDFs ---
  {
    prompt: 'Merge these three PDF files into one document',
    mustInclude: ['pdf'],
    mustExclude: ['memes', 'computer-use']
  },
  // --- 29. Package install ---
  {
    prompt: 'Install ffmpeg using homebrew',
    mustInclude: ['package-manager'],
    mustExclude: ['memes']
  },
  // --- 30. Chrome extension ---
  {
    prompt: 'Use the Chrome extension to navigate to github.com and take a screenshot',
    mustInclude: ['browser-extension'],
    mustExclude: ['memes', 'ffmpeg']
  }
]

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const SIMULATED_LIMIT = 20 // Force harsh filtering — much lower than total tools

function run(): void {
  const allTools = buildAllTools()
  const totalTools = allTools.length
  console.log(`\nTotal tools across all capabilities: ${totalTools}`)
  console.log(`Simulated provider limit: ${SIMULATED_LIMIT}`)
  console.log(`Running ${TEST_CASES.length} test scenarios...\n`)

  let passed = 0
  let failed = 0

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i]
    const { kept } = filterToolsForLimit(allTools, tc.prompt, SIMULATED_LIMIT, CAPABILITIES)

    const keptCapNames = new Set<string>()
    for (const t of kept) {
      for (const cap of CAPABILITIES) {
        if (cap.tools.some((ct) => ct.name === t.name)) {
          keptCapNames.add(cap.name)
        }
      }
    }

    const errors: string[] = []

    for (const must of tc.mustInclude) {
      if (!keptCapNames.has(must)) {
        errors.push(`MISSING required capability: ${must}`)
      }
    }

    for (const exclude of tc.mustExclude ?? []) {
      if (keptCapNames.has(exclude)) {
        errors.push(`UNEXPECTED capability included: ${exclude}`)
      }
    }

    if (kept.length > SIMULATED_LIMIT) {
      errors.push(`OVER LIMIT: kept ${kept.length} tools (limit ${SIMULATED_LIMIT})`)
    }

    const status = errors.length === 0 ? 'PASS' : 'FAIL'
    if (errors.length === 0) {
      passed++
    } else {
      failed++
    }

    const num = String(i + 1).padStart(2, '0')
    console.log(`  ${status === 'PASS' ? '✓' : '✗'} #${num}: "${tc.prompt.slice(0, 60)}..."`)
    if (errors.length > 0) {
      for (const e of errors) {
        console.log(`         ${e}`)
      }
      console.log(`         Kept caps: [${[...keptCapNames].join(', ')}]`)
    }
  }

  console.log(`\n  ${passed}/${TEST_CASES.length} passed, ${failed} failed\n`)

  if (failed > 0) {
    process.exit(1)
  }
}

run()
