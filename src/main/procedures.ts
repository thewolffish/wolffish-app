import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { diskWriter } from '@main/io/diskWriter'
import { workspaceRoot } from '@main/workspace/workspace'

/**
 * Procedures — saved prompts the user runs on demand from the Procedures page.
 * Inert data (no scheduler, unlike heartbeat): a flat list persisted as a single
 * JSON file under the workspace, read/modified/written through the shared
 * diskWriter so the file is never torn on a concurrent read or a crash.
 */
export type Procedure = {
  id: string
  title: string
  prompt: string
  createdAt: number
  updatedAt: number
}

function proceduresFile(): string {
  return path.join(workspaceRoot(), 'brain', 'procedures.json')
}

async function loadProcedures(): Promise<Procedure[]> {
  try {
    const raw = await fs.readFile(proceduresFile(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Procedure[]) : []
  } catch {
    // Missing file / bad JSON — start from an empty list rather than throwing.
    return []
  }
}

async function saveProcedures(procedures: Procedure[]): Promise<void> {
  await diskWriter.writeFileAtomic(proceduresFile(), JSON.stringify(procedures, null, 2))
}

// Serialize every read-modify-write so two mutations that race (e.g. a debounced
// auto-save landing next to a delete) can't both fork off the same base list and
// clobber each other. Reads chain here too, so a list() always reflects the
// latest committed write.
let mutationTail: Promise<unknown> = Promise.resolve()
function serialize<T>(op: () => Promise<T>): Promise<T> {
  const run = mutationTail.then(op, op)
  mutationTail = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export function listProcedures(): Promise<Procedure[]> {
  return serialize(async () => {
    const procedures = await loadProcedures()
    // Most-recently-edited first, so the freshest procedure sits at the top.
    return procedures.slice().sort((a, b) => b.updatedAt - a.updatedAt)
  })
}

export function createProcedure(payload: { title: string; prompt: string }): Promise<Procedure> {
  return serialize(async () => {
    const procedures = await loadProcedures()
    const now = Date.now()
    const procedure: Procedure = {
      id: randomUUID(),
      title: payload.title,
      prompt: payload.prompt,
      createdAt: now,
      updatedAt: now
    }
    procedures.push(procedure)
    await saveProcedures(procedures)
    return procedure
  })
}

export function updateProcedure(payload: {
  id: string
  title?: string
  prompt?: string
}): Promise<Procedure> {
  return serialize(async () => {
    const procedures = await loadProcedures()
    const procedure = procedures.find((p) => p.id === payload.id)
    if (!procedure) throw new Error(`procedure not found: ${payload.id}`)
    if (payload.title !== undefined) procedure.title = payload.title
    if (payload.prompt !== undefined) procedure.prompt = payload.prompt
    procedure.updatedAt = Date.now()
    await saveProcedures(procedures)
    return procedure
  })
}

export function deleteProcedure(id: string): Promise<void> {
  return serialize(async () => {
    const procedures = await loadProcedures()
    await saveProcedures(procedures.filter((p) => p.id !== id))
  })
}
