/**
 * The interactive session — `wolffish` with no arguments.
 *
 * The important thing this is NOT: the process that runs Wolffish. The agent
 * lives in the daemon. This is a viewport, so closing it (or losing the SSH
 * connection that hosts it) leaves automations, channels and any turn in
 * flight running, and reopening reattaches to whatever is live.
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import readline from 'node:readline'
import os from 'node:os'
import { c, heading, icon, out, question, table, wrapText } from '../lib/ui.mjs'
import { runTurn } from '../lib/turn.mjs'
import { listSettings, setSetting } from './settings.mjs'
import { resolveConversationId, showConversation } from './workspace.mjs'
import { basename } from '../lib/render.mjs'

const SLASH_HELP = [
  ['/attach <path…>', 'stage files for the next message'],
  ['/open <n>', 'open a delivered file with the OS'],
  ['/save <n> <dest>', 'copy a delivered file somewhere else'],
  ['/files', 'list files delivered this session'],
  ['/model', 'show or switch the brain'],
  ['/mode single|workflow', 'switch chat mode'],
  ['/verbose on|off', 'toggle tool-by-tool output'],
  ['/resume [id]', 'continue a past conversation'],
  ['/new', 'start a fresh conversation'],
  ['/show', 'print this conversation so far'],
  ['/settings [group]', 'read every setting'],
  ['/set <id> <value>', 'change a setting'],
  ['/status', 'daemon, brain, channels'],
  ['/cancel', 'stop the running turn'],
  ['/help', 'this list'],
  ['/exit', 'leave (the agent keeps running)']
]

export async function repl(client, { conversationId = null, verbose = false } = {}) {
  const state = {
    conversationId,
    verbose,
    pendingAttachments: [],
    files: []
  }

  const [snapshot, cliConfig] = await Promise.all([
    client.invoke('cli:snapshot').catch(() => ({})),
    client.invoke('cli:getConfig').catch(() => ({}))
  ])
  state.verbose = verbose || cliConfig?.verbose === true

  printBanner(snapshot, state)

  // Runs started elsewhere (an automation, a Telegram message, the app window)
  // are announced here rather than silently interleaving — the terminal is one
  // view of a shared agent, not the only one.
  client.onEvent((channel, payload) => {
    if (channel !== 'chat:turnState') return
    if (!payload?.conversationId || payload.conversationId === state.conversationId) return
    if (payload.phase !== 'started') return
    if (payload.channel === 'cli') return
    out(
      c.gray(
        `  ${icon.dot()} ${payload.channel ?? 'another surface'} started a turn — ${payload.title ?? 'Untitled'}`
      )
    )
  })

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: c.blue('› '),
    historySize: 500,
    terminal: process.stdin.isTTY === true
  })

  let running = false
  let closed = false
  rl.prompt()

  for await (const line of rl) {
    const input = line.trim()
    if (input.length === 0) {
      rl.prompt()
      continue
    }
    if (running) {
      // Guard rather than queue: a second prompt mid-turn would race the
      // renderer's stdout. The daemon does queue channel messages; here the
      // honest answer is to say the turn is busy.
      out(c.gray('  still working — /cancel to stop it'))
      continue
    }

    if (input.startsWith('/')) {
      const done = await handleSlash(client, state, input, rl)
      if (done === 'exit') {
        closed = true
        break
      }
      rl.prompt()
      continue
    }

    running = true
    // Pause the readline while a turn streams: its own prompt redraw would
    // fight the token stream for the same line.
    rl.pause()
    try {
      const result = await runTurn(
        client,
        {
          text: input,
          conversationId: state.conversationId,
          attachmentPaths: state.pendingAttachments.length ? state.pendingAttachments : undefined
        },
        { verbose: state.verbose }
      )
      state.conversationId = result.conversationId
      state.pendingAttachments = []
      state.files.push(...result.files)
    } catch (error) {
      out(`${icon.fail()} ${c.red(error.message)}`)
    } finally {
      running = false
      rl.resume()
      out()
      rl.prompt()
    }
  }

  if (!closed) out()
  rl.close()
  return 0
}

function printBanner(snapshot, state) {
  const brainProvider = snapshot?.llm?.brainProvider
  const brainModel = snapshot?.llm?.brainModel
  const mode = snapshot?.llm?.chatMode ?? 'single'
  const bits = [
    c.bold('Wolffish'),
    brainModel ? c.gray(`${brainProvider}/${brainModel}`) : c.yellow('no brain configured'),
    c.gray(mode)
  ]
  if (state.verbose) bits.push(c.gray('verbose'))
  out()
  out('  ' + bits.join(c.gray(' · ')))
  out(c.gray('  /help for commands · Ctrl-C stops a turn · Ctrl-D leaves'))
  out(c.gray('  the agent keeps running after you leave'))
  out()
}

async function handleSlash(client, state, input, rl) {
  const [command, ...args] = input.slice(1).split(/\s+/)

  switch (command) {
    case 'help':
    case '?': {
      heading('Commands')
      table(
        ['command', 'what it does'],
        SLASH_HELP.map(([cmd, desc]) => [c.cyan(cmd), c.gray(desc)])
      )
      out()
      return null
    }

    case 'exit':
    case 'quit':
      out(c.gray('  detached — the agent keeps running'))
      return 'exit'

    case 'new':
      state.conversationId = null
      state.pendingAttachments = []
      out(c.gray('  new conversation'))
      return null

    case 'attach': {
      if (args.length === 0) {
        out(c.red('  usage: /attach <path…>'))
        return null
      }
      for (const raw of args) {
        const resolved = expandPath(raw)
        try {
          const stat = await fs.stat(resolved)
          if (!stat.isFile()) {
            out(c.red(`  not a file: ${raw}`))
            continue
          }
          state.pendingAttachments.push(resolved)
          out(`  ${icon.ok()} ${basename(resolved)}`)
        } catch {
          out(c.red(`  not found: ${raw}`))
        }
      }
      return null
    }

    case 'files': {
      if (state.files.length === 0) {
        out(c.gray('  nothing delivered yet'))
        return null
      }
      table(
        ['#', 'file', 'path'],
        state.files.map((file, i) => [String(i + 1), basename(file.path), c.gray(file.path)])
      )
      return null
    }

    case 'open': {
      const index = Number.parseInt(args[0] ?? '', 10) - 1
      const file = state.files[index]
      if (!file) {
        out(c.red('  usage: /open <n> — see /files'))
        return null
      }
      openWithOs(file.path)
      return null
    }

    case 'save': {
      const index = Number.parseInt(args[0] ?? '', 10) - 1
      const file = state.files[index]
      const dest = args[1]
      if (!file || !dest) {
        out(c.red('  usage: /save <n> <destination>'))
        return null
      }
      const target = expandPath(dest)
      const finalPath = (await isDirectory(target))
        ? path.join(target, basename(file.path))
        : target
      await fs.copyFile(file.path, finalPath)
      out(`  ${icon.ok()} ${finalPath}`)
      return null
    }

    case 'verbose': {
      const value = args[0]
      if (value !== 'on' && value !== 'off') {
        out(c.gray(`  verbose is ${state.verbose ? 'on' : 'off'} — /verbose on|off`))
        return null
      }
      state.verbose = value === 'on'
      await client.invoke('cli:setConfig', { verbose: state.verbose }).catch(() => undefined)
      out(c.gray(`  verbose ${value}`))
      return null
    }

    case 'mode': {
      const value = args[0]
      if (value !== 'single' && value !== 'workflow') {
        out(c.red('  usage: /mode single|workflow'))
        return null
      }
      await setSetting(client, 'model.mode', value)
      return null
    }

    case 'model': {
      const snapshot = await client.invoke('cli:snapshot').catch(() => ({}))
      if (args.length === 0) {
        out(c.gray(`  ${snapshot?.llm?.brainProvider ?? '—'}/${snapshot?.llm?.brainModel ?? '—'}`))
        out(c.gray('  /model <provider> <model> to switch'))
        return null
      }
      const [providerId, model] = args
      if (!providerId || !model) {
        out(c.red('  usage: /model <provider> <model>'))
        return null
      }
      await client.invoke('provider:setBrain', { providerId, model })
      out(`  ${icon.ok()} ${providerId}/${model}`)
      return null
    }

    case 'settings':
      await listSettings(client, { group: args[0], long: false })
      return null

    case 'set': {
      const [id, ...valueParts] = args
      if (!id || valueParts.length === 0) {
        out(c.red('  usage: /set <id> <value>'))
        return null
      }
      await setSetting(client, id, valueParts.join(' '))
      return null
    }

    case 'status': {
      const { status } = await import('./service.mjs')
      await status(client, {})
      return null
    }

    case 'cancel':
      await client.invoke('cli:cancel', state.conversationId).catch(() => undefined)
      out(c.gray('  cancel requested'))
      return null

    case 'show':
      if (!state.conversationId) {
        out(c.gray('  nothing yet'))
        return null
      }
      await showConversation(client, state.conversationId, { verbose: state.verbose })
      return null

    case 'resume': {
      if (args[0]) {
        const resolved = await resolveConversationId(client, args[0])
        if (!resolved) {
          out(c.red(`  no conversation matching "${args[0]}"`))
          return null
        }
        state.conversationId = resolved
        out(c.gray(`  resumed ${resolved.slice(0, 8)}`))
        return null
      }
      const conversations = (await client.invoke('conversation:list')).slice(0, 15)
      if (conversations.length === 0) {
        out(c.gray('  no past conversations'))
        return null
      }
      conversations.forEach((conv, i) => {
        out(
          `  ${c.cyan(String(i + 1).padStart(2))}. ${String(conv.title ?? 'Untitled').slice(0, 56)} ${c.gray(conv.channel ?? '')}`
        )
      })
      rl.pause()
      const pick = (await question(`  ${c.dim('number, or blank to cancel')}: `)).trim()
      rl.resume()
      const index = Number.parseInt(pick, 10) - 1
      if (!Number.isFinite(index) || !conversations[index]) return null
      state.conversationId = conversations[index].id
      out(c.gray(`  resumed ${conversations[index].title ?? 'Untitled'}`))
      return null
    }

    default:
      out(c.red(`  unknown command: /${command}`))
      out(c.gray('  /help for the list'))
      return null
  }
}

function expandPath(raw) {
  const trimmed = raw.trim()
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2))
  return path.resolve(trimmed)
}

async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Hand a delivered file to the desktop. On a headless box there is nothing to
 * hand it to, so say where the file is instead of failing silently — the phone
 * (or scp) is the way to actually look at it there.
 */
function openWithOs(target) {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    out(c.gray(`  no desktop session here — the file is at ${target}`))
    return
  }
  try {
    const child = spawn(opener, [target], {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32'
    })
    child.unref()
    out(c.gray(`  opened ${basename(target)}`))
  } catch {
    out(c.gray(`  could not open it — the file is at ${target}`))
  }
}

export { wrapText }
