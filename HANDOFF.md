# HANDOFF — Web Clipper Manager

Read this file alone to resume work. Last updated 2026-11-07.

## Status: resumed 2026-11-07

The five open questions were answered by the owner on 2026-11-07. The tree is
green and all tests pass (`npm run test:all` + `npm run test:pdf`).
Documentation and scope are updated.

Audits completed: accessibility (10 findings fixed, enforced by
`test/a11y-check.js`). Not started: security, performance, visual design.

## Settled decisions from the owner (2026-11-07)

Canonical details: `SCOPE.md` → "Settled Decisions". Summary:

1. **Folder layout & destination:** Single folder configured inside the Obsidian vault (default `Web Clipper Manager` / `Web Clipping`). Save uses a toggleable "Quick Save" option (saves straight to the default folder) or manual selection of a specific folder in the vault.
2. **YouTube:** Removed from scope entirely. The owner embeds YouTube natively in Obsidian or handles it through separate dedicated workflows.
3. **Transcript:** Obsolete due to YouTube removal.
4. **Telegram:** One note per message from public channel pages (`t.me/s/<channel>`). Keeps the single-clip single-renderer architecture; no complex append/merge engine.
5. **Engagement counts:** Dropped completely. No upvotes, likes, reposts or engagement callouts (`> [!quote]- Engagement at capture` is removed).
6. **Comments policy:** Facebook & Twitter capture no comments (author name, profile name, post URL, full text body, images only). Reddit comments are strictly optional/minimal (up to ~5 if simple), skipped if complex.

## Handing this to another agent

Give it this file. If the harness does not read project instructions on its own,
point it at `SCOPE.md` and `AGENTS.md` as well.

Opening message that works:

> Read `SCOPE.md`, `AGENTS.md` and `HANDOFF.md` in this repository. All five
> open questions have been answered. Confirm the tree is green with `npm run test:all`
> and `npm run test:pdf`.

## Scope — read `SCOPE.md` first

Committed: **five sources** — article, Facebook, Twitter/X, Reddit (built), plus
Telegram public channels (next). Outputs are **Markdown, PDF, HTML and PNG/JPEG only**.
Edge and Chrome only.

Explicitly out: YouTube, Bluesky, Mastodon, Hacker News, LinkedIn, Instagram,
Threads, WhatsApp, Slack, Discord; JSON/CSV/EPUB/DOCX/WARC/MHTML/Notion/Logseq/
Joplin/Zotero; search, tags, highlights, reading status; AI and automation;
Safari and Firefox; i18n.

The Obsidian per-site note format is **open**, awaiting the owner's spec. The
renderer, frontmatter schema and folder layout are frozen until it arrives.

`AGENTS.md` carries these rules for any future agent session. `SCOPE.md` is
authoritative if files disagree.

## State

v0.3.1. A working MV3 extension + loopback service that clips **Facebook posts, Twitter/X posts, Reddit threads and web articles** into one Obsidian-ready Markdown format, with a stable per-URL ID, a vault folder picker, separate notes/attachments locations, and **PDF / page-PDF / full-page PNG-JPEG / self-contained HTML** export.

Validated by **106 automated assertions** across five suites. The manifest packs
cleanly with Edge (`--pack-extension` produced a valid 89 KB CRX), so it loads
unpacked.

Since v0.3.1: the product was renamed from *Omni Clipper* to **Web Clipper
Manager** (manifest, popup, options, context menu, service banner, docs). The
`omni-` note-ID and asset-filename prefix was deliberately **not** renamed — it is
stored in every note already written. A repository was created at
`github.com/Mostakim2005/web-clipper-manager`, and the documentation was rebuilt
into the modular format described in `AGENTS.md`.

## Run it

```powershell
npm install                                   # already done
npm run service                               # or double-click local-service\start.cmd
npm run test:all                              # 106 checks
npm run test:pdf                              # 4 checks, needs Edge/Chrome
```

Load `extension/` as an unpacked extension. ID is pinned to `deolmeeiaonpcokalgopkcihblojihlh` by `manifest.json` → `key`. Then Options → Browse vault → Browse notes/attachments → Save → Test write.

## File map

Anchors are function names, not line numbers. Line numbers rot; names do not.

### Extension — `extension/`

| File | Role |
|---|---|
| `manifest.json` | MV3, pinned key, `debugger` permission, 6 content scripts in fixed order |
| `src/background.js` | Routing, service calls, CDP full-page capture, note PDF, page PDF, HTML archive, context menu |
| `src/content/extract.js` | Source adapters (article, Facebook, Twitter, Reddit) + orchestrator + message bridge + `clip.html` capture |
| `src/content/lib.js` | `globalThis.OC` helpers: DOM, images, Turndown, metadata |
| `src/lib/render.js` | `Clip` → Markdown. Pure, unit-tested |
| `src/lib/settings.js` | Defaults + storage accessors |
| `src/pages/popup.js` | Capture, preview, edit, save, six export paths |
| `src/pages/popup.html` / `.css` | Popup UI. Labelled controls, live regions, 2px focus rings |
| `src/pages/options.js` / `.html` | Settings + OS folder pickers |
| `src/vendor/*` | Readability, Turndown, Turndown GFM, marked (vendored, no remote code) |

### Service — `local-service/`

| File | Role |
|---|---|
| `host.js` | HTTP on `127.0.0.1:8787`, plus optional `--stdio` native-messaging mode |
| `start.cmd` | Launcher |

### Tests — `test/`

| File | Covers |
|---|---|
| `run-tests.js` | 57 assertions: render functions + all four adapters in jsdom + end-to-end note render |
| `a11y-check.js` | 16 assertions: accessible names, control labels, live regions, duplicate ids, script↔markup wiring on both pages |
| `service-test.js` | 19 assertions: boot, save, traversal guard, failed image, backup, HTML inlining, binary writes |
| `pdf-test.js` | 4 assertions: real PDF from puppeteer-core + Edge |
| `syntax-check.js` | Parses every file, resolves manifest references |
| `fixtures/*.html` | Article, Facebook, Twitter pages |

### Tools — `tools/`
`gen-icons.js` (dependency-free PNG encoder) · `gen-key.js` · `extension-key.json` (pinned identity, **git-ignored — keep private**)

## Key functions

`extension/src/content/extract.js`
- `OC.detectSource`
- `extractArticle` — clones doc, injects `<base>`, Readability, absolutize, stash images, saves cleaned `clip.html`
- `expandFacebookSeeMore` · `scoreFacebookArticle` · `pickFacebookArticle` · `facebookTextElement` · `facebookAuthor` · `facebookTimestamp` · `facebookLinks`
- `extractFacebook` — cleans nested comment articles, stashes images across the whole post, appends unused image tokens
- `upgradeTwitterImage` · `applyTwitterFacets` · `normalizeTwitterMedia` · `readTwitterDom` · `extractTwitter`
- `redditImages` · `redditComments` · `extractReddit`
- `OC.extract` — orchestrator, finalizes title/body/completeness
- message bridge (`PING` / `EXTRACT`)

`extension/src/background.js`
- `serviceCall` · `hostStatus` · `ensureContent` · `sendToTab` · `fetchJson`
- `buildNote` — extract → compute note/asset dirs → resolve tokens → render → build `archiveHtml`
- `persist` — POST `save` with resolved `assetFolder`
- `withDebugger` · `captureFullPage` · `printPagePdf`
- `renderPdfHtml` · `renderArchiveHtml`
- `handle` — `HOST_STATUS`, `FETCH_JSON`, `BUILD`, `SAVE`, `PICK_FOLDER`, `QUICK_CLIP`, `EXPORT_PDF`, `EXPORT_IMAGE`, `EXPORT_PAGE_PDF`, `EXPORT_HTML`, `EXPORT_PNG`

`extension/src/lib/render.js`
- `yamlScalar` · `hash32` · `shortHash` · `assetExtension` · `assetName` · `sanitizeFilename`
- `buildNoteFilename` · `resolveBodyTokens` · `clipId`
- `relativePath` · `relativeDir` · `attachmentDir`
- `normalizeImageLinks` · `engagementLine` · `renderNote`

`extension/src/lib/settings.js`
- `DEFAULTS` · `getSettings` · `setSettings`

`extension/src/content/lib.js`
- `OC.ask` · `OC.meta` · `OC.jsonLd` · `OC.jsonLdValue` · `OC.absolutize` · `OC.bestImageUrl`
- `OC.stashImages` · `OC.turndown` · `OC.htmlToMarkdown` · `OC.tidyMarkdown` · `OC.firstLines`
- `OC.unwrapLink` · `OC.isoDate` · `OC.textOf`

`local-service/host.js`
- `assertInside` · `safeJoin` · `requireVault` · `download`
- `writeAssets` · `inlineAssetRefs`
- `opPing` · `opSave` · `opPdf` · `opSaveHtml` · `opSaveBinary` · `opPickFolder` · `opWriteFile`
- `findChrome` · `dispatch` · `startHttp` · `startStdio`

`extension/src/pages/popup.js`
- `detectSource` · `send` · `show` · `notice` · `init` · `capture` · `save` · `download` · `copy`
- `exportPdf` · `exportPagePdf` · `exportImage` · `exportHtml`

`extension/src/pages/options.js`
- `browse` · `toVaultRelative` · `refreshHostStatus` · `load` · `save` · `testWrite`

## Settings schema (`extension/src/lib/settings.js`)

| Key | Default | Meaning |
|---|---|---|
| `vaultPath` | `''` | Absolute Obsidian vault root |
| `notesFolder` | `'Clippings'` | Vault-relative note folder |
| `attachmentMode` | `'fixed'` | `fixed` \| `noteRelative` \| `sameAsNote` |
| `attachmentFolder` | `'_assets'` | Vault-relative or note-relative attachment folder |
| `filenameTemplate` | `'{{date}} {{title}}'` | Tokens: date, time, title, source, author |
| `embedStyle` | `'wikilink'` | `wikilink` \| `markdown` |
| `embedWidth` | `0` | Obsidian embed width suffix; 0 = original |
| `includeId` | `true` | Emit `id:` in frontmatter |
| `includeEngagement` | `true` | Emit engagement callout |
| `includeSourceCallout` | `true` | Emit `> [!info] Source` |
| `imageFormat` | `'png'` | Full-page screenshot format: `png` \| `jpeg` |
| `serviceUrl` | `'http://127.0.0.1:8787'` | Local service base |
| `preferNativeHost` | `true` | Use the service for vault writes |

> Renaming a key here does not rename stored data in `chrome.storage.sync` — it
> silently falls back to the default. There is a `[TRAP]` entry about it.

## Decisions that matter (do not revert casually)

Full versions, with what failed first and a pivot diagram, live in
`docs/DECISIONS_AND_TRAPS.md`. Short list:

1. **One `Clip` object, one renderer.** Adapters never emit Markdown directly. This is what keeps "the same format" true.
2. **`@@IMG:n@@` tokens.** Extraction runs in the page (no network, no disk); the background decides between `![[wikilink]]`, `![](relative path)`, or a remote URL.
3. **Loopback HTTP, not native messaging.** Chrome on Windows does not reliably launch a `.cmd` native host via `CreateProcess`, and shipping an `.exe` needs a toolchain. HTTP is reliable, `curl`-debuggable, and has no 1 MB message cap. `--stdio` mode still exists if that changes.
4. **Pin the extension ID** via `manifest.json` → `key`, so nothing depends on the install path.
5. **Hand-rolled YAML serializer.** Avoids the classic frontmatter corruption on titles containing `: "` etc.
6. **Backup instead of overwrite** when a note was hand-edited. Merging is a future feature; silent data loss is not acceptable now.
7. **Classic content scripts sharing `globalThis.OC`.** MV3 content scripts cannot be ES modules, and this avoids a bundler entirely.
8. **`asset://name` is the contract between renderer and service.** PDF and HTML export both replace it: local file → data URI; no service → original remote URL.
9. **The debugger is attached per operation and always detached.** Never leave it attached, or the DevTools banner sticks.
10. **Accessibility is asserted in markup, not eyeballed.** `test/a11y-check.js` enforces accessible names, control labels, live regions, unique ids, and that every id the page script looks up still exists. It caught a real regression while this was being written (an input lost its `aria-label`). Async state (errors, saved status, source badge) goes through `role="alert"` / `role="status"` rather than appearing silently.
11. **Scope is deliberately narrow, and pruning is permanent.** Six sources, four output formats, two browsers. Organisation, tagging, search, highlights and AI are done downstream by the owner, so building them here duplicates work and splits the source of truth. Rejected items live in `SCOPE.md` under "Out of scope" precisely so a future session does not rediscover them as "easy wins".
12. **The product name is Web Clipper Manager; the `omni-` prefix stays.** Note IDs and asset filenames were not renamed with the product, because the prefix already exists inside every note in a vault.

## Known bugs / sharp edges

- The `debugger` permission shows a Chrome/Edge infobar while a full-page capture runs. If DevTools is already open, `EXPORT_IMAGE` falls back to a viewport screenshot and says so.
- Full-page screenshots are capped at 16,000 px tall; the popup reports when the page was cut.
- `EXPORT_PAGE_PDF` and `EXPORT_HTML` return multi-MB payloads to the popup when the service is unavailable (browser download). Fine at normal article sizes; very large pages may be slow.
- `opPickFolder` shells out to `powershell.exe -STA`; Windows only. If PowerShell execution policy blocks it, the service also passes `-ExecutionPolicy Bypass`.
- The service must be running before saving; there is no autostart entry yet.
- Reddit caps at 25 comment branches; deeper ones are reported, not fetched.
- Facebook comments are not captured; multi-photo galleries are captured as individual images without order guarantees.
- No dedupe index: re-clipping writes the same note path, and the service backs up the old file.
- `clip.html` is only populated for articles. Other sources export HTML built from their Markdown.
- `chrome.tabs.captureVisibleTab` still exists as the viewport fallback (`EXPORT_PNG`).
- `package-lock.json` still records the old package name `omni-clipper` in its root entry. Harmless; it reconciles on the next `npm install`.

## Next moves (agreed order)

1. **Telegram adapter** — 1.5d. Public channel pages only (`t.me/s/<channel>`), one note per message, no login, no export import.
2. **Obsidian format update & engagement removal** — update `render.js` to drop engagement callout and wire tests accordingly.
3. **Quick Save toggle & Vault folder option** — support toggleable Quick Save to the default `Web Clipper Manager` / `Web Clipping` folder vs manual folder selection.
4. **Selection clip + element picker** — 2d. Both reuse the Turndown path.

Not on the roadmap any more: YouTube, thread engine, Bluesky, Mastodon, Hacker News,
search, note merging, tags, highlights, AI. See `SCOPE.md` for why.

Product intent, feature list and effort notes: `docs/PRODUCT.md`. System design:
`docs/ARCHITECTURE.md`. Decisions and landmines: `docs/DECISIONS_AND_TRAPS.md`.
Scope: `SCOPE.md`. Agent rules: `AGENTS.md`.
