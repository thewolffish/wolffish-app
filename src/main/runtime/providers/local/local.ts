import { DEFAULT_ENDPOINT, showModel } from '@main/ollama/ollama'
import type {
  ChatMessage,
  ProviderStreamOptions,
  StopReason,
  StreamChunk,
  ToolDefinition
} from '@main/runtime/thalamus/thalamus'

export type { ChatMessage }

/**
 * LocalProvider is a thin wrapper around the Ollama HTTP API. The provider
 * holds the currently-selected model name and endpoint. There's no load/unload
 * — Ollama loads on first request and evicts on its own.
 */
export class LocalProvider {
  private model: string | null = null
  private endpoint: string = DEFAULT_ENDPOINT
  private visionCache = new Map<string, boolean>()

  configure(model: string | null, endpoint: string = DEFAULT_ENDPOINT): void {
    if (model !== this.model) this.visionCache.clear()
    this.model = model
    this.endpoint = endpoint
  }

  get isReady(): boolean {
    return this.model !== null
  }

  get currentModel(): string | null {
    return this.model
  }

  get currentEndpoint(): string {
    return this.endpoint
  }

  /**
   * Determine whether the active local model supports vision input.
   * Queries Ollama's /api/show for the model's `capabilities` array (newer
   * Ollama versions return this) and looks for "vision". Falls back to
   * model-name pattern matching when /api/show doesn't expose
   * capabilities. Defaults to false on any uncertainty — better to refuse
   * uploads than silently drop them.
   */
  async supportsVision(): Promise<boolean> {
    const model = this.model
    if (!model) return false
    const cached = this.visionCache.get(model)
    if (cached !== undefined) return cached

    let supports = false
    try {
      const info = await showModel(model, this.endpoint)
      if (info?.capabilities && Array.isArray(info.capabilities)) {
        supports = info.capabilities.includes('vision')
      } else {
        supports = isLikelyVisionByName(model)
      }
    } catch {
      supports = isLikelyVisionByName(model)
    }
    this.visionCache.set(model, supports)
    return supports
  }

  async *stream(options: ProviderStreamOptions): AsyncGenerator<StreamChunk> {
    if (!this.model) throw new Error('no local model selected')

    const messages = [
      { role: 'system' as const, content: options.system } as Record<string, unknown>,
      ...toOllamaMessages(options.messages)
    ]

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
      // num_predict: -1 tells Ollama to generate until the model itself
      // stops or the context window fills. Without this, Ollama applies
      // its default cap (128 tokens) and truncates replies mid-thought.
      options: { num_predict: -1 }
    }
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(toOllamaTool)
    }

    const response = await fetch(new URL('/api/chat', this.endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal
    })

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '')
      throw new Error(`ollama chat failed: HTTP ${response.status} ${text}`.trim())
    }

    let inputTokens = 0
    let outputTokens = 0
    let stopReason: StopReason = 'end_turn'

    for await (const line of readNDJSON(response.body)) {
      let parsed: OllamaChunk
      try {
        parsed = JSON.parse(line) as OllamaChunk
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        yield {
          type: 'error',
          message: `ollama stream parse failed: ${detail}`,
          recoverable: false
        }
        return
      }
      if (parsed.error) throw new Error(parsed.error)

      const content = parsed.message?.content
      if (typeof content === 'string' && content.length > 0) {
        yield { type: 'text', text: content }
      }

      const toolCalls = parsed.message?.tool_calls
      if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
          const name = tc.function?.name
          if (!name) continue
          const args =
            typeof tc.function?.arguments === 'string'
              ? safeParseJSON(tc.function.arguments)
              : (tc.function?.arguments ?? {})
          yield {
            type: 'tool_call',
            id: tc.id ?? generateToolId(),
            name,
            args: args ?? {}
          }
        }
      }

      if (parsed.done) {
        if (typeof parsed.eval_count === 'number') outputTokens = parsed.eval_count
        if (typeof parsed.prompt_eval_count === 'number') inputTokens = parsed.prompt_eval_count
        stopReason = parsed.done_reason === 'length' ? 'max_tokens' : 'end_turn'
      }
    }

    yield { type: 'turn_meta', stopReason, usage: { inputTokens, outputTokens } }
  }
}

export const localProvider = new LocalProvider()

type OllamaChunk = {
  message?: {
    role?: string
    content?: string
    tool_calls?: Array<{
      id?: string
      function?: { name?: string; arguments?: string | Record<string, unknown> }
    }>
  }
  error?: string
  done?: boolean
  done_reason?: string
  eval_count?: number
  prompt_eval_count?: number
}

function toOllamaTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }
}

function toOllamaMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'tool') {
      const msg: Record<string, unknown> = {
        role: 'tool',
        content: m.content,
        tool_name: m.toolName
      }
      if (m.images && m.images.length > 0) {
        msg.images = m.images.map((img) => img.data)
      }
      out.push(msg)
      continue
    }
    if (m.role === 'user') {
      if (typeof m.content === 'string') {
        out.push({ role: 'user', content: m.content })
      } else {
        const texts: string[] = []
        const images: string[] = []
        for (const block of m.content) {
          if (block.type === 'text') texts.push(block.text)
          else if (block.type === 'image') images.push(block.data)
          else if (block.type === 'document') texts.push('[PDF document attached]')
        }
        const msg: Record<string, unknown> = { role: 'user', content: texts.join('\n') }
        if (images.length > 0) msg.images = images
        out.push(msg)
      }
      continue
    }
    if (m.toolUses && m.toolUses.length > 0) {
      out.push({
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolUses.map((use) => ({
          function: {
            name: use.name,
            arguments: use.args
          }
        }))
      })
    } else {
      out.push({ role: 'assistant', content: m.content })
    }
  }
  return out
}

function safeParseJSON(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function generateToolId(): string {
  return `tool_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function isLikelyVisionByName(model: string): boolean {
  return /vision|-vl|multimodal|llava|moondream|bakllava|gemma3|llama3\.2-vision/i.test(model)
}

async function* readNDJSON(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx = buffer.indexOf('\n')
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (line) yield line
        idx = buffer.indexOf('\n')
      }
    }
    const tail = buffer.trim()
    if (tail) yield tail
  } finally {
    reader.releaseLock()
  }
}
