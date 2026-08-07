/**
 * Running one turn from the terminal: stream it, answer its cards, and know
 * when it is over.
 *
 * Two behaviours are deliberate and worth stating.
 *
 * DETACH IS NOT CANCEL. Ctrl-C asks the daemon to stop the turn; it does not
 * kill the daemon, and quitting the client entirely leaves the turn running.
 * That is the point of the split — an SSH drop mid-task loses the view, not
 * the work.
 *
 * APPROVALS PARK. If this client goes away with an approval outstanding, the
 * daemon keeps it pending so a reattaching terminal (or the phone) can answer.
 * A denial-on-disconnect would silently refuse a tool call because a network
 * hiccup happened, which on a long unattended task is the worst possible
 * default.
 */
import { c, icon, out, question, wrapText } from './ui.mjs'
import { TurnRenderer } from './render.mjs'

/** Approve-all, remembered for this client session only. */
const alwaysApproved = new Set()

export async function runTurn(client, payload, { verbose = false } = {}) {
  const renderer = new TurnRenderer({ verbose })
  let turnId = null
  let conversationId = payload.conversationId ?? null
  let finished = false
  let failure = null

  const done = new Promise((resolve) => {
    const offTurn = client.onTurn(async (event) => {
      // Frames for another conversation (a Telegram run, an automation) share
      // this socket — the terminal must only render its own turn.
      if (turnId && event.turnId && event.turnId !== turnId) return

      switch (event.t) {
        case 'segment':
          renderer.segment(event.segment)
          return
        case 'turnEvent':
          renderer.turnEvent(event.type, event.payload)
          return
        case 'approvalRequest':
          await handleApproval(client, event)
          return
        case 'askRequest':
          await handleAsk(client, event)
          return
        case 'credentialBlocked':
          out(`${icon.gate()} ${c.yellow(`message discarded — it looked like a ${event.type}`)}`)
          return
        case 'done':
          finished = true
          offTurn()
          resolve()
          return
        case 'error':
          failure = event.error
          renderer.error(event.error)
          finished = true
          offTurn()
          resolve()
          return
        default:
          return
      }
    })
  })

  const started = await client.invoke('cli:send', payload)
  turnId = started.turnId
  conversationId = started.conversationId

  const onInterrupt = () => {
    if (finished) return
    out()
    out(c.yellow('  stopping…'))
    void client.invoke('cli:cancel', conversationId).catch(() => undefined)
  }
  process.on('SIGINT', onInterrupt)
  try {
    await done
  } finally {
    process.removeListener('SIGINT', onInterrupt)
    renderer.endTurn()
  }

  return { conversationId, turnId, files: renderer.deliveries(), error: failure }
}

/**
 * The approval card, as a blocking prompt. Fails CLOSED on a non-interactive
 * stdin: a piped `wolffish -p` cannot answer, and auto-approving a flagged
 * call because nobody was watching is exactly the wrong direction. Use
 * `--yes`, or turn on bypass-permissions deliberately.
 */
async function handleApproval(client, event) {
  const label = `${event.tool}`
  if (alwaysApproved.has(event.tool)) {
    await client.invoke('cli:approvalRespond', { id: event.id, decision: 'approved' })
    return
  }
  out()
  out(`${icon.gate()} ${c.bold('Approval needed')} ${c.gray(label)}`)
  if (event.reason) out(wrapText(c.gray(event.reason), 2))
  const args = event.args ? JSON.stringify(event.args) : ''
  if (args && args !== '{}') out(wrapText(c.gray(args.slice(0, 600)), 2))

  if (!process.stdin.isTTY) {
    out(c.red('  no terminal to ask — denied. Re-run interactively, or pass --yes.'))
    await client.invoke('cli:approvalRespond', { id: event.id, decision: 'denied' })
    return
  }

  const answer = (
    await question(`  ${c.bold('approve?')} ${c.dim('[y]es / [n]o / [a]lways this tool')} `)
  )
    .trim()
    .toLowerCase()
  if (answer === 'a' || answer === 'always') {
    alwaysApproved.add(event.tool)
    await client.invoke('cli:approvalRespond', { id: event.id, decision: 'approved' })
    return
  }
  const decision = answer === 'y' || answer === 'yes' ? 'approved' : 'denied'
  await client.invoke('cli:approvalRespond', { id: event.id, decision })
  if (decision === 'denied') out(c.gray('  denied'))
}

/**
 * The ask-the-user card. Each question takes a number (a listed option) or
 * free text (the card's custom field), matching the desktop's two answer
 * shapes exactly — the model receives the same structure either way.
 */
async function handleAsk(client, event) {
  const questions = Array.isArray(event.questions) ? event.questions : []
  if (questions.length === 0 || !process.stdin.isTTY) {
    await client.invoke('cli:askRespond', { id: event.id, response: { kind: 'canceled' } })
    return
  }
  out()
  const answers = []
  for (const [index, q] of questions.entries()) {
    out(`${icon.ask()} ${c.bold(q.question ?? q.header ?? `Question ${index + 1}`)}`)
    const options = Array.isArray(q.options) ? q.options : []
    options.forEach((option, i) => {
      out(`   ${c.cyan(String(i + 1))}. ${option.label ?? option}`)
      if (option.description) out(wrapText(c.gray(option.description), 6))
    })
    const hint = options.length > 0 ? `1-${options.length}, or type your own` : 'type your answer'
    const reply = (await question(`  ${c.dim(hint)}: `)).trim()
    if (reply.length === 0) {
      await client.invoke('cli:askRespond', { id: event.id, response: { kind: 'canceled' } })
      return
    }
    const picked = Number.parseInt(reply, 10)
    if (
      options.length > 0 &&
      Number.isFinite(picked) &&
      picked >= 1 &&
      picked <= options.length &&
      String(picked) === reply
    ) {
      answers.push({ kind: 'option', index: picked - 1 })
    } else {
      answers.push({ kind: 'custom', text: reply })
    }
  }
  await client.invoke('cli:askRespond', {
    id: event.id,
    response: { kind: 'answered', answers }
  })
}

export function markAlwaysApproved(tool) {
  alwaysApproved.add(tool)
}
