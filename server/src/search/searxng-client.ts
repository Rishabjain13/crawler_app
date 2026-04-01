import axios from 'axios';
import { logger } from '../logger.js';

interface SearXNGResponse {
  results: Array<{
    url:     string;
    title:   string;
    content: string;
  }>;
}

export interface SearXNGResult {
  url:     string;
  title:   string;
  content: string;
}

/**
 * Query a SearXNG instance and return the top results.
 *
 * SearXNG must be configured with `format: json` allowed in settings.yml.
 * Default instance: http://localhost:8080
 *
 * Throws on network error or non-2xx HTTP response so callers can surface
 * a meaningful error to the user.
 */
export async function searchSearXNG(
  query:      string,
  baseUrl:    string,
  maxResults  = 10,
): Promise<SearXNGResult[]> {
  const endpoint = new URL('/search', baseUrl);
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('language', 'en-US');
  // Disable safe-search to get broader results (can be overridden in SearXNG settings)
  endpoint.searchParams.set('safesearch', '0');

  logger.info({ query, baseUrl }, 'querying SearXNG');

  let data: SearXNGResponse;
  try {
    const resp = await axios.get<SearXNGResponse>(endpoint.toString(), {
      timeout: 12_000,
      headers: { Accept: 'application/json' },
    });
    data = resp.data;
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? `SearXNG unreachable at ${baseUrl}: ${err.message}`
      : String(err);
    logger.error({ err: msg }, 'SearXNG request failed');
    throw new Error(msg);
  }

  const results = data?.results ?? [];
  logger.info({ count: results.length, query }, 'SearXNG results received');

  // Deduplicate by URL, then take first maxResults
  const seen = new Set<string>();
  const deduped: SearXNGResult[] = [];
  for (const r of results) {
    if (!r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    deduped.push({ url: r.url, title: r.title ?? '', content: r.content ?? '' });
    if (deduped.length >= maxResults) break;
  }

  return deduped;
}
