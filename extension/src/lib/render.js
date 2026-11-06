/* Rendering: Clip → Obsidian-flavoured Markdown.
 * Pure functions, no DOM, no chrome APIs. Safe to unit test in Node.
 */

const YAML_RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;
const YAML_SAFE = /^[A-Za-z0-9_][A-Za-z0-9_./@+-]*$/;
const YAML_NUMBERISH = /^-?\d+(\.\d+)?$/;
const ILLEGAL_FILENAME = /[<>:"/\\|?*\u0000-\u001f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function yamlScalar(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return Number.isFinite(value) || typeof value === 'boolean' ? String(value) : null;
  }
  const text = String(value).trim();
  if (!text) return null;
  if (YAML_SAFE.test(text) && !YAML_RESERVED.test(text) && !YAML_NUMBERISH.test(text)) return text;
  // JSON.stringify produces a valid YAML double-quoted scalar.
  return JSON.stringify(text);
}

/** Deterministic 32-bit FNV-1a, base36. Used for stable attachment names. */
export function hash32(input) {
  let hash = 0x811c9dc5;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function shortHash(input, length = 8) {
  return hash32(input).padStart(6, '0').slice(0, length);
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg']);

export function assetExtension(url) {
  try {
    const path = new URL(url).pathname;
    const match = path.match(/\.([a-z0-9]{2,5})$/i);
    if (match && IMAGE_EXTENSIONS.has(match[1].toLowerCase())) return match[1].toLowerCase();
    const format = new URL(url).searchParams.get('format');
    if (format && IMAGE_EXTENSIONS.has(format.toLowerCase())) return format.toLowerCase();
  } catch {
    /* fall through */
  }
  return 'jpg';
}

/** Content-addressed, collision-free, Obsidian-resolvable attachment name. */
export function assetName(url) {
  return `omni-${shortHash(url)}.${assetExtension(url)}`;
}

export function sanitizeFilename(name, maxLength = 90) {
  let out = String(name || '')
    .replace(ILLEGAL_FILENAME, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();

  if (!out) out = 'Untitled';
  if (WINDOWS_RESERVED.test(out)) out = `${out} note`;
  if (out.length > maxLength) out = out.slice(0, maxLength).trim();
  return out;
}

export function formatDateTokens(clip) {
  const iso = clip.capturedAt || new Date().toISOString();
  const date = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    time: `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`,
    datetime: iso.replace(/\.\d{3}Z$/, 'Z'),
  };
}

export function buildNoteFilename(clip, settings = {}) {
  const template = settings.filenameTemplate || '{{date}} {{title}}';
  const tokens = formatDateTokens(clip);
  const filled = template
    .replace(/\{\{date\}\}/g, tokens.date)
    .replace(/\{\{time\}\}/g, tokens.time)
    .replace(/\{\{title\}\}/g, clip.title || 'Untitled')
    .replace(/\{\{source\}\}/g, clip.source || 'clip')
    .replace(/\{\{author\}\}/g, (clip.author && clip.author.name) || 'unknown');

  const base = sanitizeFilename(filled, 90);
  return base.toLowerCase().endsWith('.md') ? base : `${base}.md`;
}

/**
 * Swap `@@IMG:n@@` tokens for either local embeds (service available)
 * or remote image links (fallback, no vault access).
 */
export function resolveBodyTokens(clip, useLocalAssets, options = {}) {
  const style = options.embedStyle || 'wikilink';
  const width = Number(options.embedWidth) || 0;
  const relativePrefix = options.relativePrefix || '';
  let body = clip.body || '';
  const assets = [];
  const seen = new Set();

  const embed = (name, alt) => {
    if (style === 'markdown') {
      const target = relativePrefix ? `${relativePrefix}${name}` : name;
      return `![${alt || ''}](${target})`;
    }
    // Obsidian wikilink embed: ![[file.jpg]] or ![[file.jpg|300]]
    return width > 0 ? `![[${name}|${width}]]` : `![[${name}]]`;
  };

  (clip.images || []).forEach((image, index) => {
    const token = `@@IMG:${index}@@`;
    if (!body.includes(token)) return;

    if (useLocalAssets && image.url) {
      const name = assetName(image.url);
      if (!seen.has(name)) {
        seen.add(name);
        assets.push({ name, url: image.url, alt: image.alt || '', role: image.role || 'image' });
      }
      body = body.split(token).join(embed(name, image.alt));
    } else if (image.url) {
      body = body.split(token).join(`![${image.alt || ''}](${image.url})`);
    } else {
      body = body.split(token).join('');
    }
  });

  // Any orphan token means the adapter miscounted; drop it rather than leak syntax.
  body = body.replace(/@@IMG:\d+@@/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return { body, assets };
}

/**
 * Stable identity for a clip. Same URL ⇒ same ID, which gives dedupe for free
 * and lets notes be linked from anywhere without path dependencies.
 */
export function clipId(clip) {
  const basis = clip.canonicalUrl || clip.url || `${clip.source}:${clip.title}`;
  return `omni-${shortHash(basis, 10)}`;
}

/** Relative path from one vault folder to another, both vault-relative POSIX. */
export function relativePath(fromDir, toPath) {
  const from = String(fromDir || '').split('/').filter(Boolean);
  const to = String(toPath || '').split('/').filter(Boolean);
  const file = to.pop() || '';
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common += 1;
  const up = new Array(from.length - common).fill('..');
  return [...up, ...to.slice(common), file].filter(Boolean).join('/');
}

/** Relative directory path from one vault folder to another, with trailing slash. */
export function relativeDir(fromDir, toDir) {
  const from = String(fromDir || '').split('/').filter(Boolean);
  const to = String(toDir || '').split('/').filter(Boolean);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common += 1;
  const parts = [...new Array(from.length - common).fill('..'), ...to.slice(common)];
  return parts.length ? `${parts.join('/')}/` : '';
}

/** Where attachment files live, expressed vault-relative. */
export function attachmentDir(settings, noteRelPath) {
  const mode = settings.attachmentMode || 'fixed';
  const folder = String(settings.attachmentFolder || '_assets').replace(/^\/+|\/+$/g, '');
  const noteDir = String(noteRelPath || '').includes('/')
    ? String(noteRelPath).slice(0, String(noteRelPath).lastIndexOf('/'))
    : '';

  if (mode === 'sameAsNote') return noteDir;
  if (mode === 'noteRelative') return [noteDir, folder].filter(Boolean).join('/');
  return folder;
}

/**
 * Shared image-reference normaliser for PDF and HTML export.
 *
 * Markdown cannot render a vault attachment by itself, so both exporters need
 * every local image to become `asset://name`. Handles Obsidian wikilinks and
 * relative Markdown paths produced by resolveBodyTokens(). Remote URLs are left
 * alone on purpose: they already resolve.
 */
export function normalizeImageLinks(markdown) {
  return String(markdown || '')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_, name) => `![${name}](asset://${encodeURIComponent(name)})`)
    .replace(
      /!\[([^\]]*)\]\((?!https?:)([^)\s]*?)(omni-[a-z0-9]+\.[a-z0-9]+)\)/g,
      (_, alt, _dir, name) => `![${alt}](asset://${encodeURIComponent(name)})`
    )
    .replace(/^> \[!(info|note|warning|quote)\]-?\s*(.*)$/gm, (_, _type, title) => `> **${title}**`)
    .trim();
}

function engagementLine(clip) {
  const parts = [];
  const e = clip.engagement || {};
  const push = (label, value) => {
    if (value === null || value === undefined || value === '') return;
    parts.push(`${label} ${typeof value === 'number' ? value.toLocaleString('en-US') : value}`);
  };

  push('♥', e.likes);
  push('⟳', e.reposts !== undefined ? e.reposts : e.retweets);
  push('💬', e.replies);
  push('❝', e.quotes);
  push('👁', e.views);
  push('▲', e.upvotes);
  if (e.reactions) parts.push(e.reactions);

  return parts.join(' · ');
}

/**
 * Assemble the final note. Identical skeleton for every source so downstream
 * tooling (Bases, Dataview, search) sees a consistent shape.
 */
export function renderNote(clip, resolvedBody, options = {}) {
  const includeEngagement = options.includeEngagement !== false;
  const includeId = options.includeId !== false;
  const includeSourceCallout = options.includeSourceCallout !== false;
  const tokens = formatDateTokens(clip);
  const sourceLabel = {
    article: 'Article',
    twitter: 'Twitter / X',
    facebook: 'Facebook',
    reddit: 'Reddit',
  }[clip.source] || 'Web';

  const author = clip.author || {};
  const lines = [];

  lines.push('---');

  const fm = {
    id: includeId ? clipId(clip) : null,
    source: clip.source || 'article',
    kind: clip.kind || 'article',
    url: clip.url,
    canonical: clip.canonicalUrl && clip.canonicalUrl !== clip.url ? clip.canonicalUrl : null,
    title: clip.title,
    author: author.name || null,
    author_handle: author.handle || null,
    author_url: author.profileUrl || null,
    published: clip.publishedAt || null,
    captured: tokens.datetime,
    subreddit: clip.extra && clip.extra.subreddit ? clip.extra.subreddit : null,
    images: (clip.images || []).length || null,
    completeness: typeof clip.completeness?.score === 'number' ? Number(clip.completeness.score.toFixed(2)) : null,
  };

  const tags = [`clip/${clip.source || 'web'}`];
  if (clip.kind === 'article' && clip.source !== 'article') tags.push('clip/article');
  if (clip.extra && clip.extra.subreddit) tags.push('clip/reddit');
  fm.tags = [...new Set(tags)];

  for (const [key, value] of Object.entries(fm)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      const items = value.map(yamlScalar).filter(Boolean);
      if (!items.length) continue;
      lines.push(`${key}: [${items.join(', ')}]`);
      continue;
    }
    const scalar = yamlScalar(value);
    if (scalar === null) continue;
    lines.push(`${key}: ${scalar}`);
  }

  lines.push('---', '');

  // Source callout — always present unless disabled, always the same shape.
  if (includeSourceCallout) {
    const metaBits = [];
    const name = author.name || '';
    const handle = author.handle && author.handle !== name ? ` (${author.handle})` : '';
    if (name) metaBits.push(`**${name}**${handle}`);
    if (clip.publishedAt) metaBits.push(clip.publishedAt.slice(0, 10));
    if (clip.extra && clip.extra.subreddit) metaBits.push(clip.extra.subreddit);
    metaBits.push(`[Original](${clip.url})`);

    lines.push('> [!info] Source');
    lines.push(`> ${sourceLabel} · ${metaBits.join(' · ')}`);
    lines.push('');
  }

  if (clip.kind === 'article' && clip.title) {
    lines.push(`# ${clip.title}`, '');
  }

  if (resolvedBody) lines.push(resolvedBody, '');

  const engagement = engagementLine(clip);
  if (includeEngagement && engagement) {
    lines.push('> [!quote]- Engagement at capture');
    lines.push(`> ${engagement}`);
    lines.push('');
  }

  const missing = (clip.completeness && clip.completeness.missing) || [];
  if (missing.length) {
    lines.push('> [!warning] Partial capture');
    missing.forEach((entry) => lines.push(`> - ${entry}`));
    lines.push('');
  }

  const notes = (clip.notes && clip.notes.length ? clip.notes : (clip.completeness && clip.completeness.notes) || []);
  if (notes.length) {
    lines.push('> [!note]- Capture notes');
    notes.forEach((entry) => lines.push(`> - ${entry}`));
    lines.push('');
  }

  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n';
}
