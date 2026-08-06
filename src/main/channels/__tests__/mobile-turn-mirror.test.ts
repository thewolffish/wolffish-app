/**
 * What the Mobile channel PUTS ON THE WIRE while it runs a turn for the phone.
 *
 * The phone's own tests pin how it renders what arrives; this pins what
 * arrives. Between them is the contract that was broken: this channel used to
 * push a bare `{turnId, kind}` on every tool segment — "re-read the
 * conversation" — while the assistant message it was announcing was still only
 * in memory. The phone obeyed, fetched the transcript from before the turn, and
 * the reply it was streaming vanished until the end-of-turn save.
 *
 * So the assertions are about the push stream itself: that mid-turn pushes
 * carry the message rather than ask for a fetch, that they carry the id the
 * turn will be SAVED under (the phone replaces by id — anything else shows the
 * answer twice), that the phone's own message id is honoured, and that the
 * clean-feed setting still decides what a live push may contain.
 *
 * Standalone — no vitest/jest in this repo. Run:
 *   npx tsx --tsconfig tsconfig.node.json src/main/channels/__tests__/mobile-turn-mirror.test.ts
 */

import Module from 'node:module'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// workspaceRoot() reads os.homedir() at module import — override first.
const SANDBOX = mkdtempSync(path.join(os.tmpdir(), 'wolffish-mobile-mirror-'))
process.env.HOME = SANDBOX

// Shim `electron` so the channel's import graph loads outside an Electron process.
const loader = Module as unknown as { _load: (...a: unknown[]) => unknown }
const origLoad = loader._load
loader._load = function (this: unknown, ...args: unknown[]): unknown {
  if (args[0] === 'electron') {
    return {
      app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => os.tmpdir() },
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (s: string) => Buffer.from(s),
        decryptString: (b: Buffer) => b.toString()
      }
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

type RpcHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown
type Push = { topic: string; payload: Record<string, unknown> }
type SinkLike = {
  onSegment: (segment: unknown) => void
  onDone: () => void
}

/** Wait for the sink's throttled mirror timer to fire. */
function afterThrottle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 600))
}

async function run(): Promise<void> {
  const { MobileChannel } = await import('@main/channels/mobile/channel')
  const { Rpc, Event } = await import('@main/tunnel/protocol')
  const { loadConversation } = await import('@main/conversations')

  const pushes: Push[] = []
  const handlers = new Map<string, RpcHandler>()
  const fakeTunnel = {
    onRpc: (method: string, handler: RpcHandler) => handlers.set(method, handler),
    emit: (topic: string, payload: Record<string, unknown>) => pushes.push({ topic, payload })
  }

  // The runner hands the channel back its own sink so the test can drive the
  // turn segment by segment, exactly as a real turn would. Kept per
  // conversation: several sends run below and each makes its own.
  const sinks = new Map<string, SinkLike>()
  const channel = new MobileChannel({
    agent: {},
    runner: {
      send: ({
        conversationId,
        makeSink
      }: {
        conversationId: string
        makeSink: (a: { turnId: string; conversationId: string | null }) => SinkLike
      }) => {
        sinks.set(conversationId, makeSink({ turnId: 'turn_1', conversationId: null }))
        return { turnId: 'turn_1', controller: new AbortController() }
      }
    },
    serializeCapabilities: async () => []
  } as never)
  ;(channel as unknown as { registerHandlers: (t: unknown) => void }).registerHandlers(fakeTunnel)
  // The tunnel is normally set when one connects; the push helpers read it.
  ;(channel as unknown as { tunnel: unknown }).tunnel = fakeTunnel

  const call = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const handler = handlers.get(method)
    if (!handler) throw new Error(`no handler registered for ${method}`)
    return Promise.resolve(handler(params))
  }
  const appended = (): Push[] => pushes.filter((p) => p.topic === Event.messageAppended)

  // ----------------------------------------------------- the phone sends one
  const PHONE_MESSAGE_ID = 'm_1754300000000_abc123'
  const sent = (await call(Rpc.sendMessage, {
    conversationId: null,
    messageId: PHONE_MESSAGE_ID,
    text: 'render me a chart'
  })) as { conversationId: string }
  ok('send answers with a conversation id', typeof sent.conversationId === 'string')

  // continueSend runs after the reply is on the wire.
  await new Promise((resolve) => setTimeout(resolve, 50))

  const created = await loadConversation(sent.conversationId)
  ok('a new conversation is stamped as started on mobile', created?.channel === 'mobile')
  ok(
    "the prompt is saved under the phone's own id",
    created?.messages[0]?.id === PHONE_MESSAGE_ID,
    created?.messages[0]?.id
  )

  // A phone that predates the field still works — the desktop mints one.
  const legacy = (await call(Rpc.sendMessage, {
    conversationId: null,
    text: 'no id from me'
  })) as { conversationId: string }
  await new Promise((resolve) => setTimeout(resolve, 50))
  const legacyConv = await loadConversation(legacy.conversationId)
  ok(
    'a prompt with no id still gets one',
    /^m_\d+_[0-9a-f]{6}$/.test(legacyConv?.messages[0]?.id ?? ''),
    legacyConv?.messages[0]?.id
  )
  // A malformed id is refused rather than stored.
  const hostile = (await call(Rpc.sendMessage, {
    conversationId: null,
    messageId: '../../etc/passwd',
    text: 'hello'
  })) as { conversationId: string }
  await new Promise((resolve) => setTimeout(resolve, 50))
  const hostileConv = await loadConversation(hostile.conversationId)
  ok(
    'a malformed message id is not adopted',
    hostileConv?.messages[0]?.id !== '../../etc/passwd',
    hostileConv?.messages[0]?.id
  )

  const turn = sinks.get(sent.conversationId)
  if (!turn) {
    ok('the runner received a sink for the first send', false)
    return
  }

  // --------------------------------------------------- the turn writes itself
  pushes.length = 0
  turn.onSegment({ kind: 'text', turnId: 'turn_1', segmentId: 's1', delta: 'Working on it.' })
  const firstText = appended()
  ok('the first segment mirrors immediately', firstText.length === 1)
  const mirrored = firstText[0]?.payload.message as { id?: string; content?: string } | undefined
  ok('a mid-turn push carries the message, not a request to fetch', mirrored?.id !== undefined)
  ok('... with the text so far', mirrored?.content === 'Working on it.')
  const MIRROR_ID = mirrored?.id
  ok(
    'text also streams as deltas for token-by-token rendering',
    pushes.some((p) => p.topic === Event.messageDelta && p.payload.text === 'Working on it.')
  )

  // Tool mechanics are held back from a live push while the feed is clean...
  pushes.length = 0
  turn.onSegment({
    kind: 'tool_call',
    turnId: 'turn_1',
    segmentId: 's2',
    toolCallId: 'c1',
    name: 'chart_render',
    args: {}
  })
  await afterThrottle()
  const clean = appended().at(-1)?.payload.message as { segments?: Array<{ kind: string }> }
  ok(
    'clean feed: a tool call is not pushed live',
    (clean?.segments ?? []).every((s) => s.kind !== 'tool_call'),
    JSON.stringify(clean?.segments?.map((s) => s.kind))
  )

  // ... and included once the Mobile panel's switch is on.
  await channel.setVerbose(true)
  pushes.length = 0
  turn.onSegment({
    kind: 'tool_result',
    turnId: 'turn_1',
    segmentId: 's3',
    toolCallId: 'c1',
    status: 'success',
    output: 'chart.json'
  })
  await afterThrottle()
  const verbose = appended().at(-1)?.payload.message as { segments?: Array<{ kind: string }> }
  ok(
    'verbose: the tool call and its result both ride the mirror',
    (verbose?.segments ?? []).some((s) => s.kind === 'tool_call') &&
      (verbose?.segments ?? []).some((s) => s.kind === 'tool_result'),
    JSON.stringify(verbose?.segments?.map((s) => s.kind))
  )

  // -------------------------------------------------------------- the turn ends
  pushes.length = 0
  turn.onDone()
  await new Promise((resolve) => setTimeout(resolve, 100))
  const saved = await loadConversation(sent.conversationId)
  const assistant = saved?.messages.find((m) => m.role === 'assistant')
  ok('the reply is persisted', assistant !== undefined)
  ok(
    'the saved message carries the id the phone was shown all turn',
    assistant?.id === MIRROR_ID,
    `${assistant?.id} vs ${MIRROR_ID}`
  )
  ok(
    'the end of the turn is announced after the save',
    pushes.some((p) => p.topic === Event.turnStatus && p.payload.state === 'done')
  )

  // ------------------------------------------------------- the oversize guard
  // An event is one frame; a push past the relay's record cap closes the
  // tunnel rather than arriving late. Too big degrades to the bare nudge.
  pushes.length = 0
  channel.pushMessageAppended('conv-x', {
    id: 'm_1_aaaaaa',
    role: 'assistant',
    content: 'x'.repeat(512 * 1024)
  })
  const guarded = appended().at(-1)
  ok(
    'an oversized mirror degrades to a nudge instead of being sent',
    guarded !== undefined && guarded.payload.message === undefined
  )

  // ------------------------------------------------------------- the prompt
  // The half that was missing. A turn run on the desktop keeps its user
  // message in the renderer's feed and writes it to disk only at the fold, so
  // the mirror is the only thing that can put it on a phone before the turn
  // ends — and a phone that pairs mid-turn sees nothing but mirror ticks.
  const PROMPT = { id: 'm_9_ccccc1', role: 'user', content: 'make me a pdf', timestamp: 9 }

  pushes.length = 0
  channel.pushMessageAppended(
    'conv-x',
    { id: 'm_1_aaaaaa', role: 'assistant', content: 'working' },
    PROMPT
  )
  const withPrompt = appended().at(-1)
  ok(
    'a mirror carries the prompt beside the answer',
    (withPrompt?.payload.userMessage as { id?: string } | undefined)?.id === PROMPT.id,
    JSON.stringify(withPrompt?.payload.userMessage)
  )

  pushes.length = 0
  channel.pushMessageAppended(
    'conv-x',
    { id: 'm_1_aaaaaa', role: 'assistant', content: 'x'.repeat(512 * 1024) },
    PROMPT
  )
  const degraded = appended().at(-1)
  ok(
    'an oversized mirror still carries the prompt with its nudge',
    degraded?.payload.message === undefined &&
      (degraded?.payload.userMessage as { id?: string } | undefined)?.id === PROMPT.id,
    JSON.stringify(degraded?.payload)
  )

  pushes.length = 0
  channel.pushMessageAppended('conv-x', undefined, PROMPT)
  const promptOnly = appended().at(-1)
  ok(
    'a prompt-only tick is a nudge plus the prompt',
    promptOnly?.payload.message === undefined &&
      (promptOnly?.payload.userMessage as { id?: string } | undefined)?.id === PROMPT.id
  )

  pushes.length = 0
  channel.pushMessageAppended('conv-x', undefined)
  ok(
    'a bare nudge stays bare — no empty prompt field on the wire',
    appended().at(-1) !== undefined && !('userMessage' in (appended().at(-1)?.payload ?? {}))
  )

  // ------------------------------------------- what the in-app channel mirrors
  // The renderer sends the LLM's copy of the prompt: the typed text dressed in
  // an <attachments> block, and for a voice note wrapped again in <voice_note>.
  // What reaches the phone has to be what the fold will save, or the bubble
  // shows markup for the length of the turn and then silently changes.
  const { ElectronChannel } = await import('@main/channels/electron/channel')
  type MirrorCall = { message: unknown; userMessage?: { content?: string; voicePrompt?: boolean } }
  const inAppMirrors: MirrorCall[] = []
  const inApp = new ElectronChannel(
    {} as never,
    {
      send: () => ({ turnId: 'turn_e', controller: new AbortController(), done: Promise.resolve() })
    } as never
  )
  inApp.setMessageMirror((_id, message, userMessage) => inAppMirrors.push({ message, userMessage }))

  const inAppSend = (content: string): MirrorCall | undefined => {
    inAppMirrors.length = 0
    inApp.send({} as never, {
      history: [{ role: 'user', content }],
      conversationId: 'conv-e',
      userMessageId: 'm_9_ccccc1'
    })
    return inAppMirrors.at(-1)
  }

  const plain = inAppSend('make me a pdf')
  ok(
    'the prompt is mirrored at send, before a single token',
    plain?.message === null && plain?.userMessage?.content === 'make me a pdf',
    JSON.stringify(plain)
  )

  const dressed = inAppSend(
    'here is the file\n\n<attachments>\nThe user attached 1 file to this message:\n  - a.pdf (type=file)\n</attachments>'
  )
  ok(
    'the model-facing attachment block is stripped back off',
    dressed?.userMessage?.content === 'here is the file',
    JSON.stringify(dressed?.userMessage?.content)
  )

  const spoken = inAppSend('<voice_note lang="en">\nread me the plan')
  ok(
    'a voice note mirrors its transcript, not its wrapper',
    spoken?.userMessage?.content === 'read me the plan' &&
      spoken?.userMessage?.voicePrompt === true,
    JSON.stringify(spoken?.userMessage)
  )

  inAppMirrors.length = 0
  inApp.send({} as never, { history: [{ role: 'user', content: 'x' }], conversationId: 'conv-e' })
  ok('no id, no mirrored prompt — an undroppable row is worse than none', inAppMirrors.length === 0)

  console.log(`${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
