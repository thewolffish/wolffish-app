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
