import type { UrlRecord, CrawlResult, CrawlStats } from '../types.js';

/**
 * Synthesis layer — transforms raw UrlRecord[] (internal state-machine
 * objects) into the CrawlResult[] + CrawlStats shape that the frontend
 * consumes.
 *
 * This is the single boundary between internal crawler state and the
 * public API contract.  All frontend-facing field mapping lives here.
 */
export function synthesize(
  records:   UrlRecord[],
  startTime: number,
): { results: CrawlResult[]; stats: CrawlStats } {
  // Sort by depth asc, then by crawledAt so the UI shows pages in BFS order
  const sorted = [...records].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return (a.fetchedAt ?? '').localeCompare(b.fetchedAt ?? '');
  });

  const results: CrawlResult[] = sorted.map(r => ({
    id:          r.id,
    url:         r.url,
    title:       r.title       ?? '',
    description: r.description ?? '',
    statusCode:  r.statusCode  ?? 0,
    depth:       r.depth,
    linksFound:  r.linksFound  ?? 0,
    crawledAt:   r.fetchedAt   ?? new Date().toLocaleTimeString(),
    state:       r.state,
    renderMode:  r.renderMode,
    retryCount:  r.retryCount,
    parentUrl:   r.parentUrl,
  }));

  const done    = records.filter(r => r.state === 'DONE');
  const failed  = records.filter(r => r.state === 'FAILED');
  const dead    = records.filter(r => r.state === 'DEAD');

  const stats: CrawlStats = {
    totalPages:  results.length,
    totalLinks:  results.reduce((s, r) => s + r.linksFound, 0),
    staticPages: done.filter(r => r.renderMode === 'static').length,
    jsPages:     done.filter(r => r.renderMode === 'js').length,
    failedUrls:  failed.length,
    deadUrls:    dead.length,
    duration:    Date.now() - startTime,
  };

  return { results, stats };
}
