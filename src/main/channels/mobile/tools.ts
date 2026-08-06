import {
  NOTIFY_BODY_MAX,
  NOTIFY_PHASES,
  NOTIFY_TITLE_MAX,
  NOTIFY_URGENCIES,
  DEEPLINK_SCHEME,
  isAllowedDeeplink,
  type NotifyPhase,
  type NotifyResultFrame,
  type NotifyUrgency
} from '@main/tunnel/protocol'
import type {
  Capability,
  SkillToolDescriptor,
  ToolExecutionResult,
  WolffishPlugin
} from '@main/runtime/cerebellum'
import { turnScope } from '@main/runtime/corpus'
import { randomBytes } from 'node:crypto'

/**
 * Capability name used to register the phone-notification tool with the
 * cerebellum. Lives outside brain/cerebellum/ — it's an in-process capability
 * the mobile channel manages directly, exactly like the Telegram channel's.
 */
export const MOBILE_CAPABILITY_NAME = 'phone'

/**
 * Notifications are 100% model-initiated: this tool is the ONLY way a phone
 * notification comes into being, and everything that routes it — the phone's
 * identity, the notification id, the ttl — is stamped by the harness in the
 * channel, never taken from the model. The model's input is treated as
 * untrusted: lengths clamp, enums fall back, deep links must match the app
 * scheme, and per-run rate limits refuse loudly rather than dropping quietly.
 */

/** ttl per phase — harness policy, deliberately not a model input. A stale
 *  approval prompt arriving 40 minutes late is worse than no prompt at all,
 *  so needs_input expires fast; terminal states may wait for the user. */
export const TTL_BY_PHASE: Record<NotifyPhase, number> = {
  needs_input: 300,
  failed: 3600,
  completed: 3600,
  started: 900,
  info: 900
}

/** At most one notification per phase per run… */
const MAX_PER_RUN_PER_PHASE = 1
/** …and never more than this many per run, whatever the phases. */
const MAX_PER_RUN = 5
/** Bounded memory for the per-run counters. */
const MAX_TRACKED_RUNS = 64

export type NotifyPhoneRequest = {
  title: string
  body: string
  phase: NotifyPhase
  urgency: NotifyUrgency
  deeplink: string | null
  runId: string
}

type ToolDeps = {
  /**
   * Stamp identity (phoneId from the pairing record, a fresh ULID), emit the
   * notify frame over the existing relay connection, and answer with the
   * relay's routing decision. Throws with a user-readable message when the
   * setting is off, no phone is paired, or the relay link is down.
   */
  notify: (request: NotifyPhoneRequest) => Promise<NotifyResultFrame>
}

/** Crockford base32 alphabet, as ULID specifies (no I, L, O, U). */
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * A spec-shaped ULID: 48-bit timestamp + 80 random bits, Crockford base32.
 * Generated HERE, on the desktop — the model never chooses notification ids,
 * which is what makes the relay's idempotency by id trustworthy.
 */
export function mintNotificationId(now = Date.now()): string {
  let time = ''
  let ms = now
  for (let i = 0; i < 10; i += 1) {
    time = ULID_ALPHABET[ms % 32] + time
    ms = Math.floor(ms / 32)
  }
  const random = randomBytes(16)
  let entropy = ''
  for (let i = 0; i < 16; i += 1) entropy += ULID_ALPHABET[random[i] % 32]
  return time + entropy
}

/** One line, printable: control characters and newlines cannot reach a
 *  notification banner. */
function sanitizeTitle(raw: string): string {
  return (
    raw
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, NOTIFY_TITLE_MAX)
  )
}

/** Bodies may wrap, but carry no other control characters. */
function sanitizeBody(raw: string): string {
  return (
    raw
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x09\x0b-\x1f\x7f]+/g, ' ')
      .trim()
      .slice(0, NOTIFY_BODY_MAX)
  )
}

function success(output: string): ToolExecutionResult {
  return { success: true, output }
}

function failure(error: string): ToolExecutionResult {
  return { success: false, error }
}

/**
 * Build the phone capability + plugin pair to register with the cerebellum
 * while the mobile channel runs. One tool, a deliberately minimal surface:
 * the model chooses words and importance; the harness owns identity, routing,
 * ttl and rate.
 */
export function buildMobileCapability(deps: ToolDeps): {
  capability: Capability
  plugin: WolffishPlugin
} {
  const tools: SkillToolDescriptor[] = [
    {
      name: 'notify_phone',
      description:
        "Send a push notification to the user's paired phone — their lock screen, their pocket. This tool being available already means a phone is paired and notifications are allowed; every send is still YOUR deliberate call. Use it when something earns the interruption: a long or background run finished with a result worth seeing (a scheduled automation's daily digest especially — end it with one 'completed' notification), a failure or something unexpected the user would want to know now, you are blocked on their input or approval ('needs_input' — send it the moment you block; it expires in minutes), or they explicitly asked to be told. Never for routine progress, per-action narration, or a turn the user is actively watching. A notification COMPLEMENTS your conversation reply, never replaces any part of it: it is not shown in the conversation, so the reply must stand complete on its own and never lean on the notification. Write it warm and concrete: the outcome, not the ceremony ('AI news is ready — 7 stories, 2 worth your time' beats 'Task completed'). Where a tap lands is YOUR choice too: no deeplink just opens the app; pass one to open the run's conversation or a settings screen. Limits enforced: one per phase per run, 5 per run; a refusal or a dropped result is final — never retry.",
      parameters: {
        title: {
          type: 'string',
          description: `Short headline shown on the phone's lock screen. At most ${NOTIFY_TITLE_MAX} characters, one line — e.g. "Migration finished".`,
          required: true
        },
        body: {
          type: 'string',
          description: `The notification body. At most ${NOTIFY_BODY_MAX} characters. Say what happened and what (if anything) the user should do — e.g. "All 214 rows converted cleanly. Nothing needs your attention."`,
          required: true
        },
        phase: {
          type: 'string',
          enum: [...NOTIFY_PHASES],
          description:
            'What moment of the run this announces: "needs_input" when you are blocked on the user, "failed" / "completed" for terminal outcomes, "started" for a kickoff the user asked to hear about, "info" (default) for anything else.',
          required: false
        },
        urgency: {
          type: 'string',
          enum: [...NOTIFY_URGENCIES],
          description:
            'Delivery priority on the phone. "high" only when the user is actively waiting or something needs them now; otherwise omit for "normal".',
          required: false
        },
        deeplink: {
          type: 'string',
          description: `Where a tap on the notification takes the user, inside the mobile app. Omitted, a tap simply opens the app — nothing navigates that you did not choose. To point the tap somewhere, pass it explicitly: ${DEEPLINK_SCHEME}chat?id=<conversationId> opens that conversation (use the id of the conversation the run belongs to — conversation_list can find it), ${DEEPLINK_SCHEME}history the conversations list, ${DEEPLINK_SCHEME}settings or ${DEEPLINK_SCHEME}settings/<page> an app screen (pages: model, appearance, preferences, channels, capabilities, knowledge, mcp, services, variables, usage, updates, relay, data, changelog). Any non-${DEEPLINK_SCHEME} scheme is rejected.`,
          required: false
        }
      }
    }
  ]

  /** Per-run notification budget. Keyed by the turn id; insertion-ordered so
   *  overflow evicts the oldest run. */
  const budgets = new Map<string, { total: number; phases: Set<NotifyPhase> }>()

  const capability: Capability = {
    name: MOBILE_CAPABILITY_NAME,
    dir: '<in-process>',
    description:
      "Reach the user's paired phone. notify_phone sends a push notification for moments worth interrupting the user for: a run finishing with something worth seeing (daily automations end their digest with one), a failure or a genuinely unexpected finding, a question that blocks you while they are away, or anything they explicitly asked to be told about. Taps can deep-link back into the app — to a conversation or a settings screen — when the model passes a wolffish:// deeplink; without one a tap just opens the app. The phone deduplicates and the desktop rate-limits, so call it once per moment — never in a retry loop. This capability is only present while a phone is paired and notifications are allowed.",
    triggers: { keywords: ['notify', 'phone', 'push notification', 'ping me', 'alert me'] },
    tools,
    body: '',
    hasPlugin: true,
    status: 'ok',
    requires: [],
    packages: {},
    npmDependencies: {}
  }

  const plugin: WolffishPlugin = {
    name: MOBILE_CAPABILITY_NAME,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: toJsonSchema(t.parameters)
    })),
    execute: async (toolName, args) => {
      if (toolName !== 'notify_phone') return failure(`unknown phone tool: ${toolName}`)
      return notifyPhone(deps, budgets, args)
    }
  }

  return { capability, plugin }
}

async function notifyPhone(
  deps: ToolDeps,
  budgets: Map<string, { total: number; phases: Set<NotifyPhase> }>,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const title = sanitizeTitle(typeof args.title === 'string' ? args.title : '')
  if (!title) return failure('invalid argument: title is required (a short, plain-text headline)')
  const body = sanitizeBody(typeof args.body === 'string' ? args.body : '')
  if (!body) return failure('invalid argument: body is required (plain text, up to 180 characters)')

  const phase: NotifyPhase = NOTIFY_PHASES.includes(args.phase as NotifyPhase)
    ? (args.phase as NotifyPhase)
    : 'info'
  const urgency: NotifyUrgency = NOTIFY_URGENCIES.includes(args.urgency as NotifyUrgency)
    ? (args.urgency as NotifyUrgency)
    : 'normal'

  // The run identity comes from the harness's own async context — never from
  // the model — and it is what the rate limits and the relay's audit trail
  // key on. Turns and background automations both carry one.
  const runId = turnScope.getStore()?.turnId ?? 'untracked'

  // Navigation is 100% the model's choice: no deeplink means a tap simply
  // opens the app. The harness validates the scheme and nothing else — it
  // never invents a destination the model didn't name.
  let deeplink: string | null = null
  if (args.deeplink !== undefined && args.deeplink !== null && args.deeplink !== '') {
    if (!isAllowedDeeplink(args.deeplink)) {
      return failure(
        `invalid argument: deeplink must start with ${DEEPLINK_SCHEME} — got ${String(
          args.deeplink
        ).slice(0, 80)}`
      )
    }
    deeplink = args.deeplink
  }

  const budget = budgets.get(runId) ?? { total: 0, phases: new Set<NotifyPhase>() }
  if (budget.total >= MAX_PER_RUN) {
    return failure(
      `rate limit: this run already sent ${MAX_PER_RUN} notifications (the maximum). ` +
        'Do not send more this run — summarize in your reply instead.'
    )
  }
  if (budget.phases.has(phase)) {
    return failure(
      `rate limit: this run already sent a "${phase}" notification (max ${MAX_PER_RUN_PER_PHASE} per phase per run). ` +
        'Pick a different phase only if something genuinely new happened; otherwise do not notify again.'
    )
  }

  let result: NotifyResultFrame
  try {
    result = await deps.notify({ title, body, phase, urgency, deeplink, runId })
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }

  // Count only notifications that actually went somewhere — a dropped one
  // should not eat the run's budget.
  if (result.route !== 'dropped') {
    budget.total += 1
    budget.phases.add(phase)
    budgets.delete(runId)
    budgets.set(runId, budget)
    while (budgets.size > MAX_TRACKED_RUNS) {
      const oldest = budgets.keys().next().value
      if (oldest === undefined) break
      budgets.delete(oldest)
    }
  }

  switch (result.route) {
    case 'inband':
      return success(
        'Delivered to the phone over the live tunnel (it is connected right now). ' +
          `notificationId ${result.notificationId}.`
      )
    case 'push':
      return success(
        'The phone is not connected — queued as a platform push notification via Expo. ' +
          `notificationId ${result.notificationId}.`
      )
    default:
      return failure(
        `notification was not delivered: ${result.reason ?? 'unknown reason'}. Do not retry.`
      )
  }
}

function toJsonSchema(parameters: SkillToolDescriptor['parameters']): {
  type: 'object'
  properties: Record<string, { type: string; description: string; enum?: string[] }>
  required: string[]
} {
  const properties: Record<string, { type: string; description: string; enum?: string[] }> = {}
  const required: string[] = []
  for (const [name, spec] of Object.entries(parameters)) {
    properties[name] = {
      type: spec.type ?? 'string',
      description: spec.description ?? '',
      ...(spec.enum ? { enum: spec.enum } : {})
    }
    if (spec.required) required.push(name)
  }
  return { type: 'object', properties, required }
}
