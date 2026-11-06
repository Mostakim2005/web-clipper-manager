/**
 * Accessibility + wiring check for the two extension pages.
 *
 * Not a WCAG conformance suite. It catches the regressions that actually happen
 * when markup is edited: a button losing its name, a control losing its label,
 * a live region disappearing, a duplicate id, or an id the page script still
 * looks up after the markup renamed it.
 *
 * Run: node test/a11y-check.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.join(here, '..', 'extension', 'src', 'pages');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`  FAIL ${name}\n           ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function load(page) {
  const html = fs.readFileSync(path.join(pagesDir, page), 'utf8');
  return new JSDOM(html);
}

function nameOf(el) {
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return aria.trim();
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const target = el.ownerDocument.getElementById(labelledBy);
    if (target && target.textContent.trim()) return target.textContent.trim();
  }
  const text = el.textContent.replace(/\s+/g, ' ').trim();
  if (text) return text;
  const title = el.getAttribute('title');
  return title ? title.trim() : '';
}

const PAGES = [
  { page: 'popup.html', script: 'popup.js', label: 'popup' },
  { page: 'options.html', script: 'options.js', label: 'options' },
];

for (const { page, script, label } of PAGES) {
  const dom = load(page);
  const doc = dom.window.document;

  check(`${label}: declares a language`, () => {
    const lang = doc.documentElement.getAttribute('lang');
    assert(lang && lang.length >= 2, 'html[lang] is missing');
  });

  check(`${label}: has no duplicate ids`, () => {
    const seen = new Map();
    for (const el of doc.querySelectorAll('[id]')) {
      const id = el.id;
      if (seen.has(id)) {
        throw new Error(`duplicate id "${id}" (${seen.get(id)} and ${el.tagName})`);
      }
      seen.set(id, el.tagName);
    }
  });

  check(`${label}: every button has an accessible name`, () => {
    const unnamed = [...doc.querySelectorAll('button')]
      .filter((el) => !nameOf(el))
      .map((el) => el.outerHTML.slice(0, 80));
    assert(unnamed.length === 0, `unnamed button(s): ${unnamed.join(' | ')}`);
  });

  check(`${label}: every form control has a label`, () => {
    const controls = [...doc.querySelectorAll('input, textarea, select')].filter(
      (el) => el.type !== 'hidden'
    );
    const unlabelled = controls
      .filter((el) => {
        if (el.getAttribute('aria-label')?.trim()) return false;
        if (el.getAttribute('aria-labelledby')) return false;
        if (el.closest('label')) return false;
        return true;
      })
      .map((el) => `${el.tagName.toLowerCase()}#${el.id || '(no id)'}`);
    assert(unlabelled.length === 0, `unlabelled control(s): ${unlabelled.join(', ')}`);
  });

  check(`${label}: declares a live region for async status`, () => {
    const regions = doc.querySelectorAll('[role="alert"], [role="status"], [aria-live]');
    assert(regions.length > 0, 'no role="alert"/"status"/aria-live region found');
  });

  check(`${label}: images have alt text`, () => {
    const bad = [...doc.querySelectorAll('img')]
      .filter((el) => !el.hasAttribute('alt'))
      .map((el) => el.src);
    assert(bad.length === 0, `missing alt: ${bad.join(', ')}`);
  });

  check(`${label}: no click handler on a non-interactive element`, () => {
    const bad = [...doc.querySelectorAll('[onclick]')].filter(
      (el) => !['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'].includes(el.tagName)
    );
    assert(bad.length === 0, `onclick on: ${bad.map((el) => el.tagName).join(', ')}`);
  });

  check(`${label}: page script ids all exist in the markup`, () => {
    const js = fs.readFileSync(path.join(pagesDir, script), 'utf8');
    const ids = new Set();
    for (const match of js.matchAll(/\$\('([^']+)'\)/g)) ids.add(match[1]);
    for (const match of js.matchAll(/const\s+[A-Z_]+\s*=\s*\[([\s\S]*?)\];/g)) {
      for (const str of match[1].matchAll(/'([^']+)'/g)) ids.add(str[1]);
    }
    const missing = [...ids].filter((id) => !doc.getElementById(id));
    assert(missing.length === 0, `script looks up missing id(s): ${missing.join(', ')}`);
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILED:');
  for (const failure of failures) console.log(`  ${failure.name}: ${failure.message}`);
  process.exit(1);
}
