import {
  createConversation,
  saveConversation,
  type ConversationFile,
  type ConversationMessage
} from '@main/conversations'
import { Amygdala, SafetyBlockedError } from '@main/runtime/amygdala'
import { BasalGanglia } from '@main/runtime/basalganglia'
import { Brainstem } from '@main/runtime/brainstem'
import {
  Broca,
  type SegmentSink,
  type SegmentTurnEndReason,
  type ToolResultStatus
} from '@main/runtime/broca'
import { Cerebellum } from '@main/runtime/cerebellum'
import { Corpus } from '@main/runtime/corpus'
import { Cortex } from '@main/runtime/cortex'
import { Device } from '@main/runtime/device'
import { Hippocampus, type TurnToolCall } from '@main/runtime/hippocampus'
import { Hypothalamus } from '@main/runtime/hypothalamus'
import { Insula } from '@main/runtime/insula'
import { Motor } from '@main/runtime/motor'
import { Prefrontal, type ProviderContext } from '@main/runtime/prefrontal'
import { RAS } from '@main/runtime/ras'
import {
  Thalamus,
  type ChatMessage,
  type FallbackMode,
  type NoProviderAvailableInfo,
  type ProviderId,
  type StopReason,
  type StreamChunk,
  type StreamUsage,
  type ToolUse,
  type UserContentBlock
} from '@main/runtime/thalamus'
import { Usage, calculateCost } from '@main/runtime/usage'
import { Wernicke } from '@main/runtime/wernicke'
import {
  processAttachments,
  type FileProcessorOptions,
  type MessageAttachmentInput
} from '@main/uploads/file-processor'
import { isInternalToolCall } from '@main/workspace/workspace'

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
      getContextBudget
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

  private async processHistoryAttachments(history: ChatMessage[]): Promise<ChatMessage[]> {
    const provider = this.thalamus.getActiveProvider()
    const providerKey: FileProcessorOptions['provider'] =
      provider === 'anthropic' ? 'anthropic' : provider === 'openai' ? 'openai' : 'local'
    const supportsVision = providerKey !== 'local' || (await this.thalamus.localSupportsVision())

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

  async respond(turn: AgentTurnOptions): Promise<AgentTurnResult> {
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
    let noProviderAvailable: NoProviderAvailableInfo | null = null
    let fallbackState: { mode: FallbackMode; reason: string; cloudProvider: string } | null = null
    const turnTools: TurnToolCall[] = []
    let turnUsage: StreamUsage = { inputTokens: 0, outputTokens: 0 }
    let turnProvider: ProviderId | null = null
    let turnModel: string | null = null

    broca.beginTurn(turn.turnId, turn.onSegment)
    this.cerebellum.setCurrentConversationId(turn.conversationId ?? null)

    try {
      while (true) {
        if (turn.signal?.aborted) {
          stopReason = 'canceled'
          break
        }

        iterationCount += 1

        const providerContext: ProviderContext | undefined = fallbackState
          ? {
              isFallback: true,
              mode: fallbackState.mode,
              reason: fallbackState.reason,
              cloudProvider: fallbackState.cloudProvider
            }
          : undefined

        const runtime = { iteration: iterationCount, toolsCalled: totalToolCalls }

        // Rebuild the system prompt each iteration so the <runtime>
        // block reflects the live iteration counter and any fallback
        // state from a prior iteration this turn.
        const systemPrompt = await this.prefrontal.buildSystemPrompt(
          userContent,
          runtime,
          providerContext
        )
        const iterationTools = this.prefrontal.selectTools(providerContext)

        // Cloud→local transitions happen mid-stream inside thalamus, so
        // the iter-1 fallback prompt has to be rebuilt from there.
        // Subsequent iterations already have providerContext baked in
        // and won't transition (cloud is on cooldown, thalamus goes
        // straight to local without invoking this).
        const buildFallback = async (
          mode: FallbackMode
        ): Promise<{ system: string; tools?: typeof iterationTools }> => {
          const ctx: ProviderContext = {
            isFallback: true,
            mode,
            reason: 'unavailable',
            cloudProvider: this.thalamus.getActiveProvider() ?? 'cloud'
          }
          const sys = await this.prefrontal.buildSystemPrompt(userContent, runtime, ctx)
          const fallbackTools = this.prefrontal.selectTools(ctx)
          return {
            system: sys,
            tools: fallbackTools.length > 0 ? fallbackTools : undefined
          }
        }

        const stream = this.thalamus.stream({
          system: systemPrompt,
          messages,
          tools: iterationTools.length > 0 ? iterationTools : undefined,
          signal: turn.signal,
          buildFallback
        })
        const teed = broca.streamSegments(stream)
        const tracked = captureUsage(teed, (provider, model, usage) => {
          if (provider) turnProvider = provider
          if (model) turnModel = model
          if (usage) {
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

        if (parsed.providerChange) {
          // Cloud failed mid-iteration and we're now on local. Lock in
          // fallback state so subsequent iterations build their context
          // with the runtime fallback block included from the start.
          fallbackState = {
            mode: parsed.providerChange.mode,
            reason: parsed.providerChange.reason,
            cloudProvider: parsed.providerChange.from
          }
        }

        if (parsed.error) {
          if (parsed.noProviderAvailable) {
            stopReason = 'no_provider_available'
            noProviderAvailable = parsed.noProviderAvailable
          } else {
            stopReason = 'error'
          }
          if (task) await this.motor.completeTask(task.id, 'failed').catch(() => undefined)
          throw new Error(parsed.error)
        }

        if (parsed.toolCalls.length === 0) {
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
        messages.push({ role: 'assistant', content: parsed.text, toolUses })

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
            if (turn.bypassApproval) {
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
          }
          try {
            const r = await this.motor.executeStep(task.id, call)
            result = { ok: r.ok, output: r.output, images: r.images }
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
              result.ok ? undefined : result.output
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
      }

      broca.emitTurnEnd(turn.turnId, segmentReasonFor(stopReason), iterationCount)

      return {
        stopReason,
        toolCalls: totalToolCalls,
        taskId: task?.id
      }
    } catch (err) {
      if (noProviderAvailable) {
        broca.emitTurnEnd(turn.turnId, 'no_provider_available', iterationCount, noProviderAvailable)
      } else {
        broca.emitTurnEnd(turn.turnId, 'error', iterationCount)
      }
      throw err
    } finally {
      broca.endTurn()
      this.cerebellum.setCurrentConversationId(null)
    }
  }

  async processAutonomous(opts: AutonomousTurnOptions): Promise<AutonomousTurnResult> {
    await this.init().catch(() => undefined)

    const conv: ConversationFile = {
      ...createConversation(null),
      title: opts.jobLabel,
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
    } else if (chunk.type === 'turn_meta' && chunk.usage) {
      onCapture(null, null, chunk.usage)
    }
    yield chunk
  }
}
