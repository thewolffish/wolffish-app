import Database, { type Database as Db, type Statement } from 'better-sqlite3'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Corpus } from '@main/runtime/corpus'
import { toFtsMatchQuery } from '@main/runtime/cortexQuery'

/**
 * Cortex is the fast retrieval index over every markdown file in the
 * workspace.
 *
 * Maps to: the cerebral cortex — the wrinkled outer sheet of the brain
 * where pattern matching, association, and recall happen at speed. The
 * cortex doesn't *store* the original sensory experience; it stores a
 * compressed, queryable representation that can be regenerated quickly.
 *
 * In Wolffish, Cortex owns cortex.db (SQLite + FTS5) and indexes every
 * markdown file under the workspace. The database is disposable — if it's
 * deleted, it can always be rebuilt from the markdown that lives next to
 * it. Brainstem's file watchers will tell Cortex when something on disk
 * changes (M5); for now the index is rebuilt at startup.
 */

export type CortexSearchResult = {
  path: string
  score: number
}

export type CortexOptions = {
  workspaceRoot?: string
  dbPath?: string
  corpus?: Corpus
}

type ParsedSection = {
  date: string | null
  section: string
  content: string
}

type ParsedTaskHeader = {
  id: string | null
  name: string | null
  status: string | null
  createdAt: string | null
  completedAt: string | null
  stepsTotal: number | null
  stepsDone: number | null
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS memory_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  section TEXT,
  content TEXT,
  source_file TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  name TEXT,
  status TEXT,
  created_at TEXT,
  completed_at TEXT,
  steps_total INTEGER,
  steps_done INTEGER,
  source_file TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  source_file,
  content
);

CREATE INDEX IF NOT EXISTS memory_entries_source ON memory_entries(source_file);
CREATE INDEX IF NOT EXISTS tasks_source ON tasks(source_file);
`

/** Files indexed per synchronous batch before yielding the event loop. */
const REINDEX_BATCH = 8
/** Only surface the blocking overlay once a rebuild has run this long. */
const REINDEX_NOTICE_MS = 500

/** Progress of an in-flight full reindex, surfaced to the renderer overlay. */
export type ReindexStatus = { startedAt: number; total: number; done: number }

export class Cortex {
  private db: Db | null = null
  private workspaceRoot: string | null
  private corpus: Corpus | null
  private dbFile: string | null
  private reindexStatus: ReindexStatus | null = null

  constructor(options: CortexOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? null
    this.corpus = options.corpus ?? null
    this.dbFile = options.dbPath ?? this.defaultDbPath()
  }

  /**
   * Open cortex.db, ensure schema, and trigger an initial reindex from
   * markdown. Safe to call repeatedly.
   */
  async init(): Promise<void> {
    if (this.db) return
    if (!this.dbFile) {
      throw new Error('Cortex.init: dbPath unresolved (workspaceRoot is required)')
    }
    await fsp.mkdir(path.dirname(this.dbFile), { recursive: true })
    this.db = new Database(this.dbFile)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(SCHEMA_SQL)
    await this.reindex()
    this.backfillNullDates()
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  /**
   * Current reindex status, or null when no rebuild is in flight (or it's
   * still below the notice threshold). Drives the blocking "Rebuilding memory"
   * overlay in the renderer.
   */
  getReindexStatus(): ReindexStatus | null {
    return this.reindexStatus
  }

  /**
   * Walk the workspace, drop existing rows, and reindex every markdown file.
   * Markdown is the source of truth.
   *
   * better-sqlite3 is synchronous, so indexing the whole workspace in one
   * transaction froze the Electron main thread for the entire rebuild (minutes
   * on a large workspace — the UI, IPC, and any overlay all locked up). Instead
   * we index in batches and yield the event loop between them: the loop stays
   * cooperative so the "Rebuilding memory" overlay renders with a live timer,
   * and callers that await readiness (the agent gates on `cortexReady`) still
   * get a fully-built index before the next turn runs.
   */
  async reindex(): Promise<void> {
    const db = this.requireDb()
    const root = this.workspaceRoot
    if (!root) return

    const startedAt = Date.now()

    db.exec('DELETE FROM memory_entries; DELETE FROM tasks; DELETE FROM search_index;')

    const files = await collectMarkdownFiles(root)
    const total = files.length
    let done = 0
    let notified = false

    for (let i = 0; i < files.length; i += REINDEX_BATCH) {
      const batch = files.slice(i, i + REINDEX_BATCH)
      const insert = db.transaction((paths: string[]) => {
        for (const abs of paths) this.indexFileSync(abs)
      })
      insert(batch)
      done += batch.length

      // Only raise the blocking overlay once the rebuild has proven slow enough
      // to be worth interrupting the user for — a fast reindex on a small
      // workspace finishes invisibly, no flashed overlay.
      if (!notified && Date.now() - startedAt >= REINDEX_NOTICE_MS) {
        notified = true
        this.reindexStatus = { startedAt, total, done }
        this.corpus?.emit('index.reindexStarted', { startedAt, total })
      }
      if (notified) {
        this.reindexStatus = { startedAt, total, done }
        this.corpus?.emit('index.reindexProgress', { done, total })
      }

      // Yield so IPC and the overlay timer keep flowing during the rebuild.
      await new Promise((resolve) => setImmediate(resolve))
    }

    this.reindexStatus = null
    if (this.corpus) {
      this.corpus.emit('index.reindexed', {
        filesCount: total,
        durationMs: Date.now() - startedAt
      })
    }
  }

  /**
   * Reindex a single file. Used by the future watcher (M5). Removes any
   * existing rows for this file before inserting fresh ones.
   */
  async indexFile(absPath: string): Promise<void> {
    this.requireDb()
    this.indexFileSync(absPath)
  }

  /**
   * Drop every row associated with a file. Used when a file is deleted
   * from the workspace.
   */
  async removeFile(absPath: string): Promise<void> {
    const db = this.requireDb()
    const rel = this.toRelative(absPath)
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM memory_entries WHERE source_file = ?').run(rel)
      db.prepare('DELETE FROM tasks WHERE source_file = ?').run(rel)
      db.prepare('DELETE FROM search_index WHERE source_file = ?').run(rel)
    })
    tx()
  }

  /**
   * FTS5 search across every indexed markdown file.
   */
  search(query: string, limit = 10): CortexSearchResult[] {
    const db = this.requireDb()
    const trimmed = query.trim()
    if (!trimmed) return []

    const ftsQuery = toFtsMatchQuery(trimmed)
    if (!ftsQuery) return []

    // NOTE: deliberately NO snippet(). The only caller (prefrontal) reads the
    // matched file by `path` and never touches the excerpt, but snippet() is
    // ~99% of FTS5's cost and explodes super-linearly with query terms — it
    // turned a multi-term search into a multi-SECOND (here, multi-minute) main-
    // thread freeze. Dropping it makes the search effectively free (~1ms).
    let stmt: Statement
    try {
      stmt = db.prepare(
        `SELECT source_file AS path,
                bm25(search_index) AS rank
         FROM search_index
         WHERE search_index MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
    } catch {
      return []
    }

    let rows: Array<{ path: string; rank: number }>
    try {
      rows = stmt.all(ftsQuery, limit) as Array<{ path: string; rank: number }>
    } catch {
      return []
    }

    return rows.map((row) => ({
      path: row.path,
      score: bm25ToScore(row.rank)
    }))
  }

  /**
   * Resolve missing dates on `memory_entries` rows where the indexer
   * pre-dates the date-resolution rules. Idempotent — re-running it on a
   * clean db is a no-op because every row already has a non-null date.
   */
  backfillNullDates(): void {
    const db = this.requireDb()
    const root = this.workspaceRoot
    if (!root) return
    const rows = db
      .prepare('SELECT DISTINCT source_file AS source_file FROM memory_entries WHERE date IS NULL')
      .all() as Array<{ source_file: string }>
    if (rows.length === 0) return

    const update = db.prepare(
      'UPDATE memory_entries SET date = ? WHERE source_file = ? AND date IS NULL'
    )
    const tx = db.transaction((items: typeof rows) => {
      for (const row of items) {
        const abs = path.join(root, row.source_file)
        let raw: string
        let mtimeMs: number
        try {
          raw = fs.readFileSync(abs, 'utf8')
          mtimeMs = fs.statSync(abs).mtimeMs
        } catch {
          continue
        }
        update.run(resolveDate(row.source_file, raw, mtimeMs), row.source_file)
      }
    })
    tx(rows)
  }

  private indexFileSync(absPath: string): void {
    const db = this.requireDb()
    const rel = this.toRelative(absPath)

    let raw: string
    let mtimeMs: number
    try {
      raw = fs.readFileSync(absPath, 'utf8')
      mtimeMs = fs.statSync(absPath).mtimeMs
    } catch {
      return
    }

    db.prepare('DELETE FROM memory_entries WHERE source_file = ?').run(rel)
    db.prepare('DELETE FROM tasks WHERE source_file = ?').run(rel)
    db.prepare('DELETE FROM search_index WHERE source_file = ?').run(rel)

    db.prepare('INSERT INTO search_index (source_file, content) VALUES (?, ?)').run(rel, raw)

    const date = resolveDate(rel, raw, mtimeMs)
    const sections = splitMarkdownByHeader(raw)
    const insertEntry = db.prepare(
      'INSERT INTO memory_entries (date, section, content, source_file) VALUES (?, ?, ?, ?)'
    )
    for (const sec of sections) {
      insertEntry.run(sec.date ?? date, sec.section, sec.content, rel)
    }

    if (rel.startsWith('brain/motor/tasks/')) {
      const header = parseTaskHeader(raw)
      const id = header.id ?? path.basename(rel, '.md')
      db.prepare(
        `INSERT INTO tasks (id, name, status, created_at, completed_at, steps_total, steps_done, source_file)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        header.name,
        header.status,
        header.createdAt,
        header.completedAt,
        header.stepsTotal,
        header.stepsDone,
        rel
      )
    }
  }

  private requireDb(): Db {
    if (!this.db) {
      throw new Error('Cortex not initialized — call init() first')
    }
    return this.db
  }

  private toRelative(absPath: string): string {
    if (!this.workspaceRoot) return absPath
    const rel = path.relative(this.workspaceRoot, absPath)
    return rel.split(path.sep).join('/')
  }

  private defaultDbPath(): string | null {
    if (!this.workspaceRoot) return null
    return path.join(this.workspaceRoot, 'brain', 'cortex.db')
  }
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = []
  await walk(root, root, out)
  return out.sort()
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(root, abs, out)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(abs)
    }
  }
}

function splitMarkdownByHeader(content: string): ParsedSection[] {
  const lines = content.split(/\r?\n/)
  const sections: ParsedSection[] = []
  let currentHeader = ''
  let buffer: string[] = []

  const flush = (): void => {
    const body = buffer.join('\n').trim()
    if (currentHeader.length > 0 || body.length > 0) {
      sections.push({ date: null, section: currentHeader, content: body })
    }
  }

  for (const line of lines) {
    const match = /^##\s+(.*\S)\s*$/.exec(line)
    if (match) {
      flush()
      currentHeader = match[1]
      buffer = []
    } else {
      buffer.push(line)
    }
  }
  flush()
  return sections
}

/**
 * Resolve the `date` column for a markdown file. Priority:
 *   1. `hippocampus/episodes/YYYY-MM-DD.md` filename → YYYY-MM-DD
 *   2. `*\/consolidated/YYYY-WNN.md` filename → YYYY-WNN (week bucket)
 *   3. YAML frontmatter `date:` field
 *   4. file mtime → YYYY-MM-DD
 * Always returns a non-null string so callers can store it directly.
 */
function resolveDate(relPath: string, raw: string, mtimeMs: number): string {
  const base = path.basename(relPath)
  const segments = relPath.split('/')

  if (segments.includes('episodes')) {
    const m = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(base)
    if (m) return m[1]
  }

  if (segments.includes('consolidated')) {
    const m = /^(\d{4})-[Ww](\d{1,2})\.md$/.exec(base)
    if (m) return `${m[1]}-W${m[2].padStart(2, '0')}`
  }

  const fm = parseFrontmatterDate(raw)
  if (fm) return fm

  return formatYmd(new Date(mtimeMs))
}

function parseFrontmatterDate(raw: string): string | null {
  if (!raw.startsWith('---')) return null
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return null
  const block = raw.slice(3, end)
  const m = /^\s*date\s*:\s*(.+?)\s*$/im.exec(block)
  if (!m) return null
  const value = m[1].trim().replace(/^['"]|['"]$/g, '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return formatYmd(d)
}

function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseTaskHeader(raw: string): ParsedTaskHeader {
  const get = (label: string): string | null => {
    const re = new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.+)$`, 'mi')
    const m = re.exec(raw)
    return m ? m[1].trim() : null
  }
  const idMatch = /^#\s*TASK[- ]([A-Za-z0-9._-]+)/m.exec(raw)
  const stepsRaw = get('Steps')
  let stepsTotal: number | null = null
  let stepsDone: number | null = null
  if (stepsRaw) {
    const m = /(\d+)\s*\/\s*(\d+)/.exec(stepsRaw)
    if (m) {
      stepsDone = Number(m[1])
      stepsTotal = Number(m[2])
    }
  }
  return {
    id: idMatch ? idMatch[1] : null,
    name: get('Name') ?? get('Task'),
    status: get('Status'),
    createdAt: get('Created'),
    completedAt: get('Completed'),
    stepsTotal,
    stepsDone
  }
}

function bm25ToScore(rank: number): number {
  if (!Number.isFinite(rank)) return 0
  // bm25 returns negative values for matches (lower is better in SQLite's
  // FTS5 implementation). Flip + squash into [0, 1] for easy sorting.
  return 1 / (1 + Math.max(0, -rank))
}
