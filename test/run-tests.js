/**
 * Integration tests.
 *
 * Runs the real vendored Readability + Turndown + extract.js inside jsdom,
 * against HTML fixtures, with a mocked `chrome.runtime` bridge. This exercises
 * the same code paths the browser extension uses.
 *
 *   node test/run-tests.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');

const VENDOR_FILES = ['readability.js', 'turndown.js', 'turndown-plugin-gfm.js'].map((file) =>
  path.join(EXT, 'src', 'vendor', file)
);

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

function assertIncludes(haystack, needle, label) {
  assert(
    String(haystack).includes(needle),
    `${label || 'value'} should include ${JSON.stringify(needle)}\n         got: ${String(haystack).slice(0, 220)}`
  );
}

function makeWindow(fixture, url, mocks = {}) {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8');
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;

  window.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage(message, callback) {
        const handler = mocks[message.type];
        if (!handler) {
          callback({ ok: false, error: `no mock for ${message.type}` });
          return;
        }
        Promise.resolve()
          .then(() => handler(message.payload))
          .then(
            (data) => callback({ ok: true, data }),
            (error) => callback({ ok: false, error: error.message })
          );
      },
    },
  };

  for (const file of VENDOR_FILES) window.eval(fs.readFileSync(file, 'utf8'));
  window.eval(fs.readFileSync(path.join(EXT, 'src', 'content', 'lib.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(EXT, 'src', 'content', 'extract.js'), 'utf8'));

  return window;
}

/** Load an ES module that only uses `export function` by rewriting exports. */
function loadEsm(file) {
  const source = fs.readFileSync(file, 'utf8');
  const names = [...source.matchAll(/^export (?:async )?function (\w+)/gm)].map((match) => match[1]);
  const body = source.replace(/^export /gm, '');
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', `${body}\nmodule.exports = { ${names.join(', ')} };`)(mod, mod.exports);
  return mod.exports;
}

/* ------------------------------------------------------------------ render */

console.log('\nrender.js');

const render = loadEsm(path.join(EXT, 'src', 'lib', 'render.js'));

check('yamlScalar keeps safe words bare', () => {
  assert(render.yamlScalar('twitter') === 'twitter');
  assert(render.yamlScalar('clip/twitter') === 'clip/twitter');
});

check('yamlScalar quotes reserved words and numbers', () => {
  assert(render.yamlScalar('true') === '"true"');
  assert(render.yamlScalar('123') === '"123"');
  assert(render.yamlScalar('null') === '"null"');
});

check('yamlScalar quotes punctuation that would break YAML', () => {
  assert(render.yamlScalar('Why: a "great" idea') === '"Why: a \\"great\\" idea"');
  assert(render.yamlScalar('- begins with dash') === '"- begins with dash"');
});

check('sanitizeFilename strips Windows-illegal characters', () => {
  const name = render.sanitizeFilename('a/b\\c:d*e?f"g<h>i|j');
  assert(!/[<>:"/\\|?*]/.test(name), `still illegal: ${name}`);
});

check('sanitizeFilename guards reserved device names', () => {
  assert(render.sanitizeFilename('CON') !== 'CON');
});

check('buildNoteFilename applies the template', () => {
  const name = render.buildNoteFilename(
    { title: 'Hello World', source: 'article', capturedAt: '2026-11-02T10:00:00Z', author: { name: 'X' } },
    { filenameTemplate: '{{date}} {{title}}' }
  );
  assert(name === '2026-11-02 Hello World.md', name);
});

check('assetName is stable and hash-unique', () => {
  const a = render.assetName('https://pbs.twimg.com/media/A.jpg');
  const b = render.assetName('https://pbs.twimg.com/media/A.jpg');
  const c = render.assetName('https://pbs.twimg.com/media/B.jpg');
  assert(a === b, 'not deterministic');
  assert(a !== c, 'collision');
  assert(a.endsWith('.jpg'), a);
});

check('resolveBodyTokens produces wikilinks for local assets', () => {
  const clip = { body: 'before @@IMG:0@@ after', images: [{ url: 'https://x/y.jpg', alt: 'pic' }] };
  const { body, assets } = render.resolveBodyTokens(clip, true);
  assert(body.includes('![[omni-'), body);
  assert(assets.length === 1);
});

check('resolveBodyTokens falls back to remote links', () => {
  const clip = { body: '@@IMG:0@@', images: [{ url: 'https://x/y.jpg', alt: 'pic' }] };
  const { body } = render.resolveBodyTokens(clip, false);
  assert(body === '![pic](https://x/y.jpg)', body);
});

check('resolveBodyTokens can emit Markdown paths relative to the note', () => {
  const clip = { body: '@@IMG:0@@', images: [{ url: 'https://x/y.png', alt: 'pic' }] };
  const { body } = render.resolveBodyTokens(clip, true, {
    embedStyle: 'markdown',
    relativePrefix: '../_assets/',
  });
  assert(/^!\[pic\]\(\.\.\/_assets\/omni-[a-z0-9]+\.png\)$/.test(body), body);
});

check('resolveBodyTokens applies a wikilink width suffix', () => {
  const clip = { body: '@@IMG:0@@', images: [{ url: 'https://x/y.png' }] };
  const { body } = render.resolveBodyTokens(clip, true, { embedWidth: 320 });
  assert(/^!\[\[omni-[a-z0-9]+\.png\|320\]\]$/.test(body), body);
});

check('clipId is stable per URL and changes per page', () => {
  const a = render.clipId({ url: 'https://x.com/a/status/1' });
  const b = render.clipId({ url: 'https://x.com/a/status/1', title: 'different title' });
  const c = render.clipId({ url: 'https://x.com/a/status/2' });
  assert(a === b, 'same URL produced different ids');
  assert(a !== c, 'different URLs collided');
  assert(/^omni-[a-z0-9]+$/.test(a), a);
});

check('attachmentDir honours all three placement modes', () => {
  const settings = { attachmentFolder: '_assets' };
  assert(render.attachmentDir({ ...settings, attachmentMode: 'fixed' }, 'Clippings/a.md') === '_assets');
  assert(
    render.attachmentDir({ ...settings, attachmentMode: 'noteRelative' }, 'Clippings/a.md') ===
      'Clippings/_assets'
  );
  assert(render.attachmentDir({ ...settings, attachmentMode: 'sameAsNote' }, 'Clippings/a.md') === 'Clippings');
});

check('relativeDir walks up and back down', () => {
  assert(render.relativeDir('Clippings', '_assets') === '../_assets/');
  assert(render.relativeDir('_assets', 'Clippings/_assets') === '../Clippings/_assets/');
  assert(render.relativeDir('a/b', 'a/b/c') === 'c/');
  assert(render.relativeDir('_assets', '_assets') === '');
});

check('normalizeImageLinks turns wikilinks into asset refs', () => {
  const out = render.normalizeImageLinks('---\ntitle: x\n---\n\n![[omni-abc123.png]]');
  assert(out === '![omni-abc123.png](asset://omni-abc123.png)', out);
});

check('normalizeImageLinks drops the wikilink width suffix', () => {
  const out = render.normalizeImageLinks('![[omni-abc123.png|300]]');
  assert(out === '![omni-abc123.png](asset://omni-abc123.png)', out);
});

check('normalizeImageLinks rewrites relative attachment paths', () => {
  assert(
    render.normalizeImageLinks('![pic](../_assets/omni-abc123.jpg)') ===
      '![pic](asset://omni-abc123.jpg)'
  );
  assert(render.normalizeImageLinks('![pic](_assets/omni-abc123.jpg)') === '![pic](asset://omni-abc123.jpg)');
});

check('normalizeImageLinks leaves remote images alone', () => {
  const url = '![pic](https://e.com/omni-abc123.jpg)';
  assert(render.normalizeImageLinks(url) === url, render.normalizeImageLinks(url));
});

check('normalizeImageLinks converts callouts into bold headings', () => {
  const out = render.normalizeImageLinks('> [!info] Source\n> body');
  assert(out.startsWith('> **Source**'), out);
});

check('renderNote emits frontmatter, callout and body', () => {
  const note = render.renderNote(
    {
      kind: 'post',
      source: 'twitter',
      title: 'just setting up my twttr',
      url: 'https://x.com/jack/status/20',
      capturedAt: '2026-11-02T10:00:00Z',
      publishedAt: '2006-03-21T20:50:14Z',
      author: { name: 'jack', handle: '@jack' },
      images: [],
      engagement: { likes: 311113, reposts: 124525 },
    },
    'body text',
    {}
  );

  assert(note.startsWith('---\n'), 'missing frontmatter');
  assertIncludes(note, 'source: twitter');
  assertIncludes(note, 'author_handle: "@jack"');
  assertIncludes(note, '> [!info] Source');
  assertIncludes(note, '**jack** (@jack)');
  assertIncludes(note, '> [!quote]- Engagement at capture');
  assertIncludes(note, '311,113');
  assertIncludes(note, 'body text');
});

check('renderNote includes a stable id by default', () => {
  const note = render.renderNote(
    {
      kind: 'article',
      source: 'article',
      title: 'T',
      url: 'https://example.com/x',
      capturedAt: '2026-11-02T10:00:00Z',
      author: {},
      images: [],
    },
    'b'
  );
  assert(/^id: omni-[a-z0-9]+$/m.test(note), note.slice(0, 240));
  assertIncludes(note, 'tags: [clip/article]');
  assert(!note.includes('clip/article, clip/article'), 'duplicate tag');
});

check('renderNote can omit the id and the source callout', () => {
  const note = render.renderNote(
    {
      kind: 'article',
      source: 'article',
      title: 'T',
      url: 'https://example.com/x',
      capturedAt: '2026-11-02T10:00:00Z',
      author: {},
      images: [],
    },
    'b',
    { includeId: false, includeSourceCallout: false }
  );
  assert(!/^id: /m.test(note), 'id should be absent');
  assert(!note.includes('> [!info] Source'), 'callout should be absent');
});

check('renderNote flags a partial capture', () => {
  const note = render.renderNote(
    {
      kind: 'post',
      source: 'reddit',
      title: 't',
      url: 'https://r/x',
      capturedAt: '2026-11-02T10:00:00Z',
      author: {},
      images: [],
      completeness: { score: 0.9, missing: ['3 comment branches not fetched'] },
    },
    'x'
  );
  assertIncludes(note, '> [!warning] Partial capture');
  assertIncludes(note, '3 comment branches not fetched');
});

/* ------------------------------------------------------------------- sources */

(async () => {
  console.log('\narticle');
  {
    const window = makeWindow(
      'article.html',
      'https://fieldnotes.example.com/2026/10/paper-notebooks',
      {}
    );
    const clip = await window.OC.extract({});

    check('detects source', () => assert(clip.source === 'article', clip.source));
    check('extracts title', () => assertIncludes(clip.title, 'Paper Notebooks'));
    check('extracts author', () => assertIncludes(clip.author.name, 'Marta'));
    check('extracts published date', () => assert(clip.publishedAt.startsWith('2026-10-24'), clip.publishedAt));
    check('body has article text', () => assertIncludes(clip.body, 'bounded object'));
    check('drops nav chrome', () => assert(!clip.body.includes('Subscribe'), 'nav leaked in'));
    check('keeps images as tokens', () => assertIncludes(clip.body, '@@IMG:0@@'));
    check('captures cleaned HTML for the archive', () => {
      assertIncludes(clip.html, 'bounded object');
      assertIncludes(clip.html, 'omniimg:0');
    });
    check('records the image', () => assert(clip.images.length === 1, `got ${clip.images.length}`));
    check('resolves the image URL', () =>
      assertIncludes(clip.images[0].url, 'https://fieldnotes.example.com/images/notebook-desk.jpg')
    );
    check('keeps code blocks fenced', () => assertIncludes(clip.body, '```'));
    check('keeps list items', () => assertIncludes(clip.body, 'Handwriting slows you down'));
    check('renders an Obsidian note with id and resolved images', () => {
      const { body, assets } = render.resolveBodyTokens(clip, true, {});
      const note = render.renderNote(clip, body, {});
      assert(/^id: omni-[a-z0-9]+$/m.test(note), 'missing frontmatter id');
      assertIncludes(note, '![[omni-');
      assert(!note.includes('@@IMG:'), 'unresolved image token leaked');
      assert(assets.length === 1, `expected 1 asset, got ${assets.length}`);
      assertIncludes(note, 'source: article');
      assertIncludes(note, 'tags: [clip/article]');
    });
  }

  console.log('\nfacebook');
  {
    const window = makeWindow('facebook.html', 'https://www.facebook.com/jane.doe/posts/pfbid0abc123', {});
    const clip = await window.OC.extract({ source: 'facebook' });

    check('detects post kind', () => assert(clip.kind === 'post'));
    check('extracts author', () => assert(clip.author.name === 'Jane Doe', clip.author.name));
    check('extracts timestamp', () => assert(clip.publishedAt.length > 0, 'no timestamp'));
    check('captures both paragraphs', () => {
      assertIncludes(clip.body, 'capture pipeline');
      assertIncludes(clip.body, 'Write-up here');
    });
    check('drops emoji sprites', () => assert(clip.images.length === 1, `got ${clip.images.length}`));
    check('keeps the photo', () => assertIncludes(clip.images[0].url, 'scontent.fbcdn.net'));
    check('unwraps facebook redirect', () =>
      assert(clip.links.some((link) => link.url === 'https://example.com/story'), JSON.stringify(clip.links))
    );
    check('excludes the comment from the post body', () => assert(!clip.body.includes('saving this')));
  }

  console.log('\ntwitter (metadata service)');
  {
    const tweet = {
      tweet: {
        text: 'just setting up my twttr',
        author: { name: 'jack', screen_name: 'jack', url: 'https://x.com/jack', avatar_url: 'https://pbs.twimg.com/a.jpg' },
        created_at: 'Tue Mar 21 20:50:14 +0000 2006',
        likes: 311113,
        retweets: 124525,
        replies: 18113,
        quotes: 7376,
        views: null,
        media: {
          all: [
            {
              type: 'photo',
              url: 'https://pbs.twimg.com/media/GXabc123?format=jpg&name=small',
              altText: 'A screenshot',
            },
          ],
        },
        raw_text: { facets: [] },
      },
    };

    const window = makeWindow('twitter.html', 'https://x.com/jack/status/20', {
      FETCH_JSON: () => tweet,
    });
    const clip = await window.OC.extract({ source: 'twitter' });

    check('uses the metadata service', () => assert(clip.body === 'just setting up my twttr', clip.body));
    check('extracts handle', () => assert(clip.author.handle === '@jack', clip.author.handle));
    check('parses the old date format', () => assert(clip.publishedAt.startsWith('2006-03-21'), clip.publishedAt));
    check('upgrades image to original size', () => assertIncludes(clip.images[0].url, 'name=orig'));
    check('records engagement', () => assert(clip.engagement.likes === 311113));
  }

  console.log('\ntwitter (dom fallback)');
  {
    const window = makeWindow('twitter.html', 'https://x.com/jack/status/20', {
      FETCH_JSON: () => {
        throw new Error('service down');
      },
    });
    const clip = await window.OC.extract({ source: 'twitter' });

    check('falls back without throwing', () => assertIncludes(clip.body, 'twttr'));
    check('notes the degraded path', () => assert(clip.notes.length > 0, 'no note recorded'));
    check('still gets the image', () => assert(clip.images.length === 1));
  }

  console.log('\nreddit');
  {
    const listing = {
      data: {
        children: [
          {
            kind: 't0',
            data: {
              title: 'A post about clipping',
              author: 'someone',
              subreddit_name_prefixed: 'r/test',
              created_utc: 1762000000,
              score: 128,
              num_comments: 2,
              selftext: 'Body text here.\n\nSecond paragraph.',
              is_self: true,
              url: 'https://www.reddit.com/r/test/comments/abc123/slug/',
              permalink: '/r/test/comments/abc123/slug/',
            },
          },
        ],
      },
    };
    const comments = {
      data: {
        children: [
          {
            kind: 't1',
            data: {
              author: 'commenter',
              score: 42,
              body: 'Nice write-up.',
              replies: { data: { children: [] } },
            },
          },
          { kind: 'more', data: { count: 7, children: [] } },
        ],
      },
    };

    const window = makeWindow('article.html', 'https://www.reddit.com/r/test/comments/abc123/slug/', {
      FETCH_JSON: () => [listing, comments],
    });
    const clip = await window.OC.extract({ source: 'reddit' });

    check('extracts title', () => assert(clip.title === 'A post about clipping', clip.title));
    check('extracts selftext', () => assertIncludes(clip.body, 'Body text here.'));
    check('includes comments', () => assertIncludes(clip.body, '> Nice write-up.'));
    check('reports truncation', () =>
      assert(clip.completeness.missing.some((m) => m.includes('comment branches')), JSON.stringify(clip.completeness))
    );
    check('records subreddit', () => assert(clip.extra.subreddit === 'r/test'));
  }

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length) {
    failures.forEach(({ name, error }) => console.error(`FAILED: ${name}\n  ${error.stack}\n`));
    process.exit(1);
  }
})().catch((error) => {
  console.error('Harness crashed:', error);
  process.exit(1);
});
