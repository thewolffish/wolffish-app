/**
 * Turn scoring over the tunnel — the desktop half of the phone's rating bar.
 *
 * The phone paints a score under the finger and only ever keeps it because
 * this side said so, so what matters here is the ANSWER, not the write: a
 * refusal that arrives looking like a success leaves a score on screen that
 * exists nowhere, and a success that answers null takes a real vote back down.
 * Both are silent — the file and the phone simply disagree from then on.
 *
 * The other half is delivery: a ratings-only write moves no updated_at and
 * reindexes nothing, so `turn.scored` is the ONLY thing that tells a connected
 * phone, and the body is the only thing that tells one that reconnects later.
 * Neither is exercised by any other test, because nothing else on the wire
 * behaves this way.
 *
 * Standalone — no vitest/jest in this repo. Run:
 *   npx tsx --tsconfig tsconfig.node.json src/main/channels/__tests__/mobile-turn-score.test.ts
 */

import Module from 'node:module'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// workspaceRoot() reads os.homedir() at module import — override first.
const SANDBOX = mkdtempSync(path.join(os.tmpdir(), 'wolffish-mobile-score-'))
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
type Rating = { messageId: string; score: number; at: number; source: string }

const CONVERSATION = 'conv-scored'
const FIRST_ANSWER = 'm_1000_aaaaaa'
const LAST_ANSWER = 'm_3000_cccccc'

async function run(): Promise<void> {
  const { MobileChannel } = await import('@main/channels/mobile/channel')
  const { Rpc, Event } = await import('@main/tunnel/protocol')
  const { loadConversation, rateConversationTurn, saveConversation } =
    await import('@main/conversations')

  const pushes: Push[] = []
  const handlers = new Map<string, RpcHandler>()
  const fakeTunnel = {
    onRpc: (method: string, handler: RpcHandler) => handlers.set(method, handler),
    emit: (topic: string, payload: Record<string, unknown>) => pushes.push({ topic, payload })
  }

  // The dep index.ts injects, minus the corpus announcement it owns: the same
  // writer, under the source a phone vote records.
  const channel = new MobileChannel({
    agent: {},
    runner: { send: () => ({ turnId: 'turn_1', controller: new AbortController() }) },
    serializeCapabilities: async () => [],
    rateTurn: (conversationId: string, messageId: string | null, score: number) =>
      rateConversationTurn(conversationId, messageId, score, 'mobile')
  } as never)
  ;(channel as unknown as { registerHandlers: (t: unknown) => void }).registerHandlers(fakeTunnel)
  ;(channel as unknown as { tunnel: unknown }).tunnel = fakeTunnel

  const call = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const handler = handlers.get(method)
    if (!handler) throw new Error(`no handler registered for ${method}`)
    return Promise.resolve(handler(params))
  }

  const now = Date.now()
  await saveConversation({
    id: CONVERSATION,
    title: 'Scored',
    model: null,
    createdAt: now,
    updatedAt: now,
    messages: [
      { id: 'm_0900_ffffff', role: 'user', content: 'first', timestamp: now - 3000 },
      { id: FIRST_ANSWER, role: 'assistant', content: 'one', timestamp: now - 2000 },
      { id: 'm_2000_bbbbbb', role: 'user', content: 'second', timestamp: now - 1000 },
      { id: LAST_ANSWER, role: 'assistant', content: 'two', timestamp: now }
    ]
  })

  // ------------------------------------------------------------- a phone vote
  const first = (await call(Rpc.rateTurn, {
    conversationId: CONVERSATION,
    messageId: FIRST_ANSWER,
    score: 7
  })) as { rating: Rating | null }
  ok('a vote answers with the rating that was applied', first.rating?.score === 7)
  ok('... under the message it names', first.rating?.messageId === FIRST_ANSWER)
  ok('... recorded as cast on the phone', first.rating?.source === 'mobile')
  ok(
    'the score is on the conversation file',
    (await loadConversation(CONVERSATION))?.ratings?.length === 1
  )

  // Re-scoring replaces rather than accumulates — one rating per turn.
  await call(Rpc.rateTurn, { conversationId: CONVERSATION, messageId: FIRST_ANSWER, score: 2 })
  const revoted = (await loadConversation(CONVERSATION))?.ratings ?? []
  ok('a re-vote replaces the first', revoted.length === 1 && revoted[0]?.score === 2)

  // A score out of range is data, not a crash.
  const clamped = (await call(Rpc.rateTurn, {
    conversationId: CONVERSATION,
    messageId: LAST_ANSWER,
    score: 42
  })) as { rating: Rating | null }
  ok('an out-of-range score is clamped', clamped.rating?.score === 10)

  // The channel rule: no message named means the newest completed turn.
  await call(Rpc.rateTurn, { conversationId: CONVERSATION, messageId: null, score: 5 })
  const newest = (await loadConversation(CONVERSATION))?.ratings ?? []
  ok(
    'a vote naming no message scores the newest turn',
    newest.find((r) => r.messageId === LAST_ANSWER)?.score === 5,
    JSON.stringify(newest)
  )

  // ---------------------------------------------------- what cannot be scored
  const missing = (await call(Rpc.rateTurn, {
    conversationId: CONVERSATION,
    messageId: 'm_9999_zzzzzz',
    score: 9
  })) as { rating: Rating | null }
  ok('a message this file does not hold answers null', missing.rating === null)
  ok('... and writes nothing', ((await loadConversation(CONVERSATION))?.ratings ?? []).length === 2)

  const promptScored = (await call(Rpc.rateTurn, {
    conversationId: CONVERSATION,
    messageId: 'm_0900_ffffff',
    score: 9
  })) as { rating: Rating | null }
  ok('a user message is not a turn to score', promptScored.rating === null)

  let refusedUnknownConversation = false
  try {
    await call(Rpc.rateTurn, { conversationId: '', messageId: LAST_ANSWER, score: 1 })
  } catch {
    refusedUnknownConversation = true
  }
  ok('a vote with no conversation is refused', refusedUnknownConversation)

  let refusedNonNumber = false
  try {
    await call(Rpc.rateTurn, {
      conversationId: CONVERSATION,
      messageId: LAST_ANSWER,
      score: 'eight'
    })
  } catch {
    refusedNonNumber = true
  }
  ok('a score that is not a number is refused', refusedNonNumber)

  // --------------------------------------------------------------- delivery
  const body = (await call(Rpc.conversationBody, { id: CONVERSATION })) as {
    ratings?: Rating[]
  }
  ok(
    'the body carries every score the conversation holds',
    (body.ratings ?? []).length === 2,
    JSON.stringify(body.ratings)
  )

  pushes.length = 0
  channel.pushTurnScored(CONVERSATION, {
    messageId: LAST_ANSWER,
    score: 5,
    at: now,
    source: 'inapp'
  })
  const scored = pushes.find((p) => p.topic === Event.turnScored)
  ok('a score cast here is pushed to the phone', scored !== undefined)
  ok(
    '... carrying the rating itself, not a nudge to refetch',
    (scored?.payload.rating as Rating | undefined)?.score === 5 &&
      (scored?.payload.rating as Rating | undefined)?.messageId === LAST_ANSWER,
    JSON.stringify(scored?.payload)
  )

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

void run().catch((error) => {
  console.error(error)
  process.exit(1)
})
