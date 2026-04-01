import { EventEmitter } from 'node:events';
import type { UrlRecord, CrawlJobConfig, CrawlJobState } from '../types.js';

/**
 * In-memory implementation of the URL state machine + job registry.
 *
 * v2 changes vs v1:
 *  - Extends EventEmitter so SSE handlers can subscribe to per-job events
 *    without polling.  Two event channels per job:
 *      `record:<jobId>` — fired after every UrlRecord upsert
 *      `job:<jobId>`    — fired when job status changes to done / failed
 *  - Completed/failed jobs are automatically cleaned up after 1 hour via
 *    per-job setTimeout, preventing unbounded memory growth.
 *  - setMaxListeners(100) suppresses EventEmitter's 10-listener warning for
 *    servers with many concurrent SSE connections.
 */
export class JobStore extends EventEmitter {
  private readonly jobs    = new Map<string, CrawlJobState>();
  /** jobId → urlHash → UrlRecord */
  private readonly records = new Map<string, Map<string, UrlRecord>>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  // ── Job CRUD ──────────────────────────────────────────────────────────────

  createJob(config: CrawlJobConfig): CrawlJobState {
    const id  = crypto.randomUUID();
    const job: CrawlJobState = {
      id,
      config,
      status:    'running',
      startedAt: Date.now(),
    };
    this.jobs.set(id, job);
    this.records.set(id, new Map());
    return job;
  }

  getJob(id: string): CrawlJobState | undefined {
    return this.jobs.get(id);
  }

  updateJob(id: string, patch: Partial<CrawlJobState>): void {
    const job = this.jobs.get(id);
    if (!job) return;

    Object.assign(job, patch);

    if (patch.status === 'done' || patch.status === 'failed') {
      // Notify SSE subscribers
      this.emit(`job:${id}`, job);

      // Schedule cleanup after 1 hour — prevents unbounded memory growth
      const timer = setTimeout(() => {
        this.jobs.delete(id);
        this.records.delete(id);
        this.cleanupTimers.delete(id);
      }, 60 * 60 * 1_000);
      this.cleanupTimers.set(id, timer);
    }
  }

  // ── URL record CRUD ───────────────────────────────────────────────────────

  /**
   * Upsert a UrlRecord by its urlHash.
   * State-machine transition guard: only allow forward transitions.
   * Emits `record:<jobId>` after every accepted upsert.
   */
  saveRecord(jobId: string, record: UrlRecord): void {
    const map = this.records.get(jobId);
    if (!map) return;

    const existing = map.get(record.urlHash);
    const order: Record<string, number> = {
      DISCOVERED: 0, QUEUED: 1, FETCHING: 2,
      DONE: 3, FAILED: 3, DEAD: 4,
    };

    if (existing) {
      // Never move backwards in the state machine
      if ((order[record.state] ?? 0) >= (order[existing.state] ?? 0)) {
        map.set(record.urlHash, record);
        this.emit(`record:${jobId}`, record);
      }
    } else {
      map.set(record.urlHash, record);
      this.emit(`record:${jobId}`, record);
    }
  }

  getRecords(jobId: string): UrlRecord[] {
    return Array.from(this.records.get(jobId)?.values() ?? []);
  }

  getRecord(jobId: string, urlHash: string): UrlRecord | undefined {
    return this.records.get(jobId)?.get(urlHash);
  }
}

/** Singleton — one store per server process. */
export const jobStore = new JobStore();
