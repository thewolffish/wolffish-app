import { CopyButton } from '@components/core/CopyButton'
import { Markdown } from '@components/core/Markdown'
import { cn } from '@lib/utils/cn'
import { formatBytes } from '@lib/utils/format'
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  CodeIcon,
  Download01Icon,
  File01Icon
} from 'hugeicons-react'
import hljs from 'highlight.js/lib/common'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const EXT_LANG: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'xml',
  svelte: 'xml',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  graphql: 'graphql',
  md: 'markdown',
  mdx: 'markdown',
  php: 'php',
  lua: 'lua',
  r: 'r',
  pl: 'perl',
  dart: 'dart',
  scala: 'scala',
  groovy: 'groovy',
  proto: 'protobuf'
}

function langHintFromExt(ext: string): string | undefined {
  return EXT_LANG[ext]
}

export function CodeFileViewer({
  content,
  fileName,
  language,
  sizeBytes,
  onDownload
}: {
  content: string
  fileName: string
  language?: string
  /** When set, shown next to the language label in the footer. */
  sizeBytes?: number
  /** When set, a download button appears in the footer (attachment cards). */
  onDownload?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const lang = language ?? langHintFromExt(ext)
  // Markdown files (README and friends) render as rich markdown instead of
  // line-numbered source — same renderer the chat bubbles use.
  const isMarkdown = lang === 'markdown'

  const highlighted = useMemo(() => {
    if (isMarkdown) return null
    try {
      const result =
        lang && hljs.getLanguage(lang)
          ? hljs.highlight(content, { language: lang, ignoreIllegals: true })
          : hljs.highlightAuto(content)
      return result.value || null
    } catch {
      return null
    }
  }, [content, lang, isMarkdown])

  const lines = content.split('\n')
  const lineCount = lines.length
  const gutterWidth = String(lineCount).length

  return (
    <div
      className={cn(
        'border-border bg-surface flex w-full max-w-[85%] flex-col self-start',
        'overflow-hidden rounded-2xl border'
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2"
      >
        <div className="flex min-w-0 items-center gap-2">
          {isMarkdown ? (
            <File01Icon size={14} className="text-muted shrink-0" />
          ) : (
            <CodeIcon size={14} className="text-muted shrink-0" />
          )}
          <span className="text-fg truncate text-xs font-medium" title={fileName}>
            {fileName}
          </span>
          <span className="text-muted shrink-0 text-[10px]">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {expanded ? (
            <ArrowDown01Icon size={14} className="text-muted" aria-hidden />
          ) : (
            <ArrowRight01Icon size={14} className="text-muted" aria-hidden />
          )}
        </div>
      </button>

      <div className={cn('overflow-auto', expanded ? 'max-h-80' : 'max-h-40')}>
        {isMarkdown ? (
          <div className="text-fg px-4 py-2.5 text-sm leading-relaxed wrap-break-word">
            <Markdown content={content} />
          </div>
        ) : (
          <div className="flex min-w-max">
            <pre
              dir="ltr"
              aria-hidden
              className="bg-bg/50 border-border sticky left-0 z-[1] shrink-0 border-e py-2 text-right font-mono text-[11px] leading-5 select-none"
            >
              {lines.map((_, i) => (
                <div
                  key={i}
                  className="text-muted/60 px-2"
                  style={{ minWidth: `${gutterWidth + 2}ch` }}
                >
                  {i + 1}
                </div>
              ))}
            </pre>
            {highlighted ? (
              <pre
                dir="ltr"
                className="hljs flex-1 py-2 pe-3 ps-3 font-mono text-xs leading-5"
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
            ) : (
              <pre dir="ltr" className="text-fg flex-1 py-2 pe-3 ps-3 font-mono text-xs leading-5">
                {content}
              </pre>
            )}
          </div>
        )}
      </div>

      <div className="border-border flex items-center gap-2 border-t px-3 py-1.5">
        <span className="text-muted min-w-0 flex-1 truncate text-[10px]">
          {lang ?? ext}
          {sizeBytes != null ? ` · ${formatBytes(sizeBytes)}` : ''}
        </span>
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            title={t('chat.fileCard.download')}
            className={cn(
              'text-muted hover:text-fg flex shrink-0 cursor-pointer items-center justify-center rounded p-1',
              'focus-visible:ring-2 focus-visible:ring-accent'
            )}
          >
            <Download01Icon size={14} />
          </button>
        )}
        <CopyButton
          text={content}
          variant="inline"
          ariaLabelKey="chat.copy"
          className="text-muted hover:text-fg"
        />
      </div>
    </div>
  )
}
