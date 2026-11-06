/* Web Clipper Manager — extraction adapters.
 *
 * Produces one `Clip` object regardless of source:
 *
 *   { kind, source, url, canonicalUrl, capturedAt, title, author, publishedAt,
 *     body, images[], links[], engagement{}, extra{}, completeness{} }
 *
 * `body` is Markdown with `@@IMG:n@@` tokens. The background worker swaps those
 * for real attachment names after downloading the images.
 */
(() => {
  const OC = globalThis.OC;

  const SOURCE_RULES = [
    { id: 'facebook', name: 'Facebook', host: /(^|\.)facebook\.com$/i },
    { id: 'twitter', name: 'Twitter / X', host: /(^|\.)(twitter|x)\.com$/i },
    { id: 'reddit', name: 'Reddit', host: /(^|\.)reddit\.com$/i },
  ];

  OC.SOURCE_NAMES = SOURCE_RULES.reduce((acc, rule) => {
    acc[rule.id] = rule.name;
    return acc;
  }, { article: 'Article' });

  OC.detectSource = (href) => {
    try {
      const url = new URL(href || location.href);
      const rule = SOURCE_RULES.find((candidate) => candidate.host.test(url.hostname));
      return rule ? rule.id : 'article';
    } catch {
      return 'article';
    }
  };

  /* ====================================================================== */
  /* Article                                                                */
  /* ====================================================================== */

  function extractArticle(clip) {
    const clone = document.cloneNode(true);

    // Readability resolves relative URLs against baseURI; a detached clone loses
    // its base, so pin one before parsing or every image comes back as about:blank.
    const base = clone.createElement('base');
    base.setAttribute('href', document.baseURI);
    if (clone.head) clone.head.prepend(base);

    const reader = new globalThis.Readability(clone, {
      charThreshold: 200,
      keepClasses: false,
      classesToPreserve: [],
    });
    const article = reader.parse();

    if (!article || !article.content) {
      throw new Error('Could not isolate the article body. Try selecting text and clipping the selection.');
    }

    clip.kind = 'article';
    clip.title = (article.title || document.title || '').trim();
    clip.author = { name: (article.byline || OC.meta('author', 'article:author') || '').trim() };
    clip.publishedAt = OC.isoDate(
      article.publishedTime ||
        OC.meta('article:published_time', 'og:article:published_time', 'datePublished') ||
        OC.jsonLdValue('datePublished') ||
        (document.querySelector('time[datetime]') || {}).dateTime ||
        ''
    );

    const holder = document.createElement('div');
    holder.innerHTML = article.content;
    OC.absolutize(holder);
    OC.stashImages(holder, clip.images, 'body');
    // Keep the cleaned DOM for the self-contained HTML archive. Image `src`
    // values are still `omniimg:n`; the background maps them to asset names.
    clip.html = holder.innerHTML;
    clip.body = OC.htmlToMarkdown(holder);
  }

  /* ====================================================================== */
  /* Facebook                                                               */
  /* ====================================================================== */

  const FB_NOISE_LINK =
    /facebook\.com\/(profile\.php|photo|photo\.php|watch|reel|stories|share|sharer|l\.php|help|policies|privacy|terms)/i;

  async function expandFacebookSeeMore(article) {
    const buttons = [...article.querySelectorAll('div[role="button"], span[role="button"], [role="button"]')];
    const target = buttons.find((el) => /^see more(\.\.\.|…)?$/i.test(OC.textOf(el)));
    if (!target) return;
    try {
      target.click();
      await OC.sleep(250);
    } catch {
      /* expanding is best-effort */
    }
  }

  function scoreFacebookArticle(el, pageUrl) {
    let score = 0;
    const text = OC.textOf(el);
    const html = el.innerHTML;

    if (/\/(posts|permalink)\/|story_fbid=|pfbid/i.test(html)) score += 4;
    if (el.querySelector('[data-ad-rendering-role="story_message"]')) score += 3;
    if (el.querySelector('a[href*="/profile.php"], a[role="link"][href*="facebook.com/"]')) score += 2;
    if (el.querySelector('abbr[data-utime], time[datetime], a[href*="/posts/"] abbr')) score += 2;
    if (el.querySelector('[data-ad-rendering-role="profile_name"], h3 a, h4 a, strong a')) score += 1;

    score += Math.min(text.length / 120, 6);

    // A comment thread container looks like a post but is nested and short.
    if (el.querySelector('div[role="article"] div[role="article"]')) score -= 4;
    if (text.length < 40) score -= 3;

    if (/\/(posts|permalink)\/|story_fbid=/i.test(pageUrl)) score += 3;
    return score;
  }

  function pickFacebookArticle() {
    const pageUrl = location.href;
    const candidates = [...document.querySelectorAll('div[role="article"]')]
      .map((el) => ({ el, score: scoreFacebookArticle(el, pageUrl) }))
      .sort((a, b) => b.score - a.score);
    return candidates.length ? candidates[0].el : null;
  }

  function facebookTextElement(article) {
    const explicit = article.querySelector('[data-ad-rendering-role="story_message"]');
    if (explicit && OC.textOf(explicit).length > 10) return explicit;

    const candidates = [...article.querySelectorAll('div[dir="auto"], span[dir="auto"]')].filter((el) => {
      const owner = el.closest('div[role="article"]');
      if (owner && owner !== article) return false;
      if (el.querySelector('div[role="article"]')) return false;
      return OC.textOf(el).length > 15;
    });

    if (!candidates.length) return null;

    let best = candidates.reduce((a, b) => (OC.textOf(b).length > OC.textOf(a).length ? b : a));

    // Multi-paragraph posts split into sibling dir="auto" nodes. Climb while the
    // parent holds meaningfully more text but is still clearly the message block.
    const articleText = OC.textOf(article).length;
    for (let i = 0; i < 3; i += 1) {
      const parent = best.parentElement;
      if (!parent || parent === article) break;
      if (parent.querySelector('div[role="article"]')) break;
      if (parent.childElementCount > 10) break;
      const parentLen = OC.textOf(parent).length;
      const bestLen = OC.textOf(best).length;
      if (parentLen > bestLen * 1.15 && parentLen < articleText * 0.85) best = parent;
      else break;
    }

    return best;
  }

  function facebookAuthor(article) {
    const nameEl =
      article.querySelector('[data-ad-rendering-role="profile_name"]') ||
      article.querySelector('h3 a[href*="facebook.com"], h4 a[href*="facebook.com"]') ||
      article.querySelector('strong a[href*="facebook.com"]');

    if (nameEl) {
      const link = nameEl.closest('a') || nameEl;
      return {
        name: OC.textOf(nameEl).slice(0, 120),
        profileUrl: link.href || '',
      };
    }

    const profile = [...article.querySelectorAll('a[href*="facebook.com"]')].find(
      (a) => /\/profile\.php\?id=|\/[A-Za-z0-9.]+\/?$/.test(a.pathname) && !FB_NOISE_LINK.test(a.href)
    );

    return {
      name: profile ? OC.textOf(profile).slice(0, 120) : '',
      profileUrl: profile ? profile.href : '',
    };
  }

  function facebookTimestamp(article) {
    const abbr = article.querySelector('abbr[data-utime]');
    if (abbr) {
      const seconds = Number(abbr.getAttribute('data-utime'));
      if (seconds) return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    }

    const time = article.querySelector('time[datetime]');
    if (time) return OC.isoDate(time.getAttribute('datetime'));

    const labelled = [...article.querySelectorAll('[aria-label]')]
      .map((el) => el.getAttribute('aria-label'))
      .find((label) => /\b(19|20)\d{2}\b/.test(label || ''));
    return OC.isoDate(labelled || '');
  }

  function facebookLinks(article) {
    const seen = new Set();
    const links = [];

    article.querySelectorAll('a[href]').forEach((a) => {
      const href = OC.unwrapLink(a.href);
      if (!href || seen.has(href)) return;
      if (FB_NOISE_LINK.test(href) && !/l\.facebook\.com/.test(a.href)) return;
      if (/facebook\.com|fbcdn\.net|fb\.me/i.test(href)) return;
      if (!/^https?:/i.test(href)) return;
      seen.add(href);
      links.push({ url: href, text: OC.textOf(a).slice(0, 160) });
    });

    return links.slice(0, 8);
  }

  async function extractFacebook(clip) {
    const article = pickFacebookArticle();
    if (!article) {
      throw new Error(
        'No Facebook post found. Open the post on its own page (click its timestamp) and clip again.'
      );
    }

    await expandFacebookSeeMore(article);

    clip.kind = 'post';
    clip.author = facebookAuthor(article);
    clip.publishedAt = facebookTimestamp(article);

    const cleaned = article.cloneNode(true);
    // Comments are nested articles; drop them so they cannot leak into the body.
    cleaned.querySelectorAll('[role="article"]').forEach((node) => node.remove());

    const textEl = facebookTextElement(cleaned);
    if (!textEl) throw new Error('Found the post but could not isolate its text.');

    // Post media sits beside the text block, not inside it, so stash across the
    // whole cleaned post. Avatars and emoji are dropped by the size filter.
    OC.absolutize(cleaned);
    OC.stashImages(cleaned, clip.images, 'post');

    const holder = document.createElement('div');
    holder.appendChild(textEl.cloneNode(true));
    clip.body = OC.htmlToMarkdown(holder);

    // Any image that did not sit inside the text block gets appended after it.
    const used = new Set([...clip.body.matchAll(/@@IMG:(\d+)@@/g)].map((match) => match[1]));
    clip.images.forEach((_, index) => {
      if (!used.has(String(index))) clip.body += `\n\n@@IMG:${index}@@`;
    });
    clip.body = OC.tidyMarkdown(clip.body);
    clip.links = facebookLinks(article);

    const reaction = article.querySelector('[aria-label*="reaction"], [aria-label*="like"]');
    clip.engagement = reaction ? { reactions: OC.textOf(reaction).slice(0, 80) } : {};

    if (!clip.body.trim()) throw new Error('The post text came back empty.');
  }

  /* ====================================================================== */
  /* Twitter / X                                                            */
  /* ====================================================================== */

  const TWITTER_IMAGE_HOST = /pbs\.twimg\.com/i;

  function upgradeTwitterImage(url) {
    if (!url) return '';
    if (!TWITTER_IMAGE_HOST.test(url)) return url;
    return url.replace(/([?&])name=[a-z0-9]+/i, '$1name=orig').replace(/&name=[a-z0-9]+$/i, '&name=orig');
  }

  function applyTwitterFacets(text, facets) {
    if (!Array.isArray(facets) || !facets.length) return text;
    let out = text;
    const ordered = [...facets].sort((a, b) => (b.indices?.[0] || 0) - (a.indices?.[0] || 0));
    for (const facet of ordered) {
      const [start, end] = facet.indices || [];
      const replacement = facet.replacement || facet.original;
      if (typeof start !== 'number' || typeof end !== 'number' || !replacement) continue;
      out = out.slice(0, start) + replacement + out.slice(end);
    }
    return out;
  }

  function normalizeTwitterMedia(media) {
    if (!media) return [];
    const list =
      media.all ||
      [...(media.photos || []), ...(media.videos || []), ...(media.gifs || []), ...(media.mosaic || [])];

    const out = [];
    for (const item of list) {
      if (!item) continue;
      const isVideo = /video|gif/i.test(item.type || '');
      const poster = item.thumbnail_url || item.url || '';
      const url = isVideo ? poster : item.url || item.media_url_https || '';
      if (!url) continue;
      out.push({
        url: upgradeTwitterImage(url),
        alt: item.altText || item.alt_text || '',
        role: isVideo ? 'video-poster' : 'post',
        videoUrl: isVideo ? item.url : '',
      });
    }
    return out;
  }

  function readTwitterDom() {
    const article =
      document.querySelector('article[data-testid="tweet"]') ||
      document.querySelector('article[role="article"]');
    if (!article) return null;

    const textEl = article.querySelector('[data-testid="tweetText"]');
    const nameEl = article.querySelector('[data-testid="User-Name"]');
    const handleEl = nameEl ? nameEl.querySelector('a[href^="/"]') : null;
    const images = [...article.querySelectorAll('[data-testid="tweetPhoto"] img')]
      .map((img) => ({ url: upgradeTwitterImage(img.src), alt: img.getAttribute('alt') || '' }))
      .filter((image) => image.url);

    const timeEl = article.querySelector('time[datetime]');

    return {
      text: OC.textOf(textEl),
      html: textEl ? textEl.innerHTML : '',
      authorName: nameEl ? OC.textOf(nameEl).split('\n')[0].slice(0, 80) : '',
      handle: handleEl ? handleEl.getAttribute('href').replace(/^\//, '') : '',
      publishedAt: timeEl ? OC.isoDate(timeEl.getAttribute('datetime')) : '',
      images,
    };
  }

  async function extractTwitter(clip) {
    const statusId = (location.pathname.match(/\/status(?:es)?\/(\d+)/) || [])[1] || '';
    const dom = readTwitterDom();

    let tweet = null;
    if (statusId) {
      try {
        const data = await OC.ask('FETCH_JSON', {
          url: `https://api.fxtwitter.com/status/${statusId}`,
          headers: { Accept: 'application/json' },
        });
        if (data && data.tweet) tweet = data.tweet;
      } catch (error) {
        clip.notes.push(`Twitter metadata service unavailable (${error.message}). Used on-page data instead.`);
      }
    }

    if (!tweet && !dom) throw new Error('No tweet found on this page.');

    clip.kind = 'post';

    if (tweet) {
      const text = applyTwitterFacets(tweet.text || '', tweet.raw_text?.facets || []);
      clip.author = {
        name: tweet.author?.name || dom?.authorName || '',
        handle: tweet.author?.screen_name ? `@${tweet.author.screen_name}` : dom?.handle ? `@${dom.handle}` : '',
        profileUrl: tweet.author?.url || (dom?.handle ? `https://x.com/${dom.handle}` : ''),
        avatar: tweet.author?.avatar_url || '',
      };
      clip.title = OC.firstLines(text, 1).slice(0, 100);
      clip.publishedAt = OC.isoDate(tweet.created_at) || dom?.publishedAt || '';
      clip.body = OC.tidyMarkdown(text);
      clip.images = normalizeTwitterMedia(tweet.media);
      clip.engagement = {
        likes: tweet.likes ?? null,
        reposts: tweet.retweets ?? null,
        replies: tweet.replies ?? null,
        quotes: tweet.quotes ?? null,
        views: tweet.views ?? null,
      };
      clip.extra.quoteUrl = tweet.quote?.url || '';
      clip.extra.isNoteTweet = Boolean(tweet.is_note_tweet);
    } else {
      clip.author = {
        name: dom.authorName,
        handle: dom.handle ? `@${dom.handle}` : '',
        profileUrl: dom.handle ? `https://x.com/${dom.handle}` : '',
      };
      clip.title = OC.firstLines(dom.text, 1).slice(0, 100);
      clip.publishedAt = dom.publishedAt;
      clip.body = OC.htmlToMarkdown(
        (() => {
          const holder = document.createElement('div');
          holder.innerHTML = dom.html;
          OC.absolutize(holder);
          return holder;
        })()
      );
      clip.images = dom.images.map((image) => ({ ...image, role: 'post' }));
    }

    if (!clip.body.trim() && clip.images.length) clip.body = '_Media-only post._';
    if (!clip.body.trim()) throw new Error('The tweet text came back empty.');
  }

  /* ====================================================================== */
  /* Reddit                                                                 */
  /* ====================================================================== */

  const decodeHtml = (value) =>
    String(value || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'");

  function redditImages(post) {
    const images = [];
    const galleryOrder = post.gallery_data?.items?.map((item) => item.media_id) || [];
    const metadata = post.media_metadata || {};

    if (galleryOrder.length) {
      for (const id of galleryOrder) {
        const entry = metadata[id];
        const url = entry?.s?.u || entry?.s?.gif || '';
        if (url) images.push({ url: decodeHtml(url), alt: entry?.caption || '', role: 'gallery' });
      }
      return images;
    }

    const preview = post.preview?.images?.[0];
    if (preview?.source?.url) {
      images.push({ url: decodeHtml(preview.source.url), alt: post.title || '', role: 'preview' });
    }
    return images;
  }

  function redditComments(children, limit = 25) {
    const lines = [];
    let shown = 0;
    let truncated = 0;

    const walk = (nodes, depth) => {
      for (const node of nodes || []) {
        if (node.kind === 'more') {
          truncated += 1;
          continue;
        }
        if (node.kind !== 't1') continue;
        if (shown >= limit) {
          truncated += 1;
          continue;
        }
        const data = node.data;
        const indent = depth > 0 ? '> '.repeat(depth) : '';
        const body = String(data.body || '').trim().replace(/\n/g, `\n${indent}`);
        if (!body) continue;
        shown += 1;
        lines.push(`${indent}**u/${data.author}** · ${data.score} points`);
        lines.push(`${indent}> ${body}`);
        lines.push('');
        if (depth === 0 && data.replies?.data?.children?.length && shown < limit) {
          walk(data.replies.data.children, depth + 1);
        }
      }
    };

    walk(children, 0);
    return { markdown: lines.join('\n').trim(), shown, truncated };
  }

  async function extractReddit(clip) {
    const match = location.pathname.match(/^(\/r\/[^/]+)\/comments\/([^/]+)/i);
    if (!match) throw new Error('Open a specific Reddit post to clip it (not a subreddit front page).');

    const permalink = `${match[1]}/comments/${match[2]}`;
    const data = await OC.ask('FETCH_JSON', {
      url: `https://www.reddit.com${permalink}.json?raw_json=1&limit=200`,
      headers: { Accept: 'application/json' },
    });

    const post = data?.[0]?.data?.children?.[0]?.data;
    if (!post) throw new Error('Reddit returned no post data for this URL.');

    clip.kind = 'post';
    clip.title = post.title || '';
    clip.author = {
      name: post.author || '[deleted]',
      handle: post.author ? `u/${post.author}` : '',
      profileUrl: post.author ? `https://www.reddit.com/user/${post.author}` : '',
    };
    clip.publishedAt = post.created_utc
      ? new Date(post.created_utc * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
      : '';
    clip.extra.subreddit = post.subreddit_name_prefixed || '';
    clip.extra.flair = post.link_flair_text || '';
    clip.engagement = { upvotes: post.score ?? null, comments: post.num_comments ?? null };
    clip.images = redditImages(post);

    const parts = [];
    if (post.is_self && post.selftext) parts.push(post.selftext.trim());
    if (post.url && !post.is_self) {
      parts.push(`**Link:** [${post.url}](${post.url})`);
      clip.links = [{ url: post.url, text: post.title || '' }];
    }
    if (clip.images.length) {
      clip.images.forEach((_, index) => parts.push(`@@IMG:${index}@@`));
    }

    const thread = data?.[1]?.data?.children || [];
    const comments = redditComments(thread, 25);
    if (comments.markdown) {
      parts.push('---');
      parts.push(`### Comments (${comments.shown} shown)`);
      parts.push(comments.markdown);
    }

    clip.body = OC.tidyMarkdown(parts.join('\n\n'));

    if (comments.truncated) {
      clip.completeness.missing.push(`${comments.truncated} comment branches not fetched`);
    }
    if (!clip.body.trim()) throw new Error('Reddit returned an empty post body.');
  }

  /* ====================================================================== */
  /* Orchestrator                                                           */
  /* ====================================================================== */

  OC.extract = async (options = {}) => {
    const requested = options.source && options.source !== 'auto' ? options.source : OC.detectSource(location.href);

    const clip = {
      kind: 'article',
      source: requested === 'article' ? 'article' : requested,
      url: location.href,
      canonicalUrl: (document.querySelector('link[rel="canonical"]') || {}).href || '',
      capturedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      title: '',
      author: { name: '', handle: '', profileUrl: '', avatar: '' },
      publishedAt: '',
      body: '',
      images: [],
      links: [],
      engagement: {},
      extra: {},
      notes: [],
      completeness: { score: 1, missing: [], notes: [] },
    };

    if (!clip.canonicalUrl) delete clip.canonicalUrl;

    if (requested === 'facebook') await extractFacebook(clip);
    else if (requested === 'twitter') await extractTwitter(clip);
    else if (requested === 'reddit') await extractReddit(clip);
    else extractArticle(clip);

    if (!clip.title) {
      clip.title =
        OC.firstLines(clip.body, 1).slice(0, 90) ||
        (clip.author.name ? `${OC.SOURCE_NAMES[clip.source] || 'Clip'} by ${clip.author.name}` : 'Untitled clip');
    }

    clip.title = clip.title.replace(/\s+/g, ' ').trim().slice(0, 180);
    clip.body = OC.tidyMarkdown(clip.body);

    if (!clip.body.trim() && !clip.images.length) {
      throw new Error('Nothing was captured. The page may still be loading, or it is behind a login prompt.');
    }

    const missingImages = clip.images.filter((image) => !image.url).length;
    if (missingImages) clip.completeness.missing.push(`${missingImages} image(s) had no usable URL`);

    clip.completeness.score = Math.max(0, 1 - clip.completeness.missing.length * 0.1);
    clip.completeness.notes = clip.notes;

    return clip;
  };

  /* Bridge to the background worker. */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === 'PING') {
      sendResponse({ ok: true });
      return false;
    }

    if (message && message.type === 'EXTRACT') {
      OC.extract(message.payload || {})
        .then((clip) => sendResponse({ ok: true, clip }))
        .catch((error) => sendResponse({ ok: false, error: (error && error.message) || String(error) }));
      return true;
    }

    return false;
  });
})();
