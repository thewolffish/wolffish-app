/**
 * `wolffish status`, `wolffish service …`, `wolffish path …`.
 *
 * These three exist because a headless install has questions a desktop never
 * asks: is the agent actually running, will it come back after a reboot, and
 * can the shell even find this command. All three fail quietly by nature — a
 * daemon that isn't running looks like a hang, autostart that didn't register
 * looks fine until the reboot, and a missing PATH entry looks like the CLI was
 * never installed — so each one reports what is TRUE, not what was requested.
 */
import { spawn } from 'node:child_process'
import { c, heading, icon, keyValue, out, shortPath, table, wrapText } from '../lib/ui.mjs'
import { daemonPid } from '../lib/client.mjs'

export async function status(client, { json } = {}) {
  const snapshot = await client.invoke('cli:status')
  if (json) {
    out(JSON.stringify(snapshot, null, 2))
    return 0
  }

  heading(`Wolffish ${c.gray(snapshot.version ?? '')}`)
  keyValue([
    ['daemon', `${icon.ok()} running ${c.gray(`pid ${snapshot.cli?.pid ?? '?'}`)}`],
    [
      'mode',
      snapshot.headless ? c.cyan('headless') : c.cyan('desktop') + c.gray(' (window available)')
    ],
    ['clients', String(snapshot.cli?.clients ?? 0)],
    ['platform', String(snapshot.platform ?? '')]
  ])

  const brainModel = snapshot.workspace?.model ?? snapshot.workspace?.brain ?? null
  heading('Brain')
  keyValue([['model', brainModel ? c.bold(String(brainModel)) : c.yellow('not configured')]])
  if (!brainModel)
    out(c.gray('    wolffish keys set anthropic && wolffish brain anthropic <model>'))

  heading('Autostart')
  const auto = snapshot.autostart ?? {}
  keyValue([
    ['registered', auto.active ? c.green('yes') : c.yellow('no')],
    ['mechanism', c.gray(String(auto.mechanism ?? 'unknown'))],
    ...(auto.location ? [['location', c.gray(shortPath(auto.location))]] : [])
  ])
  if (auto.warning) {
    out()
    out(`  ${icon.warn()} ${c.yellow(wrapText(auto.warning, 0).trim())}`)
  }
  if (!auto.active) out(c.gray('    enable with: wolffish service install'))

  heading('Command')
  const p = snapshot.path ?? {}
  keyValue([
    ['on PATH', p.installed ? c.green('yes') : c.red('no')],
    ['shim', c.gray(shortPath(p.target ?? ''))],
    ...(p.resolved ? [['resolves to', c.gray(shortPath(p.resolved))]] : [])
  ])
  if (!p.installed) {
    out()
    out(`  ${icon.warn()} ${c.yellow('run: wolffish path install')}`)
  }

  const channels = Array.isArray(snapshot.channels) ? snapshot.channels : []
  if (channels.length > 0) {
    heading('Channels')
    table(
      ['channel', 'state', 'detail'],
      channels.map((ch) => [
        ch.label ?? ch.id,
        ch.connected ? c.green('connected') : c.gray(ch.state ?? 'off'),
        c.gray(String(ch.detail ?? ''))
      ])
    )
  }

  const runs = snapshot.activeRuns ?? []
  if (runs.length > 0) {
    heading(`Running now ${c.gray(`(${runs.length})`)}`)
    table(
      ['conversation', 'channel', 'title'],
      runs.map((run) => [
        c.gray(String(run.conversationId).slice(0, 8)),
        run.channel ?? '—',
        run.title ?? c.gray('Untitled')
      ])
    )
  }
  out()
  return 0
}

export async function service(client, args) {
  const [sub, ...rest] = args

  if (!sub || sub === 'status') {
    const state = await client.invoke('service:status')
    heading('Autostart')
    keyValue([
      ['registered', state.active ? c.green('yes') : c.yellow('no')],
      ['mechanism', c.gray(state.mechanism)],
      ['run mode', c.gray(state.mode)],
      ...(state.location ? [['location', c.gray(shortPath(state.location))]] : [])
    ])
    if (state.warning) {
      out()
      out(`  ${icon.warn()} ${c.yellow(state.warning)}`)
    }
    out()
    return state.active ? 0 : 1
  }

  if (sub === 'install') {
    // `--headless` is the declaration that this machine is a server. It
    // decides between a login item / .desktop entry and a real service unit,
    // and it is persisted so a later status check asks the same question.
    const mode = rest.includes('--headless') || rest.includes('headless') ? 'headless' : undefined
    const state = await client.invoke('service:install', mode)
    if (!state.active) {
      out(`${icon.fail()} ${c.red('could not register autostart')}`)
      if (state.warning) out(wrapText(c.gray(state.warning), 2))
      return 1
    }
    out(`${icon.ok()} autostart registered ${c.gray(`(${state.mechanism})`)}`)
    if (state.location) out(c.gray(`  ${shortPath(state.location)}`))
    if (state.warning) out(`  ${icon.warn()} ${c.yellow(state.warning)}`)
    return 0
  }

  if (sub === 'uninstall') {
    const state = await client.invoke('service:uninstall')
    out(`${icon.ok()} autostart removed ${c.gray(`(${state.mechanism})`)}`)
    return 0
  }

  if (sub === 'start') {
    out(c.gray('  the daemon starts on demand — any wolffish command brings it up'))
    return 0
  }

  if (sub === 'stop') {
    const pid = daemonPid()
    if (!pid) {
      out(c.gray('  not running'))
      return 0
    }
    process.kill(pid, 'SIGTERM')
    out(`${icon.ok()} sent SIGTERM to pid ${pid}`)
    return 0
  }

  if (sub === 'logs') {
    return tailLogs(rest)
  }

  out(c.red(`unknown: wolffish service ${sub}`))
  out(c.gray('  status | install [--headless] | uninstall | stop | logs'))
  return 2
}

function tailLogs(args) {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const dir = `${home}/.wolffish/workspace/logs`
  if (process.platform === 'win32') {
    out(c.gray(`  logs are in ${dir}`))
    return 0
  }
  const follow = args.includes('-f') || args.includes('--follow')
  const child = spawn(
    'sh',
    [
      '-lc',
      `ls -1t "${dir}"/*.log 2>/dev/null | head -1 | xargs ${follow ? 'tail -f' : 'tail -n 200'}`
    ],
    { stdio: 'inherit' }
  )
  return new Promise((resolve) => child.on('close', (code) => resolve(code ?? 0)))
}

/**
 * `wolffish path` — the command's own installation.
 *
 * Worth its own verb because the failure mode is invisible: without the shim
 * on PATH, every other command in this document is unreachable and the shell
 * says only "command not found", which points at nothing.
 */
export async function pathCommand(client, args) {
  const [sub] = args

  if (!sub || sub === 'status') {
    const state = await client.invoke('cli:pathStatus')
    heading('Command')
    keyValue([
      ['on PATH', state.installed ? c.green('yes') : c.red('no')],
      ['shim', c.gray(shortPath(state.target))],
      ['resolves to', state.resolved ? c.gray(shortPath(state.resolved)) : c.gray('nothing')]
    ])
    if (state.shadowedBy) {
      out()
      out(
        `  ${icon.warn()} ${c.yellow(`"wolffish" currently runs ${shortPath(state.shadowedBy)}`)}`
      )
      out(
        wrapText(
          c.gray(
            'That is the app binary the package manager linked, so the command opens the desktop app instead of this CLI. Put the shim earlier on PATH, or replace that link.'
          ),
          4
        )
      )
    }
    if (state.needsPathEntry && state.profileHint) {
      out()
      out(`  ${icon.warn()} ${c.yellow('the shim exists but its folder is not on PATH')}`)
      out(`  ${c.bold(state.profileHint)}`)
    }
    if (!state.installed && !state.needsPathEntry) {
      out()
      out(c.gray('  install with: wolffish path install'))
    }
    out()
    return state.installed ? 0 : 1
  }

  if (sub === 'install') {
    const state = await client.invoke('cli:installPath')
    if (state.error) {
      out(`${icon.fail()} ${c.red(state.error)}`)
      return 1
    }
    out(`${icon.ok()} installed ${c.gray(shortPath(state.target))}`)
    if (state.needsPathEntry && state.profileHint) {
      out()
      out(`${icon.warn()} ${c.yellow('one more step — that folder is not on your PATH:')}`)
      out(`  ${c.bold(state.profileHint)}`)
      out(c.gray('  then restart your shell'))
      return 1
    }
    if (state.shadowedBy) {
      out(
        `${icon.warn()} ${c.yellow(`another "wolffish" is earlier on PATH: ${shortPath(state.shadowedBy)}`)}`
      )
      return 1
    }
    return 0
  }

  if (sub === 'uninstall') {
    await client.invoke('cli:uninstallPath')
    out(`${icon.ok()} removed`)
    return 0
  }

  out(c.red(`unknown: wolffish path ${sub}`))
  out(c.gray('  status | install | uninstall'))
  return 2
}
