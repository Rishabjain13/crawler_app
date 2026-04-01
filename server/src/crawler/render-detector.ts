import * as cheerio from 'cheerio';

/**
 * Heuristic render-mode detector.
 *
 * Returns 'js' when strong signals suggest the page is a client-side SPA
 * that needs a headless browser to produce real content; 'static' otherwise.
 *
 * Signals (in priority order):
 *  1. Empty SPA mount point  (#root / #app / #__next / #__nuxt)
 *  2. JS bundle script tag   (main.<hash>.js, chunk.<hash>.js, …)
 *  3. Inline framework boot  (__NEXT_DATA__, ReactDOM.render, createApp, …)
 *  4. Sparse body text       (HTML > 5 KB but visible text < 200 chars)
 */
export function detectRenderMode(html: string): 'static' | 'js' {
  const $ = cheerio.load(html);

  // 1 ── Empty SPA mount point
  const mountPoint = $('#root, #app, #__next, #__nuxt, [data-app], [data-reactroot]');
  if (mountPoint.length > 0 && mountPoint.text().trim().length < 100) {
    return 'js';
  }

  // 2 ── JS bundle script tag with content-hashed filename
  const bundlePattern = /\/(main|app|bundle|chunk|index)\.[a-z0-9]+\.js/i;
  let hasBundleScript = false;
  $('script[src]').each((_, el) => {
    if (bundlePattern.test($(el).attr('src') ?? '')) hasBundleScript = true;
  });

  if (hasBundleScript) {
    const bodyText = $('body').text().trim();
    if (bodyText.length < 300) return 'js';
  }

  // 3 ── Inline framework boot signals
  const inlineJS = $('script:not([src])')
    .map((_, el) => $(el).html() ?? '')
    .get()
    .join('\n');

  const frameworkSignals = [
    '__NEXT_DATA__', '__nuxt__', '__INITIAL_STATE__',
    'ReactDOM.render', 'ReactDOM.hydrate', 'createRoot(',
    'createApp(', 'new Vue(', 'angular.bootstrap',
  ];
  if (frameworkSignals.some(sig => inlineJS.includes(sig))) {
    return 'js';
  }

  // 4 ── Sparse body text relative to document size
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  if (html.length > 5_000 && bodyText.length < 200) {
    return 'js';
  }

  return 'static';
}
