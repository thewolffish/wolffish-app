import { CopyButton } from '@components/core/CopyButton'
import { cn } from '@lib/utils/cn'
import { Download01Icon } from 'hugeicons-react'
import { memo, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props
    return props ? extractText(props.children) : ''
  }
  return ''
}

const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => (
    <h1 className="text-fg mt-4 mb-2 text-xl font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-fg mt-4 mb-2 text-lg font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-fg mt-3 mb-2 text-base font-semibold first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-fg mt-3 mb-2 text-sm font-semibold first:mt-0">{children}</h4>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 ps-6 first:mt-0 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 ps-6 first:mt-0 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-accent underline underline-offset-2 hover:brightness-110"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-border text-muted my-2 border-s-2 ps-3 italic first:mt-0 last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border/60 my-3" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
      <table className="border-border w-full border-collapse border text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-bg/50">{children}</thead>,
  th: ({ children }) => (
    <th className="border-border min-w-[7rem] border px-2 py-1 text-start font-semibold whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-border min-w-[7rem] border px-2 py-1 align-top wrap-anywhere">
      {children}
    </td>
  ),
  pre: ({ children, className }) => {
    const text = extractText(children).replace(/\n$/, '')
    return (
      <div dir="ltr" className="group relative my-2 text-left first:mt-0 last:mb-0">
        <CopyButton
          text={text}
          variant="overlay"
          ariaLabelKey="chat.copyCode"
          className="absolute inset-e-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        />
        <pre
          dir="ltr"
          className={cn(
            'bg-bg border-border text-fg overflow-x-auto rounded-lg border p-3 text-[0.85em] leading-relaxed text-left',
            className
          )}
        >
          {children}
        </pre>
      </div>
    )
  },
  code: ({ children, className, ...rest }) => {
    const isBlock = /\blanguage-/.test(className ?? '')
    if (isBlock) {
      return (
        <code dir="ltr" className={cn('font-mono', className)} {...rest}>
          {children}
        </code>
      )
    }
    return (
      <code
        dir="ltr"
        className="bg-border/40 text-fg inline-block max-w-full rounded px-1 py-0.5 font-mono text-[0.85em] wrap-anywhere"
        {...rest}
      >
        {children}
      </code>
    )
  },
  img: ({ src, alt }) => {
    if (!src) return null
    const relativePath = src.startsWith('wolffish-media://')
      ? src.slice('wolffish-media://'.length)
      : null
    return (
      <span className="group relative block w-fit max-w-full leading-none">
        <img src={src} alt={alt ?? ''} className="block max-w-full rounded-2xl" loading="lazy" />
        {relativePath && (
          <button
            type="button"
            onClick={() => void window.api.upload.download(relativePath)}
            aria-label="Download"
            className={cn(
              'absolute inset-e-2 top-2 flex h-7 w-7 cursor-pointer items-center justify-center',
              'rounded-md bg-bg/80 text-fg shadow-sm backdrop-blur-sm',
              'opacity-0 transition-opacity group-hover:opacity-100',
              'focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-transparent'
            )}
          >
            <Download01Icon size={14} />
          </button>
        )}
      </span>
    )
  },
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>
}

function urlTransform(url: string): string {
  if (url.startsWith('wolffish-media://')) return url
  return defaultUrlTransform(url)
}

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={components}
      urlTransform={urlTransform}
    >
      {content}
    </ReactMarkdown>
  )
})
