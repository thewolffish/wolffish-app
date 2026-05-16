import { execFile, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

// ffmpeg is invoked via spawn (no shell), so the kernel's open() syscall
// sees `~/Desktop/foo.mp4` as a literal filename and ENOENTs. The shell
// would normally expand ~ for us, but we can't pay the shell cost (and
// shell quoting risks) just for tilde. After splitArgs, each element is
// one isolated token — bare `~` or `~/...` at the start of a token is
// unambiguously a path. We don't touch tokens with `~` in the middle
// (e.g. `s/foo~bar/`) since those aren't paths.
function expandTildeArg(arg) {
  if (typeof arg !== 'string' || arg.length === 0) return arg
  if (arg === '~') return homedir()
  if (arg.startsWith('~/') || arg.startsWith('~\\')) {
    return path.join(homedir(), arg.slice(2))
  }
  return arg
}

const MAX_OUTPUT = 100_000

async function which(cmd) {
  try {
    const bin = process.platform === 'win32' ? 'where' : 'which'
    const { stdout } = await execFileP(bin, [cmd])
    return stdout.trim().split('\n')[0].trim() || null
  } catch {
    return null
  }
}

function clampOutput(buf, chunk) {
  if (buf.length >= MAX_OUTPUT) return buf
  return buf + chunk.toString().slice(0, MAX_OUTPUT - buf.length)
}

function splitArgs(str) {
  const args = []
  let current = ''
  let inQuote = false
  let quoteChar = ''

  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (inQuote) {
      if (ch === quoteChar) inQuote = false
      else current += ch
    } else if (ch === '"' || ch === "'") {
      inQuote = true
      quoteChar = ch
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        args.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current) args.push(current)
  return args
}

async function ffmpegCheck() {
  const ffmpegPath = await which('ffmpeg')
  if (!ffmpegPath) {
    return { success: true, output: JSON.stringify({ installed: false, version: '' }) }
  }
  try {
    const { stdout } = await execFileP(ffmpegPath, ['-version'])
    const version = stdout.split('\n')[0] || 'unknown'
    return { success: true, output: JSON.stringify({ installed: true, version }) }
  } catch {
    return { success: true, output: JSON.stringify({ installed: true, version: 'unknown' }) }
  }
}

async function ffmpegInstall() {
  const platform = process.platform
  let cmd, args

  if (platform === 'darwin') {
    const brewPath =
      process.arch === 'arm64' ? '/opt/homebrew/bin/brew' : '/usr/local/bin/brew'
    try {
      await execFileP(brewPath, ['--version'])
      cmd = brewPath
      args = ['install', 'ffmpeg']
    } catch {
      const found = await which('brew')
      if (found) {
        cmd = found
        args = ['install', 'ffmpeg']
      } else {
        return {
          success: false,
          error: 'Homebrew is not installed. Install it first with pkg_install_manager.'
        }
      }
    }
  } else if (platform === 'win32') {
    cmd = 'winget'
    args = [
      'install',
      '--id',
      'Gyan.FFmpeg',
      '-e',
      '--accept-source-agreements',
      '--accept-package-agreements'
    ]
  } else {
    const aptPath = await which('apt')
    if (aptPath) {
      cmd = 'sudo'
      args = ['apt', 'install', '-y', 'ffmpeg']
    } else {
      const dnfPath = await which('dnf')
      if (dnfPath) {
        cmd = 'sudo'
        args = ['dnf', 'install', '-y', 'ffmpeg']
      } else {
        return { success: false, error: 'No supported package manager found (apt or dnf).' }
      }
    }
  }

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (c) => {
      stdout = clampOutput(stdout, c)
    })
    child.stderr?.on('data', (c) => {
      stderr = clampOutput(stderr, c)
    })

    child.on('close', (code) => {
      const output = (stdout + '\n' + stderr).trim()
      if (code === 0) {
        resolve({ success: true, output: output || 'ffmpeg installed successfully' })
      } else {
        resolve({
          success: false,
          error: `Installation failed (exit ${code}): ${output.slice(0, 500)}`
        })
      }
    })

    child.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
}

async function ffmpegRun(args) {
  const rawArgs = String(args?.args ?? '').trim()
  if (!rawArgs) return { success: false, error: 'args is required' }

  const ffmpegPath = await which('ffmpeg')
  if (!ffmpegPath) return { success: false, error: 'ffmpeg is not installed' }

  const ffmpegArgs = splitArgs(rawArgs).map(expandTildeArg)

  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ffmpegArgs, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (c) => {
      stdout = clampOutput(stdout, c)
    })
    child.stderr?.on('data', (c) => {
      stderr = clampOutput(stderr, c)
    })

    child.on('close', (code) => {
      const output = (stdout + '\n' + stderr).trim()
      if (code === 0) {
        resolve({ success: true, output: output || '(completed successfully)' })
      } else {
        resolve({
          success: false,
          error: `ffmpeg exited with code ${code}`,
          output
        })
      }
    })

    child.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
}

const toolDefinitions = [
  {
    name: 'ffmpeg_check',
    description: 'Check if ffmpeg is installed',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'ffmpeg_install',
    description: 'Install ffmpeg via the system package manager',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'ffmpeg_run',
    description: 'Run an ffmpeg command',
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'string',
          description: "ffmpeg arguments (everything after 'ffmpeg')"
        }
      },
      required: ['args']
    }
  }
]

function describeAction(toolName, args) {
  if (toolName === 'ffmpeg_check') {
    return {
      title: 'Check FFmpeg',
      description: 'Detect whether ffmpeg is installed on this machine',
      risk: 'low'
    }
  }
  if (toolName === 'ffmpeg_install') {
    let command = 'install ffmpeg'
    if (process.platform === 'darwin') command = 'brew install ffmpeg'
    else if (process.platform === 'win32')
      command = 'winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements'
    else command = 'apt install -y ffmpeg (or dnf install -y ffmpeg)'
    return {
      title: 'Install FFmpeg',
      description: 'Install the FFmpeg multimedia framework via your system package manager',
      command,
      impact: 'Video/audio processing tool, typically 50-80MB download',
      risk: 'low'
    }
  }
  if (toolName === 'ffmpeg_run') {
    const rawArgs = String(args?.args ?? '').trim()
    return {
      title: 'Run FFmpeg',
      description: 'Process media file with FFmpeg',
      command: `ffmpeg ${rawArgs}`,
      risk: 'low'
    }
  }
  return null
}

const plugin = {
  name: 'ffmpeg',
  tools: toolDefinitions,
  describeAction,
  async execute(toolName, args) {
    switch (toolName) {
      case 'ffmpeg_check':
        return ffmpegCheck()
      case 'ffmpeg_install':
        return ffmpegInstall()
      case 'ffmpeg_run':
        return ffmpegRun(args)
      default:
        return { success: false, error: `ffmpeg: unknown tool ${toolName}` }
    }
  }
}

export default plugin
