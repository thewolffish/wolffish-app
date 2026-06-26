import { cn } from '@lib/utils/cn'
import { RTL_LOCALES } from '@lib/i18n'
import type { AskUserOption, AskUserResponse, Segment } from '@preload/index'
import type { AskCardState } from '@providers/flow/useFlow'
import { useLocale } from '@providers/locale/useLocale'
import { CheckmarkCircle02Icon, MessageQuestionIcon, SentIcon } from 'hugeicons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type ToolResultSegment = Extract<Segment, { kind: 'tool_result' }>

/**
 * The agent asks the user a multiple-choice question (the `ask_user` tool).
 * Renders an interactive card in the chat: numbered options each with a
 * title + description, plus an optional free-text "something else" escape
 * hatch. Clicking an option (or sending free-text instructions) answers the
 * question, which resumes the paused agent loop with the user's choice.
 *
 * Two sources feed the card:
 *  - the live `ask` state (the chat:askRequest event) while the question is
 *    open, carrying the agent's optional custom labels for the free-text
 *    option and the user's optimistic selection;
 *  - the persisted tool_call `args` + `result` segments, used to rebuild the
 *    answered card when a conversation is resumed from history (no live
 *    state). Either is enough to render — the card never depends on both.
 */
type QuestionData = {
  question: string
  details?: string
  options: AskUserOption[]
  allowOther: boolean
  otherLabel: string
  otherDescription: string
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// Coerce the model's `options` arg into a clean list. Tolerant of an array of
// {label, description} objects OR bare strings (the schema can't express the
// nested item shape, so the model occasionally sends either).
function parseOptions(raw: unknown): AskUserOption[] {
  if (!Array.isArray(raw)) return []
  const out: AskUserOption[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const label = item.trim()
      if (label) out.push({ label })
    } else if (item && typeof item === 'object') {
      const label = asString((item as Record<string, unknown>).label).trim()
      const description = asString((item as Record<string, unknown>).description).trim()
      if (label) out.push({ label, ...(description ? { description } : {}) })
    }
  }
  return out
}

// Recover what the user picked from the persisted tool_result output, so the
// answered card highlights the right option even after the turn ends or a
// conversation is resumed from history (the live `ask` selection isn't saved).
// Mirrors the stable output format the `ask` plugin emits.
function parseAnswer(output: string | undefined): { index?: number; custom?: boolean } | null {
  if (!output) return null
  const opt = output.match(/selected option (\d+) of \d+/i)
  if (opt) return { index: Number(opt[1]) - 1 }
  if (/instead instructed/i.test(output)) return { custom: true }
  return null
}

export function QuestionCard({
  args,
  result,
  ask,
  onRespond
}: {
  args: Record<string, unknown>
  result?: ToolResultSegment
  ask?: AskCardState
  onRespond: (askId: string, response: AskUserResponse) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const { locale } = useLocale()
  const isRtl = RTL_LOCALES.has(locale)
  const [otherText, setOtherText] = useState('')

  const otherLabelFallback = t('chat.questionCard.otherLabel')
  const otherDescriptionFallback = t('chat.questionCard.otherDescription')

  const data: QuestionData = ask
    ? {
        question: ask.question,
        details: ask.details,
        options: ask.options,
        allowOther: ask.allowOther,
        otherLabel: ask.otherLabel || otherLabelFallback,
        otherDescription: ask.otherDescription || otherDescriptionFallback
      }
    : {
        question: asString(args.question),
        details: asString(args.details) || undefined,
        options: parseOptions(args.options),
        allowOther: args.allow_other !== false,
        otherLabel: asString(args.other_label) || otherLabelFallback,
        otherDescription: asString(args.other_description) || otherDescriptionFallback
      }

  // Nothing to render if the agent gave us neither a question nor options —
  // don't surface an empty shell.
  if (!data.question && data.options.length === 0) return null

  const answered = !!result || !!ask?.answered
  // Prefer the live selection (instant feedback on click); fall back to parsing
  // the persisted result so the highlight survives turn-end and history-resume.
  const parsed = result?.status === 'success' ? parseAnswer(result.output) : null
  const selectedIndex = ask?.selectedIndex ?? parsed?.index
  const customAnswer = ask?.customText
  const answeredByCustom =
    answered &&
    selectedIndex === undefined &&
    (customAnswer !== undefined || parsed?.custom === true)

  const choose = (index: number): void => {
    if (answered || !ask) return
    onRespond(ask.askId, { kind: 'option', index })
  }

  const submitOther = (): void => {
    if (answered || !ask) return
    const text = otherText.trim()
    if (!text) return
    onRespond(ask.askId, { kind: 'custom', text })
  }

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="border-border bg-surface w-full max-w-[85%] self-start rounded-2xl border px-4 py-3 text-sm"
    >
      <div className="mb-3 flex items-start gap-2">
        <MessageQuestionIcon size={18} className="text-accent mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-fg text-base font-semibold leading-snug">{data.question}</p>
          {data.details ? (
            <p className="text-muted mt-1 text-xs leading-snug">{data.details}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {data.options.map((option, index) => {
          const isChosen = answered && selectedIndex === index
          const dimmed = answered && !isChosen
          return (
            <button
              key={index}
              type="button"
              disabled={answered}
              onClick={() => choose(index)}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-start',
                isChosen ? 'border-accent bg-accent/10' : 'border-border bg-bg/40 hover:bg-bg',
                dimmed && 'opacity-50',
                !answered && 'cursor-pointer',
                answered && 'cursor-default'
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs font-semibold',
                  isChosen ? 'bg-accent text-white' : 'bg-primary/10 text-primary'
                )}
              >
                {isChosen ? <CheckmarkCircle02Icon size={14} /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-fg block font-medium leading-snug">{option.label}</span>
                {option.description ? (
                  <span className="text-muted mt-0.5 block text-xs leading-snug">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </button>
          )
        })}

        {data.allowOther ? (
          <div
            className={cn(
              'rounded-xl border px-3 py-2.5',
              answeredByCustom ? 'border-accent bg-accent/10' : 'border-border bg-bg/40',
              answered && !answeredByCustom && 'opacity-50'
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs font-semibold',
                  answeredByCustom ? 'bg-accent text-white' : 'bg-primary/10 text-primary'
                )}
              >
                {answeredByCustom ? <CheckmarkCircle02Icon size={14} /> : data.options.length + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-fg block font-medium leading-snug">{data.otherLabel}</span>
                <span className="text-muted mt-0.5 block text-xs leading-snug">
                  {data.otherDescription}
                </span>
              </span>
            </div>

            {answered ? (
              answeredByCustom && customAnswer ? (
                <p className="text-fg border-border/60 mt-2 rounded-lg border bg-bg/60 px-3 py-2 text-xs leading-snug whitespace-pre-wrap">
                  {customAnswer}
                </p>
              ) : null
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <textarea
                  dir={isRtl ? 'rtl' : 'ltr'}
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      submitOther()
                    }
                  }}
                  rows={1}
                  placeholder={t('chat.questionCard.otherPlaceholder')}
                  className={cn(
                    'border-border bg-bg text-fg h-9 flex-1 resize-none overflow-y-auto rounded-lg border px-3 py-2 text-xs leading-tight',
                    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'
                  )}
                />
                <button
                  type="button"
                  onClick={submitOther}
                  disabled={!otherText.trim()}
                  title={t('chat.questionCard.submit')}
                  className={cn(
                    'bg-primary text-primary-fg flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    'hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40'
                  )}
                >
                  <SentIcon size={16} />
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Always confirm the answer at the bottom once answered — useful even
          when the chosen option is already highlighted above. */}
      {answered && result?.output ? (
        <p className="text-muted mt-3 text-xs leading-snug">
          <span className="font-medium">{t('chat.questionCard.yourAnswer')}: </span>
          {result.output}
        </p>
      ) : null}
    </div>
  )
}
