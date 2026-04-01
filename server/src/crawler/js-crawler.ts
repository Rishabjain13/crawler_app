/**
 * Playwright-based JS renderer.
 *
 * Architecture:
 *  - Single Chromium browser instance (singleton), launched lazily.
 *  - Semaphore limits concurrent open pages to MAX_CONCURRENT_PAGES so that
 *    multiple parallel crawls don't exhaust browser memory.
 *  - Fully optional: if `playwright` is not installed the function returns null
 *    and the pipeline falls back to the static result.
 *  - Browser is released cleanly on SIGTERM/SIGINT via closePlaywright().
 */

type PlaywrightBrowser = import('playwright').Browser;

let browser: PlaywrightBrowser | null = null;
let playwrightAvailable               = true;

// ── Page concurrency semaphore ────────────────────────────────────────────────
const MAX_CONCURRENT_PAGES = 3;
let activePages = 0;
const pageWaiters: Array<() => void> = [];

function acquirePage(): Promise<void> {
  if (activePages < MAX_CONCURRENT_PAGES) {
    activePages++;
    return Promise.resolve();
  }
  // Queue the caller until a slot is free
  return new Promise(resolve => pageWaiters.push(resolve));
}

function releasePage(): void {
  const next = pageWaiters.shift();
  if (next) {
    next(); // pass the slot directly — activePages unchanged
  } else {
    activePages--;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

async function getBrowser(): Promise<PlaywrightBrowser | null> {
  if (!playwrightAvailable) return null;
  if (browser?.isConnected()) return browser;

  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    return browser;
  } catch {
    playwrightAvailable = false;
    return null;
  }
}

export interface JsFetchResult {
  html:       string;
  statusCode: number;
  finalUrl:   string;
}

/**
 * Render `url` in a headless Chromium browser, wait for networkidle,
 * and return the fully-rendered HTML.
 *
 * Returns null when Playwright is unavailable or navigation fails.
 * Respects the MAX_CONCURRENT_PAGES semaphore — callers will queue rather
 * than spawning unbounded pages.
 */
export async function fetchWithPlaywright(url: string): Promise<JsFetchResult | null> {
  const b = await getBrowser();
  if (!b) return null;

  await acquirePage();

  let page: import('playwright').Page | undefined;
  try {
    page = await b.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout:   30_000,
    });

    const html       = await page.content();
    const finalUrl   = page.url();
    const statusCode = response?.status() ?? 200;

    return { html, statusCode, finalUrl };
  } catch {
    return null;
  } finally {
    releasePage();
    await page?.close();
  }
}

/** Call on server shutdown to release the Chromium process. */
export async function closePlaywright(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
