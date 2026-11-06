# Product Intent & Feature Map (`PRODUCT.md`)
> **1-Line Summary:** The permanent source of truth for what Web Clipper Manager must do for its owner, independent of how the code currently does it.

## 1. Core Vision & User Experience Intent

* **What This App Does (Plain English):** It takes the page you are looking at — an article, a Facebook post, a Twitter/X post, a Reddit thread, and later a YouTube video or a Telegram channel message — and saves it into Obsidian as one note in one consistent shape, complete with a stable ID, images, author, date, links and engagement. The same capture can also leave as a PDF, a full-page PNG/JPEG, or a single self-contained HTML file.
* **Who It Is For:** One person, one Obsidian vault, one dedicated folder. It is not a product for a market and it does not need onboarding.
* **How It Must Feel to Use:** Click, glance at the preview, save. No account, no sign-in, no telemetry, no cloud round-trip — everything runs on this machine. When the local service is not running the tool degrades politely instead of failing: it still previews, still exports Markdown, and says plainly which parts are unavailable. A note is never silently half-written and never silently overwritten.
* **What It Deliberately Is Not:** The clipper's job ends when the note is written. Search, tagging, collections, highlights, reading status, filing and AI all happen downstream in the owner's own workflow. Building them here would duplicate work and split the source of truth.

## 2. Active Features (Do Not Break)

### [FEATURE: Single-Clip-Model-One-Renderer] | Aliases: same format, one note shape, Clip object, adapter, normalised
> **1-Line Summary:** Every source is converted into one identical `Clip` object and rendered by exactly one renderer, which is what makes "same format for every source" true rather than aspirational.
* **User Intention (Non-Negotiable):** A Reddit thread and a Twitter post must land in the vault looking like siblings. Adding a source must cost one adapter, never a second renderer.
* **Visual / UI Behavior:** Invisible to the user by design; it shows up as identical frontmatter shape and identical callout structure regardless of where the clip came from.
* **Code Anchors (Grep Targets):**
  * `extension/src/content/extract.js` -> `OC.extract`, `extractArticle`, `extractFacebook`, `extractTwitter`, `extractReddit`
  * `extension/src/lib/render.js` -> `renderNote`

### [FEATURE: Web-Article-Clipping] | Aliases: Readability, blog post, news article, main content
> **1-Line Summary:** Pulls the readable body out of any article page, dropping menus, ads and comments.
* **User Intention (Non-Negotiable):** Title, author, date, body, images, code blocks, lists and quotes survive; page furniture does not.
* **Visual / UI Behavior:** Appears in the popup preview as clean Markdown the owner can edit before saving.
* **Code Anchors (Grep Targets):**
  * `extension/src/content/extract.js` -> `extractArticle`
  * `extension/src/content/lib.js` -> `OC.absolutize`, `OC.stashImages`, `OC.htmlToMarkdown`, `OC.meta`, `OC.jsonLd`

### [FEATURE: Facebook-Post-Clipping] | Aliases: FB, timestamp, photos, See more
> **1-Line Summary:** Captures a single Facebook post's text, author, timestamp and photos, and unwraps outbound links that Facebook redirects.
* **User Intention (Non-Negotiable):** Only the post the owner is looking at — never the comment thread, never the whole feed. Photos sit outside the text block and must not be lost.
* **Visual / UI Behavior:** Same popup preview as every other source. Multi-photo posts arrive as individual images.
* **Code Anchors (Grep Targets):**
  * `extension/src/content/extract.js` -> `extractFacebook`, `expandFacebookSeeMore`, `scoreFacebookArticle`, `pickFacebookArticle`, `facebookTextElement`, `facebookAuthor`, `facebookTimestamp`, `facebookLinks`
  * `extension/src/content/lib.js` -> `OC.unwrapLink`

### [FEATURE: Twitter-X-Post-Clipping] | Aliases: tweet, X, FxTwitter, handle, avatar
> **1-Line Summary:** Captures a post's text, author, handle, avatar, date, original-resolution images and engagement counts.
* **User Intention (Non-Negotiable):** Highest available image resolution, not the timeline thumbnail. When the metadata route is unavailable the visible page is used instead, and the note says so.
* **Visual / UI Behavior:** Engagement counts render as a toggleable callout; a fallback capture adds a "capture notes" callout.
* **Code Anchors (Grep Targets):**
  * `extension/src/content/extract.js` -> `extractTwitter`, `readTwitterDom`, `normalizeTwitterMedia`, `applyTwitterFacets`, `upgradeTwitterImage`
  * `extension/src/background.js` -> `fetchJson`

### [FEATURE: Reddit-Thread-Clipping] | Aliases: subreddit, comments, gallery, upvotes
> **1-Line Summary:** Captures a Reddit post with its gallery images and the top comment branches, delimited and capped.
* **User Intention (Non-Negotiable):** Comment depth is capped at 25 branches and the note states when it was truncated rather than pretending the thread was fully captured.
* **Visual / UI Behavior:** Headings per comment branch in the preview; truncation reported in the partial-capture callout.
* **Code Anchors (Grep Targets):**
  * `extension/src/content/extract.js` -> `extractReddit`, `redditImages`, `redditComments`
  * `extension/src/background.js` -> `fetchJson`

### [FEATURE: Stable-Note-Identity] | Aliases: omni id, hash, dedupe key, same page same note
> **1-Line Summary:** Every note carries `id: omni-<hash of the canonical URL>`, so the same page always produces the same ID.
* **User Intention (Non-Negotiable):** Re-clipping the same page must be recognisably the same note downstream. The ID is a stable handle for Dataview, Bases and any future dedupe.
* **Visual / UI Behavior:** An `id:` line in the frontmatter, hideable in Options.
* **Code Anchors (Grep Targets):**
  * `extension/src/lib/render.js` -> `clipId`, `hash32`, `shortHash`

### [FEATURE: Obsidian-Vault-Writing] | Aliases: save to vault, local service, loopback, 8787, write note
> **1-Line Summary:** Writes the finished note into the Obsidian vault through a small service on this machine, backing up any hand-edited file instead of overwriting it.
* **User Intention (Non-Negotiable):** Silent data loss is unacceptable. If the target note was edited by hand, a timestamped backup is made first. A path that tries to leave the vault is refused.
* **Visual / UI Behavior:** "Save to vault" in the popup, and a silent quick clip from the right-click menu. A status line reports the exact path written.
* **Code Anchors (Grep Targets):**
  * `local-service/host.js` -> `opSave`, `writeAssets`, `assertInside`, `safeJoin`, `requireVault`, `startHttp`
  * `extension/src/background.js` -> `persist`, `buildNote`, `serviceCall`, `hostStatus`

### [FEATURE: Vault-Folder-Pickers] | Aliases: browse, folder dialog, choose vault
> **1-Line Summary:** Native folder dialogs let the owner pick the vault, the notes folder and the attachments folder without typing absolute paths.
* **User Intention (Non-Negotiable):** Picking folders must not require the owner to know or type filesystem paths.
* **Visual / UI Behavior:** `Browse…` buttons in Options; the chosen path is shown and stored.
* **Code Anchors (Grep Targets):**
  * `local-service/host.js` -> `opPickFolder`
  * `extension/src/pages/options.js` -> `browse`, `toVaultRelative`

### [FEATURE: Attachment-Placement-Layouts] | Aliases: assets folder, image location, collocated, per-note folder
> **1-Line Summary:** Images can live in one shared attachments folder, in a subfolder beside each note's folder, or next to the note itself.
* **User Intention (Non-Negotiable):** The owner's vault convention decides where images go, not the tool. Switching the mode must not break existing notes.
* **Visual / UI Behavior:** An attachment-mode choice and a folder field in Options.
* **Code Anchors (Grep Targets):**
  * `extension/src/lib/render.js` -> `attachmentDir`, `relativeDir`, `relativePath`

### [FEATURE: Image-Embed-Style] | Aliases: wikilink, markdown embed, width, ![[ ]]
> **1-Line Summary:** Images are embedded either as Obsidian wikilinks (optionally with a width) or as standard Markdown image links.
* **User Intention (Non-Negotiable):** Wikilinks must resolve from anywhere in the vault; standard Markdown must resolve relative to the note for portability outside Obsidian.
* **Visual / UI Behavior:** Embed-style choice and a width value in Options.
* **Code Anchors (Grep Targets):**
  * `extension/src/lib/render.js` -> `normalizeImageLinks`, `assetName`, `assetExtension`, `resolveBodyTokens`

### [FEATURE: Note-PDF-Export] | Aliases: print note, A4, pdf of the note
> **1-Line Summary:** Renders the captured note as a clean A4 PDF with its images inlined.
* **User Intention (Non-Negotiable):** The PDF must look like the note, not like the web page, and must open on a machine with no access to the vault.
* **Visual / UI Behavior:** A `PDF` button in the popup.
* **Code Anchors (Grep Targets):**
  * `extension/src/background.js` -> `renderPdfHtml`
  * `local-service/host.js` -> `opPdf`, `inlineAssetRefs`, `findChrome`

### [FEATURE: Live-Page-PDF-Export] | Aliases: page pdf, print page, printToPDF
> **1-Line Summary:** Prints the live page exactly as it renders, through the browser's own print pipeline.
* **User Intention (Non-Negotiable):** Sometimes the page layout is the thing worth keeping, so this path must not go through the Markdown renderer at all.
* **Visual / UI Behavior:** A `Page PDF` button; the browser briefly shows a debugging banner.
* **Code Anchors (Grep Targets):**
  * `extension/src/background.js` -> `printPagePdf`, `withDebugger`

### [FEATURE: Full-Page-Screenshot] | Aliases: png, jpeg, capture beyond viewport, long screenshot
> **1-Line Summary:** Saves the entire page — not just the visible viewport — as a PNG or JPEG.
* **User Intention (Non-Negotiable):** A screenshot of what the owner actually wants archived. Pages too tall to render are capped and the note says so rather than failing.
* **Visual / UI Behavior:** An `IMG` button; format chosen in Options.
* **Code Anchors (Grep Targets):**
  * `extension/src/background.js` -> `captureFullPage`, `withDebugger`

### [FEATURE: Self-Contained-HTML-Archive] | Aliases: single file html, inline images, portable archive
> **1-Line Summary:** Writes one portable `.html` file with every image embedded, so it opens correctly years later with no asset folder.
* **User Intention (Non-Negotiable):** The archive must survive the vault being moved, the service being off, and the original URLs expiring.
* **Visual / UI Behavior:** An `HTML` button; assets are inlined by the service, or left as remote URLs with a visible notice when the service is off.
* **Code Anchors (Grep Targets):**
  * `extension/src/background.js` -> `renderArchiveHtml`
  * `local-service/host.js` -> `opSaveHtml`, `inlineAssetRefs`, `download`

### [FEATURE: Markdown-Download-And-Clipboard] | Aliases: .md file, copy markdown, save locally
> **1-Line Summary:** The note can leave as a downloaded `.md` file or straight onto the clipboard, with no service and no vault.
* **User Intention (Non-Negotiable):** This is the floor of the product. With nothing else installed or configured, the tool still produces usable Markdown.
* **Visual / UI Behavior:** `.md` and `Copy` buttons in the popup.
* **Code Anchors (Grep Targets):**
  * `extension/src/pages/popup.js` -> `download`, `copy`, `downloadBlob`

### [FEATURE: Quick-Clip-Context-Menu] | Aliases: right click, silent clip, badge
> **1-Line Summary:** Right-clicking anywhere clips the page silently using the saved settings, without opening the popup.
* **User Intention (Non-Negotiable):** The fast path must stay fast: no dialog, no preview, no confirmation — just the note.
* **Visual / UI Behavior:** `Clip with Web Clipper Manager` in the context menu; success or failure shown on the toolbar badge.
* **Code Anchors (Grep Targets):**
  * `extension/src/background.js` -> `handle`, `buildNote`, `persist`

### [FEATURE: Editable-Preview-Popup] | Aliases: preview, edit before saving, markdown editor
> **1-Line Summary:** The popup shows the finished note as editable Markdown so the owner can fix anything before it is written.
* **User Intention (Non-Negotiable):** The capture is a draft, not a verdict. Whatever is in the box is what gets saved.
* **Visual / UI Behavior:** A source badge, the destination path, a Markdown editor and the export buttons in one pane.
* **Code Anchors (Grep Targets):**
  * `extension/src/pages/popup.js` -> `capture`, `save`, `init`
  * `extension/src/pages/popup.html`

### [FEATURE: Settings-And-Notes-Shape-Options] | Aliases: options page, settings, filename template, toggles
> **1-Line Summary:** One options page controls the vault, folders, filename template, attachment mode, embed style and which callouts and ID appear in the note.
* **User Intention (Non-Negotiable):** Every choice that changes the emitted note must be visible and reversible in one place.
* **Visual / UI Behavior:** Reachable from the popup's gear; includes a "Test write" that proves the vault path works.
* **Code Anchors (Grep Targets):**
  * `extension/src/lib/settings.js` -> `DEFAULTS`, `getSettings`, `setSettings`
  * `extension/src/pages/options.js` -> `load`, `save`, `testWrite`, `refreshHostStatus`

### [FEATURE: Accessible-Interface] | Aliases: a11y, keyboard, screen reader, focus ring, WCAG
> **1-Line Summary:** Both pages are operable by keyboard and screen reader, and that is enforced by a test rather than checked by eye.
* **User Intention (Non-Negotiable):** Every control has a name, every async status is announced, focus is always visible. A regression here is a bug, not a polish item.
* **Visual / UI Behavior:** 2px focus rings, labelled controls, live regions for status and errors, reduced-motion respected.
* **Code Anchors (Grep Targets):**
  * `test/a11y-check.js` -> `check`
  * `extension/src/pages/popup.html` -> `ui` panes

### [FEATURE: Local-Only-Privacy] | Aliases: offline, no telemetry, no account, private
> **1-Line Summary:** Nothing leaves this machine: no accounts, no analytics, no cloud service, no remote code.
* **User Intention (Non-Negotiable):** Captures may contain private posts. The only outbound traffic is the metadata and image requests the page itself already makes.
* **Visual / UI Behavior:** Invisible; the absence of a login screen is the feature.
* **Code Anchors (Grep Targets):**
  * `extension/manifest.json` -> `permissions`
  * `local-service/host.js` -> `startHttp`

### [FEATURE: Graceful-Degradation] | Aliases: partial capture, warning callout, works without service
> **1-Line Summary:** When something is missing — no service, a failed image, a truncated thread — the note still renders and states precisely what was lost.
* **User Intention (Non-Negotiable):** A partial note that admits it is partial beats a blank note or a silent failure.
* **Visual / UI Behavior:** `> [!warning] Partial capture` and `> [!note]- Capture notes` callouts in the note.
* **Code Anchors (Grep Targets):**
  * `extension/src/lib/render.js` -> `renderNote`, `engagementLine`
  * `extension/src/content/extract.js` -> `OC.extract`

## 3. Planned Features & App-Merge Wishlist

### [WISHLIST: YouTube-Video-Clipping] | Aliases: youtube, video, transcript, chapters, duration
> **1-Line Summary:** Capture a YouTube video's metadata, description, thumbnail and timestamped transcript as one note.
* **User Intention:** Video must land in the same shape as every other source, with a transcript that is still readable as a PDF.
* **Target Integration Point:** A new `extractYouTube` adapter feeding the existing `Clip`; `OC.extract` already leaves room in `Clip.extra`.
* **Blocker:** Cannot be written before questions 2 and 3 in `SCOPE.md` are answered — both change the emitted note.

### [WISHLIST: Telegram-Channel-Clipping] | Aliases: telegram, t.me, public channel, message id
> **1-Line Summary:** Capture a message from a public Telegram channel page into the same note format.
* **User Intention:** Same one-note-per-capture behaviour as every other source; public channel pages only, no login and no chat export.
* **Target Integration Point:** A new `extractTelegram` adapter behind `OC.detectSource`.
* **Blocker:** Question 4 in `SCOPE.md` may require an append/merge mode that does not exist in the pipeline today.

### [WISHLIST: Per-Site-Note-Format-Spec] | Aliases: obsidian format, folder layout, frontmatter schema
> **1-Line Summary:** The owner's precise per-source note layout, which then replaces the current provisional renderer.
* **User Intention:** The note shape is the owner's decision, not the tool's. The current renderer is correct for v1 but provisional and deliberately frozen until the spec arrives.
* **Target Integration Point:** `extension/src/lib/render.js` -> `renderNote`, `buildNoteFilename`, `attachmentDir` — revised in one pass, with its tests.

### [WISHLIST: Selection-Clip] | Aliases: highlight to clip, selected text
> **1-Line Summary:** Clip only the text the owner has selected on the page instead of the whole capture.
* **User Intention:** Not every page is worth keeping whole.
* **Target Integration Point:** `window.getSelection()` range clone into the existing Turndown path in `OC.htmlToMarkdown`.

### [WISHLIST: Element-Picker-And-Element-Screenshot] | Aliases: click to capture, hover overlay, subtree
> **1-Line Summary:** Hover to highlight one part of a page, then capture just that part as Markdown or as an image.
* **User Intention:** For pages where the useful content is one block, not the document.
* **Target Integration Point:** A content-script overlay feeding `buildNote`; shares the token resolution in `resolveBodyTokens`.

### [WISHLIST: Keyboard-Shortcut] | Aliases: hotkey, accelerator, bind key
> **1-Line Summary:** Trigger a clip from the keyboard instead of the popup or context menu.
* **User Intention:** Remove the last two clicks from the fast path.
* **Target Integration Point:** `extension/manifest.json` -> `commands`, dispatched through the existing `handle` switch.

### [WISHLIST: Side-Panel-Reader] | Aliases: sidebar, reader view, split view
> **1-Line Summary:** A persistent side panel showing the captured note beside the page.
* **User Intention:** Read and clip without the popup closing on every click elsewhere.
* **Target Integration Point:** The existing popup panes in `extension/src/pages/popup.html`, reused in a side-panel surface.

### [WISHLIST: Shadow-DOM-And-Iframe-Capture] | Aliases: web components, nested frames, missing content
> **1-Line Summary:** Reach content that lives inside shadow roots or iframes, which is currently invisible to the extractors.
* **User Intention:** Some modern sites render their article body in a place the extractor cannot see.
* **Target Integration Point:** `extension/src/content/lib.js` -> `OC.stashImages`, `OC.htmlToMarkdown`.

### [WISHLIST: Paywall-And-Login-Detection] | Aliases: blocked page, subscribe wall, not logged in
> **1-Line Summary:** Recognise that the page is a wall rather than an article, and say so instead of saving a stub.
* **User Intention:** A clear "this page is paywalled" beats a note containing three paragraphs and an advert.
* **Target Integration Point:** `extension/src/content/extract.js` -> `OC.extract`, reported through `completeness`.

## 4. Deliberately Removed — Do Not Re-Add

These were considered and cut. They are not easy wins, and they must not reappear in a roadmap.

| Category | Removed | Why |
|---|---|---|
| Sources | Bluesky, Mastodon, Hacker News, LinkedIn, Instagram, Threads, WhatsApp, Slack, Discord | Not used by the owner; three were agent suggestions explicitly rejected by the owner |
| Output formats | JSON, CSV, EPUB, DOCX, WARC, MHTML, Notion, Logseq, Joplin, Zotero/BibTeX | This is a clipper, not an exporter pipeline. Four formats only |
| Destinations | WebDAV, S3, Git, Obsidian URI | One local vault, one path |
| Organisation | Search, tags, collections, smart folders, highlights, reading status, duplicate clusters, link-rot checks, vault encryption | Done in-house, downstream. Filing logic here would split the source of truth |
| Automation & AI | REST API, CLI, webhooks, MCP server, summarising, auto-tagging, semantic search, template authoring | Owner does this in-house |
| Browsers | Safari, Firefox | Edge and Chrome only |
| Localisation | i18n, RTL | Single user, single language |
| Capture extras | Batch-all-tabs, auto-clip rules, page watch/diff, mobile share sheet | These are automation, which is out of scope |

## 5. Related Documents

* **Scope, authoritative over this file:** `SCOPE.md`
* **How it is built:** `docs/ARCHITECTURE.md`
* **Why it is built that way, and what not to touch:** `docs/DECISIONS_AND_TRAPS.md`
* **Visual dashboard:** `docs/VISUAL_GUIDE.html`
* **Resume point for a new session:** `HANDOFF.md`
