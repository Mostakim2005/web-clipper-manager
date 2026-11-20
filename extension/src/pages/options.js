import { DEFAULTS, getSettings, setSettings } from '../lib/settings.js';

const $ = (id) => document.getElementById(id);

const TEXT_FIELDS = [
  'vaultPath',
  'notesFolder',
  'attachmentFolder',
  'filenameTemplate',
  'serviceUrl',
];
const SELECT_FIELDS = ['attachmentMode', 'embedStyle', 'imageFormat'];
const NUMBER_FIELDS = ['embedWidth'];
const TOGGLES = ['includeId', 'includeEngagement', 'includeSourceCallout', 'preferNativeHost'];

function send(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (!response) return reject(new Error('No response'));
      if (response.ok === false) return reject(new Error(response.error));
      return resolve(response.data);
    });
  });
}

function status(message, warn = false) {
  const el = $('status');
  el.textContent = message;
  el.style.color = warn ? '#f3cd8a' : '';
}

/** Vault-relative path for a folder picked with the OS dialog. */
function toVaultRelative(vault, absolute) {
  if (!absolute) return '';
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const target = norm(absolute);
  const root = norm(vault);

  if (!root) return target;
  if (target.toLowerCase() === root.toLowerCase()) return '';
  if (target.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return target.slice(root.length + 1).replace(/^\/+/, '');
  }
  return null; // outside the vault
}

async function browse(field, label) {
  const vault = $('vaultPath').value.trim();
  if (field !== 'vaultPath' && !vault) {
    status('Set the vault path first.', true);
    return;
  }

  const current = $(field).value.trim();
  const initial =
    field === 'vaultPath'
      ? current
      : [vault, current.replace(/\//g, '\\')].filter(Boolean).join('\\');

  try {
    status(`Waiting for the folder dialog (${label})…`);
    const result = await send('PICK_FOLDER', { initial });
    if (!result || !result.path) {
      status('');
      return;
    }

    if (field === 'vaultPath') {
      $('vaultPath').value = result.path;
      status('Vault set. Remember to save.');
      return;
    }

    const relative = toVaultRelative(vault, result.path);
    if (relative === null) {
      status(`That folder is outside the vault. Pick one inside ${vault}.`, true);
      return;
    }
    $(field).value = relative;
    status('Folder set. Remember to save.');
  } catch (error) {
    status(`Folder picker failed: ${error.message}`, true);
  }
}

async function refreshHostStatus() {
  const el = $('hostStatus');
  try {
    const host = await send('HOST_STATUS');
    if (host.ok) {
      el.className = 'notice';
      el.textContent = `Local service connected (v${host.version || '?'}). Images, vault writes, PDF and HTML are available.`;
    } else {
      el.className = 'notice warn';
      el.textContent = `Local service not running (${host.reason}). Start it with local-service\\start.cmd.`;
    }
  } catch (error) {
    el.className = 'notice warn';
    el.textContent = `Local service not running: ${error.message}`;
  }
}

function syncFieldStates() {
  const sameAsNote = $('attachmentMode').value === 'sameAsNote';
  $('attachmentFolder').disabled = sameAsNote;
  $('browseAttachments').disabled = sameAsNote;
  const attHint = $('attachmentFolderHint');
  if (attHint) attHint.textContent = sameAsNote ? 'Not used when attachments are placed next to the note.' : '';

  const isMarkdown = $('embedStyle').value === 'markdown';
  $('embedWidth').disabled = isMarkdown;
  const widthHint = $('embedWidthHint');
  if (widthHint) widthHint.textContent = isMarkdown ? 'Applies to Obsidian wikilinks only.' : '';
}

function markDirty() {
  status('Unsaved changes.', true);
}

async function load() {
  const settings = await getSettings();
  TEXT_FIELDS.forEach((field) => {
    $(field).value = settings[field] ?? DEFAULTS[field] ?? '';
  });
  SELECT_FIELDS.forEach((field) => {
    $(field).value = settings[field] ?? DEFAULTS[field] ?? '';
  });
  NUMBER_FIELDS.forEach((field) => {
    $(field).value = settings[field] ?? DEFAULTS[field] ?? 0;
  });
  TOGGLES.forEach((field) => {
    $(field).checked = Boolean(settings[field]);
  });
  syncFieldStates();
  $('extId').textContent = chrome.runtime.id;
  refreshHostStatus();
}

async function save() {
  const patch = {};
  TEXT_FIELDS.forEach((field) => {
    patch[field] = $(field).value.trim();
  });
  SELECT_FIELDS.forEach((field) => {
    patch[field] = $(field).value;
  });
  NUMBER_FIELDS.forEach((field) => {
    patch[field] = Number($(field).value) || 0;
  });
  TOGGLES.forEach((field) => {
    patch[field] = $(field).checked;
  });

  // Validate loopback service URL and clamp numeric bounds.
  const rawUrl = patch.serviceUrl || DEFAULTS.serviceUrl;
  try {
    const parsed = new URL(rawUrl);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase())
    ) {
      status('Service URL must use http(s) on 127.0.0.1 or localhost.', true);
      return false;
    }
    patch.serviceUrl = parsed.origin;
  } catch {
    status('Service URL is not a valid URL.', true);
    return false;
  }
  patch.embedWidth = Math.max(0, Math.min(4000, Math.round(patch.embedWidth || 0)));
  $('embedWidth').value = patch.embedWidth;

  // Paths are stored POSIX-style; the service normalises backslashes anyway.
  patch.notesFolder = patch.notesFolder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  patch.attachmentFolder = patch.attachmentFolder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

  await setSettings(patch);
  status('Saved.');
  refreshHostStatus();
  setTimeout(() => status(''), 2500);
  return true;
}

async function testWrite() {
  status('Saving and testing…');
  const saved = await save();
  if (!saved) return;
  try {
    const notesFolder = $('notesFolder').value.trim() || DEFAULTS.notesFolder;
    const result = await send('SAVE', {
      notePath: `${notesFolder}/test-omni-clipper.md`,
      markdown:
        '---\ntags: [clip/test]\n---\n\n# Omni Clipper test\n\nIf you can read this in Obsidian, the service works.\n',
      assets: [],
      assetFolder: $('attachmentFolder').value.trim() || '_assets',
    });
    status(`Wrote ${result.notePath}`);
  } catch (error) {
    status(`Failed: ${error.message}`, true);
  }
}

$('saveBtn').addEventListener('click', save);
$('testBtn').addEventListener('click', testWrite);
$('browseVault').addEventListener('click', () => browse('vaultPath', 'vault'));
$('browseNotes').addEventListener('click', () => browse('notesFolder', 'notes'));
$('browseAttachments').addEventListener('click', () => browse('attachmentFolder', 'attachments'));
$('attachmentMode').addEventListener('change', () => {
  syncFieldStates();
  markDirty();
});
$('embedStyle').addEventListener('change', () => {
  syncFieldStates();
  markDirty();
});
[...TEXT_FIELDS, ...NUMBER_FIELDS].forEach((field) => $(field).addEventListener('input', markDirty));
['imageFormat', ...TOGGLES].forEach((field) => $(field).addEventListener('change', markDirty));

load();
