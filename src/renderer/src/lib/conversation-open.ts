import { conversationPathCandidates } from '@components/common/path-card/extractPaths'
import { statPathOnce } from '@components/common/path-card/pathStat'
import type { ConversationFile, PersistedApproval } from '@preload/index'
import type { ApprovalCardState, AssistantStatus, ChatMessage } from '@providers/flow/useFlow'

/**
 * Map a persisted conversation's messages into feed messages — the shape a
 * Chat session renders. Shared by every open-conversation entry point
 * (History rows, the sidebar's Conversations list) so they can't drift.
 */
export function mapConversationMessages(conv: ConversationFile): ChatMessage[] {
  return conv.messages.map((m) => {
    const msgId = `m_${m.timestamp}_${Math.random().toString(36).slice(2, 6)}`
    if (m.role === 'user') {
      return {
        id: msgId,
        role: 'user' as const,
        content: m.content,
        timestamp: m.timestamp,
        ...(m.attachments && m.attachments.length > 0 ? { attachments: m.attachments } : {})
      }
    }
    const segments = m.segments ?? [
      {
        kind: 'text' as const,
        delta: m.content,
        turnId: '',
        segmentId: `seg_${m.timestamp}`
      }
    ]
    const approvals = m.approvals
      ? (Object.fromEntries(
          Object.entries(m.approvals).map(([k, v]: [string, PersistedApproval]) => [
            k,
            v as ApprovalCardState
          ])
        ) as Record<string, ApprovalCardState>)
      : undefined
    const isError = !!m.error
    return {
      id: msgId,
      role: 'assistant' as const,
      segments,
      approvals,
      toolTimings: m.toolTimings,
      status: (isError ? 'error' : 'complete') as AssistantStatus,
      stopReason: m.stopReason,
      ...(isError ? { error: m.error } : {}),
      timestamp: m.timestamp
    }
  })
}

/**
 * Pre-warm the path-existence cache so the open-file/folder cards paint
 * their final state on the first frame instead of popping in one-by-one as
 * each PathCard's stat resolves. Bounded so a slow stat can't delay the
 * open; whatever isn't warm in time falls back to its own stat.
 */
export async function warmPathCards(mapped: ChatMessage[]): Promise<void> {
  await Promise.race([
    Promise.allSettled(conversationPathCandidates(mapped).map((p) => statPathOnce(p))),
    new Promise((resolve) => setTimeout(resolve, 200))
  ])
}
