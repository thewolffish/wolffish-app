import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import { promisify } from 'node:util'
import type { ListeningPort } from './types'

const execFileP = promisify(execFile)

/**
 * Everything the process manager needs from the operating system, behind one
 * interface, so the tools and the supervisor never branch on
 * `process.platform`. macOS and Linux share the POSIX half (process groups,
 * `ps`, `/proc`); Windows goes through PowerShell's CIM classes the way the
 * mobile-simulators helpers already do (helpers.mjs commandLineOf), and
 * `taskkill /t` for trees the way the shell plugin already does.
 *
 * Each primitive is cheap to call alone and never throws: a probe that
 * cannot answer returns null / an empty list, and the caller decides.
 */

export type ProcessInfo = {
  /** The OS's own start stamp for the pid, as a string we compare by equality. */
  startedAt: string | null
  commandLine: string | null
}

export type ShellSpec = { bin: string; args: string[]; powershell?: boolean }

let shellPromise: Promise<ShellSpec> | null = null

async function probeWindowsShell(): Promise<ShellSpec> {
  for (const c of [
    { bin: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command'], powershell: true },
    { bin: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command'], powershell: true }
  ]) {
    try {
      await execFileP('where', [c.bin], { windowsHide: true })
      return c
    } catch {
      // not on PATH
    }
  }
  return { bin: 'cmd.exe', args: ['/c'] }
}

/** The shell a command runs through — the shell plugin's choice, byte for byte. */
export function detectShell(): Promise<ShellSpec> {
  if (shellPromise) return shellPromise
  shellPromise =
    process.platform === 'win32'
      ? probeWindowsShell().catch(() => ({ bin: 'cmd.exe', args: ['/c'] }))
      : Promise.resolve({ bin: '/bin/sh', args: ['-c'] })
  return shellPromise
}

/**
 * Start a command detached from this process: its own process group (POSIX)
 * or its own console (Windows), stdout+stderr on the log descriptor, and
 * unref'd so it outlives the tool call, the turn and Wolffish itself.
 */
export function spawnDetached(
  shell: ShellSpec,
  command: string,
  opts: { cwd: string; env: NodeJS.ProcessEnv; logFd: number | null }
): { pid: number; child: ReturnType<typeof spawn> } | { error: string } {
  try {
    const child = spawn(shell.bin, [...shell.args, command], {
      cwd: opts.cwd,
      env: opts.env,
      detached: true,
      stdio: ['ignore', opts.logFd ?? 'ignore', opts.logFd ?? 'ignore'],
      windowsHide: true
    })
    child.on('error', () => {})
    const pid = child.pid
    if (!pid) return { error: 'failed to start process (no PID returned)' }
    child.unref()
    return { pid, child }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

function runQuiet(bin: string, args: string[], timeout = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? null : String(stdout ?? ''))
    )
  })
}

function powershell(script: string, timeout = 10000): Promise<string | null> {
  return runQuiet('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], timeout)
}

/** Start stamp + command line for one pid, or null when there is no such process. */
export async function processInfo(pid: number): Promise<ProcessInfo | null> {
  if (!pid || !pidExists(pid)) return null
  if (process.platform === 'win32') {
    const out = await powershell(
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}"; if ($p) { $p.CreationDate; $p.CommandLine }`
    )
    if (!out?.trim()) return null
    const [startedAt, ...rest] = out.split(/\r?\n/)
    return { startedAt: startedAt?.trim() || null, commandLine: rest.join('\n').trim() || null }
  }
  if (process.platform === 'linux') {
    try {
      const [stat, cmdline] = await Promise.all([
        fs.readFile(`/proc/${pid}/stat`, 'utf8'),
        fs.readFile(`/proc/${pid}/cmdline`, 'utf8')
      ])
      // Field 22 (1-based) is starttime in clock ticks since boot; the comm
      // field can contain spaces so split after the closing paren.
      const afterComm = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      const startedAt = afterComm[19] ?? null
      return { startedAt, commandLine: cmdline.replace(/\0/g, ' ').trim() || null }
    } catch {
      // Fall through to ps: a container without /proc permissions.
    }
  }
  const out = await runQuiet('ps', ['-p', String(pid), '-o', 'lstart=,command='])
  const line = out?.trim()
  if (!line) return null
  // lstart is a fixed 24-char "Sun Sep 20 10:00:00 2026" prefix.
  const startedAt = line.slice(0, 24).trim()
  const commandLine = line.slice(24).trim()
  return { startedAt: startedAt || null, commandLine: commandLine || null }
}

/** Every descendant pid of `root` (not including root), breadth-first. */
export async function treeOf(root: number): Promise<number[]> {
  const parents = new Map<number, number>() // pid -> ppid
  if (process.platform === 'win32') {
    const out = await powershell(
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'
    )
    for (const line of (out ?? '').split(/\r?\n/)) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number)
      if (pid && Number.isFinite(ppid)) parents.set(pid, ppid)
    }
  } else {
    const out = await runQuiet('ps', ['-axo', 'pid=,ppid='])
    for (const line of (out ?? '').split(/\r?\n/)) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number)
      if (pid && Number.isFinite(ppid)) parents.set(pid, ppid)
    }
  }
  const children = new Map<number, number[]>()
  for (const [pid, ppid] of parents) {
    const list = children.get(ppid) ?? []
    list.push(pid)
    children.set(ppid, list)
  }
  const out: number[] = []
  const queue = [root]
  const seen = new Set<number>([root])
  while (queue.length) {
    const cur = queue.shift() as number
    for (const kid of children.get(cur) ?? []) {
      if (seen.has(kid)) continue
      seen.add(kid)
      out.push(kid)
      queue.push(kid)
    }
  }
  return out
}

/** Every ancestor pid of `pid` (parent first), so Wolffish's own dev launcher counts as "us". */
export async function ancestorsOf(pid: number): Promise<number[]> {
  const parents = new Map<number, number>()
  if (process.platform === 'win32') {
    const out = await powershell(
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'
    )
    for (const line of (out ?? '').split(/\r?\n/)) {
      const [p, pp] = line.trim().split(/\s+/).map(Number)
      if (p && Number.isFinite(pp)) parents.set(p, pp)
    }
  } else {
    const out = await runQuiet('ps', ['-axo', 'pid=,ppid='])
    for (const line of (out ?? '').split(/\r?\n/)) {
      const [p, pp] = line.trim().split(/\s+/).map(Number)
      if (p && Number.isFinite(pp)) parents.set(p, pp)
    }
  }
  const chain: number[] = []
  let cur = parents.get(pid)
  while (cur && cur > 1 && !chain.includes(cur)) {
    chain.push(cur)
    cur = parents.get(cur)
  }
  return chain
}

/**
 * This app's own process family: itself and its launchers (a dev runner such
 * as electron-vite that owns the app's dev server port). Children are NOT
 * included — a detached child of Wolffish is exactly what a managed process
 * is, and must stay adoptable.
 */
export async function ownProcessTree(): Promise<Set<number>> {
  const parents = await ancestorsOf(process.pid).catch(() => [] as number[])
  return new Set([process.pid, ...parents])
}

export type StopSignal = 'SIGTERM' | 'SIGINT' | 'SIGKILL'

/**
 * Deliver a signal to a whole tree. POSIX: the detached child leads its own
 * process group, so `-pid` reaches every descendant at once; the per-pid
 * fallback covers a process that changed groups. Windows: `taskkill /t`
 * (a close request, which console programs ignore) for the graceful pass
 * and `/t /f` for the hard one — the shell plugin's killTree, unchanged.
 */
export async function signalTree(pid: number, signal: StopSignal): Promise<void> {
  if (process.platform === 'win32') {
    const args = ['/pid', String(pid), '/t']
    if (signal === 'SIGKILL') args.push('/f')
    await runQuiet('taskkill', args, 15000)
    return
  }
  const descendants = await treeOf(pid).catch(() => [] as number[])
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // already gone
    }
  }
  for (const kid of descendants) {
    try {
      process.kill(kid, signal)
    } catch {
      // gone
    }
  }
}

/** Every TCP listener on the machine, with owner pid and command where the OS tells us. */
export async function listeningPorts(): Promise<ListeningPort[]> {
  const out: ListeningPort[] = []
  const seen = new Set<string>()
  const push = (port: number, pid: number | null, command: string | null): void => {
    if (!Number.isInteger(port) || port <= 0) return
    const key = `${port}:${pid ?? 0}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ port, pid, command })
  }
  if (process.platform === 'win32') {
    const text = await powershell(
      'Get-NetTCPConnection -State Listen | ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; "$($_.LocalPort) $($_.OwningProcess) $($p.ProcessName)" }',
      15000
    )
    for (const line of (text ?? '').split(/\r?\n/)) {
      const [port, pid, ...cmd] = line.trim().split(/\s+/)
      if (port) push(Number(port), pid ? Number(pid) : null, cmd.join(' ') || null)
    }
    return out
  }
  if (process.platform === 'darwin') {
    const text = await runQuiet('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'])
    if (text) {
      let pid: number | null = null
      let cmd: string | null = null
      for (const line of text.split('\n')) {
        const tag = line[0]
        const value = line.slice(1)
        if (tag === 'p') {
          pid = Number(value) || null
          cmd = null
        } else if (tag === 'c') cmd = value
        else if (tag === 'n') {
          const m = /:(\d+)$/.exec(value)
          if (m) push(Number(m[1]), pid, cmd)
        }
      }
      return out
    }
  }
  // Linux (and a mac without lsof): ss, then the /proc tables.
  const ss = await runQuiet('ss', ['-ltnpH'])
  if (ss) {
    for (const line of ss.split('\n')) {
      const cols = line.trim().split(/\s+/)
      if (cols.length < 4) continue
      const local = cols[3]
      const m = /:(\d+)$/.exec(local)
      if (!m) continue
      const pidMatch = /pid=(\d+)/.exec(line)
      const cmdMatch = /users:\(\("([^"]+)"/.exec(line)
      push(Number(m[1]), pidMatch ? Number(pidMatch[1]) : null, cmdMatch ? cmdMatch[1] : null)
    }
    return out
  }
  try {
    for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
      const text = await fs.readFile(table, 'utf8').catch(() => '')
      for (const line of text.split('\n').slice(1)) {
        const cols = line.trim().split(/\s+/)
        if (cols.length < 4 || cols[3] !== '0A') continue
        const port = parseInt(cols[1].split(':').pop() ?? '', 16)
        push(port, null, null)
      }
    }
  } catch {
    // no /proc — nothing more to try
  }
  return out
}

/** The one authoritative "free" test: a real bind on the loopback, released at once. */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}
