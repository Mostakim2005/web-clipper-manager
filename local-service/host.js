#!/usr/bin/env node
'use strict';

/**
 * Web Clipper Manager local service.
 *
 * Runs on 127.0.0.1 and does the things a browser extension cannot:
 * download attachment images, write files into the Obsidian vault, render PDFs.
 *
 *   node host.js            -> HTTP service on http://127.0.0.1:8787
 *   node host.js --stdio    -> Chrome native-messaging host (optional)
 *
 * Security posture: loopback only, no credentials stored, every write is
 * confined to the configured vault directory.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const VERSION = require('../package.json').version;
const PORT = Number(process.env.OMNI_PORT || 8787);
const PINNED_EXT_ID = 'deolmeeiaonpcokalgopkcihblojihlh';
const ALLOWED_ORIGINS = new Set(
  (process.env.OMNI_ALLOWED_ORIGINS || `chrome-extension://${PINNED_EXT_ID}`)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
const SERVICE_TOKEN = process.env.OMNI_TOKEN || '';
const ALLOWED_VAULT = process.env.OMNI_ALLOWED_VAULT ? path.resolve(process.env.OMNI_ALLOWED_VAULT) : '';
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/* ------------------------------------------------------------------- shared */

function resolveRealWithMissingTail(target) {
  const missing = [];
  let cur = path.resolve(target);
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    missing.unshift(path.basename(cur));
    cur = parent;
  }
  const realBase = fs.existsSync(cur) ? fs.realpathSync(cur) : cur;
  return missing.length ? path.join(realBase, ...missing) : realBase;
}

function assertInside(root, target) {
  const realRoot = fs.realpathSync(root);
  const resolvedTarget = path.resolve(target);
  const lexical = path.relative(realRoot, resolvedTarget);
  if (lexical.startsWith('..') || path.isAbsolute(lexical)) {
    throw new Error('Refusing to write outside the vault');
  }
  if (fs.existsSync(resolvedTarget) && fs.lstatSync(resolvedTarget).isSymbolicLink()) {
    throw new Error('Refusing to follow symbolic link inside vault');
  }
  const realTarget = resolveRealWithMissingTail(resolvedTarget);
  const realRel = path.relative(realRoot, realTarget);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
    throw new Error('Refusing to write outside the vault via symlink');
  }
  return resolvedTarget;
}

function safeJoin(root, sub) {
  const cleaned = String(sub || '').replace(/^[\\/]+/, '');
  return assertInside(root, path.resolve(root, cleaned));
}

function requireVault(vault) {
  if (!vault) throw new Error('No vault path configured');
  const resolved = path.resolve(String(vault));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Vault path does not exist: ${resolved}`);
  }
  const realVault = fs.realpathSync(resolved);
  if (ALLOWED_VAULT) {
    const realAllowed = fs.realpathSync(ALLOWED_VAULT);
    const rel = path.relative(realAllowed, realVault);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('Vault path is outside the allowed vault root');
    }
  }
  return realVault;
}

function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^0\./.test(h)) return true;
  if (/^169\.254\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === '::1' || h === '::' || /^(fc|fd|fe[89ab])/i.test(h)) return true;
  return false;
}

async function download(url, destination) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid asset URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked asset protocol: ${parsed.protocol}`);
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`Blocked private or loopback host: ${parsed.hostname}`);
  }

  const response = await fetch(parsed.href, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const finalHost = new URL(response.url || parsed.href).hostname;
  if (isBlockedHost(finalHost)) {
    throw new Error(`Blocked redirect to private host: ${finalHost}`);
  }
  const contentLen = Number(response.headers.get('content-length') || 0);
  if (contentLen > MAX_ASSET_BYTES) throw new Error('Asset exceeds 25 MB limit');

  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_ASSET_BYTES) throw new Error('Asset exceeds 25 MB limit');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error('empty response');
  fs.writeFileSync(destination, buffer);
  return buffer.length;
}

/** Download every asset that is not already on disk. Never throws for one bad image. */
async function writeAssets(assetDir, assets) {
  fs.mkdirSync(assetDir, { recursive: true });
  const warnings = [];
  let assetsWritten = 0;

  for (const asset of assets || []) {
    if (!asset || !asset.name) continue;
    const target = safeJoin(assetDir, asset.name);
    try {
      if (fs.existsSync(target) && fs.statSync(target).size > 0) {
        assetsWritten += 1;
        continue;
      }
      if (!asset.url) throw new Error('no URL');
      await download(asset.url, target);
      assetsWritten += 1;
    } catch (error) {
      warnings.push(`${asset.name}: ${error.message}`);
    }
  }

  return { assetsWritten, warnings };
}

const MIME_BY_EXT = {
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/**
 * Replace `asset://name` references with base64 data URIs so the archive is a
 * single portable file. Unknown/missing files become an empty src rather than
 * a broken relative path that only resolves on this machine.
 */
function inlineAssetRefs(html, assetDir) {
  return String(html || '').replace(/asset:\/\/([^"'()\s<>]+)/g, (_match, encoded) => {
    const name = path.basename(decodeURIComponent(encoded));
    const file = safeJoin(assetDir, name);
    if (!fs.existsSync(file)) return '';
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  });
}

/* ---------------------------------------------------------------------- ops */

async function opPing() {
  return {
    service: 'omni-clipper',
    version: VERSION,
    node: process.version,
    pid: process.pid,
    uptime: Math.round(process.uptime()),
  };
}

async function opExists(message) {
  const vault = requireVault(message.vault);
  const notePath = safeJoin(vault, message.notePath);
  if (!fs.existsSync(notePath)) return { exists: false };
  const stat = fs.statSync(notePath);
  return { exists: true, mtime: stat.mtime.toISOString(), size: stat.size };
}

async function opSave(message) {
  const vault = requireVault(message.vault);
  const notePath = safeJoin(vault, message.notePath);
  fs.mkdirSync(path.dirname(notePath), { recursive: true });

  const assetDir = safeJoin(vault, message.assetFolder || '_assets');
  const { assetsWritten, warnings } = await writeAssets(assetDir, message.assets);

  const existing = fs.existsSync(notePath) ? fs.readFileSync(notePath, 'utf8') : null;
  const noteDir = path.dirname(notePath);

  if (existing !== message.content) {
    // Never silently destroy a note that was edited by hand after clipping.
    if (existing && !message.overwrite) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      let backup = path.join(noteDir, `${path.basename(notePath, '.md')} (omni backup ${stamp}).md`);
      if (fs.existsSync(backup)) {
        const suffix = crypto.randomBytes(2).toString('hex');
        backup = path.join(noteDir, `${path.basename(notePath, '.md')} (omni backup ${stamp}-${suffix}).md`);
      }
      fs.writeFileSync(backup, existing, 'utf8');
      warnings.push(`existing note backed up to ${path.basename(backup)}`);
    }
    const tmpNote = path.join(noteDir, `.omni-tmp-${crypto.randomUUID()}.md`);
    fs.writeFileSync(tmpNote, message.content, 'utf8');
    fs.renameSync(tmpNote, notePath);
  }

  return { notePath, assetsWritten, warnings, overwritten: Boolean(existing) };
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    ...(process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/microsoft-edge',
        ]),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

async function opPdf(message) {
  const vault = requireVault(message.vault);

  const dir = safeJoin(vault, message.assetFolder || '_assets');
  const html = inlineAssetRefs(message.html, dir);

  const outPath = safeJoin(vault, message.outPath || 'Clippings/clip.pdf');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch {
    throw new Error('puppeteer-core is missing. Run "npm install" in the Web Clipper Manager folder.');
  }

  const executablePath = findChrome();
  if (!executablePath) throw new Error('No Chrome or Edge installation found for PDF rendering.');

  const browser = await puppeteer.launch({ executablePath, headless: 'new' });
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const reqUrl = req.url();
      if (reqUrl.startsWith('data:') || reqUrl.startsWith('about:')) req.continue();
      else req.abort();
    });
    await page.setContent(html || '<h1>Empty</h1>', { waitUntil: 'load', timeout: 45_000 });
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
  } finally {
    await browser.close();
  }

  return { pdfPath: outPath };
}

/** Self-contained HTML archive: download the images, then inline them as data URIs. */
async function opSaveHtml(message) {
  const vault = requireVault(message.vault);
  const outPath = safeJoin(vault, message.outPath || 'Clippings/clip.html');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const assetDir = safeJoin(vault, message.assetFolder || '_assets');
  const { assetsWritten, warnings } = await writeAssets(assetDir, message.assets);

  const html = inlineAssetRefs(message.html, assetDir);
  fs.writeFileSync(outPath, html, 'utf8');
  return { htmlPath: outPath, assetsWritten, warnings, bytes: Buffer.byteLength(html) };
}

/** Write base64 bytes (page PDFs, screenshots) straight into the vault. */
async function opSaveBinary(message) {
  const vault = requireVault(message.vault);
  const outPath = safeJoin(vault, message.outPath || 'Clippings/clip.pdf');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const buffer = Buffer.from(String(message.base64 || ''), 'base64');
  if (!buffer.length) throw new Error('No bytes to write');
  fs.writeFileSync(outPath, buffer);
  return { path: outPath, bytes: buffer.length };
}

/**
 * Native folder picker. A service worker cannot open one, so the service shells
 * out to PowerShell with -STA (WinForms requires a single-threaded apartment).
 */
function runPickerCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, opts);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        if (code === 1) return resolve({ path: '' });
        return reject(new Error(stderr.trim() || `Folder picker exited with code ${code}`));
      }
      resolve({ path: stdout.trim() });
    });
  });
}

function opPickFolder(message) {
  if (process.platform === 'darwin') {
    const script = 'POSIX path of (choose folder with prompt "Select the Obsidian vault or folder")';
    return runPickerCommand('osascript', ['-e', script]);
  }
  if (process.platform === 'linux') {
    return runPickerCommand('zenity', [
      '--file-selection',
      '--directory',
      '--title=Select the Obsidian vault or folder',
    ]).catch(() =>
      runPickerCommand('kdialog', ['--getexistingdirectory', String(message.initial || os.homedir())])
    );
  }
  if (process.platform !== 'win32') {
    throw new Error('Folder picker is unsupported on this platform. Type the path instead.');
  }

  const script = [
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = 'Select the Obsidian vault or folder'",
    '$dialog.ShowNewFolderButton = $true',
    '$initial = $env:OMNI_INITIAL_DIR',
    'if ($initial -and (Test-Path -LiteralPath $initial)) { $dialog.SelectedPath = $initial }',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '  Write-Output $dialog.SelectedPath',
    '}',
  ].join('\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-pick-'));
  const scriptPath = path.join(tmpDir, `${crypto.randomUUID()}.ps1`);
  fs.writeFileSync(scriptPath, `\ufeff${script}`, 'utf8');

  const cleanup = () => fs.rmSync(tmpDir, { recursive: true, force: true });

  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        windowsHide: true,
        env: { ...process.env, OMNI_INITIAL_DIR: String(message.initial || '') },
      }
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

    child.on('error', (error) => {
      cleanup();
      reject(error);
    });

    child.on('close', (code) => {
      cleanup();
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.trim() || `Folder picker exited with code ${code}`));
        return;
      }
      resolve({ path: stdout.trim() });
    });
  });
}

async function dispatch(message) {
  switch (message.op) {
    case 'ping':
      return opPing();
    case 'exists':
      return opExists(message);
    case 'save':
      return opSave(message);
    case 'saveHtml':
      return opSaveHtml(message);
    case 'saveBinary':
      return opSaveBinary(message);
    case 'pickFolder':
      return opPickFolder(message);
    case 'pdf':
      return opPdf(message);
    default:
      throw new Error(`Unknown op: ${message.op}`);
  }
}

/* --------------------------------------------------------------- http mode */

function startHttp() {
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const hostHeader = String(req.headers.host || '');
    const validHost = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(hostHeader);
    const allowed = !origin || ALLOWED_ORIGINS.has(origin);

    const send = (status, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': allowed && origin ? origin : 'null',
        'Access-Control-Allow-Headers': 'content-type, x-omni-token',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    };

    if (!validHost) return send(403, { ok: false, error: 'Invalid Host header' });
    if (req.method === 'OPTIONS') return send(204, {});
    if (!allowed) return send(403, { ok: false, error: 'Origin not allowed' });

    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, ...(await opPing()) });
    if (SERVICE_TOKEN && req.headers['x-omni-token'] !== SERVICE_TOKEN) {
      return send(401, { ok: false, error: 'Unauthorized: invalid or missing X-Omni-Token' });
    }
    if (req.method !== 'POST') return send(405, { ok: false, error: 'POST only' });

    const chunks = [];
    let bodyBytes = 0;
    for await (const chunk of req) {
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_BODY_BYTES) {
        req.resume();
        return send(413, { ok: false, error: 'Request payload exceeds 50 MB limit' });
      }
      chunks.push(chunk);
    }

    let message;
    try {
      message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return send(400, { ok: false, error: 'Malformed JSON' });
    }

    try {
      const result = await dispatch(message);
      send(200, { ok: true, ...result });
    } catch (error) {
      send(200, { ok: false, error: error.message });
    }
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use — Web Clipper Manager may already be running.`);
      process.exit(2);
    }
    throw error;
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Web Clipper Manager service v${VERSION} → http://127.0.0.1:${PORT}`);
    console.log('Leave this window open. Close it to stop the service.');
  });
}

/* -------------------------------------------------------------------- boot */

startHttp();
