import { RTL_LOCALES } from '@lib/i18n'
import { cn } from '@lib/utils/cn'
import { pageTopPadding } from '@lib/utils/platform'
import { useFlow } from '@providers/flow/useFlow'
import { useLocale } from '@providers/locale/useLocale'
import { SidebarLeftIcon } from 'hugeicons-react'
import { useCallback, useState, type ComponentType } from 'react'

export type SidebarItem = {
  key: string
  icon: ComponentType<{ size?: number }>
  label: string
  onClick: () => void
  disabled?: boolean
}

type SidebarProps = {
  items: SidebarItem[]
  className?: string
}

// Collapsed state is persisted to the workspace config via setLastSettingsState,
// but FlowProvider's in-memory `status` snapshot is NOT refreshed on that write —
// it only updates on unrelated refreshStatus() calls. Navigating Chat → Settings
// fully unmounts <Chat> (and this <Sidebar>); on return it remounts and, if it
// re-derived `collapsed` from `status`, would read a stale value and visibly
// revert the user's last toggle. Whether it reverted depended on whether some
// other refreshStatus() happened to land in between — the intermittent race.
//
// Keep the live value in a module-scoped cache so the toggle is the source of
// truth across remounts, independent of IPC timing. `status` only seeds it once
// (first mount of the app session / after a restart, when the persisted value is
// authoritative); the backend write then only matters for the next launch.
let liveCollapsed: boolean | null = null

export function Sidebar({ items, className }: SidebarProps): React.JSX.Element {
  const { locale } = useLocale()
  const isRtl = RTL_LOCALES.has(locale)
  const { status } = useFlow()
  const saved = status?.config?.lastSettingsState?.sidebarCollapsed
  const [collapsed, setCollapsed] = useState(() => {
    // Default to open (expanded) unless explicitly persisted as collapsed.
    if (liveCollapsed === null) liveCollapsed = saved === 'true'
    return liveCollapsed
  })

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      liveCollapsed = next
      void window.api.runtime.setLastSettingsState({ sidebarCollapsed: String(next) })
      return next
    })
  }, [])

  return (
    <aside
      className={cn(
        'pointer-events-none fixed top-0 z-30 flex h-full flex-col items-center gap-1.5 overflow-x-hidden overflow-y-auto px-2 transition-[width] duration-200',
        pageTopPadding,
        isRtl ? 'right-0' : 'left-0',
        collapsed ? 'w-12' : 'w-44',
        className
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-e-0 top-0 bottom-18 w-px bg-border/40"
      />
      <button
        type="button"
        onClick={toggle}
        aria-label="Toggle sidebar"
        className={cn(
          'pointer-events-auto text-muted hover:text-fg mt-3 flex shrink-0 cursor-pointer items-center self-start rounded-lg p-2',
          'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
        )}
      >
        <SidebarLeftIcon size={16} />
      </button>
      {items.length > 0 && (
        <nav className="pointer-events-auto flex w-full flex-col gap-1">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                disabled={item.disabled}
                aria-label={item.label}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'text-muted hover:text-fg flex w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-lg px-2 py-2 text-sm',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted'
                )}
              >
                <span className="flex shrink-0 items-center">
                  <Icon size={16} />
                </span>
                <span className="shrink-0 whitespace-nowrap">{item.label}</span>
              </button>
            )
          })}
        </nav>
      )}
    </aside>
  )
}
