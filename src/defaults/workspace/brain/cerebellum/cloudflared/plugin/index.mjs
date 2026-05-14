import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const INSTALL_TIMEOUT_MS = 300_000
const TUNNEL_URL_TIMEOUT_MS = 30_000
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

async function cloudflaredCheck() {
  const cfPath = await which('cloudflared')
  if (!cfPath) {
    return { success: true, output: JSON.stringify({ installed: false, version: '' }) }
  }
  try {
    const { stdout } = await execFileP(cfPath, ['--version'])
    const version = stdout.trim().split('\n')[0] || 'unknown'
    return { success: true, output: JSON.stringify({ installed: true, version }) }
  } catch {
    return { success: true, output: JSON.stringify({ installed: true, version: 'unknown' }) }
  }
}

async function cloudflaredInstall() {
  const platform = process.platform
  let cmd, args

  if (platform === 'darwin') {
    const brewPath =
      process.arch === 'arm64' ? '/opt/homebrew/bin/brew' : '/usr/local/bin/brew'
    try {
      await execFileP(brewPath, ['--version'])
      cmd = brewPath
      args = ['install', 'cloudflared']
    } catch {
      const found = await which('brew')
      if (found) {
        cmd = found
        args = ['install', 'cloudflared']
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
      'Cloudflare.cloudflared',
      '-e',
      '--accept-source-agreements',
      '--accept-package-agreements'
    ]
  } else {
    const aptPath = await which('apt')
    if (aptPath) {
      cmd = 'sudo'
      args = ['apt', 'install', '-y', 'cloudflared']
    } else {
      const dnfPath = await which('dnf')
      if (dnfPath) {
        cmd = 'sudo'
        args = ['dnf', 'install', '-y', 'cloudflared']
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
      resolve({ success: false, error: 'cloudflared installation timed out after 5 minutes' })
    }, INSTALL_TIMEOUT_MS)

    child.on('close', (code) => {
      clearTimeout(timer)
      const output = (stdout + '\n' + stderr).trim()
      if (code === 0) {
        resolve({ success: true, output: output || 'cloudflared installed successfully' })
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

async function cloudflaredTunnel(args) {
  const port = args?.port
  if (!port || typeof port !== 'number') {
    return { success: false, error: 'port is required and must be a number' }
  }

  const cfPath = await which('cloudflared')
  if (!cfPath) return { success: false, error: 'cloudflared is not installed' }

  return new Promise((resolve) => {
    const child = spawn(cfPath, ['tunnel', '--url', `http://localhost:${port}`], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stderr = ''
    let resolved = false
    const urlRegex = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/

    const finish = (result) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      resolve(result)
    }

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString()
      if (stderr.length < MAX_OUTPUT) {
        stderr += text.slice(0, MAX_OUTPUT - stderr.length)
      }

      const match = urlRegex.exec(text)
      if (match) {
        finish({
          success: true,
          output: JSON.stringify({
            url: match[0],
            port,
            pid: child.pid,
            message: `Tunnel active: ${match[0]} -> http://localhost:${port}`
          })
        })
      }
    })

    const timer = setTimeout(() => {
      finish({
        success: false,
        error: `Tunnel creation timed out. Output: ${stderr.slice(0, 500)}`
      })
    }, TUNNEL_URL_TIMEOUT_MS)

    child.on('close', (code) => {
      finish({
        success: false,
        error: `cloudflared exited with code ${code}: ${stderr.slice(0, 500)}`
      })
    })

    child.on('error', (err) => {
      finish({ success: false, error: err.message })
    })

    child.unref()
  })
}

const toolDefinitions = [
  {
    name: 'cloudflared_check',
    description: 'Check if cloudflared is installed',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'cloudflared_install',
    description: 'Install cloudflared via the system package manager',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'cloudflared_tunnel',
    description: 'Create a quick tunnel to expose a local port',
    parameters: {
      type: 'object',
      properties: {
        port: { type: 'number', description: 'Local port to expose' }
      },
      required: ['port']
    }
  }
]

function describeAction(toolName, args) {
  if (toolName === 'cloudflared_check') {
    return {
      title: 'Check Cloudflared',
      description: 'Detect whether cloudflared is installed on this machine',
      risk: 'low'
    }
  }
  if (toolName === 'cloudflared_install') {
    let command = 'install cloudflared'
    if (process.platform === 'darwin') command = 'brew install cloudflared'
    else if (process.platform === 'win32')
      command = 'winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements'
    else command = 'apt install -y cloudflared (or dnf install -y cloudflared)'
    return {
      title: 'Install Cloudflared',
      description: 'Install the Cloudflare Tunnel CLI',
      command,
      risk: 'low'
    }
  }
  if (toolName === 'cloudflared_tunnel') {
    const port = args?.port
    return {
      title: 'Create Cloudflare Tunnel',
      description: `Expose local port ${port} to the internet via Cloudflare`,
      command: `cloudflared tunnel --url http://localhost:${port}`,
      impact: `Creates a public URL pointing to your local port ${port}. Anyone with the URL can access it.`,
      risk: 'medium'
    }
  }
  return null
}

const plugin = {
  name: 'cloudflared',
  tools: toolDefinitions,
  describeAction,
  async execute(toolName, args) {
    switch (toolName) {
      case 'cloudflared_check':
        return cloudflaredCheck()
      case 'cloudflared_install':
        return cloudflaredInstall()
      case 'cloudflared_tunnel':
        return cloudflaredTunnel(args)
      default:
        return { success: false, error: `cloudflared: unknown tool ${toolName}` }
    }
  }
}

export default plugin
