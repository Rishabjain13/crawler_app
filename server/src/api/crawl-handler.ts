import type { Request, Response } from 'express';
import { jobStore }            from '../storage/job-store.js';
import { runCrawlPipeline }    from '../pipeline/crawl-pipeline.js';
import { synthesize }          from '../synthesis/synthesizer.js';
import { isPrivateUrl }        from '../crawler/url-normalizer.js';
import { logger }              from '../logger.js';
import type { CrawlJobConfig, UrlRecord, CrawlJobState } from '../types.js';

// ── Input validation ──────────────────────────────────────────────────────────

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
    // SSRF guard — also enforced at fetch time, but reject early
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
    },
  };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * POST /api/crawl
 *
 * Validates input, creates a job, starts the pipeline in the background,
 * and immediately returns 202 + { jobId }.
 *
 * The pipeline no longer blocks the HTTP handler — every other request
 * (including health checks and SSE streams) remains responsive.
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

  // Fire-and-forget — pipeline runs entirely in the background
  (async () => {
    try {
      await runCrawlPipeline(job.id, config);
    } catch (err) {
      jobStore.updateJob(job.id, { status: 'failed' });
      logger.error(
        { jobId: job.id, err: err instanceof Error ? err.message : String(err) },
        'pipeline error',
      );
    }
  })();

  res.status(202).json({ jobId: job.id });
}

/**
 * GET /api/jobs/:jobId
 *
 * Returns current job status + all accumulated results (for polling clients
 * or post-job retrieval).
 */
export function handleGetJob(req: Request, res: Response): void {
  const { jobId } = req.params;
  const job = jobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  const records        = jobStore.getRecords(jobId);
  const { results, stats } = synthesize(records, job.startedAt);
  res.json({ jobId, status: job.status, results, stats });
}

/**
 * GET /api/jobs/:jobId/stream
 *
 * Server-Sent Events stream.  The client receives:
 *   event: record   — one per crawled URL (UrlRecord JSON)
 *   event: done     — when the crawl finishes successfully ({ results, stats })
 *   event: crawl_error — on pipeline failure ({ error })
 *
 * If the job is already finished when this endpoint is hit (e.g. reconnect),
 * all records are flushed synchronously and the stream is closed.
 */
export function handleStreamJob(req: Request, res: Response): void {
  const { jobId } = req.params;
  const job = jobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx proxy buffering
  res.flushHeaders();

  function send(event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // ── Already-finished job: flush all records synchronously ─────────────────
  if (job.status === 'done' || job.status === 'failed') {
    const records = jobStore.getRecords(jobId);
    for (const r of records) send('record', r);

    if (job.status === 'done') {
      const { results, stats } = synthesize(records, job.startedAt);
      send('done', { results, stats });
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
      const { results, stats } = synthesize(records, updated.startedAt);
      send('done', { results, stats });
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

  // Clean up listeners when the client disconnects
  req.on('close', cleanup);
}
