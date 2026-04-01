import axios from 'axios';
import robotsParser from 'robots-parser';

type RobotsParser = ReturnType<typeof robotsParser>;

interface CachedEntry {
  parser:     RobotsParser;
  crawlDelay: number; // ms
  fetchedAt:  number;
}

const TTL_MS = 24 * 60 * 60 * 1_000; // 24 h
const cache  = new Map<string, CachedEntry>();

/**
 * Fetch + parse robots.txt for the given URL's hostname.
 * Result is cached for 24 h.
 *
 * Hardening vs v1:
 *  - 1 MB content-length cap (maxContentLength) prevents DoS via huge files
 *  - robots-parser() call is wrapped in try/catch; malformed files fall back
 *    to "allow everything" rather than crashing the crawl
 *  - Extra slice(0, 1 MB) on the content string as belt-and-suspenders
 *
 * If robots.txt is unreachable or returns non-200, default to "allow all".
 */
export async function getRobotsRules(url: string): Promise<CachedEntry> {
  const { protocol, hostname } = new URL(url);
  const robotsUrl = `${protocol}//${hostname}/robots.txt`;

  const cached = cache.get(hostname);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;

  let content = '';
  try {
    const res = await axios.get<string>(robotsUrl, {
      timeout:          5_000,
      responseType:     'text',
      validateStatus:   () => true,
      maxContentLength: 1_000_000, // 1 MB cap — prevents memory exhaustion
      headers: { 'User-Agent': 'WebCrawlerBot/1.0' },
    });
    if (res.status === 200 && typeof res.data === 'string') {
      content = res.data.slice(0, 1_000_000); // belt-and-suspenders
    }
  } catch {
    // Network failure → treat as "allow everything"
  }

  // robots-parser can throw on severely malformed content
  let parser: RobotsParser;
  try {
    parser = robotsParser(robotsUrl, content);
  } catch {
    parser = robotsParser(robotsUrl, ''); // default: allow all
  }

  const delaySecs  = parser.getCrawlDelay('*') ?? 0.5;
  const crawlDelay = Math.max(delaySecs * 1_000, 500);

  const entry: CachedEntry = { parser, crawlDelay, fetchedAt: Date.now() };
  cache.set(hostname, entry);
  return entry;
}

/** Returns true when the URL is permitted by robots.txt rules. */
export function isAllowed(url: string, rules: CachedEntry): boolean {
  return rules.parser.isAllowed(url, '*') !== false;
}
