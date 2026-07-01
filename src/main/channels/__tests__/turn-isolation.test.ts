/**
 * Isolation test for a background autonomous run overlapping a live chat turn.
 *
 * Autonomous background runs (heartbeat automations, procedure runs) go through
 * Agent.processAutonomous, which drives the SAME Agent — and the SAME agent-wide
 * corpus event bus — as the live Electron chat turn, and is NOT serialized
 * behind the channel TurnRunner's promise chain. The channel's TurnRunner
 * registers agent-wide corpus listeners for the duration of a turn and relays
 * every matching event to that turn's sink, stamped with the channel turnId.
 * Relayed corpus events carry no turnId of their own, so an autonomous run
 * firing while a chat turn is still streaming would have its tool/task/llm
 * events relayed into the live chat — corrupting the meter / token counters /
 * timeline and clobbering the active task id (so chat:cancel stopped the wrong,
 * autonomous, task).
 *
 * The fix: `autonomousTurnScope` (AsyncLocalStorage<boolean>) is set for the
 * duration of processAutonomous's respond(); TurnRunner's relay listener reads
 * it (corpus emit is synchronous, so the listener runs in the emitter's async
 * context) and drops events emitted from inside a background run. Fail-open:
 * no scope ⇒ a normal interactive/worker turn, relay as before.
 *
 * This exercises the REAL Corpus, TurnRunner, and ElectronChannel. The only
 * shim is a minimal `electron` module (deps touch `electron.app` at import
 * time); the isolation logic under test never calls into it.
 *
 * Run: npx tsx --tsconfig tsconfig.node.json src/main/channels/__tests__/turn-isolation.test.ts
 */

import Module from 'node:module'
import os from 'node:os'

// Shim `electron` so importing the runtime graph doesn't crash outside an
// Electron process. Must run before the dynamic imports below.
const loader = Module as unknown as { _load: (...a: unknown[]) => unknown }
const origLoad = loader._load
loader._load = function (this: unknown, ...args: unknown[]): unknown {
  if (args[0] === 'electron') {
    return {
      app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => os.tmpdir() }
    }
  }
  return origLoad.apply(this, args)
}

let passed = 0
let failed = 0
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
    return
  }
  failed++
  console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`)
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
async function waitFor(cond: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return
    await tick()
  }
  throw new Error('waitFor timed out')
}
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

type Sent = {
  channel: string
  payload: { turnId?: string; type?: string; payload?: Record<string, unknown> }
}
function makeSender(): {
  sent: Sent[]
  isDestroyed: () => boolean
  send: (c: string, p: unknown) => void
} {
  const sent: Sent[] = []
  return {
    sent,
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => {
      sent.push({ channel, payload: payload as Sent['payload'] })
    }
  }
}

async function run(): Promise<void> {
  const { Corpus, autonomousTurnScope } = await import('@main/runtime/corpus')
  const { TurnRunner } = await import('@main/channels/turn-runner')
  const { ElectronChannel } = await import('@main/channels/electron/channel')

  // ── 1. autonomousTurnScope is visible to a synchronously-dispatched listener
  // The fix rests on: corpus emit is synchronous (mitt), so a listener runs in
  // the emitter's async context and reads the emitter's scope — regardless of
  // which turn registered the listener.
  {
    const c = new Corpus({ devLog: false })

    // `as` casts: the assignments happen inside the listener closures,
    // which TS control-flow analysis can't see — without widening, the
    // literal-type narrowing makes the assertions below TS2367 errors.
    let insideAutonomous = false as boolean | undefined
    let outsideAutonomous = true as boolean | undefined
    // Listener registered OUTSIDE any autonomous scope, as a channel turn does.
    c.on('safety.approved', () => {
      insideAutonomous = autonomousTurnScope.getStore()
    })
    c.on('safety.denied', () => {
      outsideAutonomous = autonomousTurnScope.getStore()
    })

    autonomousTurnScope.run(true, () => c.emit('safety.approved', { id: '1' }))
    ok(
      'scope: emit inside autonomous run reads store=true',
      insideAutonomous === true,
      String(insideAutonomous)
    )

    c.emit('safety.denied', { id: '2' })
    ok(
      'scope: emit outside any run reads store=undefined',
      outsideAutonomous === undefined,
      String(outsideAutonomous)
    )
  }

  // ── 2. Full relay isolation through TurnRunner + ElectronChannel ────────
  {
    const corpus = new Corpus({ devLog: false })
    const stoppedTasks: string[] = []
    const started = deferred<void>()
    const gate = deferred<void>()
    let electronTurnId = ''

    // Fake Agent. A live chat turn's respond runs with NO autonomous scope
    // (exactly as the real Agent.respond does when called from the channel).
    const agent = {
      corpus,
      motor: {
        stopTask: async (id: string): Promise<void> => {
          stoppedTasks.push(id)
        }
      },
      respond: async (turn: { turnId: string }): Promise<unknown> => {
        electronTurnId = turn.turnId
        // This turn's own relayed events.
        corpus.emit('context.built', { tokenCount: 10, tokenBudget: 200000, sectionsIncluded: [] })
        corpus.emit('task.created', { taskId: 'electron_task', name: 'chat', stepsTotal: 1 })
        corpus.emit('tool.called', { taskId: 'electron_task', tool: 'electron_tool', args: {} })
        corpus.emit('llm.response', {
          provider: 'electron',
          inputTokens: 10,
          outputTokens: 20,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          durationMs: 3
        })
        started.resolve()
        await gate.promise // stay in-flight while the autonomous run emits
        corpus.emit('tool.completed', {
          taskId: 'electron_task',
          tool: 'electron_tool',
          durationMs: 3
        })
        return { stopReason: 'end_turn' as const, toolCalls: 1 }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runner = new TurnRunner(agent as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channel = new ElectronChannel(agent as any, runner)
    const sender = makeSender()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    channel.send(sender as any, { history: [{ role: 'user', content: 'hi' }] })
    await started.promise

    // A concurrent autonomous run (heartbeat/procedure) emits onto the same
    // corpus while the chat respond is in-flight. In the real app this is
    // processAutonomous wrapping respond() in autonomousTurnScope.run(true).
    autonomousTurnScope.run(true, () => {
      corpus.emit('task.created', { taskId: 'auto_task', name: 'hb', stepsTotal: 1 })
      corpus.emit('tool.called', { taskId: 'auto_task', tool: 'auto_tool', args: {} })
      corpus.emit('llm.response', {
        provider: 'auto',
        inputTokens: 999,
        outputTokens: 888,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        durationMs: 9
      })
      corpus.emit('tool.completed', { taskId: 'auto_task', tool: 'auto_tool', durationMs: 9 })
      corpus.emit('task.completed', { taskId: 'auto_task', durationMs: 9 })
    })

    const turnEvents = sender.sent.filter((s) => s.channel === 'chat:turnEvent')
    const blob = JSON.stringify(turnEvents)

    ok('relay: no autonomous task leaked', !blob.includes('auto_task'), blob)
    ok('relay: no autonomous tool leaked', !blob.includes('auto_tool'))
    ok('relay: no autonomous tokens leaked', !blob.includes('999'))
    ok(
      'relay: electron task.created is delivered',
      turnEvents.some(
        (e) => e.payload.type === 'task.created' && e.payload.payload?.taskId === 'electron_task'
      )
    )
    ok(
      'relay: electron llm.response is delivered',
      turnEvents.some(
        (e) => e.payload.type === 'llm.response' && e.payload.payload?.inputTokens === 10
      )
    )
    ok(
      'relay: every delivered event carries the electron turnId',
      turnEvents.length > 0 && turnEvents.every((e) => e.payload.turnId === electronTurnId)
    )

    // chat:cancel must stop the chat turn's task, not the autonomous one that
    // would otherwise have clobbered activeTaskId.
    await channel.cancel()
    ok(
      'cancel: stops the electron task (not the autonomous one)',
      stoppedTasks.length === 1 && stoppedTasks[0] === 'electron_task',
      JSON.stringify(stoppedTasks)
    )

    gate.resolve()
    await waitFor(() => sender.sent.some((s) => s.channel === 'chat:done'))
    ok(
      'relay: electron tool.completed delivered after in-flight window',
      sender.sent
        .filter((s) => s.channel === 'chat:turnEvent')
        .some(
          (e) => e.payload.type === 'tool.completed' && e.payload.payload?.tool === 'electron_tool'
        )
    )
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

void run()
