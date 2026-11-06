# Web Clipper Manager — project instructions for agents

Project-specific. These decisions are carried over on purpose. Read this and
`SCOPE.md` before changing anything.

## Read in this order

1. `SCOPE.md` — what is in and out. Authoritative. Wins over every other file.
2. `docs/PRODUCT.md` — what the tool must do and feel like, feature by feature.
3. `docs/DECISIONS_AND_TRAPS.md` — why it is built this way, and the landmines.
4. `docs/ARCHITECTURE.md` — data flow, subsystems, verification, recipes.
5. `HANDOFF.md` — file map, function anchors, settings schema, known edges.

Every section in `docs/` carries a `### [TYPE: Slug] | Aliases: …` header and a
one-line summary directly beneath it. Search those first; read a full section only
when the task touches it.

## Hard rules

- **One `Clip` object, one renderer.** Adapters never emit Markdown. This is what
  keeps "same format for every source" true.
- **Do not add anything `SCOPE.md` excludes.** No new sources, output formats,
  destinations, or browsers. If one seems necessary, ask first; do not add it and
  mention it afterwards.
- **No AI, no tagging, no search, no highlights, no reading status.** The owner
  does those in-house, downstream of this tool. Do not build filing logic.
- **The Obsidian note format is not settled.** `render.js`, the frontmatter
  schema and the folder layout are frozen until the owner supplies the per-site
  spec. Fix bugs; do not redesign.
- **Five questions are outstanding.** They live in `SCOPE.md` → "Open" and are
  summarised at the top of `HANDOFF.md`. Ask them; do not infer answers. The
  YouTube and Telegram adapters must not be written before they are answered,
  because each answer changes the note those adapters emit.
- **Do not reintroduce rejected ideas.** Bluesky, Mastodon, Hacker News, Notion,
  Logseq, Joplin, WARC, EPUB, DOCX, JSON/CSV export, Safari, Firefox and the
  automation layer were considered and removed. They are not "easy wins".
- **The `omni-` prefix is data, not branding.** The product is called Web Clipper
  Manager, but note IDs and asset filenames keep `omni-` because the prefix is
  stored in every note already in a vault.

## Before claiming work is done

```powershell
npm run test:all    # syntax + accessibility + extraction/render + service
npm run test:pdf    # real PDF through installed Edge
```

Both must pass. Then update `HANDOFF.md` with any changed function names, new
files, and new decisions — and, when intent, architecture or a trap changed, the
matching `docs/` file and `docs/VISUAL_GUIDE.html`. A future session must be able
to resume from `HANDOFF.md` alone.

Use the `edit`/`write` tools for source files. Do not rewrite them with a
PowerShell `Get-Content`/`Set-Content` round trip: it decodes UTF-8 as ANSI and
mangles em dashes and arrows. There is a `[TRAP]` entry about exactly this.

## Current state

v0.3.1. Six-source clipper, four of six built. 106 automated assertions.
Manifest packs to a valid ~89 KB CRX. Loads unpacked in Edge or Chrome.

**Paused 2026-11-04.** No feature work is in flight. Resume only after the five
open questions are answered.

## Next work

YouTube and Telegram adapters, as specified in `SCOPE.md`. Telegram is public
channels only (`t.me/s/<channel>`); no private chat export, no login. Both are
blocked on outstanding questions 2, 3 and 4.

## Conventions that exist on purpose

- Classic content scripts sharing `globalThis.OC`, loaded in a fixed order.
  MV3 content scripts cannot be ES modules and there is no bundler.
- `@@IMG:n@@` tokens in `clip.body`; the background service worker resolves them
  to wikilinks, relative Markdown, or remote URLs.
- `asset://name` is the contract between the renderer, the PDF exporter and the
  HTML exporter.
- Loopback HTTP for vault writes, not Chrome native messaging.
- The debugger is attached per operation and always detached in `finally`.
- Hand-rolled YAML serializer; do not swap in a generic stringifier.
- Back up edited notes instead of overwriting them.
