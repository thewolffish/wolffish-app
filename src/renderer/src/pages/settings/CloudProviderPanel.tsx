import { Button } from '@components/core/Button'
import { Input } from '@components/core/Input'
import { AnthropicLogo, DeepSeekLogo, KimiLogo, MimoLogo, OpenAILogo } from '@components/core/ProviderLogos'
import { Select, type SelectOption } from '@components/core/Select'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn'
import type { CloudProviderConfig, ProviderListEntry, ProviderTestResult } from '@preload/index'
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  EyeIcon,
  LinkSquare02Icon,
  Loading02Icon,
  ViewOffIcon
} from 'hugeicons-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { IconType } from 'react-icons'

type ProviderId = CloudProviderConfig['id']
type Status = 'untested' | 'testing' | 'invalid'

const PROVIDER_LOGOS: Record<
  ProviderId,
  IconType | React.ComponentType<{ size?: number; className?: string }>
> = {
  anthropic: AnthropicLogo,
  openai: OpenAILogo,
  deepseek: DeepSeekLogo,
  mimo: MimoLogo,
  kimi: KimiLogo
}

const PROVIDER_URLS: Record<ProviderId, string> = {
  anthropic: 'https://console.anthropic.com',
  openai: 'https://platform.openai.com',
  deepseek: 'https://platform.deepseek.com',
  mimo: 'https://platform.xiaomimimo.com',
  kimi: 'https://platform.moonshot.ai'
}

type BadgeKind = 'frontier' | 'vision' | 'reasoning' | 'code' | 'fast' | 'voice'

type ModelSpec = {
  name: string
  context: string
  input: string
  output: string
  cached: string | null
  badges?: BadgeKind[]
}

const MODEL_SPECS: Record<ProviderId, ModelSpec[]> = {
  anthropic: [
    { name: 'claude-opus-4-8', context: '1M', input: '$5.00', output: '$25.00', cached: '$0.50', badges: ['frontier'] },
    { name: 'claude-opus-4-7', context: '1M', input: '$5.00', output: '$25.00', cached: '$0.50' },
    { name: 'claude-sonnet-4-6', context: '1M', input: '$3.00', output: '$15.00', cached: '$0.30' },
    { name: 'claude-opus-4-6', context: '1M', input: '$5.00', output: '$25.00', cached: '$0.50' },
    { name: 'claude-opus-4-5-20251101', context: '200K', input: '$5.00', output: '$25.00', cached: '$0.50' },
    { name: 'claude-sonnet-4-5-20250929', context: '200K', input: '$3.00', output: '$15.00', cached: '$0.30' },
    { name: 'claude-haiku-4-5-20251001', context: '200K', input: '$1.00', output: '$5.00', cached: '$0.10', badges: ['fast'] },
    { name: 'claude-opus-4-1-20250805', context: '200K', input: '$15.00', output: '$75.00', cached: '$1.50' }
  ],
  openai: [
    { name: 'gpt-5.5-pro', context: '1M', input: '$30.00', output: '$180.00', cached: null, badges: ['frontier'] },
    { name: 'gpt-5.5', context: '1M', input: '$5.00', output: '$30.00', cached: '$0.50' },
    { name: 'gpt-5.4', context: '1M', input: '$2.50', output: '$15.00', cached: '$0.25' },
    { name: 'gpt-5.4-mini', context: '1M', input: '$0.75', output: '$4.50', cached: '$0.08', badges: ['fast'] },
    { name: 'gpt-5.4-nano', context: '1M', input: '$0.20', output: '$1.25', cached: '$0.02', badges: ['fast'] }
  ],
  deepseek: [
    { name: 'deepseek-v4-pro', context: '1M', input: '$0.44', output: '$0.87', cached: '$0.01', badges: ['frontier'] },
    { name: 'deepseek-v4-flash', context: '1M', input: '$0.14', output: '$0.28', cached: '$0.003', badges: ['fast'] }
  ],
  mimo: [
    { name: 'mimo-v2.5-pro', context: '1M', input: '$0.20', output: '$2.00', cached: 'Free', badges: ['frontier'] },
    { name: 'mimo-v2.5', context: '1M', input: '$0.08', output: '$0.80', cached: 'Free' },
    { name: 'mimo-v2-pro', context: '256K', input: '$0.20', output: '$2.00', cached: 'Free' },
    { name: 'mimo-v2-omni', context: '256K', input: '$0.08', output: '$0.80', cached: 'Free', badges: ['vision'] },
    { name: 'mimo-v2-flash', context: '256K', input: '$0.01', output: '$0.30', cached: null, badges: ['fast'] },
    { name: 'mimo-v2.5-tts', context: '—', input: '—', output: '—', cached: null, badges: ['voice'] },
    { name: 'mimo-v2.5-tts-voiceclone', context: '—', input: '—', output: '—', cached: null, badges: ['voice'] },
    { name: 'mimo-v2.5-tts-voicedesign', context: '—', input: '—', output: '—', cached: null, badges: ['voice'] },
    { name: 'mimo-v2-tts', context: '—', input: '—', output: '—', cached: null, badges: ['voice'] }
  ],
  kimi: [
    { name: 'kimi-k2.6', context: '256K', input: '$0.95', output: '$4.00', cached: '$0.16', badges: ['frontier', 'vision', 'reasoning'] },
    { name: 'kimi-k2.5', context: '256K', input: '$0.60', output: '$3.00', cached: '$0.10', badges: ['vision', 'reasoning'] },
    { name: 'moonshot-v1-auto', context: '128K', input: '$1.00', output: '$3.00', cached: null },
    { name: 'moonshot-v1-128k-vision-preview', context: '128K', input: '$2.00', output: '$5.00', cached: null, badges: ['vision'] },
    { name: 'moonshot-v1-128k', context: '128K', input: '$2.00', output: '$5.00', cached: null },
    { name: 'moonshot-v1-32k-vision-preview', context: '32K', input: '$1.00', output: '$3.00', cached: null, badges: ['vision'] },
    { name: 'moonshot-v1-32k', context: '32K', input: '$1.00', output: '$3.00', cached: null },
    { name: 'moonshot-v1-8k-vision-preview', context: '8K', input: '$0.20', output: '$2.00', cached: null, badges: ['vision'] },
    { name: 'moonshot-v1-8k', context: '8K', input: '$0.20', output: '$2.00', cached: null }
  ]
}

export function CloudProviderPanel({ provider }: { provider: ProviderId }): React.JSX.Element {
  const { t } = useTranslation()
  const toast = useToast()
  const providerLabel = t(`settings.model.providers.${provider}`)
  const Logo = PROVIDER_LOGOS[provider]

  const [stored, setStored] = useState<ProviderListEntry | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [revealKey, setRevealKey] = useState(false)
  // Fresh result from the most recent successful Test. Takes precedence over
  // stored.models because the user just verified this list.
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('untested')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Set when the silent on-mount refresh finds the stored key has been
  // rejected by the provider (revoked, regenerated, expired). Cleared as
  // soon as the user starts typing a replacement.
  const [keyInvalid, setKeyInvalid] = useState(false)
  // Configured cloud providers (this and the other one) plus the current
  // priority order. We need both to decide whether to show the Priority
  // dropdown and how many position options to offer.
  const [allConfigured, setAllConfigured] = useState<ProviderId[]>([])
  const [priority, setPriority] = useState<ProviderId[]>([])

  type ReloadSnapshot = {
    match: ProviderListEntry | null
    configured: ProviderId[]
    order: ProviderId[]
  }

  // Pure read: callers are responsible for committing the snapshot to
  // state. Keeps setState out of effect bodies.
  const reloadStored = async (): Promise<ReloadSnapshot> => {
    const [entries, order] = await Promise.all([
      window.api.provider.list(),
      window.api.provider.getPriority()
    ])
    return {
      match: entries.find((e) => e.id === provider) ?? null,
      configured: entries.map((e) => e.id),
      order
    }
  }

  // The component remounts per provider tab (TabPanel returns null when
  // inactive), so we only need to read disk state on mount. We also kick
  // off a silent re-validation of the stored key — if the provider rejects
  // it (revoked, expired), the alert banner above tells the user to fix it.
  useEffect(() => {
    let cancelled = false
    void reloadStored().then((snap) => {
      if (cancelled) return
      setStored(snap.match)
      setAllConfigured(snap.configured)
      setPriority(snap.order)
      setModel(snap.match?.model ?? null)
      setApiKey(snap.match?.apiKey ?? '')
      if (!snap.match) return
      void window.api.provider.test({ id: provider }).then((result) => {
        if (cancelled) return
        if (!result.ok && result.kind === 'invalid_key') setKeyInvalid(true)
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider])

  // Background startup refresh updates the cached model list. If settings is
  // open at that moment, pick up the new catalogue without making the user
  // retest. We also reload on changes to the *other* configured provider so
  // the Priority dropdown appears/disappears as keys are added/removed.
  useEffect(() => {
    const off = window.api.provider.onUpdated((event) => {
      void reloadStored().then((snap) => {
        setAllConfigured(snap.configured)
        setPriority(snap.order)
        if (event.id !== provider) return
        setStored(snap.match)
        // Don't clobber an unsaved model selection — only sync if the user
        // hasn't picked anything yet.
        setModel((current) => current ?? snap.match?.model ?? null)
      })
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider])

  const trimmedKey = apiKey.trim()
  const models = useMemo<readonly string[]>(
    () => fetchedModels ?? stored?.models ?? [],
    [fetchedModels, stored]
  )
  const hasModels = models.length > 0
  // Pre-filled saved key isn't a "new" key — only the user typing
  // something different counts as an edit.
  const enteringNewKey = trimmedKey.length > 0 && trimmedKey !== stored?.apiKey

  const canTest = !saving && status !== 'testing' && trimmedKey.length > 0
  const canRemove = stored !== null && !saving

  const showKeyWorksToast = (): void => {
    toast.show({
      tone: 'success',
      message: t('settings.model.cloud.keyWorksToast', { provider: providerLabel })
    })
  }

  const onTest = async (): Promise<void> => {
    if (!canTest) return
    setStatus('testing')
    setError(null)
    const result: ProviderTestResult = await window.api.provider.test({
      id: provider,
      apiKey: enteringNewKey ? trimmedKey : undefined
    })
    if (!result.ok) {
      setStatus('invalid')
      setError(formatTestError(result, providerLabel, t))
      if (result.kind === 'invalid_key') setKeyInvalid(true)
      return
    }
    if (result.models.length === 0) {
      setStatus('invalid')
      setError(t('settings.model.cloud.errors.generic', { message: '' }))
      return
    }
    // Auto-save with the freshly fetched models. Keep the
    // prior selection if the new catalogue still has it; otherwise fall
    // back to the newest model.
    const modelToSave = model && result.models.includes(model) ? model : result.models[0]
    setSaving(true)
    try {
      await window.api.provider.save({
        id: provider,
        model: modelToSave,
        apiKey: trimmedKey,
        models: result.models
      })
      const snap = await reloadStored()
      setStored(snap.match)
      setAllConfigured(snap.configured)
      setPriority(snap.order)
      setModel(modelToSave)
      setApiKey(snap.match?.apiKey ?? '')
      setRevealKey(false)
      setFetchedModels(null)
      setStatus('untested')
      setKeyInvalid(false)
      showKeyWorksToast()
    } finally {
      setSaving(false)
    }
  }

  // Picking a different model on an already-saved provider auto-saves
  // silently — the dropdown already reflects the new selection.
  const onSelectModel = async (next: string): Promise<void> => {
    setModel(next)
    if (saving || !stored || enteringNewKey || next === stored.model) return
    setSaving(true)
    try {
      await window.api.provider.save({
        id: provider,
        model: next,
        models: stored.models
      })
      const snap = await reloadStored()
      setStored(snap.match)
      setAllConfigured(snap.configured)
      setPriority(snap.order)
    } finally {
      setSaving(false)
    }
  }

  const onRemove = async (): Promise<void> => {
    if (!canRemove) return
    setSaving(true)
    try {
      await window.api.provider.remove(provider)
      setStored(null)
      setApiKey('')
      setRevealKey(false)
      setFetchedModels(null)
      setModel(null)
      setStatus('untested')
      setError(null)
      setKeyInvalid(false)
      toast.show({
        tone: 'info',
        message: t('settings.model.cloud.removedToast', { provider: providerLabel })
      })
    } finally {
      setSaving(false)
    }
  }

  const modelOptions: readonly SelectOption<string>[] = useMemo(
    () =>
      models.map((m) => ({
        value: m,
        label: m,
        disabled: /tts|voiceclone|voicedesign/.test(m)
      })),
    [models]
  )

  // Priority is shown only when this provider has a saved key AND another
  // configured cloud provider exists — picking 1st-vs-2nd is meaningless
  // with a single provider.
  const showPriority = stored !== null && allConfigured.length >= 2
  const currentPosition = useMemo(() => {
    const idx = priority.indexOf(provider)
    return idx >= 0 ? idx + 1 : null
  }, [priority, provider])

  const priorityOptions: readonly SelectOption<string>[] = useMemo(
    () =>
      Array.from({ length: allConfigured.length }, (_, i) => ({
        value: String(i + 1),
        label: t(`settings.model.cloud.priorityOptions.${i + 1}`)
      })),
    [allConfigured.length, t]
  )

  // Moving this provider to a new position bumps whoever held that slot —
  // an in-place swap if there are two providers, or a rotate otherwise.
  // Built so adding a third cloud provider later still produces a coherent
  // order without revisiting this code.
  const onPriorityChange = async (next: string): Promise<void> => {
    const target = Number(next)
    if (saving || !Number.isFinite(target) || target < 1) return
    const current = priority.indexOf(provider)
    if (current < 0 || current + 1 === target) return
    const reordered = priority.filter((id) => id !== provider)
    const insertAt = Math.min(target - 1, reordered.length)
    reordered.splice(insertAt, 0, provider)
    setSaving(true)
    try {
      await window.api.provider.setPriority(reordered)
      setPriority(reordered)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Logo size={24} className="text-fg shrink-0" />
              <h1 className="text-fg text-2xl font-semibold tracking-tight">
                {t('settings.model.cloud.title', { provider: providerLabel })}
              </h1>
            </div>
            <a
              href={PROVIDER_URLS[provider]}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'text-muted hover:text-fg flex items-center gap-1.5 text-xs',
                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded-md px-1.5 py-1'
              )}
            >
              <span>{t('settings.model.cloud.platform')}</span>
              <LinkSquare02Icon size={13} className="shrink-0" />
            </a>
          </div>
          <p className="text-muted text-sm leading-relaxed">
            {t(`settings.model.providers.descriptions.${provider}`)}
          </p>
        </header>

        {keyInvalid && (
          <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-700 dark:bg-red-900/40 dark:text-red-100">
            <AlertCircleIcon size={16} className="mt-0.5 shrink-0" />
            <span>{t('settings.model.cloud.alerts.invalidKey', { provider: providerLabel })}</span>
          </div>
        )}

        <section className="bg-surface border-border flex flex-col gap-5 rounded-2xl border p-6">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`apikey-${provider}`} className="text-muted text-sm font-medium">
              {t('settings.model.cloud.apiKey')}
            </label>
            <div className="relative">
              <Input
                id={`apikey-${provider}`}
                type={revealKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  // Any edit invalidates the prior test result and the
                  // freshly fetched catalogue.
                  if (status !== 'untested') {
                    setStatus('untested')
                    setError(null)
                  }
                  if (fetchedModels) setFetchedModels(null)
                  if (keyInvalid) setKeyInvalid(false)
                }}
                placeholder={t('settings.model.cloud.apiKeyPlaceholder', {
                  provider: providerLabel
                })}
                autoComplete="off"
                spellCheck={false}
                className="pe-10"
              />
              <button
                type="button"
                onClick={() => setRevealKey((v) => !v)}
                aria-label={t(
                  revealKey ? 'settings.model.cloud.hideKey' : 'settings.model.cloud.showKey'
                )}
                className={cn(
                  'text-muted hover:text-fg absolute inset-e-2 top-1/2 -translate-y-1/2',
                  'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
                )}
              >
                {revealKey ? <ViewOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
          </div>

          <Select<string>
            label={t('settings.model.cloud.model')}
            value={model ?? ''}
            options={modelOptions}
            disabled={saving || !hasModels}
            placeholder={t('settings.model.cloud.modelHint')}
            onChange={(next) => void onSelectModel(next)}
          />

          <div className="flex flex-col gap-1.5">
            <Select<string>
              label={t('settings.model.cloud.priority')}
              value={currentPosition !== null ? String(currentPosition) : ''}
              options={priorityOptions}
              disabled={saving || !showPriority}
              placeholder={t('settings.model.cloud.priorityHint')}
              onChange={(next) => void onPriorityChange(next)}
            />
            <p className="text-muted text-xs leading-relaxed">
              {t('settings.model.cloud.priorityDescription')}
            </p>
          </div>

          <StatusLine status={status} error={error} hasModels={hasModels} />

          <div className="flex items-center justify-between gap-2">
            <Button size="md" onClick={() => void onTest()} disabled={!canTest}>
              {t('settings.model.cloud.test')}
            </Button>
            {stored?.apiKey && (
              <Button
                variant="ghost"
                size="md"
                onClick={() => void onRemove()}
                disabled={!canRemove}
                className="text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                {t('settings.model.cloud.remove')}
              </Button>
            )}
          </div>
        </section>

        <ModelBreakdown specs={MODEL_SPECS[provider]} />
      </div>
    </div>
  )
}

const BADGE_STYLES: Record<BadgeKind, string> = {
  frontier: 'bg-accent/15 text-accent',
  vision: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  reasoning: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  code: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  fast: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  voice: 'bg-pink-500/15 text-pink-600 dark:text-pink-400'
}

function ModelBreakdown({ specs }: { specs: ModelSpec[] }): React.JSX.Element {
  const { t } = useTranslation()
  const isFrontier = (m: ModelSpec): boolean => !!m.badges?.includes('frontier')
  return (
    <section className="bg-surface border-border flex flex-col gap-3 rounded-2xl border p-6">
      <h2 className="text-fg text-sm font-semibold">{t('settings.model.cloud.modelsBreakdown')}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted border-border border-b">
              <th className="pb-2 pe-3 text-start font-medium">{t('settings.model.cloud.breakdown.model')}</th>
              <th className="pb-2 px-3 text-end font-medium">{t('settings.model.cloud.breakdown.context')}</th>
              <th className="pb-2 px-3 text-end font-medium">{t('settings.model.cloud.breakdown.input')}</th>
              <th className="pb-2 px-3 text-end font-medium">{t('settings.model.cloud.breakdown.output')}</th>
              <th className="pb-2 ps-3 text-end font-medium">{t('settings.model.cloud.breakdown.cached')}</th>
            </tr>
          </thead>
          <tbody>
            {specs.map((m) => (
              <tr
                key={m.name}
                className={cn(
                  'border-border border-b last:border-b-0',
                  isFrontier(m) && 'bg-accent/5'
                )}
              >
                <td className="py-2 pe-3 text-start">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={cn('text-fg', isFrontier(m) && 'font-medium')}>
                      {m.name}
                    </span>
                    {m.badges?.map((badge) => (
                      <span
                        key={badge}
                        className={cn(
                          'inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                          BADGE_STYLES[badge]
                        )}
                      >
                        {t(`settings.model.cloud.breakdown.badges.${badge}`)}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="py-2 px-3 text-end text-muted tabular-nums">{m.context}</td>
                <td className="py-2 px-3 text-end text-muted tabular-nums">{m.input}</td>
                <td className="py-2 px-3 text-end text-muted tabular-nums">{m.output}</td>
                <td className="py-2 ps-3 text-end tabular-nums">
                  {m.cached === null ? (
                    <span className="text-muted/50">{'—'}</span>
                  ) : m.cached === 'Free' ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      {t('settings.model.cloud.breakdown.free')}
                    </span>
                  ) : (
                    <span className="text-muted">{m.cached}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted/70 text-[10px] leading-relaxed">
        {t('settings.model.cloud.breakdown.disclaimer')}
      </p>
    </section>
  )
}

function StatusLine({
  status,
  error,
  hasModels
}: {
  status: Status
  error: string | null
  hasModels: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const wrap = 'flex items-center gap-2 text-xs'
  if (status === 'testing') {
    return (
      <p className={cn(wrap, 'text-muted animate-pulse')}>
        <Loading02Icon size={14} className="shrink-0 animate-spin" />
        <span>{t('settings.model.cloud.status.testing')}</span>
      </p>
    )
  }
  if (status === 'invalid') {
    return (
      <p className={cn(wrap, 'items-start text-red-700 dark:text-red-400')}>
        <AlertCircleIcon size={14} className="mt-0.5 shrink-0" />
        <span>{error ?? t('settings.model.cloud.status.invalid')}</span>
      </p>
    )
  }
  if (hasModels) {
    return (
      <p className={cn(wrap, 'text-emerald-700 dark:text-emerald-400')}>
        <CheckmarkCircle02Icon size={14} className="shrink-0" />
        <span>{t('settings.model.cloud.status.ready')}</span>
      </p>
    )
  }
  return (
    <p className={cn(wrap, 'text-muted')}>
      <AlertCircleIcon size={14} className="shrink-0" />
      <span>{t('settings.model.cloud.status.untested')}</span>
    </p>
  )
}

function formatTestError(
  result: Extract<ProviderTestResult, { ok: false }>,
  providerLabel: string,
  t: (k: string, v?: Record<string, unknown>) => string
): string {
  switch (result.kind) {
    case 'invalid_key':
      return t('settings.model.cloud.errors.invalidKey')
    case 'rate_limited':
      return t('settings.model.cloud.errors.rateLimited')
    case 'invalid_model':
      return t('settings.model.cloud.errors.invalidModel')
    case 'network':
      return t('settings.model.cloud.errors.network', { provider: providerLabel })
    default:
      return t('settings.model.cloud.errors.generic', {
        message: result.message ?? ''
      })
  }
}
