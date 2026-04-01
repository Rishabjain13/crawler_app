import type { Request, Response } from 'express';
import { jobStore }            from '../storage/job-store.js';
import { runCrawlPipeline }    from '../pipeline/crawl-pipeline.js';
import { synthesize, buildSummary } from '../synthesis/synthesizer.js';
import { isPrivateUrl }        from '../crawler/url-normalizer.js';
import { searchSearXNG }       from '../search/searxng-client.js';
import { logger }              from '../logger.js';
import type { CrawlJobConfig, UrlRecord, CrawlJobState } from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateConfig(body: unknown): { config: CrawlJobConfig } | { error: string } {
  const b = body as Partial<CrawlJobConfig>;

  if (!Array.isArray(b?.seedUrls) || b.seedUrls.length === 0) {
    return { error: 'seedUrls must be a non-empty array' };
  }
  if (b.seedUrls.length > 10) {
    return { error: 'seedUrls may contain at most 10 URLs' };
  }
  for (const url of b.seedUrls) {
    if (typeof url !== 'string') {
      return { error: 'Each seed URL must be a string' };
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { error: `Seed URL must use http or https: ${url}` };
      }
    } catch {
      return { error: `Invalid seed URL: ${url}` };
    }
    if (isPrivateUrl(url)) {
      return { error: `Seed URL resolves to a private/reserved address: ${url}` };
    }
  }

  const rawDepth = Number(b.maxDepth);
  const rawUrls  = Number(b.maxUrls);

  return {
    config: {
      seedUrls:       b.seedUrls.map(u => u.trim()),
      maxDepth:       Math.min(Math.max(Number.isFinite(rawDepth) ? rawDepth : 2, 1), 5),
      maxUrls:        Math.min(Math.max(Number.isFinite(rawUrls)  ? rawUrls  : 20, 1), 50),
      allowedDomains: typeof b.allowedDomains === 'string' ? b.allowedDomains : '',
      query:          typeof b.query === 'string' ? b.query : undefined,
    },
  };
}

/** Fire-and-forget wrapper used by both /api/crawl and /api/search. */
function startPipeline(jobId: string, config: CrawlJobConfig): void {
  (async () => {
    try {
      await runCrawlPipeline(jobId, config);
    } catch (err) {
      jobStore.updateJob(jobId, { status: 'failed' });
      logger.error(
        { jobId, err: err instanceof Error ? err.message : String(err) },
        'pipeline error',
      );
    }
  })();
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * POST /api/crawl
 *
 * Validates input, creates a job, starts the pipeline in the background,
 * and immediately returns 202 + { jobId }.
 */
export async function handleStartCrawl(req: Request, res: Response): Promise<void> {
  const result = validateConfig(req.body);
  if ('error' in result) {
    res.status(400).json({ error: result.error });
    return;
  }

  const { config } = result;
  const job = jobStore.createJob(config);
  logger.info({ jobId: job.id, config }, 'crawl job queued');
  startPipeline(job.id, config);
  res.status(202).json({ jobId: job.id });
}

/**
 * POST /api/search
 *
 * Accepts { query, searxngUrl?, maxDepth?, maxUrls?, allowedDomains? }.
 * Calls SearXNG to discover seed URLs, then starts a crawl job exactly like
 * /api/crawl.  Returns 202 + { jobId, seedUrls }.
 *
 * Error cases handled:
 *   - SearXNG unreachable → 503
 *   - No results found    → 422
 *   - Private searxngUrl  → 400 (SSRF guard)
 */
export async function handleSearchQuery(req: Request, res: Response): Promise<void> {
  const body = req.body as {
    query?:          unknown;
    searxngUrl?:     unknown;
    maxDepth?:       unknown;
    maxUrls?:        unknown;
    allowedDomains?: unknown;
  };

  // ── Validate query ────────────────────────────────────────────────────────
  if (!body.query || typeof body.query !== 'string' || !body.query.trim()) {
    res.status(400).json({ error: 'query must be a non-empty string' });
    return;
  }
  const query = body.query.trim().slice(0, 500);

  // ── Validate searxngUrl ───────────────────────────────────────────────────
  const rawSearxng = typeof body.searxngUrl === 'string'
    ? body.searxngUrl.trim()
    : (process.env.SEARXNG_URL ?? 'http://localhost:8080');

  let searxngUrl: string;
  try {
    const parsed = new URL(rawSearxng);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({ error: 'searxngUrl must use http or https' });
      return;
    }
    searxngUrl = parsed.origin; // strip any path/query from base URL
  } catch {
    res.status(400).json({ error: `Invalid searxngUrl: ${rawSearxng}` });
    return;
  }

  // ── Call SearXNG ──────────────────────────────────────────────────────────
  // Note: no SSRF guard here — SearXNG is a configured backend service that
  // legitimately runs on localhost. SSRF protection applies to crawl targets.
  let searxResults;
  try {
    searxResults = await searchSearXNG(query, searxngUrl, 10);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      error: `Could not reach SearXNG at ${searxngUrl}. `
        + `Make sure it is running and JSON format is enabled. Details: ${msg}`,
    });
    return;
  }

  if (searxResults.length === 0) {
    res.status(422).json({
      error: `SearXNG returned no results for "${query}". Try a different query or check your SearXNG instance.`,
    });
    return;
  }

  const seedUrls = searxResults.map(r => r.url);
  logger.info({ query, seedUrls }, 'seed URLs from SearXNG');

  // ── Build config & start job ───────────────────────────────────────────────
  const rawDepth = Number(body.maxDepth);
  const rawUrls  = Number(body.maxUrls);

  const config: CrawlJobConfig = {
    seedUrls,
    maxDepth:       Math.min(Math.max(Number.isFinite(rawDepth) ? rawDepth : 1, 1), 5),
    maxUrls:        Math.min(Math.max(Number.isFinite(rawUrls)  ? rawUrls  : 20, 1), 50),
    allowedDomains: typeof body.allowedDomains === 'string' ? body.allowedDomains : '',
    query,
  };

  const job = jobStore.createJob(config);
  logger.info({ jobId: job.id, query, seedCount: seedUrls.length }, 'search job queued');
  startPipeline(job.id, config);

  res.status(202).json({ jobId: job.id, seedUrls });
}

/**
 * GET /api/jobs/:jobId
 *
 * Returns current job status + all accumulated results (for polling clients
 * or post-job retrieval).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function handleGetJob(req: Request, res: Response): void {
  const jobId = String(req.params.jobId);
  if (!UUID_RE.test(jobId)) {
    res.status(400).json({ error: 'Invalid jobId format' });
    return;
  }
  const job = jobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const records             = jobStore.getRecords(jobId);
  const { results, stats }  = synthesize(records, job.startedAt);
  const summary             = job.config.query
    ? buildSummary(records, job.config.query, job.startedAt)
    : undefined;

  res.json({ jobId, status: job.status, results, stats, summary });
}

/**
 * GET /api/jobs/:jobId/stream
 *
 * Server-Sent Events stream.  The client receives:
 *   event: record       — one per crawled URL (UrlRecord JSON)
 *   event: done         — when the crawl finishes ({ results, stats, summary? })
 *   event: crawl_error  — on pipeline failure ({ error })
 *
 * If the job is already finished when this endpoint is hit (e.g. reconnect),
 * all records are flushed synchronously and the stream is closed.
 */
export function handleStreamJob(req: Request, res: Response): void {
  const jobId = String(req.params.jobId);
  if (!UUID_RE.test(jobId)) {
    res.status(400).json({ error: 'Invalid jobId format' });
    return;
  }
  const job = jobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  function send(event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function buildDonePayload(records: UrlRecord[], startedAt: number) {
    const { results, stats } = synthesize(records, startedAt);
    const summary = job!.config.query
      ? buildSummary(records, job!.config.query, startedAt)
      : undefined;
    return { results, stats, summary };
  }

  // ── Already-finished job: flush all records synchronously ─────────────────
  if (job.status === 'done' || job.status === 'failed') {
    const records = jobStore.getRecords(jobId);
    for (const r of records) send('record', r);

    if (job.status === 'done') {
      send('done', buildDonePayload(records, job.startedAt));
    } else {
      send('crawl_error', { error: 'Crawl pipeline failed' });
    }
    res.end();
    return;
  }

  // ── Live job: subscribe to EventEmitter channels ──────────────────────────
  const onRecord = (record: UrlRecord) => send('record', record);

  const onJob = (updated: CrawlJobState) => {
    const records = jobStore.getRecords(jobId);
    if (updated.status === 'done') {
      send('done', buildDonePayload(records, updated.startedAt));
    } else {
      send('crawl_error', { error: 'Crawl pipeline failed' });
    }
    cleanup();
    res.end();
  };

  function cleanup(): void {
    jobStore.off(`record:${jobId}`, onRecord);
    jobStore.off(`job:${jobId}`,    onJob);
  }

  jobStore.on(`record:${jobId}`, onRecord);
  jobStore.on(`job:${jobId}`,    onJob);

  req.on('close', cleanup);
}
