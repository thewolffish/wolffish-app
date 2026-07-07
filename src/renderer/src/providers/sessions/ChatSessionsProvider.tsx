import type { ConversationFile } from '@preload/index'
import type { ChatMessage, PendingProcedure } from '@providers/flow/useFlow'
import {
  ChatSessionsContext,
  type ChatSessionsValue,
  type ConversationRunStatus,
  type SessionDescriptor,
  type SessionInfo
} from '@providers/sessions/useSessions'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/**
 * Sessions kept mounted at most. Streaming sessions and the active one are
 * never evicted, so the cap can be exceeded while many turns run — it only
 * bounds how many finished, backgrounded feeds linger in memory.
 */
const MAX_SESSIONS = 6

let sessionCounter = 0
function nextKey(): string {
  sessionCounter += 1
  return `session_${sessionCounter}_${Date.now().toString(36)}`
}

export function ChatSessionsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionDescriptor[]>(() => [
    { key: nextKey(), initialConversationId: null, initialMessages: null, procedure: null }
  ])
  const [activeSessionKey, setActiveSessionKey] = useState(() => sessions[0].key)
  const [runStatuses, setRunStatuses] = useState<Record<string, ConversationRunStatus>>({})
  // Live info reported by each mounted Chat instance. State drives renders
  // (activeConversationId below); the ref mirror keeps reads synchronous
  // inside callbacks (eviction / open-routing decisions) without stale
  // closures.
  const [infos, setInfos] = useState<ReadonlyMap<string, SessionInfo>>(new Map())
  const infosRef = useRef(new Map<string, SessionInfo>())
  // conversationId → sessionKey, maintained imperatively so open-routing is
  // race-free (state closures lag; this map never does). Entries are removed
  // whenever their session is evicted or closed.
  const openConversationsRef = useRef(new Map<string, string>())
  // Sessions currently mid-send (Enter pressed, turn not yet streaming). Held
  // synchronously so eviction can spare them during the fresh-session
  // conversation.create() await.
  const sendingKeysRef = useRef(new Set<string>())

  const markSending = useCallback((key: string, sending: boolean) => {
    if (sending) sendingKeysRef.current.add(key)
    else sendingKeysRef.current.delete(key)
  }, [])

  const unregisterSessionKey = useCallback((key: string) => {
    infosRef.current.delete(key)
    sendingKeysRef.current.delete(key)
    for (const [cid, sessionKey] of openConversationsRef.current.entries()) {
      if (sessionKey === key) openConversationsRef.current.delete(cid)
    }
  }, [])

  // Turn lifecycle across ALL channels (in-app, WhatsApp, Telegram) — the
  // single source for the sidebar's status chips.
  useEffect(() => {
    return window.api.chat.onTurnState((ev) => {
      if (!ev.conversationId) return
      const phase: ConversationRunStatus['phase'] =
        ev.phase === 'started'
          ? 'processing'
          : ev.phase === 'done'
            ? 'completed'
            : ev.phase === 'canceled'
              ? 'stopped'
              : 'failed'
      setRunStatuses((prev) => ({
        ...prev,
        [ev.conversationId as string]: {
          phase,
          channel: ev.channel,
          title: ev.title ?? prev[ev.conversationId as string]?.title ?? null,
          at: Date.now()
        }
      }))
    })
  }, [])

  const reportSession = useCallback((key: string, info: SessionInfo) => {
    const prev = infosRef.current.get(key)
    if (
      prev &&
      prev.conversationId === info.conversationId &&
      prev.streaming === info.streaming &&
      prev.dirty === info.dirty
    ) {
      return
    }
    infosRef.current.set(key, info)
    if (info.conversationId) openConversationsRef.current.set(info.conversationId, key)
    setInfos(new Map(infosRef.current))
  }, [])

  const consumeProcedure = useCallback((key: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.key === key && s.procedure ? { ...s, procedure: null } : s))
    )
  }, [])

  /**
   * Drop finished background sessions beyond the cap. Never evicts the
   * active session, one with a live stream, or one holding unsent composer
   * state (draft/attachments/voice take) — that state is irreplaceable; a
   * finished clean session's transcript reloads from disk on demand.
   */
  const evictIfNeeded = useCallback(
    (list: SessionDescriptor[], activeKey: string): SessionDescriptor[] => {
      if (list.length <= MAX_SESSIONS) return list
      const out = [...list]
      for (let i = 0; i < out.length && out.length > MAX_SESSIONS; i++) {
        const s = out[i]
        if (s.key === activeKey) continue
        if (sendingKeysRef.current.has(s.key)) continue
        const info = infosRef.current.get(s.key)
        if (info?.streaming || info?.dirty) continue
        unregisterSessionKey(s.key)
        out.splice(i, 1)
        i -= 1
      }
      return out
    },
    [unregisterSessionKey]
  )

  const newSession = useCallback(
    (opts?: { procedure?: PendingProcedure }) => {
      const procedure = opts?.procedure ?? null
      if (!procedure) {
        // Reuse an existing empty idle session instead of stacking blanks —
        // clicking New Chat twice should land on the same fresh composer.
        const blank = sessions.find((s) => {
          const info = infosRef.current.get(s.key)
          return (
            s.initialConversationId === null &&
            s.procedure === null &&
            (!info || (info.conversationId === null && !info.streaming))
          )
        })
        if (blank) {
          setActiveSessionKey(blank.key)
          return
        }
      }
      const descriptor: SessionDescriptor = {
        key: nextKey(),
        initialConversationId: null,
        initialMessages: null,
        procedure
      }
      setSessions((prev) => evictIfNeeded([...prev, descriptor], descriptor.key))
      setActiveSessionKey(descriptor.key)
    },
    [sessions, evictIfNeeded]
  )

  const openConversation = useCallback(
    (conversation: ConversationFile, messages: ChatMessage[]) => {
      // A live session already holding this conversation wins — activating it
      // preserves its in-flight stream, meter and composer exactly as left.
      // The imperative registry (not the render-time `sessions` closure) is
      // the dedupe authority: two rapid opens of the same conversation both
      // await their load first, and the second's closure predates the
      // first's state commit — the registry doesn't.
      const existingKey = openConversationsRef.current.get(conversation.id)
      if (existingKey) {
        setActiveSessionKey(existingKey)
        return
      }
      for (const s of sessions) {
        const info = infosRef.current.get(s.key)
        const cid = info?.conversationId ?? s.initialConversationId
        if (cid === conversation.id) {
          openConversationsRef.current.set(conversation.id, s.key)
          setActiveSessionKey(s.key)
          return
        }
      }
      const descriptor: SessionDescriptor = {
        key: nextKey(),
        initialConversationId: conversation.id,
        initialMessages: messages,
        procedure: null
      }
      openConversationsRef.current.set(conversation.id, descriptor.key)
      setSessions((prev) => evictIfNeeded([...prev, descriptor], descriptor.key))
      setActiveSessionKey(descriptor.key)
    },
    [sessions, evictIfNeeded]
  )

  const activateSession = useCallback((key: string) => {
    setActiveSessionKey(key)
  }, [])

  const activateConversation = useCallback(
    (conversationId: string): boolean => {
      const existingKey = openConversationsRef.current.get(conversationId)
      if (existingKey) {
        setActiveSessionKey(existingKey)
        return true
      }
      // Fall back to a live-info scan (a session whose id was reported but
      // not yet mirrored into the ref, e.g. right after a fresh send).
      for (const s of sessions) {
        const info = infosRef.current.get(s.key)
        const cid = info?.conversationId ?? s.initialConversationId
        if (cid === conversationId) {
          openConversationsRef.current.set(conversationId, s.key)
          setActiveSessionKey(s.key)
          return true
        }
      }
      return false
    },
    [sessions]
  )

  const closeConversation = useCallback(
    (conversationId: string) => {
      // The conversation is gone — its run status must not haunt the sidebar
      // as a ghost row for the rest of the app session.
      setRunStatuses((prev) => {
        if (!(conversationId in prev)) return prev
        const next = { ...prev }
        delete next[conversationId]
        return next
      })
      const target = sessions.find((s) => {
        const info = infosRef.current.get(s.key)
        return (info?.conversationId ?? s.initialConversationId) === conversationId
      })
      if (!target) return
      unregisterSessionKey(target.key)
      setSessions((prev) => {
        const remaining = prev.filter((s) => s.key !== target.key)
        if (remaining.length === 0) {
          const blank: SessionDescriptor = {
            key: nextKey(),
            initialConversationId: null,
            initialMessages: null,
            procedure: null
          }
          setActiveSessionKey(blank.key)
          return [blank]
        }
        setActiveSessionKey((active) =>
          active === target.key ? remaining[remaining.length - 1].key : active
        )
        return remaining
      })
    },
    [sessions, unregisterSessionKey]
  )

  // A conversation deleted anywhere — in-app History (already handled locally)
  // OR a channel /delete (which never touches the renderer) — must drop its
  // lingering run-status so the sidebar doesn't synthesize a ghost row.
  useEffect(() => {
    return window.api.conversation.onDeleted(({ id }) => closeConversation(id))
  }, [closeConversation])

  const activeConversationId =
    infos.get(activeSessionKey)?.conversationId ??
    sessions.find((s) => s.key === activeSessionKey)?.initialConversationId ??
    null

  const value = useMemo<ChatSessionsValue>(
    () => ({
      sessions,
      activeSessionKey,
      activeConversationId,
      runStatuses,
      newSession,
      openConversation,
      activateSession,
      activateConversation,
      reportSession,
      markSending,
      consumeProcedure,
      closeConversation
    }),
    [
      sessions,
      activeSessionKey,
      activeConversationId,
      runStatuses,
      newSession,
      openConversation,
      activateSession,
      activateConversation,
      reportSession,
      markSending,
      consumeProcedure,
      closeConversation
    ]
  )

  return <ChatSessionsContext.Provider value={value}>{children}</ChatSessionsContext.Provider>
}
