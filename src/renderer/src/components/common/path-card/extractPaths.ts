import type { ChatMessage } from '@providers/flow/useFlow'
import { canonicalPath } from './pathStat'

/**
 * Find filesystem paths mentioned in assistant prose worth surfacing as an
 * openable card: home-anchored (`~/...`) or absolute (`/...`) paths, drawn from
 * both inline-code spans (which may contain spaces) and bare text. URLs/schemes
 * are excluded; existence is verified later by PathCard. Deduped within the call.
 */
export function extractPathCandidates(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const add = (raw: string): void => {
    const p = raw
      .trim()
      .replace(/^[`'"(]+/, '')
      .replace(/[`'".,;:!?)\]]+$/, '')
    if (!p || p === '/' || p === '~/') return
    if (/[a-z][a-z0-9+.-]*:\/\//i.test(p)) return // http://, wolffish-media://, …
    if (!/^(~\/|\/)/.test(p)) return // only home- or root-anchored paths
    if (seen.has(p)) return
    seen.add(p)
    out.push(p)
  }

  // Inline-code spans can hold paths with spaces: `~/My Folder/sub`.
  const codeRe = /`([^`\n]+)`/g
  let m: RegExpExecArray | null
  while ((m = codeRe.exec(text)) !== null) {
    const c = m[1].trim()
    if (/^(~\/|\/)/.test(c)) add(c)
  }
  // Bare paths (no spaces), anchored at a boundary so "and/or" isn't matched.
  const bareRe = /(?:^|[\s(])((?:~\/|\/)[^\s`'")\]<>|]+)/gm
  while ((m = bareRe.exec(text)) !== null) add(m[1])

  return out
}

/**
 * Every filesystem path candidate named across a conversation's assistant turns
 * — prose text and tool-result output, the same sources PathCard draws from.
 * Used to pre-warm the path stat cache (statPathOnce) before a resumed
 * conversation renders, so the open-file/folder cards paint their final state
 * on the first frame instead of each popping in after its own async stat.
 */
export function conversationPathCandidates(messages: readonly ChatMessage[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const scan = (text: string): void => {
    for (const candidate of extractPathCandidates(text)) {
      const key = canonicalPath(candidate)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(candidate)
    }
  }
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    // Coalesce all text deltas before scanning so a path split across streamed
    // deltas (e.g. `/Users/me/` + `file`) is still matched; tool-result output
    // is scanned per segment, mirroring how the feed surfaces these cards.
    let prose = ''
    for (const s of m.segments) {
      if (s.kind === 'text') prose += s.delta
      else if (s.kind === 'tool_result') scan(s.output ?? '')
    }
    scan(prose)
  }
  return out
}
