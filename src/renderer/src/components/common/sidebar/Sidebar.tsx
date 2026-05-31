import { RTL_LOCALES } from '@lib/i18n'
import { cn } from '@lib/utils/cn'
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

export function Sidebar({ items, className }: SidebarProps): React.JSX.Element {
  const { locale } = useLocale()
  const isRtl = RTL_LOCALES.has(locale)
  const { status } = useFlow()
  const saved = status?.config?.lastSettingsState?.sidebarCollapsed
  const [collapsed, setCollapsed] = useState(() => saved !== 'false')

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      void window.api.runtime.setLastSettingsState({ sidebarCollapsed: String(next) })
      return next
    })
  }, [])

  return (
    <aside
      className={cn(
        'pointer-events-none fixed top-0 z-30 flex h-full flex-col items-center overflow-x-hidden overflow-y-auto pt-8 transition-[width] duration-200',
        isRtl ? 'right-0' : 'left-0',
        collapsed ? 'w-12 gap-1 px-1.5' : 'w-44 gap-1.5 px-3',
        className
      )}
    >
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-0 bottom-18 w-px bg-border/40',
          isRtl ? 'inset-s-0' : 'inset-e-0'
        )}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label="Toggle sidebar"
        className={cn(
          'pointer-events-auto text-muted hover:text-fg flex shrink-0 cursor-pointer items-center rounded-lg p-2',
          'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          !collapsed && 'self-start'
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
                  'text-muted hover:text-fg flex w-full cursor-pointer items-center rounded-lg text-sm',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted',
                  collapsed ? 'justify-center p-2' : 'gap-2.5 px-2.5 py-2'
                )}
              >
                <Icon size={16} />
                {!collapsed && <span>{item.label}</span>}
              </button>
            )
          })}
        </nav>
      )}
    </aside>
  )
}
