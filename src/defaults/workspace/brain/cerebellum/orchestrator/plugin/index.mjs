/**
 * orchestrator — Wolffish drives live parallel worker sessions.
 *
 * Tools to spawn, prompt, await, close, and cancel worker sessions. Each worker
 * is a real agent turn on the worker model with the normal toolset MINUS channel
 * egress and MINUS delegation (two-level: a worker never spawns workers and never
 * messages the user). Orchestration is event-driven: spawn/send return at once
 * and the worker runs in the background; await_workers blocks only until the NEXT
 * worker lands, so the orchestrator reacts per-completion instead of stalling on
 * the slowest.
 *
 * All worker state — the registry, the abort controllers, the completion queue —
 * lives behind the `orchestrator` host bridge injected at init
 * (PluginContext.orchestrator), implemented over the Agent's active orchestration
 * session. Nothing is touched by hand here; the bridge is the single source of
 * truth so a worker can never be orphaned.
 */

// Worker-management bridge, injected at init by the main process. Present only
// to the orchestrator role in orchestrator mode; undefined otherwise.
let orchestrator

const toolDefinitions = [
  {
    name: 'spawn_worker',
    description:
      "Start a new worker session running in the background on an initial task. Returns immediately with the worker's id — it does NOT wait for the worker to finish. The worker is a full agent with the normal toolset minus channel sending and minus delegation: it cannot message the user or spawn its own workers. Compose a self-contained prompt; the worker sees only what you write here, never the user conversation or the other workers.",
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'The complete, self-contained task for the worker. Include every fact it needs — it has no access to the user conversation or the other workers. Say exactly what to produce and return.'
        },
        label: {
          type: 'string',
          description:
            'A short human label for this worker (e.g. "research-pricing", "draft-email"). Optional.'
        },
        effort: {
          type: 'string',
          enum: ['off', 'on', 'high', 'max'],
          description:
            "How hard this worker should reason — YOU set it per worker: 'off' (no reasoning, fastest/cheapest, for simple mechanical work), 'on' (light reasoning), 'high' (deep reasoning, the default for substantive work), 'max' (maximum reasoning, for the hardest sub-tasks). Match it to the difficulty of THIS worker's task. Optional — omit for the worker model's default."
        }
      },
      required: ['prompt']
    }
  },
  {
    name: 'send_to_worker',
    description:
      'Send a follow-up to a worker that has finished its previous task (status awaiting) and is idle. Returns immediately; the worker starts running again on the new message with its full prior context intact. Use this to iterate — ask for a revision, a deeper pass, or the next step.',
    parameters: {
      type: 'object',
      properties: {
        worker_id: {
          type: 'string',
          description: 'The id returned by spawn_worker (e.g. "w1").'
        },
        prompt: {
          type: 'string',
          description: 'The follow-up instruction. The worker remembers its earlier turns.'
        },
        effort: {
          type: 'string',
          enum: ['off', 'on', 'high', 'max'],
          description:
            "Optionally re-tune the worker's reasoning effort for this and later turns ('off' | 'on' | 'high' | 'max'). Omit to keep its current level."
        }
      },
      required: ['worker_id', 'prompt']
    }
  },
  {
    name: 'await_workers',
    description:
      'Block until the NEXT worker finishes and return its result. This is how you collect work. It returns the moment ONE worker lands — it does NOT wait for all of them; the rest keep running and you collect them with further await_workers calls. React to each result as it arrives. Returns nothing-left when no targeted worker is still running.',
    parameters: {
      type: 'object',
      properties: {
        worker_ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Restrict to these worker ids — return only when one of THEM lands. Omit to wait on the next of ANY running worker.'
        }
      },
      required: []
    }
  },
  {
    name: 'close_worker',
    description:
      'Close a worker for good once you have what you need from it. It stops accepting follow-ups and frees its slot. This is the tidy end state for a worker whose job is done.',
    parameters: {
      type: 'object',
      properties: {
        worker_id: { type: 'string', description: 'The id of the worker to close.' }
      },
      required: ['worker_id']
    }
  },
  {
    name: 'cancel_worker',
    description:
      'Cancel a worker immediately, aborting whatever it is doing right now (its in-flight tool call is killed). Use this when a worker is off-track or no longer needed. For a worker that finished cleanly, prefer close_worker.',
    parameters: {
      type: 'object',
      properties: {
        worker_id: { type: 'string', description: 'The id of the worker to cancel.' }
      },
      required: ['worker_id']
    }
  }
]

function missingBridge() {
  return {
    success: false,
    error:
      'Delegation is unavailable — orchestrator mode is not active for this turn. Just do the work yourself.'
  }
}

function str(v) {
  return typeof v === 'string' ? v.trim() : `${v ?? ''}`.trim()
}

const EFFORTS = new Set(['off', 'on', 'high', 'max'])
function effortOf(v) {
  const e = str(v)
  return EFFORTS.has(e) ? e : undefined
}

function runningSummary(excludeId) {
  const others = orchestrator
    .listWorkers()
    .filter((w) => w.id !== excludeId && w.status === 'running')
  if (others.length === 0) return 'No other workers are running.'
  return `Still running: ${others.map((w) => `${w.id} (${w.branchLabel})`).join(', ')}.`
}

function spawnWorker(args) {
  if (!orchestrator) return missingBridge()
  const prompt = str(args?.prompt)
  if (!prompt) return { success: false, error: 'spawn_worker: provide a `prompt`.' }
  const label = str(args?.label)
  const effort = effortOf(args?.effort)
  const id = orchestrator.spawnWorker(prompt, label || undefined, effort)
  return {
    success: true,
    output: `Spawned worker ${id}${label ? ` (${label})` : ''}${effort ? ` at ${effort} effort` : ''}. It's running in the background. Call await_workers to collect its result when you're ready — it won't block until then.`
  }
}

function sendToWorker(args) {
  if (!orchestrator) return missingBridge()
  const id = str(args?.worker_id)
  const prompt = str(args?.prompt)
  if (!id) return { success: false, error: 'send_to_worker: provide a `worker_id`.' }
  if (!prompt) return { success: false, error: 'send_to_worker: provide a `prompt`.' }
  try {
    orchestrator.sendToWorker(id, prompt, effortOf(args?.effort))
  } catch (err) {
    return { success: false, error: `send_to_worker: ${err instanceof Error ? err.message : String(err)}` }
  }
  return {
    success: true,
    output: `Sent follow-up to ${id}; it's running again with its full prior context. Collect it with await_workers.`
  }
}

async function awaitWorkers(args) {
  if (!orchestrator) return missingBridge()
  const ids = Array.isArray(args?.worker_ids)
    ? args.worker_ids.map(str).filter(Boolean)
    : undefined
  let landed
  try {
    landed = await orchestrator.awaitWorkers(ids && ids.length ? ids : undefined)
  } catch (err) {
    return { success: false, error: `await_workers: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (!landed) {
    return {
      success: true,
      output: ids && ids.length
        ? `None of those workers are still running — nothing to await.`
        : `No workers are running — nothing to await. Spawn some, or finish up.`
    }
  }
  const { id, result } = landed
  const view = orchestrator.listWorkers().find((w) => w.id === id)
  const label = view?.branchLabel ? ` (${view.branchLabel})` : ''
  const meta = `[finished: ${result.stopReason}, ${result.toolCalls} tool call${result.toolCalls === 1 ? '' : 's'}]`
  return {
    success: true,
    output: [
      `Worker ${id}${label} finished. ${meta}`,
      '',
      result.text,
      '',
      `${runningSummary(id)} ${id} is now idle (awaiting) — send_to_worker to follow up, or close_worker when done. Call await_workers again for the next landing.`
    ].join('\n')
  }
}

function closeWorker(args) {
  if (!orchestrator) return missingBridge()
  const id = str(args?.worker_id)
  if (!id) return { success: false, error: 'close_worker: provide a `worker_id`.' }
  try {
    orchestrator.closeWorker(id)
  } catch (err) {
    return { success: false, error: `close_worker: ${err instanceof Error ? err.message : String(err)}` }
  }
  return { success: true, output: `Closed ${id}. It will accept no more work.` }
}

function cancelWorker(args) {
  if (!orchestrator) return missingBridge()
  const id = str(args?.worker_id)
  if (!id) return { success: false, error: 'cancel_worker: provide a `worker_id`.' }
  try {
    orchestrator.cancelWorker(id)
  } catch (err) {
    return { success: false, error: `cancel_worker: ${err instanceof Error ? err.message : String(err)}` }
  }
  return { success: true, output: `Cancelled ${id} — its in-flight work was aborted.` }
}

const plugin = {
  name: 'orchestrator',
  tools: toolDefinitions,
  async init(context) {
    orchestrator = context?.orchestrator
  },
  async execute(toolName, args) {
    switch (toolName) {
      case 'spawn_worker':
        return spawnWorker(args ?? {})
      case 'send_to_worker':
        return sendToWorker(args ?? {})
      case 'await_workers':
        return awaitWorkers(args ?? {})
      case 'close_worker':
        return closeWorker(args ?? {})
      case 'cancel_worker':
        return cancelWorker(args ?? {})
      default:
        return { success: false, error: `orchestrator: unknown tool ${toolName}` }
    }
  }
}

export default plugin
