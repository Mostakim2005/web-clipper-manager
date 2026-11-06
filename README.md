# Web Clipper Manager

Clip a **Facebook post**, a **Twitter/X post**, a **Reddit thread** or a **web article** into the same Obsidian-ready Markdown note — with a stable ID, images, author, date, links and engagement — or export it as **PDF**, **full-page PNG/JPEG**, or a **self-contained HTML archive**.

Everything runs locally. No accounts, no telemetry, no cloud.

**Scope:** six sources, four output formats, Edge and Chrome. YouTube and Telegram are the two remaining sources, held pending format decisions. Organisation, tagging, search and AI are handled downstream, not here. See [`SCOPE.md`](SCOPE.md).

---

## What works right now

| | Capability | Detail |
|---|---|---|
| ✅ | Article | Title, author, date, body, images, code, lists, quotes |
| ✅ | Facebook post | Text, author, timestamp, photos, unwrapped outbound links |
| ✅ | Twitter / X post | Text, author, handle, avatar, date, original-resolution images, engagement |
| ✅ | Reddit post | Title, selftext, author, subreddit, score, gallery images, top comments |
| ✅ | One format | Single normalized `Clip` → one renderer, identical skeleton for all sources |
| ✅ | Stable `id` | `omni-<hash of canonical URL>` in frontmatter — same page ⇒ same ID |
| ✅ | Vault folder picker | Browse dialogs for vault, notes folder, attachments folder |
| ✅ | Separate note/asset locations | Notes folder and attachments folder are independent settings |
| ✅ | Three attachment modes | Shared folder · subfolder inside each note's folder · next to the note |
| ✅ | Embed style | `![[image.png]]` wikilinks (with optional width) or standard `![](path)` |
| ✅ | Markdown export | Vault write, `.md` download, clipboard |
| ✅ | Note PDF | A4 render of the note with images inlined |
| ✅ | Page PDF | Prints the live page exactly as it renders (DevTools protocol) |
| ✅ | Full-page screenshot | PNG or JPEG of the whole page, not just the viewport |
| ✅ | HTML archive | Single portable `.html` with images inlined as data URIs |
| ✅ | Service | Downloads images, writes vault files, refuses path traversal, backs up edited notes |

Verified by **106 automated checks** (57 extraction/render, 19 service, 16 accessibility/wiring, 4 PDF, 10 syntax/manifest).

### Not built, on purpose

Bluesky, Mastodon, Hacker News, LinkedIn, Instagram, Threads, WhatsApp, Slack and
Discord are out. So are JSON/CSV/EPUB/DOCX/WARC exports, Notion/Logseq/Joplin
targets, search, tags, highlights, reading status, AI features, Firefox and
Safari. [`SCOPE.md`](SCOPE.md) records why, so a future session does not re-add
them.

YouTube and Telegram are in scope and not yet written.

---

## Install

### 1. Dependencies

```powershell
npm install
```

### 2. Load the extension

1. Open `edge://extensions` (Chrome: `chrome://extensions`).
2. Turn on **Developer mode** — left sidebar in Edge, top-right in Chrome.
3. Click **Load unpacked**.
4. Select the `extension` folder — the one containing `manifest.json`, **not** the
   repository root. Keep the repository wherever you cloned it.
5. Pin the extension from the toolbar's puzzle-piece menu.

There is no "Custom Extensions" menu in Edge. **Load unpacked** under Developer
mode is the only sideload path.

Expected prompts:

- *Read and change all your data on all websites* — required to extract content
  from any page (`<all_urls>`).
- *Debugger* — required for full-page screenshots and live-page PDF. A brief
  "started debugging" banner appears during those two actions only.

The ID will be `deolmeeiaonpcokalgopkcihblojihlh` (pinned by the manifest `key`).
Do not move the folder afterwards; unpacked extensions break when their path
changes. After editing any file, click the reload arrow on the extension card.

> The pinned `key` is public and safe to commit. Its private half lives in
> `tools/extension-key.json`, which is **not** in this repository — see
> [Security notes](#security-notes).

### 3. Start the local service

Double-click `local-service\start.cmd`, or:

```powershell
npm run service
```

Leave the window open. It listens on `http://127.0.0.1:8787`.

> Without the service the extension still previews, downloads Markdown, HTML, images and page PDFs, but it cannot write into the vault or download article images.

### 4. Configure

Click the extension → ⚙:

1. **Vault path** → `Browse…`
2. **Notes folder** and **Attachments folder** → `Browse…` (both are resolved inside the vault)
3. Pick **attachment mode** and **embed style**
4. **Save settings** → **Test write**

---

## Use

- **Popup** → `Capture this page` → edit the Markdown → `Save to vault`.
- **Right-click** anywhere → `Clip with Web Clipper Manager` (silent, uses saved settings).
- **PDF** renders the note as a clean A4 document.
- **Page PDF** prints the live page through the DevTools protocol.
- **IMG** takes a full-page screenshot in your chosen format.
- **HTML** writes a standalone archive with images inlined.
- **Copy** puts the Markdown on the clipboard.

Default output:

```
<vault>/<notesFolder>/2026-11-02 Title.md
<vault>/<attachmentFolder>/omni-<hash>.jpg
```

with the image referenced as `![[omni-<hash>.jpg]]`, so Obsidian resolves it from anywhere in the vault.

Frontmatter looks like this:

```yaml
---
id: omni-1f3k9x2m0q
source: twitter
kind: post
url: https://x.com/jack/status/20
title: just setting up my twttr
author: jack
author_handle: "@jack"
published: 2006-03-21T20:50:14Z
captured: 2026-11-02T10:00:00Z
images: 1
completeness: 1
tags: [clip/twitter]
---
```

> The `omni-` prefix on note IDs and asset filenames is intentionally unchanged by
> the rename to *Web Clipper Manager*. It is stored inside every note already in a
> vault, and changing it would orphan existing attachments.

---

## Tests

```powershell
npm run test:all    # syntax + accessibility + extraction + service
npm run test:pdf    # real PDF render through installed Edge/Chrome
```

The extraction tests run the **real** vendored Readability + Turndown pipeline inside jsdom against HTML fixtures, so they exercise the same code the browser runs.

---

## Layout

```
extension/            MV3 extension (load this folder)
  manifest.json
  src/background.js   routing, service calls, CDP capture, PDF/PNG/HTML
  src/content/        extraction adapters (article, facebook, twitter, reddit)
  src/lib/render.js   Clip -> Obsidian Markdown (pure, unit-tested)
  src/lib/settings.js defaults + storage
  src/pages/          popup + options
  src/vendor/         Readability, Turndown, Turndown GFM, marked
local-service/        loopback HTTP service (vault writes, asset downloads, PDF, folder picker)
test/                 jsdom fixtures + service + PDF tests
tools/                icon generator, key generator
docs/                 product intent, architecture, decisions, visual guide
```

---

## Documentation

| File | What it answers |
|---|---|
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | What the tool must do and feel like; every feature, the wishlist, and what was deliberately removed |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How it is built: system map, tech-stack rationale, each subsystem, verification commands, recipes for adding things safely |
| [`docs/DECISIONS_AND_TRAPS.md`](docs/DECISIONS_AND_TRAPS.md) | Why it is built this way, what failed first, and the landmines not to touch |
| [`docs/VISUAL_GUIDE.html`](docs/VISUAL_GUIDE.html) | The same three documents as a self-contained visual dashboard — open it in a browser, no server needed |
| [`SCOPE.md`](SCOPE.md) | Authoritative in/out list, and the open questions blocking further work |
| [`HANDOFF.md`](HANDOFF.md) | Resume point: state, file map, settings schema, known sharp edges |
| [`AGENTS.md`](AGENTS.md) | Rules for any AI agent working in this repository |
| [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) | Everything this project builds on, and under which licence |

---

## Security notes

- The local service binds `127.0.0.1` only, never `0.0.0.0`, and accepts requests
  only from browser-extension origins.
- Every requested path is resolved against the vault root and rejected if it would
  escape it.
- No credentials are stored and no remote code is loaded; all libraries are vendored.
- The debugger permission is used for exactly two operations and is always
  detached afterwards.
- `tools/extension-key.json` holds the private key for packaging a `.crx`. It is
  git-ignored and must never be committed or published. The public `key` in
  `manifest.json` is safe.

---

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE). Third-party components keep their own
licences — see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
