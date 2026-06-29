import type { ChatMessage } from '@main/runtime/thalamus'

/**
 * Orchestrator mode (Phase 2) — the worker registry and event-driven driver.
 *
 * One `OrchestrationSession` belongs to one orchestrator turn. It is the SINGLE
 * SOURCE OF TRUTH for that turn's workers: every worker is born here (via the
 * orchestrator's delegation tools), lives here with a status, and dies only here
 * (close/cancel/dispose). No orphans — `dispose()` aborts every survivor.
 *
 * Orchestration is event-driven: `spawn`/`sendTo` are non-blocking (the worker
 * runs in the background), and `awaitNext` returns the moment the NEXT worker
 * lands in `awaiting` — never an await-all. The model decides whose completion
 * gates the next move.
 */

export type WorkerStatus = 'running' | 'awaiting' | 'done' | 'cancelled'

export type WorkerResult = {
  /** The worker's final assistant text — for the orchestrator's eyes only. */
  text: string
  stopReason: string
  toolCalls: number
}

export type WorkerView = {
  id: string
  branchLabel: string
  status: WorkerStatus
  result: WorkerResult | null
}

/**
 * Reasoning effort the orchestrator picks for a worker (the canonical scale).
 * Undefined ⇒ the worker model's provider default. The orchestrator controls
 * this per worker — the user's Brain reasoning setting only drives the
 * orchestrator's own turn, never the workers'.
 */
export type WorkerEffort = 'off' | 'on' | 'high' | 'max'

/**
 * Runs one worker turn to completion on the worker model and returns its result.
 * Injected by the Agent (which owns `respond`, Broca, segment capture) so this
 * module stays free of the Agent's heavy dependencies.
 */
export type RunWorkerTurn = (args: {
  workerId: string
  label: string
  history: ChatMessage[]
  signal: AbortSignal
  effort?: WorkerEffort
}) => Promise<WorkerResult>

/** Status/result change notification, for rendering verbose worker cards. */
export type WorkerEventSink = (view: WorkerView) => void

type WorkerRecord = {
  id: string
  branchLabel: string
  status: WorkerStatus
  abort: AbortController
  history: ChatMessage[]
  result: WorkerResult | null
  effort?: WorkerEffort
}

export class OrchestrationSession {
  private workers = new Map<string, WorkerRecord>()
  private seq = 0
  // Ids that have landed in `awaiting` and not yet been consumed by awaitNext.
  // A Set (not an array) so a re-driven or re-landed worker can never sit in the
  // queue twice and be reported as a phantom second completion. Insertion order
  // is preserved, so awaitNext still returns the earliest unconsumed landing.
  private landed = new Set<string>()
  // Resolvers parked in awaitNext, woken when a worker lands (or on dispose).
  private waiters: Array<() => void> = []
  private disposed = false

  constructor(
    private readonly runWorkerTurn: RunWorkerTurn,
    private readonly onEvent?: WorkerEventSink
  ) {}

  private nextId(): string {
    this.seq += 1
    return `w${this.seq}`
  }

  private view(rec: WorkerRecord): WorkerView {
    return { id: rec.id, branchLabel: rec.branchLabel, status: rec.status, result: rec.result }
  }

  private set(rec: WorkerRecord, status: WorkerStatus): void {
    rec.status = status
    this.onEvent?.(this.view(rec))
  }

  private wake(id: string): void {
    this.landed.add(id)
    this.waiters.shift()?.()
  }

  // Run (or re-run) a worker's current history in the background; on completion
  // mark it `awaiting` and wake any awaiter. A turn that throws is captured as a
  // failed result the orchestrator can react to — it never kills the run.
  private drive(rec: WorkerRecord): void {
    this.set(rec, 'running')
    void this.runWorkerTurn({
      workerId: rec.id,
      label: rec.branchLabel,
      history: rec.history,
      signal: rec.abort.signal,
      effort: rec.effort
    })
      .then(
        (result) => result,
        (err): WorkerResult => ({
          text: `Worker failed: ${err instanceof Error ? err.message : String(err)}`,
          stopReason: 'error',
          toolCalls: 0
        })
      )
      .then((result) => {
        // Only a worker still in the 'running' state THIS drive() set may land.
        // If it was retired mid-flight — cancel()→'cancelled', close()→'done',
        // or dispose() — the late completion must not resurrect it to 'awaiting'
        // or re-enter the landed queue.
        if (rec.status !== 'running' || this.disposed) return
        rec.result = result
        // Append the reply so a follow-up continues the same thread.
        rec.history.push({ role: 'assistant', content: result.text })
        this.set(rec, 'awaiting')
        this.wake(rec.id)
      })
  }

  /** Spawn a live worker with an initial prompt. Non-blocking — returns its id. */
  spawn(prompt: string, branchLabel?: string, effort?: WorkerEffort): string {
    if (this.disposed) throw new Error('orchestration session is closed')
    const id = this.nextId()
    const rec: WorkerRecord = {
      id,
      branchLabel: branchLabel?.trim() || `worker ${id}`,
      status: 'running',
      abort: new AbortController(),
      history: [{ role: 'user', content: prompt }],
      result: null,
      effort
    }
    this.workers.set(id, rec)
    this.onEvent?.(this.view(rec))
    this.drive(rec)
    return id
  }

  /** Send a follow-up to a worker that's awaiting. Non-blocking. An `effort`
   * here re-tunes the worker's reasoning for this and subsequent turns. */
  sendTo(id: string, prompt: string, effort?: WorkerEffort): void {
    const rec = this.require(id)
    if (rec.status === 'running') throw new Error(`worker ${id} is still running`)
    if (rec.status !== 'awaiting') throw new Error(`worker ${id} is ${rec.status}`)
    // Drop any unconsumed prior landing — it's about to be superseded by a fresh
    // run, and must not surface as a stale completion of the new prompt.
    this.landed.delete(id)
    if (effort !== undefined) rec.effort = effort
    rec.history.push({ role: 'user', content: prompt })
    rec.result = null
    this.drive(rec)
  }

  /**
   * Block until the NEXT worker (optionally restricted to `ids`) lands in
   * `awaiting`, and return its id + result. Returns null when no matching worker
   * is still running (nothing left to wait for). Event-driven: resolves on the
   * first landing, leaving other idle workers sitting in `awaiting`.
   */
  async awaitNext(ids?: string[]): Promise<{ id: string; result: WorkerResult } | null> {
    const want = ids && ids.length ? new Set(ids) : null
    for (;;) {
      let pick: string | undefined
      for (const id of this.landed) {
        if (!want || want.has(id)) {
          pick = id
          break
        }
      }
      if (pick !== undefined) {
        this.landed.delete(pick)
        const rec = this.workers.get(pick)
        if (rec?.result) return { id: pick, result: rec.result }
        continue
      }
      if (this.disposed) return null
      const anyRunning = [...this.workers.values()].some(
        (r) => (!want || want.has(r.id)) && r.status === 'running'
      )
      if (!anyRunning) return null
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }

  /** Close a worker for good — it stops accepting follow-ups. */
  close(id: string): void {
    const rec = this.require(id)
    if (rec.status === 'running') rec.abort.abort()
    this.landed.delete(id)
    this.set(rec, 'done')
  }

  /** Cancel a worker, aborting its in-flight tool calls immediately. */
  cancel(id: string): void {
    const rec = this.require(id)
    rec.abort.abort()
    this.landed.delete(id)
    this.set(rec, 'cancelled')
  }

  list(): WorkerView[] {
    return [...this.workers.values()].map((r) => this.view(r))
  }

  /** Total teardown — abort every survivor, wake awaiters. No orphans. */
  dispose(): void {
    this.disposed = true
    this.landed.clear()
    for (const rec of this.workers.values()) {
      if (rec.status === 'running' || rec.status === 'awaiting') {
        rec.abort.abort()
        this.set(rec, 'cancelled')
      }
    }
    const ws = this.waiters.splice(0)
    for (const w of ws) w()
  }

  private require(id: string): WorkerRecord {
    const rec = this.workers.get(id)
    if (!rec) throw new Error(`unknown worker "${id}"`)
    return rec
  }
}
