/** Parses every extension script as an ES module to catch syntax errors. */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-syntax-'));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'vendor' ? [] : walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

const files = [...walk(EXT), path.join(ROOT, 'local-service', 'host.js')];
let failed = 0;

for (const file of files) {
  const copy = path.join(tmp, path.basename(file, '.js') + '-' + Math.random().toString(36).slice(2) + '.mjs');
  fs.writeFileSync(copy, fs.readFileSync(file));
  try {
    execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
    console.log(`  ok   ${path.relative(ROOT, file)}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${path.relative(ROOT, file)}`);
    console.log(error.stderr.toString().split('\n').slice(0, 6).join('\n'));
  }
}

// Manifest must be valid JSON and background CONTENT_FILES must all resolve.
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const bgSrc = fs.readFileSync(path.join(EXT, manifest.background.service_worker), 'utf8');
const cfMatch = bgSrc.match(/const CONTENT_FILES = \[([\s\S]*?)\];/);
const declared = cfMatch ? [...cfMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
const missing = declared.filter((file) => !fs.existsSync(path.join(EXT, file)));
if (!declared.length || missing.length) {
  failed += 1;
  console.log(`  FAIL CONTENT_FILES missing or broken: ${missing.join(', ') || '(empty)'}`);
} else {
  console.log(`  ok   on-demand CONTENT_FILES resolve (${declared.length} files)`);
}

const background = manifest.background.service_worker;
if (!fs.existsSync(path.join(EXT, background))) {
  failed += 1;
  console.log(`  FAIL background worker missing: ${background}`);
} else {
  console.log('  ok   background worker present');
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(failed ? `\n${failed} failed\n` : '\nall files parse\n');
process.exit(failed ? 1 : 0);
