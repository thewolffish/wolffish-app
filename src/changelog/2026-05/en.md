## v1.0.59 — 2026-05-19

### Heartbeat Dashboard

You can now see exactly what your agent is doing in the background. The new **Heartbeat** page — accessible from the chat toolbar — gives you a live view of every scheduled automation running in the brainstem: startup tasks, intervals, hourly jobs, daily routines, and weekly schedules. Each job shows its type, cron expression, and when it fires next (with a live countdown). Click any job to inspect the full instruction body with syntax highlighting.

This was built because heartbeat automations were invisible before — you'd define schedules in `heartbeat.md` and just trust they were running. Now you can verify at a glance.

### Shell PATH Resolution

GUI apps on macOS and Linux don't inherit your terminal's PATH. That meant binaries installed via Homebrew, nvm, cargo, pyenv, and similar tools were invisible to the agent — shell commands would fail with "command not found" even though they worked fine in your terminal. Wolffish now spawns your login shell at startup to capture the real PATH and uses it for every child process. It also refreshes PATH after installing system dependencies, so newly installed binaries are immediately available without restarting.

### Better Shell Error Diagnostics

When a shell command fails, the error message now includes the first 500 characters of output alongside the exit code. Previously you'd just see "Command exited with code 1" with no hint about what went wrong. The agent can now read the actual error and act on it — no more blind retries.

### Workspace Viewer Refresh

The "Reset to Default" button has been removed from the workspace viewer. It was a footgun — one click would silently wipe any edits you'd made to a file, replacing it with the factory version. In its place, every file now has a **Resync** button that reloads the file from disk without overwriting anything. The tree-level resync button also got a text label so it's easier to find. Additionally, `heartbeat.md` is now read-only in the viewer to prevent accidental edits to live schedules.

---

## v1.0.47 — 2026-05-17

### Core Agent File is Now Read-Only

The `agents.core.md` file in the workspace viewer is now locked to preview-only mode. This file defines Wolffish's core agent procedures and is managed entirely by the system — manual edits were never intended and would be silently overwritten on the next update. The file is no longer editable in the built-in viewer.

---

## v1.0.46 — 2026-05-16

### Launch at Startup Toggle Fix

The "Launch at startup" toggle in Settings no longer flashes from off to on when you open the tab. Previously the toggle rendered in its default off state before the system check completed, causing a visible flicker. The toggle now waits for the actual OS status before appearing.

---

## v1.0.45 — 2026-05-16

### Sensitive Data Filter

Wolffish has always been able to detect and block messages that look like passwords, API keys, or private keys. That behaviour is now opt-in.

The filter is **off by default** — keeping it always-on turned out to limit what the agent could do, since discussing credentials is a normal part of many workflows (setting up integrations, debugging auth issues, explaining how to rotate keys). With it off, the agent handles those conversations naturally.

If you want the hard guard back — so that accidentally pasting a secret into chat discards the message entirely — go to **Settings → Wolffish** and turn on **Block sensitive data in messages**. When enabled, any message that appears to contain a password, API key, access token, or private key is rejected before it reaches the agent, is never stored anywhere, and you get a short notification explaining what happened. This applies across the desktop app, Telegram, and WhatsApp.

---

## v1.0.44 — 2026-05-16

### No More Arbitrary Limits

Wolffish capabilities used to enforce hard-coded timeouts and result caps that had nothing to do with what was actually possible — a 2-minute ceiling on shell commands, a 10-result cap on web search, a 30s limit on browser navigation, 8KB of tool output visible to the agent. These weren't safety measures; they were guesses baked in at development time that caused real failures in practice: `npm install` getting killed mid-way, `ffmpeg` encoding jobs timing out, large search results silently truncated before the agent could read them.

All of those limits are gone. Every capability now runs until it finishes. The agent decides whether to set a timeout — and when it does, it picks a value that actually matches the command. A quick `which ffmpeg` might get 5 seconds. A `brew install` from source gets as long as it needs.

**What changed:**

- **Shell** — no default or minimum timeout. Commands run to completion unless you explicitly set one.
- **Browser** — navigation and waits use Playwright's defaults; no hard ceiling on how long a page can take to load.
- **ffmpeg, package manager, speech-to-text, text-to-speech, Node.js, cloudflared** — all install and run operations are now timeout-free.
- **Web search** — the 10-result cap is removed. Ask for as many results as you need.
- **GitHub** — `per_page` cap raised from 30 to the API's actual maximum of 100.
- **Tool output** — the motor's result buffer grew from 8KB to 100KB, so the agent now sees the full output of a tool call instead of a truncated slice.
- **Retries** — the default retry limit increased from 3 to 10, with gradual backoff. Transient failures (network blips, slow starts) recover automatically instead of giving up after the third attempt.

The only limits that remain are memory-protection caps on file sizes (documents at 100MB, audio at 500MB) — those exist to protect your machine, not to second-guess the agent.

---

## v1.0.35 — 2026-05-15

### Signed & Notarized Updates

Wolffish builds are now code-signed and notarized by Apple. Auto-updates install cleanly on macOS without Gatekeeper warnings or signature validation failures. The full update pipeline — download, verify, quit, replace, relaunch — works end to end.

### Structured Logging

A new workspace logger writes daily log files to `~/.wolffish/workspace/logs/`. The entire updater lifecycle is instrumented: init, check, download progress, install, and quit. Log files are viewable in the built-in file viewer and are read-only.

### Monthly Changelog

The changelog is now organized by month instead of a single file. A sidebar lists months (newest first, localized), and clicking one loads that month's release notes. New version entries go at the top of each month's file. Each version header now shows its release date, and the current app version is displayed in the changelog header.

---

## v1.0.14 — 2026-05-08

### Auto-Update System

Wolffish can now update itself. When a new version is available, the app downloads it silently in the background and shows a small card in the chat area letting you know it's ready. Click **Update** to install, or dismiss it and it'll remind you next launch.

There's a new **Updates** tab in Settings where you can see your current version, toggle auto-updates on or off, manually check for new versions, and jump to this changelog.

### Localized Changelog

The changelog now ships in both English and Arabic. It automatically picks the right one based on your language setting.

### Workspace Migration

Updating Wolffish no longer risks losing your settings. When the app launches after an update, it merges any new default config keys into your existing `config.json` without touching your values, overwrites the core agent instructions (the ones Wolffish owns), version-checks each official capability and only updates the ones that are behind, and rebuilds the search index from scratch so it reflects the latest files.

### Custom Agent Instructions

The agent instructions file has been split in two. `agents.core.md` carries Wolffish's built-in behavior and gets overwritten on every update. `agents.md` is yours — write whatever you want in it, and Wolffish will never touch it. Your instructions take precedence over the core ones when they conflict.

---

## v1.0.0 — 2026-05-01

### Initial Release

The first public version of Wolffish, a local-first AI desktop agent built on Electron.

### Brain

The core of Wolffish is a pipeline of 23 brain modules inspired by neuroscience. The **prefrontal cortex** assembles a context-aware system prompt every turn, the **hippocampus** logs episodic memory, the **cortex** provides full-text search over the workspace, and the **cerebellum** loads tool-based capabilities on demand.

### Models

Out of the box, Wolffish works with local models through **Ollama** — it manages model downloads, pulls, and selection for you. For heavier tasks, it cascades to cloud providers (**Anthropic** and **OpenAI**) and falls back to local if the cloud is unreachable.

### Capabilities

The agent can run **shell commands**, read and write **files**, work with **git**, browse the web via **Brave Search**, manage **Notion** pages, interact with **GitHub** repos, and connect to **Google Workspace** (Docs, Sheets, Drive, Calendar, Tasks, Gmail). There's also **speech-to-text**, **text-to-speech**, and **computer use** for desktop automation.

### Safety

Every tool call goes through a safety gate. Depending on the danger level, the agent either runs it automatically, asks for your approval, or blocks it outright. You can tune this in Settings.

### Channels

Beyond the chat window, Wolffish can respond through **Telegram** and **WhatsApp**, so you can talk to your agent from your phone.

### Memory

The agent builds up knowledge over time. It logs conversation episodes daily, stores long-term knowledge files, and tracks your preferences so it adapts to how you work.

### Everything Else

**Context-aware compaction** keeps conversations from blowing up the context window. **Usage analytics** track token counts and costs across providers. A built-in **file viewer and editor** lets you browse and modify your workspace without leaving the app.
