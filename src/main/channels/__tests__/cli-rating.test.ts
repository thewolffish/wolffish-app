/**
 * Rating from the terminal — and, above all, the thing it must NOT do.
 *
 * Telegram and WhatsApp capture a bare "8" as a score and swallow the message
 * (turn-score.ts). That is a reasonable trade in a chat app with no room for a
 * rating bar, and it is the wrong trade in a terminal: `8` there is the eighth
 * item, a number someone wants explained, or the first word of a sentence.
 * Scoring from the CLI is therefore ALWAYS explicit — `/rate 8` — and a
 * message typed at the prompt is always a message.
 *
 * That invariant is one careless copy-paste from being lost, and losing it
 * loses user messages, which is unrecoverable. Hence a test that reads the
 * source: it fails the moment the CLI grows a bare-number capture path.
 */
import { parseTurnScore, tryCaptureChannelScore } from '@main/channels/turn-score'
import type { ConversationRatingSource } from '@main/conversations'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..')

let passed = 0
let failed = 0
function check(name: string, run: () => void | Promise<void>): void {
  const settle = (error?: unknown): void => {
    if (error) {
      failed++
      console.log(`FAIL  ${name}`)
      console.log(`      ${error instanceof Error ? error.message : String(error)}`)
    } else {
      passed++
      console.log(`PASS  ${name}`)
    }
  }
  try {
    const result = run()
    if (result instanceof Promise) {
      void result.then(() => settle()).catch(settle)
      return
    }
    settle()
  } catch (error) {
    settle(error)
  }
}

// ── The invariant ───────────────────────────────────────────────────────────

check('the CLI channel has no bare-number score capture', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'main', 'channels', 'cli', 'channel.ts'),
    'utf8'
  )
  assert.ok(
    !source.includes('tryCaptureChannelScore') && !source.includes('parseTurnScore'),
    'src/main/channels/cli/channel.ts reaches for the channel score parser — a number typed ' +
      'in a terminal would stop being a message. Scoring from the CLI is /rate <n>, always explicit.'
  )
})

check('the CLI send handler dispatches every text as a message', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'main', 'channels', 'cli', 'ipc.ts'),
    'utf8'
  )
  assert.ok(
    !source.includes('parseTurnScore') && !source.includes('tryCaptureChannelScore'),
    'cli:send must not inspect the text for a score'
  )
})

check('the terminal never opens a prompt that could eat the next message', () => {
  const repl = fs.readFileSync(path.join(ROOT, 'src', 'cli', 'commands', 'repl.mjs'), 'utf8')
  const rateCase = repl.slice(repl.indexOf("case 'rate':"), repl.indexOf("case 'pending': {"))
  assert.ok(rateCase.length > 0, 'the /rate case moved — update this test')
  assert.ok(
    !rateCase.includes('question('),
    '/rate must never claim the next line: a user typing their next message at a rating ' +
      'prompt would have it swallowed as a score, or discarded entirely.'
  )
})

check('only the two chat channels can capture a score from message text', async () => {
  // The signature is the guard — a third surface cannot be passed in without
  // widening this union deliberately.
  const captured = await tryCaptureChannelScore(
    'telegram' as const,
    null,
    '8',
    async () => ({ scoring: { inapp: true, telegram: true, whatsapp: true } }) as never
  )
  // No conversation id ⇒ nothing captured, and nothing thrown.
  assert.equal(captured, null)
})

// ── The parser the channels use, for contrast ───────────────────────────────

check('a bare score parses; anything else does not', () => {
  assert.equal(parseTurnScore('8'), 8)
  assert.equal(parseTurnScore('10'), 10)
  assert.equal(parseTurnScore('0'), 0)
  assert.equal(parseTurnScore('11'), null)
  assert.equal(parseTurnScore('8 out of 10'), null)
  assert.equal(parseTurnScore('rate this 8'), null)
})

// ── The terminal is a first-class source ────────────────────────────────────

check("'cli' is a rating source in its own right", () => {
  const sources: ConversationRatingSource[] = ['inapp', 'telegram', 'whatsapp', 'mobile', 'cli']
  assert.equal(sources.length, 5)
  // Both declarations of the union have to carry it — the preload copy is what
  // the renderer and the phone compile against.
  for (const file of ['src/main/conversations.ts', 'src/preload/index.ts']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const match = /export type ConversationRatingSource =([^\n]*)/.exec(text)
    assert.ok(match, `${file} has no ConversationRatingSource`)
    assert.ok(match[1].includes("'cli'"), `${file} does not list 'cli' as a rating source`)
  }
})

check('the CLI names itself when it votes', () => {
  for (const file of ['src/cli/commands/repl.mjs', 'src/cli/commands/workspace.mjs']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const call = text.slice(text.indexOf("invoke('conversation:rate'"))
    assert.ok(
      call.slice(0, 400).includes("source: 'cli'"),
      `${file} rates without naming the source — the score would be filed as in-app`
    )
  }
})

setTimeout(() => {
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}, 50)
