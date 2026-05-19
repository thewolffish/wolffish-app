import { Button } from '@components/core/button/Button'
import { Input } from '@components/core/input/Input'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn/cn'
import type { NotionErrorKind, NotionStatus } from '@preload/index'
import { EyeIcon, ViewOffIcon } from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const STATUS_DOT: Record<NotionStatus['status'], string> = {
  configured: 'bg-emerald-500',
  error: 'bg-rose-500',
  disabled: 'bg-border'
}

export function NotionPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()

  const [token, setToken] = useState('')
  const [tokenVisible, setTokenVisible] = useState(false)
  const [status, setStatus] = useState<NotionStatus>({
    status: 'disabled',
    errorKind: null,
    error: null
  })
  const [busy, setBusy] = useState<'idle' | 'saving' | 'testing'>('idle')
  const [validation, setValidation] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const cfg = await window.api.notion.getConfig()
      const live = await window.api.notion.status()
      if (cancelled) return
      setToken(cfg.token)
      setStatus(live)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const translateError = useCallback(
    (kind: NotionErrorKind, message?: string | null): string => {
      if (kind === 'unknown') {
        return t('settings.services.notion.errors.unknown', { message: message ?? '' })
      }
      return t(`settings.services.notion.errors.${kind}`)
    },
    [t]
  )

  const handleTest = useCallback(async () => {
    if (token.trim().length === 0) {
      setValidation(t('settings.services.notion.validation.tokenRequired'))
      return
    }
    setValidation(null)
    setBusy('testing')
    try {
      const result = await window.api.notion.test(token.trim())
      if (result.ok) {
        const response = await window.api.notion.setConfig({ token: token.trim() })
        setStatus(response.status)
        toast.show({
          message: t('settings.services.notion.testSuccess', {
            name: result.name,
            email: result.email ?? ''
          }),
          tone: 'success'
        })
      } else {
        toast.show({
          message: t('settings.services.notion.testFailure', {
            message: translateError(result.kind, result.message)
          }),
          tone: 'error'
        })
        const live = await window.api.notion.status()
        setStatus(live)
      }
    } finally {
      setBusy('idle')
    }
  }, [token, t, toast, translateError])

  const statusLabel = useMemo(
    () => t(`settings.services.notion.status.${status.status}`),
    [status, t]
  )
  const statusErrorText = useMemo(() => {
    if (status.errorKind) return translateError(status.errorKind, status.error)
    if (status.error) return status.error
    return null
  }, [status, translateError])

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.services.notion.title')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">
            {t('settings.services.notion.subtitle')}
          </p>
        </header>

        <section className="bg-surface border-border flex flex-col gap-5 rounded-2xl border p-6">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted text-xs font-medium uppercase tracking-wider">
                {t('settings.services.notion.status.label')}
              </span>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn('h-2 w-2 rounded-full', STATUS_DOT[status.status])}
                />
                <span className="text-fg text-sm">{statusLabel}</span>
              </div>
            </div>
            {statusErrorText && (
              <pre
                className={cn(
                  'bg-bg/40 border-border rounded-md border px-3 py-2',
                  'text-xs whitespace-pre-wrap wrap-break-word font-mono text-rose-500'
                )}
              >
                {statusErrorText}
              </pre>
            )}
          </div>

          <div className="border-border/60 border-t" />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="notion-token" className="text-muted text-sm font-medium">
              {t('settings.services.notion.token')}
            </label>
            <div className="relative w-full">
              <Input
                id="notion-token"
                type={tokenVisible ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t('settings.services.notion.tokenPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="pe-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setTokenVisible((v) => !v)}
                aria-label={t(
                  tokenVisible
                    ? 'settings.services.notion.hideToken'
                    : 'settings.services.notion.showToken'
                )}
                className={cn(
                  'text-muted hover:text-fg absolute inset-e-2 top-1/2 -translate-y-1/2',
                  'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
                )}
              >
                {tokenVisible ? <ViewOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
            <p className="text-muted text-xs">{t('settings.services.notion.tokenHint')}</p>
          </div>

          {validation && (
            <p className="text-rose-500 text-xs" role="alert">
              {validation}
            </p>
          )}

          <div className="border-border/60 border-t" />

          <div className="flex items-center justify-end">
            <Button
              type="button"
              onClick={() => void handleTest()}
              disabled={busy !== 'idle' || token.trim().length === 0}
            >
              {t('settings.services.notion.test')}
            </Button>
          </div>

          <p className="text-muted text-xs">{t('settings.services.notion.testHint')}</p>
        </section>

        <HowItWorksSection />
      </div>
    </div>
  )
}

function HowItWorksSection(): React.JSX.Element {
  const { t } = useTranslation()
  const points: string[] = [
    t('settings.services.notion.howItWorks.integration'),
    t('settings.services.notion.howItWorks.pages'),
    t('settings.services.notion.howItWorks.databases'),
    t('settings.services.notion.howItWorks.privacy'),
    t('settings.services.notion.howItWorks.setup')
  ]
  return (
    <section className="bg-surface border-border flex flex-col gap-3 rounded-2xl border p-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-fg text-sm font-medium">
          {t('settings.services.notion.howItWorksTitle')}
        </h2>
      </header>
      <ul className="text-muted flex flex-col gap-1.5 text-xs leading-relaxed">
        {points.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true">•</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
