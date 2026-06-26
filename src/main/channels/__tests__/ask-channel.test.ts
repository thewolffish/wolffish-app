/**
 * Stress test for ask_user on the text-only channels (Telegram / WhatsApp).
 *
 * In-app the answer is a click; on Telegram/WhatsApp it's the user's NEXT
 * message — a number picks an option, any other text is "something else".
 * This pins the two pieces that make that work:
 *
 *   1. interpretAskReply — the SHARED decision logic both channels use to
 *      classify a reply (option / custom / reprompt). Table-driven, exhaustive.
 *   2. The full round-trip — the real `ask` plugin's execute() driven through a
 *      fake channel that wires the bridge exactly like the real channels do
 *      (handleAskRequest stores the resolver; the inbound reply runs through
 *      the real interpretAskReply; turn-end / abort resolve canceled). Proves
 *      plugin → bridge → channel reply → resolve → plugin output end to end.
 *
 * Run: npx tsx src/main/channels/__tests__/ask-channel.test.ts
 */

import { interpretAskReply, parseAskNumber } from '../ask-reply'
// The real ask capability plugin (ES module, same file the runtime loads).
import askPlugin from '../../../defaults/workspace/brain/cerebellum/ask/plugin/index.mjs'

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

// The regex the in-app QuestionCard uses to recover the chosen option from the
// persisted tool_result (kept in sync with renderer parseAnswer). Re-checked
// here so a Telegram/WhatsApp answer also highlights correctly in history.
function parseAnswerIndex(output: string): number | null {
  const m = output.match(/selected option (\d+) of \d+/i)
  return m ? Number(m[1]) - 1 : null
}

// ── 1. interpretAskReply — exhaustive table ────────────────────────────────
type Case = {
  text: string
  count: number
  allowOther: boolean
  expect: ReturnType<typeof interpretAskReply>
}
const N = 3
const CASES: Case[] = [
  // in-range numbers → option (0-based)
  { text: '1', count: N, allowOther: true, expect: { kind: 'option', index: 0 } },
  { text: '3', count: N, allowOther: true, expect: { kind: 'option', index: 2 } },
  { text: ' 2 ', count: N, allowOther: true, expect: { kind: 'option', index: 1 } },
  { text: '2\n', count: N, allowOther: true, expect: { kind: 'option', index: 1 } },
  { text: '02', count: N, allowOther: true, expect: { kind: 'option', index: 1 } },
  // out-of-range bare numbers → reprompt (a misclick, NOT instructions)
  { text: '0', count: N, allowOther: true, expect: { kind: 'reprompt', reason: 'out-of-range' } },
  { text: '4', count: N, allowOther: true, expect: { kind: 'reprompt', reason: 'out-of-range' } },
  { text: '99', count: N, allowOther: true, expect: { kind: 'reprompt', reason: 'out-of-range' } },
  // free text → custom (allowOther) — including text that CONTAINS a digit
  {
    text: 'sushi please',
    count: N,
    allowOther: true,
    expect: { kind: 'custom', text: 'sushi please' }
  },
  {
    text: 'do option 3 but cheaper',
    count: N,
    allowOther: true,
    expect: { kind: 'custom', text: 'do option 3 but cheaper' }
  },
  { text: '3 of them', count: N, allowOther: true, expect: { kind: 'custom', text: '3 of them' } },
  { text: '  trim me  ', count: N, allowOther: true, expect: { kind: 'custom', text: 'trim me' } },
  // allowOther = false → text / out-of-range both reprompt, in-range still works
  {
    text: 'whatever',
    count: N,
    allowOther: false,
    expect: { kind: 'reprompt', reason: 'need-number' }
  },
  { text: '9', count: N, allowOther: false, expect: { kind: 'reprompt', reason: 'out-of-range' } },
  { text: '2', count: N, allowOther: false, expect: { kind: 'option', index: 1 } },
  // single-option question
  { text: '1', count: 1, allowOther: true, expect: { kind: 'option', index: 0 } },
  { text: '2', count: 1, allowOther: true, expect: { kind: 'reprompt', reason: 'out-of-range' } }
]
for (const c of CASES) {
  const got = interpretAskReply(c.text, c.count, c.allowOther)
  ok(
    `interpret ${JSON.stringify(c.text)} (n=${c.count},other=${c.allowOther})`,
    JSON.stringify(got) === JSON.stringify(c.expect),
    `got ${JSON.stringify(got)} want ${JSON.stringify(c.expect)}`
  )
}

// strict number parser edge cases
ok('parseAskNumber pure', parseAskNumber('7') === 7)
ok('parseAskNumber padded', parseAskNumber('  7  ') === 7)
ok('parseAskNumber text+digit null', parseAskNumber('pick 7') === null)
ok('parseAskNumber empty null', parseAskNumber('') === null)
ok('parseAskNumber 3-digit null', parseAskNumber('100') === null)

// ── 2. Fake text channel mirroring the real handleAskRequest/resolvePendingAsk
type AskOption = { label: string; description?: string }
type AskResponse =
  | { kind: 'option'; index: number }
  | { kind: 'custom'; text: string }
  | { kind: 'canceled' }
  | { kind: 'unsupported' }

class FakeTextChannel {
  sent: string[] = []
  private pending: { options: AskOption[]; allowOther: boolean } | null = null
  private resolve: ((r: AskResponse) => void) | null = null

  // mirrors channel.handleAskRequest
  onAskUserRequest(req: {
    question: string
    options: AskOption[]
    allowOther: boolean
  }): Promise<AskResponse> {
    return new Promise<AskResponse>((resolve) => {
      if (this.resolve) this.resolve({ kind: 'canceled' }) // supersede prior
      this.pending = { options: req.options, allowOther: req.allowOther }
      this.resolve = resolve
      this.sent.push(`Q:${req.question}|opts:${req.options.length}|other:${req.allowOther}`)
    })
  }

  // mirrors the inbound handler + channel.resolvePendingAsk (real interpreter)
  reply(text: string): void {
    if (!this.pending || !this.resolve) {
      this.sent.push('no-pending')
      return
    }
    const outcome = interpretAskReply(text, this.pending.options.length, this.pending.allowOther)
    if (outcome.kind === 'option') {
      const opt = this.pending.options[outcome.index]
      this.pending = null
      const r = this.resolve
      this.resolve = null
      r({ kind: 'option', index: outcome.index })
      this.sent.push(`ack:option ${outcome.index + 1}: ${opt.label}`)
    } else if (outcome.kind === 'custom') {
      this.pending = null
      const r = this.resolve
      this.resolve = null
      r({ kind: 'custom', text: outcome.text })
      this.sent.push('ack:custom')
    } else {
      this.sent.push(`reprompt:${outcome.reason}`)
    }
  }

  endTurn(): void {
    if (this.resolve) {
      const r = this.resolve
      this.resolve = null
      this.pending = null
      r({ kind: 'canceled' })
    }
  }

  hasPending(): boolean {
    return this.pending !== null
  }
}

type Plugin = {
  init: (ctx: { askUser: (input: unknown) => Promise<AskResponse> }) => Promise<void>
  execute: (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<{ success: boolean; output?: string; error?: string }>
}
const plugin = askPlugin as unknown as Plugin

// Wire the plugin's askUser to the fake channel, exactly as Cerebellum does
// (inject toolCallId + id, then dispatch to the channel sink).
function wire(channel: FakeTextChannel): void {
  void plugin.init({
    askUser: (input) =>
      channel.onAskUserRequest({
        ...(input as { question: string; options: AskOption[]; allowOther: boolean })
        // toolCallId/id are injected by Cerebellum in the real path
      })
  })
}

const OPTS = [
  { label: 'Koyee', description: 'broad menu' },
  { label: 'Seoul', description: 'crowd favorite' }
]

async function run(): Promise<void> {
  // option pick
  {
    const ch = new FakeTextChannel()
    wire(ch)
    const p = plugin.execute('ask_user', { question: 'Where?', options: OPTS })
    await tick()
    ok('e2e option: question sent', ch.sent[0]?.startsWith('Q:Where?'), ch.sent.join(' | '))
    ch.reply('1')
    const r = await p
    ok('e2e option: success', r.success === true, JSON.stringify(r))
    ok(
      'e2e option: output names choice',
      /option 1 of 2/.test(r.output ?? '') && /Koyee/.test(r.output ?? ''),
      r.output
    )
    ok('e2e option: history parse round-trips', parseAnswerIndex(r.output ?? '') === 0, r.output)
  }

  // custom (something else) via free text
  {
    const ch = new FakeTextChannel()
    wire(ch)
    const p = plugin.execute('ask_user', { question: 'Where?', options: OPTS })
    await tick()
    ch.reply('somewhere with sushi')
    const r = await p
    ok('e2e custom: success', r.success === true, JSON.stringify(r))
    ok(
      'e2e custom: output carries text',
      /instead instructed/.test(r.output ?? '') && /sushi/.test(r.output ?? ''),
      r.output
    )
  }

  // out-of-range number → reprompt (stays pending), then a valid pick
  {
    const ch = new FakeTextChannel()
    wire(ch)
    const p = plugin.execute('ask_user', { question: 'Where?', options: OPTS })
    await tick()
    ch.reply('9')
    ok('e2e reprompt: still pending after bad number', ch.hasPending() === true)
    ok(
      'e2e reprompt: told to retry',
      ch.sent.some((s) => s.startsWith('reprompt:out-of-range'))
    )
    ch.reply('2')
    const r = await p
    ok(
      'e2e reprompt: resolves on valid retry',
      r.success === true && /option 2 of 2/.test(r.output ?? ''),
      r.output
    )
  }

  // digit-in-text must NOT be read as an option pick → custom
  {
    const ch = new FakeTextChannel()
    wire(ch)
    const p = plugin.execute('ask_user', { question: 'Where?', options: OPTS })
    await tick()
    ch.reply('do 2 but spicier')
    const r = await p
    ok(
      'e2e digit-in-text: treated as custom',
      r.success === true && /instead instructed/.test(r.output ?? ''),
      r.output
    )
  }

  // allowOther:false — free text reprompts, only a number resolves
  {
    const ch = new FakeTextChannel()
    wire(ch)
    const p = plugin.execute('ask_user', {
      question: 'Where?',
      options: OPTS,
      allow_other: false
    })
    await tick()
    ch.reply('neither')
    ok(
      'e2e no-other: text reprompts',
      ch.hasPending() === true && ch.sent.some((s) => s.startsWith('reprompt:need-number'))
    )
    ch.reply('1')
    const r = await p
    ok(
      'e2e no-other: number resolves',
      r.success === true && /option 1 of 2/.test(r.output ?? ''),
      r.output
    )
  }

  // turn ends before the user answers → canceled → graceful failure
  {
    const ch = new FakeTextChannel()
    wire(ch)
    const p = plugin.execute('ask_user', { question: 'Where?', options: OPTS })
    await tick()
    ch.endTurn()
    const r = await p
    ok(
      'e2e turn-end: canceled → failure',
      r.success === false && /dismiss|stop/i.test(r.error ?? ''),
      JSON.stringify(r)
    )
  }

  // user presses stop mid-question → abort signal unblocks execute()
  {
    const ch = new FakeTextChannel()
    wire(ch)
    const ac = new AbortController()
    const p = plugin.execute('ask_user', { question: 'Where?', options: OPTS }, ac.signal)
    await tick()
    ok('e2e abort: pending before abort', ch.hasPending() === true)
    ac.abort()
    const r = await p
    ok('e2e abort: unblocks with failure', r.success === false, JSON.stringify(r))
  }

  // superseding question cancels the prior pending one
  {
    const ch = new FakeTextChannel()
    let resolved: AskResponse | null = null
    const first = ch.onAskUserRequest({ question: 'first', options: OPTS, allowOther: true })
    void first.then((r) => {
      resolved = r
    })
    ch.onAskUserRequest({ question: 'second', options: OPTS, allowOther: true })
    await tick()
    ok(
      'supersede: prior resolves canceled',
      resolved !== null && (resolved as AskResponse).kind === 'canceled',
      JSON.stringify(resolved)
    )
    ok('supersede: latest is pending', ch.hasPending() === true)
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

void run()
