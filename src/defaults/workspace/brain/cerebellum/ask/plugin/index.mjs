/**
 * ask — pose a multiple-choice question to the user and wait for their answer.
 *
 * The single `ask_user` tool pauses the agent loop, hands the question to the
 * host via `context.askUser`, and blocks until the user answers an interactive
 * card in the chat. Their choice — a listed option or free-text instructions —
 * comes back as the tool output and the loop continues from there.
 *
 * The host bridge (PluginContext.askUser) only resolves on the Electron
 * desktop channel; elsewhere (Telegram/WhatsApp, headless) it resolves
 * `unsupported` and we tell the model to ask in plain text instead.
 */

const tools = [
  {
    name: 'ask_user',
    description:
      'Pose a multiple-choice question to the user and wait for their answer. Renders a numbered card in the chat; the user clicks an option or writes their own instructions, then your loop resumes with their choice. Use when the next step depends on a decision only the user can make and you can frame it as a few discrete options.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question or decision to put to the user. One clear line.'
        },
        details: {
          type: 'string',
          description:
            "Optional extra context shown under the question — why you're asking, or what each choice affects."
        },
        options: {
          type: 'array',
          description:
            'The choices to offer, in display order. 2–5 focused, distinct items.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'The choice text shown to the user.' },
              description: {
                type: 'string',
                description: 'Optional short clarifying line under the label.'
              }
            },
            required: ['label']
          }
        },
        allow_other: {
          type: 'boolean',
          description:
            'Whether to show the free-text "something else" escape hatch so the user can type their own instructions. Defaults to true.'
        },
        other_label: {
          type: 'string',
          description: 'Optional custom title for the free-text option.'
        },
        other_description: {
          type: 'string',
          description: 'Optional custom hint for the free-text option.'
        }
      },
      required: ['question', 'options']
    }
  }
]

let askUser = null

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// Coerce the model's `options` into a clean list. Tolerant of an array of
// { label, description } objects OR bare strings, since the model occasionally
// sends either.
function normalizeOptions(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const label = item.trim()
      if (label) out.push({ label })
    } else if (item && typeof item === 'object') {
      const label = trimmed(item.label)
      const description = trimmed(item.description)
      if (label) out.push(description ? { label, description } : { label })
    }
  }
  return out
}

// Resolve `canceled` if the run is stopped while the question is open, so a
// user pressing stop doesn't leave execute() hanging on an answer that will
// never come.
function withAbort(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.resolve({ kind: 'canceled' })
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      resolve({ kind: 'canceled' })
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (err) => {
        cleanup()
        reject(err)
      }
    )
  })
}

const plugin = {
  name: 'ask',
  tools,
  async init(context) {
    askUser = typeof context?.askUser === 'function' ? context.askUser : null
  },
  async execute(toolName, args, signal) {
    if (toolName !== 'ask_user') {
      return { success: false, error: `ask: unknown tool ${toolName}` }
    }
    if (typeof askUser !== 'function') {
      return {
        success: false,
        error:
          'ask_user is unavailable in this runtime. Ask the user directly in your reply instead.'
      }
    }

    const a = args ?? {}
    const question = trimmed(a.question)
    if (!question) {
      return { success: false, error: 'ask_user requires a non-empty "question".' }
    }
    const options = normalizeOptions(a.options)
    if (options.length === 0) {
      return {
        success: false,
        error:
          'ask_user requires "options": a non-empty array of choices, each { label, description? }.'
      }
    }

    const request = {
      question,
      details: trimmed(a.details) || undefined,
      options,
      allowOther: a.allow_other !== false,
      otherLabel: trimmed(a.other_label) || undefined,
      otherDescription: trimmed(a.other_description) || undefined
    }

    let response
    try {
      response = await withAbort(Promise.resolve(askUser(request)), signal)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: `ask_user failed: ${message}` }
    }

    switch (response && response.kind) {
      case 'option': {
        const index = typeof response.index === 'number' ? response.index : -1
        const chosen = options[index]
        if (!chosen) {
          return { success: false, error: 'The user selected an option that no longer exists.' }
        }
        const desc = chosen.description ? ` — ${chosen.description}` : ''
        return {
          success: true,
          output: `The user selected option ${index + 1} of ${options.length}: "${chosen.label}"${desc}`
        }
      }
      case 'custom': {
        const text = trimmed(response.text)
        if (!text) {
          return {
            success: false,
            error: 'The user chose to write their own answer but left it blank.'
          }
        }
        return {
          success: true,
          output: `The user did not pick any of the listed options and instead instructed:\n${text}`
        }
      }
      case 'unsupported':
        return {
          success: false,
          error:
            'Interactive questions are not available on this channel. Ask the user directly in your reply instead.'
        }
      case 'canceled':
      default:
        return {
          success: false,
          error: 'The user dismissed the question without answering (or the run was stopped).'
        }
    }
  }
}

export default plugin
