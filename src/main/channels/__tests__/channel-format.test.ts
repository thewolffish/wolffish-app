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
import { bidiMark, escapeHtml, validateTelegramHtml } from '../telegram/format'
import { stripInlineMarkup, validateWhatsAppFormat } from '../whatsapp/format'

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
function ok(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) {
    passed++
    return
  }
  failed++
  console.error(`FAIL ${label}\n  expected ok=${expected}, got ok=${actual}`)
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

// --- validateTelegramHtml (the telegram_check_format engine) ---

// The exact heartbeat failure: a stray </message> wrapper tag.
ok('stray wrapper tag is invalid', validateTelegramHtml('<b>Total</b> 😄</message>').ok, false)
ok('valid subset passes', validateTelegramHtml('<b>Digest</b>\n<i>2 unread</i> cost &lt;5').ok, true)
ok('plain text passes', validateTelegramHtml('just plain text, nothing to parse').ok, true)
ok('link with href passes', validateTelegramHtml('see <a href="https://x.example">docs</a>').ok, true)
ok('spoiler span passes', validateTelegramHtml('<span class="tg-spoiler">boo</span>').ok, true)
ok('unclosed tag is invalid', validateTelegramHtml('<b>bold with no close').ok, false)
ok('orphan closing tag is invalid', validateTelegramHtml('text </i> more').ok, false)
ok('leaked block tags invalid', validateTelegramHtml('<p>hi</p><br>').ok, false)
ok('bare ampersand is invalid', validateTelegramHtml('Tom & Jerry').ok, false)
ok('bare less-than is invalid', validateTelegramHtml('2 < 3 rule').ok, false)
ok('bare greater-than is fine', validateTelegramHtml('5 > 3 rule').ok, true)
// Leaked Markdown parses as HTML but renders raw on Telegram — also flagged.
ok('markdown bold flagged on telegram', validateTelegramHtml('**Digest**').ok, false)
ok('markdown heading flagged on telegram', validateTelegramHtml('# Digest\nbody').ok, false)
ok('markdown link flagged on telegram', validateTelegramHtml('see [docs](https://x.example)').ok, false)
ok('media marker fine on telegram', validateTelegramHtml('![m](wolffish-media://a.png)').ok, true)
ok('self-closing br is invalid', validateTelegramHtml('a<br/>b').ok, false)
// The reported problem is named in the issues so the model can self-correct.
eq(
  'stray tag issue names it',
  validateTelegramHtml('x</message>').issues.some((s) => s.includes('<message>')) ? 'named' : 'missing',
  'named'
)

// --- validateWhatsAppFormat (the whatsapp_check_format engine) ---

ok('markdown bold flagged', validateWhatsAppFormat('**Order arrived**').ok, false)
ok('whatsapp bold passes', validateWhatsAppFormat('*Order arrived* _53 SAR_').ok, true)
ok('heading flagged', validateWhatsAppFormat('# Digest\nbody').ok, false)
ok('markdown link flagged', validateWhatsAppFormat('see [docs](https://x.example)').ok, false)
ok('bare url passes', validateWhatsAppFormat('see https://x.example').ok, true)
ok('media marker not flagged', validateWhatsAppFormat('![meme](wolffish-media://a.png)').ok, true)
ok('table flagged', validateWhatsAppFormat('| item | price |\n| a | 5 |').ok, false)
ok('hr flagged', validateWhatsAppFormat('above\n---\nbelow').ok, false)
ok('lang fence flagged', validateWhatsAppFormat('```python\nprint(1)\n```').ok, false)
ok('bare fence passes', validateWhatsAppFormat('```\nprint(1)\n```').ok, true)

const total = passed + failed
console.log(`${passed}/${total} passed`)
if (failed > 0) process.exit(1)
