import { wlog } from '@main/workspace/logger'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ProcessRecord, RestartPolicy } from './types'

const run = promisify(execFile)
const TAG = '[processes:units]'

/**
 * Per-process login units — `autostart: system`.
 *
 * The same three writers autostart.ts uses for the app itself (LaunchAgent,
 * systemd user unit, Task Scheduler ONLOGON), parametrised by a process
 * definition. Two rules carried over from that module because both were
 * learned from incidents:
 *
 *  - `WOLFFISH_AUTOSTART_DRY_RUN=1` writes the unit file and never talks to
 *    the live service manager. A test that fakes the home directory does
 *    NOT fake launchctl/systemctl/schtasks — a KeepAlive agent bootstrapped
 *    from a temp HOME once relaunched the installed app on every quit.
 *  - Status is what the service manager REPORTS, never what was asked for.
 *
 * And one rule of this module's own: a unit with KeepAlive / Restart=always
 * resurrects a process the manager kills with a plain signal, so stop and
 * restart go THROUGH the unit (unitStop / unitRestart) whenever one is set.
 */

export const DRY_RUN = process.env.WOLFFISH_AUTOSTART_DRY_RUN === '1'

export type UnitPlatform = 'darwin' | 'linux' | 'win32'

export type UnitState = {
  installed: boolean
  /** The manager says the job is loaded / enabled. */
  active: boolean
  running: boolean
  pid: number | null
  location: string
  warning: string | null
}

export function unitLabel(
  name: string,
  platform: UnitPlatform = process.platform as UnitPlatform
): string {
  if (platform === 'darwin') return `sh.wolffi.process.${name}`
  if (platform === 'linux') return `wolffish-process-${name}.service`
  return `Wolffish\\process-${name}`
}

export function unitPath(
  name: string,
  platform: UnitPlatform = process.platform as UnitPlatform
): string {
  if (platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'LaunchAgents', `${unitLabel(name, 'darwin')}.plist`)
  if (platform === 'linux')
    return path.join(os.homedir(), '.config', 'systemd', 'user', unitLabel(name, 'linux'))
  return `Task Scheduler ${unitLabel(name, 'win32')}`
}

async function serviceCall(bin: string, args: string[]): Promise<string> {
  if (DRY_RUN) return ''
  const { stdout } = await run(bin, args, { windowsHide: true })
  return String(stdout ?? '')
}

function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The environment a unit carries: PORT when allocated, the log-friendly flags, the definition's own. */
export function unitEnv(record: ProcessRecord): Record<string, string> {
  const env: Record<string, string> = { NO_COLOR: '1', FORCE_COLOR: '0', ...record.env }
  if (record.run.port) env.PORT = String(record.run.port)
  return env
}

export function resolvedCommand(record: ProcessRecord): string {
  return record.run.port
    ? record.command.replace(/\{port\}/gi, String(record.run.port))
    : record.command
}

export function launchdPlist(record: ProcessRecord, logPath: string): string {
  const env = unitEnv(record)
  const keepAlive: string =
    record.restart === 'always'
      ? '  <true/>'
      : record.restart === 'on-failure'
        ? '  <dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>'
        : '  <false/>'
  const envXml = Object.entries(env)
    .map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`)
    .join('\n')
  // A login shell (-l) so the unit sees the PATH the user's terminal has —
  // launchd starts jobs with almost no environment, and a dev server that
  // needs nvm's node is otherwise "command not found" at every boot.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(unitLabel(record.name, 'darwin'))}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-lc</string>
    <string>${xml(resolvedCommand(record))}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(record.cwd)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
${keepAlive}
  <key>StandardOutPath</key>
  <string>${xml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logPath)}</string>
</dict>
</plist>
`
}

function systemdRestart(policy: RestartPolicy): string {
  return policy === 'always' ? 'always' : policy === 'on-failure' ? 'on-failure' : 'no'
}

export function systemdUnit(record: ProcessRecord, logPath: string): string {
  const env = unitEnv(record)
  const envLines = Object.entries(env)
    .map(([k, v]) => `Environment="${k}=${v.replace(/"/g, '\\"')}"`)
    .join('\n')
  const cmd = resolvedCommand(record).replace(/'/g, `'\\''`)
  return `[Unit]
Description=Wolffish process ${record.name}
After=network-online.target

[Service]
Type=simple
ExecStart=/bin/sh -lc '${cmd}'
WorkingDirectory=${record.cwd}
${envLines}
Restart=${systemdRestart(record.restart)}
RestartSec=2
StandardOutput=append:${logPath}
StandardError=inherit

[Install]
WantedBy=default.target
`
}

/** The single command line a Task Scheduler action runs: cd, set env, run, log. */
export function schtasksAction(record: ProcessRecord, logPath: string): string {
  const env = unitEnv(record)
  const sets = Object.entries(env)
    .map(([k, v]) => `set "${k}=${v}"`)
    .join(' && ')
  const body = `cd /d "${record.cwd}" && ${sets ? `${sets} && ` : ''}${resolvedCommand(record)} >> "${logPath}" 2>&1`
  return `cmd /c "${body.replace(/"/g, '\\"')}"`
}

export async function installUnit(
  record: ProcessRecord,
  logPath: string,
  platform: UnitPlatform = process.platform as UnitPlatform
): Promise<UnitState> {
  if (platform === 'darwin') {
    const file = unitPath(record.name, 'darwin')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    await fs.writeFile(file, launchdPlist(record, logPath), 'utf8')
    const uid = String(process.getuid?.() ?? 501)
    // A stale copy of the same label must go first or bootstrap reports
    // "already loaded" and the new file is never read.
    await serviceCall('launchctl', [
      'bootout',
      `gui/${uid}/${unitLabel(record.name, 'darwin')}`
    ]).catch(() => undefined)
    await serviceCall('launchctl', ['bootstrap', `gui/${uid}`, file]).catch(() =>
      serviceCall('launchctl', ['load', '-w', file]).catch(() => undefined)
    )
    return unitState(record.name, 'darwin')
  }
  if (platform === 'linux') {
    const file = unitPath(record.name, 'linux')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    await fs.writeFile(file, systemdUnit(record, logPath), 'utf8')
    await serviceCall('systemctl', ['--user', 'daemon-reload']).catch(() => undefined)
    await serviceCall('systemctl', ['--user', 'enable', '--now', unitLabel(record.name, 'linux')])
    try {
      await serviceCall('loginctl', ['enable-linger', os.userInfo().username])
    } catch (err) {
      wlog.warn(TAG, `enable-linger failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    return unitState(record.name, 'linux')
  }
  await fs.mkdir(path.dirname(logPath), { recursive: true })
  await serviceCall('schtasks', [
    '/create',
    '/f',
    '/tn',
    unitLabel(record.name, 'win32'),
    '/tr',
    schtasksAction(record, logPath),
    '/sc',
    'onlogon',
    '/rl',
    'limited'
  ])
  return unitState(record.name, 'win32')
}

export async function removeUnit(
  name: string,
  platform: UnitPlatform = process.platform as UnitPlatform
): Promise<void> {
  if (platform === 'darwin') {
    const file = unitPath(name, 'darwin')
    const uid = String(process.getuid?.() ?? 501)
    await serviceCall('launchctl', ['bootout', `gui/${uid}/${unitLabel(name, 'darwin')}`]).catch(
      () => serviceCall('launchctl', ['unload', '-w', file]).catch(() => undefined)
    )
    await fs.rm(file, { force: true })
    return
  }
  if (platform === 'linux') {
    await serviceCall('systemctl', ['--user', 'disable', '--now', unitLabel(name, 'linux')]).catch(
      () => undefined
    )
    await fs.rm(unitPath(name, 'linux'), { force: true })
    await serviceCall('systemctl', ['--user', 'daemon-reload']).catch(() => undefined)
    return
  }
  await serviceCall('schtasks', ['/delete', '/f', '/tn', unitLabel(name, 'win32')]).catch(
    () => undefined
  )
}

export async function unitState(
  name: string,
  platform: UnitPlatform = process.platform as UnitPlatform
): Promise<UnitState> {
  const location = unitPath(name, platform)
  if (platform === 'darwin') {
    const installed = existsSync(location)
    if (DRY_RUN)
      return { installed, active: installed, running: false, pid: null, location, warning: null }
    const uid = String(process.getuid?.() ?? 501)
    try {
      const out = await serviceCall('launchctl', [
        'print',
        `gui/${uid}/${unitLabel(name, 'darwin')}`
      ])
      const pidMatch = /^\s*pid = (\d+)/m.exec(out)
      const pid = pidMatch ? Number(pidMatch[1]) : null
      return {
        installed,
        active: true,
        running: pid !== null,
        pid,
        location,
        warning: installed ? null : 'launchd runs this job but its plist is gone.'
      }
    } catch {
      return {
        installed,
        active: false,
        running: false,
        pid: null,
        location,
        warning: installed
          ? 'The agent is written but not loaded — it starts at the next login.'
          : null
      }
    }
  }
  if (platform === 'linux') {
    const installed = existsSync(location)
    if (DRY_RUN)
      return { installed, active: installed, running: false, pid: null, location, warning: null }
    try {
      const out = await serviceCall('systemctl', [
        '--user',
        'show',
        unitLabel(name, 'linux'),
        '-p',
        'MainPID',
        '-p',
        'ActiveState',
        '-p',
        'UnitFileState'
      ])
      const pid = Number(/MainPID=(\d+)/.exec(out)?.[1] ?? 0) || null
      const active = /ActiveState=active/.test(out)
      const enabled = /UnitFileState=enabled/.test(out)
      let warning: string | null = null
      if (installed && !enabled)
        warning = `Installed but not enabled — run: systemctl --user enable ${unitLabel(name, 'linux')}`
      else if (!existsSync(path.join('/var/lib/systemd/linger', os.userInfo().username)))
        warning = `Lingering is off, so this stops at logout. Run: loginctl enable-linger ${os.userInfo().username}`
      return { installed, active: enabled, running: active && pid !== null, pid, location, warning }
    } catch {
      return { installed, active: false, running: false, pid: null, location, warning: null }
    }
  }
  if (DRY_RUN)
    return { installed: false, active: false, running: false, pid: null, location, warning: null }
  try {
    const out = await serviceCall('schtasks', [
      '/query',
      '/tn',
      unitLabel(name, 'win32'),
      '/fo',
      'LIST',
      '/v'
    ])
    const running = /Status:\s+Running/i.test(out)
    return { installed: true, active: true, running, pid: null, location, warning: null }
  } catch {
    return { installed: false, active: false, running: false, pid: null, location, warning: null }
  }
}

export async function unitStart(
  name: string,
  platform: UnitPlatform = process.platform as UnitPlatform
): Promise<void> {
  if (platform === 'darwin') {
    const uid = String(process.getuid?.() ?? 501)
    await serviceCall('launchctl', ['kickstart', `gui/${uid}/${unitLabel(name, 'darwin')}`])
    return
  }
  if (platform === 'linux') {
    await serviceCall('systemctl', ['--user', 'start', unitLabel(name, 'linux')])
    return
  }
  await serviceCall('schtasks', ['/run', '/tn', unitLabel(name, 'win32')])
}

/** Stop through the manager, so KeepAlive / Restart= cannot bring it straight back. */
export async function unitStop(
  name: string,
  platform: UnitPlatform = process.platform as UnitPlatform
): Promise<void> {
  if (platform === 'darwin') {
    const uid = String(process.getuid?.() ?? 501)
    const file = unitPath(name, 'darwin')
    // bootout unloads the job (stopping it) without deleting the plist; the
    // next login — or unitStart — brings it back.
    await serviceCall('launchctl', ['bootout', `gui/${uid}/${unitLabel(name, 'darwin')}`]).catch(
      () => serviceCall('launchctl', ['unload', file]).catch(() => undefined)
    )
    return
  }
  if (platform === 'linux') {
    await serviceCall('systemctl', ['--user', 'stop', unitLabel(name, 'linux')])
    return
  }
  await serviceCall('schtasks', ['/end', '/tn', unitLabel(name, 'win32')]).catch(() => undefined)
}

export async function unitRestart(
  name: string,
  platform: UnitPlatform = process.platform as UnitPlatform
): Promise<void> {
  if (platform === 'darwin') {
    const uid = String(process.getuid?.() ?? 501)
    const label = `gui/${uid}/${unitLabel(name, 'darwin')}`
    try {
      await serviceCall('launchctl', ['kickstart', '-k', label])
    } catch {
      // Not loaded (stopped through bootout): load it again.
      await serviceCall('launchctl', ['bootstrap', `gui/${uid}`, unitPath(name, 'darwin')]).catch(
        () => undefined
      )
    }
    return
  }
  if (platform === 'linux') {
    await serviceCall('systemctl', ['--user', 'restart', unitLabel(name, 'linux')])
    return
  }
  await serviceCall('schtasks', ['/end', '/tn', unitLabel(name, 'win32')]).catch(() => undefined)
  await serviceCall('schtasks', ['/run', '/tn', unitLabel(name, 'win32')])
}
