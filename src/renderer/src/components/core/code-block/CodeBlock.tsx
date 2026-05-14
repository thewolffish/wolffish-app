import { CopyButton } from '@components/core/copy-button/CopyButton'
import { cn } from '@lib/utils/cn/cn'
import hljs from 'highlight.js/lib/common'
import { useMemo } from 'react'

export function CodeBlock({
  content,
  language,
  tone = 'default',
  maxH = 'max-h-32',
  showCopy = true,
  className
}: {
  content: string
  language?: string
  tone?: 'default' | 'error'
  maxH?: string
  showCopy?: boolean
  className?: string
}): React.JSX.Element {
  const html = useMemo(() => {
    try {
      const result =
        language && hljs.getLanguage(language)
          ? hljs.highlight(content, { language, ignoreIllegals: true })
          : hljs.highlightAuto(content)
      return result.value || null
    } catch {
      return null
    }
  }, [content, language])

  const preClasses = cn(
    'hljs border-border bg-bg overflow-y-auto rounded-md border px-3 py-2 text-left text-xs whitespace-pre-wrap break-words font-mono',
    showCopy && 'pe-12',
    tone === 'error' && 'border-red-500/40',
    maxH
  )

  return (
    <div className={cn('group/code relative', className)}>
      {html ? (
        <pre dir="ltr" className={preClasses} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre
          dir="ltr"
          className={cn(preClasses, tone === 'error' && 'text-red-600 dark:text-red-400')}
        >
          {content}
        </pre>
      )}
      {showCopy && (
        <CopyButton
          text={content}
          variant="overlay"
          ariaLabelKey="chat.copy"
          className="absolute inset-e-1.5 top-1.5 opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100"
        />
      )}
    </div>
  )
}
