import {
  AnthropicLogo,
  DeepSeekLogo,
  KimiLogo,
  MiniMaxLogo,
  MimoLogo,
  OllamaLogo,
  OpenAILogo,
  OpenRouterLogo,
  QwenLogo,
  StepfunLogo,
  XAILogo,
  ZaiLogo
} from '@components/core/ProviderLogos'
import { cn } from '@lib/utils/cn'
import { CloudIcon } from 'hugeicons-react'
import type { IconType } from 'react-icons'

// Every supported provider maps to its own logomark; the CloudIcon fallback is
// only for genuinely unknown providers. Keep this in sync with the provider
// list so the chip never shows the generic cloud for a supported provider.
const LOGOS: Record<string, IconType | React.ComponentType<{ size?: number; className?: string }>> =
  {
    anthropic: AnthropicLogo,
    openai: OpenAILogo,
    openrouter: OpenRouterLogo,
    deepseek: DeepSeekLogo,
    mimo: MimoLogo,
    kimi: KimiLogo,
    minimax: MiniMaxLogo,
    xai: XAILogo,
    qwen: QwenLogo,
    stepfun: StepfunLogo,
    zai: ZaiLogo,
    local: OllamaLogo,
    ollama: OllamaLogo
  }

export function ActiveModelChip({
  provider,
  model
}: {
  provider: string
  model: string
}): React.JSX.Element {
  const Logo = LOGOS[provider] ?? CloudIcon
  return (
    <div
      className={cn(
        'border-border/60 text-muted bg-surface self-start',
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs'
      )}
    >
      <Logo size={11} aria-hidden />
      <span>{model}</span>
    </div>
  )
}
