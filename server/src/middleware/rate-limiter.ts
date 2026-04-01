/**
 * Token-bucket rate limiter — one bucket per hostname.
 *
 * Architecture doc requirements:
 *  - Token bucket per domain
 *  - Exponential backoff + jitter on 429 / errors
 *  - Respects robots.txt Crawl-delay
 *
 * `waitForToken(hostname, crawlDelayMs)` — async, resolves when a token
 *   is available.  Call once before every fetch for a given hostname.
 *
 * `applyBackoff(hostname, retryCount)` — drain tokens + slow rate after
 *   a 429 or repeated failures.
 */

interface TokenBucket {
  tokens:    number;
  lastRefill: number;
  ratePerMs: number;  // tokens / ms  (1 token = 1 request slot)
  capacity:  number;
}

const buckets = new Map<string, TokenBucket>();
const DEFAULT_DELAY_MS = 500; // 2 req / s default

function getBucket(hostname: string, crawlDelayMs: number): TokenBucket {
  if (!buckets.has(hostname)) {
    const delay  = Math.max(crawlDelayMs, DEFAULT_DELAY_MS);
    buckets.set(hostname, {
      tokens:    1,
      lastRefill: Date.now(),
      ratePerMs: 1 / delay,
      capacity:  3,
    });
  }
  return buckets.get(hostname)!;
}

function refill(bucket: TokenBucket): void {
  const now     = Date.now();
  const elapsed = now - bucket.lastRefill;
  bucket.tokens    = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.ratePerMs);
  bucket.lastRefill = now;
}

/**
 * Wait until a request token is available for `hostname`.
 * Blocks for however long is needed, then consumes one token.
 */
export async function waitForToken(
  hostname:     string,
  crawlDelayMs: number = DEFAULT_DELAY_MS,
): Promise<void> {
  const bucket = getBucket(hostname, crawlDelayMs);
  refill(bucket);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return;
  }

  const deficit = 1 - bucket.tokens;
  const waitMs  = Math.ceil(deficit / bucket.ratePerMs);
  const jitter  = Math.floor(Math.random() * 200); // 0–200 ms jitter
  await new Promise(resolve => setTimeout(resolve, waitMs + jitter));

  refill(bucket);
  bucket.tokens = Math.max(0, bucket.tokens - 1);
}

/**
 * Apply exponential backoff after a 429 / connection error.
 * Halves the refill rate per retry and drains current tokens.
 */
export function applyBackoff(hostname: string, retryCount: number): void {
  const bucket = getBucket(hostname, DEFAULT_DELAY_MS);
  const factor = Math.pow(0.5, retryCount); // halve rate each retry
  bucket.ratePerMs = Math.max(bucket.ratePerMs * factor, 1 / 30_000); // floor: 1 req/30 s
  bucket.tokens    = 0;
}
