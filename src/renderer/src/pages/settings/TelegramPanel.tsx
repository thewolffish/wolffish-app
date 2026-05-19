import { Button } from '@components/core/button/Button'
import { Input } from '@components/core/input/Input'
import { Select, type SelectOption } from '@components/core/select/Select'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn/cn'
import type { TelegramChannelStatus, TelegramErrorKind } from '@preload/index'
import { EyeIcon, ViewOffIcon } from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const STATUS_DOT: Record<TelegramChannelStatus['status'], string> = {
  running: 'bg-emerald-500',
  starting: 'bg-amber-500',
  error: 'bg-rose-500',
  stopped: 'bg-border'
}

export function TelegramPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()

  // null while config is still loading; gives us a single render for
  // "I don't know yet" so the toggle never paints in a guessed state
  // and then transitions on load.
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [botToken, setBotToken] = useState('')
  const [hasSavedToken, setHasSavedToken] = useState(false)
  const [allowedUsersInput, setAllowedUsersInput] = useState('')
  const [tokenVisible, setTokenVisible] = useState(false)
  const [status, setStatus] = useState<TelegramChannelStatus>({
    status: 'stopped',
    errorKind: null,
    error: null
  })
  const [autoRefresh, setAutoRefresh] = useState<boolean | null>(null)
  const [staleHours, setStaleHours] = useState(3)
  const [busy, setBusy] = useState<'idle' | 'saving' | 'testing'>('idle')
  const [validation, setValidation] = useState<string | null>(null)
  const loaded = enabled !== null

  // Hydrate from disk on mount. setState only fires inside the
  // async IIFE — never synchronously in the effect body — so the
  // react-hooks set-state-in-effect rule stays happy. The cancelled
  // flag protects against the user navigating away mid-load.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const cfg = await window.api.telegram.getConfig()
      const live = await window.api.telegram.status()
      if (cancelled) return
      setBotToken(cfg.botToken)
      setHasSavedToken(cfg.botToken.length > 0)
      setAllowedUsersInput(cfg.allowedUserIds.join(', '))
      setAutoRefresh(cfg.autoRefresh ?? true)
      setStaleHours(cfg.staleHours ?? 3)
      setStatus(live)
      // Set `enabled` last so the first render with a real boolean
      // has the rest of the form already populated. Avoids sub-flicker.
      setEnabled(cfg.enabled)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const parseUserIds = useCallback(
    (input: string): { ok: true; ids: number[] } | { ok: false; error: string } => {
      const tokens = input
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      if (tokens.length === 0) return { ok: true, ids: [] }
      const ids: number[] = []
      for (const token of tokens) {
        if (!/^\d+$/.test(token)) {
          return { ok: false, error: t('settings.services.telegram.validation.userIdInvalid') }
        }
        ids.push(Number(token))
      }
      return { ok: true, ids }
    },
    [t]
  )

  const handleToggle = useCallback(async (value: boolean) => {
    setEnabled(value)
    const response = await window.api.telegram.setConfig({ enabled: value })
    setStatus(response.status)
  }, [])

  const translateError = useCallback(
    (kind: TelegramErrorKind, message?: string | null): string => {
      if (kind === 'unknown') {
        return t('settings.services.telegram.errors.unknown', {
          message: message ?? ''
        })
      }
      return t(`settings.services.telegram.errors.${kind}`)
    },
    [t]
  )

  const handleTest = useCallback(async () => {
    const parsed = parseUserIds(allowedUsersInput)
    if (!parsed.ok) {
      setValidation(parsed.error)
      return
    }
    if (botToken.trim().length === 0) {
      setValidation(t('settings.services.telegram.validation.tokenRequired'))
      return
    }
    if (parsed.ids.length === 0) {
      setValidation(t('settings.services.telegram.validation.userIdRequired'))
      return
    }
    setValidation(null)
    setBusy('testing')
    try {
      const result = await window.api.telegram.sendTestMessage({
        token: botToken.trim(),
        userId: parsed.ids[0]
      })
      if (result.ok) {
        const response = await window.api.telegram.setConfig({
          enabled: true,
          botToken: botToken.trim(),
          allowedUserIds: parsed.ids,
          autoRefresh: autoRefresh ?? true,
          staleHours
        })
        setStatus(response.status)
        setEnabled(true)
        setHasSavedToken(true)
        toast.show({
          message: t('settings.services.telegram.testSuccess'),
          tone: 'success'
        })
      } else {
        toast.show({
          message: t('settings.services.telegram.testFailure', {
            message: translateError(result.kind, result.message)
          }),
          tone: 'error'
        })
      }
    } finally {
      setBusy('idle')
    }
  }, [allowedUsersInput, autoRefresh, botToken, parseUserIds, staleHours, t, toast, translateError])

  const statusLabel = useMemo(() => {
    return t(`settings.services.telegram.status.${status.status}`)
  }, [status, t])

  const statusErrorText = useMemo(() => {
    if (status.errorKind) return translateError(status.errorKind, status.error)
    if (status.error) return status.error
    return null
  }, [status, translateError])

  // Segmented toggle: matches the Off | On pattern in WolffishPanel and
  // is RTL-safe by construction (flex layout reflows with `dir`). The
  // sliding switch this replaces translated only along physical X,
  // which inverted in Arabic.
  const toggleOptions = useMemo(
    () => [
      { value: false, label: t('settings.services.telegram.toggle.off') },
      { value: true, label: t('settings.services.telegram.toggle.on') }
    ],
    [t]
  )

  const staleHoursOptions: readonly SelectOption<string>[] = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => {
        const h = i + 1
        return {
          value: String(h),
          label: t('settings.services.telegram.autoRefresh.hours', { count: h })
        }
      }),
    [t]
  )

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.services.telegram.title')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">
            {t('settings.services.telegram.subtitle')}
          </p>
        </header>

        <section className="bg-surface border-border flex flex-col gap-5 rounded-2xl border p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-fg text-sm font-medium">
                {t('settings.services.telegram.enable')}
              </span>
              <p className="text-muted text-xs">
                {t('settings.services.telegram.enableDescription')}
              </p>
            </div>
            {/* Hold the toggle's footprint until config is loaded so the
                first paint with the real value is the only paint —
                otherwise the segmented control flickers from off to on. */}
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
                  const cantEnable = opt.value && !hasSavedToken
                  return (
                    <button
                      key={String(opt.value)}
                      role="tab"
                      type="button"
                      aria-selected={active}
                      disabled={cantEnable}
                      onClick={() => void handleToggle(opt.value)}
                      className={cn(
                        'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                        cantEnable
                          ? 'text-muted/50 cursor-not-allowed'
                          : active
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

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted text-xs font-medium uppercase tracking-wider">
                {t('settings.services.telegram.status.label')}
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

          {/* Bot token: full-width input with the eye toggle inside the
              field, matching the API-key field in CloudProviderPanel. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="telegram-bot-token" className="text-muted text-sm font-medium">
              {t('settings.services.telegram.botToken')}
            </label>
            <div className="relative w-full">
              <Input
                id="telegram-bot-token"
                type={tokenVisible ? 'text' : 'password'}
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder={t('settings.services.telegram.botTokenPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="pe-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setTokenVisible((v) => !v)}
                aria-label={t(
                  tokenVisible
                    ? 'settings.services.telegram.hideToken'
                    : 'settings.services.telegram.showToken'
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
            <p className="text-muted text-xs">{t('settings.services.telegram.botTokenHint')}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Input
              label={t('settings.services.telegram.allowedUsers')}
              value={allowedUsersInput}
              onChange={(e) => setAllowedUsersInput(e.target.value)}
              placeholder={t('settings.services.telegram.allowedUsersPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
            <p className="text-muted text-xs">{t('settings.services.telegram.allowedUsersHint')}</p>
          </div>

          <div className="border-border/60 border-t" />

          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-fg text-sm font-medium">
                {t('settings.services.telegram.autoRefresh.label')}
              </span>
              <p className="text-muted text-xs">
                {t('settings.services.telegram.autoRefresh.description')}
              </p>
            </div>
            {autoRefresh === null ? (
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
                  const active = opt.value === autoRefresh
                  return (
                    <button
                      key={String(opt.value)}
                      role="tab"
                      type="button"
                      aria-selected={active}
                      onClick={() => setAutoRefresh(opt.value)}
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

          {autoRefresh && (
            <Select<string>
              label={t('settings.services.telegram.autoRefresh.staleLabel')}
              value={String(staleHours)}
              options={staleHoursOptions}
              onChange={(next) => setStaleHours(Number(next))}
            />
          )}

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
              disabled={
                busy !== 'idle' ||
                !loaded ||
                botToken.trim().length === 0 ||
                allowedUsersInput.trim().length === 0
              }
            >
              {t('settings.services.telegram.test')}
            </Button>
          </div>

          <p className="text-muted text-xs">{t('settings.services.telegram.testHint')}</p>
        </section>

        <CommandsSection />
      </div>
    </div>
  )
}

function CommandsSection(): React.JSX.Element {
  const { t } = useTranslation()
  const commands: Array<{ name: string; description: string }> = [
    { name: '/new', description: t('settings.services.telegram.commands.new') },
    { name: '/current', description: t('settings.services.telegram.commands.current') },
    { name: '/resume', description: t('settings.services.telegram.commands.resume') },
    { name: '/delete', description: t('settings.services.telegram.commands.delete') },
    { name: '/clear', description: t('settings.services.telegram.commands.clear') },
    { name: '/stop', description: t('settings.services.telegram.commands.stop') },
    { name: '/approve', description: t('settings.services.telegram.commands.approve') },
    { name: '/deny', description: t('settings.services.telegram.commands.deny') },
    { name: '/status', description: t('settings.services.telegram.commands.status') }
  ]
  const limitations: string[] = [
    t('settings.services.telegram.limitations.singleConversation'),
    t('settings.services.telegram.limitations.busyNotQueued'),
    t('settings.services.telegram.limitations.fileSize'),
    t('settings.services.telegram.limitations.allowList'),
    t('settings.services.telegram.limitations.silentIgnore')
  ]

  return (
    <section className="bg-surface border-border flex flex-col gap-5 rounded-2xl border p-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-fg text-sm font-medium">
          {t('settings.services.telegram.commandsTitle')}
        </h2>
        <p className="text-muted text-xs">{t('settings.services.telegram.commandsSubtitle')}</p>
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
          {t('settings.services.telegram.limitationsTitle')}
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
