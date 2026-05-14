import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const INSTALL_TIMEOUT_MS = 300_000
const MAX_OUTPUT = 50_000

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

async function nodeCheck() {
  const nodePath = await which('node')
  if (!nodePath) {
    return { success: true, output: JSON.stringify({ installed: false, version: '' }) }
  }
  try {
    const { stdout } = await execFileP(nodePath, ['--version'])
    return { success: true, output: JSON.stringify({ installed: true, version: stdout.trim() }) }
  } catch {
    return { success: true, output: JSON.stringify({ installed: true, version: 'unknown' }) }
  }
}

async function nodeInstall() {
  const platform = process.platform
  let cmd, args

  if (platform === 'darwin') {
    const brewPath =
      process.arch === 'arm64' ? '/opt/homebrew/bin/brew' : '/usr/local/bin/brew'
    try {
      await execFileP(brewPath, ['--version'])
      cmd = brewPath
      args = ['install', 'node']
    } catch {
      const found = await which('brew')
      if (found) {
        cmd = found
        args = ['install', 'node']
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
      'OpenJS.NodeJS.LTS',
      '-e',
      '--accept-source-agreements',
      '--accept-package-agreements'
    ]
  } else {
    const aptPath = await which('apt')
    if (aptPath) {
      cmd = 'sudo'
      args = ['apt', 'install', '-y', 'nodejs']
    } else {
      const dnfPath = await which('dnf')
      if (dnfPath) {
        cmd = 'sudo'
        args = ['dnf', 'install', '-y', 'nodejs']
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

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {}
      resolve({ success: false, error: 'Node.js installation timed out after 5 minutes' })
    }, INSTALL_TIMEOUT_MS)

    child.on('close', (code) => {
      clearTimeout(timer)
      const output = (stdout + '\n' + stderr).trim()
      if (code === 0) {
        resolve({ success: true, output: output || 'Node.js installed successfully' })
      } else {
        resolve({
          success: false,
          error: `Installation failed (exit ${code}): ${output.slice(0, 500)}`
        })
      }
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ success: false, error: err.message })
    })
  })
}

const toolDefinitions = [
  {
    name: 'node_check',
    description: 'Check if Node.js is installed',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'node_install',
    description: 'Install Node.js via the system package manager',
    parameters: { type: 'object', properties: {}, required: [] }
  }
]

function describeAction(toolName) {
  if (toolName === 'node_check') {
    return {
      title: 'Check Node.js',
      description: 'Detect whether Node.js is installed on this machine',
      risk: 'low'
    }
  }
  if (toolName === 'node_install') {
    let command = 'install node'
    if (process.platform === 'darwin') command = 'brew install node'
    else if (process.platform === 'win32')
      command = 'winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements'
    else command = 'apt install -y nodejs (or dnf install -y nodejs)'
    return {
      title: 'Install Node.js',
      description: 'Install Node.js LTS via the system package manager',
      command,
      risk: 'low'
    }
  }
  return null
}

const plugin = {
  name: 'node',
  tools: toolDefinitions,
  describeAction,
  async execute(toolName, args) {
    switch (toolName) {
      case 'node_check':
        return nodeCheck()
      case 'node_install':
        return nodeInstall()
      default:
        return { success: false, error: `node: unknown tool ${toolName}` }
    }
  }
}

export default plugin
