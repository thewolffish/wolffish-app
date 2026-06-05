import {
  AnthropicLogo,
  DeepSeekLogo,
  KimiLogo,
  MiniMaxLogo,
  MimoLogo,
  OllamaLogo,
  OpenAILogo,
  XAILogo,
  QwenLogo,
  StepfunLogo
} from '@components/core/ProviderLogos'
import { cn } from '@lib/utils/cn'
import { CloudIcon } from 'hugeicons-react'
import { useTranslation } from 'react-i18next'
import type { IconType } from 'react-icons'

type Logo = 'anthropic' | 'openai' | 'deepseek' | 'mimo' | 'kimi' | 'minimax' | 'xai' | 'qwen' | 'stepfun' | 'ollama'

const LOGO: Record<Logo, IconType | React.ComponentType<{ size?: number; className?: string }>> = {
  anthropic: AnthropicLogo,
  openai: OpenAILogo,
  deepseek: DeepSeekLogo,
  mimo: MimoLogo,
  kimi: KimiLogo,
  minimax: MiniMaxLogo,
  xai: XAILogo,
  qwen: QwenLogo,
  stepfun: StepfunLogo,
  ollama: OllamaLogo
}

export type NoProviderAvailablePayload = {
  provider: string
  providerLogo: string
  statusCode: number | null
  errorReason: string
  errorDetail: string | null
  retriesAttempted: number
  totalDurationMs: number
}

function descriptionKeyFor(errorReason: string, statusCode: number | null): string {
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    errorReason === 'authentication failed' ||
    errorReason === 'forbidden'
  ) {
    return 'errors.provider.invalidKey'
  }
  if (statusCode === 404 || errorReason === 'model not found') {
    return 'errors.provider.modelNotFound'
  }
  if (statusCode === 429 || errorReason === 'rate-limited') {
    return 'errors.provider.rateLimited'
  }
  if (statusCode === 400 || errorReason === 'bad request') {
    return 'errors.provider.badRequest'
  }
  if (errorReason === 'offline') {
    return 'errors.provider.offline'
  }
  if (statusCode !== null && statusCode >= 500) {
    return 'errors.provider.serverError'
  }
  return 'errors.provider.noProviderDescription'
}

function titleKeyFor(errorReason: string, statusCode: number | null): string {
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    errorReason === 'authentication failed' ||
    errorReason === 'forbidden'
  ) {
    return 'errors.provider.invalidKeyTitle'
  }
  if (statusCode === 400 || errorReason === 'bad request') {
    return 'errors.provider.badRequestTitle'
  }
  return 'errors.provider.noProviderTitle'
}

/**
 * Shown only when cloud cascades exhaust AND no local model is
 * configured — the genuine "you have no LLM available" state. Every
 * other failure path now lets the local model speak for itself, so
 * this is the lone surface that's still rendered as code-written
 * structural UI.
 */
export function ProviderErrorCard({
  payload
}: {
  payload: NoProviderAvailablePayload
}): React.JSX.Element {
  const { t } = useTranslation()
  const Logo = LOGO[payload.providerLogo as Logo] ?? CloudIcon
  const title = t(titleKeyFor(payload.errorReason, payload.statusCode))
  const description = t(descriptionKeyFor(payload.errorReason, payload.statusCode))

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
        <div className="flex-1 text-xs">
          <p>
            <span className="font-medium">{title}</span>
            {' — '}
            <span className="opacity-80">{description}</span>
          </p>
          {payload.errorDetail && (
            <p className="mt-1 opacity-60 font-mono text-[11px] leading-tight">
              {payload.errorDetail}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
