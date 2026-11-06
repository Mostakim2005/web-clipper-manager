# Scope

Set by the owner on 2026-11-04. This file overrides any older roadmap, including
anything still listed in `HANDOFF.md`.

If a request conflicts with this file, ask before acting. Do not quietly re-add
something that is listed under **Out of scope**.

---

## In scope

### Sources — six

| Source | Status |
|---|---|
| Article (Readability) | ✅ built |
| Facebook post | ✅ built |
| Twitter/X post | ✅ built |
| Reddit thread | ✅ built |
| YouTube video | ⬜ next |
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

Local filesystem, through the loopback service on `127.0.0.1:8787`. One vault,
one notes folder, one attachments location.

### Browsers

Edge and Chrome. Manifest V3, Chromium 116 or newer.

---

## Out of scope — do not implement

### Sources removed

WhatsApp, Slack, Discord, LinkedIn, Instagram, Threads, Bluesky, Mastodon,
Hacker News.

Reason: not used by the owner. Bluesky, Mastodon and Hacker News were agent
suggestions and were explicitly rejected, so they must not reappear as
"easy wins" in a roadmap.

### Output formats removed

JSON, CSV, EPUB, DOCX, WARC, MHTML, Notion, Logseq, Joplin, Zotero/BibTeX.

Only Markdown, PDF, HTML and images are produced. No data-export formats.

### Destinations removed

WebDAV, S3, Git, Obsidian URI.

### Organisation — handled in-house

Full-text search, tags, collections, smart folders, highlights, notes on
highlights, reading status, star/due dates, duplicate clusters, link-rot checks,
vault encryption.

The clipper's job ends when the note is written. Everything is collected into one
dedicated folder, and the owner files it manually from there. Do not build
filing, tagging or triage logic.

### Automation and AI — handled in-house

REST API, CLI, webhooks, MCP server, summarizing, auto-tagging, semantic search,
template authoring.

### Other browsers

Safari (iOS/macOS) and Firefox are out. Edge and Chrome only.

### UI translation

i18n and RTL are not planned. Single user, single language.

---

## Open — blocked on the owner

### The Obsidian per-site note format

**Status: question outstanding.** The owner is supplying a precise layout for how
each source is stored, and will hand the project to another session when ready.

Until that spec arrives:

- do not redesign `extension/src/lib/render.js`
- do not change the frontmatter schema
- do not add per-source subfolders
- do not "improve" the callout structure

The current renderer is correct for v1 but provisional. Treat it as frozen.

### Questions to ask before touching the renderer

Five answers are needed. Ask all five, in one message, before editing
`render.js` or writing the YouTube and Telegram adapters.

1. **Folder layout.** One flat folder for every clip, or a subfolder per source?
   *Blocks:* `attachmentDir()` and `relativeDir()` behaviour, and whether the
   `notesFolder` default changes from a single folder to a template.

2. **YouTube frontmatter.** Should channel, duration and video ID be separate
   frontmatter fields, or is `source / url / title / author / date` enough?
   *Blocks:* the YouTube adapter's `Clip.extra` shape.

3. **Transcript placement.** Inline blockquote, fenced code block, or a
   collapsible `> [!quote]-` callout?
   *Blocks:* body assembly, and PDF pagination for long videos.

4. **Telegram multi-image messages.** One note per message, or one note per
   channel with messages appended?
   *Blocks:* a real architectural limit. The current pipeline emits exactly one
   note per capture. "One note per channel" needs an append/merge mode that does
   not exist yet.

5. **Engagement counts.** Keep the `> [!quote]- Engagement at capture` callout, or
   drop it now that filing is manual?
   *Blocks:* the `includeEngagement` default and the callout renderer.

Do not guess at any of these. Each one changes the emitted note, and the two
adapters must be written against the settled shape, not retrofitted afterwards.
