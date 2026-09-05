## v1.0.281 — 2026-09-05 `Latest`

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

All three pages listed their entries as **tall stacked rows**, each one carrying its full prompt, its attached files and its folders — so four automations filled the window and finding one meant scrolling past everything it contained. They are now **three-column grids of compact cards**, matching the Services page: an icon, the name, the two lines that matter, and the controls. The prompt, files and folders live in the editor, which is what the editor is for. Automations also finally have **a name of their own** — "Morning digest" rather than "Daily (08:00)" — so a card tells you what a job *does*, with its schedule reading underneath.

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
