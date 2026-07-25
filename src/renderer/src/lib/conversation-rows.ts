import type { ConversationChannel, ConversationMeta, Project } from '@preload/index'
import type { ConversationRunPhase, ConversationRunStatus } from '@providers/sessions/useSessions'

/**
 * ONE definition of "which conversations to list, and what state each is in",
 * shared by every surface that lists them — the right-hand rail, the History
 * page, a project's conversations dialog. Written once so a conversation reads
 * IDENTICALLY wherever it was started from: in-app, WhatsApp, Telegram, a
 * heartbeat automation, a played procedure. The numbered chip's phase colors
 * (primary pulse while processing, then the terminal success/danger/warning
 * tint) come from the cross-channel chat:turnState broadcast, so they only
 * ever depend on a run existing — never on which channel owns it.
 */
export type ConversationRow = {
  conversationId: string
  title: string
  phase: ConversationRunPhase | null
  /** Origin — drives the small badge on the number chip. */
  channel: ConversationChannel | string | null
  /**
   * Source emoji for the number-chip badge: the conversation's project icon
   * (resolved live) or its stamped automation/procedure icon. Null falls back
   * to the channel-glyph badge.
   */
  icon: string | null
  projectId: string | null
  /** Recency key — live phase changes beat file mtimes. */
  at: number
  /** Best-known last activity, for "x minutes ago" stamps. */
  updatedAt: number
  /**
   * False while the conversation is known ONLY from its live run status — it
   * has no row in the conversation index yet, so anything that acts on the
   * stored file (delete, diagnostic export) has nothing to act on.
   */
  indexed: boolean
}

/**
 * Merge the indexed conversation list with this app session's live run
 * statuses into the rows a list surface renders.
 *
 * The second half — synthesizing a row for a status with no indexed
 * conversation — is what makes a BRAND-NEW conversation appear, pulsing, the
 * moment its first turn starts. Every origin needs it, for its own reason: an
 * in-app chat has no file at all until the end-of-turn save, and a channel
 * chat writes an 'Untitled' shell that still reaches the cortex a beat behind
 * the turn. Without it the row only shows up once the work is over.
 *
 * ALL phases are synthesized, not just 'processing': gating on processing made
 * a conversation VANISH the instant it completed — its phase flipped
 * synchronously while the list refetch was still in flight, so it fell out of
 * both sources for a render and the whole list reflowed. Once the index has
 * it, the indexed row wins, so a synthesized row is only ever a brief bridge.
 */
export function buildConversationRows({
  metas,
  runStatuses,
  projects,
  untitled
}: {
  metas: readonly ConversationMeta[]
  runStatuses: Record<string, ConversationRunStatus>
  /** Optional — resolves a bound conversation's badge emoji from its project. */
  projects?: readonly Project[]
  /** Localized label for a conversation whose title hasn't resolved yet. */
  untitled: string
}): ConversationRow[] {
  const projectIcons = new Map((projects ?? []).map((p) => [p.id, p.icon]))
  const byId = new Map<string, ConversationRow>()

  for (const meta of metas) {
    const live = runStatuses[meta.id]
    // A just-created conversation reaches the index BEFORE its LLM title
    // resolves (the shell persists as 'Untitled'; the titled write re-indexes
    // 1–4s later). While the indexed title is still the sentinel, prefer the
    // live-status title when one exists — the row only ever transitions
    // Untitled → real, never regresses.
    const indexedTitle = meta.title && meta.title !== 'Untitled' ? meta.title : null
    byId.set(meta.id, {
      conversationId: meta.id,
      title: indexedTitle ?? live?.title ?? untitled,
      phase: live?.phase ?? null,
      channel: meta.channel ?? live?.channel ?? null,
      // Project emoji wins (a project conversation reads as its project);
      // otherwise the stamped automation/procedure emoji.
      icon: (meta.projectId ? projectIcons.get(meta.projectId) : undefined) ?? meta.icon ?? null,
      projectId: meta.projectId ?? null,
      at: Math.max(meta.updatedAt, live?.at ?? 0),
      updatedAt: meta.updatedAt,
      indexed: true
    })
  }

  for (const [id, s] of Object.entries(runStatuses)) {
    if (byId.has(id)) continue
    byId.set(id, {
      conversationId: id,
      title: s.title ?? untitled,
      phase: s.phase,
      channel: s.channel ?? null,
      icon: null,
      projectId: null,
      at: s.at,
      // Nothing on disk to date it — the run's own clock IS its recency.
      updatedAt: s.at,
      indexed: false
    })
  }

  return [...byId.values()].sort((a, b) => b.at - a.at)
}

/**
 * A stable key over the live phases, for effects that must refetch the
 * conversation list whenever a turn starts or ends ANYWHERE — that transition
 * is exactly when a new conversation can appear, on any channel.
 */
export function runPhaseKey(runStatuses: Record<string, ConversationRunStatus>): string {
  return Object.entries(runStatuses)
    .map(([id, s]) => `${id}:${s.phase}`)
    .join('|')
}
