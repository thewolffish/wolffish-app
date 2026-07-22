/**
 * Tests for the brainstem's bounded run pool (brainstem.ts): up to
 * MAX_CONCURRENT_JOBS jobs run at once, overflow queues FIFO, fires coalesce
 * per job id, a completion promotes the next queued job, a failing run frees
 * its slot without wedging the pool, and every transition pushes an
 * onRunsChanged snapshot.
 *
 * Drives the pool through runDetached (the procedures path) with a fake agent
 * whose processAutonomous blocks on a per-label gate, so the test controls
 * exactly when each "run" finishes. Also asserts the brainstem job id is
 * threaded into the autonomous turn (opts.jobId) — the renderer routes live
 * log entries to the right concurrent card by that id.
 *
 * Redirects the workspace to a temp home BEFORE loading the runtime graph so
 * nothing touches the real ~/.wolffish workspace.
 *
 * Run: TSX_TSCONFIG_PATH=tsconfig.node.json npx tsx src/main/runtime/__tests__/heartbeat-run-pool.test.ts
 */

import fs from 'node:fs'
import Module from 'node:module'
import os from 'node:os'
import path from 'node:path'

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'wolffish-heartbeat-pool-'))
;(os as unknown as { homedir: () => string }).homedir = (): string => TEST_HOME

const loader = Module as unknown as { _load: (...a: unknown[]) => unknown }
const origLoad = loader._load
loader._load = function (this: unknown, ...args: unknown[]): unknown {
  if (args[0] === 'electron') {
    return {
      app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => os.tmpdir() }
    }
  }
  return origLoad.apply(this, args)
}

let passed = 0
let failed = 0
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
    return
  }
  failed++
  console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function run(): Promise<void> {
  const { Brainstem, MAX_CONCURRENT_JOBS } = await import('@main/runtime/brainstem')

  const ws = path.join(TEST_HOME, 'ws')
  fs.mkdirSync(path.join(ws, 'brain', 'brainstem'), { recursive: true })

  const bs = new Brainstem({ workspaceRoot: ws })

  const snapshots: Array<{ running: string[]; queued: string[] }> = []
  const ended: string[] = []
  bs.setListener({
    onJobEnded: (p) => ended.push(`${p.id}:${p.status}`),
    onRunsChanged: (s) =>
      snapshots.push({
        running: s.running.map((r) => r.id),
        queued: s.queued.map((q) => q.id)
      })
  })

  const gates = new Map<string, () => void>()
  const jobIdsSeen = new Map<string, string | undefined>()
  let active = 0
  let maxActive = 0
  const fakeAgent = {
    processAutonomous: (opts: { jobLabel: string; jobId?: string }) => {
      jobIdsSeen.set(opts.jobLabel, opts.jobId)
      if (opts.jobLabel === 'FAIL') return Promise.reject(new Error('boom'))
      active += 1
      maxActive = Math.max(maxActive, active)
      return new Promise((resolve) => {
        gates.set(opts.jobLabel, () => {
          active -= 1
          resolve({ success: true, response: '', toolCalls: 0, conversationId: 'x' })
        })
      })
    }
  }
  bs.setAgent(fakeAgent as unknown as import('@main/runtime/agent').Agent)

  const runningIds = (): string[] => bs.getRunningJobs().map((r) => r.id)
  const queuedIds = (): string[] => bs.getQueuedJobs().map((q) => q.id)

  // ── Fill the pool: three run at once, the fourth queues ────────────────
  const r1 = bs.runDetached('a', 'A', 'job-a')
  const r2 = bs.runDetached('b', 'B', 'job-b')
  const r3 = bs.runDetached('c', 'C', 'job-c')
  const r4 = bs.runDetached('d', 'D', 'job-d')
  ok('first three start immediately', r1.started && r2.started && r3.started)
  ok('fourth is accepted but queued', r4.ok && !r4.started)
  ok(
    'pool holds MAX_CONCURRENT_JOBS runs',
    runningIds().length === MAX_CONCURRENT_JOBS,
    runningIds().join(',')
  )
  ok('running ids are the first three', runningIds().join(',') === 'job-a,job-b,job-c')
  ok('queue holds the fourth', queuedIds().join(',') === 'job-d')
  ok(
    'a snapshot carried the queued job',
    snapshots.some((s) => s.queued.includes('job-d'))
  )

  // ── Coalescing: a re-fire of a running or queued job takes no slot ─────
  const r4b = bs.runDetached('d', 'D', 'job-d')
  ok('queued re-fire coalesces', r4b.ok && !r4b.started && !!r4b.error)
  const r1b = bs.runDetached('a', 'A', 'job-a')
  ok('running re-fire coalesces', r1b.ok && !r1b.started && !!r1b.error)
  ok('coalesced fires take no slot', runningIds().length === 3 && queuedIds().length === 1)

  // ── A completion promotes the queued job into the freed slot ───────────
  gates.get('B')!()
  await sleep(60)
  ok('B ended completed', ended.includes('job-b:completed'))
  ok(
    'D promoted into the freed slot',
    [...runningIds()].sort().join(',') === 'job-a,job-c,job-d',
    runningIds().join(',')
  )
  ok('queue drained', queuedIds().length === 0)

  // ── A failing run reports failed and frees its slot ────────────────────
  const rf = bs.runDetached('f', 'FAIL', 'job-f')
  ok('failure job queues behind the full pool', rf.ok && !rf.started)
  gates.get('A')!()
  await sleep(60)
  ok('FAIL ran and failed', ended.includes('job-f:failed'))
  ok(
    'pool survives the failure',
    [...runningIds()].sort().join(',') === 'job-c,job-d',
    runningIds().join(',')
  )

  // ── The brainstem job id threads into the autonomous turn ──────────────
  ok('jobId threaded (A)', jobIdsSeen.get('A') === 'job-a')
  ok('jobId threaded (FAIL)', jobIdsSeen.get('FAIL') === 'job-f')

  // ── Concurrency never exceeded the cap ─────────────────────────────────
  ok('cap respected', maxActive === MAX_CONCURRENT_JOBS, String(maxActive))

  // ── Drain the rest ─────────────────────────────────────────────────────
  gates.get('C')!()
  gates.get('D')!()
  await sleep(60)
  ok('pool empty after drain', runningIds().length === 0 && queuedIds().length === 0)
  const last = snapshots[snapshots.length - 1]
  ok('final snapshot is empty', last.running.length === 0 && last.queued.length === 0)
  ok(
    'every non-failing run completed',
    ended.filter((e) => e.endsWith(':completed')).length === 4,
    ended.join(' ')
  )

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
