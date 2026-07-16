import { ChannelIcon } from '@components/common/channel-icon/ChannelIcon'
import { hasChannelIcon } from '@components/common/channel-icon/hasChannelIcon'
import { CONVERSATION_CHIP_BASE, conversationChipClasses } from '@lib/conversation-chip'
import { mapConversationMessages, warmPathCards } from '@lib/conversation-open'
import { RTL_LOCALES } from '@lib/i18n'
import { cn } from '@lib/utils/cn'
import { pageTopPadding } from '@lib/utils/platform'
import type { ConversationChannel, ConversationMeta } from '@preload/index'
import { useFlow } from '@providers/flow/useFlow'
import { useLocale } from '@providers/locale/useLocale'
import { useSessions, type ConversationRunPhase } from '@providers/sessions/useSessions'
import { SidebarRightIcon } from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Row = {
  conversationId: string
  title: string
  phase: ConversationRunPhase | null
  /** Origin — drives the small badge on the number chip. */
  channel: ConversationChannel | string | null
  /** Recency key — live phase changes beat file mtimes. */
  at: number
}

// Mirrors the left Sidebar's module-scoped collapse cache: the toggle is the
// source of truth across remounts, independent of the status IPC's timing.
let liveRightCollapsed: boolean | null = null

/**
 * Right-anchored conversations rail — ALL conversations, live across every
 * channel (statuses come from the main process's chat:turnState broadcast, so
 * in-app / WhatsApp / Telegram runs all pulse their chips while processing).
 * Mirrors the left Sidebar's chrome (fixed overlay, width-animated collapse,
 * persisted state) but anchored right so it grows leftward. Collapsed shows
 * the numbered status chips only.
 */
export function ConversationsSidebar(): React.JSX.Element {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const isRtl = RTL_LOCALES.has(locale)
  const { status } = useFlow()
  const { runStatuses, openConversation, activateConversation, activeConversationId } =
    useSessions()
  const [metas, setMetas] = useState<ConversationMeta[]>([])

  const saved = status?.config?.lastSettingsState?.rightSidebarCollapsed
  const [collapsed, setCollapsed] = useState(() => {
    // Default to collapsed unless the user explicitly persisted it expanded.
    if (liveRightCollapsed === null) liveRightCollapsed = saved !== 'false'
    return liveRightCollapsed
  })
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      liveRightCollapsed = next
      void window.api.runtime.setLastSettingsState({ rightSidebarCollapsed: String(next) })
      return next
    })
  }, [])

  // Refresh the list on mount and whenever any turn starts/ends anywhere — a
  // turn starting is exactly when a new conversation can appear, and the
  // cortex-backed list call is ~1ms.
  const statusKey = useMemo(
    () =>
      Object.entries(runStatuses)
        .map(([id, s]) => `${id}:${s.phase}`)
        .join('|'),
    [runStatuses]
  )
  useEffect(() => {
    let cancelled = false
    void window.api.conversation.list().then((list) => {
      if (!cancelled) setMetas(list)
    })
    return () => {
      cancelled = true
    }
  }, [statusKey])

  // A conversation can change with NO turn lifecycle event — autonomous
  // heartbeat/procedure runs, a create-without-turn, the sensitive-data gate —
  // none of which touch runStatuses/statusKey, so the effect above never fires
  // for them. The main process pushes conversation:changed after the cortex row
  // is (re)indexed/removed, so re-listing here is always fresh. Debounced to
  // coalesce the write bursts of an active turn into a single refetch.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.api.conversation.onChanged(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void window.api.conversation.list().then(setMetas), 250)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [])

  const rows = useMemo<Row[]>(() => {
    const byId = new Map<string, Row>()
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
        title: indexedTitle ?? live?.title ?? t('chat.conversationsUntitled'),
        phase: live?.phase ?? null,
        channel: meta.channel ?? live?.channel ?? null,
        at: Math.max(meta.updatedAt, live?.at ?? 0)
      })
    }
    // A conversation not yet in the cortex-backed list (an in-app chat is
    // indexed a beat after it persists) is surfaced from its lifecycle status.
    // ALL phases, not just 'processing': gating on processing made a
    // conversation VANISH the instant it completed — its phase flipped to
    // 'completed' synchronously while the metas re-fetch was still in flight,
    // so it fell out of both metas AND this loop for a render, and the whole
    // list reflowed (the "jump on completion"). Synthesizing terminal phases
    // too keeps it pinned through the catch-up; once metas has it, `byId.has`
    // skips this branch, so the synthesized row is only ever a brief bridge —
    // never a lingering ghost for a real conversation.
    for (const [id, s] of Object.entries(runStatuses)) {
      if (byId.has(id)) continue
      byId.set(id, {
        conversationId: id,
        title: s.title ?? t('chat.conversationsUntitled'),
        phase: s.phase,
        channel: s.channel ?? null,
        at: s.at
      })
    }
    return [...byId.values()].sort((a, b) => b.at - a.at)
  }, [metas, runStatuses, t])

  const open = useCallback(
    async (conversationId: string) => {
      // A still-processing in-app conversation has no file on disk yet, so
      // activate its live session directly — a load-first path would return
      // null and dead-end. Only fall to disk when no live session holds it.
      if (activateConversation(conversationId)) return
      const conv = await window.api.conversation.load(conversationId)
      if (!conv) return
      const mapped = mapConversationMessages(conv)
      await warmPathCards(mapped)
      openConversation(conv, mapped)
    },
    [activateConversation, openConversation]
  )

  return (
    <aside
      style={{ bottom: 'var(--wf-actionbar-h, 5.5rem)' }}
      className={cn(
        'pointer-events-none border-s-border/40 fixed top-0 z-30 flex flex-col items-center gap-1.5 overflow-x-hidden overflow-y-auto border-s px-2 pb-2',
        // The rail ends at the TOP of the action bar (its height is published
        // as --wf-actionbar-h by the visible Chat) rather than running
        // full-height behind it. The inner border rides on the aside itself so
        // it always spans the full height regardless of scroll position. No
        // width transition — matching the left rail — so the collapsed content
        // doesn't jump mid-animation.
        pageTopPadding,
        // Anchor to the trailing edge so the rail grows inward (leftward in
        // LTR, rightward in RTL). EXACTLY the left nav rail's widths (both
        // w-14 collapsed / w-44 expanded) so the two rails are mirror-
        // symmetric — w-14 gives a 3-digit number chip room without clipping.
        isRtl ? 'left-0' : 'right-0',
        collapsed ? 'w-14' : 'w-44'
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={t('chat.conversations')}
        className={cn(
          'pointer-events-auto text-muted hover:text-fg mt-3 flex shrink-0 cursor-pointer items-center rounded-lg p-2',
          'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          // Collapsed: center the icon over the centered number chips.
          // Expanded: sit at the trailing edge (mirror of the left rail).
          collapsed ? 'self-center' : 'self-end'
        )}
      >
        <SidebarRightIcon size={16} />
      </button>
      {!collapsed && (
        <div className="pointer-events-none flex w-full items-center px-1.5 pt-1">
          <span className="text-muted text-[11px] font-medium tracking-wide uppercase">
            {t('chat.conversations')}
          </span>
        </div>
      )}
      {rows.length === 0 ? (
        !collapsed && <p className="text-muted px-2 pt-2 text-xs">{t('history.empty')}</p>
      ) : (
        <nav className="pointer-events-auto flex w-full flex-col gap-0.5">
          {rows.map((row, index) => {
            const isActive = row.conversationId === activeConversationId
            return (
              <button
                key={row.conversationId}
                type="button"
                onClick={() => void open(row.conversationId)}
                title={row.title}
                aria-label={row.title}
                className={cn(
                  // `group` lets the chip react to hovering anywhere on the row.
                  'group flex w-full cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-start text-muted',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  // Expanded rows carry the same card affordance as the
                  // Conversations page: the active/selected row gets a surface
                  // fill + border, hover previews the fill. The border is
                  // emitted as one ternary (never `border-transparent` and
                  // `border-border` at once) because `cn` is a plain join, not
                  // tailwind-merge — two border-color utilities would resolve by
                  // CSS source order. Both states keep the 1px border reserved
                  // so switching the selection never reflows the rail. Collapsed
                  // stays chip-only (the chip tint is the sole affordance).
                  !collapsed &&
                    (isActive
                      ? 'bg-surface border border-border'
                      : 'border border-transparent hover:bg-surface'),
                  collapsed && 'justify-center px-1'
                )}
              >
                <span className="relative inline-flex shrink-0">
                  <span
                    aria-hidden
                    className={cn(
                      CONVERSATION_CHIP_BASE,
                      conversationChipClasses(row.phase, isActive)
                    )}
                  >
                    {index + 1}
                  </span>
                  {/* Origin badge: where this conversation came from (channel /
                      automation / procedure), floated off the chip's bottom-end
                      corner so it clears the number. Both offsets are negative
                      — it sits OUTSIDE the chip — and the horizontal one is
                      direction-logical, so it hangs to the right in LTR and
                      mirrors to the left in RTL. It overhangs into the row's own
                      padding and the gap before the title, never the next row.
                      bg-bg punches through the row's hover fill so the glyph
                      stays readable. */}
                  {hasChannelIcon(row.channel) && (
                    <span className="border-border bg-bg absolute -inset-e-1 -bottom-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border">
                      <ChannelIcon channel={row.channel} size={9} className="text-muted" />
                    </span>
                  )}
                </span>
                {!collapsed && (
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate whitespace-nowrap text-xs group-hover:text-fg',
                      isActive && 'text-fg'
                    )}
                  >
                    {row.title}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      )}
    </aside>
  )
}
