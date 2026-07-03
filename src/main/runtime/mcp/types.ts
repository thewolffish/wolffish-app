/**
 * Shared MCP types. Pure — no Electron, no SDK imports — so tests can
 * import the whole conversion layer directly.
 *
 * This file is the main-process source of truth for the config shapes;
 * workspace.ts re-exports them. The preload (src/preload/index.ts)
 * re-declares them by convention so its bundle stays decoupled from
 * main — editing a field here means editing the preload mirror too.
 */

export type McpTransportKind = 'stdio' | 'http'

/**
 * OAuth state for a remote server that required the standard MCP auth
 * handshake. Persisted on the server's config record — same plaintext
 * config.json convention as every other credential in Wolffish.
 */
export type McpOauthState = {
  /** Dynamic client registration result (client_id, …). */
  clientInformation?: Record<string, unknown>
  /** Access/refresh tokens from the last successful authorization. */
  tokens?: Record<string, unknown>
  /**
   * Loopback callback port, allocated once and persisted so the
   * redirect_uri registered with the authorization server stays stable
   * across app restarts and token refreshes.
   */
  redirectPort?: number
}

export type McpServerConfig = {
  /** Stable random id — the IPC handle for this connection. */
  id: string
  /** Display name shown in settings. */
  name: string
  /**
   * Stable identifier chosen at add time; drives the capability name
   * (`mcp-<slug>`) and the tool-name prefix. Never changes after add.
   */
  slug: string
  transport: McpTransportKind
  /** stdio: the full command line, tokenized at spawn (no shell). */
  command?: string
  /** stdio: extra environment variables for the spawned server. */
  env?: Record<string, string>
  /** http: the remote server URL. */
  url?: string
  enabled: boolean
  oauth?: McpOauthState
}

export type McpConfig = {
  servers: McpServerConfig[]
}

/**
 * Public connection state shown in settings. Deliberately coarse — the
 * connection's internal machine distinguishes backoff/parked/idle, but
 * the user just sees "offline" with an optional muted detail line.
 */
export type McpServerState = 'connected' | 'connecting' | 'needs-auth' | 'offline' | 'disabled'

export type McpServerSnapshot = {
  id: string
  name: string
  slug: string
  transport: McpTransportKind
  /** The command line (stdio) or URL (http) — what the user typed. */
  target: string
  enabled: boolean
  state: McpServerState
  toolCount: number
  /** Namespaced tool names as the model sees them. */
  toolNames: string[]
  /** Name/version the server reported during initialize. */
  serverName?: string
  serverVersion?: string
  /** Last connection error, for a muted detail line — never a banner. */
  error?: string
  /**
   * Live connect-progress line ("[2/3] MCP handshake (initialize)"),
   * present only while state is `connecting`. Rendered in the card's
   * code block so a slow multi-step connect shows where it is.
   */
  progress?: string
  lastConnectedAt?: number
}

export type McpTestResult = {
  ok: boolean
  toolCount?: number
  durationMs?: number
  error?: string
}

export type McpAddInput = {
  /** Optional display name; derived from the target when empty. */
  name?: string
  /** Command line (stdio) or http(s) URL (remote). */
  target: string
  /** stdio env vars. */
  env?: Record<string, string>
}

export type McpAddResult = { ok: true; server: McpServerSnapshot } | { ok: false; error: string }
