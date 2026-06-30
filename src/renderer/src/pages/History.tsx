import { Button } from '@components/core/Button'
import { Modal } from '@components/core/Modal'
import { conversationPathCandidates } from '@components/common/path-card/extractPaths'
import { statPathOnce } from '@components/common/path-card/pathStat'
import { TelegramLogo, WhatsAppLogo } from '@components/core/ProviderLogos'
import { RTL_LOCALES } from '@lib/i18n'
import { cn } from '@lib/utils/cn'
import { pageTopPadding } from '@lib/utils/platform'
import type { ConversationMeta, PersistedApproval } from '@preload/index'
import { useFlow, type ApprovalCardState, type AssistantStatus } from '@providers/flow/useFlow'
import { useLocale } from '@providers/locale/useLocale'
import {
  Activity04Icon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  BubbleChatIcon,
  Delete01Icon
} from 'hugeicons-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Varied title-bar widths so the loading skeleton looks like real conversation rows.
const skeletonTitleWidths = [62, 45, 78, 38, 55, 70, 48, 84, 41, 66]

export function History(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const isRtl = RTL_LOCALES.has(locale)
  const BackIcon = isRtl ? ArrowRight02Icon : ArrowLeft02Icon
  const { goTo, setMessages, setActiveConversationId, activeConversationId } = useFlow()

  const [conversations, setConversations] = useState<ConversationMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<ConversationMeta | null>(null)

  const refresh = useCallback(async () => {
    const list = await window.api.conversation.list()
    setConversations(list)
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.conversation.list().then((list) => {
      if (cancelled) return
      setConversations(list)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleResume = useCallback(
    async (id: string) => {
      const conv = await window.api.conversation.load(id)
      if (!conv) return
      const mapped = conv.messages.map((m) => {
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

      // Pre-warm the path-existence cache so the open-file/folder cards paint
      // their final state on the first frame instead of popping in one-by-one
      // as each PathCard's stat resolves. Bounded so a slow stat can't delay
      // the open; whatever isn't warm in time just falls back to its own stat.
      await Promise.race([
        Promise.allSettled(conversationPathCandidates(mapped).map((p) => statPathOnce(p))),
        new Promise((resolve) => setTimeout(resolve, 200))
      ])
      setMessages(mapped)
      setActiveConversationId(id)
      goTo('chat')
    },
    [goTo, setMessages, setActiveConversationId]
  )

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    await window.api.conversation.delete(deleteTarget.id)
    if (activeConversationId === deleteTarget.id) {
      setActiveConversationId(null)
      setMessages([])
    }
    setDeleteTarget(null)
    void refresh()
  }, [deleteTarget, activeConversationId, setActiveConversationId, setMessages, refresh])

  const handleNewChat = useCallback(() => {
    setMessages([])
    setActiveConversationId(null)
    goTo('chat')
  }, [goTo, setMessages, setActiveConversationId])

  return (
    <main className={cn('bg-bg flex h-full w-full flex-col', pageTopPadding)}>
      <div className="flex items-center gap-3 px-6 pb-4 pt-3">
        <button
          type="button"
          onClick={() => goTo('chat')}
          aria-label={t('common.back')}
          className={cn(
            'text-muted hover:text-fg flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-2 text-sm',
            'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
          )}
        >
          <BackIcon size={16} />
          <span>{t('common.back')}</span>
        </button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={handleNewChat}>
          {t('history.newChat')}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <div className="mx-auto flex h-full max-w-2xl flex-col">
          {loading && (
            <div className="flex flex-col gap-1">
              {Array.from({ length: 20 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-xl px-4 py-3"
                  aria-hidden="true"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex h-5 items-center">
                      <div
                        className="bg-border/60 h-3.5 animate-pulse rounded"
                        style={{ width: `${skeletonTitleWidths[i % skeletonTitleWidths.length]}%` }}
                      />
                    </div>
                    <div className="flex h-4 items-center">
                      <div className="bg-border/60 h-3 w-20 animate-pulse rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && conversations.length === 0 && (
            <div className="text-muted flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <BubbleChatIcon size={40} className="opacity-40" />
              <p className="text-sm">{t('history.empty')}</p>
            </div>
          )}
          {!loading && conversations.length > 0 && (
            <div className="flex flex-col gap-1">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    'group flex items-center gap-3 rounded-xl px-4 py-3',
                    'hover:bg-surface cursor-pointer',
                    activeConversationId === conv.id && 'bg-surface border-border border'
                  )}
                  onClick={() => handleResume(conv.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleResume(conv.id)
                  }}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="text-fg truncate text-sm font-medium">{conv.title}</span>
                      {conv.channel === 'heartbeat' && (
                        <Activity04Icon
                          size={12}
                          className="text-muted shrink-0"
                          aria-label="Heartbeat"
                        />
                      )}
                      {conv.channel === 'telegram' && (
                        <TelegramLogo
                          size={12}
                          className="text-muted shrink-0"
                          aria-label="Telegram"
                        />
                      )}
                      {conv.channel === 'whatsapp' && (
                        <WhatsAppLogo
                          size={12}
                          className="text-muted shrink-0"
                          aria-label="WhatsApp"
                        />
                      )}
                    </div>
                    <span className="text-muted text-xs">
                      {relativeTime(conv.updatedAt, locale)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteTarget(conv)
                    }}
                    aria-label={t('history.delete')}
                    className={cn(
                      'text-muted cursor-pointer rounded-lg p-1.5 opacity-0',
                      'hover:text-red-600 dark:hover:text-red-400',
                      'group-hover:opacity-100',
                      'focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent'
                    )}
                  >
                    <Delete01Icon size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('history.deleteTitle')}
        footer={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
              {t('history.deleteCancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              {t('history.deleteConfirm')}
            </Button>
          </div>
        }
      >
        <p className="text-muted">{t('history.deleteWarning')}</p>
      </Modal>
    </main>
  )
}

function relativeTime(timestamp: number, locale: string): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    if (days > 0) return rtf.format(-days, 'day')
    if (hours > 0) return rtf.format(-hours, 'hour')
    if (minutes > 0) return rtf.format(-minutes, 'minute')
    return rtf.format(-seconds, 'second')
  } catch {
    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    return 'just now'
  }
}
