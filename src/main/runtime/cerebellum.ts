import type { Amygdala, DangerLevel, DangerPattern } from '@main/runtime/amygdala'
import type { ChannelStatusSnapshot } from '@main/channels/status'
import type { Corpus } from '@main/runtime/corpus'
import { sudoSession, type SudoSession } from '@main/runtime/sudoSession'
import type { ToolDefinition } from '@main/runtime/thalamus'
import type { ToolCall } from '@main/runtime/wernicke'
import yaml from 'js-yaml'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Cerebellum loads skills (markdown procedures) and plugins (tool
 * providers) from the workspace.
 *
 * Maps to: the cerebellum — the dense knot at the back of the brain that
 * stores learned procedures and motor patterns. Riding a bike, signing
 * your name, the perfectly-cadenced apology you've given a hundred times:
 * those routines live in the cerebellum. You don't have to think about
 * them; you just run them.
 *
 * In Wolffish, each capability is a folder under brain/cerebellum/ with
 * a SKILL.md (frontmatter + body) and an optional plugin/index.mjs. The
 * cerebellum scans the folder at startup, parses each SKILL.md, registers
 * danger and confirm patterns with amygdala, and dynamic-imports any
 * plugin code so its tools become callable.
 */

export type ToolParameterSpec = {
  type?: string
  description?: string
  enum?: string[]
  required?: boolean
  /**
   * JSON Schema for array items / object shape, passed through verbatim to
   * the model-facing schema. Lets a frontmatter param declare a precise
   * nested structure (e.g. an array of `{ label, description }` objects)
   * instead of an opaque `type: array`. Some strict providers also reject an
   * array param that has no `items`.
   */
  items?: Record<string, unknown>
  properties?: Record<string, unknown>
}

export type SkillTrigger = {
  keywords: string[]
}

export type SkillToolDescriptor = {
  name: string
  description: string
  parameters: Record<string, ToolParameterSpec>
}

export type ConfirmPattern = {
  match: RegExp
  reason: string
}

export type SkillFrontmatter = {
  name: string
  description: string
  triggers?: string[]
  tools?: SkillToolDescriptor[]
  danger_patterns?: Array<{ pattern: string; level: DangerLevel; reason: string }>
  confirm_patterns?: Array<{ pattern: string; reason: string }>
  requires?: string[]
  packages?: Record<string, string>
}

export type CapabilityStatus = 'ok' | 'error'

export type Capability = {
  name: string
  dir: string
  description: string
  triggers: SkillTrigger
  tools: SkillToolDescriptor[]
  body: string
  hasPlugin: boolean
  status: CapabilityStatus
  error?: string
  requires: string[]
  packages: Record<string, string>
  /**
   * npm package dependencies parsed from the capability's own package.json
   * (next to SKILL.md). Empty if no package.json or no deps. Installed
   * lazily into <capability>/node_modules on first tool use, then cached
   * for the rest of the session.
   */
  npmDependencies: Record<string, string>
  /**
   * Path to the plugin entry file (index.mjs/.js/.cjs). Set when
   * hasPlugin is true. The plugin itself is imported lazily on first use,
   * AFTER npm deps are installed — that way plugins can use static imports
   * for their npm deps without crashing startup when deps aren't installed
   * yet.
   */
  pluginEntryPath?: string
  /**
   * True when this capability was registered via
   * registerInProcessCapability rather than discovered on disk under
   * brain/cerebellum/. Built-in channels (Telegram) use this so the
   * LLM still sees their tools but the Cerebellum settings panel can
   * hide them — they're core features, not external plugins.
   */
  inProcess?: boolean
}

export type ToolResultImage = {
  mediaType: string
  data: string
}

export type ToolExecutionResult = {
  success: boolean
  output?: string
  error?: string
  images?: ToolResultImage[]
  exitCode?: number | null
  partial?: boolean
}

export type RiskLevel = 'low' | 'medium' | 'high'

/**
 * Human-readable description of a tool action, surfaced on the approval
 * card so the user can make an informed decision instead of staring at
 * raw JSON args.
 */
export type ApprovalDescription = {
  title: string
  description: string
  command?: string
  impact?: string
  risk: RiskLevel
}

/** The single tool the `ask` capability exposes. */
export const ASK_USER_TOOL = 'ask_user'

/** One selectable choice on an ask-the-user question card. */
export type AskUserOption = {
  /** The choice shown to the user (e.g. "Use PostgreSQL"). */
  label: string
  /** Optional one-line explanation rendered under the label. */
  description?: string
}

/**
 * What a plugin hands `context.askUser` to pose a question to the user.
 * Built by the `ask` capability from the model's tool args; the toolCallId
 * is injected by Cerebellum so the renderer can anchor the question card to
 * the right tool_call segment.
 */
export type AskUserRequestInput = {
  question: string
  details?: string
  options: AskUserOption[]
  /** Show the free-text "something else" escape hatch (default true). */
  allowOther: boolean
  /** Override the default label/description of the free-text option. */
  otherLabel?: string
  otherDescription?: string
}

export type AskUserRequest = AskUserRequestInput & { toolCallId: string }

/**
 * The user's answer to an ask-the-user question. `option` = they picked
 * listed choice N; `custom` = they wrote their own instructions in the
 * free-text field; `canceled` = the question was dismissed (run stopped /
 * window closed); `unsupported` = the active channel can't render the card.
 */
export type AskUserResponse =
  | { kind: 'option'; index: number }
  | { kind: 'custom'; text: string }
  | { kind: 'canceled' }
  | { kind: 'unsupported' }

/**
 * Bridge that bounces an ask-the-user request to whichever channel owns the
 * active turn (mirrors the amygdala approval bridge). Wired in main over the
 * singleton turnRouter; absent in headless/test runtimes, where asking
 * resolves `unsupported`.
 */
export type AskUserBridge = (request: AskUserRequest & { id: string }) => Promise<AskUserResponse>

/**
 * Optional hook the agent passes into ensureDependencies so the dependency
 * resolver can emit broca segments for synthetic install calls. Without
 * this, the approval IPC fires correctly but the renderer has no
 * `tool_call` segment to anchor the approval card to — the dialog
 * silently never appears.
 */
export type DependencyEmitHook = {
  emitToolCall: (toolCallId: string, name: string, args: Record<string, unknown>) => void
  emitToolResult: (
    toolCallId: string,
    status: 'success' | 'failed' | 'denied',
    output: string,
    error?: string
  ) => void
}

/**
 * Compact, serializable view of a capability handed to the `skills`
 * management plugin so it can list / search / manage capabilities without
 * reaching into Cerebellum internals. `official` capabilities ship with the
 * app (bundled, or in-process core channels) and can never be deleted; `dir`
 * is the on-disk folder.
 */
export type ManagedCapability = {
  name: string
  description: string
  triggers: string[]
  tools: Array<{ name: string; description: string }>
  hasPlugin: boolean
  status: CapabilityStatus
  enabled: boolean
  official: boolean
  inProcess: boolean
  dir: string
  error?: string
}

/**
 * Result of importing/creating a capability — the subset of
 * CapabilityImportResult the `skills` plugin needs.
 */
export type ManagedImportResult = {
  ok: boolean
  error?: string
  name?: string
  hasPlugin?: boolean
  toolCount?: number
}

/**
 * Management surface injected into the `skills` capability's plugin via its
 * init context (PluginContext.host). Implemented in the main process
 * (index.ts) over the very same helpers the Cerebellum settings panel uses,
 * so agent-driven skill management and UI-driven management stay in lockstep:
 * config persistence is atomic, official capabilities are protected, and a
 * disk change is applied live via reload. Optional on PluginContext — every
 * plugin other than `skills` ignores it.
 */
export type CerebellumPluginHost = {
  /** Live snapshot of every loaded capability with enabled/official flags. */
  listCapabilities: () => Promise<ManagedCapability[]>
  /** Enable/disable a capability: persists `disabledCapabilities` AND applies live. */
  setCapabilityEnabled: (name: string, enabled: boolean) => Promise<void>
  /** Delete a non-official capability folder, prune config, and reload. */
  deleteCapability: (name: string) => Promise<{ ok: boolean; error?: string }>
  /** Validate + copy a staged capability (SKILL.md / folder / zip) into place. */
  importCapability: (sourcePath: string) => Promise<ManagedImportResult>
  /** Re-scan brain/cerebellum/ from disk so new/changed skills take effect. */
  reload: () => Promise<void>
}

/** A single scheduled automation (heartbeat job) as the agent sees it. */
export type AutomationJobInfo = {
  id: string
  /** Schedule kind — daily, weekly, every, hourly, weekday, monthly, startup, cron. */
  kind: string
  /** The 5-field cron expression the job runs on, or null for a startup job. */
  cron: string | null
  /** The exact ## heading text (e.g. "Every (5m)"). */
  label: string
  /** The instruction body the agent runs when the job fires. */
  body: string
  /** Plain-English description of the schedule (e.g. "every 5 minutes"). */
  human: string
  /** True while this job is executing right now. */
  running: boolean
  /** Epoch ms of the last run, or null if it hasn't run this session. */
  lastRunAt: number | null
  /** Outcome of the last run, or null if it hasn't run this session. */
  lastStatus: 'completed' | 'failed' | 'skipped' | null
  /** Error text from the last run, when it failed. */
  lastError?: string
}

/**
 * Automation-management surface injected into the `automations` capability's
 * plugin via its init context (PluginContext.automations). Implemented in the
 * main process (index.ts) over the live Brainstem instance, so agent-driven
 * automation management and the engine that actually fires the jobs share one
 * source of truth: the same parser validates a schedule, the same reload path
 * applies an edit, the same executeJob runs a job on demand. Optional on
 * PluginContext — every plugin other than `automations` ignores it.
 */
export type AutomationsHost = {
  /** Read the raw brainstem/heartbeat.md file verbatim. */
  readHeartbeat: () => Promise<string>
  /** Overwrite brainstem/heartbeat.md, reload the scheduler, return the new live jobs. */
  writeHeartbeat: (raw: string) => Promise<{ ok: boolean; jobs: AutomationJobInfo[]; error?: string }>
  /** Live snapshot of every scheduled automation, enriched with run status. */
  listJobs: () => AutomationJobInfo[]
  /** Validate a proposed schedule heading and describe it; the syntax single-source-of-truth. */
  previewSchedule: (
    heading: string
  ) =>
    | { ok: true; kind: string; cron: string | null; human: string; runAt?: number | null }
    | { ok: false; error: string }
  /** The currently-running automation, if any. */
  getRunningJob: () => { id: string; label: string; body: string; startedAt: number } | null
  /** Run an automation immediately by id or heading label (fire-and-forget). */
  runJobNow: (idOrLabel: string) => { ok: boolean; started: boolean; error?: string }
}

export type PluginContext = {
  pluginDir: string
  workspaceRoot: string
  /**
   * Resolves to the conversation id of the turn currently in flight, or
   * null when no turn is active. Plugins that produce per-conversation
   * artifacts (voice memos, attachments) call this at execute time —
   * not init — so the value reflects the active conversation, not the
   * one that happened to be active when the plugin first loaded.
   */
  getCurrentConversationId: () => string | null
  /**
   * Shared, app-lifetime admin-password session. Plugins that run privileged
   * (sudo) commands call `sudo.ensurePassword()` once and merge
   * `sudo.getElevatedEnv()` into their elevated spawns so the user is prompted
   * a single time per app run instead of per command. macOS-only; callers
   * gate on platform and fall back to their own elevation path elsewhere.
   */
  sudo: SudoSession
  /**
   * Capability-management surface. Present only when the host wired one in
   * via setPluginHost — used by the `skills` capability to list, enable,
   * disable, delete, and create other capabilities. Undefined for every
   * other plugin.
   */
  host?: CerebellumPluginHost
  /**
   * Automation-management surface. Present only when the host wired one in via
   * setAutomationsHost — used by the `automations` capability to list, create,
   * edit, delete, check, and run the scheduled heartbeat jobs. Undefined for
   * every other plugin.
   */
  automations?: AutomationsHost
  /**
   * Ask the user a multiple-choice question and block until they answer.
   * Used by the `ask` capability to pause the agent loop, render an
   * interactive question card in the chat, and resume with the user's
   * choice (a listed option or free-text instructions). Resolves
   * `unsupported` when no channel can render the card (e.g. a headless
   * runtime), and `canceled` if the run is stopped before they answer.
   */
  askUser: (request: AskUserRequestInput) => Promise<AskUserResponse>
  /**
   * Live connection status for every messaging channel (Telegram, WhatsApp,
   * in-app chat). Used by the `introspect` capability to report whether a
   * channel is reachable and, when it isn't, how the user can reconnect it.
   * Returns an empty array until the host wires a provider via
   * setChannelStatusProvider; every plugin other than `introspect` ignores it.
   */
  getChannelStatus: () => ChannelStatusSnapshot[]
}

export type WolffishPlugin = {
  name: string
  tools: ToolDefinition[]
  /**
   * Run a tool. The optional `signal` aborts when the user stops the run;
   * long-running plugins (shell, ffmpeg, …) should honor it by killing the
   * in-flight work and returning a failure result. Quick plugins may ignore
   * it. Existing untyped .mjs plugins that declare execute(toolName, args)
   * keep working — the extra positional arg is simply unused.
   */
  execute: (
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ) => Promise<ToolExecutionResult>
  init?: (context: PluginContext) => Promise<void>
  destroy?: () => Promise<void>
  /**
   * Optional: produce a rich, human-readable description of what this
   * tool call will do. Shown on the approval card. Plugins should resolve
   * platform-specific commands (e.g. the actual brew/winget invocation)
   * at call time so the user sees what will run on their machine.
   */
  describeAction?: (
    toolName: string,
    args: Record<string, unknown>
  ) => ApprovalDescription | Promise<ApprovalDescription>
}

export type CerebellumOptions = {
  workspaceRoot?: string
  amygdala?: Amygdala
  corpus?: Corpus
}

const PLUGIN_FILES = ['index.mjs', 'index.js', 'index.cjs']

export class Cerebellum {
  private capabilities = new Map<string, Capability>()
  private plugins = new Map<string, WolffishPlugin>()
  private toolToCapability = new Map<string, string>()
  private dependencyCache = new Map<string, boolean>()
  private loaded = false
  private currentConversationId: string | null = null
  private disabled = new Set<string>()
  private pluginHost?: CerebellumPluginHost
  private automationsHost?: AutomationsHost
  /**
   * Bumped every time the live tool surface changes — a reload (skills
   * added/edited/removed) or an enable/disable toggle. The agent loop pins
   * the system prompt + tool list once per turn for cache efficiency; it
   * re-reads this counter each iteration and rebuilds the pin when it moves,
   * so a skill created or edited mid-turn becomes callable on the very next
   * step instead of only on the next user turn. Also drives the plugin
   * import cache-buster so an edited plugin re-evaluates instead of resolving
   * to Node's stale ESM module cache.
   */
  private generation = 0
  private askBridge?: AskUserBridge
  private channelStatusProvider?: () => ChannelStatusSnapshot[]
  /**
   * The toolCallId of the tool currently executing, set by executeTool for
   * the duration of one plugin.execute call. The `ask` capability needs it
   * to anchor its question card to the right tool_call segment, but
   * plugin.execute isn't handed the id. Save/restore around each call keeps
   * nested executeTool invocations (dependency checks) from clobbering it.
   */
  private activeToolCallId: string | null = null

  constructor(private options: CerebellumOptions = {}) {}

  /**
   * Wire the ask-the-user bridge after construction (mirrors amygdala's
   * setApprovalBridge). Used by main to route question cards to whichever
   * channel owns the active turn. Without it, `context.askUser` resolves
   * `unsupported`.
   */
  setAskBridge(bridge: AskUserBridge | null): void {
    this.askBridge = bridge ?? undefined
  }

  /**
   * Wire a provider that reports live channel connection status. Set by main
   * once the channels exist; backs `PluginContext.getChannelStatus` so the
   * introspect capability can tell the model which channels are reachable and
   * how to reconnect a disconnected one. Resolved at call time, so the
   * provider can be set after plugins have already loaded.
   */
  setChannelStatusProvider(provider: (() => ChannelStatusSnapshot[]) | null): void {
    this.channelStatusProvider = provider ?? undefined
  }

  /**
   * Build the full ask request (injecting the active toolCallId + a fresh
   * id) and bounce it through the bridge. Backs `PluginContext.askUser`.
   */
  private async dispatchAskUser(input: AskUserRequestInput): Promise<AskUserResponse> {
    const bridge = this.askBridge
    const toolCallId = this.activeToolCallId
    if (!bridge || !toolCallId) return { kind: 'unsupported' }
    const id = `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    try {
      return await bridge({ ...input, toolCallId, id })
    } catch {
      return { kind: 'canceled' }
    }
  }

  setDisabled(names: string[]): void {
    this.disabled = new Set(names)
    this.generation++
  }

  /**
   * Monotonic tool-surface version. Changes whenever capabilities are
   * reloaded or a skill is enabled/disabled. The agent loop compares this
   * against the value it pinned at turn start to decide whether to rebuild.
   */
  getGeneration(): number {
    return this.generation
  }

  /**
   * Wire the capability-management host (implemented in the main process)
   * that the `skills` capability's plugin receives in its init context.
   * Set once at startup; survives reload() so the bridge keeps working
   * after the `skills` plugin is re-imported.
   */
  setPluginHost(host: CerebellumPluginHost): void {
    this.pluginHost = host
  }

  /**
   * Wire the automation-management host (implemented in the main process over
   * the Brainstem) that the `automations` capability's plugin receives in its
   * init context. Set once at startup; survives reload() so the bridge keeps
   * working after the plugin is re-imported.
   */
  setAutomationsHost(host: AutomationsHost): void {
    this.automationsHost = host
  }

  isDisabled(name: string): boolean {
    return this.disabled.has(name)
  }

  /**
   * Set by the agent at the start of every turn so plugins can stamp
   * their outputs with the active conversation id. Cleared in the
   * agent's finally block — a stale id leaking into the next turn
   * would silently misroute artifacts.
   */
  setCurrentConversationId(id: string | null, title?: string | null): void {
    this.currentConversationId = id
    this.options.corpus?.emit('conversation.changed', { conversationId: id, title })
  }

  getCurrentConversationId(): string | null {
    return this.currentConversationId
  }

  /**
   * Register an in-process capability that doesn't live on disk. Used
   * by core channels (currently Telegram) to expose channel-specific
   * tools to the LLM as if they were a regular cerebellum capability.
   * Replaces any prior registration of the same name so callers can
   * re-register on lifecycle changes (bot restart with a new config)
   * without leaking stale handlers.
   *
   * Caller is responsible for calling unregisterInProcessCapability
   * when the underlying resource (bot) shuts down — otherwise the LLM
   * keeps seeing tools it can no longer execute.
   */
  registerInProcessCapability(capability: Capability, plugin: WolffishPlugin): void {
    // Drop tool ownership from any prior registration so the new one wins.
    const prior = this.capabilities.get(capability.name)
    if (prior) {
      for (const tool of prior.tools) {
        if (this.toolToCapability.get(tool.name) === capability.name) {
          this.toolToCapability.delete(tool.name)
        }
      }
    }
    this.capabilities.set(capability.name, { ...capability, inProcess: true })
    this.plugins.set(capability.name, plugin)
    for (const tool of capability.tools) {
      this.toolToCapability.set(tool.name, capability.name)
    }
  }

  /**
   * Remove an in-process capability registered via
   * registerInProcessCapability. Idempotent.
   */
  unregisterInProcessCapability(name: string): void {
    const cap = this.capabilities.get(name)
    if (!cap) return
    for (const tool of cap.tools) {
      if (this.toolToCapability.get(tool.name) === name) {
        this.toolToCapability.delete(tool.name)
      }
    }
    this.capabilities.delete(name)
    this.plugins.delete(name)
  }

  /**
   * Discover and load every capability in brain/cerebellum/. Idempotent:
   * a second call after a successful load is a no-op. Errors loading any
   * single capability are logged but never throw — the agent continues
   * with whatever loaded.
   */
  async loadAll(): Promise<{ capabilities: Capability[] }> {
    if (this.loaded) return { capabilities: [...this.capabilities.values()] }
    const root = this.options.workspaceRoot
    if (!root) {
      this.loaded = true
      return { capabilities: [] }
    }
    const dir = path.join(root, 'brain', 'cerebellum')
    let entries: Array<import('node:fs').Dirent>
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      this.loaded = true
      return { capabilities: [] }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      // Bundled capabilities live in dot-prefixed folders (.git, .browser, …)
      // so they're hidden in `ls` but still load. Don't skip them.
      const capDir = path.join(dir, entry.name)
      try {
        const cap = await this.loadCapability(capDir, entry.name)
        if (cap) this.capabilities.set(cap.name, cap)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.capabilities.set(entry.name, {
          name: entry.name,
          dir: capDir,
          description: '',
          triggers: { keywords: [] },
          tools: [],
          body: '',
          hasPlugin: false,
          status: 'error',
          error: message,
          requires: [],
          packages: {},
          npmDependencies: {}
        })
      }
    }

    this.loaded = true
    return { capabilities: [...this.capabilities.values()] }
  }

  /**
   * Render the `<tools>` section the prefrontal folds into the system
   * prompt. Each loaded capability contributes a header, its description,
   * and a brief tool catalog. Empty when no capabilities are loaded.
   */
  getToolsPrompt(): string {
    const blocks: string[] = []
    for (const cap of this.capabilities.values()) {
      if (cap.status !== 'ok') continue
      if (this.disabled.has(cap.name)) continue
      if (cap.tools.length === 0) continue
      const lines: string[] = [`## ${cap.name}`, cap.description]
      for (const tool of cap.tools) {
        lines.push(`- \`${tool.name}\` — ${tool.description}`)
      }
      blocks.push(lines.join('\n'))
    }
    return blocks.join('\n\n')
  }

  /**
   * Structured tool definitions handed to the LLM API call. Tools from
   * pure-skill capabilities (no plugin) are filtered out — the LLM should
   * only see what can actually execute.
   */
  getToolDefinitions(): ToolDefinition[] {
    const out: ToolDefinition[] = []
    for (const cap of this.capabilities.values()) {
      if (cap.status !== 'ok') continue
      if (!cap.hasPlugin) continue
      if (this.disabled.has(cap.name)) continue
      for (const tool of cap.tools) {
        out.push({
          name: tool.name,
          description: tool.description,
          parameters: toJSONSchema(tool.parameters)
        })
      }
    }
    return out
  }

  /**
   * Match the message against trigger keywords and return matching skill
   * bodies for prompt injection. Pure skills (git) hit here too
   * so the LLM sees their procedure when relevant.
   */
  findRelevantSkills(message: string, limit = 3): Capability[] {
    const lower = message.toLowerCase()
    const always: Capability[] = []
    const scored: Array<{ cap: Capability; score: number }> = []
    for (const cap of this.capabilities.values()) {
      if (cap.status !== 'ok') continue
      if (this.disabled.has(cap.name)) continue
      // A trigger of "*" means always inject this skill — no keyword
      // matching needed. These don't count against the limit.
      if (cap.triggers.keywords.includes('*')) {
        always.push(cap)
        continue
      }
      let score = 0
      for (const kw of cap.triggers.keywords) {
        if (lower.includes(kw.toLowerCase())) score += 1
      }
      if (score > 0) scored.push({ cap, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return [...always, ...scored.slice(0, limit).map((s) => s.cap)]
  }

  /**
   * Find the plugin that owns this tool name and call its execute method.
   * Returns a structured failure when the tool is unknown rather than
   * throwing, so the LLM can see the error and recover.
   */
  async executeTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    toolCallId?: string
  ): Promise<ToolExecutionResult> {
    // Expose the toolCallId to plugins that ask the user a question (the
    // `ask` capability anchors its card to it). Save/restore so a nested
    // executeTool (e.g. a dependency check) can't strand a stale id.
    const prevToolCallId = this.activeToolCallId
    if (toolCallId) this.activeToolCallId = toolCallId
    try {
      return await this.executeToolInner(name, args, signal)
    } finally {
      this.activeToolCallId = prevToolCallId
    }
  }

  private async executeToolInner(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<ToolExecutionResult> {
    const capName = this.toolToCapability.get(name)
    if (!capName) {
      return { success: false, error: `unknown tool: ${name}` }
    }
    if (this.disabled.has(capName)) {
      return { success: false, error: `capability "${capName}" is disabled` }
    }
    let plugin = this.plugins.get(capName)
    if (!plugin) {
      // Plugin is registered but not yet loaded. This path runs when a tool
      // is invoked without going through ensureDependencies first — e.g.
      // dependency check tools called from within ensureDependencies, or
      // any path that bypasses the agent loop. Trigger the same lazy
      // sequence: install npm deps if needed, then import the plugin.
      const cap = this.capabilities.get(capName)
      if (!cap) return { success: false, error: `no capability for tool: ${name}` }
      try {
        await this.ensureNpmDependencies(cap)
        await this.ensurePluginLoaded(cap)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
      plugin = this.plugins.get(capName)
      if (!plugin) {
        return { success: false, error: `no plugin loaded for tool: ${name}` }
      }
    }
    try {
      // Normalize whatever the plugin returned into a proper
      // ToolExecutionResult. Plugins authored at runtime (the `skills`
      // capability) commonly return a bare string or put their payload on a
      // non-standard field (`return { result }` instead of `{ success, output }`);
      // without this, a successful call renders an EMPTY tool card and the model
      // can't see what happened. Well-formed results pass through untouched.
      const result = normalizeToolResult(await plugin.execute(name, args, signal))
      // A successful *_install can place a binary on the persistent PATH that
      // this long-lived process didn't inherit (Windows: a new registry entry;
      // macOS/Linux: a brand-new bin dir such as a first Homebrew install).
      // Re-read PATH so the next tool — in ANY capability, since process.env.PATH
      // is shared by every plugin spawn — finds it without an app restart. This
      // is the central counterpart to the refreshPath() in ensureDependencies:
      // that covers auto-resolved dependency installs, this covers a direct
      // *_install tool call. Centralized here so every install tool is covered on
      // every OS, not just the few plugins that self-refresh.
      if (result.success && name.endsWith('_install')) {
        refreshPath()
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  }

  /**
   * Look up which capability owns a given tool name.
   */
  getToolCapability(toolName: string): string | undefined {
    return this.toolToCapability.get(toolName)
  }

  /**
   * Walk the `requires` chain for a capability and ensure every dependency
   * is installed. Each missing dependency is installed through amygdala
   * (which prompts the user). The capability itself is NOT auto-installed —
   * if the LLM is calling an _install tool, that's the install. This only
   * resolves transitive prerequisites.
   *
   * Cache is per-session: once a dependency is satisfied we never re-check
   * it on this run. Recursion is capped at depth 3 to break cycles.
   *
   * @param capabilityName - The capability whose `requires` chain to resolve
   * @param hook - Optional segment emitter so synthetic install tool calls
   *   surface as cards in the renderer (without it, the approval card has
   *   nowhere to render and the user sees nothing)
   * @param depth - Internal recursion depth tracker
   * @throws When a dependency install fails or the user denies it
   */
  async ensureDependencies(
    capabilityName: string,
    hook?: DependencyEmitHook,
    depth = 0
  ): Promise<void> {
    if (this.dependencyCache.get(capabilityName)) return

    if (depth > 3) {
      throw new Error(
        `Dependency depth exceeded (max 3) resolving "${capabilityName}". Possible circular dependency.`
      )
    }

    const cap = this.capabilities.get(capabilityName)
    if (!cap) {
      // Unknown capability — nothing we can resolve. Don't throw; the
      // caller may be a tool from a plugin that didn't declare a SKILL.md.
      this.dependencyCache.set(capabilityName, true)
      return
    }
    if (cap.status !== 'ok') {
      throw new Error(`Capability "${capabilityName}" failed to load: ${cap.error}`)
    }

    // Resolve transitive system-tool requires first (e.g. node, ffmpeg).
    // This may trigger amygdala-gated installs.
    for (const depName of cap.requires) {
      this.options.corpus?.emit('dependency.checking', {
        capability: capabilityName,
        dependency: depName
      })

      if (this.dependencyCache.get(depName)) {
        this.options.corpus?.emit('dependency.satisfied', {
          capability: capabilityName,
          dependency: depName,
          cached: true
        })
        continue
      }

      // First resolve the dependency's own requires (transitive chain)
      await this.ensureDependencies(depName, hook, depth + 1)

      // Now check if the dependency itself is installed
      const depCap = this.capabilities.get(depName)
      if (!depCap || depCap.status !== 'ok') {
        throw new Error(
          `Cannot use ${capabilityName} — required capability "${depName}" is not loaded`
        )
      }

      const checkTool = depCap.tools.find((t) => t.name.endsWith('_check'))
      if (!checkTool) {
        // No check tool means the dependency is a pure logical capability
        // (no installable software). Treat as satisfied.
        this.dependencyCache.set(depName, true)
        this.options.corpus?.emit('dependency.satisfied', {
          capability: capabilityName,
          dependency: depName,
          cached: false
        })
        continue
      }

      const checkResult = await this.executeTool(checkTool.name, {})
      const parsed = checkResult.success ? safeJsonParse(checkResult.output) : null

      if (parsed?.installed) {
        this.dependencyCache.set(depName, true)
        this.options.corpus?.emit('dependency.satisfied', {
          capability: capabilityName,
          dependency: depName,
          cached: false
        })
        continue
      }

      this.options.corpus?.emit('dependency.missing', {
        capability: capabilityName,
        dependency: depName
      })

      try {
        await this.installCapability(depCap, capabilityName, hook)
        refreshPath()
        this.dependencyCache.set(depName, true)
        this.options.corpus?.emit('dependency.installed', {
          capability: capabilityName,
          dependency: depName
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.options.corpus?.emit('dependency.failed', {
          capability: capabilityName,
          dependency: depName,
          error: message
        })
        throw new Error(`Cannot use ${capabilityName} — ${message}`)
      }
    }

    // System requires are now satisfied. Install the capability's own npm
    // deps (if any) into <capability>/node_modules, then lazy-load the
    // plugin module. Plugins use the standard Node module resolution
    // walking up from their file location, so deps installed at the
    // capability root resolve correctly.
    if (cap.hasPlugin) {
      await this.ensureNpmDependencies(cap, hook)
      await this.ensurePluginLoaded(cap)
    }

    this.dependencyCache.set(capabilityName, true)
  }

  /**
   * Ensure a single system-tool capability (e.g. `ffmpeg`) is installed,
   * for the code paths that invoke a plugin tool DIRECTLY via executeTool
   * and therefore bypass the agent loop's ensureDependencies() resolution —
   * the in-app STT IPC handler and the Telegram/WhatsApp voice handlers.
   * Without this, transcription on a fresh machine dead-ends with
   * "ffmpeg is required for transcription" instead of self-healing.
   *
   * Mirrors the per-dependency block of ensureDependencies (check → install
   * → refreshPath → cache) but runs the install through executeTool, NOT
   * executeWithApproval — so it is SILENT (no amygdala approval card). That's
   * deliberate: this is an internal prerequisite the user never asked to
   * confirm, on a single-user machine. Idempotent and cached per session, so
   * it's cheap to call before every transcription. Never throws — returns a
   * result the caller can fall through on.
   */
  async ensureSystemTool(capName: string): Promise<{ ok: boolean; error?: string }> {
    if (this.dependencyCache.get(capName)) return { ok: true }
    const cap = this.capabilities.get(capName)
    // Unknown/failed capability — don't block the caller; let the tool run
    // and surface its own error (mirrors ensureDependencies' lenient stance).
    if (!cap || cap.status !== 'ok') return { ok: true }

    const checkTool = cap.tools.find((t) => t.name.endsWith('_check'))
    if (!checkTool) {
      this.dependencyCache.set(capName, true)
      return { ok: true }
    }
    const checkResult = await this.executeTool(checkTool.name, {})
    const parsed = checkResult.success ? safeJsonParse(checkResult.output) : null
    if (parsed?.installed) {
      this.dependencyCache.set(capName, true)
      return { ok: true }
    }

    const installTool =
      cap.tools.find((t) => t.name.endsWith('_install_manager')) ??
      cap.tools.find((t) => t.name.endsWith('_install'))
    if (!installTool) {
      return { ok: false, error: `${capName} is not installed and has no install tool` }
    }
    // executeTool() calls refreshPath() after a successful *_install, so the
    // freshly installed binary is on PATH for the very next spawn.
    const installResult = await this.executeTool(installTool.name, {})
    if (!installResult.success) {
      return { ok: false, error: installResult.error ?? `failed to install ${capName}` }
    }
    this.dependencyCache.set(capName, true)
    return { ok: true }
  }

  /**
   * If the capability has a package.json with declared deps, run `npm
   * install` in its folder once per session. Idempotent: a marker file in
   * <capability>/node_modules/.wolffish-installed records the package.json
   * hash so the install is skipped on later sessions when nothing changed.
   * Generic — works for any capability with a package.json, no per-cap code.
   */
  private async ensureNpmDependencies(cap: Capability, hook?: DependencyEmitHook): Promise<void> {
    if (Object.keys(cap.npmDependencies).length === 0) return
    const cacheKey = `npm:${cap.name}`
    if (this.dependencyCache.get(cacheKey)) return

    // On Windows the Electron process may have launched with a stale PATH that
    // doesn't include binaries installed in a prior session (e.g. node/npm from
    // winget). Refresh once before the first npm spawn so we don't fail with
    // "npm.cmd not recognized" when npm is actually on disk.
    if (!this.dependencyCache.get('__pathRefreshed')) {
      refreshPath()
      this.dependencyCache.set('__pathRefreshed', true)
    }

    const pkgPath = path.join(cap.dir, 'package.json')
    const markerPath = path.join(cap.dir, 'node_modules', '.wolffish-installed')

    let pkgRaw: string
    try {
      pkgRaw = await fs.readFile(pkgPath, 'utf8')
    } catch {
      this.dependencyCache.set(cacheKey, true)
      return
    }

    const pkgHash = hashString(pkgRaw)

    let needsInstall = true
    try {
      const marker = await fs.readFile(markerPath, 'utf8')
      if (marker.trim() === pkgHash) needsInstall = false
    } catch {
      needsInstall = true
    }

    if (!needsInstall) {
      this.dependencyCache.set(cacheKey, true)
      return
    }

    // Defense-in-depth: npm install needs node + npm on PATH. Plugins that carry
    // npmDependencies SHOULD declare requires:[node], but to make this class of
    // failure impossible (a fresh non-dev machine has no system Node), provision
    // the managed Node — and put it on PATH — before installing, regardless of
    // what the plugin declared. ensureDependencies is cached, so this is a no-op
    // once Node is ready; skipped for the node capability itself to avoid a cycle.
    if (cap.name !== 'node') {
      await this.ensureDependencies('node', hook)
    }

    this.options.corpus?.emit('dependency.npm.installing', {
      capability: cap.name,
      deps: Object.keys(cap.npmDependencies)
    })

    // Unique per emission. A bare timestamp can collide when the same
    // capability's install is re-attempted (it's only marked done on success,
    // so a failing install re-enters here), and two identical synthetic
    // `tool_call_id`s in the replayed history make OpenAI-style providers
    // (DeepSeek, etc.) reject the whole request with HTTP 400 "Duplicate
    // value for 'tool_call_id'". The random suffix guarantees uniqueness.
    const callId = `npm_${cap.name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    hook?.emitToolCall(callId, '__npm_install', {
      capability: cap.name,
      packages: cap.npmDependencies
    })

    try {
      const result = await runNpmInstall(cap.dir)
      if (!result.success) {
        hook?.emitToolResult(
          callId,
          'failed',
          result.output ?? '',
          result.error ?? 'npm install failed'
        )
        this.options.corpus?.emit('dependency.npm.failed', {
          capability: cap.name,
          error: result.error
        })
        throw new Error(
          `Failed to install npm dependencies for "${cap.name}": ${result.error ?? 'unknown error'}`
        )
      }

      await fs.writeFile(markerPath, pkgHash, 'utf8').catch(() => {
        // Best-effort marker; if it fails we'll just reinstall next session.
      })

      hook?.emitToolResult(
        callId,
        'success',
        `Installed ${Object.keys(cap.npmDependencies).length} npm package(s) for ${cap.name}.`
      )
      this.options.corpus?.emit('dependency.npm.installed', { capability: cap.name })
      this.dependencyCache.set(cacheKey, true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      hook?.emitToolResult(callId, 'failed', '', message)
      throw err
    }
  }

  /**
   * Import the plugin module (now that npm deps are guaranteed installed)
   * and call its init hook. Cached after first successful load.
   */
  private async ensurePluginLoaded(cap: Capability): Promise<void> {
    if (this.plugins.has(cap.name)) return
    if (!cap.pluginEntryPath) return

    let plugin: WolffishPlugin
    try {
      plugin = await this.importPlugin(cap.pluginEntryPath, cap.name)
    } catch (err) {
      // Surface the ACTUAL reason (syntax error, wrong export shape, …) instead
      // of a generic "exports a valid Wolffish plugin" — the model needs the
      // specific mistake to fix its own skill on the next step.
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Failed to load plugin for "${cap.name}": ${message} (${cap.pluginEntryPath})`
      )
    }

    try {
      await plugin.init?.({
        pluginDir: path.dirname(cap.pluginEntryPath),
        workspaceRoot: this.options.workspaceRoot ?? '',
        getCurrentConversationId: () => this.currentConversationId,
        sudo: sudoSession,
        host: this.pluginHost,
        automations: this.automationsHost,
        askUser: (input) => this.dispatchAskUser(input),
        getChannelStatus: () => this.channelStatusProvider?.() ?? []
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Plugin "${cap.name}" init failed: ${message}`)
    }

    this.plugins.set(cap.name, plugin)
  }

  /**
   * Build a human-readable description of a tool call for the approval
   * card. Calls the plugin's `describeAction` if defined, otherwise falls
   * back to the tool's SKILL.md description.
   */
  async describeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ApprovalDescription> {
    const capName = this.toolToCapability.get(toolName)
    if (capName) {
      const plugin = this.plugins.get(capName)
      if (plugin?.describeAction) {
        try {
          return await plugin.describeAction(toolName, args)
        } catch {
          // fall through to schema-based fallback
        }
      }
    }

    const cap = capName ? this.capabilities.get(capName) : undefined
    const tool = cap?.tools.find((t) => t.name === toolName)
    return {
      title: titleCase(toolName),
      description: tool?.description ?? toolName,
      risk: 'medium'
    }
  }

  /**
   * Return the platform-specific package identifiers from a capability's
   * SKILL.md `packages` field, mapped to pkg_install argument names.
   */
  getPackageIdentifiers(capabilityName: string): Record<string, string> {
    const cap = this.capabilities.get(capabilityName)
    if (!cap) return {}
    const out: Record<string, string> = {}
    if (cap.packages.brew) out.brew_name = cap.packages.brew
    if (cap.packages.winget_id) out.winget_id = cap.packages.winget_id
    if (cap.packages.apt) out.apt_name = cap.packages.apt
    if (cap.packages.dnf) out.dnf_name = cap.packages.dnf
    return out
  }

  getCapabilities(): Capability[] {
    return [...this.capabilities.values()]
  }

  /**
   * Drop the cached scan and re-read brain/cerebellum/ from disk. Lets the
   * UI pick up newly added or edited SKILL.md files without an app restart.
   * Existing plugins are torn down first so their destroy() hooks run.
   */
  async reload(): Promise<{ capabilities: Capability[] }> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.destroy?.()
      } catch {
        // best-effort
      }
    }
    this.plugins.clear()
    this.capabilities.clear()
    this.toolToCapability.clear()
    this.dependencyCache.clear()
    this.loaded = false
    // New tool surface, and any re-imported plugin must dodge Node's ESM
    // cache (see importPlugin) — both ride on this bump.
    this.generation++
    return this.loadAll()
  }

  /**
   * Tear down every plugin's destroy hook. Called on app shutdown.
   */
  async stop(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.destroy?.()
      } catch {
        // best-effort: a plugin's destroy failure must not block shutdown
      }
    }
    this.plugins.clear()
    // Drop the cached admin password and remove the askpass helper dir on app
    // shutdown. (reload() deliberately does NOT do this, so the password
    // survives a capability reload.)
    await sudoSession.destroy().catch(() => {})
  }

  private async loadCapability(capDir: string, folderName: string): Promise<Capability | null> {
    const skillPath = path.join(capDir, 'SKILL.md')
    let raw: string
    try {
      raw = await fs.readFile(skillPath, 'utf8')
    } catch {
      return null
    }

    const { frontmatter, body } = parseSkillMd(raw)
    if (!frontmatter || !frontmatter.name) {
      throw new Error(`SKILL.md in ${folderName}/ missing required frontmatter (name)`)
    }

    const name = frontmatter.name
    const tools = frontmatter.tools ?? []
    const triggers = frontmatter.triggers ?? []
    const dangers = frontmatter.danger_patterns ?? []
    const confirms = frontmatter.confirm_patterns ?? []

    if (this.options.amygdala) {
      const dangerPatterns: DangerPattern[] = []
      for (const d of dangers) {
        const re = safeRegExp(d.pattern)
        if (!re) continue
        dangerPatterns.push({ match: re, level: d.level, reason: d.reason })
      }
      for (const c of confirms) {
        const re = safeRegExp(c.pattern)
        if (!re) continue
        dangerPatterns.push({ match: re, level: 'confirm', reason: c.reason })
      }
      if (dangerPatterns.length > 0) this.options.amygdala.registerPatterns(dangerPatterns)
    }

    const pluginDir = path.join(capDir, 'plugin')
    let hasPlugin = false
    let pluginEntryPath: string | undefined
    try {
      const stat = await fs.stat(pluginDir)
      if (stat.isDirectory()) {
        const pluginFile = await findPluginEntry(pluginDir)
        if (pluginFile) {
          hasPlugin = true
          pluginEntryPath = pluginFile
          // Register tool ownership immediately so executeTool() can route
          // calls and ensureDependencies() can be triggered by the agent —
          // even though the plugin module itself is not imported until
          // first use (after npm deps install).
          for (const tool of tools) {
            this.toolToCapability.set(tool.name, name)
          }
        }
      }
    } catch {
      hasPlugin = false
    }

    const npmDependencies = await readNpmDependencies(capDir)

    const cap: Capability = {
      name,
      dir: capDir,
      description: frontmatter.description ?? '',
      triggers: { keywords: triggers },
      tools,
      body,
      hasPlugin,
      status: 'ok',
      requires: frontmatter.requires ?? [],
      packages: (frontmatter.packages ?? {}) as Record<string, string>,
      npmDependencies,
      pluginEntryPath
    }

    return cap
  }

  /**
   * Import a plugin module and validate its export shape. Throws a descriptive
   * error on failure (caught by ensurePluginLoaded) so the model sees the real
   * reason — a syntax error, or the most common mistake: `tools` declared as an
   * object with inline handlers instead of an array plus a separate execute().
   */
  private async importPlugin(file: string, capName: string): Promise<WolffishPlugin> {
    let mod: { default?: WolffishPlugin } | WolffishPlugin
    try {
      // pathToFileURL keeps Windows happy and bypasses the loader's
      // resolve-from-cwd behaviour for plain string paths. The `?v=`
      // generation suffix busts Node's ESM module cache so a plugin edited
      // on disk and reloaded actually re-evaluates instead of resolving to
      // the stale first-import — without it, the create→edit→reload→retest
      // loop would silently keep running the original code. fileURLToPath
      // ignores the query, so plugins that locate bundled files via
      // import.meta.url (speech-to-text, text-to-speech) are unaffected.
      const href = `${pathToFileURL(file).href}?v=${this.generation}`
      mod = (await import(href)) as { default?: WolffishPlugin } | WolffishPlugin
    } catch (err) {
      void capName
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`module failed to import (${message})`)
    }
    const plugin = (mod as { default?: WolffishPlugin }).default ?? (mod as WolffishPlugin)
    // Be liberal in what we accept (Postel's law): model-authored plugins
    // routinely use a different convention from some other tool framework.
    // If `execute` is missing, synthesize one from whatever dispatcher the
    // plugin DID provide — a top-level alias (MCP `handleToolCall`, `run`, …)
    // or per-tool inline handlers (`tools: [{ name, handler }]`, array or
    // object). Result shapes are normalized in normalizeToolResult.
    if (plugin && typeof plugin.execute !== 'function') {
      const synthesized = synthesizeExecute(plugin)
      if (synthesized) plugin.execute = synthesized
    }
    if (!plugin || typeof plugin.execute !== 'function') {
      throw new Error(
        'no dispatcher found — export `async execute(toolName, args)` (an MCP-style `handleToolCall`, ' +
          'or per-tool `handler` functions on the tools, are also accepted). ' +
          'Canonical shape: export default { name, tools: [...], async execute(toolName, args) {...} }'
      )
    }
    return plugin
  }

  private async installCapability(
    cap: Capability,
    parentCap: string,
    hook?: DependencyEmitHook
  ): Promise<void> {
    if (Object.keys(cap.packages).length > 0 && cap.requires.includes('package-manager')) {
      const args: Record<string, unknown> = { package_name: cap.name }
      if (cap.packages.brew) args.brew_name = cap.packages.brew
      if (cap.packages.winget_id) args.winget_id = cap.packages.winget_id
      if (cap.packages.apt) args.apt_name = cap.packages.apt
      if (cap.packages.dnf) args.dnf_name = cap.packages.dnf
      await this.executeWithApproval('pkg_install', args, cap.name, parentCap, hook)
    } else {
      const installTool =
        cap.tools.find((t) => t.name.endsWith('_install_manager')) ??
        cap.tools.find((t) => t.name.endsWith('_install'))
      if (!installTool) {
        throw new Error(`"${cap.name}" is not installed and has no install tool`)
      }
      await this.executeWithApproval(installTool.name, {}, cap.name, parentCap, hook)
    }
  }

  private async executeWithApproval(
    toolName: string,
    args: Record<string, unknown>,
    depName: string,
    parentCap: string,
    hook?: DependencyEmitHook
  ): Promise<void> {
    const call: ToolCall = {
      id: `dep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: toolName,
      args
    }

    // Emit a synthetic tool_call segment BEFORE asking amygdala for
    // approval. The renderer keys approval cards off matching tool_call
    // segments — without one, the IPC fires fine but the dialog never
    // renders and the install Promise hangs forever waiting for a click
    // that can't happen.
    hook?.emitToolCall(call.id, toolName, args)

    if (this.options.amygdala) {
      const match = this.options.amygdala.match(call)
      if (match) {
        if (match.level === 'block') {
          hook?.emitToolResult(call.id, 'denied', '', `Blocked: ${match.reason}`)
          throw new Error(`Installation of "${depName}" blocked: ${match.reason}`)
        }
        if (match.level === 'confirm' || match.level === 'destructive') {
          const description = await this.describeToolCall(toolName, args)
          const decision = await this.options.amygdala.requestApproval({
            toolCall: call,
            level: match.level,
            reason: match.reason,
            description
          })
          if (decision === 'denied') {
            this.options.corpus?.emit('dependency.denied', {
              capability: parentCap,
              dependency: depName
            })
            hook?.emitToolResult(
              call.id,
              'denied',
              `Denied: ${depName} installation`,
              'user denied'
            )
            throw new Error(`user denied ${depName} installation, which is a required dependency`)
          }
          this.options.corpus?.emit('dependency.approved', {
            capability: parentCap,
            dependency: depName
          })
        }
      }
    }

    this.options.corpus?.emit('dependency.installing', {
      capability: parentCap,
      dependency: depName
    })

    const result = await this.executeTool(toolName, args)
    if (!result.success) {
      hook?.emitToolResult(call.id, 'failed', result.output ?? '', result.error ?? 'unknown error')
      throw new Error(`failed to install ${depName}: ${result.error ?? 'unknown error'}`)
    }
    hook?.emitToolResult(call.id, 'success', result.output ?? '')
  }
}

async function findPluginEntry(pluginDir: string): Promise<string | null> {
  for (const filename of PLUGIN_FILES) {
    const p = path.join(pluginDir, filename)
    try {
      const stat = await fs.stat(p)
      if (stat.isFile()) return p
    } catch {
      // try next
    }
  }
  return null
}

function parseSkillMd(raw: string): {
  frontmatter: SkillFrontmatter | null
  body: string
} {
  if (!raw.startsWith('---')) return { frontmatter: null, body: raw.trim() }
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return { frontmatter: null, body: raw.trim() }
  const yamlBlock = raw.slice(3, end).trim()
  const body = raw.slice(end + 4).trim()
  let frontmatter: SkillFrontmatter | null = null
  try {
    const parsed = yaml.load(yamlBlock)
    if (parsed && typeof parsed === 'object') {
      frontmatter = parsed as SkillFrontmatter
    }
  } catch {
    return { frontmatter: null, body }
  }
  return { frontmatter, body }
}

function safeRegExp(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

function titleCase(toolName: string): string {
  return toolName
    .split('_')
    .map((part) => (part.length === 0 ? '' : part[0].toUpperCase() + part.slice(1)))
    .join(' ')
}

/**
 * Coerce whatever a plugin's execute() returned into a well-formed
 * ToolExecutionResult. The contract is `{ success, output }`, but a plugin
 * authored at runtime by the model often returns a bare value or stashes its
 * payload on a different key. Rather than render an empty card (success with
 * no visible output — exactly the confusing failure mode the coinflip test
 * hit), surface the payload:
 *
 *  - a bare string/number/bool        → { success: true, output: <stringified> }
 *  - `{ result: 'heads' }`            → output becomes "heads" (lone scalar field)
 *  - `{ foo: 1, bar: 2 }`             → output becomes the JSON of the extra fields
 *  - `{ error: 'boom' }`              → success: false
 *  - already `{ success, output }`    → passed through unchanged
 *
 * A deliberate empty success (`{ success: true }` with no other data) stays
 * empty — we only synthesize output when the plugin clearly returned data on
 * the wrong field.
 */
/**
 * When a plugin doesn't export `execute`, build one from whatever dispatcher
 * convention it DID use, so model-authored plugins that mirror another tool
 * framework still load. Returns null if no usable dispatcher is found.
 *
 * Recognized, in order: a top-level alias (handleToolCall/run/call/…), then
 * per-tool inline handlers on `tools` — an array (`[{ name, handler }]`) or an
 * object keyed by tool name (`{ toolName: { handler } }`). Handlers may be
 * named handler/run/fn/execute/callback. Kept in sync with the skills
 * capability's smoke-test (DISPATCHER_NAMES / per-tool handler detection).
 */
function synthesizeExecute(plugin: WolffishPlugin): WolffishPlugin['execute'] | null {
  const p = plugin as unknown as Record<string, unknown>

  const aliasKey = [
    'handleToolCall',
    'handle',
    'run',
    'call',
    'invoke',
    'onToolCall',
    'dispatch'
  ].find((k) => typeof p[k] === 'function')
  if (aliasKey) {
    const alias = p[aliasKey] as (...a: unknown[]) => unknown
    return (toolName, args, signal) =>
      Promise.resolve(alias.call(plugin, toolName, args, signal)) as ReturnType<
        WolffishPlugin['execute']
      >
  }

  const handlerOf = (t: unknown): unknown => {
    if (!t || typeof t !== 'object') return undefined
    const o = t as Record<string, unknown>
    return o.handler ?? o.run ?? o.fn ?? o.execute ?? o.callback
  }
  const tools = p.tools
  let lookup: ((name: string) => unknown) | null = null
  let sample: unknown[] = []
  if (Array.isArray(tools)) {
    lookup = (name) => tools.find((t) => (t as Record<string, unknown>)?.name === name)
    sample = tools
  } else if (tools && typeof tools === 'object') {
    const o = tools as Record<string, unknown>
    lookup = (name) => o[name]
    sample = Object.values(o)
  }
  if (lookup && sample.some((t) => typeof handlerOf(t) === 'function')) {
    const find = lookup
    return ((toolName: string, args: Record<string, unknown>, signal?: AbortSignal) => {
      const tool = find(toolName)
      const fn = handlerOf(tool)
      if (typeof fn !== 'function') {
        return Promise.resolve({ success: false, error: `unknown or unhandled tool: ${toolName}` })
      }
      return Promise.resolve((fn as (...a: unknown[]) => unknown).call(tool, args, signal))
    }) as WolffishPlugin['execute']
  }

  return null
}

function normalizeToolResult(raw: unknown): ToolExecutionResult {
  if (raw === null || raw === undefined) {
    return {
      success: false,
      error: 'plugin returned no result — execute() must return { success, output }'
    }
  }
  if (typeof raw === 'string') return { success: true, output: raw }
  if (typeof raw !== 'object') return { success: true, output: String(raw) }

  const r = raw as Record<string, unknown>
  const success =
    typeof r.success === 'boolean' ? r.success : r.error != null && r.error !== '' ? false : true

  let output = typeof r.output === 'string' ? r.output : r.output != null ? String(r.output) : ''

  // Plugin returned data but not on `output`/`error`: pull it onto output so
  // the call isn't a silent blank.
  if (success && output === '' && (r.error == null || r.error === '')) {
    // MCP-style result: { content: [{ type: 'text', text }] }. Flatten the
    // text blocks so a plugin written to the MCP tool contract renders cleanly
    // instead of dumping raw JSON.
    if (Array.isArray(r.content)) {
      const text = (r.content as unknown[])
        .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>).text : undefined))
        .filter((t): t is string => typeof t === 'string')
        .join('\n')
      if (text) output = text
    }
    if (output === '') {
      const known = new Set(['success', 'output', 'error', 'images', 'exitCode', 'partial'])
      const extra: Record<string, unknown> = {}
      for (const k of Object.keys(r)) if (!known.has(k)) extra[k] = r[k]
      const keys = Object.keys(extra)
      if (keys.length === 1 && ['string', 'number', 'boolean'].includes(typeof extra[keys[0]])) {
        output = String(extra[keys[0]])
      } else if (keys.length > 0) {
        try {
          output = JSON.stringify(extra)
        } catch {
          // non-serializable — leave output empty rather than throw
        }
      }
    }
  }

  const out: ToolExecutionResult = { success, output }
  if (r.error != null && r.error !== '') {
    out.error = typeof r.error === 'string' ? r.error : String(r.error)
  }
  if (Array.isArray(r.images)) out.images = r.images as ToolResultImage[]
  if (typeof r.exitCode === 'number' || r.exitCode === null) {
    out.exitCode = r.exitCode as number | null
  }
  if (typeof r.partial === 'boolean') out.partial = r.partial
  return out
}

function safeJsonParse(str?: string): Record<string, unknown> | null {
  if (!str) return null
  try {
    const obj = JSON.parse(str)
    return typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function toJSONSchema(parameters: Record<string, ToolParameterSpec>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, spec] of Object.entries(parameters ?? {})) {
    const prop: Record<string, unknown> = {
      type: spec.type ?? 'string'
    }
    if (spec.description) prop.description = spec.description
    if (spec.enum) prop.enum = spec.enum
    // Pass nested array/object schemas through so the model sees the precise
    // shape (and strict providers don't reject an item-less array).
    if (spec.items) prop.items = spec.items
    if (spec.properties) prop.properties = spec.properties
    properties[key] = prop
    // Default required so existing skills (which omit the field) keep their
    // current schema. Opt out per-param with `required: false` in frontmatter.
    if (spec.required !== false) required.push(key)
  }
  return {
    type: 'object',
    properties,
    required
  }
}

/**
 * Read the capability's package.json (if it exists) and return the
 * combined dependencies + devDependencies map. Returns an empty object
 * when no package.json or no deps. Each capability is a self-contained
 * npm project — its deps go in <capability>/node_modules, never in
 * wolffish-core's node_modules.
 */
async function readNpmDependencies(capDir: string): Promise<Record<string, string>> {
  const pkgPath = path.join(capDir, 'package.json')
  let raw: string
  try {
    raw = await fs.readFile(pkgPath, 'utf8')
  } catch {
    return {}
  }
  try {
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps: Record<string, string> = {}
    if (pkg.dependencies) Object.assign(deps, pkg.dependencies)
    if (pkg.devDependencies) Object.assign(deps, pkg.devDependencies)
    return deps
  } catch {
    return {}
  }
}

const NPM_OUTPUT_LIMIT = 50_000

// Hard cap for a single `npm install` (download + extract + postinstall). The
// browser capability's postinstall pulls a ~150 MB Chromium build, so this is
// generous — but finite, so a stalled network can't hang the task forever.
const NPM_INSTALL_TIMEOUT_MS = 10 * 60_000

/**
 * Spawn `npm install` in the capability directory. Returns success/failure
 * with truncated combined output. Cross-platform: resolves the npm binary
 * via PATH (npm.cmd on Windows). Surfaces a clear error if npm is missing
 * so the agent can prompt the user to install Node.js.
 */
function runNpmInstall(
  cwd: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const args = ['install', '--no-audit', '--no-fund', '--prefer-offline', '--omit=dev']

    let child
    try {
      child = spawn(npmBin, args, {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32'
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      resolve({
        success: false,
        error: `Failed to spawn npm: ${message}. Is Node.js installed?`
      })
      return
    }

    let stdout = ''
    let stderr = ''
    let resolved = false
    let timedOut = false
    // Hard backstop: a hung install (stalled network, wedged postinstall like
    // Playwright's Chromium download) must not block the task forever. After
    // the cap, kill the whole process tree — npm runs under a shell and spawns
    // node for postinstall scripts, so a plain child.kill() would orphan them.
    const killTree = (): void => {
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
        } else {
          child.kill('SIGKILL')
        }
      } catch {
        // best-effort
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      killTree()
    }, NPM_INSTALL_TIMEOUT_MS)

    const finish = (result: { success: boolean; output?: string; error?: string }): void => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      resolve(result)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < NPM_OUTPUT_LIMIT) {
        stdout += chunk.toString().slice(0, NPM_OUTPUT_LIMIT - stdout.length)
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < NPM_OUTPUT_LIMIT) {
        stderr += chunk.toString().slice(0, NPM_OUTPUT_LIMIT - stderr.length)
      }
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      const message =
        err.code === 'ENOENT'
          ? 'npm command not found. Install Node.js (which bundles npm) and try again.'
          : err.message
      finish({ success: false, error: message })
    })

    child.on('close', (code: number | null) => {
      const combined = (stdout + (stderr ? '\n' + stderr : '')).trim()
      if (timedOut) {
        finish({
          success: false,
          error:
            `npm install timed out after ${Math.round(NPM_INSTALL_TIMEOUT_MS / 60_000)} min and was terminated (likely a stalled download or postinstall). ${combined.slice(-1000)}`.trim(),
          output: combined
        })
      } else if (code === 0) {
        finish({ success: true, output: combined || 'npm install completed.' })
      } else {
        finish({
          success: false,
          error: `npm install exited with code ${code}: ${combined.slice(-2000)}`,
          output: combined
        })
      }
    })
  })
}

function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 32)
}

/**
 * Re-resolve PATH from the user's login shell and write it back into
 * process.env.PATH. Called after a system dependency install so newly
 * installed binaries are visible to every subsequent spawn — shell
 * plugin, npm install, browser plugin, all of them.
 */
function refreshPath(): void {
  if (process.platform === 'win32') {
    try {
      const script =
        "[Environment]::GetEnvironmentVariable('PATH','Machine');" +
        "[Environment]::GetEnvironmentVariable('PATH','User')"
      const raw = execFileSync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
      )
      const additions = raw
        .split(/\r?\n/)
        .flatMap((line: string) => line.split(';'))
        .map((p: string) => p.trim().replace(/[\\/]+$/, ''))
        .filter(Boolean)
      if (additions.length === 0) return
      const current = (process.env.PATH ?? '')
        .split(';')
        .map((p: string) => p.trim())
        .filter(Boolean)
      const seen = new Set(current.map((p: string) => p.toLowerCase().replace(/[\\/]+$/, '')))
      for (const entry of additions) {
        if (seen.has(entry.toLowerCase())) continue
        seen.add(entry.toLowerCase())
        current.push(entry)
      }
      process.env.PATH = current.join(';')
    } catch {
      // best-effort
    }
    return
  }
  const userShell = process.env.SHELL || '/bin/sh'
  try {
    const raw = execFileSync(userShell, ['-ilc', 'printf "__WFPATH__%s__WFPATH__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const resolved = raw.match(/__WFPATH__(.+?)__WFPATH__/)?.[1]
    if (resolved && resolved.includes(':')) {
      const current = (process.env.PATH ?? '').split(':').filter(Boolean)
      const seen = new Set(current)
      for (const dir of resolved.split(':')) {
        if (dir && !seen.has(dir)) {
          seen.add(dir)
          current.push(dir)
        }
      }
      process.env.PATH = current.join(':')
    }
  } catch {
    // best-effort
  }
}
