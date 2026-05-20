import { Button } from '@components/core/Button'
import { Input } from '@components/core/Input'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn'
import type { GitHubErrorKind, GitHubStatus } from '@preload/index'
import { EyeIcon, GithubIcon, ViewOffIcon } from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

const PAT_URL = 'https://github.com/settings/personal-access-tokens'

const TRANS_COMPONENTS = {
  link: (
    <a
      href={PAT_URL}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        e.preventDefault()
        window.open(PAT_URL, '_blank', 'noopener,noreferrer')
      }}
      className="text-accent hover:underline"
    />
  ),
  // dir="ltr" + inline-block keeps endpoint paths like /user reading
  // left-to-right inside RTL Arabic copy.
  code: (
    <code
      dir="ltr"
      className="bg-bg/60 border-border inline-block rounded border px-1 py-px font-mono text-[0.85em]"
    />
  )
}

const STATUS_DOT: Record<GitHubStatus['status'], string> = {
  configured: 'bg-emerald-500',
  error: 'bg-rose-500',
  disabled: 'bg-border'
}

export function GitHubPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()

  const [token, setToken] = useState('')
  const [login, setLogin] = useState('')
  const [name, setName] = useState('')
  const [tokenVisible, setTokenVisible] = useState(false)
  const [status, setStatus] = useState<GitHubStatus>({
    status: 'disabled',
    errorKind: null,
    error: null
  })
  const [busy, setBusy] = useState<'idle' | 'saving' | 'testing'>('idle')
  const [validation, setValidation] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const cfg = await window.api.github.getConfig()
      const live = await window.api.github.status()
      if (cancelled) return
      setToken(cfg.token)
      setLogin(cfg.login)
      setName(cfg.name)
      setStatus(live)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const translateError = useCallback(
    (kind: GitHubErrorKind, message?: string | null): string => {
      if (kind === 'unknown') {
        return t('settings.services.github.errors.unknown', { message: message ?? '' })
      }
      return t(`settings.services.github.errors.${kind}`)
    },
    [t]
  )

  const handleTest = useCallback(async () => {
    if (token.trim().length === 0) {
      setValidation(t('settings.services.github.validation.tokenRequired'))
      return
    }
    setValidation(null)
    setBusy('testing')
    try {
      const trimmed = token.trim()
      const result = await window.api.github.test(trimmed)
      if (result.ok) {
        // Persist the resolved identity so the next launch can render it
        // without re-hitting the API. Also save the token if the user
        // tested before saving — one-click flow.
        const response = await window.api.github.setConfig({
          token: trimmed,
          login: result.login,
          name: result.name ?? ''
        })
        setLogin(response.config.login)
        setName(response.config.name)
        setStatus(response.status)
        toast.show({
          message: t('settings.services.github.testSuccess', {
            login: result.login,
            name: result.name ?? result.login
          }),
          tone: 'success'
        })
      } else {
        toast.show({
          message: t('settings.services.github.testFailure', {
            message: translateError(result.kind, result.message)
          }),
          tone: 'error'
        })
        const live = await window.api.github.status()
        setStatus(live)
      }
    } finally {
      setBusy('idle')
    }
  }, [token, t, toast, translateError])

  const statusLabel = useMemo(
    () => t(`settings.services.github.status.${status.status}`),
    [status, t]
  )
  const statusErrorText = useMemo(() => {
    if (status.errorKind) return translateError(status.errorKind, status.error)
    if (status.error) return status.error
    return null
  }, [status, translateError])

  // Show the connected account chip only when (a) the persisted token
  // matches the input (no unsaved edits), (b) status is configured, and
  // (c) we have a login. Otherwise the displayed identity could lie about
  // an unsaved token the user is in the middle of typing.
  const showAccount = status.status === 'configured' && login.length > 0

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.services.github.title')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">
            {t('settings.services.github.subtitle')}
          </p>
        </header>

        <section className="bg-surface border-border flex flex-col gap-5 rounded-2xl border p-6">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted text-xs font-medium uppercase tracking-wider">
                {t('settings.services.github.status.label')}
              </span>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn('h-2 w-2 rounded-full', STATUS_DOT[status.status])}
                />
                <span className="text-fg text-sm">{statusLabel}</span>
              </div>
            </div>

            {showAccount && (
              <div className="bg-bg/40 border-border flex items-center gap-3 rounded-xl border px-3 py-2.5">
                <div className="bg-surface border-border flex h-9 w-9 shrink-0 items-center justify-center rounded-full border">
                  <GithubIcon size={18} className="text-fg" />
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="text-muted text-xs font-medium uppercase tracking-wider">
                    {t('settings.services.github.connectedAs')}
                  </span>
                  <span className="text-fg truncate text-sm font-medium">
                    {name && name !== login ? `${name} (@${login})` : `@${login}`}
                  </span>
                </div>
              </div>
            )}

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
            <label htmlFor="github-token" className="text-muted text-sm font-medium">
              {t('settings.services.github.token')}
            </label>
            <div className="relative w-full">
              <Input
                id="github-token"
                type={tokenVisible ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t('settings.services.github.tokenPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="pe-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setTokenVisible((v) => !v)}
                aria-label={t(
                  tokenVisible
                    ? 'settings.services.github.hideToken'
                    : 'settings.services.github.showToken'
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
            <p className="text-muted text-xs">
              <Trans i18nKey="settings.services.github.tokenHint" components={TRANS_COMPONENTS} />
            </p>
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
              {t('settings.services.github.test')}
            </Button>
          </div>

          <p className="text-muted text-xs">
            <Trans i18nKey="settings.services.github.testHint" components={TRANS_COMPONENTS} />
          </p>
        </section>

        <CapabilitiesSection />
        <HowItWorksSection />
      </div>
    </div>
  )
}

function CapabilitiesSection(): React.JSX.Element {
  const { t } = useTranslation()
  const points: string[] = [
    t('settings.services.github.capabilities.repos'),
    t('settings.services.github.capabilities.issues'),
    t('settings.services.github.capabilities.prs'),
    t('settings.services.github.capabilities.branches'),
    t('settings.services.github.capabilities.ci'),
    t('settings.services.github.capabilities.releases'),
    t('settings.services.github.capabilities.search'),
    t('settings.services.github.capabilities.files'),
    t('settings.services.github.capabilities.gists')
  ]
  return (
    <section className="bg-surface border-border flex flex-col gap-3 rounded-2xl border p-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-fg text-sm font-medium">
          {t('settings.services.github.capabilitiesTitle')}
        </h2>
        <p className="text-muted text-xs leading-relaxed">
          {t('settings.services.github.capabilitiesSubtitle')}
        </p>
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

function HowItWorksSection(): React.JSX.Element {
  const { t } = useTranslation()
  const plainPoints: string[] = [
    t('settings.services.github.howItWorks.scopes'),
    t('settings.services.github.howItWorks.tools'),
    t('settings.services.github.howItWorks.privacy'),
    t('settings.services.github.howItWorks.ci')
  ]
  return (
    <section className="bg-surface border-border flex flex-col gap-3 rounded-2xl border p-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-fg text-sm font-medium">
          {t('settings.services.github.howItWorksTitle')}
        </h2>
      </header>
      <ul className="text-muted flex flex-col gap-1.5 text-xs leading-relaxed">
        <li className="flex gap-2">
          <span aria-hidden="true">•</span>
          <span>
            <Trans
              i18nKey="settings.services.github.howItWorks.pat"
              components={TRANS_COMPONENTS}
            />
          </span>
        </li>
        {plainPoints.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true">•</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
