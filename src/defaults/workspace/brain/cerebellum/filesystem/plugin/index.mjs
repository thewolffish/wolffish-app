import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'

const MAX_READ_BYTES = 200_000

const toolDefinitions = [
  {
    name: 'file_read',
    description: 'Read a text file, optionally restricted to a line range.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path or ~ prefix' },
        startLine: { type: 'number', description: '1-based first line' },
        endLine: { type: 'number', description: '1-based last line' }
      },
      required: ['path']
    }
  },
  {
    name: 'file_write',
    description: 'Create or overwrite a text file. mode=append appends instead.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path or ~ prefix' },
        content: { type: 'string', description: 'Text to write' },
        mode: { type: 'string', enum: ['overwrite', 'append'] }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'file_patch',
    description: 'Find a literal string in a file and replace every occurrence.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path or ~ prefix' },
        find: { type: 'string', description: 'Literal text to search for' },
        replace: { type: 'string', description: 'Replacement text' }
      },
      required: ['path', 'find', 'replace']
    }
  }
]

function resolveUserPath(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('path is required')
  }
  if (input === '~') return homedir()
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(homedir(), input.slice(2))
  }
  return path.resolve(input)
}

async function readFile(args) {
  const target = resolveUserPath(args?.path)
  try {
    await fs.access(target)
  } catch {
    // Auto-list parent directory so the LLM can self-correct without a second call
    const parentDir = path.dirname(target)
    let hint = ''
    try {
      const entries = await fs.readdir(parentDir)
      hint = entries.length > 0
        ? `\nParent directory ${parentDir} contains: ${entries.join(', ')}`
        : `\nParent directory ${parentDir} exists but is empty.`
    } catch {
      hint = `\nParent directory ${parentDir} also does not exist.`
    }
    return { success: false, error: `ENOENT: ${target} not found.${hint}` }
  }
  let content
  try {
    content = await fs.readFile(target, 'utf8')
  } catch (err) {
    return { success: false, error: err?.message ?? String(err) }
  }
  if (content.length > MAX_READ_BYTES) {
    content =
      content.slice(0, MAX_READ_BYTES) +
      `\n…[truncated ${content.length - MAX_READ_BYTES} bytes]`
  }
  const startLine = typeof args?.startLine === 'number' ? args.startLine : null
  const endLine = typeof args?.endLine === 'number' ? args.endLine : null
  if (startLine === null && endLine === null) {
    return { success: true, output: content }
  }
  const lines = content.split('\n')
  const start = Math.max(0, (startLine ?? 1) - 1)
  const end = Math.min(lines.length, endLine ?? lines.length)
  const slice = lines.slice(start, end).join('\n')
  return {
    success: true,
    output: `// ${target}:${start + 1}-${end}\n${slice}`
  }
}

async function writeFile(args) {
  const target = resolveUserPath(args?.path)
  const content = typeof args?.content === 'string' ? args.content : ''
  const mode = args?.mode === 'append' ? 'append' : 'overwrite'
  try {
    await fs.mkdir(path.dirname(target), { recursive: true })
    if (mode === 'append') {
      await fs.appendFile(target, content, 'utf8')
    } else {
      await fs.writeFile(target, content, 'utf8')
    }
    return {
      success: true,
      output: `${mode === 'append' ? 'Appended' : 'Wrote'} ${content.length} bytes to ${target}`
    }
  } catch (err) {
    return { success: false, error: err?.message ?? String(err) }
  }
}

async function patchFile(args) {
  const target = resolveUserPath(args?.path)
  const find = typeof args?.find === 'string' ? args.find : ''
  const replace = typeof args?.replace === 'string' ? args.replace : ''
  if (find.length === 0) {
    return { success: false, error: 'find is required and must be non-empty' }
  }
  let content
  try {
    content = await fs.readFile(target, 'utf8')
  } catch (err) {
    return { success: false, error: err?.message ?? String(err) }
  }
  const parts = content.split(find)
  const occurrences = parts.length - 1
  if (occurrences === 0) {
    return { success: false, error: `Pattern not found in ${target}` }
  }
  const updated = parts.join(replace)
  try {
    await fs.writeFile(target, updated, 'utf8')
  } catch (err) {
    return { success: false, error: err?.message ?? String(err) }
  }
  return {
    success: true,
    output: `Replaced ${occurrences} occurrence(s) in ${target}`
  }
}

function describeAction(toolName, args) {
  const targetPath = String(args?.path ?? '')
  if (toolName === 'file_read') {
    const range =
      typeof args?.startLine === 'number' || typeof args?.endLine === 'number'
        ? ` (lines ${args?.startLine ?? 1}-${args?.endLine ?? 'end'})`
        : ''
    return {
      title: 'Read file',
      description: `Read ${targetPath}${range}`,
      risk: 'low'
    }
  }
  if (toolName === 'file_write') {
    const mode = args?.mode === 'append' ? 'Append to' : 'Write'
    const bytes = typeof args?.content === 'string' ? args.content.length : 0
    return {
      title: `${mode} file`,
      description: `${mode} ${bytes} bytes to ${targetPath}`,
      command: targetPath,
      impact: args?.mode === 'append' ? undefined : 'Overwrites the file if it exists.',
      risk: 'medium'
    }
  }
  if (toolName === 'file_patch') {
    return {
      title: 'Patch file',
      description: `Find-and-replace in ${targetPath}`,
      command: targetPath,
      risk: 'medium'
    }
  }
  return null
}

const plugin = {
  name: 'filesystem',
  tools: toolDefinitions,
  describeAction,
  async execute(toolName, args) {
    switch (toolName) {
      case 'file_read':
        return readFile(args)
      case 'file_write':
        return writeFile(args)
      case 'file_patch':
        return patchFile(args)
      default:
        return { success: false, error: `filesystem: unknown tool ${toolName}` }
    }
  }
}

export default plugin
