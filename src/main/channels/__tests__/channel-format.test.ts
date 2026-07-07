/**
 * Tests for the channel text helpers that remain after the egress
 * Markdown converters were removed (the model now writes channel-native
 * formatting itself — CHANNEL_PROMPTS in runtime/prefrontal.ts — and its
 * prose is sent verbatim). What still transforms text, and is covered
 * here, only touches CODE-composed surfaces:
 *
 *  - markdownToPlain (channels/format.ts): flattens Markdown-shaped tool
 *    output / system reports before a channel embeds them.
 *  - stripInlineMarkup (channels/whatsapp/format.ts): flattens labels
 *    embedded inside the WhatsApp ask-card's own *bold* wrappers.
 *  - escapeHtml + bidiMark (channels/telegram/format.ts): entity escaping
 *    for code-composed Telegram HTML, and the RTL/LTR direction mark.
 *
 * All modules are pure (no electron imports), so this runs standalone.
 * Run: npx tsx --tsconfig tsconfig.node.json src/main/channels/__tests__/channel-format.test.ts
 */

import { markdownToPlain } from '../format'
import { bidiMark, escapeHtml } from '../telegram/format'
import { stripInlineMarkup } from '../whatsapp/format'

let passed = 0
let failed = 0
function eq(label: string, actual: string, expected: string): void {
  if (actual === expected) {
    passed++
    return
  }
  failed++
  console.error(
    `FAIL ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`
  )
}

// --- markdownToPlain ---

eq('plain text untouched', markdownToPlain('exit code 0\nall good'), 'exit code 0\nall good')
eq('heading flattened', markdownToPlain('## Boarding details'), 'Boarding details')
eq('bold stripped', markdownToPlain('**Terminal 1** at RUH'), 'Terminal 1 at RUH')
eq('underscore bold stripped', markdownToPlain('__very__ important'), 'very important')
eq('italic stripped', markdownToPlain('that is *tomorrow* morning'), 'that is tomorrow morning')
eq('snake_case preserved', markdownToPlain('use turn_scope here'), 'use turn_scope here')
eq('arithmetic preserved', markdownToPlain('2 * 3 = 6 and 2*3=6'), '2 * 3 = 6 and 2*3=6')
eq('inline code unwrapped', markdownToPlain('run `npm i` now'), 'run npm i now')
eq('fence unwrapped', markdownToPlain('```python\nprint(1)\n```'), 'print(1)\n')
eq('bullets normalized', markdownToPlain('- a\n* b\n+ c'), '• a\n• b\n• c')
eq('link flattened', markdownToPlain('[docs](https://x.example)'), 'docs (https://x.example)')
eq('quote unwrapped', markdownToPlain('> gate closes 08:20'), 'gate closes 08:20')

// --- stripInlineMarkup (WhatsApp ask-card labels) ---

eq('bold marker stripped', stripInlineMarkup('**Use the fast path**'), 'Use the fast path')
eq('whatsapp bold stripped', stripInlineMarkup('*Yes*'), 'Yes')
eq('mixed markers stripped', stripInlineMarkup('_prefer_ `code` ~~old~~'), 'prefer code old')
eq('snake_case survives', stripInlineMarkup('keep turn_scope name'), 'keep turn_scope name')
eq(
  'link collapses to label (url)',
  stripInlineMarkup('[check-in](https://a.example)'),
  'check-in (https://a.example)'
)

// --- escapeHtml (Telegram code-composed surfaces) ---

eq('escapes the three entities', escapeHtml('a < b && c > d'), 'a &lt; b &amp;&amp; c &gt; d')
eq('plain text untouched by escape', escapeHtml('hello world'), 'hello world')

// --- bidiMark (Telegram paragraph direction) ---

eq('ltr text gets LRM', bidiMark('Hey! What is up?'), '\u200E')
eq('rtl text gets RLM', bidiMark('مرحبا بك'), '\u200F')
eq('leading punctuation skipped', bidiMark('«مرحبا»'), '\u200F')
eq('digits-only gets no mark', bidiMark('42'), '')

const total = passed + failed
console.log(`${passed}/${total} passed`)
if (failed > 0) process.exit(1)
