/**
 * PDF export smoke test. Uses puppeteer-core against the installed Edge/Chrome.
 *
 *   node test/pdf-test.js
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = 8797;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-pdf-'));
  fs.mkdirSync(path.join(vault, '_assets'), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', 'extension', 'assets', 'icon128.png'),
    path.join(vault, '_assets', 'omni-fixture.png')
  );

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'local-service', 'host.js')], {
    env: { ...process.env, OMNI_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));

  let failed = 0;
  const check = (name, condition, detail) => {
    if (condition) {
      console.log(`  ok   ${name}`);
    } else {
      failed += 1;
      console.log(`  FAIL ${name}\n         ${detail || ''}`);
    }
  };

  try {
    for (let i = 0; i < 40; i += 1) {
      try {
        if ((await fetch(`${BASE}/health`)).ok) break;
      } catch {
        /* booting */
      }
      await sleep(100);
    }

    const html = `<!doctype html><html><body>
      <h1>Omni Clipper PDF test</h1>
      <p>Rendered by the local service.</p>
      <p><img src="asset://omni-fixture.png" width="96"></p>
    </body></html>`;

    const response = await fetch(`${BASE}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'pdf',
        vault,
        assetFolder: '_assets',
        outPath: 'Clippings/pdf-test.pdf',
        html,
      }),
    });
    const result = await response.json();

    check('pdf op succeeds', result.ok === true, JSON.stringify(result));
    const file = path.join(vault, 'Clippings', 'pdf-test.pdf');
    check('pdf file exists', fs.existsSync(file), file);

    if (fs.existsSync(file)) {
      const buffer = fs.readFileSync(file);
      check('is a real PDF', buffer.subarray(0, 4).toString() === '%PDF', buffer.subarray(0, 4).toString());
      check('has meaningful size', buffer.length > 3000, `${buffer.length} bytes`);
    }
  } catch (error) {
    failed += 1;
    console.log(`  FAIL crashed: ${error.message}\n${log}`);
  } finally {
    child.kill();
    fs.rmSync(vault, { recursive: true, force: true });
  }

  console.log(failed ? `\n${failed} failed\n` : '\npdf export works\n');
  process.exit(failed ? 1 : 0);
})();
