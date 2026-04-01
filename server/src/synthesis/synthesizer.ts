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

/**
 * Generate a plain-text research summary from crawled records.
 *
 * No LLM required — this is extractive synthesis:
 *   1. Score each DONE record by how many query terms appear in
 *      title + description + excerpt.
 *   2. Present the top results with their key snippet.
 *   3. Append aggregate stats.
 */
export function buildSummary(
  records:   UrlRecord[],
  query:     string,
  startTime: number,
): string {
  const done = records.filter(r => r.state === 'DONE');
  const durationSec = ((Date.now() - startTime) / 1_000).toFixed(1);

  if (done.length === 0) {
    return `No pages could be successfully crawled for "${query}". `
      + `${records.filter(r => r.state === 'FAILED' || r.state === 'DEAD').length} URLs were unreachable or blocked.`;
  }

  // Tokenise query into lowercase terms (skip very short words)
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter(t => t.length > 2);

  // Score each record
  function scoreRecord(r: UrlRecord): number {
    const haystack = [r.title, r.description, r.excerpt].join(' ').toLowerCase();
    return terms.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0);
  }

  const scored = done
    .map(r => ({ record: r, score: scoreRecord(r) }))
    .sort((a, b) => b.score - a.score || (b.record.depth - a.record.depth) * -1);

  const topN  = scored.slice(0, 8);
  const matchCount = scored.filter(s => s.score > 0).length;

  const lines: string[] = [];
  lines.push(`Research summary for: "${query}"`);
  lines.push('');
  lines.push(
    `Crawled ${done.length} page${done.length !== 1 ? 's' : ''} in ${durationSec}s. `
    + `Query terms found in ${matchCount} of ${done.length} pages.`,
  );
  lines.push('');

  if (topN.length > 0) {
    lines.push('Key findings:');
    lines.push('');
    for (const { record: r } of topN) {
      const host  = (() => { try { return new URL(r.url).hostname; } catch { return r.url; } })();
      const title = r.title?.trim() || '(no title)';
      lines.push(`• ${title} (${host})`);

      const snippet = r.description?.trim() || r.excerpt?.trim() || '';
      if (snippet) {
        // Wrap to ~120 chars per line
        const capped = snippet.length > 200 ? snippet.slice(0, 197) + '…' : snippet;
        lines.push(`  ${capped}`);
      }
      lines.push('');
    }
  }

  const failed = records.filter(r => r.state === 'FAILED' || r.state === 'DEAD');
  if (failed.length > 0) {
    lines.push(`${failed.length} URL${failed.length !== 1 ? 's' : ''} were unreachable or blocked.`);
  }

  return lines.join('\n').trimEnd();
}
