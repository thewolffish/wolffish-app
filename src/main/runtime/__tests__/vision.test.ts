/**
 * Vision capability gate tests — the well-known-family check that keeps
 * image blocks away from text-only model APIs (the DeepSeek HTTP 400
 * `unknown variant image_url` class of failure), plus the strip helpers
 * that replace visual content with an explanatory note.
 *
 * Run: npx tsx src/main/runtime/__tests__/vision.test.ts
 */

import type { ChatMessage } from '../thalamus'
import { cloudModelSupportsVision, hasVisualContent, stripVisualContent } from '../vision'

let passed = 0
let failed = 0

function check(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    passed++
    return
  }
  failed++
  console.error(`FAIL ${label}: expected ${String(expected)}, got ${String(actual)}`)
}

// ---------------------------------------------------------------------------
// cloudModelSupportsVision
// ---------------------------------------------------------------------------

const CASES: Array<[provider: string, model: string, vision: boolean]> = [
  // deepseek — text-only across the lineup (the original bug)
  ['deepseek', 'deepseek-v4-pro', false],
  ['deepseek', 'deepseek-v4-flash', false],
  ['deepseek', 'deepseek-chat', false],
  ['deepseek', 'deepseek-reasoner', false],
  // anthropic — every Claude chat model accepts images
  ['anthropic', 'claude-sonnet-4-5', true],
  ['anthropic', 'claude-fable-5', true],
  ['anthropic', 'claude-haiku-4-5-20251001', true],
  // openai — vision families with text-only exceptions
  ['openai', 'gpt-4o', true],
  ['openai', 'gpt-4o-mini', true],
  ['openai', 'gpt-4.1', true],
  ['openai', 'gpt-4-turbo', true],
  ['openai', 'gpt-5', true],
  ['openai', 'chatgpt-4o-latest', true],
  ['openai', 'o3', true],
  ['openai', 'o4-mini', true],
  ['openai', 'o3-mini', false],
  ['openai', 'o1-mini', false],
  ['openai', 'o1-preview', false],
  ['openai', 'gpt-3.5-turbo', false],
  ['openai', 'gpt-4', false],
  ['openai', 'gpt-4-0613', false],
  ['openai', 'gpt-4-32k', false],
  // xai — grok-4 onward is multimodal; older lines need the vision marker
  ['xai', 'grok-4', true],
  ['xai', 'grok-4-fast-non-reasoning', true],
  ['xai', 'grok-2-vision-1212', true],
  ['xai', 'grok-3-mini', false],
  // kimi / moonshot
  ['kimi', 'kimi-k2-0905-preview', false],
  ['kimi', 'moonshot-v1-8k-vision-preview', true],
  ['kimi', 'kimi-vl-a3b-thinking', true],
  // qwen
  ['qwen', 'qwen-max', false],
  ['qwen', 'qwen-plus', false],
  ['qwen', 'qwen2.5-vl-72b-instruct', true],
  ['qwen', 'qwen-omni-turbo', true],
  ['qwen', 'qvq-max', true],
  // minimax
  ['minimax', 'minimax-m2', false],
  ['minimax', 'minimax-vl-01', true],
  // mimo
  ['mimo', 'mimo-7b-rl', false],
  ['mimo', 'mimo-vl-7b', true],
  // stepfun
  ['stepfun', 'step-2-16k', false],
  ['stepfun', 'step-1v-32k', true],
  ['stepfun', 'step-1.5v-mini', true],
  ['stepfun', 'step-1o-turbo-vision', true],
  // zai / GLM — bare chat models are text-only (verified live: glm-5.2
  // rejects image parts); only the glm-*v variants are multimodal
  ['zai', 'glm-4.5', false],
  ['zai', 'glm-4.5-air', false],
  ['zai', 'glm-4.6', false],
  ['zai', 'glm-5.2', false],
  ['zai', 'glm-5-turbo', false],
  ['zai', 'glm-4.5v', true],
  ['zai', 'glm-4.6v', true],
  ['zai', 'glm-5v-turbo', true],
  // openrouter — namespaced ids route to family rules
  ['openrouter', 'anthropic/claude-opus-4.1', true],
  ['openrouter', 'google/gemini-2.5-flash', true],
  ['openrouter', 'openai/gpt-4o', true],
  ['openrouter', 'openai/o3-mini', false],
  ['openrouter', 'x-ai/grok-4', true],
  ['openrouter', 'meta-llama/llama-3.2-90b-vision-instruct', true],
  ['openrouter', 'mistralai/pixtral-large-2411', true],
  ['openrouter', 'deepseek/deepseek-chat-v3.1', false],
  ['openrouter', 'moonshotai/kimi-k2', false],
  // unknown providers default to text-only unless the name says otherwise
  ['someprovider', 'shiny-new-model', false],
  ['someprovider', 'shiny-vl-9000', true],
  ['someprovider', 'shiny-omni', true]
]

for (const [provider, model, expected] of CASES) {
  check(`${provider}/${model}`, cloudModelSupportsVision(provider, model), expected)
}

// ---------------------------------------------------------------------------
// hasVisualContent / stripVisualContent
// ---------------------------------------------------------------------------

const textOnly: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'hello' },
  { role: 'assistant', content: 'hi' },
  { role: 'user', content: [{ type: 'text', text: 'block text' }] }
]

check('hasVisualContent: text-only', hasVisualContent(textOnly), false)
check('strip: text-only returns same reference', stripVisualContent(textOnly), textOnly)

const withVisuals: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'make a proposal' },
      { type: 'image', mediaType: 'image/jpeg', data: 'aGVsbG8=' },
      { type: 'image', mediaType: 'image/jpeg', data: 'aGVsbG8=' },
      { type: 'document', mediaType: 'application/pdf', data: 'aGVsbG8=' }
    ]
  },
  { role: 'assistant', content: 'ok' },
  {
    role: 'tool',
    toolUseId: 't1',
    toolName: 'screenshot',
    content: 'took a screenshot',
    images: [{ mediaType: 'image/png', data: 'aGVsbG8=' }]
  }
]

check('hasVisualContent: with visuals', hasVisualContent(withVisuals), true)

const stripped = stripVisualContent(withVisuals)
check('strip: returns new array', stripped !== withVisuals, true)
check('strip: nothing visual remains', hasVisualContent(stripped), false)

const strippedUser = stripped[1]
if (strippedUser.role === 'user' && typeof strippedUser.content !== 'string') {
  const blocks = strippedUser.content
  check('strip: user keeps text + one note', blocks.length, 2)
  check(
    'strip: user blocks are all text',
    blocks.every((b) => b.type === 'text'),
    true
  )
  const note = blocks[1]
  const noteText = note.type === 'text' ? note.text : ''
  check('strip: note counts images', noteText.includes('2 images'), true)
  check('strip: note counts documents', noteText.includes('1 PDF document'), true)
  check('strip: note points at attachments', noteText.includes('<attachments>'), true)
} else {
  failed++
  console.error('FAIL strip: user message lost its block content')
}

const strippedTool = stripped[3]
if (strippedTool.role === 'tool') {
  check('strip: tool images removed', strippedTool.images, undefined)
  check(
    'strip: tool content keeps original text',
    strippedTool.content.startsWith('took a screenshot'),
    true
  )
  check('strip: tool content gains note', strippedTool.content.includes('omitted'), true)
} else {
  failed++
  console.error('FAIL strip: tool message changed role')
}

check('strip: untouched messages keep identity', stripped[0] === withVisuals[0], true)
check('strip: assistant message keeps identity', stripped[2] === withVisuals[2], true)
check('strip: original input not mutated', hasVisualContent(withVisuals), true)

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
