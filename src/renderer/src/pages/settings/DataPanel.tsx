import { Button } from '@components/core/Button'
import { DiskUsageBar } from '@components/common/disk-usage-bar/DiskUsageBar'
import { Input } from '@components/core/Input'
import { Modal } from '@components/core/Modal'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn'
import { formatBytes } from '@lib/utils/format'
import type { DataAnalytics, SystemInfo } from '@preload/index'
import {
  AiBrain01Icon,
  CpuIcon,
  Database02Icon,
  HardDriveIcon,
  RamMemoryIcon,
  Pulse01Icon,
  Refresh01Icon,
  WasteIcon
} from 'hugeicons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type IconComp = React.ComponentType<{ size?: number; className?: string }>

export function DataPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()
  const [analytics, setAnalytics] = useState<DataAnalytics | null>(null)
  const [system, setSystem] = useState<SystemInfo | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      const [data, sys] = await Promise.all([
        window.api.data.getAnalytics(),
        window.api.system.getInfo()
      ])
      setAnalytics(data)
      setSystem(sys)
      toast.show({ tone: 'success', message: t('settings.data.refreshSuccessToast') })
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    let stale = false
    void Promise.all([window.api.data.getAnalytics(), window.api.system.getInfo()]).then(
      ([data, sys]) => {
        if (stale) return
        setAnalytics(data)
        setSystem(sys)
      }
    )
    return () => {
      stale = true
    }
  }, [])

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-fg text-2xl font-semibold tracking-tight">
              {t('settings.data.title')}
            </h1>
            <p className="text-muted text-sm leading-relaxed">{t('settings.data.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label={t('settings.data.refresh')}
            className={cn(
              'text-muted hover:text-fg mt-1 shrink-0 cursor-pointer rounded-lg p-2',
              'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              refreshing && 'animate-spin'
            )}
          >
            <Refresh01Icon size={16} />
          </button>
        </header>

        <DiskUsageCard system={system} />

        {analytics === null ? <AnalyticsSkeleton /> : <AnalyticsGrid analytics={analytics} />}

        <FactoryResetCard onOpen={() => setResetOpen(true)} />
      </div>

      <FactoryResetModal open={resetOpen} onClose={() => setResetOpen(false)} />
    </div>
  )
}

function DiskUsageCard({ system }: { system: SystemInfo | null }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <section className="bg-surface border-border rounded-xl border p-4">
      <div className="text-muted mb-3 flex items-center gap-1.5 text-[11px]">
        <HardDriveIcon size={12} />
        <span>{t('settings.data.disk.title')}</span>
      </div>
      {system === null ? (
        <DiskUsageBarSkeleton />
      ) : (
        <DiskUsageBar freeBytes={system.freeDiskBytes} totalBytes={system.totalDiskBytes} />
      )}
    </section>
  )
}

// Mirrors DiskUsageBar's intrinsic dimensions exactly so the swap from
// loading to loaded is layout-neutral: 16px label row (text-xs line-height),
// 6px gap-1.5, 6px bar (h-1.5 with border-box border).
function DiskUsageBarSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-4 items-center justify-between">
        <div className="bg-border/60 h-3 w-32 animate-pulse rounded" />
        <div className="bg-border/60 h-3 w-8 animate-pulse rounded" />
      </div>
      <div className="bg-bg border-border h-1.5 w-full overflow-hidden rounded-full border">
        <div className="bg-border/60 h-full w-1/3 animate-pulse" />
      </div>
    </div>
  )
}

function AnalyticsGrid({ analytics }: { analytics: DataAnalytics }): React.JSX.Element {
  const { t } = useTranslation()

  // CPU is "% of one core". Cap the displayed value so a brief spike on
  // a multi-core machine doesn't read as a nonsense >100% on a single
  // core. Show one decimal so "0.4%" doesn't round to 0.
  const cpuValue = `${analytics.cpuPercent.toFixed(1)}%`
  const ramValue = `${formatBytes(analytics.ramBytes)} / ${formatBytes(analytics.totalRamBytes)}`

  const items: Array<{ label: string; value: string; icon: IconComp }> = [
    {
      label: t('settings.data.metrics.workspace'),
      value: formatBytes(analytics.workspaceBytes),
      icon: HardDriveIcon
    },
    {
      label: t('settings.data.metrics.hippocampus'),
      value: formatBytes(analytics.hippocampusBytes),
      icon: AiBrain01Icon
    },
    {
      label: t('settings.data.metrics.corpus'),
      value: formatBytes(analytics.corpusBytes),
      icon: Database02Icon
    },
    {
      label: t('settings.data.metrics.prefrontal'),
      value: formatBytes(analytics.prefrontalBytes),
      icon: Pulse01Icon
    },
    {
      label: t('settings.data.metrics.ram'),
      value: ramValue,
      icon: RamMemoryIcon
    },
    {
      label: t('settings.data.metrics.cpu'),
      value: cpuValue,
      icon: CpuIcon
    }
  ]
  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map((it) => (
        <MetricCard key={it.label} label={it.label} value={it.value} Icon={it.icon} />
      ))}
    </div>
  )
}

// Both real and skeleton cards share this min-height so the swap from
// loading to loaded is layout-neutral. 4.25rem (68px) sits just above
// the loaded card's measured intrinsic height (~66.5px on Retina), so
// min-h drives in both states instead of either side's content winning.
const METRIC_CARD_BASE = 'bg-surface border-border min-h-[4.25rem] rounded-xl border p-3'

function MetricCard({
  label,
  value,
  Icon
}: {
  label: string
  value: string
  Icon: IconComp
}): React.JSX.Element {
  return (
    <div className={cn(METRIC_CARD_BASE, 'flex flex-col gap-1')}>
      <div className="text-muted flex items-center gap-1.5 text-[11px]">
        <Icon size={12} />
        <span className="truncate">{label}</span>
      </div>
      <span className="text-fg truncate text-sm font-semibold tabular-nums">{value}</span>
    </div>
  )
}

function AnalyticsSkeleton(): React.JSX.Element {
  // Bars sized to match the real card's content rows: h-4 for the icon
  // row (≈16px), h-5 for the text-sm value (≈20px), gap-1 between them
  // — same intrinsic content height as the loaded state.
  return (
    <div className="grid grid-cols-3 gap-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={cn(METRIC_CARD_BASE, 'flex flex-col gap-1')}>
          <div className="bg-border/60 h-4 w-16 animate-pulse rounded" />
          <div className="bg-border/60 h-5 w-12 animate-pulse rounded" />
        </div>
      ))}
    </div>
  )
}

function FactoryResetCard({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <section className="bg-surface border-border rounded-2xl border p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-red-500/10 p-2 text-red-600 dark:text-red-400">
          <WasteIcon size={18} />
        </div>
        <div className="flex flex-1 flex-col items-start gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-fg text-sm font-semibold">
              {t('settings.data.factoryReset.label')}
            </h2>
            <p className="text-muted text-xs leading-relaxed">
              {t('settings.data.factoryReset.description')}
            </p>
          </div>
          <Button
            size="md"
            variant="outline"
            onClick={onOpen}
            className="border-red-500/40 bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-400"
          >
            {t('settings.data.factoryReset.button')}
          </Button>
        </div>
      </div>
    </section>
  )
}

function FactoryResetModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()
  const expected = t('settings.data.factoryReset.confirmPhrase')
  const [input, setInput] = useState('')
  const [resetting, setResetting] = useState(false)

  const matches = input.trim() === expected

  const handleClose = (): void => {
    if (resetting) return
    setInput('')
    onClose()
  }

  const onConfirm = async (): Promise<void> => {
    if (!matches) return
    setResetting(true)
    try {
      await window.api.app.factoryReset()
    } catch {
      setResetting(false)
      toast.show({ tone: 'error', message: t('settings.data.factoryReset.errorToast') })
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dismissable={!resetting}
      title={t('settings.data.factoryReset.title')}
      footer={
        <>
          <Button
            size="md"
            variant="primary"
            disabled={!matches || resetting}
            onClick={() => void onConfirm()}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {t('settings.data.factoryReset.confirm')}
          </Button>
          <Button size="md" variant="ghost" onClick={handleClose} disabled={resetting}>
            {t('settings.data.factoryReset.cancel')}
          </Button>
        </>
      }
    >
      <p>{t('settings.data.factoryReset.warning')}</p>
      <p className="text-muted text-xs">
        {t('settings.data.factoryReset.typePrompt', { phrase: expected })}
      </p>
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={expected}
        autoFocus
        disabled={resetting}
      />
    </Modal>
  )
}
