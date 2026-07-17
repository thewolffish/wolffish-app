import type { ChatMessage, UserContentBlock } from '@main/runtime/thalamus'

/**
 * Vision is the capability gate for multimodal content — it decides
 * whether image (and PDF document) blocks may travel to a given model.
 *
 * Maps to: the visual cortex — signals that the eyes can't process
 * never reach it.
 *
 * Text-only provider APIs hard-reject multimodal content parts. DeepSeek,
 * for example, answers HTTP 400 `unknown variant image_url, expected text`
 * the moment an image part appears in `messages`, which kills the entire
 * turn. There is no reliable cross-provider capability endpoint, and model
 * catalogs change faster than any exhaustive table could track — so this
 * module only recognizes the *well-known* vision families and treats
 * everything else as text-only. The asymmetry justifies the conservative
 * default: a wrongly-stripped image degrades one answer and says so in the
 * prompt; a wrongly-sent image fails the whole request.
 *
 * When a new vision model shows up as text-only here, add its family
 * pattern below — the stripped-content note in the transcript makes the
 * misclassification visible.
 */

// Vendor-agnostic name markers. Vendors consistently tag their multimodal
// models: Qwen-VL / Kimi-VL / MiniMax-VL / MiMo-VL ("vl" as a hyphenated
// token), *-vision-*, *-omni, QVQ, and the open-weight llava/pixtral
// families served through OpenRouter.
const VISION_NAME_MARKERS = /vision|omni|llava|pixtral|qvq|(^|[-/_.:])vl([-/_.:]|$)/

export function cloudModelSupportsVision(provider: string, model: string): boolean {
  const m = model.toLowerCase()
  if (VISION_NAME_MARKERS.test(m)) return true
  switch (provider) {
    case 'anthropic':
      // Every Claude chat model since Claude 3 accepts image blocks.
      return true
    case 'openai':
      return openaiSupportsVision(m)
    case 'deepseek':
      // DeepSeek's chat API is text-only across the lineup — content
      // parts other than `text` are rejected with HTTP 400.
      return false
    case 'xai':
      // grok-2-vision and friends are caught by the markers above;
      // grok-4 onward is multimodal without a name marker.
      return /grok-[4-9]/.test(m)
    case 'stepfun':
      // step-1v / step-1.5v / step-1o are StepFun's vision lines.
      return /step-[\d.]+[vo]($|[^a-z0-9])/.test(m)
    case 'zai':
      // GLM-*V (e.g. glm-4.5v, glm-4.6v, glm-5v-turbo) are the vision
      // variants; the bare glm-* chat models are text-only — confirmed
      // live, glm-5.2 rejects image parts as "no multi-modal input".
      return /glm-[\d.]+v($|[^a-z0-9])/.test(m)
    case 'kimi':
      // kimi-k2.5 onward and kimi-k3 are natively multimodal without a
      // name marker — image_url content parts verified live (k3, k2.6,
      // k2.5 — 2026-07-17), and /models reports supports_image_in for the
      // whole k2.5+/k3 line. Bare moonshot-v1 models are text-only (their
      // -vision-preview variants carry the name marker above).
      return /^kimi-k(2\.[5-9]|[3-9])/.test(m)
    case 'openrouter':
      return openrouterSupportsVision(m)
    default:
      // qwen, minimax, mimo, and any provider added later: their
      // multimodal models carry a name marker; bare chat models are
      // text-only.
      return false
  }
}

function openaiSupportsVision(m: string): boolean {
  // Text-only members of otherwise vision-capable families.
  if (/gpt-3\.5|o1-mini|o1-preview|o3-mini|gpt-4-32k/.test(m)) return false
  // Bare gpt-4 and its dated snapshots predate vision.
  if (/^gpt-4($|-\d)/.test(m)) return false
  return /gpt-4o|gpt-4\.\d|gpt-4-turbo|gpt-5|chatgpt|^o\d/.test(m)
}

// OpenRouter ids are namespaced ("anthropic/claude-sonnet-4"); route to
// the family rules the suffix belongs to.
function openrouterSupportsVision(m: string): boolean {
  if (m.includes('claude')) return true
  // Gemini 1.5 onward is multimodal across the lineup.
  if (m.includes('gemini')) return true
  if (m.includes('grok')) return /grok-[4-9]/.test(m)
  // Same rule as the direct kimi provider: k2.5+/k3 are multimodal.
  if (m.includes('kimi')) return /kimi-k(2\.[5-9]|[3-9])/.test(m)
  if (m.includes('gpt') || /(^|\/)o\d/.test(m)) {
    return openaiSupportsVision(m.split('/').pop() ?? m)
  }
  return false
}

/**
 * Whether any message carries content a text-only model can't accept:
 * image/document blocks in user messages, or images in tool results.
 */
export function hasVisualContent(messages: ChatMessage[]): boolean {
  return messages.some((m) => {
    if (m.role === 'user' && typeof m.content !== 'string') {
      return m.content.some((b) => b.type === 'image' || b.type === 'document')
    }
    if (m.role === 'tool') return (m.images?.length ?? 0) > 0
    return false
  })
}

/**
 * Replace visual content with a text note explaining what was removed
 * and where the original files live, so the model can reach for file
 * tools instead of hallucinating what it "saw". Returns the input array
 * unchanged (same reference) when there is nothing to strip.
 */
export function stripVisualContent(messages: ChatMessage[]): ChatMessage[] {
  if (!hasVisualContent(messages)) return messages
  return messages.map((m) => {
    if (m.role === 'user' && typeof m.content !== 'string') {
      let images = 0
      let documents = 0
      const kept: UserContentBlock[] = []
      for (const block of m.content) {
        if (block.type === 'image') images++
        else if (block.type === 'document') documents++
        else kept.push(block)
      }
      if (images === 0 && documents === 0) return m
      kept.push({ type: 'text', text: omittedNote(images, documents) })
      return { ...m, content: kept }
    }
    if (m.role === 'tool' && m.images && m.images.length > 0) {
      const count = m.images.length
      const note = `\n[${count} image${count === 1 ? '' : 's'} from this tool result omitted — the active model is text-only and cannot view images.]`
      return { ...m, images: undefined, content: m.content + note }
    }
    return m
  })
}

function omittedNote(images: number, documents: number): string {
  const parts: string[] = []
  if (images > 0) parts.push(`${images} image${images === 1 ? '' : 's'}`)
  if (documents > 0) parts.push(`${documents} PDF document${documents === 1 ? '' : 's'}`)
  return `[${parts.join(' and ')} omitted — the active model is text-only and cannot view them. The original files are on disk; their paths are listed in the <attachments> block of this message. Use file tools if the task needs their contents.]`
}
