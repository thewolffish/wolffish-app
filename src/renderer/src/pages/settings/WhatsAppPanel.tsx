import { Button } from '@components/core/Button'
import { Input } from '@components/core/Input'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn'
import type { WhatsAppChannelStatus } from '@preload/index'
import { WhatsappIcon } from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const STATUS_DOT: Record<WhatsAppChannelStatus['status'], string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500',
  qr: 'bg-amber-500',
  error: 'bg-rose-500',
  disconnected: 'bg-border'
}

export function WhatsAppPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()

  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [allowedPhonesInput, setAllowedPhonesInput] = useState('')
  const [savedPhones, setSavedPhones] = useState('')
  const [status, setStatus] = useState<WhatsAppChannelStatus>({
    status: 'disconnected',
    error: null,
    qr: null,
    connectedPhone: null,
    connectedName: null
  })
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const loggingOut = useRef(false)
  const loaded = enabled !== null

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const cfg = await window.api.whatsapp.getConfig()
      const live = await window.api.whatsapp.status()
      if (cancelled) return
      const phonesStr = (cfg.allowedPhoneNumbers ?? []).join(', ')
      setAllowedPhonesInput(phonesStr)
      setSavedPhones(phonesStr)
      setStatus(live)
      if (live.qr) setQrCode(live.qr)
      setEnabled(cfg.enabled)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const offQr = window.api.whatsapp.onQr((qr) => setQrCode(qr))
    const offStatus = window.api.whatsapp.onStatusChange((s) => {
      if (loggingOut.current) return
      setStatus(s)
      if (s.qr) setQrCode(s.qr)
      if (s.status === 'connected') setQrCode(null)
    })
    return () => {
      offQr()
      offStatus()
    }
  }, [])

  const parsePhones = useCallback(
    (input: string): string[] =>
      input
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    []
  )

  // Toggle immediately starts/stops WhatsApp
  const handleToggle = useCallback(async (next: boolean) => {
    setEnabled(next)
    setBusy(true)
    try {
      const response = await window.api.whatsapp.setConfig({ enabled: next })
      setStatus(response.status)
    } finally {
      setBusy(false)
    }
  }, [])

  // Save only persists the allowed phone numbers (no restart)
  const handleSave = useCallback(async () => {
    const phones = parsePhones(allowedPhonesInput)
    setBusy(true)
    try {
      const response = await window.api.whatsapp.setConfig({
        allowedPhoneNumbers: phones
      })
      setStatus(response.status)
      const phonesStr = (response.config.allowedPhoneNumbers ?? []).join(', ')
      setSavedPhones(phonesStr)
      setAllowedPhonesInput(phonesStr)
      toast.show({
        message: t('settings.services.whatsapp.saveSuccess'),
        tone: 'success'
      })
    } finally {
      setBusy(false)
    }
  }, [allowedPhonesInput, parsePhones, t, toast])

  const handleLogout = useCallback(async () => {
    loggingOut.current = true
    setBusy(true)
    try {
      await window.api.whatsapp.logout()
      setQrCode(null)
      setEnabled(false)
      setStatus({
        status: 'disconnected',
        error: null,
        qr: null,
        connectedPhone: null,
        connectedName: null
      })
      toast.show({
        message: t('settings.services.whatsapp.logoutSuccess'),
        tone: 'success'
      })
    } catch {
      const live = await window.api.whatsapp.status()
      setStatus(live)
      toast.show({
        message: t('settings.services.whatsapp.logoutFailed'),
        tone: 'error'
      })
    } finally {
      loggingOut.current = false
      setBusy(false)
    }
  }, [t, toast])

  const statusLabel = useMemo(
    () =>
      enabled === false
        ? t('settings.services.whatsapp.status.inactive')
        : t(`settings.services.whatsapp.status.${status.status}`),
    [enabled, status, t]
  )

  const toggleOptions = useMemo(
    () => [
      { value: false, label: t('settings.services.whatsapp.toggle.off') },
      { value: true, label: t('settings.services.whatsapp.toggle.on') }
    ],
    [t]
  )

  const handleRequestQr = useCallback(async () => {
    setBusy(true)
    try {
      await window.api.whatsapp.requestQr()
    } finally {
      setBusy(false)
    }
  }, [])

  const showConnected = status.status === 'connected' && status.connectedPhone
  const hasChanges = allowedPhonesInput !== savedPhones

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.services.whatsapp.title')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">
            {t('settings.services.whatsapp.subtitle')}
          </p>
        </header>

        <section className="bg-surface border-border flex flex-col gap-5 rounded-2xl border p-6">
          {/* Enable toggle — immediately starts/stops */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-fg text-sm font-medium">
                {t('settings.services.whatsapp.enable')}
              </span>
              <p className="text-muted text-xs">
                {t('settings.services.whatsapp.enableDescription')}
              </p>
            </div>
            {enabled === null ? (
              <div
                aria-hidden="true"
                className="bg-border/30 h-7 w-[78px] shrink-0 animate-pulse rounded-lg"
              />
            ) : (
              <div
                role="tablist"
                className="border-border bg-bg/40 inline-flex shrink-0 items-center rounded-lg border p-0.5"
              >
                {toggleOptions.map((opt) => {
                  const active = opt.value === enabled
                  return (
                    <button
                      key={String(opt.value)}
                      role="tab"
                      type="button"
                      aria-selected={active}
                      disabled={busy || !loaded}
                      onClick={() => {
                        if (opt.value !== enabled) void handleToggle(opt.value)
                      }}
                      className={cn(
                        'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                        active
                          ? 'bg-primary text-primary-fg shadow-sm'
                          : 'text-muted hover:text-fg cursor-pointer'
                      )}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="border-border/60 border-t" />

          <div
            className={cn(
              'flex flex-col gap-5 transition-opacity',
              enabled === false && 'pointer-events-none opacity-40'
            )}
          >
            {/* Status row — always visible so layout is stable */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted text-xs font-medium uppercase tracking-wider">
                  {t('settings.services.whatsapp.status.label')}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-2 w-2 rounded-full',
                      enabled === false ? 'bg-rose-500' : STATUS_DOT[status.status]
                    )}
                  />
                  <span className="text-fg text-sm">{statusLabel}</span>
                </div>
              </div>

              {/* Connected account chip */}
              {showConnected && (
                <div className="bg-bg/40 border-border flex items-center gap-3 rounded-xl border px-3 py-2.5">
                  <div className="bg-surface border-border flex h-9 w-9 shrink-0 items-center justify-center rounded-full border">
                    <WhatsappIcon size={18} className="text-emerald-500" />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-muted text-xs font-medium uppercase tracking-wider">
                      {t('settings.services.whatsapp.connectedAs')}
                    </span>
                    <span className="text-fg truncate text-sm font-medium">
                      {status.connectedName ? (
                        <>
                          {status.connectedName} (<span dir="ltr">+{status.connectedPhone}</span>)
                        </>
                      ) : (
                        <span dir="ltr">+{status.connectedPhone}</span>
                      )}
                    </span>
                  </div>
                </div>
              )}

              {status.error && (
                <pre
                  className={cn(
                    'bg-bg/40 border-border rounded-md border px-3 py-2',
                    'text-xs whitespace-pre-wrap wrap-break-word font-mono text-rose-500'
                  )}
                >
                  {status.error}
                </pre>
              )}
            </div>

            {/* Connect / QR / Connecting — mutually exclusive, same container size */}
            {enabled && !showConnected && (
              <>
                <div className="border-border/60 border-t" />
                <div className="flex flex-col items-center gap-3 rounded-lg bg-bg/40 p-6">
                  <p className="text-muted text-sm">
                    {status.status === 'qr' && qrCode
                      ? t('settings.services.whatsapp.scanQr')
                      : (status.error || t('settings.services.whatsapp.connectDescription'))}
                  </p>
                  <div className="rounded-lg bg-white p-4">
                    {status.status === 'qr' && qrCode ? (
                      <QrDisplay value={qrCode} />
                    ) : (
                      <div className="flex h-48 w-48 flex-col items-center justify-center gap-3">
                        {status.status === 'connecting' ? (
                          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                        ) : (
                          <>
                            <WhatsappIcon size={32} className="text-emerald-500" />
                            <Button
                              onClick={handleRequestQr}
                              disabled={busy}
                              variant="primary"
                              size="sm"
                            >
                              {t('settings.services.whatsapp.connect')}
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-muted text-xs">
                    {status.status === 'qr' && qrCode
                      ? t('settings.services.whatsapp.scanQrHelp')
                      : ' '}
                  </p>
                </div>
              </>
            )}

            <div className="border-border/60 border-t" />

            {/* Allowed phone numbers */}
            <div className="flex flex-col gap-1.5">
              <Input
                label={t('settings.services.whatsapp.allowedPhones')}
                value={allowedPhonesInput}
                onChange={(e) => setAllowedPhonesInput(e.target.value)}
                placeholder={t('settings.services.whatsapp.allowedPhonesPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                disabled={!showConnected}
                className="font-mono"
              />
              <p className="text-muted text-xs">
                {t('settings.services.whatsapp.allowedPhonesHint')}
              </p>
            </div>

            <div className="border-border/60 border-t" />

            {/* Actions */}
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={busy || !showConnected || !hasChanges}
              >
                {t('settings.services.whatsapp.save')}
              </Button>
              {showConnected && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleLogout()}
                  disabled={busy}
                >
                  {t('settings.services.whatsapp.logout')}
                </Button>
              )}
            </div>
          </div>
        </section>

        <CommandsSection />
      </div>
    </div>
  )
}

function CommandsSection(): React.JSX.Element {
  const { t } = useTranslation()
  const commands: Array<{ name: string; description: string }> = [
    { name: '/new', description: t('settings.services.whatsapp.commands.new') },
    { name: '/current', description: t('settings.services.whatsapp.commands.current') },
    { name: '/resume', description: t('settings.services.whatsapp.commands.resume') },
    { name: '/delete', description: t('settings.services.whatsapp.commands.delete') },
    { name: '/stop', description: t('settings.services.whatsapp.commands.stop') },
    { name: '/approve', description: t('settings.services.whatsapp.commands.approve') },
    { name: '/deny', description: t('settings.services.whatsapp.commands.deny') },
    { name: '/status', description: t('settings.services.whatsapp.commands.status') },
    { name: '/local', description: t('settings.services.whatsapp.commands.local') },
    { name: '/cloud', description: t('settings.services.whatsapp.commands.cloud') }
  ]
  const limitations: string[] = [
    t('settings.services.whatsapp.limitations.singleConversation'),
    t('settings.services.whatsapp.limitations.busyNotQueued'),
    t('settings.services.whatsapp.limitations.allowList'),
    t('settings.services.whatsapp.limitations.silentIgnore')
  ]

  return (
    <section className="bg-surface border-border flex flex-col gap-5 rounded-2xl border p-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-fg text-sm font-medium">
          {t('settings.services.whatsapp.commandsTitle')}
        </h2>
        <p className="text-muted text-xs">{t('settings.services.whatsapp.commandsSubtitle')}</p>
      </header>
      <ul className="divide-border/40 divide-y">
        {commands.map((cmd) => (
          <li key={cmd.name} className="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0">
            <code className="text-fg bg-border/40 rounded-md px-1.5 py-0.5 font-mono text-xs">
              {cmd.name}
            </code>
            <span className="text-muted text-xs leading-relaxed">{cmd.description}</span>
          </li>
        ))}
      </ul>

      <div className="border-border/60 border-t" />

      <div className="flex flex-col gap-2">
        <h2 className="text-fg text-sm font-medium">
          {t('settings.services.whatsapp.limitationsTitle')}
        </h2>
        <ul className="text-muted flex flex-col gap-1 text-xs leading-relaxed">
          {limitations.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function QrDisplay({ value }: { value: string }): React.JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void renderQrToCanvas(value).then((url) => {
      if (!cancelled) setDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [value])

  if (!dataUrl) {
    return <div aria-hidden="true" className="h-48 w-48 animate-pulse rounded-md bg-gray-200" />
  }

  return <img src={dataUrl} alt="WhatsApp QR code" className="h-48 w-48" />
}

async function renderQrToCanvas(data: string): Promise<string> {
  const size = 192
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  try {
    const { default: QRCode } = await import('qrcode')
    return await QRCode.toDataURL(data, {
      width: size,
      margin: 0,
      color: { dark: '#000000', light: '#ffffff' }
    })
  } catch {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = '#000000'
    ctx.font = '10px monospace'
    ctx.fillText('QR: ' + data.slice(0, 30) + '...', 4, size / 2)
    return canvas.toDataURL()
  }
}
