## v1.0.204 — 2026-07-05 `Latest`

### Save Any Conversation as a PDF

A new download button in the chat footer turns the conversation you're looking at into a PDF — the same feed, faithfully: your messages, Wolffish's replies, tool cards, code blocks, and file attachments, laid out for print and offline reading. One click and it's saved.

### The Usage Meter, Rebuilt

The old opt-in "Show in-chat analytics" strip is gone, and with it the setting that hid it. In its place, the context pill beside the chat input is always there — and now it opens. Hover or pin it for the full picture: how much of your model's context window is in use and exactly where auto-compaction will trigger — drawn as a tick, so the percentage and the trigger are finally the same number — how much of that context arrived warm from cache versus freshly ingested, and a running ledger for this turn, last turn, and all time of input and output tokens, API calls, tool calls, and cost. When the orchestrator is running, its workers and background summaries get their own sub-totals. It's the honest answer to "what is this conversation actually doing," one glance away.

### Watch Your Workers on WhatsApp and Telegram

When Wolffish runs in orchestrator mode, its background workers used to be invisible on the channels — you saw only the final reply. Now, with verbose mode on, each worker narrates its own thread: its prose and tool cards arrive as labeled messages, coalesced per worker so concurrent workers never scramble into one another, mirroring the subagent rail you see in the app. Verbose off still gives you the clean feed — the orchestrator's answer, and nothing else.

### Send an Image to Any Model

The capability gate that rejected images on non-vision models is gone. Attach an image to any model, on any surface — in-app, WhatsApp, Telegram — and it goes through. A model that can't see the pixels now receives the file's name and location plus guidance on the tools that can read it, and tells you plainly what it can and can't do with it, instead of bouncing your upload with an error.

### Offline, Treated as a State

Losing your connection is a condition, not a blip — so the offline notice now behaves like one. It's a sticky warning pinned to the top of the window with its own close button, and it stays until the connection returns, at which point it's swapped in place for a brief "connection restored." Wolffish itself now knows when it's offline, too: instead of burning turns on tools that need the internet, it leans on what works without it — memory, your files, the shell. And every toast can now be dismissed with a click.

## v1.0.203 — 2026-07-04

### A New Brain Economy: Lean Context, Total Recall

Wolffish's entire relationship with its own memory and tools has been rebuilt. Until now, every single message — even a scheduled hourly job — carried a ~95,000-token payload: the full catalog of every tool it owns (twice), yesterday's activity logs pasted in wholesale, and a 40KB operating manual. That's gone. A fresh conversation now starts at roughly **9,000 tokens — a 10× reduction** — carrying only the essentials: who it is, who you are, your learned preferences, a map of what it remembers, and an index of what it can do.

Nothing was lost — the opposite. Everything Wolffish has ever done, said, produced, or spent is now in one indexed store it can search in milliseconds: every conversation **including every tool call and its output**, daily activity, long-term knowledge, task runs, generated files, even its own LLM costs. New tools — `memory_search`, `memory_get`, `conversation_list`, `conversation_read`, `memory_save`, `usage_report` — retrieve any of it surgically, on demand. Say "send me the flight plan" and Wolffish searches its past for it unprompted, whether that was yesterday or a month ago. Ask "what did today cost?" and it answers from its own ledger — something it simply couldn't do before.

Tools went the same way. Instead of shipping all 300+ tool definitions with every request, Wolffish keeps ~30 essentials loaded and **finds the rest when it needs them** — `tool_search("resize a video")` loads ffmpeg mid-task, usable that same turn. Connecting an MCP server with 500 tools now costs one line of context instead of inflating every request forever. The architecture scales to thousands of tools and gigabytes of history without slowing down.

### Long Conversations Stop Paying Rent

A conversation that outgrows the context window used to re-summarize itself from scratch on **every message** — a hidden LLM call each time, forever. Now the summary is computed once, saved with the conversation, and reused; the compressed turns stay retrievable verbatim via `conversation_read`, so even a detail from fifty messages ago is one lookup away. Old bulky tool outputs and attachments in a long chat also step aside into compact pointers instead of re-uploading themselves every turn — and re-attached images and PDFs are no longer re-encoded from disk on every single message.

### Your Files, Hand-Delivered — Never Auto-Dumped

File delivery is now entirely Wolffish's own decision, not hidden plumbing. Previously, some tools quietly auto-attached whatever file path appeared in their output — files could reach your Telegram or WhatsApp without Wolffish ever deciding to send them, and worse, the machinery sometimes talked Wolffish *out* of sending its own work. All of that is gone. Now there is exactly one rule, and Wolffish follows it: **when it produces a file for you — a PDF, a converted video, a spreadsheet, even a tiny text file — it sends it to your conversation the moment the work is done**, rendered natively wherever you are: a file card in-app, a real upload on Telegram and WhatsApp. If you explicitly asked for a file to just be saved somewhere, it respects that and tells you where it is. No more "saved to ~/some/path" dead ends, and no more surprise attachments you never asked to receive.

### Local Models: One System, No Training Wheels

The two "Stateless local models" and "Restrict local models" settings are gone. Local models now run the exact same system as cloud models — same lean context, same tools, same memory — because the context is finally small enough for them to handle. A locally-run model will tell you honestly when a task is beyond it and suggest a capable model, but if you insist, nothing is withheld. Models with very small context windows automatically get a slimmed bootstrap toolset instead of being lobotomized.

### Sweat the Details

- Working-folder listings no longer silently invalidate the prompt cache on every message.
- Automation runs are now recorded durably — "why did last week's job fail?" finally has an answer.
- The memory index no longer rebuilds from scratch at every launch; it updates incrementally as files change (full rebuild of the entire workspace takes ~1.5s when needed).
- The context meter now measures against the same budget compaction actually enforces.
- Duplicate facts no longer pile up in the knowledge files, and the weekly review writes a digest instead of pasting seven days of raw logs.
- Incoming WhatsApp messages are now part of Wolffish's searchable memory — "what did she say on WhatsApp?" just works.
- Reading a past conversation supports a full-detail mode, and the complete untruncated transcript is always one call away.
- The History page now loads its list from the memory index — instant, no matter how many conversations you have.
- The context meter shows your model's full context window (a 1M model reads 1M).
- Hardened against the weird stuff: corrupt files, empty workspaces, Arabic search, malformed data — thirty new edge-case tests, all passing.
- Fixed: task-history indexing (every record was silently empty), memory-search ranking (better matches scored lower), doubled `mcp-mcp-` names for MCP servers, a ghost `channel_status` tool the model was told to call but couldn't, and cloud-provider PDFs being needlessly flattened to plain text.

## v1.0.202 — 2026-07-02

### MCP: Connect Any Tool Server, and It Just Works

A new **MCP** page in Settings connects Model Context Protocol servers — the growing ecosystem of tool servers for everything from databases to design apps to domain knowledge. Paste a command (for a server that runs on your machine) or a URL (for a remote one) and Wolffish connects on the spot: no separate "connect" step, no test button you have to remember, no restart. Every tool the server exposes is available to Wolffish — in normal chat and to orchestrator workers alike — on your very next message.

Connections look after themselves. If a server crashes or a remote endpoint drops, its tools quietly step aside and Wolffish reconnects in the background with steadily-spaced retries — no error modals, no flashing status, nothing you have to do. When it comes back, the tools return on their own. If a remote server needs sign-in, Wolffish walks you through it the way any modern app would: one **Sign in** button, your browser opens, and you come back connected. One misbehaving server can never affect another or the app — every connection is isolated. Servers are namespaced so two of them can never collide, and removing a connection cleans up everything it touched.

Wolffish can also manage these connections for you by conversation — "connect the tafsir MCP server," "which MCP servers are on?", "disable that one," "remove it" — through a new `mcp` capability. Whatever it does shows up on the MCP settings page live, and whatever you do there is visible to it.

### Network Status, Quietly Handled

Wolffish now tells you when your connection drops and when it's back — one small toast each way, only on real transitions, never on a normal launch. And when a background run (an automation or procedure) fails because of the network or a provider, the notification now says *why* in plain words — "no internet connection," "rate-limited," "invalid API key" — instead of a raw machine error.

## v1.0.201 — 2026-07-01

### Procedures: Prompts You Save and Run On Demand

A new **Procedures** page (the Play button in the sidebar) holds prompts you want to reuse — write one once, then hit **Play** to run it in a fresh conversation any time. Runs execute in the background under a live overlay with a timer and a color-coded activity log, land in History marked with a Play icon, and never touch the chat you're in. Wolffish can manage them by conversation too — "save this as a procedure," "run my morning brief" — through a new `procedures` capability.

### Connect Multiple GitHub and Notion Accounts

The GitHub and Notion settings panels now hold any number of connections, each with its own label — "Personal," "Work" — and a per-connection **Test** button that shows the account it resolves to. Every GitHub and Notion tool takes an optional connection label to pick the account, and picks automatically when only one is linked. Existing setups migrate on their own.

### WhatsApp Messages in WhatsApp's Own Formatting

Replies on WhatsApp no longer arrive as raw Markdown — `**bold**` asterisk soup, `#` headings, broken tables. Wolffish now writes in WhatsApp's native style (_bold_, _italic_, plain lists), and everything it sends passes through a converter that translates any leftover Markdown — headings, links, tables, task lists — into clean WhatsApp text.

### WhatsApp Now Accepts Any File You Send It

Send a PDF, document, image, video, audio file, or sticker over WhatsApp and Wolffish downloads and reads it like an in-app attachment — previously only voice notes made it through, and anything else was silently dropped. Files that arrive without a name or extension are typed from the media itself, and Telegram gained the same nameless-file handling.

### Every File in a Conversation, One Click Away

A new files button in the chat footer opens everything the conversation holds — your uploads and every file Wolffish produced — in a full-width grid. The timeline beside it now spans the whole conversation, with a collapsible divider per prompt instead of resetting every turn.

### HTML Attachments

You can now attach `.html` files. They open in the code viewer with a one-click toggle between the sandboxed page preview and the highlighted source.

### Fixes & Polish

Background runs — procedures and automations — are now fully isolated from the live chat: they can't skew its context meter, hijack its Stop button, or overwrite a conversation created in the same second. A file a tool already delivered is no longer re-sent in the same turn, and the agent now reliably hands you every file it produces. A turn can no longer end silently mid-task with no message. Chat stays live while you visit Settings and other pages — the context meter and timeline no longer reload, and playing media pauses on the way out. Long conversations render noticeably faster, file cards show readable type labels like "DOCX" instead of raw MIME strings, and durations read naturally ("0.3s", "1m 12s").
