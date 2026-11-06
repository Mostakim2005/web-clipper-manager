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

  // Paths are stored POSIX-style; the service normalises backslashes anyway.
  patch.notesFolder = patch.notesFolder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  patch.attachmentFolder = patch.attachmentFolder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

  await setSettings(patch);
  status('Saved.');
  refreshHostStatus();
  setTimeout(() => status(''), 2500);
}

async function testWrite() {
  status('Testing…');
  try {
    const notesFolder = $('notesFolder').value.trim() || 'Clippings';
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

load();
