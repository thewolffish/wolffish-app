## v1.0.149 — 2026-06-15 `Latest`

### Import Your Own Capabilities

The Cerebellum settings panel now lets you add your own skills, plugins, and tools to Wolffish. Drag a `SKILL.md`, a capability folder, or a `.zip` onto the new import dropzone — or click to browse — and it becomes a first-class capability alongside the bundled ones, with the same trigger matching, tools, and dependency handling.

Three shapes are accepted: a single **`SKILL.md`** (a pure skill — a markdown procedure with a YAML frontmatter block, no tools to run), a **capability folder** (a `SKILL.md` next to an optional `plugin/index.mjs` and `package.json` — the full skill, its executable tools, and any declared dependencies, all in one drop), or a **`.zip`** of that folder (unpacked to a temporary location and validated exactly like a folder).

**Validated before anything touches disk.** Every drop is staged in a throwaway temp directory and checked hard before a single byte reaches `brain/cerebellum/`, so a failed import can never corrupt or half-install your existing capabilities. The checks mirror the loader exactly — valid YAML frontmatter with a `name`, well-formed `triggers`/`requires`/`tools`, a real entry file (`index.mjs`, `.js`, or `.cjs`) in any `plugin/` folder, and declared tools only where a plugin exists to back them — and reject early anything the loader would otherwise choke on silently. Names must be unique across all capabilities, and any npm or system dependencies install automatically the first time the capability runs.

**Safe by construction.** Zip extraction is guarded against path traversal (zip-slip), generous size and file-count caps stop a pathological archive from hanging the import (1 MB per `SKILL.md`; 50 MB and 5,000 files in total), and junk (`node_modules`, `.git`, `__MACOSX`, `.DS_Store`) is stripped on the way in. Every validation failure surfaces as a plain-language message in the panel instead of a silent no-op.

**Removable too.** Capabilities you imported can be deleted from the panel, with a confirmation step before the folder is removed. Bundled (official) and built-in capabilities are refused — a stray click can't wipe a core feature — and a path-containment guard ensures only a direct child of `brain/cerebellum/` is ever removed.

### Shell "No Match" No Longer Looks Like a Failure

A shell command that finds nothing — `grep` with no matching lines, `find`/`ls`/`test` on a path that isn't there — exits with code 1 and no output. That is the universal "nothing found" signal, not an error, but Wolffish previously reported it as a failure. The motor then retried the same deterministic command three times and handed the model a blind `(unknown)` error with zero signal. Now an exit code of 1 with no output at all is surfaced as a clean empty result, so the agent reads "no matches" and moves on. Exit codes of 2 or higher still mean a real error (for example, `grep` 2 = read error) and are reported as failures.

**No more retrying deterministic failures.** A command that exits non-zero without a transient (network or timeout) signature reproduces the same result every time — retrying just burns backoff and shows the model the same blind error three times over. The error classifier now treats these as deterministic and fails fast, so the agent adjusts the command instead of waiting through three identical attempts. Genuinely transient failures still retry: network-error detection was widened to cover `could not resolve host`, `connection refused`/`reset`/`timed out`, and `temporary failure in name resolution`, and those checks run first, so a flaky `curl` or `git` keeps its retries.

**Clearer failures.** When a command does fail with no captured output, the error now points at the usual cause — a `2>/dev/null` redirect swallowing stderr — and suggests dropping it so the real reason is visible.

---

## v1.0.148 — 2026-06-15

### Admin Password Asked Once Per Session

Privileged (`sudo`) commands no longer prompt for your administrator password on every run. Wolffish now captures it once, holds it in memory for as long as the app is open, and reuses it silently for the rest of the session — a task that runs ten privileged commands shows one dialog instead of ten.

**What changed:** previously every elevated command leaned on the operating system's own ~5-minute credential cache, so once that expired the password dialog reappeared mid-task. The password is now held in the main process for the app's lifetime and handed to `sudo` through an askpass helper that never writes it to disk. The command's input stream is left untouched, so chained commands (`sudo a && sudo b`), piped commands (`echo x | sudo tee f`), and anything that reads stdin keep working exactly as before. Quitting Wolffish clears the password from memory — you're asked once again on the next launch.

**macOS and Linux:** both capture the password once and reuse it (macOS via the system dialog, Linux via zenity, kdialog, or ssh-askpass). If capture isn't possible — no graphical password tool, an unexpected error, or Windows, which has no `sudo` — Wolffish falls back to its previous elevation behavior, so nothing regresses.

**Localized dialog:** the password prompt now follows the app language — title, the prompt and Homebrew-install messages, and buttons — with English as the fallback.

---

## v1.0.141 — 2026-06-13

### Prompt Caching Across All Providers

Long agentic tasks are now dramatically cheaper and faster. Previously, every iteration of a tool-using task re-sent the entire conversation as uncached input — a 30-minute browser task consumed 28.8M input tokens with only a 5.5% cache hit rate. The same workload now runs at a 96–98% hit rate, making each model call roughly 36× cheaper and about twice as fast.

**What changed:** the system prompt and tool list are now pinned for the duration of a turn, so every byte upstream of the newest messages stays cache-stable across iterations. The live iteration counters that previously mutated the prompt on every call now travel as a tiny telemetry line at the very end of the request. Three prompt-churn bugs were fixed along the way: the memory system no longer re-ingests the running task's own transcript into the prompt (it grew the prompt on every tool step and was the single biggest cache killer), the behavioral feedback log is no longer included twice, and device stats no longer re-sample free RAM mid-task.

**Per-provider work:** Anthropic requests place moving cache breakpoints that extend the cached prefix each iteration, with an optional `cacheTtl: '1h'` setting for tasks whose steps outlast the 5-minute default. OpenAI requests carry a stable per-conversation `prompt_cache_key` so sustained tool loops stay on their warm cache shard. Claude models routed through OpenRouter now receive explicit cache_control blocks. Ollama holds the model and its KV cache in memory for 30 minutes between calls. The cascade also pins the provider and model that served the previous iteration, so a mid-task turn keeps hitting the same provider's cache — hard failures still fall through to the next provider as before.

### Outbound Context Truncation

The request sent to the provider is now a shaped copy of the conversation, not a verbatim dump. Older page reads that have been superseded by a newer read of the same browser session, byte-identical duplicate tool results, and stale screenshots collapse into short self-describing stubs — each stub names what it was, how large it was, and how to fetch it again. The newest page state, the newest screenshot, and every failed result always remain full, and internal conversation history, episodes, and task transcripts keep complete fidelity on disk — truncation exists only on the wire.

On a 184-iteration mission with 53 page reads, the context plateaued at ~130k tokens where it previously would have grown past 350k, with zero measurable overhead in uncached input and no change in task quality. Both behaviors ship enabled and can be disabled in config via `contextOptimization.enabled` and `contextOptimization.truncation`.

### Smarter Compaction Trigger

Context compaction now calibrates against the provider's actual reported token counts (including cache reads) instead of a worst-case character heuristic that overestimated real usage by ~2.5×. Previously this could fire compaction at 39% of the real window — one observed run stalled 45 seconds mid-task truncating a conversation that comfortably fit. Compaction is now reserved for genuine context pressure, and with outbound truncation keeping long tasks flat, it rarely needs to fire at all.

### Task Loop Reliability

Fixed a failure mode where the agent abandoned a long mission halfway: at a frustrating moment it would write a progress summary and plan to "continue in the next turn" — but ending a response without tool calls ends the task, so the mission silently died. The loop-awareness instructions, the batch-completion rule, and the new runtime telemetry line all now state the actual mechanic: there is no next turn; if the task is unfinished, keep calling tools; end with prose only when the work is complete or genuinely blocked. Long multi-phase missions now run to completion — verified on 80- and 184-iteration browser tasks that previously stalled.

### Per-Task Usage Summary

Every turn now emits a single roll-up event with iterations, tool calls, input/output tokens, cache hit rate, and cost — so a 200-iteration task leaves one line that says whether caching actually worked, alongside the existing per-call records.

### Extension — Generic Wait & Text Selectors

Two gaps observed in real runs, where the model reached for capabilities that didn't exist:

- **`ext_wait`** — a generic wait tool: sleeps for a duration, or waits for a CSS selector, navigation, or network idle, accepting the argument shapes models naturally produce. Previously the model guessed this name (mirroring the playwright capability's `browser_wait`) and lost a step to "unknown tool".
- **`text=` selectors** — `ext_click`, `ext_wait_for`, and every other selector-taking command now accept Playwright-style `text=<visible text>` selectors, resolving to the deepest visible element whose text matches. Invalid CSS selectors now fail instantly with a clear message instead of burning three retries on a syntax error that could never succeed.

---

## v1.0.129 — 2026-06-09

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
