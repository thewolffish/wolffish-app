import {
  createConversation,
  generateTitle,
  saveConversation,
  type ConversationFile,
  type ConversationMessage
} from '@main/conversations'
import { diskWriter } from '@main/io/diskWriter'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Amygdala, SafetyBlockedError } from '@main/runtime/amygdala'
import { BasalGanglia } from '@main/runtime/basalganglia'
import { Brainstem } from '@main/runtime/brainstem'
import {
  Broca,
  type Segment,
  type SegmentSink,
  type SegmentTurnEndReason,
  type ToolResultStatus
} from '@main/runtime/broca'
import { Cerebellum, type OrchestratorHost } from '@main/runtime/cerebellum'
import { compactOverflow } from '@main/runtime/compactor'
import { Corpus } from '@main/runtime/corpus'
import { Cortex } from '@main/runtime/cortex'
import { Device } from '@main/runtime/device'
import { Hippocampus, type TurnToolCall } from '@main/runtime/hippocampus'
import { Hypothalamus } from '@main/runtime/hypothalamus'
import { Insula } from '@main/runtime/insula'
import { Motor } from '@main/runtime/motor'
import {
  OrchestrationSession,
  type WorkerEffort,
  type WorkerResult
} from '@main/runtime/orchestrator'
import { formatRuntimeStatus } from '@main/runtime/outbound'
import { Prefrontal } from '@main/runtime/prefrontal'
import { RAS } from '@main/runtime/ras'
import {
  Thalamus,
  type ChatMessage,
  type NoProviderAvailableInfo,
  type ProviderId,
  type StopReason,
  type StreamChunk,
  type StreamUsage,
  type ToolDefinition,
  type ToolUse,
  type UserContentBlock
} from '@main/runtime/thalamus'
import { Usage, calculateCost } from '@main/runtime/usage'
import { cloudModelSupportsVision } from '@main/runtime/vision'
import { Wernicke } from '@main/runtime/wernicke'
import {
  processAttachments,
  type FileProcessorOptions,
  type MessageAttachmentInput
} from '@main/uploads/file-processor'
import { isInternalToolCall, readConfig } from '@main/workspace/workspace'

/**
 * Maximum number of tools each provider API accepts per request.
 * Only providers with a confirmed, documented limit are listed here.
 * Providers not in this map have no known hard limit — all tools are
 * sent through unfiltered.
 */
const PROVIDER_TOOL_LIMITS: Record<string, number> = {
  openai: 128,
  xai: 200
}

/**
 * Result text injected for a tool call that was announced to the model but
 * never finished because the run was stopped (or errored) mid-flight. Must
 * be non-empty — Anthropic rejects empty tool_result content — and reads as
 * a normal tool failure so a continued conversation makes sense to the model.
 */
const INTERRUPTED_TOOL_RESULT =
  'Tool execution was interrupted before it completed because the run was stopped. No output was produced.'

/**
 * When a max_tokens/length stop arrives but the input is within this many
 * tokens of the model's context window, there is no room left to generate
 * into. Continuing would just feed a "continue" turn that gets truncated
 * away, so the loop is ended instead. Guards the local-model case where the
 * prompt grows to fill num_ctx and the model can only emit ~1 token per call,
 * spinning the max_tokens continuation forever.
 */
const CONTEXT_FULL_MARGIN_TOKENS = 512

export type AgentOptions = {
  thalamus: Thalamus
  workspaceRoot: string
  getActiveModel?: () => string | null
  defaultBudgetTokens?: number
}

export type AgentTurnOptions = {
  history: ChatMessage[]
  turnId: string
  onSegment: SegmentSink
  signal?: AbortSignal
  /**
   * Stable conversation id reserved by the renderer before send. Threaded
   * through to the cerebellum so plugins can stamp per-conversation
   * artifacts (voice memos, attachments) with it. Optional so non-chat
   * call sites don't have to invent one.
   */
  conversationId?: string | null
  conversationTitle?: string | null
  /**
   * Isolated Broca instance for this turn. When provided, the turn uses
   * this instead of the shared `this.broca`, preventing state collision
   * between concurrent turns (e.g. heartbeat jobs vs interactive chat).
   */
  broca?: import('@main/runtime/broca').Broca
  /**
   * When true, confirm/destructive tool calls are auto-approved without
   * going through the approval bridge. Block-level calls still block.
   * Used by autonomous heartbeat jobs that cannot prompt a human.
   */
  bypassApproval?: boolean
  thinkingMode?: 'off' | 'on' | 'high' | 'max'
  /**
   * Which model resolves this turn (orchestrator mode). 'worker' streams on the
   * worker model; omitted/'orchestrator' uses the Brain. Per-turn, so a worker
   * turn and the orchestrator turn resolve to different models concurrently.
   */
  role?: 'orchestrator' | 'worker'
}

export type AgentTurnResult = {
  stopReason: SegmentTurnEndReason | 'canceled'
  toolCalls: number
  taskId?: string
}

export type AutonomousTurnOptions = {
  instruction: string
  jobLabel: string
  signal?: AbortSignal
}

export type AutonomousTurnResult = {
  success: boolean
  response: string
  toolCalls: number
  conversationId: string
}

/**
 * Agent is the brain. It owns one instance of every region and runs the
 * pipeline below for each turn.
 *
 * Wolffish Brain Pipeline
 * 1.  thalamus     → classify + route input
 * 2.  ras          → filter relevant context
 * 3.  prefrontal   → build context + plan approach
 * 4.  cortex       → search index for relevant memories
 * 5.  hippocampus  → load recent episodes + knowledge
 * 6.  cerebellum   → load matching skills
 * 7.  [LLM CALL]   → send assembled context to model
 * 8.  wernicke     → parse response, extract tool calls
 * 9.  amygdala     → safety check each tool call
 * 10. motor        → execute approved tool calls
 * 11. broca        → emit segments to renderer
 * 12. hippocampus  → save conversation to episode
 * 13. basalganglia → record outcome
 * 14. corpus       → emit events throughout
 * 15. hypothalamus → monitor health throughout
 * 16. brainstem    → background processes (independent)
 * 17. insula       → available on-demand for introspection
 *
 * The tool-use loop runs the model and amygdala-gated motor execution
 * for as long as the model keeps calling tools. There is no framework
 * cap on iterations — loop detection is the model's responsibility,
 * informed by the <runtime> block prefrontal injects each iteration
 * and the procedures in agents.md. Every turn — successful, canceled,
 * or errored — emits a turn_end segment so the renderer always has a
 * closing marker, even when the model produces only tool calls and no
 * prose.
 */
export class Agent {
  readonly thalamus: Thalamus
  readonly prefrontal: Prefrontal
  readonly corpus: Corpus
  readonly ras: RAS
  readonly cortex: Cortex
  readonly hippocampus: Hippocampus
  readonly cerebellum: Cerebellum
  readonly wernicke: Wernicke
  readonly broca: Broca
  readonly amygdala: Amygdala
  readonly motor: Motor
  readonly basalganglia: BasalGanglia
  readonly hypothalamus: Hypothalamus
  readonly brainstem: Brainstem
  readonly insula: Insula
  readonly device: Device
  readonly usage: Usage

  private cortexReady: Promise<void> | null = null
  private cerebellumReady: Promise<void> | null = null

  // Orchestrator mode (Phase 2). `orchestratorMode` is the global Brain setting.
  // The active orchestrator turn's worker registry rides on AsyncLocalStorage —
  // NOT a single Agent field — so concurrent top-level turns (a channel turn and
  // a heartbeat job, two channels) each get their OWN session and can't clobber
  // one another. A worker turn runs with a null orchestration scope (it never
  // delegates), even though it's spawned inside the orchestrator's async context.
  private orchestratorMode: 'single' | 'orchestrator' = 'single'
  private orchestrationCtx = new AsyncLocalStorage<OrchestrationSession | null>()

  constructor(options: AgentOptions) {
    this.thalamus = options.thalamus

    const workspaceRoot = options.workspaceRoot
    this.corpus = new Corpus({ workspaceRoot })
    this.thalamus.setCorpus(this.corpus)

    const corpus = this.corpus
    const getContextBudget = options.defaultBudgetTokens
      ? () => options.defaultBudgetTokens!
      : () => this.thalamus.getContextBudget()
    this.ras = new RAS({ corpus, totalBudgetTokens: getContextBudget() })
    this.cortex = new Cortex({ workspaceRoot, corpus })
    this.amygdala = new Amygdala({ corpus })
    this.cerebellum = new Cerebellum({
      workspaceRoot,
      amygdala: this.amygdala,
      corpus
    })
    this.hippocampus = new Hippocampus({ workspaceRoot, corpus })
    this.basalganglia = new BasalGanglia({ workspaceRoot, corpus })
    this.device = new Device()
    this.prefrontal = new Prefrontal({
      workspaceRoot,
      cortex: this.cortex,
      ras: this.ras,
      cerebellum: this.cerebellum,
      hippocampus: this.hippocampus,
      basalganglia: this.basalganglia,
      corpus,
      device: this.device,
      getContextBudget,
      getContextWindow: () => this.thalamus.getActiveContextWindow()
    })
    this.wernicke = new Wernicke({ corpus })
    this.broca = new Broca({ corpus, shouldSilenceToolCall: isInternalToolCall })
    this.motor = new Motor({ workspaceRoot, cerebellum: this.cerebellum, corpus })
    this.hypothalamus = new Hypothalamus({
      corpus,
      workspaceRoot,
      cerebellum: this.cerebellum,
      thalamus: this.thalamus,
      device: this.device,
      getContextBudget,
      getActiveModel: options.getActiveModel
    })
    this.brainstem = new Brainstem({
      workspaceRoot,
      corpus,
      cortex: this.cortex,
      hippocampus: this.hippocampus,
      thalamus: this.thalamus
    })
    this.brainstem.setAgent(this)
    this.insula = new Insula({
      corpus,
      workspaceRoot,
      hypothalamus: this.hypothalamus,
      basalganglia: this.basalganglia,
      hippocampus: this.hippocampus
    })
    this.usage = new Usage({ workspaceRoot, corpus })
  }

  /**
   * Bring background services up: cortex SQLite index and the cerebellum's
   * capability scan. Both are safe to call repeatedly; the work only runs
   * once.
   */
  async init(): Promise<void> {
    if (!this.cortexReady) {
      this.cortexReady = this.cortex.init().catch((err) => {
        this.cortexReady = null
        throw err
      })
    }
    if (!this.cerebellumReady) {
      this.cerebellumReady = this.cerebellum
        .loadAll()
        .then(() => undefined)
        .catch((err) => {
          this.cerebellumReady = null
          throw err
        })
    }
    await Promise.all([this.cortexReady, this.cerebellumReady])
    await this.brainstem.init().catch(() => undefined)
    this.hypothalamus.init()
  }

  async stop(): Promise<void> {
    await this.hypothalamus.stop().catch(() => undefined)
    await this.brainstem.stop().catch(() => undefined)
    this.cortex.close()
    await this.cerebellum.stop().catch(() => undefined)
    await this.corpus.stop()
  }

  /**
   * Set the global orchestrator mode. In 'orchestrator' mode a top-level
   * (non-worker) turn becomes an orchestrator: it owns a worker registry and
   * the delegation capability is live. In 'single' mode every turn runs solo
   * exactly as in Phase 1. Pushed from config at startup and on the
   * provider:setOrchestratorMode IPC.
   */
  setOrchestratorMode(mode: 'single' | 'orchestrator'): void {
    this.orchestratorMode = mode
  }

  /**
   * The worker-management bridge handed to the `orchestrator` capability's
   * plugin (via cerebellum.setOrchestratorHost). Every method operates on the
   * active orchestrator turn's registry — the single source of truth — and
   * throws if no orchestrator turn is in flight (which the capability gating
   * makes unreachable in practice).
   */
  orchestratorHost(): OrchestratorHost {
    const session = (): OrchestrationSession => {
      // Resolve the session for the turn whose tool call is executing right now
      // (ALS follows the async call tree), so two concurrent orchestrator turns
      // never reach into each other's registry.
      const active = this.orchestrationCtx.getStore()
      if (!active) {
        throw new Error(
          'no active orchestration — delegation tools are only available to the orchestrator during an orchestrator-mode turn'
        )
      }
      return active
    }
    return {
      spawnWorker: (prompt, branchLabel, effort) => session().spawn(prompt, branchLabel, effort),
      sendToWorker: (id, prompt, effort) => session().sendTo(id, prompt, effort),
      awaitWorkers: (ids) => session().awaitNext(ids),
      closeWorker: (id) => session().close(id),
      cancelWorker: (id) => session().cancel(id),
      listWorkers: () => session().list()
    }
  }

  /**
   * Drive one worker turn to completion on the worker model and harvest its
   * final text. A worker is a real `respond()` turn with: a fresh Broca (its
   * segments never reach the user sink), `role:'worker'` (resolves the worker
   * model + the worker toolset minus delegation/channel), `conversationId:null`
   * (invisible — no episode persistence), `bypassApproval` (the orchestrator is
   * its operator), and its own abort signal (the registry kills it on cancel).
   */
  private async runWorkerTurn(
    parent: AgentTurnOptions,
    workerId: string,
    label: string,
    history: ChatMessage[],
    signal: AbortSignal,
    effort?: WorkerEffort
  ): Promise<WorkerResult> {
    const workerBroca = new Broca({
      corpus: this.corpus,
      shouldSilenceToolCall: isInternalToolCall
    })
    const segments: Segment[] = []
    const worker = { id: workerId, label }
    // No black box: forward the worker's user-visible segments (text + tool
    // call/result) into the ORCHESTRATOR turn's sink — re-stamped to the parent
    // turnId so the renderer accumulates them into the orchestrator's message
    // (and persists them), tagged `worker` so they render marked as subagent
    // activity, and toolCallId/segmentId namespaced so concurrent workers can't
    // collide in the merged stream.
    const result = await this.respond({
      history: [...history],
      turnId: `${parent.turnId}::w_${workerId}`,
      onSegment: (seg) => {
        segments.push(seg)
        if (seg.kind === 'text') {
          parent.onSegment({
            ...seg,
            turnId: parent.turnId,
            segmentId: `${workerId}:${seg.segmentId}`,
            worker
          })
        } else if (seg.kind === 'tool_call' || seg.kind === 'tool_result') {
          parent.onSegment({
            ...seg,
            turnId: parent.turnId,
            segmentId: `${workerId}:${seg.segmentId}`,
            toolCallId: `${workerId}:${seg.toolCallId}`,
            worker
          })
        }
      },
      signal,
      conversationId: null,
      broca: workerBroca,
      bypassApproval: true,
      role: 'worker',
      // The orchestrator sets each worker's reasoning effort; omitted ⇒ the
      // worker model's provider default. The user's Brain reasoning setting
      // drives only the orchestrator turn, never the workers. A worker never
      // retries at the code level (thalamus retry is orchestrator-only) — a
      // failure surfaces to the orchestrator, which decides whether to re-run.
      thinkingMode: effort
    })
    const text = segments
      .filter((s): s is Extract<Segment, { kind: 'text' }> => s.kind === 'text')
      .map((s) => s.delta)
      .join('')
      .trim()
    return {
      text: text || '(worker produced no text output)',
      stopReason: String(result.stopReason),
      toolCalls: result.toolCalls
    }
  }

  private async processHistoryAttachments(history: ChatMessage[]): Promise<ChatMessage[]> {
    const provider = this.thalamus.getActiveProvider()
    const providerKey: FileProcessorOptions['provider'] =
      provider === 'anthropic'
        ? 'anthropic'
        : provider === 'openai'
          ? 'openai'
          : provider === 'deepseek'
            ? 'deepseek'
            : provider === 'mimo'
              ? 'mimo'
              : provider === 'kimi'
                ? 'kimi'
                : provider === 'minimax'
                  ? 'minimax'
                  : 'local'
    // Branch on the real provider id, not providerKey — providerKey
    // collapses providers missing from FileProcessorOptions (xai, qwen,
    // stepfun, openrouter) to 'local', and asking Ollama about a cloud
    // model's vision support answers the wrong question.
    const supportsVision =
      provider === null || provider === 'local'
        ? await this.thalamus.localSupportsVision()
        : cloudModelSupportsVision(provider, this.thalamus.getActiveModel() ?? '')

    const out: ChatMessage[] = []
    for (const m of history) {
      if (m.role !== 'user') {
        out.push(m)
        continue
      }
      const raw = m as {
        role: 'user'
        content: string | UserContentBlock[]
        attachments?: MessageAttachmentInput[]
      }
      if (!raw.attachments || raw.attachments.length === 0) {
        out.push(m)
        continue
      }
      const fileBlocks = await processAttachments(raw.attachments, {
        provider: providerKey,
        supportsVision
      })
      if (fileBlocks.length === 0) {
        out.push(m)
        continue
      }
      const textContent = typeof raw.content === 'string' ? raw.content : ''
      const blocks: UserContentBlock[] = []
      if (textContent) blocks.push({ type: 'text', text: textContent })
      blocks.push(...fileBlocks)
      out.push({ role: 'user', content: blocks })
    }
    return out
  }

  /**
   * Run one turn. Establishes the turn-scoped conversation (AsyncLocalStorage)
   * so the tool calls inside it stamp artifacts with THIS turn's conversation,
   * even while concurrent worker turns run with their own (null) scope. Workers
   * are nested respond() calls; each gets its own scope here.
   */
  async respond(turn: AgentTurnOptions): Promise<AgentTurnResult> {
    // A top-level turn in orchestrator mode owns a worker registry; a worker turn
    // and single mode do not. The session is created here and pinned to this
    // turn's async scope (orchestrationCtx.run) so the OrchestratorHost resolves
    // THIS turn's registry even when several top-level turns run concurrently.
    const isOrchestratorTurn = turn.role !== 'worker' && this.orchestratorMode === 'orchestrator'
    const orchestration: OrchestrationSession | null = isOrchestratorTurn
      ? new OrchestrationSession(({ workerId, label, history, signal, effort }) =>
          this.runWorkerTurn(turn, workerId, label, history, signal, effort)
        )
      : null
    return this.cerebellum.runWithConversation(turn.conversationId ?? null, () =>
      this.orchestrationCtx.run(orchestration, () => this.runRespond(turn, orchestration))
    )
  }

  private async runRespond(
    turn: AgentTurnOptions,
    orchestration: OrchestrationSession | null
  ): Promise<AgentTurnResult> {
    await this.init().catch(() => undefined)

    const lastMessage = turn.history[turn.history.length - 1]
    const userContent =
      lastMessage && lastMessage.role === 'user'
        ? typeof lastMessage.content === 'string'
          ? lastMessage.content
          : ''
        : ''
    this.corpus.emit('message.received', {
      content: userContent,
      timestamp: new Date().toISOString()
    })

    const broca = turn.broca ?? this.broca

    const messages: ChatMessage[] = await this.processHistoryAttachments([...turn.history])
    let task: Awaited<ReturnType<typeof this.motor.createTask>> | null = null
    let totalToolCalls = 0
    let iterationCount = 0
    let stopReason: SegmentTurnEndReason | 'canceled' = 'end_turn'
    let lastAssistantText = ''
    let lastReasoningContent: string | undefined
    let noProviderAvailable: NoProviderAvailableInfo[] | null = null
    let providerErrors: NoProviderAvailableInfo[] | undefined
    const turnTools: TurnToolCall[] = []
    let turnUsage: StreamUsage = { inputTokens: 0, outputTokens: 0 }
    let turnProvider: ProviderId | null = null
    let turnModel: string | null = null
    // Track the most recent LLM response's input token count (uncached +
    // cache reads — providers report them separately). This is ground
    // truth from the provider and beats any char-based estimation.
    // Passed to compactOverflow so it can calibrate against reality.
    let lastIterationInputTokens = 0
    // When a context-overflow 400 fires, we force compaction and retry
    // exactly once. This flag prevents infinite retry loops.
    let contextOverflowRetried = false

    // Context optimization gates (default on). `enabled` pins the system
    // prompt and tool list for the whole turn so every byte upstream of
    // the messages tail stays cache-stable; the live loop counters travel
    // as an outbound-only volatile tail message instead. `truncation`
    // additionally collapses provably superseded/duplicated payloads in
    // the outbound clone (internal history is never touched). Disabling
    // `enabled` restores the legacy per-iteration prompt rebuild.
    const cfg = await readConfig().catch(() => null)
    const optimizationConfig = cfg?.contextOptimization
    const optimizeContext = optimizationConfig?.enabled !== false
    const truncateOutbound = optimizeContext && optimizationConfig?.truncation !== false
    // Local models get no tools by default. Wolffish's full ~20k-token tool
    // catalog fills a small local model's context and starves the response; a
    // tiny model also tends to misuse tools and loop. When restrictLocalModels
    // is on (default) and this turn resolves to the local provider, we omit both
    // the <tools> prompt section (via buildSystemPrompt omitTools) and the native
    // tools API param (filteredTools = []), and the model is told it has no tools
    // and how the user can enable them. Opt out in Settings for a capable model.
    // Stable for the whole turn — the active provider can't change mid-loop.
    const suppressLocalTools =
      cfg?.llm.restrictLocalModels !== false && this.thalamus.getActiveProvider() === 'local'
    let pinnedSystemPrompt: string | null = null
    let pinnedTools: ToolDefinition[] | null = null
    // Cerebellum tool-surface version captured when the pin was built. When a
    // skill is created/edited/enabled/disabled mid-turn (via the `skills`
    // capability), the cerebellum's generation moves and we rebuild the pin
    // on the next iteration — so the new/edited tool is callable in the SAME
    // turn, enabling create→load→test→edit→retest without ending the turn.
    let pinnedGeneration = -1

    broca.beginTurn(turn.turnId, turn.onSegment)
    // Publish the active conversation to the UI/extension ONCE, for real
    // (non-worker) turns only — a worker is invisible and must never flip the
    // visible conversation. The turn-scoped stamp itself rides on ALS (see
    // respond), so this is purely the global + conversation.changed emit.
    if (turn.role !== 'worker') {
      this.cerebellum.setCurrentConversationId(turn.conversationId ?? null, turn.conversationTitle)
    }

    // `orchestration` (created in respond() and already pinned to this turn's ALS
    // scope) is non-null exactly for a top-level orchestrator turn. The tool
    // surface keys off it: orchestrator → delegation visible; a single-mode
    // top-level turn → undefined (hidden); a worker → 'worker'.
    const isOrchestratorTurn = orchestration !== null
    const toolRole: 'orchestrator' | 'worker' | undefined =
      turn.role === 'worker' ? 'worker' : isOrchestratorTurn ? 'orchestrator' : undefined
    let onTurnAbort: (() => void) | null = null
    if (orchestration && turn.signal) {
      // Cancel propagation: if the turn aborts while the orchestrator is parked
      // in await_workers, dispose wakes the awaiter so the tool loop can unwind.
      const session = orchestration
      onTurnAbort = () => session.dispose()
      turn.signal.addEventListener('abort', onTurnAbort)
    }

    try {
      while (true) {
        if (turn.signal?.aborted) {
          stopReason = 'canceled'
          break
        }

        iterationCount += 1

        const runtime = {
          iteration: iterationCount,
          toolsCalled: totalToolCalls,
          renderCounters: !optimizeContext
        }

        let systemPrompt: string
        let filteredTools: ToolDefinition[]
        if (optimizeContext) {
          // Task-start pin: prompt and tools are derived once per turn and
          // reused across iterations. Rebuilt only when the cerebellum's
          // tool surface changes mid-turn (a skill created/edited/toggled).
          const currentGeneration = this.cerebellum.getGeneration()
          if (
            pinnedSystemPrompt === null ||
            pinnedTools === null ||
            pinnedGeneration !== currentGeneration
          ) {
            pinnedSystemPrompt = await this.prefrontal.buildSystemPrompt(
              userContent,
              runtime,
              toolRole,
              { omitTools: suppressLocalTools }
            )
            pinnedTools = suppressLocalTools
              ? []
              : this.filterToolsForProvider(this.prefrontal.selectTools(toolRole), userContent)
            pinnedGeneration = currentGeneration
          }
          systemPrompt = pinnedSystemPrompt
          filteredTools = pinnedTools
        } else {
          // Legacy path: rebuild the system prompt each iteration so the
          // <runtime> block reflects the live iteration counter.
          systemPrompt = await this.prefrontal.buildSystemPrompt(userContent, runtime, toolRole, {
            omitTools: suppressLocalTools
          })
          filteredTools = suppressLocalTools
            ? []
            : this.filterToolsForProvider(this.prefrontal.selectTools(toolRole), userContent)
        }

        // Context Compaction: if context exceeds the model's input budget,
        // use LLM-generated summaries to reduce size while retaining
        // critical details. Only fires when actually needed.
        const compactionStart = Date.now()
        const compaction = await compactOverflow(
          this.thalamus,
          systemPrompt,
          messages,
          turn.signal,
          {
            tools: filteredTools.length > 0 ? filteredTools : undefined,
            lastKnownInputTokens: lastIterationInputTokens,
            onStarted: (targetsCount, currentTokens) => {
              this.corpus.emit('compaction.started', { messagesCount: messages.length })
              const contextWindow = this.thalamus.getActiveContextWindow()
              broca.emitCompactionStarted(
                turn.turnId,
                messages.length,
                targetsCount,
                currentTokens,
                contextWindow
              )
            }
          }
        )
        if (compaction) {
          const compactionDurationMs = Date.now() - compactionStart
          broca.emitCompaction(
            turn.turnId,
            compaction.targets.length,
            compaction.tokensSaved,
            compactionDurationMs,
            compaction.targets.map((t) => ({
              toolName: t.toolName,
              originalChars: t.originalChars,
              compactedChars: t.compactedChars,
              compactedBy: t.compactedBy
            }))
          )
          this.corpus.emit('compaction.applied', {
            tokensSaved: compaction.tokensSaved,
            targetsCount: compaction.targets.length
          })
        }

        const stream = this.thalamus.stream({
          system: systemPrompt,
          messages,
          tools: filteredTools.length > 0 ? filteredTools : undefined,
          signal: turn.signal,
          role: turn.role,
          thinkingMode: turn.thinkingMode,
          cacheKey: turn.conversationId ?? turn.turnId,
          truncateOutbound,
          // The live runtime tail (host clock + loop counters) rides at the
          // very end of the outbound clone — omitted on iteration 1, as
          // before, so the first cache write is a clean prefix. It renders
          // strictly after every cache breakpoint (see anthropic.ts), so it
          // never perturbs a prefix hash.
          volatileStatus:
            optimizeContext && iterationCount > 1
              ? formatRuntimeStatus({ iteration: iterationCount, toolsCalled: totalToolCalls })
              : undefined
        })
        const teed = broca.streamSegments(stream)
        const tracked = captureUsage(teed, (provider, model, usage) => {
          if (provider) turnProvider = provider
          if (model) turnModel = model
          if (usage) {
            // Track per-iteration input tokens for compaction calibration.
            // This is ground truth from the provider — use it on the next
            // iteration to catch cases where char estimation underestimates.
            // Cache reads count: they are real context the model ingested,
            // and once caching works they dominate the total.
            lastIterationInputTokens = usage.inputTokens + (usage.cacheReadTokens ?? 0)
            turnUsage = {
              inputTokens: turnUsage.inputTokens + usage.inputTokens,
              outputTokens: turnUsage.outputTokens + usage.outputTokens,
              cacheCreationTokens:
                (turnUsage.cacheCreationTokens ?? 0) + (usage.cacheCreationTokens ?? 0),
              cacheReadTokens: (turnUsage.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0)
            }
          }
        })
        const parsed = await this.wernicke.parse(tracked)

        if (turn.signal?.aborted) {
          stopReason = 'canceled'
          break
        }

        if (parsed.error) {
          // Detect context-overflow 400s: the provider rejected the request
          // because the payload exceeded its context window. Instead of
          // crashing, force compaction and retry exactly once.
          const isContextOverflow =
            /maximum context length|context.length.*exceeded|too many tokens|reduce the length/i.test(
              parsed.error
            )

          if (isContextOverflow && !contextOverflowRetried) {
            contextOverflowRetried = true
            console.log(
              `[agent] Context overflow detected — forcing compaction and retrying. ` +
                `Error: ${parsed.error.slice(0, 200)}`
            )
            // Note: not emitting a corpus event here to avoid type changes.
            // The console.log above provides observability.

            // Force compaction — bypasses the estimate check and compacts
            // the largest messages unconditionally.
            const overflowCompactionStart = Date.now()
            const overflowCompaction = await compactOverflow(
              this.thalamus,
              systemPrompt,
              messages,
              turn.signal,
              {
                tools: filteredTools.length > 0 ? filteredTools : undefined,
                lastKnownInputTokens: lastIterationInputTokens,
                force: true,
                onStarted: (targetsCount, currentTokens) => {
                  this.corpus.emit('compaction.started', {
                    messagesCount: messages.length,
                    force: true
                  })
                  const contextWindow = this.thalamus.getActiveContextWindow()
                  broca.emitCompactionStarted(
                    turn.turnId,
                    messages.length,
                    targetsCount,
                    currentTokens,
                    contextWindow
                  )
                }
              }
            )
            if (overflowCompaction) {
              const dur = Date.now() - overflowCompactionStart
              broca.emitCompaction(
                turn.turnId,
                overflowCompaction.targets.length,
                overflowCompaction.tokensSaved,
                dur,
                overflowCompaction.targets.map((t) => ({
                  toolName: t.toolName,
                  originalChars: t.originalChars,
                  compactedChars: t.compactedChars,
                  compactedBy: t.compactedBy
                }))
              )
              this.corpus.emit('compaction.applied', {
                tokensSaved: overflowCompaction.tokensSaved,
                targetsCount: overflowCompaction.targets.length
              })
            }
            // Don't increment iterationCount — this is a retry of the same
            // iteration, not a new one. Just loop back to rebuild prompt
            // and re-call the LLM with the compacted messages.
            iterationCount -= 1
            continue
          }

          if (parsed.noProviderAvailable) {
            stopReason = 'no_provider_available'
            noProviderAvailable = parsed.noProviderAvailable
          } else {
            stopReason = 'error'
            if (parsed.providerFailures) {
              providerErrors = parsed.providerFailures
            }
          }
          if (task) await this.motor.completeTask(task.id, 'failed').catch(() => undefined)
          throw new Error(parsed.error)
        }

        if (parsed.thinking) lastReasoningContent = parsed.thinking

        if (parsed.toolCalls.length === 0) {
          if (parsed.stopReason === 'max_tokens') {
            // A max_tokens stop normally means the reply was cut off mid-output,
            // so we let the model continue. But when the *input* already fills
            // the context window there is no room to generate into — the
            // "continue" turn below just gets truncated away and the loop spins
            // forever emitting ~1 token per call (a local model whose prompt has
            // grown to num_ctx). Detect that and end the turn with what we have.
            const contextWindow = this.thalamus.getActiveContextWindow()
            const contextFull =
              lastIterationInputTokens >= contextWindow - CONTEXT_FULL_MARGIN_TOKENS
            if (contextFull) {
              console.log(
                `[agent] max_tokens stop with context full ` +
                  `(${lastIterationInputTokens}/${contextWindow} input tokens) — ` +
                  `ending turn (iter ${iterationCount})`
              )
              lastAssistantText = parsed.text
              stopReason = 'max_tokens'
              break
            }
            console.log(`[agent] max_tokens truncation — continuing (iter ${iterationCount})`)
            const truncatedMsg: ChatMessage = { role: 'assistant', content: parsed.text }
            if (parsed.thinking) truncatedMsg.reasoningContent = parsed.thinking
            messages.push(truncatedMsg)
            messages.push({
              role: 'user',
              content:
                '[System: Your previous response was truncated by the output token limit. Do NOT repeat what you already said. Continue from where you stopped.]'
            })
            continue
          }

          lastAssistantText = parsed.text
          stopReason = mapProviderStopReason(parsed.stopReason)
          break
        }

        // The LLM wants to call tools. Materialize a task on first iteration
        // so the renderer can show task progress alongside the streaming reply.
        if (!task) {
          task = await this.motor.createTask(userContent || 'Tool execution')
        }

        const toolUses: ToolUse[] = parsed.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: tc.args
        }))
        const assistantMsg: ChatMessage = { role: 'assistant', content: parsed.text, toolUses }
        if (parsed.thinking) assistantMsg.reasoningContent = parsed.thinking
        messages.push(assistantMsg)

        let aborted = false
        for (const call of parsed.toolCalls) {
          if (turn.signal?.aborted) {
            aborted = true
            break
          }

          const argsSummary = summarizeArgs(call.args)

          // Resolve dependencies BEFORE the original tool's safety gate.
          // ensureDependencies has its own internal amygdala approvals for
          // each install in the chain, so the user sees install dialogs in
          // chain order. If the chain fails, surface the error to the LLM
          // and skip both the original tool's safety check and execution.
          //
          // Pass a hook so synthetic install calls surface as real broca
          // segments. The approval card keys off matching tool_call
          // segments — without one the IPC fires fine but the dialog
          // never renders and the install Promise hangs.
          try {
            const depCapName = this.cerebellum.getToolCapability(call.name)
            if (depCapName) {
              const turnId = turn.turnId
              await this.cerebellum.ensureDependencies(depCapName, {
                emitToolCall: (id, name, args) => broca.emitToolCall(turnId, id, name, args),
                emitToolResult: (id, status, output, error) =>
                  broca.emitToolResult(turnId, id, status, output, error)
              })
            }
          } catch (depErr) {
            const depMessage = depErr instanceof Error ? depErr.message : String(depErr)
            const output = `Dependency error: ${depMessage}`
            messages.push({
              role: 'tool',
              toolUseId: call.id,
              toolName: call.name,
              content: output,
              isError: true
            })
            broca.emitToolResult(turn.turnId, call.id, 'failed', output, depMessage)
            turnTools.push({ name: call.name, argsSummary, outcome: 'failed' })
            continue
          }

          const silent = broca.isSilent(call.id)
          const match = silent ? null : this.amygdala.match(call)
          const level = match?.level ?? 'safe'

          if (level === 'block') {
            const reason = match?.reason ?? 'destructive operation'
            const output = `Blocked by safety policy: ${reason}`
            messages.push({
              role: 'tool',
              toolUseId: call.id,
              toolName: call.name,
              content: output,
              isError: true
            })
            this.corpus.emit('safety.blocked', {
              tool: call.name,
              args: call.args,
              reason: match?.reason ?? 'blocked'
            })
            broca.emitToolResult(turn.turnId, call.id, 'denied', output, reason)
            turnTools.push({ name: call.name, argsSummary, outcome: 'blocked' })
            await this.basalganglia
              .recordOutcome({
                timestamp: new Date(),
                tool: call.name,
                outcome: 'blocked',
                args: call.args,
                reason
              })
              .catch(() => undefined)
            continue
          }

          if (level === 'confirm' || level === 'destructive') {
            if (turn.bypassApproval || this.amygdala.isBypassingPermissions()) {
              this.corpus.emit('safety.autoApproved', {
                id: `auto_${Date.now().toString(36)}`,
                tool: call.name,
                args: call.args,
                level,
                reason: match?.reason ?? 'requires confirmation'
              })
            } else {
              const description = await this.cerebellum
                .describeToolCall(call.name, call.args)
                .catch(() => undefined)
              const decision = await this.amygdala.requestApproval({
                toolCall: call,
                level,
                reason: match?.reason ?? 'requires confirmation',
                description
              })
              if (decision === 'denied') {
                const reason = match?.reason ?? 'requires confirmation'
                const output = `Denied by user: ${reason}`
                messages.push({
                  role: 'tool',
                  toolUseId: call.id,
                  toolName: call.name,
                  content: output,
                  isError: true
                })
                if (task) {
                  await this.motor.recordDeniedStep(task.id, call, output).catch(() => undefined)
                }
                broca.emitToolResult(turn.turnId, call.id, 'denied', output, reason)
                turnTools.push({ name: call.name, argsSummary, outcome: 'denied' })
                await this.basalganglia
                  .recordOutcome({
                    timestamp: new Date(),
                    tool: call.name,
                    outcome: 'denied',
                    args: call.args,
                    reason
                  })
                  .catch(() => undefined)
                continue
              }
            }
          } else {
            this.corpus.emit('safety.allowed', {
              tool: call.name,
              args: call.args
            })
          }

          let result: {
            ok: boolean
            output: string
            images?: Array<{ mediaType: string; data: string }>
            verbose?: string
          }
          try {
            const r = await this.motor.executeStep(task.id, call, turn.signal)
            result = { ok: r.ok, output: r.output, images: r.images, verbose: r.verbose }
          } catch (err) {
            if (err instanceof SafetyBlockedError) {
              result = { ok: false, output: `Blocked: ${err.reason}` }
            } else {
              const message = err instanceof Error ? err.message : String(err)
              result = { ok: false, output: `Tool error: ${message}` }
            }
          }
          totalToolCalls += 1

          const status: ToolResultStatus = result.ok ? 'success' : 'failed'

          // Tools whose name ends with _to_chat inject their output directly
          // into the chat stream instead of showing a tool result card.
          // Multi-line output (e.g. several GIFs) is split on newlines so
          // each non-empty line gets its own bubble via a separator flush.
          if (call.name.endsWith('_to_chat') && result.ok && result.output) {
            const lines = result.output.split('\n').filter((l) => l.trim().length > 0)
            for (let i = 0; i < lines.length; i++) {
              broca.emitText(turn.turnId, lines[i])
              if (i < lines.length - 1) broca.emitSeparator(turn.turnId)
            }
            broca.emitToolResult(turn.turnId, call.id, 'success', 'Added to chat.', undefined)
          } else {
            broca.emitToolResult(
              turn.turnId,
              call.id,
              status,
              result.output,
              // UI-only `error` carries the raw original (full stdout+stderr)
              // so the user sees it as-is in a scrollable block. `output` keeps
              // the classified message — the only field replayed into model
              // context — so the verbose dump never clouds the conversation.
              result.ok ? undefined : (result.verbose ?? result.output)
            )
          }

          const outcome = result.ok ? 'success' : 'failed'
          turnTools.push({ name: call.name, argsSummary, outcome })
          await this.basalganglia
            .recordOutcome({
              timestamp: new Date(),
              tool: call.name,
              outcome,
              args: call.args,
              ...(result.ok ? { output: result.output } : { error: result.output })
            })
            .catch(() => undefined)

          const toolMsg: ChatMessage & { role: 'tool' } = {
            role: 'tool',
            toolUseId: call.id,
            toolName: call.name,
            content: call.name.endsWith('_to_chat') && result.ok ? 'Added to chat.' : result.output,
            isError: !result.ok
          }
          if (result.images && result.images.length > 0) {
            toolMsg.images = result.images
          }
          messages.push(toolMsg)
        }

        if (aborted) {
          stopReason = 'canceled'
          break
        }
      }

      // A run stopped mid-tool leaves tool_call segments with no matching
      // tool_result. Close them before turn_end so the persisted segment
      // stream — which the renderer and channels replay into the next
      // request's history — stays valid. No-op on a clean turn.
      broca.closeOpenToolCalls(turn.turnId, 'failed', INTERRUPTED_TOOL_RESULT)

      if (task) {
        // Motor derives succeeded/failed from per-step outcomes. We only
        // override on cancel — the abort is the agent's truth, not the
        // steps' (a step that finished cleanly an instant before the abort
        // shouldn't make the task look successful).
        const override = stopReason === 'canceled' ? 'stopped' : undefined
        await this.motor.completeTask(task.id, override).catch(() => undefined)
      }

      await this.hippocampus
        .appendEpisode({
          timestamp: new Date(),
          userMessage: userContent,
          toolCalls: turnTools,
          assistantResponse: lastAssistantText
        })
        .catch(() => undefined)

      if (turnProvider && turnModel && (turnUsage.inputTokens > 0 || turnUsage.outputTokens > 0)) {
        const cost = calculateCost(
          turnProvider,
          turnModel,
          turnUsage.inputTokens,
          turnUsage.outputTokens,
          turnUsage.cacheCreationTokens,
          turnUsage.cacheReadTokens
        )
        await this.usage
          .recordUsage({
            timestamp: new Date(),
            provider: turnProvider,
            model: turnModel,
            inputTokens: turnUsage.inputTokens,
            outputTokens: turnUsage.outputTokens,
            cacheCreationTokens: turnUsage.cacheCreationTokens,
            cacheReadTokens: turnUsage.cacheReadTokens,
            cost
          })
          .catch(() => undefined)
        // Whole-turn roll-up with the cache split, so a 200-iteration task
        // leaves one line that says whether caching actually worked.
        const cacheRead = turnUsage.cacheReadTokens ?? 0
        const totalInput = turnUsage.inputTokens + cacheRead
        this.corpus.emit('turn.usage', {
          provider: turnProvider,
          model: turnModel,
          iterations: iterationCount,
          toolCalls: totalToolCalls,
          inputTokens: turnUsage.inputTokens,
          outputTokens: turnUsage.outputTokens,
          cacheCreationTokens: turnUsage.cacheCreationTokens ?? 0,
          cacheReadTokens: cacheRead,
          cacheHitRate: totalInput > 0 ? cacheRead / totalInput : 0,
          cost
        })
      }

      broca.emitTurnEnd(
        turn.turnId,
        segmentReasonFor(stopReason),
        iterationCount,
        undefined,
        lastReasoningContent
      )

      return {
        stopReason,
        toolCalls: totalToolCalls,
        taskId: task?.id
      }
    } catch (err) {
      // Same invariant on the error path: a tool call may have been emitted
      // before the failure. Close any still open so the segment stream the
      // channels persist isn't left with a dangling tool_call.
      broca.closeOpenToolCalls(turn.turnId, 'failed', INTERRUPTED_TOOL_RESULT)
      if (noProviderAvailable) {
        broca.emitTurnEnd(turn.turnId, 'no_provider_available', iterationCount, noProviderAvailable)
      } else {
        broca.emitTurnEnd(turn.turnId, 'error', iterationCount, providerErrors)
      }
      throw err
    } finally {
      broca.endTurn()
      if (turn.role !== 'worker') this.cerebellum.setCurrentConversationId(null)
      if (orchestration) {
        // Tear the registry down — abort every surviving worker (no orphans),
        // then flush queued disk writes so nothing lands half-written after the
        // turn closes (B6). The ALS scope unwinds on its own when respond()'s
        // run() callback returns, so there is no shared pointer to clear.
        if (turn.signal && onTurnAbort) turn.signal.removeEventListener('abort', onTurnAbort)
        orchestration.dispose()
        await diskWriter.flush().catch(() => undefined)
      }
    }
  }

  private filterToolsForProvider(tools: ToolDefinition[], message: string): ToolDefinition[] {
    const provider = this.thalamus.getActiveProvider()
    const limit = PROVIDER_TOOL_LIMITS[provider ?? ''] ?? null
    if (limit === null || tools.length <= limit) {
      return tools
    }

    const capToolMap = new Map<string, ToolDefinition[]>()
    const orphaned: ToolDefinition[] = []
    for (const tool of tools) {
      const capName = this.cerebellum.getToolCapability(tool.name)
      if (!capName) {
        orphaned.push(tool)
        continue
      }
      const list = capToolMap.get(capName) ?? []
      list.push(tool)
      capToolMap.set(capName, list)
    }

    const capMap = new Map(this.cerebellum.getCapabilities().map((c) => [c.name, c]))

    const scored: Array<{ name: string; score: number; tools: ToolDefinition[] }> = []
    for (const [capName, capTools] of capToolMap) {
      const cap = capMap.get(capName)
      const content = cap
        ? [
            cap.name,
            cap.description,
            ...cap.triggers.keywords,
            ...cap.tools.map((t) => t.name + ' ' + t.description)
          ].join(' ')
        : capName
      scored.push({
        name: capName,
        score: this.ras.scoreRelevance(message, content),
        tools: capTools
      })
    }

    scored.sort((a, b) => b.score - a.score || a.tools.length - b.tools.length)

    const kept: ToolDefinition[] = [...orphaned]
    const dropped: string[] = []
    let remaining = limit - orphaned.length

    for (const entry of scored) {
      if (remaining <= 0) {
        dropped.push(entry.name)
        continue
      }
      if (entry.tools.length <= remaining) {
        kept.push(...entry.tools)
        remaining -= entry.tools.length
      } else {
        // Partial inclusion: score individual tools and include the most
        // relevant ones that still fit within the budget.
        const toolScored = entry.tools
          .map((t) => ({
            tool: t,
            score: this.ras.scoreRelevance(message, t.name + ' ' + t.description)
          }))
          .sort((a, b) => b.score - a.score)
        const partial = toolScored.slice(0, remaining)
        kept.push(...partial.map((p) => p.tool))
        remaining -= partial.length
        dropped.push(entry.name + '(partial)')
      }
    }

    if (dropped.length > 0) {
      this.corpus.emit('tools.filtered', {
        total: tools.length,
        kept: kept.length,
        dropped
      })
    }

    return kept
  }

  async processAutonomous(opts: AutonomousTurnOptions): Promise<AutonomousTurnResult> {
    await this.init().catch(() => undefined)

    const summary = generateTitle({
      id: '',
      title: 'Untitled',
      model: null,
      messages: [{ role: 'user', content: opts.instruction, timestamp: 0 }],
      createdAt: 0,
      updatedAt: 0
    })

    const conv: ConversationFile = {
      ...createConversation(null),
      title: summary === 'Untitled' ? opts.jobLabel : `${opts.jobLabel}: ${summary}`,
      channel: 'heartbeat',
      sealed: true
    }

    const turnId = `hb_${Date.now().toString(36)}`
    const segments: import('@main/runtime/broca').Segment[] = []
    let textAccum = ''
    const flushText = (): void => {
      const trimmed = textAccum.trim()
      if (!trimmed) return
      const listener = this.brainstem?.['listener']
      listener?.onJobLog?.({
        id: opts.jobLabel,
        timestamp: Date.now(),
        kind: 'text',
        summary: trimmed.slice(0, 120)
      })
      textAccum = ''
    }
    const sink: SegmentSink = (seg) => {
      segments.push(seg)
      const listener = this.brainstem?.['listener']
      if (!listener?.onJobLog) return
      if (seg.kind === 'text') {
        textAccum += seg.delta
        return
      }
      flushText()
      if (seg.kind === 'tool_call') {
        listener.onJobLog({
          id: opts.jobLabel,
          timestamp: Date.now(),
          kind: 'tool_call',
          summary: `Tool: ${seg.name}`
        })
      } else if (seg.kind === 'tool_result') {
        const preview = seg.output?.slice(0, 80) ?? (seg.status === 'failed' ? 'error' : 'done')
        listener.onJobLog({
          id: opts.jobLabel,
          timestamp: Date.now(),
          kind: 'tool_result',
          summary: `Result: ${preview}`
        })
      }
    }
    const localBroca = new Broca({ corpus: this.corpus, shouldSilenceToolCall: isInternalToolCall })

    const result = await this.respond({
      history: [{ role: 'user', content: opts.instruction }],
      turnId,
      onSegment: sink,
      signal: opts.signal,
      conversationId: conv.id,
      conversationTitle: conv.title,
      broca: localBroca,
      bypassApproval: true
    })
    flushText()

    const responseText = segments
      .filter((s): s is Extract<typeof s, { kind: 'text' }> => s.kind === 'text')
      .map((s) => s.delta)
      .join('')

    const now = Date.now()
    const userMsg: ConversationMessage = {
      role: 'user',
      content: opts.instruction,
      timestamp: conv.createdAt
    }
    const assistantMsg: ConversationMessage = {
      role: 'assistant',
      content: responseText,
      timestamp: now,
      segments,
      stopReason: result.stopReason === 'canceled' ? 'end_turn' : result.stopReason
    }
    conv.messages = [userMsg, assistantMsg]
    conv.updatedAt = now

    await saveConversation(conv).catch(() => undefined)

    return {
      success: result.stopReason === 'end_turn',
      response: responseText,
      toolCalls: result.toolCalls,
      conversationId: conv.id
    }
  }
}

function mapProviderStopReason(s: StopReason): SegmentTurnEndReason {
  switch (s) {
    case 'max_tokens':
      return 'max_tokens'
    case 'tool_use':
      return 'tool_use'
    case 'end_turn':
    case 'stop_sequence':
    case 'unknown':
    default:
      return 'end_turn'
  }
}

// turn_end's union doesn't carry 'canceled' — the user pressing stop
// isn't a model-side reason. Surface it as end_turn so no footer chip
// renders; the renderer already knows the user canceled because the
// chat:error event arrived.
function segmentReasonFor(s: SegmentTurnEndReason | 'canceled'): SegmentTurnEndReason {
  return s === 'canceled' ? 'end_turn' : s
}

const ARGS_SUMMARY_LIMIT = 80

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args ?? {})
  if (entries.length === 0) return ''
  const parts: string[] = []
  for (const [key, value] of entries) {
    parts.push(`${key}=${stringifyValue(value)}`)
  }
  return clamp(parts.join(' '), ARGS_SUMMARY_LIMIT)
}

function stringifyValue(value: unknown): string {
  if (value == null) return String(value)
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function clamp(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trimEnd()}…`
}

async function* captureUsage(
  stream: AsyncGenerator<StreamChunk>,
  onCapture: (provider: ProviderId | null, model: string | null, usage: StreamUsage | null) => void
): AsyncGenerator<StreamChunk> {
  for await (const chunk of stream) {
    if (chunk.type === 'active_model') {
      onCapture(chunk.provider, chunk.model, null)
    } else if (chunk.type === 'turn_meta') {
      // turn_meta names the entry that actually served the call (stamped
      // by thalamus), which can differ from the active_model head when
      // the cascade fell through — pinning must follow the real winner.
      onCapture(chunk.provider ?? null, chunk.model ?? null, chunk.usage ?? null)
    }
    yield chunk
  }
}
