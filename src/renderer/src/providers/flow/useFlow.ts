import { createContext, useContext, type Dispatch, type SetStateAction } from 'react'
import type {
  ApprovalDecision,
  ApprovalDescription,
  AskUserOption,
  DangerLevel,
  DataAnalytics,
  MessageAttachment,
  Segment,
  SegmentTurnEndReason,
  SystemInfo,
  WorkspaceStatus
} from '@preload/index'

export type Screen =
  | 'welcome'
  | 'low-disk-space'
  | 'ollama-setup'
  | 'model-picker'
  | 'chat'
  | 'settings'
  | 'viewer'
  | 'history'
  | 'changelog'
  | 'heartbeat'
  | 'procedures'
  | 'soul'
  | 'user'
  | 'agents'

export type ChatRole = 'user' | 'assistant'

export type TaskStepView = {
  tool: string
  args: Record<string, unknown>
  status: 'running' | 'succeeded' | 'failed' | 'stopped'
  output?: string
  error?: string
  attempt?: number
}

export type TaskCardState = {
  taskId: string
  description: string
  status: 'running' | 'succeeded' | 'failed' | 'stopped'
  steps: TaskStepView[]
  expanded?: boolean
}

export type ApprovalCardState = {
  approvalId: string
  toolCallId: string
  tool: string
  args: Record<string, unknown>
  reason: string
  level: DangerLevel
  description?: ApprovalDescription
  decision?: ApprovalDecision
}

/**
 * Live state for an ask-the-user question card, keyed by toolCallId on the
 * assistant message (like approvals). Carries the question/options the agent
 * posed plus the user's optimistic answer (`selectedIndex` / `customText`)
 * so the card reflects the choice the instant it's clicked, before the
 * tool_result lands. Not persisted — a resumed conversation rebuilds the
 * answered card from the tool_call args + tool_result segments instead.
 */
export type AskCardState = {
  askId: string
  toolCallId: string
  question: string
  details?: string
  options: AskUserOption[]
  allowOther: boolean
  otherLabel?: string
  otherDescription?: string
  selectedIndex?: number
  customText?: string
  answered?: boolean
}

export type AssistantStatus = 'streaming' | 'complete' | 'error'

export type UserMessage = {
  id: string
  kind?: 'message'
  role: 'user'
  content: string
  attachments?: MessageAttachment[]
  /** Set while a voice recording is being transcribed, so the bubble
   * can render an animated placeholder until the transcript arrives. */
  transcribing?: boolean
  timestamp?: number
}

export type ToolTiming = {
  startedAt: number
  endedAt?: number
}

export type AssistantMessage = {
  id: string
  kind?: 'message'
  role: 'assistant'
  segments: Segment[]
  /**
   * Per-tool-call approval state, keyed by toolCallId. Approvals sit on
   * the assistant message rather than as standalone chat entries so the
   * card can render inline next to its tool_call segment, preserving the
   * natural flow of the response instead of breaking it with a card
   * floating above or below the bubble.
   */
  approvals?: Record<string, ApprovalCardState>
  /**
   * Per-tool-call ask-the-user state, keyed by toolCallId. Mirrors
   * `approvals`: the question card renders inline next to its tool_call
   * segment while the agent loop is paused waiting for the user's answer.
   */
  asks?: Record<string, AskCardState>
  /**
   * Wall-clock timestamps captured when tool_call / tool_result segments
   * arrive in the renderer. Used purely to display elapsed time on the
   * tool card; not persisted to history.
   */
  toolTimings?: Record<string, ToolTiming>
  status: AssistantStatus
  stopReason?: SegmentTurnEndReason
  error?: string
  timestamp?: number
}

export type ChatMessage = UserMessage | AssistantMessage

export type FlowContextValue = {
  screen: Screen
  status: WorkspaceStatus | null
  messages: ChatMessage[]
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
  activeConversationId: string | null
  setActiveConversationId: Dispatch<SetStateAction<string | null>>
  /**
   * A saved procedure's prompt queued to run in a brand-new conversation. Set
   * by the Procedures page's Play button; Chat consumes it — resetting to a
   * fresh conversation and auto-sending the prompt — then clears it back to
   * null. Not persisted; it's a one-shot hand-off between pages.
   */
  pendingProcedure: string | null
  setPendingProcedure: Dispatch<SetStateAction<string | null>>
  /**
   * Navigate to a screen. Optional `returnTo` records where a follow-up
   * "Continue" should land — e.g. opening ollama-setup from Settings sets
   * returnTo='settings' so completing setup returns to Settings, not the
   * onboarding model picker. Pass `null` to clear.
   */
  goTo: (screen: Screen, returnTo?: Screen | null) => void
  /** Where the user should land after the current screen's primary action. */
  returnTo: Screen | null
  dataAnalytics: DataAnalytics | null
  systemInfo: SystemInfo | null
  refreshData: () => Promise<void>
  refreshStatus: () => Promise<void>
  clearModel: () => Promise<void>
  /**
   * Re-run the launch routing decision. Used by gating screens (e.g.
   * low-disk-space) so that once the blocking condition clears, the user
   * lands on whatever screen they would have started on.
   */
  revalidateScreen: () => Promise<void>
}

export const FlowContext = createContext<FlowContextValue | null>(null)

export function useFlow(): FlowContextValue {
  const ctx = useContext(FlowContext)
  if (!ctx) throw new Error('useFlow must be used within a FlowProvider')
  return ctx
}
