import { send } from '../lib/rpc.js';
import { getSettings, setSettings } from '../lib/settings.js';

const $ = (id) => document.getElementById(id);

const ui = {
  sourceBadge: $('sourceBadge'),
  pageTitle: $('pageTitle'),
  idle: $('idle'),
  loading: $('loading'),
  error: $('error'),
  preview: $('preview'),
  errorText: $('errorText'),
  hostHint: $('hostHint'),
  notePath: $('notePath'),
  markdown: $('markdown'),
  stats: $('stats'),
  saved: $('saved'),
};

const state = { tabId: null, notePath: '', assetDir: '', assets: [], hasHost: false, vaultPath: '' };

const SOURCE_LABEL = {
  facebook: 'Facebook',
  twitter: 'Twitter / X',
  reddit: 'Reddit',
  article: 'Article',
};

function detectSource(url) {
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)facebook\.com$/i.test(host)) return 'facebook';
    if (/(^|\.)(twitter|x)\.com$/i.test(host)) return 'twitter';
    if (/(^|\.)reddit\.com$/i.test(host)) return 'reddit';
  } catch {
    /* ignore */
  }
  return 'article';
}

function show(pane) {
  ['idle', 'loading', 'error', 'preview'].forEach((id) => {
    $(id).classList.toggle('hidden', id !== pane);
  });
}

function notice(message, warn = false) {
  ui.saved.classList.remove('hidden');
  ui.saved.classList.toggle('warn', warn);
  ui.saved.textContent = message;
}

function clearNotice() {
  ui.saved.classList.add('hidden');
  ui.saved.classList.remove('warn');
}

function setBusy(busy) {
  document.querySelectorAll('#preview .actions button').forEach((btn) => {
    btn.disabled = busy;
  });
}

function safeName(extension) {
  const raw = (ui.notePath.value.split('/').pop() || state.notePath.split('/').pop() || 'clip').replace(
    /\.md$/i,
    ''
  );
  return `${raw}${extension}`.replace(/[<>:"/\\|?*]/g, '-');
}

async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename, saveAs: true });
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function downloadDataUrl(dataUrl, filename) {
  await downloadBlob(await (await fetch(dataUrl)).blob(), filename);
}

async function init() {
  const settings = await getSettings();
  state.vaultPath = settings.vaultPath || '';
  if ($('quickSave')) $('quickSave').checked = settings.quickSave !== false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabId = tab?.id ?? null;

  const source = detectSource(tab?.url || '');
  ui.sourceBadge.textContent = SOURCE_LABEL[source];
  ui.pageTitle.textContent = tab?.title || '';

  try {
    const host = await send('HOST_STATUS');
    const usable = Boolean(host?.ok);
    ui.hostHint.classList.toggle('hidden', usable);
    if (!usable) {
      ui.hostHint.classList.add('warn');
      ui.hostHint.textContent =
        'Local service not detected. You can still preview and download Markdown, HTML, images and page PDFs, but vault writes and image downloads need it. Start it with local-service\\start.cmd.';
    }
  } catch {
    /* non-fatal */
  }
}

async function capture() {
  show('loading');
  try {
    const result = await send('BUILD', { tabId: state.tabId, options: {} });
    state.notePath = result.notePath;
    state.assetDir = result.assetDir || '';
    state.assets = result.assets || [];
    state.hasHost = Boolean(result.hasHost);

    ui.notePath.value = result.notePath;
    ui.markdown.value = result.markdown;

    const clip = result.clip || {};
    const bits = [
      SOURCE_LABEL[clip.source] || clip.source,
      `${(clip.imageCount ?? 0)} image(s)`,
      `${result.markdown.length.toLocaleString()} chars`,
    ];
    if (clip.completeness && clip.completeness.missing?.length) {
      bits.push(`${clip.completeness.missing.length} warning(s)`);
    }
    bits.push(`assets → ${state.assetDir || '.'}`);
    ui.stats.textContent = bits.join('  ·  ');

    if (!state.hasHost) {
      notice('Preview only — local service unavailable, so the note has not been written to your vault.', true);
    } else {
      clearNotice();
    }

    show('preview');
  } catch (error) {
    ui.errorText.textContent = error.message;
    show('error');
  }
}

async function pickFolder() {
  if (!state.vaultPath) {
    notice('Set your vault path in Options first.', true);
    return;
  }
  try {
    const result = await send('PICK_FOLDER', { initial: state.vaultPath });
    if (!result || !result.path) return;
    const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
    const root = norm(state.vaultPath);
    const picked = norm(result.path);
    let rel = '';
    if (picked.toLowerCase() === root.toLowerCase()) rel = '';
    else if (picked.toLowerCase().startsWith(`${root.toLowerCase()}/`)) rel = picked.slice(root.length + 1);
    else {
      notice(`Picked folder must be inside ${state.vaultPath}.`, true);
      return;
    }
    const file = (ui.notePath.value.split('/').pop() || state.notePath.split('/').pop() || 'clip.md').trim();
    ui.notePath.value = rel ? `${rel}/${file}` : file;
    notice(`Destination set → ${rel || '(vault root)'}`);
  } catch (error) {
    notice(`Folder picker failed: ${error.message}`, true);
  }
}

async function save() {
  if ($('quickSave') && !$('quickSave').checked && ui.notePath.value.trim() === state.notePath && state.vaultPath) {
    await pickFolder();
  }
  setBusy(true);
  try {
    const result = await send('SAVE', {
      notePath: ui.notePath.value.trim() || state.notePath,
      markdown: ui.markdown.value,
      assets: state.assets,
      assetFolder: state.assetDir,
    });
    notice(
      `Saved → ${result.notePath}${result.assetsWritten ? ` · ${result.assetsWritten} image(s) saved` : ''}`
    );
  } catch (error) {
    notice(`Save failed: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function download() {
  try {
    await downloadBlob(
      new Blob([ui.markdown.value], { type: 'text/markdown;charset=utf-8' }),
      safeName('.md')
    );
    notice('Downloaded Markdown file.');
  } catch (error) {
    if (!/cancel/i.test(error?.message || '')) {
      notice(`Download failed: ${error.message}`, true);
    }
  }
}

async function copy() {
  try {
    await navigator.clipboard.writeText(ui.markdown.value);
    notice('Markdown copied to clipboard.');
  } catch (error) {
    notice(`Copy failed: ${error.message}`, true);
  }
}

async function exportPdf() {
  setBusy(true);
  notice('Rendering note PDF…');
  try {
    const result = await send('EXPORT_PDF', {
      markdown: ui.markdown.value,
      notePath: ui.notePath.value.trim() || state.notePath,
      assetFolder: state.assetDir,
    });
    notice(`PDF written → ${result.pdfPath}`);
  } catch (error) {
    notice(`PDF failed: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function exportPagePdf() {
  setBusy(true);
  notice('Printing the live page…');
  try {
    const result = await send('EXPORT_PAGE_PDF', { tabId: state.tabId, notePath: ui.notePath.value.trim() || state.notePath });
    if (result.saved) {
      notice(`Page PDF written → ${result.pdfPath}`);
    } else {
      await downloadDataUrl(
        `data:application/pdf;base64,${result.base64}`,
        result.filename || safeName('.pdf')
      );
      notice('Page PDF downloaded.');
    }
  } catch (error) {
    notice(`Page PDF failed: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function exportImage() {
  setBusy(true);
  notice('Capturing the full page…');
  try {
    const result = await send('EXPORT_IMAGE', { tabId: state.tabId, notePath: ui.notePath.value.trim() || state.notePath });
    await downloadDataUrl(result.dataUrl, result.filename || safeName('.png'));

    if (result.fallback) {
      notice(`Viewport screenshot only — full-page capture failed: ${result.reason}`, true);
    } else if (result.truncated) {
      notice(
        `Screenshot saved (${result.width}×${result.height}, cut from ${result.fullHeight}px). The page exceeded the capture limit.`,
        true
      );
    } else {
      notice(`Screenshot saved (${result.width}×${result.height}).`);
    }
  } catch (error) {
    notice(`Screenshot failed: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function exportHtml() {
  setBusy(true);
  notice('Building HTML archive…');
  try {
    const result = await send('EXPORT_HTML', { tabId: state.tabId, markdown: ui.markdown.value, notePath: ui.notePath.value.trim() || state.notePath });
    if (result.saved) {
      notice(`HTML archive written → ${result.htmlPath}`);
    } else {
      await downloadBlob(
        new Blob([result.html], { type: 'text/html;charset=utf-8' }),
        result.filename || safeName('.html')
      );
      notice(
        result.remoteImages
          ? 'HTML archive downloaded. Images load from their original URLs (start the service to inline them).'
          : 'HTML archive downloaded (images inlined).',
        Boolean(result.remoteImages)
      );
    }
  } catch (error) {
    notice(`HTML failed: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

$('capture').addEventListener('click', capture);
$('retry').addEventListener('click', capture);
$('save').addEventListener('click', save);
$('download').addEventListener('click', download);
$('pdf').addEventListener('click', exportPdf);
$('pagePdf').addEventListener('click', exportPagePdf);
$('img').addEventListener('click', exportImage);
$('html').addEventListener('click', exportHtml);
$('copy').addEventListener('click', copy);
$('pickFolder').addEventListener('click', pickFolder);
$('quickSave').addEventListener('change', (e) => setSettings({ quickSave: e.target.checked }));
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

init();
