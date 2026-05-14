import type { Corpus } from '@main/runtime/corpus/corpus'

/**
 * RAS is the attention filter that decides what makes it into context.
 *
 * Maps to: the reticular activating system — a network in the brainstem
 * that controls arousal and gates which sensory signals reach the cortex.
 * Without it, every breath, every distant car horn, every stray itch would
 * compete for attention. The RAS scores incoming signals against the
 * organism's current goal and lets only the relevant ones through.
 *
 * In Wolffish, RAS scores candidate context fragments (memory excerpts,
 * skill descriptions, knowledge files) against the current message and
 * allocates the available token budget across categories. If the budget is
 * tight, low-scoring fragments are dropped before they reach the LLM.
 */

export type ContextCategory = 'identity' | 'prefrontal' | 'memory' | 'skills' | 'history'

export type ContextCandidate = {
  category: ContextCategory
  source: string
  content: string
}

export type ScoredCandidate = ContextCandidate & {
  score: number
  tokens: number
}

export type BudgetAllocation = Record<ContextCategory, number>

export type RASOptions = {
  totalBudgetTokens?: number
  corpus?: Corpus
}

export const DEFAULT_BUDGET_TOKENS = 8000

// Memory candidates must clear this score floor or they get dropped before
// hitting the budget. Without it, common-word matches ("tell", "me") cause
// FTS5 hits to leak into context for queries unrelated to the workspace.
export const MEMORY_RELEVANCE_THRESHOLD = 0.25

const BUDGET_RATIOS: BudgetAllocation = {
  identity: 0.15,
  prefrontal: 0.1,
  memory: 0.3,
  skills: 0.2,
  history: 0.25
}

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'can',
  'may',
  'might',
  'this',
  'that',
  'it',
  'i',
  'you',
  'we',
  'they',
  'my',
  'your',
  'our',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'from'
])

export class RAS {
  private totalBudget: number
  private corpus: Corpus | null

  constructor(options: RASOptions = {}) {
    this.totalBudget = options.totalBudgetTokens ?? DEFAULT_BUDGET_TOKENS
    this.corpus = options.corpus ?? null
    void this.corpus
  }

  /**
   * Score a piece of content against a message on [0, 1] using keyword
   * overlap. Stop words are excluded so common glue doesn't dominate the
   * signal.
   */
  scoreRelevance(message: string, content: string): number {
    const keywords = tokenize(message)
    if (keywords.length === 0) return 0
    const haystack = content.toLowerCase()
    let hits = 0
    for (const kw of keywords) {
      if (haystack.includes(kw)) hits++
    }
    return hits / keywords.length
  }

  /**
   * Rough byte-to-token estimate: 1 token ~ 4 characters. Good enough for
   * budget arithmetic — exact counts aren't worth a tokenizer dependency.
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  /**
   * Split a total token budget across categories using the default
   * 15/10/30/20/25 split. Hypothalamus may adjust the ratios later (M6).
   */
  allocateBudget(totalTokens: number = this.totalBudget): BudgetAllocation {
    return {
      identity: Math.floor(totalTokens * BUDGET_RATIOS.identity),
      prefrontal: Math.floor(totalTokens * BUDGET_RATIOS.prefrontal),
      memory: Math.floor(totalTokens * BUDGET_RATIOS.memory),
      skills: Math.floor(totalTokens * BUDGET_RATIOS.skills),
      history: Math.floor(totalTokens * BUDGET_RATIOS.history)
    }
  }

  /**
   * Score every candidate, sort by relevance, and trim until the per-
   * category budget is exhausted. Identity and prefrontal candidates
   * bypass scoring — they're always included.
   */
  filterContext(
    message: string,
    candidates: ContextCandidate[],
    budget: BudgetAllocation = this.allocateBudget()
  ): ScoredCandidate[] {
    const scored: ScoredCandidate[] = candidates.map((c) => ({
      ...c,
      score:
        c.category === 'identity' || c.category === 'prefrontal'
          ? 1
          : this.scoreRelevance(message, c.content),
      tokens: this.estimateTokens(c.content)
    }))

    const byCategory = new Map<ContextCategory, ScoredCandidate[]>()
    for (const item of scored) {
      const list = byCategory.get(item.category) ?? []
      list.push(item)
      byCategory.set(item.category, list)
    }

    const out: ScoredCandidate[] = []
    for (const [category, items] of byCategory) {
      const cap = budget[category] ?? 0
      // identity + prefrontal are mandatory; if the cap is too small,
      // include them anyway — pruning them defeats the point.
      const mandatory = category === 'identity' || category === 'prefrontal'
      items.sort((a, b) => b.score - a.score)

      let used = 0
      for (const item of items) {
        if (mandatory) {
          out.push(item)
          used += item.tokens
          continue
        }
        if (category === 'memory' && item.score < MEMORY_RELEVANCE_THRESHOLD) continue
        if (item.score <= 0) continue
        if (used + item.tokens > cap) continue
        out.push(item)
        used += item.tokens
      }
    }

    return out
  }
}

function tokenize(message: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const tokens = message
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
  for (const t of tokens) {
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}
