## v1.0.278 — 2026-09-03 `Latest`

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
