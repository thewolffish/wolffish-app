import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const LOGS_DIR = join(homedir(), '.wolffish', 'workspace', 'logs')
let ready: Promise<void> | null = null

function ensureDir(): Promise<void> {
  if (!ready) ready = mkdir(LOGS_DIR, { recursive: true }).then(() => {})
  return ready
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

function time(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '')
}

function serialize(a: unknown): string {
  if (a instanceof Error) return `${a.message}\n${a.stack}`
  return String(a)
}

function fmt(level: string, tag: string, args: unknown[]): string {
  const msg = args.map(serialize).join(' ')
  return `${time()}  ${level.padEnd(5)}  ${tag}  ${msg}\n`
}

async function write(line: string): Promise<void> {
  try {
    await ensureDir()
    await appendFile(join(LOGS_DIR, `${dateStamp()}.log`), line, 'utf8')
  } catch {
    // never let logging crash the app
  }
}

export const wlog = {
  info(tag: string, ...args: unknown[]): void {
    void write(fmt('INFO', tag, args))
  },
  warn(tag: string, ...args: unknown[]): void {
    void write(fmt('WARN', tag, args))
  },
  error(tag: string, ...args: unknown[]): void {
    void write(fmt('ERROR', tag, args))
  },
  separator(label?: string): void {
    void write(label ? `\n${label}\n\n` : '\n')
  }
}
