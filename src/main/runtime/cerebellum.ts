import type { Amygdala, DangerLevel, DangerPattern } from '@main/runtime/amygdala'
import type { Corpus } from '@main/runtime/corpus'
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
}

export type WolffishPlugin = {
  name: string
  tools: ToolDefinition[]
  execute: (toolName: string, args: Record<string, unknown>) => Promise<ToolExecutionResult>
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

  constructor(private options: CerebellumOptions = {}) {}

  setDisabled(names: string[]): void {
    this.disabled = new Set(names)
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
  setCurrentConversationId(id: string | null): void {
    this.currentConversationId = id
    this.options.corpus?.emit('conversation.changed', { conversationId: id })
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
    const scored: Array<{ cap: Capability; score: number }> = []
    for (const cap of this.capabilities.values()) {
      if (cap.status !== 'ok') continue
      if (this.disabled.has(cap.name)) continue
      let score = 0
      for (const kw of cap.triggers.keywords) {
        if (lower.includes(kw.toLowerCase())) score += 1
      }
      if (score > 0) scored.push({ cap, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map((s) => s.cap)
  }

  /**
   * Find the plugin that owns this tool name and call its execute method.
   * Returns a structured failure when the tool is unknown rather than
   * throwing, so the LLM can see the error and recover.
   */
  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
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
      const result = await plugin.execute(name, args)
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

    this.options.corpus?.emit('dependency.npm.installing', {
      capability: cap.name,
      deps: Object.keys(cap.npmDependencies)
    })

    const callId = `npm_${cap.name}_${Date.now().toString(36)}`
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

    const plugin = await this.importPlugin(cap.pluginEntryPath, cap.name)
    if (!plugin) {
      throw new Error(
        `Failed to load plugin for "${cap.name}". Check that ${cap.pluginEntryPath} exports a valid Wolffish plugin.`
      )
    }

    try {
      await plugin.init?.({
        pluginDir: path.dirname(cap.pluginEntryPath),
        workspaceRoot: this.options.workspaceRoot ?? '',
        getCurrentConversationId: () => this.currentConversationId
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

  private async importPlugin(file: string, capName: string): Promise<WolffishPlugin | null> {
    try {
      // pathToFileURL keeps Windows happy and bypasses the loader's
      // resolve-from-cwd behaviour for plain string paths.
      const mod = (await import(pathToFileURL(file).href)) as
        | { default?: WolffishPlugin }
        | WolffishPlugin
      const plugin = (mod as { default?: WolffishPlugin }).default ?? (mod as WolffishPlugin)
      if (!plugin || typeof plugin.execute !== 'function') {
        throw new Error(`plugin ${capName} missing execute()`)
      }
      return plugin
    } catch (err) {
      void err
      void capName
      return null
    }
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

    const finish = (result: { success: boolean; output?: string; error?: string }): void => {
      if (resolved) return
      resolved = true
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
      if (code === 0) {
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
  if (process.platform === 'win32') return
  const userShell = process.env.SHELL || '/bin/sh'
  try {
    const raw = execFileSync(userShell, ['-ilc', 'printf "__WFPATH__%s__WFPATH__" "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const resolved = raw.match(/__WFPATH__(.+?)__WFPATH__/)?.[1]
    if (resolved && resolved.includes(':')) process.env.PATH = resolved
  } catch {
    // best-effort
  }
}
