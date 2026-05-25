import {
  AnthropicLogo,
  DeepSeekLogo,
  OllamaLogo,
  OpenAILogo
} from '@components/core/ProviderLogos'
import { cn } from '@lib/utils/cn'
import { CloudIcon } from 'hugeicons-react'
import type { IconType } from 'react-icons'

const LOGOS: Record<string, IconType | React.ComponentType<{ size?: number; className?: string }>> = {
  anthropic: AnthropicLogo,
  openai: OpenAILogo,
  deepseek: DeepSeekLogo,
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
