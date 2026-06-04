import { Button } from '@components/core/Button'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn'
import type {
  BrowserExtensionConfig,
  ExtensionConnectionStatus,
  ExtensionServerStatus
} from '@preload/index'
import braveIcon from '@renderer/assets/browsers/brave.svg'
import chromeIcon from '@renderer/assets/browsers/chrome.svg'
import chromiumIcon from '@renderer/assets/browsers/chromium.svg'
import edgeIcon from '@renderer/assets/browsers/edge.svg'
import firefoxIcon from '@renderer/assets/browsers/firefox.svg'
import safariIcon from '@renderer/assets/browsers/safari.svg'
import { FolderOpenIcon, Tick02Icon } from 'hugeicons-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const STATUS_COLORS: Record<ExtensionConnectionStatus, string> = {
  stopped: 'text-red-400',
  listening: 'text-amber-400',
  connected: 'text-green-500',
  error: 'text-red-400'
}

const STATUS_DOT_COLORS: Record<ExtensionConnectionStatus, string> = {
  stopped: 'bg-red-400',
  listening: 'bg-amber-400',
  connected: 'bg-green-500',
  error: 'bg-red-400'
}

const ACTIONS = [
  {
    categoryKey: 'navigation',
    tools: ['browser_navigate', 'browser_back', 'browser_forward', 'browser_reload']
  },
  {
    categoryKey: 'interaction',
    tools: [
      'browser_click',
      'browser_type',
      'browser_select',
      'browser_hover',
      'browser_scroll',
      'browser_focus',
      'browser_keypress',
      'browser_drag_drop',
      'browser_file_upload'
    ]
  },
  {
    categoryKey: 'reading',
    tools: [
      'browser_read_page',
      'browser_query_selector',
      'browser_get_attribute',
      'browser_get_value',
      'browser_get_url',
      'browser_get_page_info'
    ]
  },
  {
    categoryKey: 'tabs',
    tools: [
      'browser_tabs_list',
      'browser_tab_open',
      'browser_tab_close',
      'browser_tab_switch',
      'browser_windows_list',
      'browser_window_open',
      'browser_window_resize'
    ]
  },
  { categoryKey: 'capture', tools: ['browser_screenshot', 'browser_pdf', 'browser_download'] },
  {
    categoryKey: 'data',
    tools: [
      'browser_cookies_get',
      'browser_cookies_set',
      'browser_cookies_remove',
      'browser_storage_get',
      'browser_storage_set',
      'browser_clipboard_read',
      'browser_clipboard_write'
    ]
  },
  {
    categoryKey: 'advanced',
    tools: [
      'browser_execute_js',
      'browser_wait_for',
      'browser_wait_for_navigation',
      'browser_wait_for_network_idle',
      'browser_notify'
    ]
  }
]

export function BrowserExtensionPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()

  const [config, setConfig] = useState<BrowserExtensionConfig | null>(null)
  const [status, setStatus] = useState<ExtensionServerStatus | null>(null)
  const [extensionPath, setExtensionPath] = useState('')
  const [portInput, setPortInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'failed' | null>(null)
  const [everConnected, setEverConnected] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [cfg, st, path] = await Promise.all([
        window.api.browserExtension.getConfig(),
        window.api.browserExtension.status(),
        window.api.browserExtension.getExtensionPath()
      ])
      if (cancelled) return
      setConfig(cfg)
      setStatus(st)
      if (st.status === 'connected') setEverConnected(true)
      setExtensionPath(path)
      setPortInput(String(cfg.port))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return window.api.browserExtension.onStatusChange((st) => {
      setStatus(st)
      if (st.status === 'connected') setEverConnected(true)
    })
  }, [])

  const isConnected = status?.status === 'connected'
  const isListening = status?.status === 'listening'
  const showInstallGuide = !isConnected && !everConnected

  const handlePortSave = useCallback(async () => {
    const port = parseInt(portInput, 10)
    if (isNaN(port) || port < 1 || port > 65535) {
      toast.show({ message: t('settings.services.browserExtension.invalidPort'), tone: 'error' })
      return
    }
    setBusy(true)
    try {
      const result = await window.api.browserExtension.setConfig({ port })
      setConfig(result.config)
      toast.show({
        message: t('settings.services.browserExtension.saveSuccess'),
        tone: 'success'
      })
    } catch {
      toast.show({ message: t('settings.services.browserExtension.saveError'), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }, [portInput, t, toast])

  const handleOpenFolder = useCallback(async () => {
    await window.api.browserExtension.openExtensionFolder()
  }, [])

  const handleUpdate = useCallback(async () => {
    setBusy(true)
    try {
      await window.api.browserExtension.updateExtension()
      toast.show({
        message: t('settings.services.browserExtension.updateSent'),
        tone: 'success'
      })
    } catch {
      toast.show({
        message: t('settings.services.browserExtension.updateError'),
        tone: 'error'
      })
    } finally {
      setBusy(false)
    }
  }, [t, toast])

  const handleTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.api.browserExtension.testConnection()
      setTestResult(result.ok ? 'success' : 'failed')
      toast.show({
        message: result.ok
          ? t('settings.services.browserExtension.testPassedToast', {
              passed: result.passed,
              steps: result.steps
            })
          : t('settings.services.browserExtension.testFailedToast', {
              passed: result.passed,
              steps: result.steps
            }),
        tone: result.ok ? 'success' : 'error'
      })
    } catch {
      setTestResult('failed')
      toast.show({ message: t('settings.services.browserExtension.testErrorToast'), tone: 'error' })
    } finally {
      setTesting(false)
      setTimeout(() => setTestResult(null), 4000)
    }
  }, [t, toast])

  const handleCopyPath = useCallback(() => {
    if (!extensionPath || copied) return
    void navigator.clipboard.writeText(extensionPath)
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }, [extensionPath, copied])

  const revealKey = navigator.platform.startsWith('Mac')
    ? 'settings.services.browserExtension.revealMac'
    : navigator.platform.startsWith('Win')
      ? 'settings.services.browserExtension.revealWindows'
      : 'settings.services.browserExtension.revealLinux'

  const portDirty = config !== null && portInput !== String(config.port)

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.services.browserExtension.title')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">
            {t('settings.services.browserExtension.subtitle')}
          </p>
        </header>

        {/* Extension Folder */}
        {extensionPath && (
          <section className="bg-surface border-border flex flex-col gap-3 rounded-2xl border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-fg flex items-center gap-2 text-sm font-medium">
                <FolderOpenIcon size={16} className="text-muted shrink-0" />
                {t('settings.services.browserExtension.extensionFolder')}
              </div>
              <button
                type="button"
                onClick={handleOpenFolder}
                className="text-primary hover:text-primary/80 shrink-0 cursor-pointer text-sm font-medium"
              >
                {t(revealKey)}
              </button>
            </div>
            <div dir="ltr" className="bg-bg flex w-full items-center gap-2 rounded-lg px-3 py-2">
              <code className="text-muted min-w-0 flex-1 truncate text-xs">{extensionPath}</code>
              <button
                type="button"
                disabled={copied}
                onClick={handleCopyPath}
                className={cn(
                  'shrink-0',
                  copied ? 'text-muted' : 'text-muted hover:text-fg cursor-pointer'
                )}
                aria-label="Copy path"
              >
                {copied ? (
                  <Tick02Icon size={14} />
                ) : (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <BrowserBadge name="Chrome" supported icon={chromeIcon} />
              <BrowserBadge name="Brave" supported icon={braveIcon} />
              <BrowserBadge name="Edge" supported icon={edgeIcon} />
              <BrowserBadge name="Chromium" supported icon={chromiumIcon} />
              <BrowserBadge name="Safari" supported={false} icon={safariIcon} />
              <BrowserBadge name="Firefox" supported={false} icon={firefoxIcon} />
            </div>
          </section>
        )}

        {/* Installation Guide (shown when never connected this session) */}
        {showInstallGuide && (
          <section className="bg-surface border-border flex flex-col gap-4 rounded-2xl border p-6">
            <h2 className="text-fg text-sm font-semibold">
              {t('settings.services.browserExtension.installTitle')}
            </h2>
            <ol className="text-muted flex flex-col gap-3 text-sm leading-relaxed">
              {[1, 2, 3, 4].map((step) => (
                <li key={step} className="flex items-start gap-3">
                  <span
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                      'bg-primary/15 text-primary'
                    )}
                  >
                    {step}
                  </span>
                  <span>
                    {t(`settings.services.browserExtension.step${step}`)}
                    {step === 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          window.api.browserExtension.openExtensionsPage()
                          toast.show({
                            message: t('settings.services.browserExtension.step1Toast'),
                            tone: 'success'
                          })
                        }}
                        className="text-primary hover:text-primary/80 cursor-pointer underline"
                      >
                        {t('settings.services.browserExtension.step1Link')}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            {isListening && (
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-green-500 animate-pulse" />
                <p className="text-green-500 text-xs animate-pulse">
                  {t('settings.services.browserExtension.waitingForConnection')}
                </p>
              </div>
            )}
          </section>
        )}

        {/* Connection Status */}
        {status && (
          <section className="bg-surface border-border flex flex-col gap-4 rounded-2xl border p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'inline-block h-2.5 w-2.5 rounded-full',
                    STATUS_DOT_COLORS[status.status],
                    status.status === 'listening' && 'animate-pulse'
                  )}
                />
                <span
                  className={cn(
                    'text-sm font-medium',
                    STATUS_COLORS[status.status],
                    status.status === 'listening' && 'animate-pulse'
                  )}
                >
                  {t(`settings.services.browserExtension.status.${status.status}`)}
                </span>
                <code
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[11px] font-mono',
                    isConnected && status.extensionVersion ? 'bg-bg text-muted' : 'invisible'
                  )}
                >
                  v{status.extensionVersion ?? '0.0.0'}
                </code>
                {status.error && <span className="text-muted text-xs">{status.error}</span>}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Button onClick={handleUpdate} disabled={busy || !isConnected} className="text-xs">
                {t('settings.services.browserExtension.updateBtn')}
              </Button>
              <button
                type="button"
                disabled={busy || testing || !isConnected}
                onClick={handleTest}
                className={cn(
                  'text-xs font-medium capitalize',
                  !isConnected || busy
                    ? 'text-muted cursor-not-allowed'
                    : testing
                      ? 'text-muted animate-pulse cursor-wait'
                      : testResult === 'success'
                        ? 'text-green-500'
                        : testResult === 'failed'
                          ? 'text-red-400'
                          : 'text-primary hover:text-primary/80 cursor-pointer'
                )}
              >
                {testing
                  ? t('settings.services.browserExtension.testRunning')
                  : testResult === 'success'
                    ? t('settings.services.browserExtension.testPassed')
                    : testResult === 'failed'
                      ? t('settings.services.browserExtension.testFailed')
                      : t('settings.services.browserExtension.testBtn')}
              </button>
            </div>
          </section>
        )}

        {/* Port Configuration */}
        {config && (
          <section className="bg-surface border-border flex flex-col gap-4 rounded-2xl border p-6">
            <div className="flex flex-col gap-1">
              <label className="text-fg text-sm font-medium">
                {t('settings.services.browserExtension.portLabel')}
              </label>
              <p className="text-muted text-xs">
                {t('settings.services.browserExtension.portHint')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={65535}
                value={portInput}
                onChange={(e) => setPortInput(e.target.value)}
                className={cn(
                  'border-border bg-bg text-fg h-10 min-w-0 flex-1 rounded-lg border px-3 text-sm font-mono',
                  'focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none'
                )}
              />
              <Button onClick={handlePortSave} disabled={!config || busy || !portDirty}>
                {t('settings.services.browserExtension.savePort')}
              </Button>
            </div>
          </section>
        )}

        {/* Actions Table */}
        <section className="bg-surface border-border flex flex-col rounded-2xl border">
          <div className="p-5 pb-3">
            <h2 className="text-fg text-sm font-semibold">
              {t('settings.services.browserExtension.actionsTitle')}
            </h2>
            <p className="text-muted mt-1 text-xs">
              {t('settings.services.browserExtension.actionsSubtitle')}
            </p>
          </div>
          {ACTIONS.map((group, gi) => (
            <div key={group.categoryKey}>
              <div className="border-border/60 border-t" />
              <div className="px-5 pt-3 pb-1">
                <span className="text-muted text-[10px] font-semibold uppercase tracking-wider">
                  {t(`settings.services.browserExtension.actions.${group.categoryKey}.category`)}
                </span>
              </div>
              {group.tools.map((tool, ai) => (
                <div
                  key={tool}
                  className={cn(
                    'flex items-center gap-3 px-5 py-2',
                    gi === ACTIONS.length - 1 && ai === group.tools.length - 1 && 'pb-4'
                  )}
                >
                  <code className="text-fg bg-bg shrink-0 rounded px-1.5 py-0.5 text-[11px] font-mono">
                    {tool}
                  </code>
                  <span className="text-muted min-w-0 truncate text-xs">
                    {t(`settings.services.browserExtension.actions.${tool}`)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

function BrowserBadge({
  name,
  supported,
  icon
}: {
  name: string
  supported: boolean
  icon: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ring-1',
        supported
          ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400'
          : 'bg-border/30 text-muted ring-border/50 line-through opacity-50'
      )}
    >
      <img src={icon} alt={name} className={cn('h-3.5 w-3.5', !supported && 'grayscale')} />
      {name}
    </span>
  )
}
