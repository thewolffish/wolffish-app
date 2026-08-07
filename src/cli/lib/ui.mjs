/**
 * Terminal presentation: colour, boxes, tables, spinners, prompts.
 *
 * Two rules shape everything here. Colour is opt-out (NO_COLOR, a non-TTY
 * stdout, or `--no-color`), because the CLI is expected to be piped into
 * things. And every "card" the desktop chat draws has a line-shaped
 * equivalent, so a conversation reads the same in a terminal as it does in the
 * app — the same information, the same order, without the chrome.
 */
import os from 'node:os'

const FORCE_COLOR = process.env.FORCE_COLOR === '1'
const NO_COLOR =
  process.env.NO_COLOR !== undefined ||
  process.env.TERM === 'dumb' ||
  process.argv.includes('--no-color')

let colorEnabled = FORCE_COLOR || (!NO_COLOR && process.stdout.isTTY === true)

export function setColor(enabled) {
  colorEnabled = enabled
}

const CODES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
}

function wrap(code, text) {
  if (!colorEnabled) return text
  return `${code}${text}${CODES.reset}`
}

export const c = {
  bold: (t) => wrap(CODES.bold, t),
  dim: (t) => wrap(CODES.dim, t),
  italic: (t) => wrap(CODES.italic, t),
  red: (t) => wrap(CODES.red, t),
  green: (t) => wrap(CODES.green, t),
  yellow: (t) => wrap(CODES.yellow, t),
  blue: (t) => wrap(CODES.blue, t),
  magenta: (t) => wrap(CODES.magenta, t),
  cyan: (t) => wrap(CODES.cyan, t),
  gray: (t) => wrap(CODES.gray, t)
}

export function width() {
  return Math.max(40, Math.min(process.stdout.columns || 100, 120))
}

export function out(text = '') {
  process.stdout.write(text + '\n')
}

export function err(text = '') {
  process.stderr.write(text + '\n')
}

/** Visible length — ANSI escapes occupy no columns. */
export function visibleLength(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '').length
}

export function pad(text, size) {
  const gap = size - visibleLength(text)
  return gap > 0 ? text + ' '.repeat(gap) : text
}

/** Wrap prose to the terminal, honouring an indent on continuation lines. */
export function wrapText(text, indent = 0, max = width()) {
  const limit = Math.max(20, max - indent)
  const prefix = ' '.repeat(indent)
  const lines = []
  for (const paragraph of String(text).split('\n')) {
    if (paragraph.trim().length === 0) {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of paragraph.split(/\s+/)) {
      if (current.length === 0) current = word
      else if (current.length + 1 + word.length <= limit) current += ' ' + word
      else {
        lines.push(prefix + current)
        current = word
      }
    }
    if (current) lines.push(prefix + current)
  }
  return lines.join('\n')
}

export function heading(text) {
  out()
  out(c.bold(text))
  out(c.gray('─'.repeat(Math.min(visibleLength(text) + 8, width()))))
}

export function keyValue(rows, { indent = 2 } = {}) {
  const keyWidth = Math.max(...rows.map(([k]) => visibleLength(k)), 0)
  for (const [key, value] of rows) {
    out(' '.repeat(indent) + c.gray(pad(key, keyWidth)) + '  ' + value)
  }
}

export function table(headers, rows, { indent = 2 } = {}) {
  if (rows.length === 0) return
  const widths = headers.map((h, i) =>
    Math.max(visibleLength(h), ...rows.map((r) => visibleLength(String(r[i] ?? ''))))
  )
  out(' '.repeat(indent) + headers.map((h, i) => c.gray(pad(h, widths[i]))).join('  '))
  for (const row of rows) {
    out(' '.repeat(indent) + row.map((cell, i) => pad(String(cell ?? ''), widths[i])).join('  '))
  }
}

export function bytes(n) {
  const size = Number(n)
  if (!Number.isFinite(size)) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function relativeTime(ms) {
  const delta = Date.now() - Number(ms)
  if (!Number.isFinite(delta)) return '—'
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(Number(ms)).toISOString().slice(0, 10)
}

/** Shorten a path for display — `~` for home, and no runaway middles. */
export function shortPath(p) {
  if (typeof p !== 'string') return String(p ?? '')
  const home = os.homedir()
  let text = p.startsWith(home) ? '~' + p.slice(home.length) : p
  const max = Math.max(30, width() - 30)
  if (text.length > max) {
    const tail = text.slice(-(max - 4))
    text = '…/' + tail.replace(/^[^/\\]*[/\\]/, '')
  }
  return text
}

/** A spinner that quietly does nothing when stdout isn't a terminal. */
export function spinner(label) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  if (!process.stdout.isTTY) {
    // Piped or redirected: a spinner would write thousands of carriage
    // returns into the captured output. The no-op keeps every call site free
    // of `if (isTTY)` branches.
    const noop = () => undefined
    return { update: noop, stop: noop }
  }
  let index = 0
  let text = label
  const tick = () => {
    process.stdout.write(`\r${c.cyan(frames[index++ % frames.length])} ${c.dim(text)}\x1b[K`)
  }
  const timer = setInterval(tick, 80)
  timer.unref?.()
  tick()
  return {
    update(next) {
      text = next
    },
    stop() {
      clearInterval(timer)
      process.stdout.write('\r\x1b[K')
    }
  }
}

/** Read one line, with the prompt on stderr so stdout stays pipeable. */
export function question(prompt, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const stdin = process.stdin
    process.stderr.write(prompt)
    if (hidden && stdin.isTTY) {
      // Raw mode so nothing echoes — used for API keys and bot tokens, which
      // must not end up in a scrollback buffer or a screen recording.
      stdin.setRawMode(true)
      let value = ''
      const onData = (chunk) => {
        const char = chunk.toString('utf8')
        if (char === '\r' || char === '\n' || char === '\x04') {
          stdin.setRawMode(false)
          stdin.removeListener('data', onData)
          stdin.pause()
          process.stderr.write('\n')
          resolve(value)
          return
        }
        if (char === '\x03') {
          stdin.setRawMode(false)
          process.stderr.write('\n')
          process.exit(130)
        }
        if (char === '\x7f' || char === '\b') {
          value = value.slice(0, -1)
          return
        }
        value += char
      }
      stdin.resume()
      stdin.on('data', onData)
      return
    }
    let buffer = ''
    const onData = (chunk) => {
      buffer += chunk.toString('utf8')
      const index = buffer.indexOf('\n')
      if (index < 0) return
      stdin.removeListener('data', onData)
      stdin.pause()
      resolve(buffer.slice(0, index).replace(/\r$/, ''))
    }
    stdin.resume()
    stdin.on('data', onData)
  })
}

export async function confirm(prompt, fallback = false) {
  if (!process.stdin.isTTY) return fallback
  const answer = (await question(`${prompt} ${c.dim(fallback ? '[Y/n]' : '[y/N]')} `))
    .trim()
    .toLowerCase()
  if (answer === '') return fallback
  return answer === 'y' || answer === 'yes'
}

export const icon = {
  ok: () => c.green('✓'),
  warn: () => c.yellow('!'),
  fail: () => c.red('✗'),
  dot: () => c.gray('·'),
  tool: () => c.cyan('⏺'),
  file: () => c.magenta('◆'),
  ask: () => c.yellow('?'),
  gate: () => c.yellow('▲'),
  arrow: () => c.gray('›')
}
