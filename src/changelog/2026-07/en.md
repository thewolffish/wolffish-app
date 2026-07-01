## v1.0.201 — 2026-07-01 `Latest`

### Procedures: Prompts You Save and Run On Demand

A new **Procedures** page (the Play button in the sidebar) holds prompts you want to reuse — write one once, then hit **Play** to run it in a fresh conversation any time. Runs execute in the background under a live overlay with a timer and a color-coded activity log, land in History marked with a Play icon, and never touch the chat you're in. Wolffish can manage them by conversation too — "save this as a procedure," "run my morning brief" — through a new `procedures` capability.

### Connect Multiple GitHub and Notion Accounts

The GitHub and Notion settings panels now hold any number of connections, each with its own label — "Personal," "Work" — and a per-connection **Test** button that shows the account it resolves to. Every GitHub and Notion tool takes an optional connection label to pick the account, and picks automatically when only one is linked. Existing setups migrate on their own.

### WhatsApp Messages in WhatsApp's Own Formatting

Replies on WhatsApp no longer arrive as raw Markdown — `**bold**` asterisk soup, `#` headings, broken tables. Wolffish now writes in WhatsApp's native style (*bold*, _italic_, plain lists), and everything it sends passes through a converter that translates any leftover Markdown — headings, links, tables, task lists — into clean WhatsApp text.

### WhatsApp Now Accepts Any File You Send It

Send a PDF, document, image, video, audio file, or sticker over WhatsApp and Wolffish downloads and reads it like an in-app attachment — previously only voice notes made it through, and anything else was silently dropped. Files that arrive without a name or extension are typed from the media itself, and Telegram gained the same nameless-file handling.

### Every File in a Conversation, One Click Away

A new files button in the chat footer opens everything the conversation holds — your uploads and every file Wolffish produced — in a full-width grid. The timeline beside it now spans the whole conversation, with a collapsible divider per prompt instead of resetting every turn.

### HTML Attachments

You can now attach `.html` files. They open in the code viewer with a one-click toggle between the sandboxed page preview and the highlighted source.

### Fixes & Polish

Background runs — procedures and automations — are now fully isolated from the live chat: they can't skew its context meter, hijack its Stop button, or overwrite a conversation created in the same second. A file a tool already delivered is no longer re-sent in the same turn, and the agent now reliably hands you every file it produces. A turn can no longer end silently mid-task with no message. Chat stays live while you visit Settings and other pages — the context meter and timeline no longer reload, and playing media pauses on the way out. Long conversations render noticeably faster, file cards show readable type labels like "DOCX" instead of raw MIME strings, and durations read naturally ("0.3s", "1m 12s").
