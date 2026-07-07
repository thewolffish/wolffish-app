/**
 * Tests for the LLM conversation titler (src/main/conversation-titler.ts).
 *
 * Titling is now a PURE LLM call to the chosen model, run up front before a
 * turn processes: it produces a title and persists it (writing a titled shell
 * for an in-app conversation whose file doesn't exist yet). Covered here:
 *  - the model's framing (quotes / "Title:" / trailing punctuation) is cleaned
 *  - a new conversation is persisted with the title (shell created)
 *  - an already-titled conversation is returned as-is with NO LLM call
 *  - the LLM being unreachable falls back to a plain trim (never throws)
 *
 * Redirects the workspace to a temp home BEFORE loading the runtime graph so
 * nothing touches the real ~/.wolffish workspace.
 *
 * Run: TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx src/main/__tests__/conversation-titler.test.ts
 */

import fs from 'node:fs'
import Module from 'node:module'
import os from 'node:os'
import path from 'node:path'

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'wolffish-titler-'))
;(os as unknown as { homedir: () => string }).homedir = (): string => TEST_HOME

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

async function run(): Promise<void> {
  const { titleFromMessage, ensureConversationTitle } = await import('@main/conversation-titler')
  const { loadConversation, createConversation, saveConversation } =
    await import('@main/conversations')

  // ── titleFromMessage cleans the model's framing ────────────────────────
  {
    const llm = { title: async (): Promise<{ text: string }> => ({ text: '"Weekly Report."' }) }
    const t = await titleFromMessage('draft my weekly report', llm)
    ok('clean: strips wrapping quotes and trailing period', t === 'Weekly Report', t)
  }
  {
    const llm = {
      title: async (): Promise<{ text: string }> => ({ text: 'Title: Plan the Trip\nextra' })
    }
    const t = await titleFromMessage('help me plan a trip', llm)
    ok('clean: strips "Title:" prefix and extra lines', t === 'Plan the Trip', t)
  }

  // ── ensureConversationTitle persists a titled shell for a new chat ──────
  {
    const id = `2099-01-01_00-00-00_000-titl01`
    let calls = 0
    const llm = {
      title: async (): Promise<{ text: string }> => {
        calls++
        return { text: 'Refactor the Auth Flow' }
      }
    }
    const title = await ensureConversationTitle(
      id,
      'refactor the auth flow please',
      'electron',
      llm
    )
    ok('new: returns the LLM title', title === 'Refactor the Auth Flow', title)
    const onDisk = await loadConversation(id)
    ok('new: shell was persisted with the title', onDisk?.title === 'Refactor the Auth Flow')
    ok(
      'new: shell carries the user message',
      onDisk?.messages.length === 1 && onDisk?.messages[0].role === 'user',
      JSON.stringify(onDisk?.messages)
    )
    ok('new: exactly one LLM call', calls === 1, String(calls))

    // Second call on the now-titled conversation: NO LLM call, existing title.
    const again = await ensureConversationTitle(id, 'a different message', 'electron', llm)
    ok('idempotent: keeps the existing title', again === 'Refactor the Auth Flow', again)
    ok('idempotent: no second LLM call', calls === 1, String(calls))
  }

  // ── an existing conversation with a real title is never re-titled ──────
  {
    const conv = createConversation(null)
    conv.title = 'Hand-Picked Title'
    conv.messages.push({ role: 'user', content: 'hello', timestamp: 1 })
    await saveConversation(conv)
    let calls = 0
    const llm = {
      title: async (): Promise<{ text: string }> => {
        calls++
        return { text: 'Should Not Be Used' }
      }
    }
    const title = await ensureConversationTitle(conv.id, 'hello again', 'electron', llm)
    ok('resumed: keeps the hand-picked title', title === 'Hand-Picked Title', title)
    ok('resumed: no LLM call', calls === 0, String(calls))
  }

  // ── the LLM being unreachable falls back to a plain trim (never throws) ─
  {
    const llm = {
      title: async (): Promise<{ text: string }> => {
        throw new Error('offline')
      }
    }
    const t = await titleFromMessage('summarize the quarterly earnings for me', llm)
    ok(
      'fallback: uses a trimmed slice of the message',
      t === 'summarize the quarterly earnings for me',
      t
    )
    // And a very long message is capped.
    const long = 'x'.repeat(500)
    const capped = await titleFromMessage(long, llm)
    ok('fallback: caps overly long titles', capped.length <= 80, String(capped.length))
  }

  // ── empty message → Untitled, no persistence ───────────────────────────
  {
    const llm = { title: async (): Promise<{ text: string }> => ({ text: 'nope' }) }
    const t = await titleFromMessage('   ', llm)
    ok('empty: returns Untitled', t === 'Untitled', t)
  }

  // ── title-source sanitizer: delivery markup never reaches the title ─────
  {
    // A caption-less attachment composes to ONLY the <attachments> block. It
    // must strip to empty and title as Untitled WITHOUT an LLM call (so the
    // model never sees the metadata and the fallback never slices a path).
    let calls = 0
    const llm = {
      title: async (): Promise<{ text: string }> => {
        calls++
        return { text: 'Should Not Run' }
      }
    }
    const block =
      '<attachments>\nThe user attached 1 file to this message:\n' +
      '  - photo.jpg (type=image, mime=image/jpeg, size=1234b, path=/Users/x/.wolffish/uploads/photo.jpg)\n' +
      '</attachments>'
    const t = await titleFromMessage(block, llm)
    ok('sanitize: caption-less attachment → Untitled', t === 'Untitled', t)
    ok('sanitize: no LLM call for pure-metadata message', calls === 0, String(calls))
  }
  {
    // The titler must hand the model the user's words, not the markup. Capture
    // the user message the title() call receives and assert every wrapper is gone.
    let seen = ''
    const llm = {
      title: async (userMessage: string): Promise<{ text: string }> => {
        seen = userMessage
        return { text: 'Plan The Trip' }
      }
    }
    const voice =
      '<voice_note lang="en">\nlet us plan a trip to japan\n\n' +
      '<attachments>\nThe user attached 1 file to this message:\n  - clip.ogg (type=audio, path=/tmp/clip.ogg)\n</attachments>'
    const t = await titleFromMessage(voice, llm)
    ok('sanitize: voice note titled from transcript', t === 'Plan The Trip', t)
    ok('sanitize: <voice_note> tag stripped from prompt', !seen.includes('<voice_note'), seen)
    ok('sanitize: <attachments> block stripped from prompt', !seen.includes('<attachments'), seen)
    ok('sanitize: transcript reached the model', seen.includes('plan a trip to japan'), seen)
  }
  {
    // Ordinary prose that merely contains < or > must NOT be mangled — the
    // sanitizer is anchored to the exact sentinel tags only.
    let seen = ''
    const llm = {
      title: async (userMessage: string): Promise<{ text: string }> => {
        seen = userMessage
        return { text: 'Compare Two Values' }
      }
    }
    const prose = 'why is a < b but c > d in this compare function'
    const t = await titleFromMessage(prose, llm)
    ok('sanitize: leaves ordinary angle brackets intact', seen.includes('a < b but c > d'), seen)
    ok('sanitize: still titles normally', t === 'Compare Two Values', t)
  }

  await fs.promises.rm(TEST_HOME, { recursive: true, force: true }).catch(() => undefined)
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

void run()
