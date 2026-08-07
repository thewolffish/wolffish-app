#!/usr/bin/env node
/**
 * Wolffish CLI — the terminal surface.
 *
 * Runs as a plain Node process (under `ELECTRON_RUN_AS_NODE` from the app's own
 * binary, so nothing extra has to be installed) and talks to the Wolffish
 * daemon over a local socket. It holds no agent state of its own: every command
 * below is a call into the same IPC handlers the desktop windows use, which is
 * what makes "everything you can do in the app" true rather than aspirational.
 *
 * Exit codes are meant for scripts: 0 success, 1 the thing failed or is not in
 * the state you asked about, 2 you used the command wrong.
 */
import { fstatSync } from 'node:fs'
import { connect, daemonPid, DaemonClient } from './lib/client.mjs'
import { c, err, heading, icon, out, setColor, table, wrapText } from './lib/ui.mjs'
import { runTurn } from './lib/turn.mjs'
import { repl } from './commands/repl.mjs'
import {
  brain,
  capabilities,
  getSetting,
  listSettings,
  manageKeys,
  setSetting,
  variables
} from './commands/settings.mjs'
import {
  automations,
  browseFiles,
  deleteConversation,
  editDoc,
  editWorkspaceFile,
  listConversations,
  procedures,
  projects,
  resolveConversationId,
  showConversation,
  usage
} from './commands/workspace.mjs'
import { pathCommand, service, status } from './commands/service.mjs'
import { pair } from './commands/pair.mjs'

const USAGE = `
${c.bold('wolffish')} — your agent, in the terminal

${c.gray('CHAT')}
  wolffish                          open an interactive session
  wolffish "<prompt>"               one-shot; prints the answer and exits
  wolffish -p "<prompt>" -f a.pdf   attach files by path
  cat log.txt | wolffish -p "why?"  read the prompt's context from stdin

${c.gray('CONVERSATIONS')}
  wolffish ls                       list conversations
  wolffish show <id>                print a transcript
  wolffish resume [id]              continue one interactively
  wolffish rm <id>                  delete one

${c.gray('SETTINGS')}
  wolffish config [group]           every setting, with its current value
  wolffish config get <id>          one setting, with its description
  wolffish config set <id> <value>  change one
  wolffish keys                     which providers have keys
  wolffish keys set <provider>      enter a key (hidden, not in shell history)
  wolffish brain [provider model]   which model runs
  wolffish capabilities [on|off X]  the capability roster
  wolffish vars                     prompt variables

${c.gray('WORKSPACE')}
  wolffish project|procedure|automation …
  wolffish soul | user | agents     edit the shaping documents in $EDITOR
  wolffish files [filter]           browse the workspace
  wolffish edit <path>              edit a workspace file
  wolffish usage [range]            token + cost totals

${c.gray('MACHINE')}
  wolffish status                   daemon, brain, autostart, channels
  wolffish service install [--headless]
  wolffish service status|uninstall|stop|logs
  wolffish path status|install      make "wolffish" resolvable on PATH
  wolffish pair phone|whatsapp|telegram

${c.gray('FLAGS')}
  --verbose        show every tool call and result
  --json           machine-readable output where it applies
  --yes            auto-approve tool approvals for this run
  --no-color       plain text
`

function parseArgs(argv) {
  const flags = {
    verbose: false,
    json: false,
    yes: false,
    long: false,
    prompt: null,
    files: [],
    conversation: null
  }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--verbose' || arg === '-v') flags.verbose = true
    else if (arg === '--json') flags.json = true
    else if (arg === '--yes' || arg === '-y') flags.yes = true
    else if (arg === '--long' || arg === '-l') flags.long = true
    else if (arg === '--no-color') setColor(false)
    else if (arg === '-p' || arg === '--prompt') flags.prompt = argv[++i] ?? null
    else if (arg === '-f' || arg === '--file') flags.files.push(argv[++i])
    else if (arg === '-c' || arg === '--conversation') flags.conversation = argv[++i] ?? null
    else rest.push(arg)
  }
  return { flags, rest }
}

/**
 * Prompt context piped in, if any — lets `cat log | wolffish -p "why?"` work.
 *
 * Only reads when stdin is genuinely a PIPE. Testing `isTTY` alone is not
 * enough: stdin redirected from a terminal-less parent (a shell script, a
 * service manager, a CI job) is neither a TTY nor a pipe that will ever reach
 * EOF, and reading it there hangs the command forever with no output.
 */
async function readStdin() {
  if (process.stdin.isTTY) return ''
  try {
    const stat = fstatSync(0)
    if (!stat.isFIFO() && !stat.isFile()) return ''
  } catch {
    return ''
  }
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2))
  const [command, ...args] = rest

  if (command === 'help' || command === '--help' || command === '-h') {
    out(USAGE)
    return 0
  }
  if (command === 'version' || command === '--version') {
    const client = await connect({ autostart: false }).catch(() => null)
    if (!client) {
      out('wolffish (daemon not running)')
      return 0
    }
    const info = client.hello
    out(`wolffish ${info?.version ?? ''}`.trim())
    client.close()
    return 0
  }

  // These read the machine's own state, so they must report "not running"
  // rather than quietly starting a daemon to answer the question.
  const noAutostart = new Set(['status', 'service', 'path'])
  let client
  try {
    client = await connect({
      autostart: !noAutostart.has(command),
      quiet: flags.json
    })
  } catch {
    if (command === 'path' || command === 'service') {
      err(c.red('The Wolffish daemon is not running.'))
      err(c.gray('  start it with any other command, e.g.: wolffish status'))
      return 1
    }
    err(c.red('Could not reach the Wolffish daemon.'))
    err(
      wrapText(
        c.gray(
          daemonPid()
            ? 'A process is registered but the socket is unreachable — try: wolffish service stop, then run any command again.'
            : 'Nothing is running and it could not be started. Check the install, or run the app once.'
        ),
        2
      )
    )
    return 1
  }

  // `await` the dispatch rather than returning its promise: a bare
  // `return fn()` inside try/finally runs the finally BEFORE the promise
  // settles, which closed the socket out from under every in-flight request.
  try {
    return await dispatch(client, command, args, flags)
  } finally {
    // The REPL and the pairing watchers own their own lifetime; everything
    // else is done the moment its command returns.
    if (!['resume', 'pair', undefined].includes(command)) client.close()
  }
}

async function dispatch(client, command, args, flags) {
  {
    switch (command) {
      case undefined: {
        // `-p` is an explicit one-shot even with no positional prompt, and a
        // pipe on stdin is one implicitly: a script that pipes into wolffish
        // must never land in an interactive prompt it cannot answer.
        if (flags.prompt) return oneShot(client, '', flags)
        const piped = await readStdin()
        if (piped) return oneShot(client, piped, flags)
        return repl(client, { conversationId: flags.conversation, verbose: flags.verbose })
      }

      case 'ls':
      case 'list':
        return listConversations(client, { json: flags.json })

      case 'show':
        if (!args[0]) return usageError('wolffish show <id>')
        return showConversation(client, args[0], { verbose: flags.verbose, json: flags.json })

      case 'rm':
      case 'delete':
        if (!args[0]) return usageError('wolffish rm <id>')
        return deleteConversation(client, args[0])

      case 'resume': {
        const id = args[0] ? await resolveConversationId(client, args[0]) : null
        if (args[0] && !id) {
          err(c.red(`no conversation matching "${args[0]}"`))
          return 1
        }
        return repl(client, { conversationId: id, verbose: flags.verbose })
      }

      case 'config':
        if (args[0] === 'get') {
          if (!args[1]) return usageError('wolffish config get <id>')
          return getSetting(client, args[1], { json: flags.json })
        }
        if (args[0] === 'set') {
          if (!args[1] || args[2] === undefined)
            return usageError('wolffish config set <id> <value>')
          return setSetting(client, args[1], args.slice(2).join(' '))
        }
        return listSettings(client, { group: args[0], json: flags.json, long: flags.long })

      case 'keys':
        return manageKeys(client, args)

      case 'brain':
        return brain(client, args)

      case 'capabilities':
      case 'caps':
        return capabilities(client, args)

      case 'vars':
      case 'variables':
        return variables(client, args)

      case 'project':
      case 'projects':
        return projects(client, args)

      case 'procedure':
      case 'procedures':
        return procedures(client, args)

      case 'automation':
      case 'automations':
        return automations(client, args)

      case 'soul':
      case 'user':
      case 'agents':
        return editDoc(client, command)

      case 'files':
        return browseFiles(client, args[0])

      case 'edit':
        if (!args[0]) return usageError('wolffish edit <workspace path>')
        return editWorkspaceFile(client, args[0])

      case 'usage':
        return usage(client, args[0] ?? 'month', { json: flags.json })

      case 'status':
        return status(client, { json: flags.json })

      case 'service':
        return service(client, args)

      case 'path':
        return pathCommand(client, args)

      case 'pair':
        return pair(client, args)

      default: {
        // Anything unrecognized is treated as a prompt, so `wolffish "why is
        // the disk full"` works without remembering -p.
        const text = [command, ...args].join(' ')
        return oneShot(client, text, flags)
      }
    }
  }
}

async function oneShot(client, text, flags) {
  const piped = await readStdin()
  const prompt = [flags.prompt, text, piped].filter(Boolean).join('\n\n').trim()
  if (!prompt) return usageError('wolffish -p "<prompt>"')

  if (flags.yes) {
    // Approvals in a one-shot have nobody to ask. --yes is the explicit opt-in
    // that says "run unattended"; without it a flagged call is denied and the
    // turn says so, rather than hanging on a prompt no one will see.
    await client.invoke('runtime:setBypassPermissions', true).catch(() => undefined)
  }
  const result = await runTurn(
    client,
    {
      text: prompt,
      conversationId: flags.conversation,
      attachmentPaths: flags.files.length ? flags.files : undefined
    },
    { verbose: flags.verbose }
  )
  if (flags.yes) {
    await client.invoke('runtime:setBypassPermissions', false).catch(() => undefined)
  }
  if (result.error) return 1
  if (!flags.json) {
    out()
    out(
      c.gray(
        `  ${result.conversationId.slice(0, 8)} · wolffish resume ${result.conversationId.slice(0, 8)}`
      )
    )
  }
  return 0
}

function usageError(line) {
  err(c.red(`usage: ${line}`))
  return 2
}

main()
  .then((code) => {
    process.exitCode = code ?? 0
    // The socket keeps the event loop alive; commands that finished have
    // nothing left to wait for.
    if (process.exitCode !== undefined) setTimeout(() => process.exit(process.exitCode), 10).unref()
  })
  .catch((error) => {
    err(`${icon.fail()} ${c.red(error?.message ?? String(error))}`)
    process.exit(1)
  })

export { DaemonClient, heading, table }
