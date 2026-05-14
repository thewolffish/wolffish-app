import { Button } from '@components/core/button/Button'
import { Input } from '@components/core/input/Input'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn/cn'
import { getCachedGoogleSnapshot, prefetchGooglePanel } from '@pages/settings/googleSnapshot'
import type { GoogleBinaryStatus, GoogleConfig, GoogleStatus } from '@preload/index'
import { CheckmarkCircle02Icon, CloudUploadIcon, Copy01Icon, Delete02Icon } from 'hugeicons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

const STATUS_DOT: Record<GoogleStatus['status'], string> = {
  active: 'bg-emerald-500',
  error: 'bg-rose-500',
  inactive: 'bg-border'
}

type Stage = 'idle' | 'setup' | 'updating' | 'validating' | 'authorizing'

const EMPTY_STATUS: GoogleStatus = {
  status: 'inactive',
  errorKind: null,
  error: null
}

export function GooglePanel(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()

  // Hydrate from the module-level cache — Settings.tsx kicks off the fetch
  // on its own mount, so by the time the user clicks Google Workspace the
  // snapshot is usually already available and we render in one shot.
  const initial = getCachedGoogleSnapshot()
  const [binary, setBinary] = useState<GoogleBinaryStatus>(
    initial?.binary ?? { gogInstalled: false, gogVersion: null }
  )
  const [config, setConfig] = useState<GoogleConfig | null>(initial?.config ?? null)
  const [status, setStatus] = useState<GoogleStatus>(initial?.status ?? EMPTY_STATUS)
  const [email, setEmail] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [credsDone, setCredsDone] = useState(initial?.config?.credentialsStored ?? false)
  const [progress, setProgress] = useState(initial?.binary.gogInstalled ? 100 : 0)
  const [accounts, setAccounts] = useState<string[]>(initial?.accounts ?? [])
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const authCanceledRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void prefetchGooglePanel().then((snap) => {
      if (cancelled) return
      setBinary(snap.binary)
      setConfig(snap.config)
      setStatus(snap.status)
      setAccounts(snap.accounts)
      setCredsDone(snap.config.credentialsStored)
      if (snap.binary.gogInstalled) setProgress(100)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return window.api.google.onSetupProgress((evt) => setProgress(evt.percent))
  }, [])

  useEffect(() => {
    return window.api.google.onAuthUrl((evt) => setAuthUrl(evt.url))
  }, [])

  // After install/update completes, refresh the auth list — gogcli might
  // be brand new (so the prefetch found nothing) or might have new accounts.
  useEffect(() => {
    if (!binary.gogInstalled) return
    let cancelled = false
    void window.api.google.listAccounts().then((list) => {
      if (!cancelled) setAccounts(list)
    })
    return () => {
      cancelled = true
    }
  }, [binary.gogInstalled])

  const handleSetup = useCallback(async () => {
    setStage('setup')
    setProgress(0)
    try {
      const result = await window.api.google.setup()
      if (result.ok) {
        setBinary(result.binary)
        setProgress(100)
        toast.show({
          message: t('settings.services.google.toasts.installed', {
            version: result.binary.gogVersion ?? ''
          }),
          tone: 'success'
        })
      } else {
        toast.show({
          message: t(`settings.services.google.errors.${result.kind}`, {
            defaultValue: t('settings.services.google.toasts.installFailed')
          }),
          tone: 'error'
        })
        const fresh = await window.api.google.checkBinary()
        setBinary(fresh)
        setProgress(fresh.gogInstalled ? 100 : 0)
      }
    } finally {
      setStage('idle')
    }
  }, [t, toast])

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setStage('validating')
      try {
        const text = await file.text()
        const result = await window.api.google.uploadCredentials(text)
        if (result.ok) {
          setCredsDone(true)
          setConfig((prev) =>
            prev
              ? {
                  ...prev,
                  clientId: result.clientId,
                  projectId: result.projectId,
                  credentialsStored: true
                }
              : prev
          )
          toast.show({
            message: t('settings.services.google.toasts.credentialsStored'),
            tone: 'success'
          })
        } else {
          toast.show({
            message: t('settings.services.google.toasts.credentialsRejected'),
            tone: 'error'
          })
        }
      } finally {
        setStage('idle')
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [t, toast]
  )

  const handleDeleteCredentials = useCallback(async () => {
    const result = await window.api.google.deleteCredentials()
    if (!result.ok) {
      toast.show({
        message: t('settings.services.google.toasts.credentialsDeleteFailed'),
        tone: 'error'
      })
      return
    }
    setCredsDone(false)
    setAccounts([])
    setConfig((prev) =>
      prev ? { ...prev, clientId: '', projectId: '', credentialsStored: false } : prev
    )
    setStatus({ status: 'inactive', errorKind: null, error: null })
    toast.show({
      message: t('settings.services.google.toasts.credentialsDeleted'),
      tone: 'success'
    })
  }, [t, toast])

  const handleUpdate = useCallback(async () => {
    setStage('updating')
    setProgress(0)
    try {
      const result = await window.api.google.update()
      if (result?.ok) {
        if (result.updated) {
          setBinary({ gogInstalled: true, gogVersion: result.version })
          setProgress(100)
          toast.show({
            message: t('settings.services.google.toasts.updated', {
              version: result.version ?? ''
            }),
            tone: 'success'
          })
        } else {
          // Already on latest — keep the bar full and let the user know.
          setProgress(100)
          toast.show({
            message: t('settings.services.google.toasts.latest'),
            tone: 'success'
          })
        }
      } else {
        toast.show({
          message: t('settings.services.google.toasts.updateFailed'),
          tone: 'error'
        })
        const fresh = await window.api.google.checkBinary()
        setBinary(fresh)
        setProgress(fresh.gogInstalled ? 100 : 0)
      }
    } catch {
      // Anything that throws (stale IPC handler, network reject, etc.)
      // would otherwise leave the bar at 0 with no feedback. Surface it.
      toast.show({
        message: t('settings.services.google.toasts.updateFailed'),
        tone: 'error'
      })
      const fresh = await window.api.google.checkBinary().catch(() => null)
      if (fresh) {
        setBinary(fresh)
        setProgress(fresh.gogInstalled ? 100 : 0)
      } else {
        setProgress(0)
      }
    } finally {
      setStage('idle')
    }
  }, [t, toast])

  const handleRemove = useCallback(
    async (accountEmail: string) => {
      const result = await window.api.google.removeAccount(accountEmail)
      if (!result.ok) {
        toast.show({
          message: t('settings.services.google.toasts.removeFailed'),
          tone: 'error'
        })
        return
      }
      setAccounts(result.accounts)
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              status: result.accounts.length > 0 ? 'active' : 'inactive'
            }
          : prev
      )
      const live = await window.api.google.status()
      setStatus(live)
      toast.show({
        message: t('settings.services.google.toasts.removed'),
        tone: 'success'
      })
    },
    [t, toast]
  )

  const handleAuth = useCallback(async () => {
    if (!email.trim()) return
    authCanceledRef.current = false
    setStage('authorizing')
    setAuthUrl(null)
    try {
      const result = await window.api.google.authAdd(email.trim())
      if (result.ok) {
        setConfig((prev) => (prev ? { ...prev, status: 'active' } : prev))
        setStatus({ status: 'active', errorKind: null, error: null })
        setEmail('')
        const refreshed = await window.api.google.listAccounts()
        setAccounts(refreshed)
        toast.show({
          message: t('settings.services.google.toasts.authorized'),
          tone: 'success'
        })
      } else if (!authCanceledRef.current) {
        // User-canceled auths are silent — they pressed Cancel deliberately.
        toast.show({
          message: t('settings.services.google.toasts.authFailed'),
          tone: 'error'
        })
        const live = await window.api.google.status()
        setStatus(live)
      }
    } finally {
      setStage('idle')
      setAuthUrl(null)
      authCanceledRef.current = false
    }
  }, [email, t, toast])

  const handleCancelAuth = useCallback(async () => {
    authCanceledRef.current = true
    await window.api.google.cancelAuth()
  }, [])

  const ready = binary.gogInstalled

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.services.google.title')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">
            {t('settings.services.google.subtitle')}
          </p>
        </header>

        <SetupSection
          binary={binary}
          stage={stage}
          progress={progress}
          onSetup={() => void handleSetup()}
          onUpdate={() => void handleUpdate()}
        />

        <CredentialsSection
          enabled={ready}
          credsDone={credsDone}
          stage={stage}
          config={config}
          fileInputRef={fileInputRef}
          onFile={handleFileChange}
          onDelete={() => void handleDeleteCredentials()}
        />

        <AuthSection
          enabled={ready && credsDone}
          stage={stage}
          email={email}
          accounts={accounts}
          authUrl={authUrl}
          onEmailChange={setEmail}
          onAuthorize={() => void handleAuth()}
          onCancel={() => void handleCancelAuth()}
          onRemove={(acc) => void handleRemove(acc)}
        />

        <StatusSection status={status} config={config} accounts={accounts} />
      </div>
    </div>
  )
}

function SetupSection({
  binary,
  stage,
  progress,
  onSetup,
  onUpdate
}: {
  binary: GoogleBinaryStatus
  stage: Stage
  progress: number
  onSetup: () => void
  onUpdate: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const installing = stage === 'setup'
  const updating = stage === 'updating'
  const busy = installing || updating
  const ready = binary.gogInstalled

  return (
    <section className="bg-surface border-border flex flex-col gap-3 rounded-2xl border p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-fg text-sm font-medium">
            {t('settings.services.google.setup.label')}
          </span>
          <span className="text-muted text-xs">
            {ready ? (
              <Trans
                i18nKey="settings.services.google.setup.ready"
                values={{ version: binary.gogVersion ?? '' }}
                components={{
                  code: (
                    <code className="bg-bg/60 border-border rounded border px-1.5 py-0.5 font-mono text-[11px]" />
                  )
                }}
              />
            ) : (
              <Trans
                i18nKey="settings.services.google.setup.needsInstall"
                components={{
                  code: (
                    <code className="bg-bg/60 border-border rounded border px-1.5 py-0.5 font-mono text-[11px]" />
                  )
                }}
              />
            )}
          </span>
        </div>
        {ready ? (
          <Button type="button" variant="outline" onClick={onUpdate} disabled={busy}>
            {t('settings.services.google.setup.update')}
          </Button>
        ) : (
          <Button type="button" onClick={onSetup} disabled={busy}>
            {t('settings.services.google.setup.install')}
          </Button>
        )}
      </div>
      <div className="bg-border/30 h-1 overflow-hidden rounded-full">
        <div
          className="h-full bg-emerald-500 transition-[width] duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </section>
  )
}

function CredentialsSection({
  enabled,
  credsDone,
  stage,
  config,
  fileInputRef,
  onFile,
  onDelete
}: {
  enabled: boolean
  credsDone: boolean
  stage: Stage
  config: GoogleConfig | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDelete: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const validating = stage === 'validating'

  return (
    <section
      className={cn(
        'bg-surface border-border flex flex-col gap-4 rounded-2xl border p-6',
        !enabled && 'pointer-events-none opacity-40'
      )}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-muted text-xs font-medium uppercase tracking-wider">
          {t('settings.services.google.credentials.label')}
        </span>
        <p className="text-muted text-xs">{t('settings.services.google.credentials.hint')}</p>
      </div>

      {credsDone ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckmarkCircle02Icon size={16} className="text-emerald-500 shrink-0" />
              <span className="text-fg text-sm">
                {t('settings.services.google.credentials.stored')}
              </span>
            </div>
            <button
              type="button"
              onClick={onDelete}
              title={t('settings.services.google.credentials.delete')}
              aria-label={t('settings.services.google.credentials.delete')}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md transition-colors cursor-pointer',
                'text-muted hover:bg-rose-500/10 hover:text-rose-500',
                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
              )}
            >
              <Delete02Icon size={16} />
            </button>
          </div>
          <dl className="bg-bg/40 border-border grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs">
            {config?.projectId && (
              <>
                <dt className="text-muted">{t('settings.services.google.credentials.project')}</dt>
                <dd className="text-fg truncate font-mono">{config.projectId}</dd>
              </>
            )}
            {config?.clientId && (
              <>
                <dt className="text-muted">{t('settings.services.google.credentials.client')}</dt>
                <dd className="text-fg truncate font-mono" title={config.clientId}>
                  {truncateClientId(config.clientId)}
                </dd>
              </>
            )}
          </dl>
          <label
            className={cn(
              'border-border flex items-center gap-2 rounded-md border border-dashed px-3 py-2 transition-colors',
              validating
                ? 'pointer-events-none cursor-default'
                : 'hover:border-muted cursor-pointer'
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={onFile}
              className="hidden"
              disabled={validating}
            />
            <CloudUploadIcon size={14} className="text-muted shrink-0" />
            <span className="text-muted text-xs">
              {t('settings.services.google.credentials.rotate')}
            </span>
          </label>
        </div>
      ) : (
        <label
          className={cn(
            'border-border hover:border-muted flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 transition-colors',
            (validating || !enabled) && 'pointer-events-none opacity-60'
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={onFile}
            className="hidden"
          />
          <CloudUploadIcon size={24} className="text-muted" />
          <span className="text-muted text-sm">
            {validating
              ? t('settings.services.google.credentials.validating')
              : t('settings.services.google.credentials.dropzone')}
          </span>
        </label>
      )}
    </section>
  )
}

function AuthSection({
  enabled,
  stage,
  email,
  accounts,
  authUrl,
  onEmailChange,
  onAuthorize,
  onCancel,
  onRemove
}: {
  enabled: boolean
  stage: Stage
  email: string
  accounts: string[]
  authUrl: string | null
  onEmailChange: (v: string) => void
  onAuthorize: () => void
  onCancel: () => void
  onRemove: (account: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()
  const authorizing = stage === 'authorizing'

  return (
    <section
      className={cn(
        'bg-surface border-border flex flex-col gap-4 rounded-2xl border p-6',
        !enabled && 'pointer-events-none opacity-40'
      )}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-muted text-xs font-medium uppercase tracking-wider">
          {t('settings.services.google.auth.label')}
        </span>
        <p className="text-muted text-xs">{t('settings.services.google.auth.hint')}</p>
      </div>

      {accounts.length > 0 && (
        <div className="flex flex-col gap-2">
          {accounts.map((acc) => (
            <div key={acc} className="flex items-center gap-2">
              <div
                className={cn(
                  'flex h-9 flex-1 items-center gap-2 rounded-md border px-3',
                  'border-border bg-bg/30'
                )}
                aria-label={t('settings.services.google.auth.accountLabel', { account: acc })}
              >
                <span className="text-fg flex-1 truncate font-mono text-sm select-text">{acc}</span>
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                    'bg-emerald-500/10 text-emerald-500'
                  )}
                  aria-label={t('settings.services.google.auth.active')}
                >
                  {t('settings.services.google.auth.active')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onRemove(acc)}
                title={t('settings.services.google.auth.remove')}
                aria-label={t('settings.services.google.auth.remove')}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-md transition-colors cursor-pointer',
                  'text-muted hover:bg-rose-500/10 hover:text-rose-500',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
                )}
              >
                <Delete02Icon size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Input
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && email.trim() && !authorizing) {
                e.preventDefault()
                onAuthorize()
              }
            }}
            placeholder={t('settings.services.google.auth.placeholder')}
            autoComplete="email"
            disabled={authorizing}
          />
        </div>
        {authorizing ? (
          <Button type="button" onClick={onCancel}>
            {t('settings.services.google.auth.cancel')}
          </Button>
        ) : (
          <Button type="button" onClick={onAuthorize} disabled={!email.trim()}>
            {t(
              accounts.length > 0
                ? 'settings.services.google.auth.addMore'
                : 'settings.services.google.auth.authorize'
            )}
          </Button>
        )}
      </div>

      {authUrl && (
        <div className="flex items-center gap-2 text-xs">
          <p className="text-muted truncate flex-1">
            {t('settings.services.google.auth.linkNote')}{' '}
            <a
              href={authUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.preventDefault()
                window.open(authUrl, '_blank', 'noopener,noreferrer')
              }}
              className="text-accent hover:underline"
            >
              {t('settings.services.google.auth.linkOpen')}
            </a>
          </p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(authUrl).then(
                () =>
                  toast.show({
                    message: t('settings.services.google.toasts.linkCopied'),
                    tone: 'success'
                  }),
                () =>
                  toast.show({
                    message: t('settings.services.google.toasts.linkCopyFailed'),
                    tone: 'error'
                  })
              )
            }}
            title={t('settings.services.google.auth.copyLink')}
            aria-label={t('settings.services.google.auth.copyLink')}
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer',
              'text-muted hover:bg-border/40 hover:text-fg',
              'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
            )}
          >
            <Copy01Icon size={14} />
          </button>
        </div>
      )}
    </section>
  )
}

function StatusSection({
  status,
  config,
  accounts
}: {
  status: GoogleStatus
  config: GoogleConfig | null
  accounts: string[]
}): React.JSX.Element {
  const { t } = useTranslation()
  const services: string[] = t('settings.services.google.capabilities.list', {
    returnObjects: true,
    defaultValue: []
  }) as unknown as string[]

  return (
    <section
      className={cn(
        'bg-surface border-border flex flex-col gap-4 rounded-2xl border p-6',
        status.status === 'inactive' && 'pointer-events-none opacity-40'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted text-xs font-medium uppercase tracking-wider">
          {t('settings.services.google.status.label')}
        </span>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn('h-2 w-2 rounded-full', STATUS_DOT[status.status])}
          />
          <span className="text-fg text-sm">
            {t(`settings.services.google.status.${status.status}`)}
          </span>
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="text-muted text-xs">
            {t('settings.services.google.status.accounts')}
          </span>
          <span className="text-fg text-sm font-mono wrap-break-word">{accounts.join(', ')}</span>
        </div>
      )}

      {config?.projectId && (
        <div className="flex flex-col gap-0.5">
          <span className="text-muted text-xs">{t('settings.services.google.status.project')}</span>
          <span className="text-fg text-sm font-mono">{config.projectId}</span>
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

      <div className="border-border/60 border-t" />

      <div className="flex flex-col gap-1.5">
        <span className="text-muted text-xs font-medium">
          {t('settings.services.google.capabilities.title')}
        </span>
        <ul className="text-muted flex flex-col gap-1 text-xs leading-relaxed">
          {services.map((line, i) => (
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

function truncateClientId(id: string): string {
  if (id.length <= 32) return id
  // 1234567890-abcdef…apps.googleusercontent.com
  const head = id.slice(0, 12)
  const tail = id.slice(-26)
  return `${head}…${tail}`
}
