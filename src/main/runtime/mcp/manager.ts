/**
 * The MCP connection manager: one McpConnection per configured server,
 * config persistence, and the cerebellum registration seam. Constructed
 * once in main/index.ts; every IPC handler and the boot path go through
 * here. Failures stay inside individual connections — the manager never
 * throws out of its public surface.
 */
import crypto from 'node:crypto'
import type { Capability, WolffishPlugin } from '@main/runtime/cerebellum'
import { revokeTokens } from '@main/runtime/mcp/auth'
import { McpConnection } from '@main/runtime/mcp/connection'
import {
  deconflictSlug,
  deriveDisplayName,
  detectTransport,
  parseCommandLine,
  slugify
} from '@main/runtime/mcp/naming'
import type {
  McpAddInput,
  McpAddResult,
  McpConfig,
  McpServerConfig,
  McpServerSnapshot,
  McpTestResult
} from '@main/runtime/mcp/types'
import {
  addMcpServer,
  getMcpConfig,
  patchMcpServerOauth,
  removeMcpServer,
  updateMcpServer
} from '@main/workspace/workspace'

/** How long mcp:add waits for the first connect before returning "connecting". */
const ADD_SETTLE_CAP_MS = 8_000

export type McpManagerDeps = {
  register: (capability: Capability, plugin: WolffishPlugin) => void
  unregister: (name: string) => void
  openExternal: (url: string) => void
  appVersion: string
  onStatusChange: (snapshots: McpServerSnapshot[]) => void
  /**
   * Capability names currently loaded in the cerebellum, consulted when
   * choosing a new server's slug. Channel capabilities that register
   * lazily are covered by the reserved-slug list instead.
   */
  takenCapabilityNames: () => Set<string>
}

export class McpManager {
  private connections = new Map<string, McpConnection>()
  private started = false
  private notifyTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: McpManagerDeps) {}

  /**
   * Connect every enabled server. Called once at boot, and ONLY in the
   * instance that owns the workspace lock (index.ts gates this). So
   * `started` doubles as "this instance owns MCP" — the mutating actions
   * below refuse when it's false, keeping a non-owning instance (e.g. a
   * dev build running alongside a packaged one) from spawning duplicate
   * child processes or writing the shared config out from under the owner.
   */
  start(config: McpConfig | undefined): void {
    if (this.started) return
    this.started = true
    for (const server of config?.servers ?? []) {
      const connection = this.createConnection(server)
      this.connections.set(server.id, connection)
      connection.start()
    }
  }

  private get owns(): boolean {
    return this.started
  }

  private static readonly NOT_OWNER =
    'MCP connections are managed by another running instance of Wolffish'

  /** Deliberate teardown (app shutdown, factory reset). Bounded, parallel. */
  async stop(): Promise<void> {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer)
      this.notifyTimer = null
    }
    await Promise.allSettled([...this.connections.values()].map((c) => c.stop()))
  }

  /**
   * Synchronous last-resort child sweep for app 'will-quit' — the idle
   * quit path never runs the async drain, and Node does not kill child
   * processes on parent exit.
   */
  killAllSync(): void {
    for (const connection of this.connections.values()) {
      const pid = connection.childPid
      if (!pid) continue
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // already gone
      }
    }
  }

  snapshot(): McpServerSnapshot[] {
    return [...this.connections.values()].map((c) => c.snapshot())
  }

  async add(input: McpAddInput): Promise<McpAddResult> {
    if (!this.owns) return { ok: false, error: McpManager.NOT_OWNER }
    const target = input.target?.trim()
    if (!target) return { ok: false, error: 'enter a command or URL' }
    const kind = detectTransport(target)
    if (kind === 'http') {
      try {
        void new URL(target)
      } catch {
        return { ok: false, error: 'that URL is not valid' }
      }
    } else if (parseCommandLine(target).length === 0) {
      return { ok: false, error: 'enter a command or URL' }
    }
    const name = input.name?.trim() || deriveDisplayName(target, kind)
    const existing = await getMcpConfig()
    const taken = new Set<string>([
      ...this.deps.takenCapabilityNames(),
      ...existing.servers.map((s) => s.slug)
    ])
    const slug = deconflictSlug(slugify(name), taken)
    const server: McpServerConfig = {
      id: crypto.randomUUID(),
      name,
      slug,
      transport: kind,
      command: kind === 'stdio' ? target : undefined,
      env:
        kind === 'stdio' && input.env && Object.keys(input.env).length > 0 ? input.env : undefined,
      url: kind === 'http' ? target : undefined,
      enabled: true
    }
    await addMcpServer(server)
    const connection = this.createConnection(server)
    this.connections.set(server.id, connection)
    // Kick the first connect and give it a short window to settle so the
    // UI's first paint is truthful (connected/needs-auth), but never
    // block an add on a slow server — it keeps connecting in background.
    await Promise.race([
      connection.test().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, ADD_SETTLE_CAP_MS))
    ])
    this.notifySoon()
    return { ok: true, server: connection.snapshot() }
  }

  async remove(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.owns) return { ok: false, error: McpManager.NOT_OWNER }
    // Capture the record BEFORE removeMcpServer wipes it — a remote server
    // signed in with OAuth gets its tokens revoked at the provider so it
    // doesn't leave a stale "connected" app there. Fire-and-forget: never
    // awaited, never blocks or fails the removal.
    const record = (await getMcpConfig()).servers.find((s) => s.id === id)
    const connection = this.connections.get(id)
    if (connection) {
      this.connections.delete(id)
      await connection.stop().catch(() => undefined)
    }
    await removeMcpServer(id)
    if (record?.transport === 'http' && record.url && record.oauth?.tokens) {
      void revokeTokens(record.url, record.oauth).catch(() => undefined)
    }
    this.notifySoon()
    return { ok: true }
  }

  async setEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
    if (!this.owns) return { ok: false, error: McpManager.NOT_OWNER }
    const connection = this.connections.get(id)
    if (!connection) return { ok: false, error: 'unknown connection' }
    await updateMcpServer(id, { enabled })
    connection.updateEnabled(enabled)
    await connection.setEnabled(enabled)
    this.notifySoon()
    return { ok: true }
  }

  async test(id: string): Promise<McpTestResult> {
    if (!this.owns) return { ok: false, error: McpManager.NOT_OWNER }
    const connection = this.connections.get(id)
    if (!connection) return { ok: false, error: 'unknown connection' }
    const result = await connection.test()
    this.notifySoon()
    return result
  }

  async authorize(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.owns) return { ok: false, error: McpManager.NOT_OWNER }
    const connection = this.connections.get(id)
    if (!connection) return { ok: false, error: 'unknown connection' }
    const result = await connection.authorize()
    this.notifySoon()
    return result
  }

  private createConnection(server: McpServerConfig): McpConnection {
    const id = server.id
    return new McpConnection({
      config: server,
      appVersion: this.deps.appVersion,
      register: this.deps.register,
      unregister: this.deps.unregister,
      notify: () => this.notifySoon(),
      openExternal: this.deps.openExternal,
      oauthPersistence: {
        load: async () => {
          const config = await getMcpConfig()
          return config.servers.find((s) => s.id === id)?.oauth
        },
        // patchMcpServerOauth no-ops when the record is gone, so a save
        // landing mid-connect can never resurrect a removed server.
        save: (patch) => patchMcpServerOauth(id, patch)
      },
      saveRedirectPort: async (port) => {
        await patchMcpServerOauth(id, { redirectPort: port })
      }
    })
  }

  /** Coalesce bursts of connection events into one renderer push. */
  private notifySoon(): void {
    if (this.notifyTimer) return
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      this.deps.onStatusChange(this.snapshot())
    }, 50)
    this.notifyTimer.unref?.()
  }
}
