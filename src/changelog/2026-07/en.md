## v1.0.206 — 2026-07-07 `Latest`

### Conversations, Running Side by Side

Wolffish is no longer a single chat window that empties when you open another. Every conversation now runs **concurrently**: each keeps its own feed, composer, context meter, and in-flight turn, all mounted at once. Start a second chat while the first is still streaming, flip back to it, and both are exactly where you left them — switching conversations never pauses, resets, or drops a turn that's mid-flight. A conversation only ever advances when *its* turn does.

### The Conversations Rail

A new rail down the right edge lists every conversation you have, across every channel, newest first. Each carries a small numbered status chip that tells you what it's doing at a glance: it **pulses** while a turn is running and settles into a color when it's done — green for finished, red for failed, amber for stopped — and holds that color for the rest of your session. Collapsed, the rail is just the chips; expanded, each shows its title. Click any one to jump straight to it — including a conversation still mid-turn that hasn't been written to disk yet, which the rail reopens by its live session rather than dead-ending on a missing file. It mirrors the left nav rail exactly, so the two frame the app symmetrically.

### Every Conversation Names Itself

Conversations title themselves now. The moment one begins, Wolffish reads your first message and writes a short, specific title for it — so the rail and the History page read like a table of contents instead of a wall of identical "New chat" rows. The titling runs quietly in the background on your chosen model; its cost is recorded on your usage ledger but is walled off from the conversation's own context meter, so naming a chat never eats into its window. If the model can't be reached, the title falls back to a trimmed slice of your opening line, and a later turn tries again — a chat is never stuck nameless because of one blip.

### Channels Stop Waiting in Line

Until now every turn everywhere was serialized into a single queue: a Telegram message landing in the middle of an in-app turn had to wait for it to finish. That queue is now **per conversation**. A single conversation is still one ordered transcript — its own turns take their turns — but *different* conversations run in parallel, in any mix of in-app, WhatsApp, and Telegram. Your morning WhatsApp thread and a long in-app task no longer block each other. Every turn also reports its live status back to the app, which is what lets the rail's chips pulse for channel runs and not just the one on your screen.

### Sidebars, Squared Up

Both rails were rebuilt to match. They're mirror-symmetric now — the same widths, both defaulting to collapsed, and they **snap** open and closed instead of animating a width that used to make the icons visibly jump mid-slide. Each rail ends cleanly at the top of the action bar rather than running behind it. The History page joined the family too: it shows the same live status chips and shares one open-or-activate path with the rail, so resuming a conversation there behaves identically to opening it from the sidebar.

### Sweat the Details

- Running procedure and heartbeat overlays now wear a **Single / Workflow** badge, so you can see at a glance which mode an automated run is executing in — and a job with no marker shows the global mode it's inheriting.
- The Arabic interface caught up on the "automated task — read only" notice shown on heartbeat runs.
- Opening a conversation warms its file cards before it paints, so a resumed chat lands fully formed instead of popping its attachments in one by one.

## v1.0.205 — 2026-07-06

### Workflow Mode: One Master, Many Agents

Orchestrator mode is gone, and what replaces it is bigger than a rename. In **Workflow mode**, your model becomes the master of a run it designs itself: it declares the phases of its plan, spawns live agents that work in parallel, collects each one's report the moment it lands, sends follow-ups, and cancels anything no longer worth finishing. Each agent is a real, bounded task — and the master picks **the right model for each one individually**, from every provider you've connected: it sees a catalog of your models with their context windows, reasoning support, and vision, and chooses accordingly — a frontier model to verify, a fast cheap one to sweep. The agents work in silence; you hear one voice, the master's, which weaves everything into the reply you actually read.

The old machinery went with it: the fixed "worker model" slot, the greedy and autonomous toggles, the orchestrator's settings — all retired. If you were running orchestrator mode, you wake up in workflow mode, and leftovers from the old system are swept out of your workspace automatically.

### The Workflow Card

Every workflow run gets one card in the chat. Collapsed, it's a single quiet header; open, it's the whole run: the phase plan as chips that move from pending to active to done, and a live table with a row per agent — its name and task, the model it runs on, its phase, elapsed time, tokens, tool calls, and cost — with run totals up top. Every number is drawn from the harness's own telemetry, never from what the model claims, so the card you watch live and the card you reopen next week are the same card. It prints, too: PDF export renders the finished run as a clean static table.

### Pick Your Model and Mode Where You Type

The Brain settings page — the drag-and-drop model slots — is gone, and choosing what runs your conversation moved to where the conversation happens. Beside the chat input: a **Local/Cloud switch** showing exactly what's active, which opens into a searchable catalog of every model on every provider you've connected — capability badges, context sizes, one click to switch. Next to it, a **mode pill** — Single or Workflow — one click, effective from your next message. And the reasoning button grew up: instead of blind-cycling through efforts, hover it for a card of every level the current model supports — Off, On, High, Max — each explained, one click to pick.

### Every Job Chooses Its Own Mode

A heartbeat automation and a saved procedure can each carry their own mode now. Toggle Single/Workflow per job on the Heartbeat page and per procedure next to its Play button — the morning digest stays a quick single-model run while the weekly deep-dive fans out into agents. Under the hood it's one plain-text marker line (`mode: workflow`) at the top of the job, so Wolffish can set it by conversation too when you ask it to schedule something. Jobs without a marker simply follow the global mode.

### Workflows on WhatsApp and Telegram

The old per-worker narration retired with its mode. In its place, workflow runs report progress the deterministic way: a message when the run starts with its phase plan, one as each phase completes, a verdict line per agent as it lands (with verbose on — model, duration, tool calls), and a closing summary with totals. Verbose off keeps the feed clean as always: the master's answer, nothing else.

### Sweat the Details

- GitHub and Notion connection tests no longer fail into the void: a failed test now leaves a red alert with the reason on the connection card until you fix the token or a test passes — and the message follows your app language.
- `.txt` attachments now open in a proper line-numbered text viewer instead of a bare file card.
- Each workflow agent's context is budgeted against **its own model's** window — a small-window agent is no longer measured against the master's.
- Agents fail honestly and fast — no hidden retry loops; the master decides whether to re-run, re-scope, or move on.
- The attachments grid breathes: wider tiles, more spacing.
- The clocks on running procedure and heartbeat overlays follow your app language's time format.
- Model names show compactly everywhere the pickers list them, and error messages got shorter and plainer.
- The drag-and-drop libraries the old Brain page needed are out of the app entirely.

## v1.0.204 — 2026-07-05

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
