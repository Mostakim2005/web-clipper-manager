import {
  renderNote,
  buildNoteFilename,
  resolveBodyTokens,
  attachmentDir,
  relativeDir,
  assetName,
  normalizeImageLinks,
} from './lib/render.js';
import { getSettings } from './lib/settings.js';
import { marked } from './vendor/marked.esm.js';

const CONTENT_FILES = [
  'src/vendor/readability.js',
  'src/vendor/readability-readerable.js',
  'src/vendor/turndown.js',
  'src/vendor/turndown-plugin-gfm.js',
  'src/content/lib.js',
  'src/content/extract.js',
];

/* ------------------------------------------------------------------ service */

let hostCache = null;

const DEFAULT_SERVICE_URL = 'http://127.0.0.1:8787';

async function serviceCall(message, timeoutMs = 90_000) {
  const settings = await getSettings();
  const base = String(settings.serviceUrl || DEFAULT_SERVICE_URL).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${base}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Service replied HTTP ${response.status}`);
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Service error');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Service timed out');
    if (error instanceof TypeError) throw new Error(`Service not reachable at ${base}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function hostStatus(force = false) {
  if (!force && hostCache) return hostCache;
  try {
    const response = await serviceCall({ op: 'ping' }, 4000);
    hostCache = { ok: true, reason: '', version: response.version };
  } catch (error) {
    hostCache = { ok: false, reason: error.message };
  }
  return hostCache;
}

/* ------------------------------------------------------------------ tab io */

async function ensureContent(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (pong && pong.ok) return;
  } catch {
    /* not injected yet */
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  await new Promise((resolve) => setTimeout(resolve, 150));
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (!response) return reject(new Error('The page did not respond'));
      if (response.ok === false) return reject(new Error(response.error || 'Extraction failed'));
      return resolve(response.clip);
    });
  });
}

async function fetchJson(url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', ...(headers || {}) },
      signal: controller.signal,
      credentials: 'omit',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${new URL(url).host}`);
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Timed out fetching metadata');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ pipeline */

const buildCache = new Map();

function joinRel(...parts) {
  return parts
    .filter(Boolean)
    .map((part) => String(part).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

async function buildNote(tab, options = {}) {
  if (!tab || !tab.id) throw new Error('No active tab');
  if (!/^https?:/i.test(tab.url || '')) {
    throw new Error('This page cannot be clipped. Open a normal website first.');
  }

  await ensureContent(tab.id);
  const clip = await sendToTab(tab.id, { type: 'EXTRACT', payload: options });

  const settings = await getSettings();
  const host =
    settings.preferNativeHost && settings.vaultPath ? await hostStatus() : { ok: false, reason: 'not configured' };
  const useLocalAssets = Boolean(host.ok && settings.vaultPath);

  const notePath = joinRel(settings.notesFolder, buildNoteFilename(clip, settings));
  const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
  const assetDir = attachmentDir(settings, notePath);

  const { body, assets } = resolveBodyTokens(clip, useLocalAssets, {
    embedStyle: settings.embedStyle,
    embedWidth: settings.embedWidth,
    relativePrefix: relativeDir(noteDir, assetDir),
  });

  const markdown = renderNote(clip, body, {
    includeEngagement: settings.includeEngagement,
    includeId: settings.includeId,
    includeSourceCallout: settings.includeSourceCallout,
  });

  const archiveHtml = (clip.html || '').replace(/omniimg:(\d+)/g, (_match, index) => {
    const image = (clip.images || [])[Number(index)];
    return image ? `asset://${assetName(image.url)}` : '';
  });

  const built = {
    clip,
    markdown,
    notePath,
    assetDir,
    archiveHtml,
    assets,
    hasHost: useLocalAssets,
    hostReason: host.reason || '',
    settings,
  };

  buildCache.set(tab.id, built);
  return built;
}

async function persist(notePath, markdown, assets, assetFolder) {
  const settings = await getSettings();
  if (!settings.vaultPath) throw new Error('Set your vault path in Options before saving.');
  return serviceCall({
    op: 'save',
    vault: settings.vaultPath,
    notePath,
    content: markdown,
    assetFolder: assetFolder || attachmentDir(settings, notePath),
    assets: (assets || []).map((asset) => ({ name: asset.name, url: asset.url })),
  });
}

/* --------------------------------------------------------------- full page */

const MAX_PAGE_HEIGHT = 16_000;

/**
 * Attach the DevTools protocol for one operation, then always detach. The
 * debugger is the only way to screenshot past the viewport and to print the
 * live page to PDF instead of re-rendering Markdown.
 */
async function withDebugger(tabId, fn) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (error) {
    throw new Error(`Full-page capture could not attach the debugger: ${error.message}`);
  }
  try {
    return await fn(target);
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

async function captureFullPage(tabId, format = 'png', quality = 90) {
  return withDebugger(tabId, async (target) => {
    await chrome.debugger.sendCommand(target, 'Page.enable');
    const metrics = await chrome.debugger.sendCommand(target, 'Page.getLayoutMetrics');
    const size = metrics.cssContentSize || metrics.contentSize || { width: 1280, height: 900 };

    const width = Math.max(1, Math.ceil(size.width));
    const fullHeight = Math.max(1, Math.ceil(size.height));
    const height = Math.min(fullHeight, MAX_PAGE_HEIGHT);

    const shot = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {
      format,
      quality: format === 'jpeg' ? quality : undefined,
      captureBeyondViewport: true,
      fromSurface: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });

    return {
      dataUrl: `data:image/${format};base64,${shot.data}`,
      width,
      height,
      fullHeight,
      truncated: fullHeight > height,
      format,
    };
  });
}

async function printPagePdf(tabId) {
  return withDebugger(tabId, async (target) => {
    await chrome.debugger.sendCommand(target, 'Page.enable');
    const result = await chrome.debugger.sendCommand(target, 'Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: false,
      paperWidth: 8.27,
      paperHeight: 11.69,
      marginTop: 0.55,
      marginBottom: 0.55,
      marginLeft: 0.5,
      marginRight: 0.5,
    });
    return { base64: result.data };
  });
}

/* ------------------------------------------------------------------- export */

const escapeHtml = (value) =>
  String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const PRINT_CSS = `
  :root { color-scheme: light; }
  body {
    margin: 0;
    font: 11.5pt/1.6 -apple-system, "Segoe UI", Roboto, Georgia, serif;
    color: #1b1f26;
  }
  article { max-width: 46em; }
  h1 { font-size: 20pt; line-height: 1.25; margin: 0 0 .6em; }
  h2 { font-size: 14pt; margin: 1.4em 0 .4em; }
  h3 { font-size: 12pt; margin: 1.2em 0 .3em; }
  p { margin: 0 0 .8em; }
  a { color: #1a4f8a; text-decoration: none; }
  img { max-width: 100%; height: auto; border-radius: 4px; margin: .4em 0; }
  blockquote {
    margin: .8em 0;
    padding: .5em .9em;
    border-left: 3px solid #d0a24a;
    background: #faf7f0;
    color: #3a3f47;
  }
  blockquote p:last-child { margin-bottom: 0; }
  code { font: 10pt ui-monospace, Consolas, monospace; background: #f3f4f6; padding: .1em .3em; border-radius: 3px; }
  pre { background: #f3f4f6; padding: .8em; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  hr { border: none; border-top: 1px solid #e2e5ea; margin: 1.4em 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e2e5ea; padding: .4em .6em; text-align: left; }
  ul, ol { margin: 0 0 .8em 1.2em; padding: 0; }
`;

function renderPdfHtml(markdown) {
  const body = normalizeImageLinks(markdown);

  return `<!doctype html><html><head><meta charset="utf-8"><style>${PRINT_CSS}</style></head><body><article>${marked.parse(
    body
  )}</article></body></html>`;
}

/**
 * Standalone archive of the extracted article. Preferred source is the cleaned
 * HTML from the content script; Markdown is the fallback for posts. Image
 * references stay as `asset://name` so the service can inline them as data URIs.
 */
function renderArchiveHtml(built) {
  const clip = built.clip || {};
  const inner = built.archiveHtml
    ? built.archiveHtml
    : marked.parse(normalizeImageLinks(built.markdown));

  const meta = [clip.author && clip.author.name, clip.publishedAt && clip.publishedAt.slice(0, 10)]
    .filter(Boolean)
    .join(' · ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(clip.title || 'Omni clip')}</title>
<meta name="omni-source" content="${escapeHtml(clip.source || 'article')}">
<meta name="omni-url" content="${escapeHtml(clip.url || '')}">
<meta name="omni-captured" content="${escapeHtml(clip.capturedAt || '')}">
<style>
  ${PRINT_CSS}
  body { margin: 0; background: #fff; }
  .omni-shell { max-width: 46em; margin: 0 auto; padding: 40px 24px 64px; }
  .omni-head { border-bottom: 1px solid #e2e5ea; padding-bottom: 14px; margin-bottom: 26px; }
  .omni-head h1 { margin: 0 0 6px; }
  .omni-head p { margin: 0; color: #5a6472; font-size: 10pt; }
  .omni-head a { color: #1a4f8a; }
  .omni-foot { margin-top: 40px; padding-top: 14px; border-top: 1px solid #e2e5ea; color: #8b94a3; font-size: 9pt; }
</style>
</head>
<body>
<div class="omni-shell">
  <header class="omni-head">
    <h1>${escapeHtml(clip.title || 'Omni clip')}</h1>
    <p>${escapeHtml(meta)}${meta ? ' · ' : ''}<a href="${escapeHtml(clip.url || '#')}">${escapeHtml(
      clip.url || ''
    )}</a></p>
  </header>
  <article>${inner}</article>
  <footer class="omni-foot">Captured with Web Clipper Manager on ${escapeHtml(
    (clip.capturedAt || '').slice(0, 10) || 'unknown date'
  )}.</footer>
</div>
</body>
</html>
`;
}

/* ------------------------------------------------------------------- router */

async function handle(message) {
  switch (message.type) {
    case 'HOST_STATUS':
      return hostStatus(true);

    case 'FETCH_JSON': {
      const { url, headers } = message.payload || {};
      if (!url) throw new Error('Missing URL');
      return fetchJson(url, headers);
    }

    case 'BUILD': {
      const tab = message.payload?.tabId
        ? await chrome.tabs.get(message.payload.tabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      const built = await buildNote(tab, message.payload?.options || {});
      return {
        notePath: built.notePath,
        assetDir: built.assetDir,
        markdown: built.markdown,
        hasHost: built.hasHost,
        hostReason: built.hostReason,
        assets: built.assets,
        hasHtml: Boolean(built.archiveHtml),
        clip: {
          source: built.clip.source,
          kind: built.clip.kind,
          title: built.clip.title,
          url: built.clip.url,
          author: built.clip.author,
          publishedAt: built.clip.publishedAt,
          imageCount: (built.clip.images || []).length,
          completeness: built.clip.completeness,
        },
      };
    }

    case 'SAVE': {
      const { notePath, markdown, assets, assetFolder } = message.payload || {};
      if (!notePath || typeof markdown !== 'string') throw new Error('Nothing to save');
      const result = await persist(notePath, markdown, assets, assetFolder);
      return {
        notePath: result.notePath || notePath,
        assetsWritten: result.assetsWritten || 0,
        warnings: result.warnings || [],
      };
    }

    case 'PICK_FOLDER': {
      const { initial } = message.payload || {};
      const result = await serviceCall({ op: 'pickFolder', initial: initial || '' }, 180_000);
      return { path: result.path || '' };
    }

    case 'QUICK_CLIP': {
      const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      const built = await buildNote(tab, {});
      const result = await persist(built.notePath, built.markdown, built.assets, built.assetDir);
      return { notePath: result.notePath || built.notePath };
    }

    case 'EXPORT_PDF': {
      const { markdown, notePath, assetFolder } = message.payload || {};
      if (typeof markdown !== 'string') throw new Error('Nothing to export');
      const settings = await getSettings();
      if (!settings.vaultPath) throw new Error('Set your vault path in Options first.');

      const outPath = (notePath || 'Clippings/clip.md').replace(/\.md$/i, '.pdf');
      const result = await serviceCall(
        {
          op: 'pdf',
          vault: settings.vaultPath,
          assetFolder: assetFolder || attachmentDir(settings, notePath || ''),
          outPath,
          html: renderPdfHtml(markdown),
        },
        180_000
      );
      return { pdfPath: result.pdfPath || outPath };
    }

    case 'EXPORT_IMAGE': {
      const { tabId } = message.payload || {};
      const settings = await getSettings();
      const id =
        tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (!id) throw new Error('No active tab');
      const format = settings.imageFormat === 'jpeg' ? 'jpeg' : 'png';
      const built = buildCache.get(id);
      const filename = ((built && built.notePath) || 'Clippings/clip.md')
        .split('/')
        .pop()
        .replace(/\.md$/i, `.${format === 'jpeg' ? 'jpg' : 'png'}`);

      try {
        const shot = await captureFullPage(id, format);
        return { ...shot, filename };
      } catch (error) {
        // Debugger blocked (DevTools open, or the user dismissed the banner):
        // a viewport screenshot is still better than nothing.
        const tab = await chrome.tabs.get(id);
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format });
        return { dataUrl, format, filename, fallback: true, reason: error.message };
      }
    }

    case 'EXPORT_PAGE_PDF': {
      const { tabId } = message.payload || {};
      const settings = await getSettings();
      const id =
        tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (!id) throw new Error('No active tab');
      const built = buildCache.get(id);
      const base = ((built && built.notePath) || 'Clippings/clip.md').replace(/\.md$/i, '');
      const filename = `${base.split('/').pop()}.pdf`;

      const { base64 } = await printPagePdf(id);

      if (settings.vaultPath && settings.preferNativeHost && (await hostStatus()).ok) {
        try {
          const result = await serviceCall(
            { op: 'saveBinary', vault: settings.vaultPath, outPath: `${base}.pdf`, base64 },
            120_000
          );
          return { pdfPath: result.path, filename, saved: true };
        } catch {
          /* fall through to download */
        }
      }

      return { base64, filename, saved: false };
    }

    case 'EXPORT_HTML': {
      const { tabId } = message.payload || {};
      const settings = await getSettings();
      const tab = tabId
        ? await chrome.tabs.get(tabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (!tab) throw new Error('No active tab');

      const built = buildCache.get(tab.id) || (await buildNote(tab, {}));
      const html = renderArchiveHtml(built);
      const outPath = built.notePath.replace(/\.md$/i, '.html');
      const filename = outPath.split('/').pop();

      if (settings.vaultPath && settings.preferNativeHost && (await hostStatus()).ok) {
        try {
          const result = await serviceCall(
            {
              op: 'saveHtml',
              vault: settings.vaultPath,
              outPath,
              html,
              assetFolder: built.assetDir,
              assets: (built.assets || []).map((asset) => ({ name: asset.name, url: asset.url })),
            },
            120_000
          );
          return { htmlPath: result.htmlPath || outPath, filename, saved: true };
        } catch {
          /* fall through to download */
        }
      }

      // No service means no image downloads, so point the archive back at the
      // original URLs instead of leaving unresolvable asset:// references.
      const byName = new Map((built.assets || []).map((asset) => [asset.name, asset.url]));
      const remoteHtml = html.replace(/asset:\/\/([^"'()\s<>]+)/g, (match, encoded) => {
        return byName.get(decodeURIComponent(encoded)) || match;
      });

      return { html: remoteHtml, filename, saved: false, remoteImages: true };
    }

    case 'EXPORT_PNG': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('No active tab');
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return { dataUrl };
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  Promise.resolve()
    .then(() => handle(message))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

/* -------------------------------------------------------------- context menu */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'omni-clip',
      title: 'Clip with Web Clipper Manager',
      contexts: ['page', 'selection', 'link', 'image'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'omni-clip' || !tab) return;

  (async () => {
    try {
      const built = await buildNote(tab, {});
      const result = await persist(built.notePath, built.markdown, built.assets, built.assetDir);
      chrome.action.setBadgeBackgroundColor({ color: '#2e7d32' });
      chrome.action.setBadgeText({ text: '✓' });
      setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
      console.info('[Omni Clipper] saved', result.notePath || built.notePath);
    } catch (error) {
      chrome.action.setBadgeBackgroundColor({ color: '#c62828' });
      chrome.action.setBadgeText({ text: '!' });
      setTimeout(() => chrome.action.setBadgeText({ text: '' }), 6000);
      console.error('[Omni Clipper]', error);
    }
  })();
});
