/**
 * Tests for the WhatsApp Markdown converter (channels/whatsapp/format.ts).
 *
 * WhatsApp renders no Markdown — the converter rewrites the model's
 * Markdown into WhatsApp's own formatting at egress. Two properties are
 * load-bearing and exercised heavily here:
 *
 *  1. Markdown constructs (bold, headings, tables, links, fences) map to
 *     their closest WhatsApp rendering, never leak as raw syntax.
 *  2. Idempotence: text that is ALREADY WhatsApp-formatted (single
 *     *bold*, _italic_, ~strike~, "- " bullets, "> " quotes, ``` blocks)
 *     passes through byte-identical — the converter runs on every send
 *     path, including bodies the model wrote in WhatsApp style because
 *     the channel prompt overlay told it to.
 *
 * The module is pure (no electron imports), so this runs standalone.
 * Run: npx tsx --tsconfig tsconfig.node.json src/main/channels/__tests__/whatsapp-format.test.ts
 */

import { markdownToWhatsApp, stripInlineMarkup } from '../whatsapp/format'

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
function unchanged(label: string, input: string): void {
  eq(label, markdownToWhatsApp(input), input)
}

// --- Plain prose passes through ---

unchanged('plain sentence', 'Your flight leaves at 08:50 from Terminal 1. Safe travels!')
unchanged('multi-paragraph prose', 'First paragraph.\n\nSecond paragraph with numbers 2*3=6.')
unchanged('arabic prose', 'رحلتك تغادر الساعة ٨:٥٠ من الصالة رقم ١')

// --- Idempotence on WhatsApp-native formatting ---

unchanged('whatsapp bold', 'Departure is at *08:50* sharp.')
unchanged('whatsapp italic', 'That is _tomorrow morning_ by the way.')
unchanged('whatsapp strikethrough', 'The gate is ~B12~ B14.')
unchanged('whatsapp inline code', 'Run `npm run typecheck` first.')
unchanged('whatsapp monospace block', '```\nls -la\n```')
unchanged('whatsapp bullets', '- passport\n- boarding pass\n- charger')
unchanged('whatsapp numbered list', '1. Check in\n2. Security\n3. Gate')
unchanged('whatsapp quote', '> gate closes 08:20\nNoted.')
unchanged('whatsapp label lines', '*Flight:* F3 505\n*Seat:* 17C')
unchanged('single-line triple backticks', 'Use ```code``` style here.')

// Double conversion — the emit layer may see text that already went
// through the converter once (e.g. whatsapp_send after prompt-steered
// output). Second pass must be a no-op.
{
  const md = '## Flight\n\n**Departure** at 08:50 — see [details](https://fly.example).'
  const once = markdownToWhatsApp(md)
  eq('double conversion is a no-op', markdownToWhatsApp(once), once)
}

// --- Bold / strikethrough / headings ---

eq('double-asterisk bold', markdownToWhatsApp('**Terminal 1** at RUH'), '*Terminal 1* at RUH')
eq('double-underscore bold', markdownToWhatsApp('__very__ important'), '*very* important')
eq('strikethrough', markdownToWhatsApp('~~cancelled~~ rescheduled'), '~cancelled~ rescheduled')
eq('h2 heading', markdownToWhatsApp('## Boarding details'), '*Boarding details*')
eq('h1 with inner bold', markdownToWhatsApp('# Flight **F3 505**'), '*Flight F3 505*')
eq('closed atx heading', markdownToWhatsApp('### Gate info ###'), '*Gate info*')
eq(
  'bold inside quote line',
  markdownToWhatsApp('> **note:** gate closes 08:20'),
  '> *note:* gate closes 08:20'
)

// --- Links and images ---

eq(
  'inline link',
  markdownToWhatsApp('See [check-in](https://flyadeal.com/checkin) now'),
  'See check-in (https://flyadeal.com/checkin) now'
)
eq(
  'self link keeps url only',
  markdownToWhatsApp('[https://a.example](https://a.example)'),
  'https://a.example'
)
eq(
  'image with alt',
  markdownToWhatsApp('![boarding pass](https://a.example/bp.png)'),
  'boarding pass (https://a.example/bp.png)'
)
eq(
  'image without alt',
  markdownToWhatsApp('![](https://a.example/x.png)'),
  'https://a.example/x.png'
)

// --- Code regions are verbatim ---

eq(
  'fence language dropped, contents untouched',
  markdownToWhatsApp('```python\nprint("**not bold**")\n```'),
  '```\nprint("**not bold**")\n```'
)
eq(
  'inline code protects markers',
  markdownToWhatsApp('use `**argv` carefully'),
  'use `**argv` carefully'
)
eq(
  'table syntax inside fence untouched',
  markdownToWhatsApp('```\n| a | b |\n|---|---|\n| 1 | 2 |\n```'),
  '```\n| a | b |\n|---|---|\n| 1 | 2 |\n```'
)
eq('bold wrapping inline code', markdownToWhatsApp('**run `ls` now**'), '*run `ls` now*')

// --- Bullets, tasks, rules ---

eq('asterisk bullets', markdownToWhatsApp('* one\n* two'), '- one\n- two')
eq('plus bullets', markdownToWhatsApp('+ one\n+ two'), '- one\n- two')
eq('nested bullets keep indent', markdownToWhatsApp('- a\n  * b'), '- a\n  - b')
eq('task list', markdownToWhatsApp('- [ ] pack\n- [x] check in'), '- ☐ pack\n- ☑ check in')
eq('horizontal rule dropped', markdownToWhatsApp('above\n\n---\n\nbelow'), 'above\n\n\n\nbelow')

// --- Tables ---

// The exact failure that motivated this converter: a boarding-pass reply
// rendered as raw Markdown in WhatsApp.
{
  const boardingPass = [
    '| Detail | Value |',
    '|---|---|',
    '| **Flight** | flyadeal F3 505 |',
    '| **From** | RUH — King Khalid International, **Terminal 1** |',
    '| **Departure** | 08:50 |',
    '| **Seat** | 17C — Zone 2 |'
  ].join('\n')
  eq(
    'two-column table becomes label lines',
    markdownToWhatsApp(boardingPass),
    [
      '*Flight:* flyadeal F3 505',
      '*From:* RUH — King Khalid International, *Terminal 1*',
      '*Departure:* 08:50',
      '*Seat:* 17C — Zone 2'
    ].join('\n')
  )
}

{
  const wide = [
    '| Flight | From | To | Seat |',
    '|---|---|---|---|',
    '| F3 505 | RUH | DXB | 17C |',
    '| F3 506 | DXB | RUH | 4A |'
  ].join('\n')
  eq(
    'wide table becomes row blocks',
    markdownToWhatsApp(wide),
    [
      '*F3 505*',
      'From: RUH',
      'To: DXB',
      'Seat: 17C',
      '',
      '*F3 506*',
      'From: DXB',
      'To: RUH',
      'Seat: 4A'
    ].join('\n')
  )
}

// The label comes from the row's first cell, not the header.
eq('table with alignment colons', markdownToWhatsApp('| a | b |\n|:---|---:|\n| 1 | 2 |'), '*1:* 2')
eq(
  'prose pipe is not a table',
  markdownToWhatsApp('either this | or that\nand more text'),
  'either this | or that\nand more text'
)
eq(
  'table surrounded by prose',
  markdownToWhatsApp('Here:\n\n| K | V |\n|---|---|\n| Gate | B12 |\n\nDone.'),
  'Here:\n\n*Gate:* B12\n\nDone.'
)

// --- Sentinel safety (regression: space-delimited placeholders leaked) ---

// Inline code at the edge of a heading or table cell sits exactly where
// trims destroyed the old placeholders and shipped 'WOLFFISH_WA_N' to chat.
eq('heading ending in code', markdownToWhatsApp('## Install `npm`'), '*Install `npm`*')
eq('heading that is only code', markdownToWhatsApp('### `config.json`'), '*`config.json`*')
eq(
  'table cell that is only code',
  markdownToWhatsApp('| Command | Purpose |\n|---|---|\n| build | `npm run build` |'),
  '*build:* `npm run build`'
)
// A code-span key keeps its backticks (code stays code inside the bold
// label) — the point is no sentinel/raw-markdown leak, not marker removal.
eq(
  'code as table key cell',
  markdownToWhatsApp('| K | V |\n|---|---|\n| `id` | 42 |'),
  '*`id`:* 42'
)
// No output may ever contain a stash sentinel or the old placeholder text.
{
  const probe = markdownToWhatsApp('## `a`\n\n| x | `y` |\n|---|---|\n| `k` | v |\n\n* **b** c')
  eq('no sentinel leakage', /[\uE000\uE001]|WOLFFISH_WA_/.test(probe) ? 'LEAK' : 'clean', 'clean')
}
// Input containing sentinel code points is sanitized, not corrupted.
eq('input sentinels stripped', markdownToWhatsApp('a \uE0000\uE001 b **c**'), 'a 0 b *c*')

// --- Bullets starting with bold/code (regression: jammed '-*Fast:*') ---

eq(
  'asterisk bullet starting with bold',
  markdownToWhatsApp('* **Fast:** does it quickly'),
  '- *Fast:* does it quickly'
)
eq('bullet starting with code', markdownToWhatsApp('* `npm i` to install'), '- `npm i` to install')
eq(
  'task starting with bold',
  markdownToWhatsApp('- [ ] **Write** the tests'),
  '- ☐ *Write* the tests'
)
eq(
  'nested bullet starting with bold',
  markdownToWhatsApp('  * **Nested:** value'),
  '  - *Nested:* value'
)

// --- Links inside headings (regression: raw [x](y) leak + idempotence) ---

{
  const input = '## See the [API docs](https://api.example.com/v2) for details'
  const expected = '*See the API docs (https://api.example.com/v2) for details*'
  eq('link inside heading', markdownToWhatsApp(input), expected)
  eq('link-in-heading idempotent', markdownToWhatsApp(expected), expected)
}

// --- Nested emphasis and exponents ---

eq(
  'italic nested in bold',
  markdownToWhatsApp('This is **really *very* important** to know'),
  'This is *really _very_ important* to know'
)
eq(
  'lone asterisk inside bold',
  markdownToWhatsApp('The result of **2 * 3** is 6'),
  'The result of *2 * 3* is 6'
)
unchanged('python exponents never cross-pair', 'Note that 2**8 = 256 and 2**10 = 1024 in Python.')
unchanged('multi-line bold is left alone', '**bold spanning\ntwo lines**')

// --- Setext and quoted headings ---

eq(
  'setext dash heading',
  markdownToWhatsApp('Release Notes\n-------------\n\nStuff happened.'),
  '*Release Notes*\n\nStuff happened.'
)
eq(
  'setext equals heading',
  markdownToWhatsApp('Release Notes\n=============\n\nStuff happened.'),
  '*Release Notes*\n\nStuff happened.'
)
eq(
  'heading inside blockquote',
  markdownToWhatsApp('> ## Warning\n> Do not do this.'),
  '> *Warning*\n> Do not do this.'
)

// --- Table edge shapes ---

eq(
  'prose pipe line after table is not absorbed',
  markdownToWhatsApp('| A | B |\n|---|---|\n| 1 | 2 |\nEither way the choice is A | B for now.'),
  '*1:* 2\nEither way the choice is A | B for now.'
)
unchanged('separator-less table passes through', '| Name | Age |\n| Ali | 30 |\n| Sara | 25 |')

// --- stripInlineMarkup ---

eq('strip bold', stripInlineMarkup('**Terminal 1**'), 'Terminal 1')
eq('strip mixed', stripInlineMarkup('**a** and `b` and ~~c~~'), 'a and b and c')
eq('strip keeps snake_case', stripInlineMarkup('keep snake_case_name'), 'keep snake_case_name')

// --- Mixed realistic document ---

{
  const doc = [
    '## Flight summary',
    '',
    'Your flight **F3 505** departs **tomorrow**:',
    '',
    '| Detail | Value |',
    '|---|---|',
    '| Boarding | 08:05 |',
    '| Gate closes | 08:20 |',
    '',
    '* Arrive by 07:50',
    '* Bring your passport',
    '',
    'Details: [flyadeal](https://flyadeal.com)'
  ].join('\n')
  eq(
    'full document conversion',
    markdownToWhatsApp(doc),
    [
      '*Flight summary*',
      '',
      'Your flight *F3 505* departs *tomorrow*:',
      '',
      '*Boarding:* 08:05',
      '*Gate closes:* 08:20',
      '',
      '- Arrive by 07:50',
      '- Bring your passport',
      '',
      'Details: flyadeal (https://flyadeal.com)'
    ].join('\n')
  )
}

// --- Arabic content with Markdown ---

eq('arabic bold', markdownToWhatsApp('**الرحلة** تغادر الساعة ٨:٥٠'), '*الرحلة* تغادر الساعة ٨:٥٠')
eq(
  'arabic table',
  markdownToWhatsApp('| البند | القيمة |\n|---|---|\n| **الرحلة** | F3 505 |'),
  '*الرحلة:* F3 505'
)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
