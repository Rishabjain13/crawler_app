import { hashUrl } from '../crawler/url-normalizer.js';

export interface FrontierEntry {
  url:        string;
  depth:      number;
  parentUrl?: string;
  /** Lower score = higher priority (timestamp + depth penalty). */
  priority:   number;
}

// ── Binary min-heap — O(log n) push/pop ──────────────────────────────────────
class MinHeap<T> {
  private data: T[] = [];

  constructor(private readonly cmp: (a: T, b: T) => number) {}

  push(item: T): void {
    this.data.push(item);
    this._up(this.data.length - 1);
  }

  pop(): T | undefined {
    if (this.data.length === 0) return undefined;
    const top  = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this._down(0);
    }
    return top;
  }

  get size(): number { return this.data.length; }

  clear(): void { this.data.length = 0; }

  private _up(i: number): void {
    const { data, cmp } = this;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cmp(data[i], data[p]) < 0) {
        [data[i], data[p]] = [data[p], data[i]];
        i = p;
      } else break;
    }
  }

  private _down(i: number): void {
    const { data, cmp } = this;
    const n = data.length;
    while (true) {
      let s = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && cmp(data[l], data[s]) < 0) s = l;
      if (r < n && cmp(data[r], data[s]) < 0) s = r;
      if (s === i) break;
      [data[i], data[s]] = [data[s], data[i]];
      i = s;
    }
  }
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory crawl frontier.
 *
 * v2 changes vs v1:
 *  - Priority queue backed by a binary min-heap → O(log n) push/pop
 *    instead of the previous O(n) findIndex + splice.
 *  - Removed per-domain FIFO shadow (domain-level politeness is already
 *    handled by the token-bucket rate limiter in middleware/rate-limiter.ts).
 *
 * Seen-set uses SHA-256 for O(1) dedup.
 */
export class InMemoryFrontier {
  private readonly seen = new Set<string>();
  private readonly heap = new MinHeap<FrontierEntry>((a, b) => a.priority - b.priority);

  /**
   * Push a URL into the frontier.
   * Returns false (and skips insert) if the URL was already seen.
   */
  push(entry: FrontierEntry): boolean {
    const hash = hashUrl(entry.url);
    if (this.seen.has(hash)) return false;
    this.seen.add(hash);
    this.heap.push(entry);
    return true;
  }

  /** Dequeue the highest-priority (lowest score) URL. */
  pop(): FrontierEntry | undefined {
    return this.heap.pop();
  }

  /** Mark a URL as seen without queuing it (e.g. for pre-seeding from DB). */
  markSeen(url: string): void {
    this.seen.add(hashUrl(url));
  }

  has(url: string): boolean {
    return this.seen.has(hashUrl(url));
  }

  size():      number { return this.heap.size; }
  seenCount(): number { return this.seen.size; }

  clear(): void {
    this.seen.clear();
    this.heap.clear();
  }
}
