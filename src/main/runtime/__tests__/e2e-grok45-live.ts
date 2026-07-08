/**
 * LIVE end-to-end verification of grok-4.5 through wolffish's real pipeline:
 * Thalamus (Brain resolution, agent-role reasoning clamp, retry policy) →
 * XAIProvider (request building, SSE parsing, tool assembly) → production
 * xAI API — exercised in BOTH wolffish modes (single + workflow).
 *
 * Reads the live key from ~/.wolffish/workspace/config.json; never mutates it.
 * A fetch tap records each outbound request body so the reasoning_effort
 * actually sent per mode is asserted at the wire level.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 npx electron node_modules/tsx/dist/cli.mjs \
 *        src/main/runtime/__tests__/e2e-grok45-live.ts
 * (electron-as-node because thalamus.ts imports electron's net module)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { LocalProvider } from '@main/runtime/providers/local'
import { Thalamus } from '@main/runtime/thalamus'
import type { ChatMessage, StreamChunk, ToolUse } from '@main/runtime/thalamus'
import { WorkflowSession, type RunAgentTurn } from '@main/runtime/workflow'

const MODEL = 'grok-4.5'

// ── live key from the wolffish runtime config ────────────────────────────
function findXaiKey(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findXaiKey(item)
      if (hit) return hit
    }
    return null
  }
  if (node && typeof node === 'object') {
    const rec = node as Record<string, unknown>
    if (rec.id === 'xai' && typeof rec.apiKey === 'string') return rec.apiKey
    for (const value of Object.values(rec)) {
      const hit = findXaiKey(value)
      if (hit) return hit
    }
  }
  return null
}

const config = JSON.parse(
  readFileSync(join(homedir(), '.wolffish', 'workspace', 'config.json'), 'utf8')
)
const apiKey = findXaiKey(config)
if (!apiKey) {
  console.error('no live xai key in ~/.wolffish/workspace/config.json — skipping')
  process.exit(1)
}

// ── wire tap: capture what wolffish actually sends to api.x.ai ───────────
type WireCall = {
  model: string
  reasoning_effort?: string
  max_completion_tokens?: number
  max_tokens?: number
  stream?: boolean
}
const wire: WireCall[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.includes('api.x.ai') && typeof init?.body === 'string') {
    const body = JSON.parse(init.body) as WireCall
    wire.push({
      model: body.model,
      reasoning_effort: body.reasoning_effort,
      max_completion_tokens: body.max_completion_tokens,
      max_tokens: body.max_tokens,
      stream: body.stream
    })
  }
  return realFetch(input, init)
}) as typeof fetch

// ── the real Thalamus, Brain pointed at grok-4.5 ─────────────────────────
const thalamus = new Thalamus(new LocalProvider())
thalamus.setCloudProviders([{ id: 'xai', model: MODEL, apiKey }])
thalamus.setBrain({ providerId: 'xai', model: MODEL })

type Collected = {
  text: string
  reasoningChars: number
  toolCalls: ToolUse[]
  stopReason: string | null
  activeModel: string | null
  outputTokens: number
  errors: string[]
}

async function drive(options: Parameters<Thalamus['stream']>[0]): Promise<Collected> {
  const out: Collected = {
    text: '',
    reasoningChars: 0,
    toolCalls: [],
    stopReason: null,
    activeModel: null,
    outputTokens: 0,
    errors: []
  }
  for await (const chunk of thalamus.stream(options) as AsyncGenerator<StreamChunk>) {
    if (chunk.type === 'text') out.text += chunk.text
    else if (chunk.type === 'reasoning') out.reasoningChars += chunk.text.length
    else if (chunk.type === 'tool_call')
      out.toolCalls.push({ id: chunk.id, name: chunk.name, args: chunk.args })
    else if (chunk.type === 'turn_meta') {
      out.stopReason = chunk.stopReason
      out.outputTokens = chunk.usage?.outputTokens ?? 0
    } else if (chunk.type === 'active_model') out.activeModel = `${chunk.provider}/${chunk.model}`
    else if (chunk.type === 'error') out.errors.push(chunk.message)
    else if (chunk.type === 'no_provider_available') out.errors.push('no_provider_available')
  }
  return out
}

const SYSTEM = 'You are wolffish, a concise assistant. Follow instructions exactly.'
const RED_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC'

let failures = 0
function report(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`  PASS ${name}`)
  } catch (err) {
    failures++
    console.log(`  FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function main(): Promise<void> {
  // ════ SINGLE MODE ═══════════════════════════════════════════════════
  console.log('single mode — plain turn (brain mode: on → wire effort low)')
  const s1 = await drive({
    system: SYSTEM,
    messages: [{ role: 'user', content: 'Reply with exactly: ready' }],
    thinkingMode: 'on'
  })
  report('resolves to xai/grok-4.5', () => assert.equal(s1.activeModel, `xai/${MODEL}`))
  report('no errors', () => assert.deepEqual(s1.errors, []))
  report('text answer', () => assert.match(s1.text.toLowerCase(), /ready/))
  report('reasoning streamed (always-on)', () => assert.ok(s1.reasoningChars > 0))
  report('clean stop + usage', () => assert.ok(s1.stopReason === 'end_turn' && s1.outputTokens > 0))
  report('wire: effort low, max_completion_tokens, no max_tokens', () => {
    const w = wire.at(-1)
    assert.equal(w?.reasoning_effort, 'low')
    assert.equal(w?.max_completion_tokens, 65536)
    assert.equal(w?.max_tokens, undefined)
  })

  console.log('single mode — high effort math')
  const s2 = await drive({
    system: SYSTEM,
    messages: [{ role: 'user', content: 'What is 23*29? Reply with just the number.' }],
    thinkingMode: 'high'
  })
  report('correct answer', () => assert.match(s2.text, /667/))
  report('wire: effort high', () => assert.equal(wire.at(-1)?.reasoning_effort, 'high'))

  console.log('single mode — tool-call round trip')
  const tools = [
    {
      name: 'get_current_time',
      description: 'Get the current time in a timezone',
      parameters: {
        type: 'object',
        properties: { timezone: { type: 'string' } },
        required: ['timezone']
      }
    }
  ]
  const t1 = await drive({
    system: SYSTEM,
    messages: [{ role: 'user', content: 'What time is it in Riyadh right now? Use the tool.' }],
    thinkingMode: 'on',
    tools
  })
  report('emits tool_call', () => {
    assert.equal(t1.toolCalls.length, 1)
    assert.equal(t1.toolCalls[0].name, 'get_current_time')
  })
  report('stop reason tool_use', () => assert.equal(t1.stopReason, 'tool_use'))
  const followup: ChatMessage[] = [
    { role: 'user', content: 'What time is it in Riyadh right now? Use the tool.' },
    { role: 'assistant', content: t1.text, toolUses: t1.toolCalls },
    {
      role: 'tool',
      toolUseId: t1.toolCalls[0]?.id ?? 'call_0',
      toolName: 'get_current_time',
      content: '2026-07-09T21:37:00+03:00'
    }
  ]
  const t2 = await drive({ system: SYSTEM, messages: followup, thinkingMode: 'on', tools })
  report('final answer uses tool result', () => assert.match(t2.text, /21:37|9:37/))
  report('round trip ends cleanly', () => assert.equal(t2.stopReason, 'end_turn'))

  console.log('single mode — vision (image block)')
  const v1 = await drive({
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'One word: what colour is this image?' },
          { type: 'image', mediaType: 'image/png', data: RED_PNG }
        ]
      }
    ],
    thinkingMode: 'on'
  })
  report('sees the image', () => assert.match(v1.text.toLowerCase(), /red/))

  // ════ WORKFLOW MODE ═════════════════════════════════════════════════
  // Real WorkflowSession; runAgentTurn feeds each agent through the real
  // thalamus with role 'agent', which must clamp unsupported efforts
  // (master picks max/off — grok-4.5 honours neither) to the [on, high]
  // registry before the request is built.
  console.log('workflow mode — agents with clamped efforts')
  const runAgentTurn: RunAgentTurn = async (args) => {
    const res = await drive({
      system:
        'You are a focused wolffish workflow sub-agent. Complete the task in one short reply.',
      messages: args.history,
      thinkingMode: args.effort,
      role: 'agent',
      signal: args.signal
    })
    args.onLlmCall('xai', MODEL, {
      inputTokens: 0,
      outputTokens: res.outputTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0
    })
    return {
      text: res.text,
      stopReason: (res.stopReason ?? 'end_turn') as 'end_turn',
      failed: res.errors.length > 0
    }
  }
  const session = new WorkflowSession(
    'wf_e2e_grok45',
    runAgentTurn,
    () => ({ provider: 'xai', model: MODEL }),
    () => {}
  )
  session.plan(['verify'], 'grok-4.5 live e2e')

  session.spawn({
    task: 'Reply with exactly: alpha done',
    name: 'alpha',
    phase: 'verify',
    effort: 'max'
  })
  const a = await session.awaitNext()
  report('agent alpha (effort max) completes', () => {
    assert.ok(a && !a.result.failed)
    assert.match(a?.result.text.toLowerCase() ?? '', /alpha done/)
  })
  report('wire: max clamped to high for agent', () =>
    assert.equal(wire.at(-1)?.reasoning_effort, 'high')
  )

  session.spawn({
    task: 'Reply with exactly: beta done',
    name: 'beta',
    phase: 'verify',
    effort: 'off'
  })
  const b = await session.awaitNext()
  report('agent beta (effort off) completes', () => {
    assert.ok(b && !b.result.failed)
    assert.match(b?.result.text.toLowerCase() ?? '', /beta done/)
  })
  report('wire: off clamped to on → low for agent', () =>
    assert.equal(wire.at(-1)?.reasoning_effort, 'low')
  )

  const snap = session.snapshot()
  report('workflow snapshot: both agents completed', () => {
    assert.equal(snap.agents.length, 2)
    assert.ok(snap.agents.every((ag) => ag.status === 'completed'))
  })

  report('every wire call targeted grok-4.5 with a valid effort', () => {
    assert.ok(wire.length >= 7)
    for (const w of wire) {
      assert.equal(w.model, MODEL)
      assert.ok(w.reasoning_effort === 'low' || w.reasoning_effort === 'high')
      assert.equal(w.stream, true)
    }
  })

  console.log(
    failures === 0
      ? `\nALL PASS — ${wire.length} live grok-4.5 calls through the wolffish pipeline`
      : `\n${failures} FAILURE(S)`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('harness crashed:', err)
  process.exit(1)
})
