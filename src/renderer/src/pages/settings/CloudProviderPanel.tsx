import { Button } from '@components/core/Button'
import { Input } from '@components/core/Input'
import {
  AnthropicLogo,
  DeepSeekLogo,
  KimiLogo,
  MiniMaxLogo,
  MimoLogo,
  OpenAILogo,
  OpenRouterLogo,
  QwenLogo,
  StepfunLogo,
  XAILogo
} from '@components/core/ProviderLogos'
import { Select, type SelectOption } from '@components/core/Select'
import { useToast } from '@components/core/toast/useToast'
import { cn } from '@lib/utils/cn'
import type { CloudProviderConfig, ProviderListEntry, ProviderTestResult } from '@preload/index'
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  EyeIcon,
  InformationCircleIcon,
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
  openrouter: OpenRouterLogo,
  deepseek: DeepSeekLogo,
  mimo: MimoLogo,
  kimi: KimiLogo,
  minimax: MiniMaxLogo,
  xai: XAILogo,
  qwen: QwenLogo,
  stepfun: StepfunLogo
}

const PROVIDER_URLS: Record<ProviderId, string> = {
  anthropic: 'https://console.anthropic.com',
  openai: 'https://platform.openai.com',
  openrouter: 'https://openrouter.ai',
  deepseek: 'https://platform.deepseek.com',
  mimo: 'https://platform.xiaomimimo.com',
  kimi: 'https://platform.moonshot.ai',
  minimax: 'https://platform.minimax.io',
  xai: 'https://console.x.ai',
  qwen: 'https://www.qwencloud.com',
  stepfun: 'https://platform.stepfun.ai'
}

type BadgeKind = 'frontier' | 'vision' | 'reasoning' | 'code' | 'fast' | 'voice'

type ModelSpec = {
  name: string
  context: string
  input: string
  output: string
  cached: string | null
  badges?: BadgeKind[]
  /** Thinking mode keys available for this model (translation keys under chat.thinkingMode). */
  modes?: string[]
}

const MODEL_SPECS: Record<ProviderId, ModelSpec[]> = {
  anthropic: [
    {
      name: 'claude-fable-5',
      context: '1M',
      input: '$10.00',
      output: '$50.00',
      cached: '$1.00',
      badges: ['frontier', 'reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'claude-opus-4-8',
      context: '1M',
      input: '$5.00',
      output: '$25.00',
      cached: '$0.50',
      badges: ['reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'claude-opus-4-7',
      context: '1M',
      input: '$5.00',
      output: '$25.00',
      cached: '$0.50',
      badges: ['reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'claude-sonnet-4-6',
      context: '1M',
      input: '$3.00',
      output: '$15.00',
      cached: '$0.30',
      badges: ['reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'claude-opus-4-6',
      context: '1M',
      input: '$5.00',
      output: '$25.00',
      cached: '$0.50',
      badges: ['reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'claude-opus-4-5-20251101',
      context: '200K',
      input: '$5.00',
      output: '$25.00',
      cached: '$0.50',
      badges: ['reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'claude-sonnet-4-5-20250929',
      context: '200K',
      input: '$3.00',
      output: '$15.00',
      cached: '$0.30',
      badges: ['reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'claude-haiku-4-5-20251001',
      context: '200K',
      input: '$1.00',
      output: '$5.00',
      cached: '$0.10',
      badges: ['fast', 'reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'claude-opus-4-1-20250805',
      context: '200K',
      input: '$15.00',
      output: '$75.00',
      cached: '$1.50',
      badges: ['reasoning'],
      modes: ['none', 'high']
    }
  ],
  openai: [
    {
      name: 'gpt-5.5-pro',
      context: '1M',
      input: '$30.00',
      output: '$180.00',
      cached: null,
      badges: ['frontier', 'reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'gpt-5.5',
      context: '1M',
      input: '$5.00',
      output: '$30.00',
      cached: '$0.50',
      badges: ['reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'gpt-5.4',
      context: '1M',
      input: '$2.50',
      output: '$15.00',
      cached: '$0.25',
      badges: ['reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'gpt-5.4-mini',
      context: '1M',
      input: '$0.75',
      output: '$4.50',
      cached: '$0.08',
      badges: ['fast', 'reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'gpt-5.4-nano',
      context: '1M',
      input: '$0.20',
      output: '$1.25',
      cached: '$0.02',
      badges: ['fast', 'reasoning'],
      modes: ['none', 'high', 'max']
    }
  ],
  deepseek: [
    {
      name: 'deepseek-v4-pro',
      context: '1M',
      input: '$0.44',
      output: '$0.87',
      cached: '$0.01',
      badges: ['frontier', 'reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'deepseek-v4-flash',
      context: '1M',
      input: '$0.14',
      output: '$0.28',
      cached: '$0.003',
      badges: ['fast', 'reasoning'],
      modes: ['none', 'high', 'max']
    }
  ],
  mimo: [
    {
      name: 'mimo-v2.5-pro',
      context: '1M',
      input: '$0.20',
      output: '$2.00',
      cached: 'Free',
      badges: ['frontier', 'reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'mimo-v2.5',
      context: '1M',
      input: '$0.08',
      output: '$0.80',
      cached: 'Free',
      badges: ['reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'mimo-v2-pro',
      context: '256K',
      input: '$0.20',
      output: '$2.00',
      cached: 'Free',
      badges: ['reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'mimo-v2-omni',
      context: '256K',
      input: '$0.08',
      output: '$0.80',
      cached: 'Free',
      badges: ['vision', 'reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'mimo-v2-flash',
      context: '256K',
      input: '$0.01',
      output: '$0.30',
      cached: null,
      badges: ['fast', 'reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'mimo-v2.5-tts',
      context: '—',
      input: '—',
      output: '—',
      cached: null,
      badges: ['voice']
    },
    {
      name: 'mimo-v2.5-tts-voiceclone',
      context: '—',
      input: '—',
      output: '—',
      cached: null,
      badges: ['voice']
    },
    {
      name: 'mimo-v2.5-tts-voicedesign',
      context: '—',
      input: '—',
      output: '—',
      cached: null,
      badges: ['voice']
    },
    { name: 'mimo-v2-tts', context: '—', input: '—', output: '—', cached: null, badges: ['voice'] }
  ],
  kimi: [
    {
      name: 'kimi-k2.6',
      context: '256K',
      input: '$0.95',
      output: '$4.00',
      cached: '$0.16',
      badges: ['frontier', 'vision', 'reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'kimi-k2.5',
      context: '256K',
      input: '$0.60',
      output: '$3.00',
      cached: '$0.10',
      badges: ['vision', 'reasoning'],
      modes: ['none', 'high']
    },
    { name: 'moonshot-v1-auto', context: '128K', input: '$1.00', output: '$3.00', cached: null },
    {
      name: 'moonshot-v1-128k-vision-preview',
      context: '128K',
      input: '$2.00',
      output: '$5.00',
      cached: null,
      badges: ['vision']
    },
    { name: 'moonshot-v1-128k', context: '128K', input: '$2.00', output: '$5.00', cached: null },
    {
      name: 'moonshot-v1-32k-vision-preview',
      context: '32K',
      input: '$1.00',
      output: '$3.00',
      cached: null,
      badges: ['vision']
    },
    { name: 'moonshot-v1-32k', context: '32K', input: '$1.00', output: '$3.00', cached: null },
    {
      name: 'moonshot-v1-8k-vision-preview',
      context: '8K',
      input: '$0.20',
      output: '$2.00',
      cached: null,
      badges: ['vision']
    },
    { name: 'moonshot-v1-8k', context: '8K', input: '$0.20', output: '$2.00', cached: null }
  ],
  minimax: [
    {
      name: 'MiniMax-M3',
      context: '1M',
      input: '$0.30',
      output: '$1.20',
      cached: '$0.06',
      badges: ['frontier', 'reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'MiniMax-M2.7',
      context: '200K',
      input: '$0.30',
      output: '$1.20',
      cached: '$0.06',
      badges: ['reasoning']
    },
    {
      name: 'MiniMax-M2.7-highspeed',
      context: '200K',
      input: '$0.60',
      output: '$2.40',
      cached: '$0.06',
      badges: ['fast']
    },
    {
      name: 'MiniMax-M2.5',
      context: '200K',
      input: '$0.30',
      output: '$1.20',
      cached: '$0.03',
      badges: ['code']
    },
    {
      name: 'MiniMax-M2.5-highspeed',
      context: '200K',
      input: '$0.60',
      output: '$2.40',
      cached: '$0.03',
      badges: ['code', 'fast']
    },
    {
      name: 'MiniMax-M2.1',
      context: '200K',
      input: '$0.30',
      output: '$1.20',
      cached: '$0.03',
      badges: ['reasoning']
    },
    {
      name: 'MiniMax-M2.1-highspeed',
      context: '200K',
      input: '$0.60',
      output: '$2.40',
      cached: '$0.03',
      badges: ['fast']
    },
    { name: 'MiniMax-M2', context: '200K', input: '$0.30', output: '$1.20', cached: '$0.03' }
  ],
  xai: [
    {
      name: 'grok-4.3',
      context: '1M',
      input: '$1.25',
      output: '$2.50',
      cached: null,
      badges: ['frontier', 'vision', 'reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'grok-build-0.1',
      context: '256K',
      input: '$1.00',
      output: '$2.00',
      cached: null,
      badges: ['code', 'reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'grok-4',
      context: '256K',
      input: '$3.00',
      output: '$15.00',
      cached: null,
      badges: ['reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'grok-3',
      context: '131K',
      input: '$2.00',
      output: '$10.00',
      cached: null,
      badges: ['reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'grok-3-mini',
      context: '131K',
      input: '$0.30',
      output: '$0.50',
      cached: null,
      badges: ['fast', 'reasoning'],
      modes: ['none', 'high']
    }
  ],
  qwen: [
    {
      name: 'qwen3.7-max',
      context: '1M',
      input: '$2.50',
      output: '$7.50',
      cached: '$0.25',
      badges: ['frontier', 'reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'qwen3.7-plus',
      context: '1M',
      input: '$0.40',
      output: '$1.60',
      cached: '$0.064',
      badges: ['reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'qwen3.6-plus',
      context: '1M',
      input: '$0.40',
      output: '$1.60',
      cached: '$0.04',
      badges: ['reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'qwen3.6-flash',
      context: '1M',
      input: '$0.25',
      output: '$1.50',
      cached: '$0.025',
      badges: ['fast', 'reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'qwen3.5-plus',
      context: '1M',
      input: '$0.40',
      output: '$1.60',
      cached: '$0.04',
      badges: ['reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'qwen3.5-flash',
      context: '1M',
      input: '$0.06',
      output: '$0.24',
      cached: '$0.006',
      badges: ['fast', 'reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'qwen3-max',
      context: '131K',
      input: '$1.60',
      output: '$6.40',
      cached: '$0.40',
      badges: ['reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'qwen3-coder-plus',
      context: '131K',
      input: '$0.40',
      output: '$1.60',
      cached: '$0.04',
      badges: ['code', 'reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'qwen-max',
      context: '131K',
      input: '$1.60',
      output: '$6.40',
      cached: '$0.16',
      badges: ['reasoning']
    },
    {
      name: 'qwen-plus',
      context: '131K',
      input: '$0.40',
      output: '$1.60',
      cached: '$0.04',
      badges: ['fast']
    }
  ],
  stepfun: [
    {
      name: 'step-3.7-flash',
      context: '128K',
      input: '$0.83',
      output: '$6.94',
      cached: null,
      badges: ['frontier', 'reasoning']
    },
    {
      name: 'step-3.5-flash',
      context: '128K',
      input: '$0.83',
      output: '$6.94',
      cached: null,
      badges: ['fast', 'reasoning']
    }
  ],
  openrouter: [
    // ── Anthropic ──
    {
      name: 'anthropic/claude-sonnet-4',
      context: '200K',
      input: '$3.00',
      output: '$15.00',
      cached: '$0.30',
      badges: ['frontier', 'reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'anthropic/claude-opus-4',
      context: '200K',
      input: '$15.00',
      output: '$75.00',
      cached: '$1.50',
      badges: ['frontier', 'reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'anthropic/claude-3.5-sonnet',
      context: '200K',
      input: '$3.00',
      output: '$15.00',
      cached: '$0.30',
      badges: ['reasoning']
    },
    {
      name: 'anthropic/claude-3.5-haiku',
      context: '200K',
      input: '$0.80',
      output: '$4.00',
      cached: '$0.08',
      badges: ['fast']
    },
    {
      name: 'anthropic/claude-3-opus',
      context: '200K',
      input: '$15.00',
      output: '$75.00',
      cached: '$1.50',
      badges: ['reasoning']
    },
    // ── OpenAI ──
    {
      name: 'openai/gpt-4.1',
      context: '1M',
      input: '$2.00',
      output: '$8.00',
      cached: '$0.50',
      badges: ['reasoning']
    },
    {
      name: 'openai/gpt-4.1-mini',
      context: '1M',
      input: '$0.40',
      output: '$1.60',
      cached: '$0.10',
      badges: ['fast']
    },
    {
      name: 'openai/gpt-4.1-nano',
      context: '1M',
      input: '$0.10',
      output: '$0.40',
      cached: '$0.025',
      badges: ['fast']
    },
    {
      name: 'openai/o4-mini',
      context: '200K',
      input: '$1.10',
      output: '$4.40',
      cached: '$0.275',
      badges: ['reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'openai/o3-mini',
      context: '200K',
      input: '$1.10',
      output: '$4.40',
      cached: '$0.55',
      badges: ['reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'openai/gpt-4o',
      context: '128K',
      input: '$2.50',
      output: '$10.00',
      cached: '$1.25',
      badges: ['vision']
    },
    {
      name: 'openai/gpt-4o-mini',
      context: '128K',
      input: '$0.15',
      output: '$0.60',
      cached: '$0.075',
      badges: ['fast', 'vision']
    },
    {
      name: 'openai/chatgpt-4o-latest',
      context: '128K',
      input: '$5.00',
      output: '$15.00',
      cached: null,
      badges: ['vision']
    },
    // ── Google ──
    {
      name: 'google/gemini-2.5-pro-preview',
      context: '1M',
      input: '$1.25',
      output: '$10.00',
      cached: '$0.3125',
      badges: ['frontier', 'reasoning'],
      modes: ['none', 'high', 'max']
    },
    {
      name: 'google/gemini-2.5-flash-preview',
      context: '1M',
      input: '$0.15',
      output: '$0.60',
      cached: '$0.0375',
      badges: ['fast', 'reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'google/gemini-2.0-flash-001',
      context: '1M',
      input: '$0.10',
      output: '$0.40',
      cached: '$0.025',
      badges: ['fast', 'vision']
    },
    {
      name: 'google/gemini-2.0-flash-lite-001',
      context: '1M',
      input: '$0.075',
      output: '$0.30',
      cached: null,
      badges: ['fast']
    },
    {
      name: 'google/gemini-pro-1.5',
      context: '2M',
      input: '$1.25',
      output: '$5.00',
      cached: '$0.3125',
      badges: ['vision']
    },
    {
      name: 'google/gemini-flash-1.5',
      context: '1M',
      input: '$0.075',
      output: '$0.30',
      cached: '$0.01875',
      badges: ['fast', 'vision']
    },
    // ── DeepSeek ──
    {
      name: 'deepseek/deepseek-r1-0528',
      context: '128K',
      input: '$0.55',
      output: '$2.19',
      cached: '$0.14',
      badges: ['frontier', 'reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'deepseek/deepseek-r1',
      context: '128K',
      input: '$0.55',
      output: '$2.19',
      cached: '$0.14',
      badges: ['reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'deepseek/deepseek-chat-v3-0324',
      context: '128K',
      input: '$0.27',
      output: '$1.10',
      cached: '$0.07',
      badges: ['reasoning']
    },
    {
      name: 'deepseek/deepseek-chat',
      context: '64K',
      input: '$0.14',
      output: '$0.28',
      cached: '$0.014',
      badges: ['fast']
    },
    // ── Meta Llama ──
    {
      name: 'meta-llama/llama-4-maverick',
      context: '1M',
      input: '$0.20',
      output: '$0.85',
      cached: null,
      badges: ['vision']
    },
    {
      name: 'meta-llama/llama-4-scout',
      context: '512K',
      input: '$0.11',
      output: '$0.34',
      cached: null,
      badges: ['fast', 'vision']
    },
    {
      name: 'meta-llama/llama-3.3-70b-instruct',
      context: '128K',
      input: '$0.12',
      output: '$0.30',
      cached: null,
      badges: ['reasoning']
    },
    {
      name: 'meta-llama/llama-3.1-405b-instruct',
      context: '128K',
      input: '$0.90',
      output: '$0.90',
      cached: null,
      badges: ['reasoning']
    },
    {
      name: 'meta-llama/llama-3.1-70b-instruct',
      context: '128K',
      input: '$0.12',
      output: '$0.30',
      cached: null
    },
    {
      name: 'meta-llama/llama-3.1-8b-instruct',
      context: '128K',
      input: '$0.02',
      output: '$0.05',
      cached: null,
      badges: ['fast']
    },
    // ── Mistral ──
    {
      name: 'mistralai/mistral-large-2411',
      context: '128K',
      input: '$2.00',
      output: '$6.00',
      cached: null,
      badges: ['reasoning']
    },
    {
      name: 'mistralai/mistral-medium-3',
      context: '128K',
      input: '$0.40',
      output: '$2.00',
      cached: null
    },
    {
      name: 'mistralai/mistral-small-3.1-24b-instruct',
      context: '128K',
      input: '$0.10',
      output: '$0.30',
      cached: null,
      badges: ['fast']
    },
    {
      name: 'mistralai/codestral-2501',
      context: '256K',
      input: '$0.30',
      output: '$0.90',
      cached: null,
      badges: ['code']
    },
    {
      name: 'mistralai/ministral-8b',
      context: '128K',
      input: '$0.10',
      output: '$0.10',
      cached: null,
      badges: ['fast']
    },
    // ── Qwen ──
    {
      name: 'qwen/qwq-32b',
      context: '128K',
      input: '$0.12',
      output: '$0.18',
      cached: null,
      badges: ['reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'qwen/qwen-2.5-72b-instruct',
      context: '128K',
      input: '$0.18',
      output: '$0.18',
      cached: null,
      badges: ['reasoning']
    },
    {
      name: 'qwen/qwen-2.5-coder-32b-instruct',
      context: '32K',
      input: '$0.07',
      output: '$0.16',
      cached: null,
      badges: ['code']
    },
    {
      name: 'qwen/qwen-2.5-vl-72b-instruct',
      context: '128K',
      input: '$0.18',
      output: '$0.18',
      cached: null,
      badges: ['vision']
    },
    // ── xAI ──
    {
      name: 'x-ai/grok-4.3',
      context: '256K',
      input: '$2.00',
      output: '$10.00',
      cached: null,
      badges: ['frontier', 'reasoning'],
      modes: ['none', 'high']
    },
    {
      name: 'x-ai/grok-3-beta',
      context: '131K',
      input: '$3.00',
      output: '$15.00',
      cached: null,
      badges: ['reasoning'],
      modes: ['none', 'high']
    },
    { name: 'x-ai/grok-2-1212', context: '131K', input: '$2.00', output: '$10.00', cached: null },
    // ── Cohere ──
    {
      name: 'cohere/command-r-plus-08-2024',
      context: '128K',
      input: '$2.50',
      output: '$10.00',
      cached: null,
      badges: ['reasoning']
    },
    {
      name: 'cohere/command-r-08-2024',
      context: '128K',
      input: '$0.15',
      output: '$0.60',
      cached: null,
      badges: ['fast']
    },
    // ── Microsoft ──
    {
      name: 'microsoft/phi-4',
      context: '16K',
      input: '$0.07',
      output: '$0.14',
      cached: null,
      badges: ['fast']
    },
    {
      name: 'microsoft/phi-4-multimodal-instruct',
      context: '128K',
      input: '$0.07',
      output: '$0.14',
      cached: null,
      badges: ['fast', 'vision']
    },
    // ── Perplexity ──
    {
      name: 'perplexity/sonar-pro',
      context: '200K',
      input: '$3.00',
      output: '$15.00',
      cached: null,
      badges: ['reasoning']
    },
    {
      name: 'perplexity/sonar',
      context: '128K',
      input: '$1.00',
      output: '$1.00',
      cached: null,
      badges: ['fast']
    },
    // ── Amazon ──
    {
      name: 'amazon/nova-pro-v1',
      context: '300K',
      input: '$0.80',
      output: '$3.20',
      cached: null,
      badges: ['vision']
    },
    {
      name: 'amazon/nova-lite-v1',
      context: '300K',
      input: '$0.06',
      output: '$0.24',
      cached: null,
      badges: ['fast', 'vision']
    },
    // ── NousResearch ──
    {
      name: 'nousresearch/hermes-3-llama-3.1-405b',
      context: '128K',
      input: '$0.90',
      output: '$0.90',
      cached: null,
      badges: ['reasoning']
    }
  ]
}

// ── OpenRouter model sorting ──────────────────────────────────────────
// Tier 0: US frontier labs, Tier 1: Chinese labs, Tier 2: everything else.
// Tier 0: providers wolffish supports directly (sorted first)
// Tier 1: other US frontier labs
// Tier 2: other Chinese labs
// Tier 3: European / rest (fallback for unknown slugs)
const OPENROUTER_PROVIDER_TIER: Record<string, number> = {
  anthropic: 0,
  openai: 0,
  deepseek: 0,
  qwen: 0,
  xiaomi: 0,
  moonshotai: 0,
  minimax: 0,
  stepfun: 0,
  google: 1,
  'x-ai': 1,
  'meta-llama': 1,
  perplexity: 1,
  amazon: 1,
  mistralai: 2,
  cohere: 2,
  microsoft: 2,
  nousresearch: 2
}

function openRouterProviderSlug(modelId: string): string {
  const slash = modelId.indexOf('/')
  return slash > 0 ? modelId.slice(0, slash) : ''
}

function sortOpenRouterModels<T extends { name: string; badges?: BadgeKind[] }>(items: T[]): T[] {
  return items.slice().sort((a, b) => {
    const slugA = openRouterProviderSlug(a.name)
    const slugB = openRouterProviderSlug(b.name)
    const tierA = OPENROUTER_PROVIDER_TIER[slugA] ?? 3
    const tierB = OPENROUTER_PROVIDER_TIER[slugB] ?? 3
    if (tierA !== tierB) return tierA - tierB
    if (slugA !== slugB) return slugA.localeCompare(slugB)
    const fA = a.badges?.includes('frontier') ? 0 : 1
    const fB = b.badges?.includes('frontier') ? 0 : 1
    return fA - fB
  })
}

function sortOpenRouterModelIds(ids: readonly string[]): string[] {
  return ids.slice().sort((a, b) => {
    const disA = isModelDisabled(a) ? 1 : 0
    const disB = isModelDisabled(b) ? 1 : 0
    if (disA !== disB) return disA - disB
    const slugA = openRouterProviderSlug(a)
    const slugB = openRouterProviderSlug(b)
    const tierA = OPENROUTER_PROVIDER_TIER[slugA] ?? 3
    const tierB = OPENROUTER_PROVIDER_TIER[slugB] ?? 3
    if (tierA !== tierB) return tierA - tierB
    if (slugA !== slugB) return slugA.localeCompare(slugB)
    return a.localeCompare(b)
  })
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
  const models = useMemo<readonly string[]>(() => {
    const raw = fetchedModels ?? stored?.models ?? []
    return provider === 'openrouter' ? sortOpenRouterModelIds(raw) : raw
  }, [fetchedModels, stored, provider])
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
    const firstSelectable =
      result.models.find((m) => !isModelDisabled(m) && !isDateSnapshot(m)) ??
      result.models.find((m) => !isModelDisabled(m)) ??
      result.models[0]
    const modelToSave = model && result.models.includes(model) ? model : firstSelectable
    setSaving(true)
    try {
      await window.api.provider.save({
        id: provider,
        model: modelToSave,
        apiKey: trimmedKey,
        models: result.models,
        reasoningModels: result.reasoningModels
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
        label: isModelDisabled(m) ? `${m} — ${disabledReason(m)}` : m,
        disabled: isModelDisabled(m)
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
            searchable
            searchPlaceholder={t('settings.model.cloud.searchModels')}
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

        <ModelBreakdown
          specs={
            provider === 'openrouter'
              ? sortOpenRouterModels(MODEL_SPECS[provider])
              : MODEL_SPECS[provider]
          }
          provider={provider}
        />
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

function ModelBreakdown({
  specs,
  provider
}: {
  specs: ModelSpec[]
  provider: ProviderId
}): React.JSX.Element {
  const { t } = useTranslation()
  const isFrontier = (m: ModelSpec): boolean => !!m.badges?.includes('frontier')
  return (
    <section className="bg-surface border-border flex flex-col gap-3 rounded-2xl border p-6">
      <h2 className="text-fg text-sm font-semibold">{t('settings.model.cloud.modelsBreakdown')}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted border-border border-b">
              <th className="whitespace-nowrap pb-2 pe-3 text-start font-medium">
                {t('settings.model.cloud.breakdown.model')}
              </th>
              <th className="whitespace-nowrap pb-2 px-3 text-start font-medium">
                {t('settings.model.cloud.breakdown.modes')}
              </th>
              <th className="whitespace-nowrap pb-2 px-3 text-end font-medium">
                {t('settings.model.cloud.breakdown.context')}
              </th>
              <th className="whitespace-nowrap pb-2 px-3 text-end font-medium">
                {t('settings.model.cloud.breakdown.input')}
              </th>
              <th className="whitespace-nowrap pb-2 px-3 text-end font-medium">
                {t('settings.model.cloud.breakdown.output')}
              </th>
              <th className="whitespace-nowrap pb-2 ps-3 text-end font-medium">
                {t('settings.model.cloud.breakdown.cached')}
              </th>
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
                <td className="min-w-80 py-2 pe-3 text-start">
                  <span className="flex flex-nowrap items-center gap-1.5">
                    <span className={cn('text-fg', isFrontier(m) && 'font-medium')}>{m.name}</span>
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
                <td className="py-2 px-3 text-start">
                  {m.modes && m.modes.length > 0 ? (
                    <span className="flex flex-nowrap items-center gap-1">
                      {m.modes.map((mode) => (
                        <span
                          key={mode}
                          className="inline-flex shrink-0 items-center rounded-full bg-border/40 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-muted"
                        >
                          {t(`chat.thinkingMode.${mode}`)}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted/50">{'—'}</span>
                  )}
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
      {provider === 'openrouter' && (
        <p className="text-muted flex items-center gap-1.5 text-xs">
          <InformationCircleIcon className="size-3.5 shrink-0" />
          <span>
            <span dir="ltr" className="inline-block">
              {'200+'}
            </span>{' '}
            {t('settings.model.cloud.breakdown.moreModels')}{' '}
            <a
              href="https://openrouter.ai/models"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              openrouter.ai/models
            </a>
          </span>
        </p>
      )}
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

function isModelDisabled(id: string): boolean {
  if (/tts|voiceclone|voicedesign/.test(id)) return true
  if (/^(gpt-5[\d.]*-(pro|codex)|o\d+-pro)/.test(id)) return true
  if (/(-image|-audio|lyria)/i.test(id)) return true
  return false
}

function disabledReason(id: string): string {
  if (/-image/.test(id)) return 'image'
  if (/(-audio|tts|voiceclone|voicedesign|lyria)/.test(id)) return 'audio'
  return 'unsupported'
}

/** Prefer the undated base model (e.g. "gpt-5.5" over "gpt-5.5-2026-04-23"). */
function isDateSnapshot(id: string): boolean {
  return /\d{4}-\d{2}-\d{2}$/.test(id)
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
