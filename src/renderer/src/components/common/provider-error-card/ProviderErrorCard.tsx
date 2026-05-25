import {
  AnthropicLogo,
  DeepSeekLogo,
  OllamaLogo,
  OpenAILogo
} from '@components/core/ProviderLogos'
import { cn } from '@lib/utils/cn'
import { CloudIcon, Refresh01Icon } from 'hugeicons-react'
import { useTranslation } from 'react-i18next'
import type { IconType } from 'react-icons'

type Logo = 'anthropic' | 'openai' | 'deepseek' | 'ollama'

const LOGO: Record<Logo, IconType | React.ComponentType<{ size?: number; className?: string }>> = {
  anthropic: AnthropicLogo,
  openai: OpenAILogo,
  deepseek: DeepSeekLogo,
  ollama: OllamaLogo
}

export type NoProviderAvailablePayload = {
  provider: string
  providerLogo: string
  statusCode: number | null
  errorReason: string
  retriesAttempted: number
  totalDurationMs: number
}

/**
 * Shown only when cloud cascades exhaust AND no local model is
 * configured — the genuine "you have no LLM available" state. Every
 * other failure path now lets the local model speak for itself, so
 * this is the lone surface that's still rendered as code-written
 * structural UI.
 */
export function ProviderErrorCard({
  payload,
  onRetry
}: {
  payload: NoProviderAvailablePayload
  onRetry?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const Logo = LOGO[payload.providerLogo as Logo] ?? CloudIcon

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'border-red-300 bg-red-50 text-red-900',
        'dark:border-red-700 dark:bg-red-900/40 dark:text-red-100',
        'w-full max-w-[85%] self-start rounded-2xl border px-4 py-3 text-sm'
      )}
    >
      <div className="flex items-center gap-3">
        <Logo size={18} className="shrink-0" aria-hidden />
        <p className="flex-1 text-xs">
          <span className="font-medium">{t('errors.provider.noProviderTitle')}</span>
          {' — '}
          <span className="opacity-80">{t('errors.provider.noProviderDescription')}</span>
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium',
              'border-red-300 hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900/60',
              'cursor-pointer border bg-transparent',
              'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
            )}
          >
            <Refresh01Icon size={12} />
            <span>{t('chat.providerError.retry')}</span>
          </button>
        )}
      </div>
    </div>
  )
}
