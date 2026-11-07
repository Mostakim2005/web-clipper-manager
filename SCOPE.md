# Scope

Set by the owner on 2026-11-04 and updated on 2026-11-07. This file overrides any
older roadmap, including anything still listed in `HANDOFF.md`.

If a request conflicts with this file, ask before acting. Do not quietly re-add
something that is listed under **Out of scope**.

---

## In scope

### Sources — five

| Source | Status |
|---|---|
| Article (Readability) | ✅ built |
| Facebook post | ✅ built |
| Twitter/X post | ✅ built |
| Reddit thread | ✅ built |
| Telegram message (public channel only) | ⬜ next |

Every source produces the same `Clip` object and the same note format.

### Capture

| Mode | Status |
|---|---|
| One-click page clip | ✅ |
| Viewport screenshot | ✅ |
| Full-page screenshot | ✅ |
| Live-page PDF | ✅ |
| Selection clip | ⬜ planned |
| Element picker | ⬜ planned |
| Element screenshot | ⬜ planned |

### Output — core four only

| Format | Status |
|---|---|
| Markdown + YAML frontmatter (Obsidian) | ✅ |
| PDF (rendered note, and live page) | ✅ |
| HTML (clean article, and self-contained archive) | ✅ |
| PNG / JPEG (full-page capture) | ✅ |

### Destination

Local filesystem, through the loopback service on `127.0.0.1:8787`.
- **Configurable Default Folder:** Configured folder inside the Obsidian vault (titled `Web Clipper Manager` or `Web Clipping`).
- **Quick Save Option:** A toggleable Quick Save mode that automatically saves directly into the configured default folder.
- **Manual Vault Folder Selection:** When Quick Save is toggled off or when manually requested, the user can choose a specific folder inside the Obsidian vault.
- **Attachments:** Configurable location (shared folder, note-relative, or collocated).

### Browsers

Edge and Chrome. Manifest V3, Chromium 116 or newer.

---

## Out of scope — do not implement

### Sources removed

WhatsApp, Slack, Discord, LinkedIn, Instagram, Threads, Bluesky, Mastodon,
Hacker News, YouTube.

Reasons:
- Bluesky, Mastodon, Hacker News, WhatsApp, Slack, Discord, LinkedIn, Instagram, Threads: not used by the owner; rejected.
- **YouTube:** Redundant because Obsidian already natively supports video embeds, and the owner has separate, dedicated workflows and plans for YouTube. Explicitly removed from this clipper.

### Output formats removed

JSON, CSV, EPUB, DOCX, WARC, MHTML, Notion, Logseq, Joplin, Zotero/BibTeX.

Only Markdown, PDF, HTML and images are produced. No data-export formats.

### Destinations removed

WebDAV, S3, Git, Obsidian URI.

### Organisation — handled in-house

Full-text search, tags, collections, smart folders, highlights, notes on
highlights, reading status, star/due dates, duplicate clusters, link-rot checks,
vault encryption.

The clipper's job ends when the note is written. Everything is collected into the
configured vault folder, and the owner files it manually from there. Do not build
filing, tagging or triage logic.

### Engagement and metric callouts removed

Upvotes, likes, reposts, and engagement counts. These introduce unnecessary clutter
and complication; the `> [!quote]- Engagement at capture` callout is dropped.

### Comments policy

- **Facebook & Twitter/X:** Do NOT extract comments. Extract only the post author, profile name, original URL, full post text body, and attached images.
- **Reddit & other sources:** Comments are strictly optional. Up to ~5 top comments may be retained if simple and already functional, but if comments introduce the slightest friction or complexity, skip them.

### Automation and AI — handled in-house

REST API, CLI, webhooks, MCP server, summarizing, auto-tagging, semantic search,
template authoring.

### Other browsers

Safari (iOS/macOS) and Firefox are out. Edge and Chrome only.

### UI translation

i18n and RTL are not planned. Single user, single language.

---

## Settled Decisions (Updated 2026-11-07)

The five questions previously blocking work have been formally answered by the owner:

1. **Folder Layout & Destination:** Settled. A single configured folder in the Obsidian vault (default `Web Clipper Manager` / `Web Clipping`). Features a toggleable "Quick Save" mode to save straight to this folder, or allows manual selection of any specific vault folder.
2. **YouTube Frontmatter & Extraction:** Settled. Removed from scope entirely (owner has separate dedicated workflow).
3. **Transcript Placement:** Settled. Obsolete due to YouTube removal.
4. **Telegram Note Format:** Settled. One note per message from public channel pages (`t.me/s/<channel>`), preserving the 1-capture = 1-note pipeline with no complex append/merge engine.
5. **Engagement Counts:** Settled. Dropped completely (no upvotes, likes, reposts).
6. **Comments Scope:** Settled. No comments on Facebook or Twitter/X. Capped/optional (~5) on Reddit only if friction-free, otherwise omitted.
