/**
 * Boots the real local service on a test port and exercises it end to end.
 *
 *   node test/service-test.js
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL ${name}\n         ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rpc(payload) {
  const response = await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return response.json();
}

(async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-vault-'));
  console.log(`\nservice (temp vault: ${vault})`);

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'local-service', 'host.js')], {
    env: { ...process.env, OMNI_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk) => (stdout += chunk.toString()));

  try {
    // Wait for boot.
    let healthy = false;
    for (let i = 0; i < 40; i += 1) {
      try {
        const response = await fetch(`${BASE}/health`);
        if (response.ok) {
          healthy = true;
          break;
        }
      } catch {
        /* not up yet */
      }
      await sleep(100);
    }
    check('boots and answers /health', () => assert(healthy, stdout || 'never became healthy'));

    const ping = await rpc({ op: 'ping' });
    check('responds to ping', () => assert(ping.ok && ping.service === 'omni-clipper', JSON.stringify(ping)));
    check('reports a version', () => assert(typeof ping.version === 'string' && ping.version.length > 0));

    const note = '---\nsource: article\n---\n\n# Test note\n\nBody.\n';
    const saved = await rpc({
      op: 'save',
      vault,
      notePath: 'Clippings/2026-11-02 Test note.md',
      content: note,
      assetFolder: '_assets',
      assets: [],
    });

    check('writes the note', () => assert(saved.ok, JSON.stringify(saved)));
    const noteFile = path.join(vault, 'Clippings', '2026-11-02 Test note.md');
    check('file exists on disk', () => assert(fs.existsSync(noteFile), noteFile));
    check('file content matches', () => assert(fs.readFileSync(noteFile, 'utf8') === note));
    check('creates the assets folder', () =>
      assert(fs.existsSync(path.join(vault, '_assets')), 'assets dir missing')
    );

    const refused = await rpc({
      op: 'save',
      vault,
      notePath: '../../escape.md',
      content: 'nope',
      assets: [],
    });
    check('refuses to escape the vault', () => assert(!refused.ok, 'traversal was allowed'));
    check('escape attempt wrote nothing', () => assert(!fs.existsSync(path.join(vault, '..', '..', 'escape.md'))));

    const badAsset = await rpc({
      op: 'save',
      vault,
      notePath: 'Clippings/with-image.md',
      content: 'image below\n\n![[omni-deadbeef.jpg]]\n',
      assetFolder: '_assets',
      assets: [{ name: 'omni-deadbeef.jpg', url: 'http://127.0.0.1:1/nope.jpg' }],
    });
    check('saves the note even when an image fails', () => assert(badAsset.ok, JSON.stringify(badAsset)));
    check('reports the failed image as a warning', () =>
      assert(badAsset.warnings.length === 1, JSON.stringify(badAsset.warnings))
    );

    const edited = await rpc({
      op: 'save',
      vault,
      notePath: 'Clippings/2026-11-02 Test note.md',
      content: 'hand edited\n',
      assetFolder: '_assets',
      assets: [],
    });
    check('backs up a hand-edited note', () =>
      assert(edited.warnings.some((w) => w.includes('backed up')), JSON.stringify(edited.warnings))
    );

    // HTML archive: images that already exist in the asset folder get inlined.
    fs.copyFileSync(
      path.join(__dirname, '..', 'extension', 'assets', 'icon16.png'),
      path.join(vault, '_assets', 'omni-test.png')
    );
    const html = await rpc({
      op: 'saveHtml',
      vault,
      outPath: 'Clippings/archive.html',
      assetFolder: '_assets',
      assets: [],
      html: '<!doctype html><html><body><h1>Archive</h1><img src="asset://omni-test.png"></body></html>',
    });
    check('writes the HTML archive', () => assert(html.ok, JSON.stringify(html)));
    const htmlFile = path.join(vault, 'Clippings', 'archive.html');
    check('HTML archive exists', () => assert(fs.existsSync(htmlFile), htmlFile));
    if (fs.existsSync(htmlFile)) {
      const body = fs.readFileSync(htmlFile, 'utf8');
      check('inlines images as data URIs', () => assert(body.includes('data:image/png;base64,'), body.slice(0, 200)));
      check('leaves no asset:// references', () => assert(!body.includes('asset://'), 'unresolved asset ref'));
    }

    // Binary writes back the page PDF / screenshot path.
    const pdfBytes = Buffer.from('%PDF-1.4 test');
    const binary = await rpc({
      op: 'saveBinary',
      vault,
      outPath: 'Clippings/page.pdf',
      base64: pdfBytes.toString('base64'),
    });
    check('writes binary files', () => assert(binary.ok, JSON.stringify(binary)));
    const pdfFile = path.join(vault, 'Clippings', 'page.pdf');
    check('binary bytes round-trip', () =>
      assert(fs.existsSync(pdfFile) && fs.readFileSync(pdfFile).equals(pdfBytes), pdfFile)
    );

    const unknown = await rpc({ op: 'nonsense' });
    check('rejects unknown ops', () => assert(!unknown.ok && /Unknown op/.test(unknown.error), JSON.stringify(unknown)));
  } finally {
    child.kill();
  }

  fs.rmSync(vault, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length) {
    failures.forEach(({ name, error }) => console.error(`FAILED: ${name}\n  ${error.stack}\n`));
    process.exit(1);
  }
  process.exit(0);
})();
