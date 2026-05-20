import { CodeBlock } from '@components/core/CodeBlock'
import { cn } from '@lib/utils/cn'
import type { TaskCardState } from '@providers/flow/useFlow'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const STATUS_COLOR: Record<TaskCardState['status'], string> = {
  running: 'bg-accent/10 text-accent',
  succeeded: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
  stopped: 'bg-muted/20 text-muted'
}

export function TaskCard({ state }: { state: TaskCardState }): React.JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(state.steps.length <= 3)
  const stepsDone = state.steps.filter((s) => s.status === 'succeeded').length
  const stepsTotal = state.steps.length

  return (
    <div className="border-border bg-surface w-full max-w-[85%] self-start rounded-2xl border px-4 py-3 text-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-start"
      >
        <div className="flex items-center gap-2 truncate">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              STATUS_COLOR[state.status]
            )}
          >
            {t(`chat.task.status.${state.status}`)}
          </span>
          <span className="text-fg truncate font-medium">
            {t('chat.task.title')}: {state.description}
          </span>
        </div>
        <span className="text-muted shrink-0 text-xs">
          {stepsDone}/{stepsTotal || '?'}
        </span>
      </button>

      {expanded && state.steps.length > 0 && (
        <ol className="mt-3 flex flex-col gap-2">
          {state.steps.map((step, idx) => (
            <li key={idx} className="border-border/50 bg-bg/40 rounded-md border px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <code dir="ltr" className="text-fg text-xs font-medium">
                  {step.tool}
                  {step.attempt && step.attempt > 1
                    ? ` ${t('chat.task.attempt', { n: step.attempt })}`
                    : ''}
                </code>
                <span
                  className={cn(
                    'text-xs font-medium',
                    step.status === 'running' && 'text-accent',
                    step.status === 'succeeded' && 'text-emerald-600 dark:text-emerald-400',
                    step.status === 'failed' && 'text-red-600 dark:text-red-400',
                    step.status === 'stopped' && 'text-muted'
                  )}
                >
                  {t(`chat.task.stepStatus.${step.status}`)}
                </span>
              </div>
              {Object.keys(step.args).length > 0 && (
                <CodeBlock
                  content={jsonInline(step.args)}
                  language="json"
                  maxH="max-h-20"
                  showCopy={false}
                  className="mt-1"
                />
              )}
              {step.output && <CodeBlock content={step.output} showCopy={false} className="mt-1" />}
              {step.error && (
                <CodeBlock content={step.error} tone="error" showCopy={false} className="mt-1" />
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function jsonInline(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
