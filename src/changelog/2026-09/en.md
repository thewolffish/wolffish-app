## v1.0.295 — 2026-09-14 `Latest`

### The Terminal Is Now a Real Screen

`wolffish` in a terminal used to be a line at a time: type, wait, read, and hope the tool calls you could not see were going somewhere. It is now a **full-screen terminal client**, on par with the app it belongs to. The conversation streams into a scrolling feed with the same cards the app draws — **tool calls with their output, file edits as diffs, delivered files, todo lists, workflow rosters, background tasks and countdowns** — and the prompt at the bottom is a real editor: **Shift+Enter** adds a line, a long paste folds into a placeholder, **`@path`** completes and attaches a file, **`/`** completes every command. Under the prompt sits what a chat window shows for free and a terminal never did: the **mode, model, thinking effort, plan mode and project** on one line, and while a turn runs, **what the agent is doing right now, how long it has been at it, how much of the context window is used, and what it has cost** — the app's context meter, made for a terminal. Approvals and questions arrive as **cards you answer with the keyboard** (allow once, allow always, deny; pick an option by number), a prompt typed mid-turn **queues** instead of being refused, `esc` twice **interrupts**, and if the app restarts under you the terminal **reconnects on its own** and picks the conversation back up.

### Everything the App Can Do, From a Box With No Screen

**`ctrl+p`** opens a command palette that lists every command with its key; **`ctrl+x l`** switches conversations from a fuzzy-searchable list with rename and delete; **`ctrl+x m`** switches the model, then the thinking effort; plan mode, chat mode and the project bound to the conversation each have a key and a slash command. **Settings** open as the app's own page → card → row browser — every switch, number, choice and secret edits in place, every action the app has (pairing a phone, testing a key, adding an MCP server, installing an engine) runs from the same list, and a search reaches across every row at once. **Usage** shows the same totals, providers and models as the app's panel with a range picker and a daily strip; **status** shows the daemon, brain, autostart, PATH and channels. Projects, procedures, automations (with what is running and queued), delivered files, parked approvals, background tasks and the daemon log each have a dialog. Everything that took a `--json` flag still does, and `wolffish -p "…"` with a pipe still prints plain text and exits — scripts do not change.

### Built Into the App, Updated With It

The client is now a **compiled program of its own**, shipped inside the app and pointed at by the same `wolffish` command as before — nothing to install, nothing to keep up to date, and an app update replaces it in the same step. On Windows it is a proper console program, so the extra launcher the old client needed is gone. The terminal's own small preferences — its theme, prompt history, recent models — live with the app's data, so a machine you reach over SSH remembers them too.

### HTML Files Run Live in the Chat

An HTML file in the chat — a game the agent just built, a report, a page — used to render as a static picture of its markup: the app's own security policy silently blocked every inline script, so anything interactive showed a blank canvas. The card now hosts the page in a **real browser tab of its own**: scripts run, the canvas draws, keys and sound work, `localStorage` persists between opens, and relative assets and CDN loads resolve as they would in Chrome. The card shrinks a wide page to fit; the expanded view shows it at full size, with **Reload** to start over and **Developer tools** to look inside. Every guest is hardened by the app — no access to the app's context, popups and outbound links go to your system browser — and a file too large to show as source still previews live.

## v1.0.294 — 2026-09-13

### A Restart Waits for the Reply, Then Counts Down Where You Can Stop It

Asking Wolffish to restart, shut down or log out used to hand the job to a hidden timer: the agent scheduled the command twenty seconds out in a detached shell and moved on, with no way to cancel it on a Mac or on Linux, and a failure to even start that timer was reported to you as success. The whole thing is rebuilt around one rule: **nothing that would cut off the agent's own reply runs inside the turn**. A power action is now **armed** rather than run — the agent finishes its answer, the conversation is saved, and only then does a **countdown card** appear in the chat with the action's name, a bar draining over ten seconds, and an **Abort** button. When the bar empties the command runs; press Abort and it never does. The card is a real part of the conversation, so it appears on your phone with the same Abort button, and a conversation opened later shows exactly what happened — **ran, aborted by you, or dropped** because the turn was stopped before its reply landed. On a chat channel, `/cancel` aborts it. Nothing stays pending across a relaunch: a countdown the app went down with is recorded as dropped, never left counting. The escape hatch survives for the one case it exists for — a user who says "restart now" and accepts losing the tail of the turn.

### Any Action Can Take the Same Countdown

The restart is the first user of a general mechanism, and the agent has it as a tool of its own. **`countdown_start`** arms any tool call to run a few seconds after the reply is finished, on the same card with the same Abort — quitting the app, an irreversible cleanup, anything you would want a last chance to stop. The armed action is checked against **the same safety rules as calling it directly**, and if it needs your approval, the approval card is raised at the moment it is armed, never later when no one is there to answer. One countdown is pending at a time; arming a second replaces the first. Automations cannot arm one at all, because no one is watching their card.

## v1.0.293 — 2026-09-12

### A Finished Turn Ends on Nothing, Not on a Note About Nothing

When a turn had nothing left to say — the answer already delivered, the phone already notified — Wolffish's own instructions told it to end with nothing, and printed the mistake it must not make: the offending note itself, in quotes, as the example not to write. A model that has decided to say nothing reaches for the nearest token, and the nearest token was the one the instruction had just shown it. So a finished turn could close with that note typed after a real answer and delivered to you as part of it, twice in one conversation. Every one of those instructions — the standing procedures and both runtime notices — now **names no example at all** and never prints the phrase it forbids. They describe the class of mistake instead (a bracketed status note, a written statement that you are staying silent, a lone "." or "…"), say outright that **nothing is ever structurally required in a reply**, and cover the shape that leaked: a substantive answer **never carries a trailing marker** — it ends at its last real character. Silence is written as nothing, which is what it always meant.

## v1.0.292 — 2026-09-12

### An Automation Card Says When, at a Glance

The schedule an automation runs by — `Daily (09:00)`, `Weekly (Mon 09:00)`, a raw cron line — used to open **the small grey line of code at the bottom of its card**, sharing two clamped lines with the next run's date, the project and the edit stamp, where a long one could be cut off before you ever read it. It now carries **a chip of its own**, paired on one row with the countdown: **when it runs next on one side, the rule it runs by on the other**, pushed to the card's two edges the way the On/Off and Single/Workflow switches above them are. The chip wears **the glyph of its period** — a sun for a daily run, a briefcase for weekdays, a calendar for weekly and monthly, a stopwatch for hourly, a rocket for one that fires when the app starts, angle brackets for raw cron — so the shape of an automation registers before you read a word of it, and **a long cron drops to its own line rather than squeezing**, keeping the card's full width. The line of code below is left with **only what it was always for**: the exact moment of the next run, the project it belongs to, and when you last edited it.

## v1.0.291 — 2026-09-11

### Updates on Mac Come Back

Clicking **Update** on a Mac would sometimes close Wolffish and then — **nothing**. No relaunch, and when you opened it yourself it was still the old version. The cause was a race: on macOS the system's own installer has to unpack and check the 300 MB bundle **after** you click, and Wolffish gave it a fixed five seconds before forcing itself shut. On a busy disk that is not enough, so the app died with the update half-prepared. Wolffish now **prepares the update first, while it is still fully running**, and only begins shutting down once the installer confirms it holds the new version. If preparing fails, **nothing is torn down**: the app stays open, tells you the install did not go through, and lets you try again. The same rule now holds on every platform — Wolffish **never force-quits with nothing installed**; if the installer could not be armed after shutdown had begun, it relaunches the current version instead of vanishing. One honest note: the update that _brings_ you this version is still carried out by the old code, so it may misbehave one last time — the update after it is the first to run the fix.

### Install Failures Say So

If an install failed, the **Update** button used to sit greyed out on "Installing" for good, in both the chat card and Settings → Updates, with no way back short of restarting. Both now show **what went wrong** in place of the release notes, turn the button into **Retry**, and read **"Installing…"** while the work is actually in progress.

## v1.0.290 — 2026-09-11

### Several Times a Day Is One Automation

"Sweep the inbox at 8, at 2 and at 8" used to mean **three separate automations** standing in a row, each with its own card, its own history and its own edit. A schedule can now **carry a list**: `Daily (08:00, 14:00, 20:00)` fires three times a day, `Weekday (09:00, 17:00)` twice on every working day, and `Weekly (Monday, Wednesday, Friday 09:00)` three times a week. Days and times can **both** be lists — `Weekly (Monday, Friday 09:00, 17:00)` is four runs a week from one line — day names take **Mon, Tue, Wed** as readily as the full word, `Monthly (1, 15 09:00)` covers the first and the fifteenth, and the times need not share a minute, so `Daily (08:00, 12:30, 18:00)` is fine. The card's countdown follows: a schedule like that shows **its next run rather than its first**, so an automation that fires at 08:00, 14:00 and 20:00 reads 14:00 when you look at lunchtime. Everything already written keeps working **exactly as it did** — a single value is simply the one-item list.

### Pick How Many Times, Then the Period

Above the schedule field there is now **a row of count pills** — Once, Twice, 3 times, 4 times, 5 times — that reads as one sentence with the period chips beneath it: **"3 times" · "Every day"** fills in a `Daily (…)` with three times spread evenly across the day, anchored on now. Pick them in either order. Both rows **light from what is actually in the field** rather than from your last click, so opening an existing automation — or typing a schedule by hand — shows you its own period and its own count.

### Code Blocks Without a Language Tag

A fenced block with no language on it — just three backticks — rendered with **a second, darker box drawn inside it**, sized to the text instead of the block and plainly visible in light mode. Wolffish was deciding "block or inline snippet?" by looking for a `language-` class that an untagged fence never carries. It now decides by **where the code sits**: inside a fence, it is a block.

### Previews on the Right Ground

The **Word and spreadsheet previews** painted themselves on the window's background rather than the card's, leaving a document sitting in a well slightly darker than the card holding it; they now use **the same ground every other card paints on**. The **folder chips along the top of a transcript** were translucent, which let the lines scrolling underneath **ghost through them** — they are solid now, so the strip reads as chips over the transcript instead of a smudge of it.

## v1.0.289 — 2026-09-11

### Ollama Stops Asking to Be Installed

A first run used to walk you from the welcome screen straight into **install Ollama**, and from there into **pick your Ollama model** — two full-screen pages that carry none of the app's navigation, so anyone who simply did not want a local model had nowhere to go. Wolffish now treats Ollama as what it is: **one optional provider among several**. Onboarding is **a theme, a language, and then the chat** — nothing else. The model picker no longer exists as a screen at all; it is **the Ollama panel of Settings → Models**, where you go looking for it when you actually want it, and every way in is a button you chose to press. Launch itself now **asks Ollama nothing** — no probe, no tag list, no quietly rewriting your configuration before the window is even up.

### The Models Panel Stays Where You Are

Finishing a download used to **throw you out of Settings and into the chat**, because the picker was built as a step in a flow rather than a panel you had opened on purpose. It now **stays exactly where you are**: the list comes back with your new model marked as the current one, and the panel re-reads what Ollama actually holds, so **re-downloading a model your configuration already names** no longer leaves the card standing there still offering "Install". The buttons that belonged to that old flow — "Skip for now", "Back to chat" and "Continue to chat" — are gone, because **Settings' own sidebar and back chevron** were always the way out of a panel.

### When a Local Model Goes Missing

Delete a model with `ollama rm` and Wolffish used to carry on believing it still had one: the composer stayed live, the notice that points you at Settings stayed hidden, and you found out by **sending a message and getting a raw provider error back**. The chat now reads the **daemon's live state** — a background watch the app already keeps, not a new probe of its own — and tells you plainly that **your local model is no longer installed in Ollama**, with the same one-click path to Settings → Models. A daemon that is merely switched off is left alone, and so is one that stumbles for a moment before answering: neither is reported as a missing model. And the **Stop button is now gated on nothing at all**, so a turn running on a model that vanished mid-generation can still be stopped.

## v1.0.288 — 2026-09-11

### Wolffish Writes Code Now

Point a conversation at a code project and Wolffish stops being an assistant that happens to own a shell and becomes **a coding agent that works the way you would**. It begins by **reading the project instead of guessing at it**: the runtime now tells it which of your working folders are real projects, **what branch each one is on and how many uncommitted changes it carries**, which toolchain it uses, and **the exact check commands that project exposes** — and it reads the project's own `AGENTS.md` or `CLAUDE.md` first, so a repository's house rules outrank anything Wolffish believes by default. Three new tools do the work: **`file_edit`** makes a surgical, exact-string change and shows you the diff instead of rewriting a file whole; **`file_grep`** searches file contents with ripgrep across a codebase of any size, respecting `.gitignore`; and **`file_glob`** finds a file by name. Every edit is followed by two steps you never have to ask for — the **project's own formatter** runs on the file when the project demonstrably uses one, and the **project's own TypeScript, ESLint, Ruff or Pyright** is asked what it thinks, with any errors handed straight back so they are fixed in the same turn instead of surfacing at build time. And a change is not done until a check passes: the narrowest test first, then the project's full typecheck, lint and tests, with a failure reported rather than hidden. All of this is attached **only when the working folder really is a code project** — an ordinary conversation carries none of it.

### Plan First, Change After

A new **Plan chip** sits in the composer beside the draft-editor button. With it on, a turn **cannot change anything**: it reads, searches and investigates, then ends by writing a plan — the recommended approach, the files it will touch, the steps in order, and how the result will be checked — and tells you to turn Plan off to run it. It is a stance you take for a conversation rather than a property of its transcript, so it is held in one place and **shared with your paired phone**: set from either surface, and the other follows at once. A brand-new chat can carry the stance before it even has an id. Turn it off and the next turn is told, once, that the plan is now approved to act on.

### Every Change Arrives as a Diff

A file edit and a shell run used to look like every other tool call in the feed. They now get **a compact activity row of their own** — a short label, the file or the command, and a chip reading **`+12 −3`** for an edit or **`exit 0`** for a command, green or red. Open the row and an edit shows **the real unified diff**, red and green with the true line numbers down both sides; a command shows its output and, when the output was long, **the path of the file holding all of it**. The diff travels on the result itself, so **a conversation reopened next week renders exactly what it rendered live**.

### The Task List

When a job runs to three steps or more the agent now keeps **a task list**, and it appears in the chat as **a checklist card**: exactly one item in progress, an item ticked off only after the check that proves it really ran. The card **updates in place** rather than stacking a new copy on every revision, so a long run leaves one list in the transcript showing where things stand. It reaches the paired phone and the exported PDF the same way.

### Putting It Back

Before the first change a turn makes to a file, Wolffish now **keeps the original bytes**. `changes_list` shows what each recent turn touched, and **`changes_revert` puts a turn's files back** — the whole turn, or one file of it. It needs no git, works in any folder, and keeps **the last twenty turns** of each conversation. It exists for one sentence you have certainly said before: _that fix made it worse, put it back_.

### Allow It for This Conversation

The approval card has a second button. **Allow for this conversation** approves the call in front of you and stops asking about **the same kind of call for the rest of the chat** — the same tool, and for the shell the same command head, so allowing `npm install` once never quietly allows `git push` later. Anything blocked outright never reaches this card and never gets the button.

### Approvals That Read the Path, Not the Code

Writing a file whose **contents** happened to mention a path used to stop the agent and ask you about it. An ordinary relative import — `import x from '../lib/x'` — raised a red **"Path traversal attempt"** card, the app's most severe warning, over a line of perfectly normal code; a shell script beginning `#!/usr/bin/env node` was announced as **"Modifying system files"**. The rules were reading the whole call, text and all, instead of the one thing they are about. They now read **the path being written**, and nothing else. A genuine traversal such as `../../../etc/hosts`, and a genuine write into `/etc`, `/usr` or `/private`, still stop and ask exactly as before, on a file tool and on a shell command alike — and the rules that are about a command, not a path, are untouched. One thing genuinely relaxes: a shell command that merely walks up a directory, `cd ../sibling && npm test`, no longer counts as an attempted break-out. This one is older than the rest of this release; it simply became impossible to ignore once the agent started sending whole blocks of code through those very fields.

### The Feed Shows the Work, Not the Mechanics

The switch that controls how much of a turn you see carried the name **"Verbose task results"** on four different surfaces — a name describing its setting rather than what you would see. It is now **"Show all tool activity"** everywhere: desktop, phone, terminal, Telegram and WhatsApp. More usefully, **what a clean feed always shows has grown**. With the switch off you now see the replies, the delivered files, **the code edits and shell runs**, the questions and approvals, the reasoning and the task lists — only genuine mechanics stay out of sight. Along the transcript's top edge there is also a new strip of **folder chips: every folder this conversation changed files in, and how many**, each one a click away from opening on your desktop. Going the other way, **the live run cards are gone** — the card that covered the chat while an automation, a procedure, a compaction or a reflection ran has been removed along with its four switches, because each of those runs already reports itself on its own page and the card only ever sat in front of what you were reading.

### Output That Keeps Its Ending, Servers That Can Be Stopped

A long test run's output used to be cut off past about 100 KB — it kept the beginning and **threw away the bottom of the log**, precisely where the failure is reported. Long output now keeps **the last 2000 lines or 50 KB**, and **the full text is written to a file the result names**, so nothing is lost and the agent can search the log for the failing test instead of running everything again. Commands also **run in your working folder by default** now instead of your home directory, so `npm test` and `git status` land in the project without being told where it is, and they come back with the colour codes stripped out. A command shaped like a dev server or a watcher is **refused in the foreground** rather than hanging the turn: it is started in the background instead, with **`shell_jobs`** to list what is running and **`shell_stop`** to end one or all of them before the turn finishes.

### Simulators, on Both Phones

A new **Mobile simulators** capability puts iOS and Android on the desk: **nine `sim_` tools** for the iOS Simulator — list the devices, boot one, build, install, launch, terminate, screenshot, read the log, open a deep link — and **seven `adb_` tools** for an Android emulator or a plugged-in device, tapping and typing included. "Does the new screen look right?" is now a question the agent answers by building the app, launching it and looking.

### The Local Models Group Waits for Ollama

The composer's model card used to **ask Ollama what it held every single time you opened it**, then re-render when the answer arrived — and it offered a local group whether or not the daemon was actually running. Wolffish now **watches Ollama in the background**, and the card simply reads an answer that has already settled: the local group is there exactly when Ollama can answer, the same way a cloud provider's group is there exactly when it has a key. Opening the card costs nothing, and nothing shifts under your cursor.

## v1.0.287 — 2026-09-11

### DeepSeek's New Flash Can See

DeepSeek has retired its whole **V4 Flash line** and replaced it with one model, **DeepSeek-V4.1-Flash**, served under the plain name `deepseek-flash`. It is now the **default DeepSeek pick** in the model catalog, and it wears a **vision badge** for the first time in that provider's row: it reads the images you attach and the screenshots computer use takes, so driving the screen on DeepSeek no longer means switching to another provider first. It is also markedly **cheaper** — input at **$0.15 to $0.30** and output at **$0.60 to $1.20** per million tokens depending on the hour, with cache hits close to free — and the catalog now shows those rates. Underneath, the app finally recognises a name that carries **no version number**: until now a chat on `deepseek-flash` would have been quietly treated as an **8K-context, 16K-output** model instead of the **1M-context** one it is, and every image would have been stripped before sending because the app still believed DeepSeek was blind. The retired names keep working — DeepSeek routes them to the same model, and the app now treats them the same way. `deepseek-v4-pro` stays listed at its own prices for the few days it has left; from **14 September** DeepSeek routes it to V4.1 Flash as well and bills the Flash rate.

## v1.0.286 — 2026-09-10

### Automations, Projects and Procedures Become One Library

The three pages that hold what the agent **runs on its own**, what it **starts a conversation from**, and what you **run on demand** sat behind three separate sidebar entries, each opening a near-identical grid of cards under its own back button — so finding the thing you wanted to edit began with remembering which of three lookalike pages it lived on. They are now **one Library page with three tabs**, the same shape Customization took for Soul, User and Agents: the back button leads, the tabs sit beside it, and the grid fills the rest. Nothing on the cards changed — creating, editing, playing and deleting all work exactly as before — and the Automations tab keeps its **cards-or-markdown switch**, now at the far end of the same row as the tabs rather than in a header of its own. **The tab you left on is the one you come back to** after a detour through chat, so a look at what is scheduled never costs you your place among your procedures. The sidebar is one row shorter for it, in English and in Arabic alike.

## v1.0.285 — 2026-09-07

### The Stray Period at the End of an Answer

Every so often a finished answer was followed by **a message containing nothing but a full stop**. It arrived under a reply that was already complete, said nothing, and left you wondering what the agent had meant by it. It meant silence. When the work is done and the notification has gone out, the runtime tells the agent there is nothing left to reply to — and the correct way to finish there is to write **nothing at all**. But a model asked to send nothing cannot always send _nothing_, so it typed **the smallest mark it could find** and sent that instead. The app never edits a word the agent writes, on purpose, so the answer was never to quietly delete the character — it was to make sure the agent knows a lone `.` is every bit as visible as a sentence. It is now **told exactly that, the next time it speaks**, along with what you actually saw on your screen, the same way it is already told when a raw tokenizer marker slips into a reply. The instructions it works from **name the case outright** now, too, so the far more common outcome is that it never types the character in the first place. A reply that is genuinely just punctuation because you asked for it — a divider, a row of dashes — is left alone.

### The Context Meter Waits Until It Has Something to Show

A brand-new chat opened with **an empty gauge sitting in the composer row**, and hovering it produced a card that said only "No usage yet" — a control that existed to tell you nothing, beside the logs and files chips that had already stopped doing exactly that. The meter now **joins the row the moment it has a reading**, on your first send, and stays away until then. Next to it, the button that opens the full-height draft editor wore **the four-arrow mark the file, PDF and video viewers use for "make this bigger"**, while its own label reads "Write your message" — it now wears **the pencil** that the project, automation and procedure cards already use to open an editor, at the same size as every other icon in that cluster.

## v1.0.284 — 2026-09-06

### The Composer Expands Like Everything Else

The last release moved the **automation, project and procedure** editors into the full-height panel when you ask their prompt for more room. The chat composer's own expand button was **the one left over** — it still opened a box floating in the middle of a dimmed screen, so the same request meant two different shapes depending on which text you happened to be writing. It now opens **the same panel**, over the same draft, so what you write in it is what the composer sends the moment you close it. It also has **a close button and answers Escape**, where before the only way out was clicking the dimmed area behind it — and that click is gone on purpose, because **a stray one while you were writing used to shut the editor mid-sentence**. The button itself finally **says what it does** when you hover it, instead of being a bare icon.

## v1.0.283 — 2026-09-06

### The Expanded Prompt Editor Joins the Panel

The last release moved the **automation, project and procedure** forms into full-height panels that slide in from the edge. The button that gives your prompt more room, though, still opened **a box floating in the middle of a dimmed screen** — a second shape stacked on the first, for the very same act of asking for space. It now opens **the same full-height panel**, the one the file and PDF viewers already use, so writing a long prompt widens the surface you are already on instead of covering it with another. It also finally has **a close button**: before, the only ways out were Escape or a click on the backdrop, and that backdrop click is gone on purpose — **a stray click while you were writing used to shut the editor from under you**. In Arabic on a Mac, the expanded viewer's title also no longer sits **underneath the window buttons**.

### The Prompt Comes First

In all three editors the prompt sat **below the file list and the folder list**, so the one field the whole form exists for was the one you had to scroll past everything else to reach — and the longer your file and folder lists grew, the further down it went. It now sits **directly under the name and project**, with files and folders beneath it. Projects already worked this way; automations and procedures now match.

### Cards That Say What They Hold

A project card now shows **how many files and working folders** it carries into every conversation it starts, as two small chips beside the name — and shows **nothing at all where there is nothing**, rather than an empty "0". On a procedure card the **Single / Workflow toggle moved up beside the buttons**, giving the name a full line of its own. Both cards now close with **the same small monospace line the automation cards use** — when it was last edited, when it was last used, how many conversations — so the three pages read alike, and every card in a row ends on the same line however much it holds.

## v1.0.282 — 2026-09-05

### Soul, User and Agents Become One Page

The three documents that shape the agent — its **personality**, the **facts about you** it should always know, and **your own procedures** — sat behind three separate sidebar entries opening three near-identical editors, so adjusting how the agent behaves began with remembering which of the three held the paragraph you meant. They are now **one Customization page with three tabs**, the shape your phone already uses. Each tab states in a line **what its document is actually for**, so the choice no longer rests on a single word. A draft you leave in one tab is **still there when you come back** from another, and that tab **carries a dot while it holds unsaved changes** — which is exactly the draft you can no longer see. Edits made on your phone or in another window still arrive on their own, and now they land on **whichever tab is clean** rather than only the one you happen to be looking at.

### The Files Sheet Lists What the Conversation Actually Has

**View Files** had been drifting into a list of things that were not there. A long run names plenty of files it then cleans up — a PDF check renders proof pages, looks at them, re-renders and deletes the batch — and every one of them stayed in the sheet as a **tombstone you could click but never open**. Files the agent merely **read for reference** landed there too, so a morning digest that consulted last week's reports filled today's sheet with **last week's files**. Meanwhile the one file you were most likely looking at — **a meme or a GIF the agent had just made and shown you inline** — was the single file the sheet never listed at all. All three are fixed: the sheet now **checks what is still on disk** and counts only that, **a file read for reference no longer counts as this conversation's**, and **generated media appears the moment it does**, while the answer is still being written. When a picture is genuinely gone, its placeholder **fills its column** instead of sitting in it as a narrow stub.

### The Logs and Files Chips Earn Their Place

The two chips beside the composer were **always mounted and merely greyed out** when they had nothing, so a brand-new chat opened carrying two dead controls advertising sheets that were empty anyway. Each one now **joins the row when its first event or file lands**, the same way the export button waits until there is something to export. They also **wear the same frame as the context meter** they sit beside, instead of standing bare next to a bordered pill.

## v1.0.281 — 2026-09-05

### The Leak That Broke Every Tool at Once

Leave the app open long enough and **everything that runs a program would start failing at the same moment** — Google Workspace announcing that gogcli "is not installed", video and audio conversion falling over, a shell command dying with nothing useful to say. Each one reported the failure as its own local problem, so none of them pointed anywhere near the cause: the file watcher that keeps your workspace searchable was claiming **one system handle for every single file it watched**, and a lived-in workspace is tens of thousands of files. Once the app ran out of handles it could no longer start **any** program at all, and every tool went down together. The watcher now holds **one handle for the whole workspace** — eleven of them instead of twenty-three thousand, and it stays eleven however far your workspace grows. It also notices folders created after the app started, which the old watcher quietly missed on a fresh workspace.

### Installing Google Workspace Explains Itself

When the Google Workspace install or update failed, all you got was a toast reading **"Install failed"** — which then vanished, taking the only account of what happened with it. The real reason now **stays on the card** in plain words: GitHub's hourly rate limit, a release that has moved, a file that won't run, a path the app can't write to. Install itself is **repairable now**, too. It unpacks to a scratch folder and swaps the finished binary into place in one move, so a download that dies halfway **leaves your working copy untouched** instead of replacing it with a truncated one — and the state that used to make Install fail forever, however many times you pressed it, now clears on the first try. An update that lands a binary which won't actually run **reports that as a failure**, rather than showing you a green checkmark while every Google call quietly fails.

### The Edit Forms Get the Whole Window

The editors for **automations, projects and procedures** were boxes floating in the middle of a dimmed screen — and a real one, with a schedule, a file list, a folder list and a prompt, grew straight past the bottom of the window with **nothing to scroll and the Done button somewhere off-screen**. All three are now **full-height panels that slide in from the edge**, the same surface the logs, files and conversations sheets already use: the form scrolls, while the title and the Done bar stay put. The three list pages also dropped from three columns to **two**, so a long automation name, its schedule and its controls all stay readable instead of being squeezed into a third of the window.

### Every Automation Says When It Runs Next

An automation card gave you its schedule in **small grey text among everything else** on the card — the one fact about a scheduled job that changes on its own, buried in the one line that never does. Each card now leads with **a countdown chip**: _Next run in 3 hours_, in the same shape the composer wears for its model. Inside the final minute it **counts down by the second**, and when the moment passes the card **rolls forward to the next occurrence by itself** instead of sitting on a time that has already gone. A switched-off automation wears the chip greyed out rather than promising a run that isn't coming. The exact wall-clock time, the schedule's own syntax and when you last edited it moved to a small monospace line at the foot of the card — and the editor now **previews the very same chip** the card will wear once you save.

## v1.0.280 — 2026-09-05

### A Turn That Survives the Power Going Out

Until now a conversation reached your disk **exactly once — at the very end**. A run that worked for forty minutes across a dozen tool calls existed nowhere but in the app's memory while it worked, so a crash, a force-quit, an update installing itself, or a Windows restart threw the whole thing away and left you with **your question and nothing else**. Every in-app turn is now **written to disk as it happens**: the answer so far, every tool card, the task timeline. The prompt lands before the first word arrives, the slow and expensive parts — a tool call, its result, a task flipping to done — are saved within a second, and the prose follows a few seconds behind. Quit the app mid-run, restart the machine, pull the plug: **the conversation comes back with the work in it**, marked as the run that never got to finish, and nothing about a turn that ends normally changes at all.

### Restarts Wait for the Answer to Land

Asking the agent to restart your machine used to take it down **that instant** — including the turn that was still being saved, so the very answer telling you it was restarting went down with it. A restart or shutdown is now **scheduled about twenty seconds out**, which is far longer than saving needs and short enough that you won't notice waiting. The agent tells you what is about to happen and how to stop it (`shutdown /a` on Windows), gives the machine longer when a download or a long write is still in flight, and can still go down immediately if you explicitly ask for it. It also **can't sneak a reboot through the terminal** any more — that path skipped both the approval card and the delay.

### Screenshots as Sharp as the Task Needs

Screenshot resolution and format used to be **two settings you had to find and tune yourself**, and every capture came out the same regardless of what it was for. Both are now **chosen per screenshot by the agent**, which knows what it's looking at: an ordinary hunt for a button stays small and fast, while **reading a page of code, judging spacing and color, or handing you a screenshot to keep** goes up to 2560 pixels and lossless PNG. Ask for a **higher-resolution or sharper screenshot** at any point and it simply takes one — it is a choice on the next capture, not a preference buried in a panel. The old settings are gone from the app, the terminal and your phone, because nothing needs to write them any more.

### Your Voice, Changed by Asking

Changing how the agent **speaks** or how it **hears you** meant opening Settings and finding the right panel. Now you just say it. **"Use a British voice"**, **"you're talking too fast"**, **"transcribe in Arabic from now on"**, **"use a more accurate model"** — the agent reads your current settings, changes the one you meant, and tells you in plain words what it changed. It can also **install the voice and transcription engines on request**, with the same progress bar the panel's own button shows. Whatever it changes, the **Settings panel and your phone update live**, and it will only ever set a voice, speed, model or language that every screen can actually display — so a default it sets for you never silently reverts.

### Automations, Procedures and Projects at a Glance

All three pages listed their entries as **tall stacked rows**, each one carrying its full prompt, its attached files and its folders — so four automations filled the window and finding one meant scrolling past everything it contained. They are now **three-column grids of compact cards**, matching the Services page: an icon, the name, the two lines that matter, and the controls. The prompt, files and folders live in the editor, which is what the editor is for. Automations also finally have **a name of their own** — "Morning digest" rather than "Daily (08:00)" — so a card tells you what a job _does_, with its schedule reading underneath.

### Logs and Files, One Click Away

The **Logs** and **Files** buttons were folded inside the context meter's hover card, so reaching either meant hovering one thing to click another. They now sit **right in the composer footer** as two small chips carrying their own counts — one click, no hover. Both sheets, along with the **expanded file and PDF viewers**, also stopped being boxes floating in the middle of a dimmed screen: they now **slide in from the edge as full-height panels**, mirroring the conversations sheet on the other side, so a long document or a long timeline gets the whole height of the window to be read in.

### Thinking, Shown or Hidden

The model's reasoning card is welcome company for some people and clutter for others. There is now a **Show reasoning** switch in Preferences — **on by default**, and shared by this app and your phone so the two never disagree. Turning it off **hides the card and nothing more**: the model still thinks exactly as before, and the reasoning is still saved with the conversation and still included when you export it, so switching it back on brings every thought back with it.

## v1.0.279 — 2026-09-04

### One Model, One Chip

The composer carried **two labels side by side** — a Local one and a Cloud one — as though both were somehow live, when only ever one model answers you. There is **a single chip** there now, and it shows **the model that will answer**: your provider's logo and its name, or Ollama's logo and your local model's name. Click it for the same searchable card as before. Choosing a model **is** the switch — pick an Ollama model and you are running local, pick a cloud model and you are running that provider — so the checkmark in the list marks **the one model you're on** instead of one per side. Your local model always keeps a row of its own in that list, so it is there to pick even when Ollama isn't answering.

### The Export Button Waits Until There's Something to Export

The **download-as-PDF** button sat in the header of every conversation, greyed out and unclickable until the chat had something printable in it. On a **brand-new conversation it is simply not there** now, and it appears the moment there is something worth exporting — a dead control says less than no control at all.

## v1.0.278 — 2026-09-03

### The Model List Comes Back

The composer's model card spent a version speaking in chips — three sideways-scrolling rows you had to drag through to find a brain. It is **a list again**: your installed Ollama models on top, then a group per connected provider, each model on its own line with its **size, badges and context window**, and a checkmark on the one you're using. It **scrolls down the way a list should**, never sideways, and the **search box is back at the top** — type a few letters and it filters local models and every provider at once. The chip rows stay where they belong, on the project pickers and the phone.

### Long Model Names Fit the Composer

The **Local** and **Cloud** labels under the composer were capped so tightly that any name past about twenty characters got cut off mid-word — a long Ollama tag or a full vision-model id showed as little more than a stub. The cap is now **wide enough for every model in the catalog**, so the composer tells you which brain you're on at a glance instead of leaving you to guess from the first half of its name.

## v1.0.277 — 2026-09-02

### Reasoning in Plain View

The **Reasoning** card no longer folds the model's thinking behind a click. It is now an **open scroll block, styled like a tool's output**: the thinking sits right there under a small brain icon, grows with what it holds up to **eight lines**, and scrolls inside its own box past that — a one-line thought takes one line, and a long deliberation never swallows the conversation. Hover the block and a **copy** button appears, putting the whole thinking on your clipboard. When a model opens its reasoning with a heading, that **heading becomes the card's title** instead of the plain word "Reasoning". While a reply is still streaming, the block **follows the newest line** as it arrives and stops following the moment you scroll up to read — and a conversation you reopen shows every card from its first line.

## v1.0.276 — 2026-09-01

### Reasoning That Opens at the Beginning

Tapping a turn's **Reasoning** card used to drop you at the tail of the thinking — its first line flung far above the screen — and closing it could hurl you all the way back up to your own prompt. The card now minds your place in the conversation: expanding scrolls **the head of the reasoning into view** so you always read the thinking from its first line, and collapsing carries you **straight back to the newest message** at the bottom. If the reasoning is short enough to fit where you already are, **nothing moves at all** — and opening a conversation still lands pinned to the end, exactly as before.

## v1.0.275 — 2026-09-01

### Write the Prompt Right Where You Read It

The prompt in the Automations and Procedures editors — and a project's instructions — used to be a preview you had to click to edit, and clicking it anywhere flung open a full-screen sheet. That block is now **a real editor, sitting right in the dialog**: type in place, scroll a long prompt inside it, and everything autosaves exactly as before. It keeps **one fixed height, filled or empty**, so the dialog never jumps around as the text grows, and it wears **the same recessed look as every other input field**. The **Edit** button below is now the one thing that opens the full-screen editor — for when a prompt deserves the whole window — so reading, selecting, and scrolling never open anything by surprise.

### Projects Are One Tap Away

Binding an automation or a procedure to a project meant opening a dropdown that hid the list and truncated the name it showed. The picker is now **a row of chips, the whole list on one line** — each project wearing its own emoji and title, **No project** first — and the row **scrolls sideways** however many projects you have, with the chosen chip carried into view when the editor opens. One tap to bind, one tap to unbind, exactly like the picker on the phone.

### The Model Picker Speaks in Chips Too

The composer's model card traded its searchable list for the same language: **one scrolling row of your installed Ollama models, one of your connected providers, and one of the active provider's models** — the lit chip is the brain you're on, and a provider chip brings its remembered model along. It is the picker the mobile app already has, now on the desktop, so switching brains feels identical on both screens.
