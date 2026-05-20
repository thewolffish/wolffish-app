import { Button } from '@components/core/Button'
import { Input } from '@components/core/Input'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn'
import type { MemesErrorKind, MemesStatus } from '@preload/index'
import { EyeIcon, ViewOffIcon } from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const STATUS_DOT: Record<string, string> = {
  configured: 'bg-emerald-500',
  error: 'bg-rose-500',
  disabled: 'bg-border'
}

export function MemesPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()

  const [giphyKey, setGiphyKey] = useState('')
  const [giphyKeyVisible, setGiphyKeyVisible] = useState(false)

  const [imgflipUsername, setImgflipUsername] = useState('')
  const [imgflipPassword, setImgflipPassword] = useState('')
  const [imgflipPasswordVisible, setImgflipPasswordVisible] = useState(false)

  const [status, setStatus] = useState<MemesStatus>({
    memegen: 'available',
    giphy: 'disabled',
    imgflip: 'disabled',
    giphyErrorKind: null,
    giphyError: null,
    imgflipErrorKind: null,
    imgflipError: null
  })
  const [busy, setBusy] = useState<'idle' | 'testingGiphy' | 'testingImgflip'>('idle')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const cfg = await window.api.memes.getConfig()
      const live = await window.api.memes.status()
      if (cancelled) return
      setGiphyKey(cfg.giphy.apiKey)
      setImgflipUsername(cfg.imgflip.username)
      setImgflipPassword(cfg.imgflip.password)
      setStatus(live)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const translateError = useCallback(
    (kind: MemesErrorKind, message?: string | null): string => {
      if (kind === 'unknown') {
        return t('settings.services.memes.errors.unknown', { message: message ?? '' })
      }
      return t(`settings.services.memes.errors.${kind}`)
    },
    [t]
  )

  const handleTestGiphy = useCallback(async () => {
    if (giphyKey.trim().length === 0) {
      toast.show({
        message: t('settings.services.memes.validation.giphyKeyRequired'),
        tone: 'error'
      })
      return
    }
    setBusy('testingGiphy')
    try {
      const result = await window.api.memes.testGiphy(giphyKey.trim())
      if (result.ok) {
        const response = await window.api.memes.setConfig({ giphy: { apiKey: giphyKey.trim() } })
        setStatus(response.status)
        toast.show({ message: t('settings.services.memes.testGiphySuccess'), tone: 'success' })
      } else {
        toast.show({
          message: t('settings.services.memes.testFailure', {
            message: translateError(result.kind, result.message)
          }),
          tone: 'error'
        })
        const live = await window.api.memes.status()
        setStatus(live)
      }
    } finally {
      setBusy('idle')
    }
  }, [giphyKey, t, toast, translateError])

  const handleTestImgflip = useCallback(async () => {
    if (!imgflipUsername.trim() || !imgflipPassword.trim()) {
      toast.show({
        message: t('settings.services.memes.validation.imgflipCredsRequired'),
        tone: 'error'
      })
      return
    }
    setBusy('testingImgflip')
    try {
      const result = await window.api.memes.testImgflip({
        username: imgflipUsername.trim(),
        password: imgflipPassword.trim()
      })
      if (result.ok) {
        const response = await window.api.memes.setConfig({
          imgflip: { username: imgflipUsername.trim(), password: imgflipPassword.trim() }
        })
        setStatus(response.status)
        toast.show({ message: t('settings.services.memes.testImgflipSuccess'), tone: 'success' })
      } else {
        toast.show({
          message: t('settings.services.memes.testFailure', {
            message: translateError(result.kind, result.message)
          }),
          tone: 'error'
        })
        const live = await window.api.memes.status()
        setStatus(live)
      }
    } finally {
      setBusy('idle')
    }
  }, [imgflipUsername, imgflipPassword, t, toast, translateError])

  const giphyStatusLabel = useMemo(
    () => t(`settings.services.memes.providerStatus.${status.giphy}`),
    [status.giphy, t]
  )
  const imgflipStatusLabel = useMemo(
    () => t(`settings.services.memes.providerStatus.${status.imgflip}`),
    [status.imgflip, t]
  )

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.services.memes.title')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">
            {t('settings.services.memes.subtitle')}
          </p>
        </header>

        {/* Memegen — always available */}
        <section className="bg-surface border-border flex flex-col gap-4 rounded-2xl border p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-fg text-sm font-medium">
                {t('settings.services.memes.memegen.title')}
              </span>
              <p className="text-muted text-xs">
                {t('settings.services.memes.memegen.description')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-fg text-sm">
                {t('settings.services.memes.providerStatus.available')}
              </span>
            </div>
          </div>
        </section>

        {/* Giphy */}
        <section className="bg-surface border-border flex flex-col gap-4 rounded-2xl border p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-fg text-sm font-medium">
                {t('settings.services.memes.giphy.title')}
              </span>
              <p className="text-muted text-xs">{t('settings.services.memes.giphy.description')}</p>
            </div>
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn('h-2 w-2 rounded-full', STATUS_DOT[status.giphy])}
              />
              <span className="text-fg text-sm">{giphyStatusLabel}</span>
            </div>
          </div>

          {status.giphyError && (
            <pre
              className={cn(
                'bg-bg/40 border-border rounded-md border px-3 py-2',
                'text-xs whitespace-pre-wrap wrap-break-word font-mono text-rose-500'
              )}
            >
              {status.giphyErrorKind
                ? translateError(status.giphyErrorKind, status.giphyError)
                : status.giphyError}
            </pre>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="giphy-api-key" className="text-muted text-sm font-medium">
              {t('settings.services.memes.giphy.apiKeyLabel')}
            </label>
            <div className="relative w-full">
              <Input
                id="giphy-api-key"
                type={giphyKeyVisible ? 'text' : 'password'}
                value={giphyKey}
                onChange={(e) => setGiphyKey(e.target.value)}
                placeholder={t('settings.services.memes.giphy.apiKeyPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="pe-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setGiphyKeyVisible((v) => !v)}
                aria-label={t(
                  giphyKeyVisible
                    ? 'settings.services.memes.hideKey'
                    : 'settings.services.memes.showKey'
                )}
                className={cn(
                  'text-muted hover:text-fg absolute inset-e-2 top-1/2 -translate-y-1/2',
                  'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
                )}
              >
                {giphyKeyVisible ? <ViewOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
            <p className="text-muted text-xs">{t('settings.services.memes.giphy.hint')}</p>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              onClick={() => void handleTestGiphy()}
              disabled={busy !== 'idle' || giphyKey.trim().length === 0}
            >
              {t('settings.services.memes.testConnection')}
            </Button>
            <a
              href="https://developers.giphy.com/dashboard/?create=true"
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent text-xs hover:brightness-110"
            >
              {t('settings.services.memes.giphy.getKey')}
            </a>
          </div>
        </section>

        {/* Imgflip */}
        <section className="bg-surface border-border flex flex-col gap-4 rounded-2xl border p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-fg text-sm font-medium">
                {t('settings.services.memes.imgflip.title')}
              </span>
              <p className="text-muted text-xs">
                {t('settings.services.memes.imgflip.description')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn('h-2 w-2 rounded-full', STATUS_DOT[status.imgflip])}
              />
              <span className="text-fg text-sm">{imgflipStatusLabel}</span>
            </div>
          </div>

          {status.imgflipError && (
            <pre
              className={cn(
                'bg-bg/40 border-border rounded-md border px-3 py-2',
                'text-xs whitespace-pre-wrap wrap-break-word font-mono text-rose-500'
              )}
            >
              {status.imgflipErrorKind
                ? translateError(status.imgflipErrorKind, status.imgflipError)
                : status.imgflipError}
            </pre>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="imgflip-username" className="text-muted text-sm font-medium">
              {t('settings.services.memes.imgflip.usernameLabel')}
            </label>
            <Input
              id="imgflip-username"
              type="text"
              value={imgflipUsername}
              onChange={(e) => setImgflipUsername(e.target.value)}
              placeholder={t('settings.services.memes.imgflip.usernamePlaceholder')}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="imgflip-password" className="text-muted text-sm font-medium">
              {t('settings.services.memes.imgflip.passwordLabel')}
            </label>
            <div className="relative w-full">
              <Input
                id="imgflip-password"
                type={imgflipPasswordVisible ? 'text' : 'password'}
                value={imgflipPassword}
                onChange={(e) => setImgflipPassword(e.target.value)}
                placeholder={t('settings.services.memes.imgflip.passwordPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="pe-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setImgflipPasswordVisible((v) => !v)}
                aria-label={t(
                  imgflipPasswordVisible
                    ? 'settings.services.memes.hideKey'
                    : 'settings.services.memes.showKey'
                )}
                className={cn(
                  'text-muted hover:text-fg absolute inset-e-2 top-1/2 -translate-y-1/2',
                  'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
                )}
              >
                {imgflipPasswordVisible ? <ViewOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
            <p className="text-muted text-xs">{t('settings.services.memes.imgflip.hint')}</p>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              onClick={() => void handleTestImgflip()}
              disabled={busy !== 'idle' || !imgflipUsername.trim() || !imgflipPassword.trim()}
            >
              {t('settings.services.memes.testConnection')}
            </Button>
            <a
              href="https://imgflip.com/signup"
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent text-xs hover:brightness-110"
            >
              {t('settings.services.memes.imgflip.createAccount')}
            </a>
          </div>
        </section>
      </div>
    </div>
  )
}
