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
const { spawn } = require('node:child_process');

const VERSION = '0.3.0';
const PORT = Number(process.env.OMNI_PORT || 8787);
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/* ------------------------------------------------------------------- shared */

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Refusing to write outside the vault');
  }
  return target;
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
  return resolved;
}

async function download(url, destination) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
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
      const backup = path.join(noteDir, `${path.basename(notePath, '.md')} (omni backup ${stamp}).md`);
      fs.writeFileSync(backup, existing, 'utf8');
      warnings.push(`existing note backed up to ${path.basename(backup)}`);
    }
    fs.writeFileSync(notePath, message.content, 'utf8');
  }

  return { notePath, assetsWritten, warnings, overwritten: Boolean(existing) };
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
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
    await page.setContent(html || '<h1>Empty</h1>', { waitUntil: 'networkidle0', timeout: 45_000 });
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

async function opWriteFile(message) {
  const vault = requireVault(message.vault);
  const target = safeJoin(vault, message.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, message.content, 'utf8');
  return { path: target };
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
function opPickFolder(message) {
  if (process.platform !== 'win32') {
    throw new Error('The folder picker is Windows-only. Type the path instead.');
  }

  const initial = String(message.initial || '').replace(/'/g, "''");
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = 'Select the Obsidian vault or folder'",
    '$dialog.ShowNewFolderButton = $true',
    initial ? `if (Test-Path '${initial}') { $dialog.SelectedPath = '${initial}' }` : '',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '  Write-Output $dialog.SelectedPath',
    '}',
  ]
    .filter(Boolean)
    .join('\n');

  const scriptPath = path.join(os.tmpdir(), `omni-pick-${Date.now()}.ps1`);
  // BOM matters: Windows PowerShell 5.1 reads -File as ANSI without it, which
  // corrupts non-ASCII paths such as "C:\Users\josé\Documents".
  fs.writeFileSync(scriptPath, `\ufeff${script}`, 'utf8');

  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true }
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

    child.on('error', (error) => {
      fs.rmSync(scriptPath, { force: true });
      reject(error);
    });

    child.on('close', (code) => {
      fs.rmSync(scriptPath, { force: true });
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
    case 'writeFile':
      return opWriteFile(message);
    default:
      throw new Error(`Unknown op: ${message.op}`);
  }
}

/* --------------------------------------------------------------- http mode */

function startHttp() {
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const allowed =
      !origin || origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');

    const send = (status, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': allowed && origin ? origin : 'null',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    };

    if (req.method === 'OPTIONS') return send(204, {});
    if (!allowed) return send(403, { ok: false, error: 'Origin not allowed' });

    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, ...(await opPing()) });
    if (req.method !== 'POST') return send(405, { ok: false, error: 'POST only' });

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);

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

/* -------------------------------------------------------------- stdio mode */

function startStdio() {
  const writeFrame = (payload) => {
    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(json.length, 0);
    process.stdout.write(Buffer.concat([header, json]));
  };

  let incoming = Buffer.alloc(0);

  const handleFrame = (text) => {
    let message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      return writeFrame({ ok: false, error: `Bad JSON: ${error.message}` });
    }
    Promise.resolve()
      .then(() => dispatch(message))
      .then((result) => writeFrame({ ok: true, ...result }))
      .catch((error) => writeFrame({ ok: false, error: error.message }));
  };

  process.stdin.on('data', (chunk) => {
    incoming = Buffer.concat([incoming, chunk]);
    while (incoming.length >= 4) {
      const length = incoming.readUInt32LE(0);
      if (incoming.length < 4 + length) return;
      const body = incoming.subarray(4, 4 + length).toString('utf8');
      incoming = incoming.subarray(4 + length);
      handleFrame(body);
    }
  });
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('end', () => process.exit(0));
}

/* -------------------------------------------------------------------- boot */

if (process.argv.includes('--stdio')) startStdio();
else startHttp();
