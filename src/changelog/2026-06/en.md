## v1.0.126 — 2026-06-08 `Latest`

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
