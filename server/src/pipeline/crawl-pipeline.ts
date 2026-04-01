import { normalizeUrl, hashUrl } from '../crawler/url-normalizer.js';
import { detectRenderMode }       from '../crawler/render-detector.js';
import { fetchStatic }            from '../crawler/static-crawler.js';
import { fetchWithPlaywright }    from '../crawler/js-crawler.js';
import { extractContent }         from '../parsers/content-extractor.js';
import { getRobotsRules, isAllowed } from '../parsers/robots-cache.js';
import { waitForToken, applyBackoff } from '../middleware/rate-limiter.js';
import { InMemoryFrontier }       from '../frontier/frontier.js';
import { jobStore }               from '../storage/job-store.js';
import { logger }                 from '../logger.js';
import type { CrawlJobConfig, UrlRecord } from '../types.js';

const MAX_RETRIES  = 3;
const HARD_URL_CAP = 50;
/** Hard cap on total wall-clock time per job — prevents runaway crawls. */
const JOB_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

/**
 * Main crawl orchestration loop.
 *
 * Critical path:
 *   Frontier pop → robots check → rate-limit wait →
 *   static fetch → render-detect → optional JS escalation →
 *   content extract → link discovery → frontier push
 *
 * @param jobId    - job ID created by JobStore
 * @param config   - user-supplied crawl configuration
 * @param onRecord - optional callback fired after each URL completes (SSE / testing)
 */
export async function runCrawlPipeline(
  jobId:     string,
  config:    CrawlJobConfig,
  onRecord?: (record: UrlRecord) => void,
): Promise<void> {
  const frontier    = new InMemoryFrontier();
  const maxUrls     = Math.min(config.maxUrls, HARD_URL_CAP);
  const deadline    = Date.now() + JOB_TIMEOUT_MS;

  // Resolve allowed-domain list; default to seed hostnames
  const allowedDomains: string[] = config.allowedDomains
    ? config.allowedDomains.split(',').map(d => d.trim()).filter(Boolean)
    : [];

  // ── Seed the frontier ─────────────────────────────────────────────────────
  for (const raw of config.seedUrls) {
    const url = normalizeUrl(raw);
    if (!url) continue;

    if (allowedDomains.length === 0) {
      allowedDomains.push(new URL(url).hostname);
    }

    frontier.push({ url, depth: 0, parentUrl: undefined, priority: Date.now() });
  }

  let crawledCount = 0;

  // ── Main crawl loop ───────────────────────────────────────────────────────
  while (frontier.size() > 0 && crawledCount < maxUrls) {
    // Job-level timeout guard
    if (Date.now() > deadline) {
      logger.warn({ jobId }, 'job timeout reached — stopping crawl');
      break;
    }

    const entry = frontier.pop();
    if (!entry) break;

    const { url, depth, parentUrl } = entry;
    const urlHash  = hashUrl(url);
    const hostname = new URL(url).hostname;

    // Create initial FETCHING record
    const record: UrlRecord = {
      id:         crypto.randomUUID(),
      url,
      urlHash,
      jobId,
      state:      'FETCHING',
      depth,
      retryCount: 0,
      renderMode: 'static',
      parentUrl,
    };
    jobStore.saveRecord(jobId, record);

    try {
      // ── robots.txt check ─────────────────────────────────────────────────
      let robotsRules;
      try {
        robotsRules = await getRobotsRules(url);
      } catch {
        robotsRules = null;
      }

      if (robotsRules && !isAllowed(url, robotsRules)) {
        logger.debug({ url }, 'robots.txt disallows');
        record.state = 'DEAD';
        jobStore.saveRecord(jobId, record);
        onRecord?.(record);
        crawledCount++;
        continue;
      }

      // ── Rate-limit ────────────────────────────────────────────────────────
      await waitForToken(hostname, robotsRules?.crawlDelay ?? 500);

      // ── Phase 1 — static fetch ────────────────────────────────────────────
      const staticResult = await fetchStatic(url);
      let { html, statusCode, finalUrl } = staticResult;
      let renderMode: 'static' | 'js'   = 'static';

      // ── Empty response guard ──────────────────────────────────────────────
      if (!html || html.trim().length === 0) {
        record.state      = 'DEAD';
        record.statusCode = statusCode;
        record.renderMode = renderMode;
        jobStore.saveRecord(jobId, record);
        onRecord?.(record);
        crawledCount++;
        continue;
      }

      // ── Phase 2 — optional JS escalation ─────────────────────────────────
      if (statusCode >= 200 && statusCode < 400) {
        if (detectRenderMode(html) === 'js') {
          const jsResult = await fetchWithPlaywright(url);
          if (jsResult) {
            html       = jsResult.html;
            statusCode = jsResult.statusCode;
            finalUrl   = jsResult.finalUrl;
            renderMode = 'js';
            logger.debug({ url }, 'Playwright escalation');
          }
        }
      }

      // ── HTTP error handling ───────────────────────────────────────────────
      if (statusCode >= 400) {
        record.state      = statusCode >= 500 ? 'FAILED' : 'DEAD';
        record.statusCode = statusCode;
        record.renderMode = renderMode;
        jobStore.saveRecord(jobId, record);
        onRecord?.(record);
        crawledCount++;
        continue;
      }

      // ── Content extraction ────────────────────────────────────────────────
      const content = extractContent(html, finalUrl);

      record.state       = 'DONE';
      record.statusCode  = statusCode;
      record.renderMode  = renderMode;
      record.title       = content.title;
      record.description = content.description;
      record.linksFound  = content.outgoingLinks.length;
      record.fetchedAt   = new Date().toLocaleTimeString();
      jobStore.saveRecord(jobId, record);
      onRecord?.(record);
      crawledCount++;

      logger.info({ url, depth, renderMode, links: content.outgoingLinks.length }, 'crawled');

      // ── Link discovery ────────────────────────────────────────────────────
      if (depth < config.maxDepth) {
        for (const raw of content.outgoingLinks) {
          const normalized = normalizeUrl(raw, finalUrl);
          if (!normalized) continue;

          const linkHost = new URL(normalized).hostname;
          if (allowedDomains.length > 0 && !allowedDomains.includes(linkHost)) continue;

          frontier.push({
            url:      normalized,
            depth:    depth + 1,
            parentUrl: url,
            priority: Date.now() + depth * 1_000,
          });
        }
      }
    } catch (err) {
      const isRetryable = record.retryCount < MAX_RETRIES;
      record.state      = isRetryable ? 'FAILED' : 'DEAD';
      record.error      = err instanceof Error ? err.message : String(err);

      if (isRetryable) {
        record.retryCount++;
        applyBackoff(hostname, record.retryCount);
        frontier.push({
          url,
          depth,
          parentUrl,
          priority: Date.now() + 5_000 * record.retryCount,
        });
        logger.warn({ url, retry: record.retryCount }, 'fetch failed — requeued');
      } else {
        logger.error({ url, err: record.error }, 'URL dead after max retries');
        crawledCount++;
      }

      jobStore.saveRecord(jobId, record);
      onRecord?.(record);
    }
  }

  jobStore.updateJob(jobId, { status: 'done', finishedAt: Date.now() });
  logger.info({ jobId, crawledCount }, 'crawl complete');
}
