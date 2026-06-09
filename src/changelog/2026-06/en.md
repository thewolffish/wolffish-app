## v1.0.129 — 2026-06-09 `Latest`

### Context Compaction Redesign

The context compaction system has been rebuilt from the ground up. The previous approach made one LLM call per message being compacted — a 9-target run required 9 separate API calls batched 7 at a time, taking roughly 6 minutes. The new system uses instant proportional truncation plus a single LLM summary call. Compaction that previously took 6 minutes now completes in under 30 seconds.

**How it works:** when the conversation reaches 75% of the model's context window (previously 100%), the compactor selects targets across all message types — tool results, assistant messages, and user messages — and truncates them in-place, keeping a generous head (15% of original, up to 6,000 chars) and tail (8% of original, up to 3,000 chars) with a clear label showing the original size and how much was omitted. It then makes one LLM call on the saved original content to produce a structured conversation summary covering the task, progress, remaining work, key data values, and decisions made. The summary and a continuation nudge are injected as a single message so the model knows exactly where it left off.

This fixes a critical reliability bug: after compaction, the model would sometimes treat the shorter context as "done" and skip remaining work in a multi-step task — for example, reading 30 of 43 emails and then producing a final summary, silently dropping the last 13. The new continuation nudge explicitly lists what has been completed and what remains, and instructs the model not to produce final output until all steps are complete.

**Protection rules:** the first user message (the original task prompt) and the 3 most recent messages per role are never compacted. Error tool results and messages under 500 characters are also skipped. Previously compacted summaries are not protected, allowing recursive compression across multiple compaction passes. Images are stripped from all tool results before anything else to reclaim space immediately.

**Fallback:** if the summary LLM call fails after 5 retries with escalating backoff (1s → 2s → 4s → 8s → 16s), the truncated versions remain in place and a fallback nudge is injected that tells the model to reconstruct context from the truncated head and tail excerpts.

### Planning Skill

A new built-in skill injects planning instructions into the system prompt on every turn. Before executing any multi-step task, the agent must state its understanding, lay out 2–5 phases with concrete verification criteria, and confirm each definition of done after execution. Single-step tasks skip planning automatically. The skill is implemented as a pure procedure (no tools) using the cerebellum's new wildcard trigger (`*`), which always injects regardless of keyword matching.

### Batch Completion Enforcement

A new runtime instruction ensures the agent completes every item in a batch operation. When a task requires calling a tool for each item in a set (e.g. reading N emails, fetching N pages), the agent must call the tool for every item before producing final output, batching 10–15 calls per response. This prevents the model from summarizing after a partial run and works alongside the compaction redesign to ensure long-running tasks finish reliably.

### Multi-Turn Tool History

Channel conversations (Telegram, WhatsApp) now reconstruct the full tool-call history from stored segments when building context for a new turn. Previously, assistant messages in follow-up turns included only the final text output — the model couldn't see which tools it had called or what they returned in earlier turns. The new `assistantSegmentsToHistory` function walks the stored segments and emits properly structured assistant messages with `toolUses` arrays and matching tool-result messages, preserving the complete interaction history.

### Provider Error Cards

The error detail view for provider failures now always shows structured diagnostic information — provider name, HTTP status, error reason, retry count, and duration — regardless of whether the API returned a detail string. Previously, the "View details" link only appeared when the raw API response included an error body, leaving users with no diagnostics on connection timeouts or empty failures.

### Conversation Timeline

Conversations now track a timeline of key events — tool calls, tool results, compaction passes, model switches, and provider changes. Timeline entries are persisted in the conversation file and restored when reopening a chat. The `ChatHistoryMessage` type has been extended to include tool-role messages with `toolUseId`, `toolName`, and `isError` fields, enabling full round-trip tool state.

### Tool Transcript Detail Logs

The motor now writes a separate `-detail.log` file alongside each tool transcript. The main transcript previews tool output (first 2,000 chars with a truncation notice), while the detail log captures the complete raw output for debugging. Neither file is indexed by the cortex or included in model context.

### Provider Failure Tracking

Wernicke now surfaces per-provider failure details when a stream errors mid-response, not just when all providers are exhausted. The new `providerFailures` field on `ParsedResponse` carries the same structured failure info (status code, error class, retry count, duration) that was previously only available in the `no_provider_available` path.

---

## v1.0.126 — 2026-06-08

### Extension — Screenshot & Download Management

Screenshots and downloads are now organized per conversation. Screenshots save to `workspace/screenshots/conv-{id}/` with timestamped filenames, and each screenshot result includes viewport coordinate ranges so the agent can reason about click targets more accurately. PDF downloads now save to `workspace/downloads/conv-{id}/` (previously `workspace/files/`) and return structured JSON with path and size instead of a plain string.

### Automatic Title Generation

Conversation titles are now generated automatically in the main process. When a conversation is saved as "Untitled" with user messages, a title is derived from the first message — stripped of Markdown headings, bold/italic markup, links, and list prefixes. Titles propagate in real time through the agent pipeline to the browser extension side panel, so you always see an up-to-date title without switching back to the desktop app.

### Extension — Debugger & Mouse Commands

Five new browser commands: `browser_debugger_attach`, `browser_debugger_detach`, `browser_debugger_status`, `browser_mouse_move`, and `browser_humanize`. The agent can now attach Chrome DevTools Protocol debugging sessions and perform precise mouse movements on the page. All events appear in the extension activity log with human-readable labels.

### Extension — Reliable Link Clicks

CDP-simulated clicks now detect anchor elements and perform a follow-up real `.click()` after the synthetic mouse events, ensuring link navigation fires reliably on pages where simulated input alone was not enough.

### Extension v0.1.46

Extension updated from v0.1.39 to v0.1.46 with rebuilt side panel and background scripts.

---

## v1.0.107 — 2026-06-05

### Browser Extension

Wolffish now ships with a browser extension. Install it in Chrome and it opens a side panel that connects directly to your running Wolffish instance — same agent, same capabilities, same conversation history, but accessible from any tab without switching to the desktop app. The extension has full permissions for tabs, scripting, cookies, clipboard, downloads, and navigation, so the agent can read and interact with the page you're looking at.

### New Cloud Providers: xAI, Qwen & Stepfun

Three new cloud providers join Anthropic, OpenAI, DeepSeek, Kimi, and MiniMax. Each one streams responses, supports tool calling, and tracks token usage (including cache reads where the API reports them).

- **xAI** — Grok 4, Grok Build, and Grok 3 models via `api.x.ai`. Reasoning models (Grok 4, Grok Build, Grok 3 Mini) support reasoning effort control.
- **Qwen** — Qwen 3.7, 3.6, 3.5, and legacy Qwen models via Alibaba's DashScope API. Qwen3+ and QwQ models support thinking budgets with configurable depth.
- **Stepfun** — Step 3, Step 2, and Step 1 models via `api.stepfun.ai`. Step 3 models always reason; reasoning tokens count toward the completion budget.

Add your API key in Settings and pick a model — everything else works the same as existing providers.

### Thinking Modes

A new mode selector in the chat input lets you control how much the model reasons before responding. The selector appears automatically when the active model supports it, and hides when it doesn't. Three levels are available:

- **None** — no reasoning, fastest responses
- **High** — moderate reasoning depth
- **Max** — maximum reasoning budget

Each provider maps these modes to its own API parameter: Anthropic uses extended thinking budgets, OpenAI uses reasoning effort, Qwen uses thinking budgets, xAI uses reasoning effort, and Mimo uses thinking mode flags. Models that don't support reasoning (older Qwen, base Grok 3) skip the selector entirely.

---

## v1.0.105 — 2026-06-01

### Available Models Scanner

Wolffish now scans your Ollama models folder on startup and shows every downloaded model in a new "Available" tab on the model picker. Pick any model already on disk and start chatting instantly — no re-download needed. The scanner reads Ollama's manifest files directly, so it works even if Ollama isn't running yet.

### Models Folder Picker

A new card above the model tabs displays the folder being scanned, with a copy-to-clipboard button and a "Choose folder" option to point Wolffish at a custom Ollama models directory.

### Model Details

Available model cards now show family, parameter size, quantization level, and format when Ollama can provide that information.
