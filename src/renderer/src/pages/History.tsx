import { Button } from '@components/core/Button'
import { Modal } from '@components/core/Modal'
import { TelegramLogo, WhatsAppLogo } from '@components/core/ProviderLogos'
import { CONVERSATION_CHIP_BASE, conversationChipClasses } from '@lib/conversation-chip'
import { RTL_LOCALES } from '@lib/i18n'
import { mapConversationMessages, warmPathCards } from '@lib/conversation-open'
import { cn } from '@lib/utils/cn'
import { pageTopPadding } from '@lib/utils/platform'
import type { ConversationMeta } from '@preload/index'
import { useFlow } from '@providers/flow/useFlow'
import { useSessions } from '@providers/sessions/useSessions'
import { useLocale } from '@providers/locale/useLocale'
import {
  Activity04Icon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  BubbleChatIcon,
  Delete01Icon,
  PlayIcon
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
  const { goTo } = useFlow()
  const {
    openConversation,
    activateConversation,
    newSession,
    activeConversationId,
    runStatuses,
    closeConversation
  } = useSessions()

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
      // A still-processing in-app conversation has no file on disk yet, so
      // activate its live session directly — a load-first path would return
      // null and dead-end. Only fall to disk when no live session holds it.
      if (activateConversation(id)) {
        goTo('chat')
        return
      }
      const conv = await window.api.conversation.load(id)
      if (!conv) return
      const mapped = mapConversationMessages(conv)
      await warmPathCards(mapped)
      openConversation(conv, mapped)
      goTo('chat')
    },
    [goTo, openConversation, activateConversation]
  )

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    // Main refuses while the conversation has a turn in flight (ok:false) —
    // the row's disabled state should prevent it, this is the backstop.
    const result = await window.api.conversation.delete(deleteTarget.id)
    if (result.ok) closeConversation(deleteTarget.id)
    setDeleteTarget(null)
    void refresh()
  }, [deleteTarget, closeConversation, refresh])

  const handleNewChat = useCallback(() => {
    newSession()
    goTo('chat')
  }, [goTo, newSession])

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
        <div className="mx-auto flex h-full max-w-5xl flex-col">
          {loading && (
            <div className="grid grid-cols-1 gap-x-3 gap-y-1 md:grid-cols-2">
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
            <div className="grid grid-cols-1 gap-x-3 gap-y-1 md:grid-cols-2">
              {conversations.map((conv, index) => {
                const isActive = activeConversationId === conv.id
                const phase = runStatuses[conv.id]?.phase ?? null
                const processing = phase === 'processing'
                return (
                  <div
                    key={conv.id}
                    className={cn(
                      'group flex items-center gap-3 rounded-xl px-4 py-3',
                      'hover:bg-surface cursor-pointer',
                      isActive && 'bg-surface border-border border'
                    )}
                    onClick={() => handleResume(conv.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleResume(conv.id)
                    }}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        CONVERSATION_CHIP_BASE,
                        conversationChipClasses(phase, isActive)
                      )}
                    >
                      {index + 1}
                    </span>
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
                        {conv.channel === 'procedure' && (
                          <PlayIcon
                            size={12}
                            className="text-muted shrink-0"
                            aria-label="Procedure"
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
                        if (!processing) setDeleteTarget(conv)
                      }}
                      disabled={processing}
                      aria-label={t('history.delete')}
                      title={processing ? t('history.processing') : undefined}
                      className={cn(
                        'text-muted rounded-lg p-1.5 opacity-0',
                        'group-hover:opacity-100',
                        processing
                          ? 'cursor-not-allowed opacity-40'
                          : 'cursor-pointer hover:text-red-600 dark:hover:text-red-400',
                        'focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent'
                      )}
                    >
                      <Delete01Icon size={14} />
                    </button>
                  </div>
                )
              })}
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
