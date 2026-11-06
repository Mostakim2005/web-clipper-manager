/* Web Clipper Manager — content-script helpers.
 *
 * Classic script (not a module) so it can be listed in content_scripts and share
 * a scope with extract.js. Everything hangs off globalThis.OC.
 */
(() => {
  const OC = (globalThis.OC = globalThis.OC || {});

  OC.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Ask the background service worker to do something privileged (network, storage). */
  OC.ask = (type, payload) =>
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (res) => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message));
        if (!res) return reject(new Error('No response from background worker'));
        if (res.ok === false) return reject(new Error(res.error || 'Background request failed'));
        resolve(res.data);
      });
    });

  /* ---------------------------------------------------------------- metadata */

  OC.meta = (...names) => {
    for (const name of names) {
      const el =
        document.querySelector(`meta[property="${name}"]`) ||
        document.querySelector(`meta[name="${name}"]`) ||
        document.querySelector(`meta[itemprop="${name}"]`);
      const value = el && el.getAttribute('content');
      if (value && value.trim()) return value.trim();
    }
    return '';
  };

  /** Flatten every JSON-LD block on the page into one array of objects. */
  OC.jsonLd = () => {
    const out = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        const parsed = JSON.parse(script.textContent);
        const push = (node) => {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) return node.forEach(push);
          if (Array.isArray(node['@graph'])) node['@graph'].forEach(push);
          out.push(node);
        };
        push(parsed);
      } catch {
        /* malformed blocks are common; ignore */
      }
    });
    return out;
  };

  OC.jsonLdValue = (...keys) => {
    const nodes = OC.jsonLd();
    for (const key of keys) {
      for (const node of nodes) {
        const value = node[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    }
    return '';
  };

  /* -------------------------------------------------------------------- DOM */

  OC.absolutize = (root, base) => {
    const baseUrl = base || document.baseURI;
    root.querySelectorAll('a[href]').forEach((a) => {
      try {
        a.setAttribute('href', new URL(a.getAttribute('href'), baseUrl).href);
      } catch {
        /* leave malformed hrefs alone */
      }
    });
  };

  /** Pick the highest-fidelity URL for an <img>, preferring real sources over lazy placeholders. */
  OC.bestImageUrl = (img) => {
    const candidates = [
      img.currentSrc,
      img.getAttribute('src'),
      img.getAttribute('data-src'),
      img.getAttribute('data-original'),
      img.getAttribute('data-lazy-src'),
      img.getAttribute('data-url'),
    ].filter(Boolean);

    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      if (!/^data:image\/gif;base64,R0lGOD/i.test(candidates[i])) return candidates[i];
    }
    return candidates[0] || '';
  };

  const looksLikeChrome = (url) =>
    /\/rsrc\.php\//i.test(url) || /emoji/i.test(url) || /\/images\/emoji/i.test(url);

  /**
   * Replace every meaningful <img> with a `omniimg:<index>` sentinel and record it
   * in `images`. Turndown then emits `![alt](omniimg:3)`, which becomes a token.
   */
  OC.stashImages = (root, images, role = 'inline') => {
    root.querySelectorAll('img').forEach((img) => {
      const raw = OC.bestImageUrl(img);
      if (!raw || raw.startsWith('data:')) return img.remove();
      if (looksLikeChrome(raw)) return img.remove();

      let url = raw;
      try {
        url = new URL(raw, document.baseURI).href;
      } catch {
        return img.remove();
      }

      const width = img.naturalWidth || Number(img.getAttribute('width')) || 0;
      const height = img.naturalHeight || Number(img.getAttribute('height')) || 0;

      // Drop obvious UI furniture when we can measure it. Unknown sizes are kept:
      // lazy-loaded post images frequently report 0x0 until they scroll into view.
      if (width && height && (width < 80 || height < 80)) return img.remove();

      const index = images.length;
      images.push({
        url,
        alt: (img.getAttribute('alt') || '').trim().slice(0, 300),
        width,
        height,
        role,
      });
      img.setAttribute('src', `omniimg:${index}`);
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      img.removeAttribute('loading');
    });
  };

  /* --------------------------------------------------------------- markdown */

  OC.turndown = () => {
    const td = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined',
    });

    const gfm = globalThis.turndownPluginGfm;
    if (gfm) td.use(gfm.gfm);

    td.remove([
      'script',
      'style',
      'noscript',
      'iframe',
      'form',
      'button',
      'input',
      'select',
      'textarea',
      'svg',
      'canvas',
      'video',
      'audio',
      'template',
    ]);

    // Drop empty links (icons, "see more", etc.) and normalise the rest.
    td.addRule('omniLinks', {
      filter: (node) => node.nodeName === 'A',
      replacement: (content, node) => {
        const text = content.trim();
        if (!text) return '';
        const href = node.getAttribute('href') || '';
        if (!href || href.startsWith('javascript:') || href === '#') return text;
        return `[${text}](${href})`;
      },
    });

    return td;
  };

  /** HTML → Markdown, with images collapsed to `@@IMG:n@@` block tokens. */
  OC.htmlToMarkdown = (root) => {
    let md = OC.turndown().turndown(root);
    md = md.replace(/!\[[^\]]*\]\(omniimg:(\d+)\)/g, (_, index) => `\n\n@@IMG:${index}@@\n\n`);
    md = md.replace(/\[([^\]]*)\]\(omniimg:(\d+)\)/g, (_, text, index) => `[${text}](@@IMG:${index}@@)`);
    return OC.tidyMarkdown(md);
  };

  OC.tidyMarkdown = (md) =>
    md
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  OC.firstLines = (text, count = 1) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('@@IMG:'))
      .slice(0, count)
      .join(' ');

  /* ------------------------------------------------------------- utilities */

  /** Unwrap Facebook's outbound redirect wrapper. */
  OC.unwrapLink = (href) => {
    try {
      const url = new URL(href);
      if (/(^|\.)l\.facebook\.com$/.test(url.hostname)) {
        return url.searchParams.get('u') || href;
      }
    } catch {
      /* fall through */
    }
    return href;
  };

  OC.isoDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  };

  OC.textOf = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
})();
