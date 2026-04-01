# Web Crawler Project — Summary

---

## 1. System Architecture Overview

A production web crawler for JS-rendered pages is composed of four layers:

- **URL Frontier** (Redis) — priority queue, deduplication, per-domain politeness queues
- **Fetcher** (Crawlee + Playwright) — smart routing: plain HTTP first, escalate to headless browser only when JS is detected
- **Parser / Extractor** (Cheerio + Readability) — links, text, metadata, optional Markdown via Firecrawl
- **Storage** (PostgreSQL + S3/MinIO) — URL state machine, metadata, raw HTML snapshots

---

## 2. Tool Comparison

| Tool | Type | Best For | Weakness |
|---|---|---|---|
| **Crawlee** | Node.js crawler framework | JS-heavy crawls, unified API | Apify-centric, memory-heavy |
| **Playwright/Puppeteer** | Browser automation | Full page interaction, SPA rendering | Not a crawler, slow, no queue |
| **Scrapy** | Python crawler framework | High-volume static sites | JS rendering bolted on, Twisted model |
| **SearXNG** | Meta-search engine | URL discovery for RAG pipelines | Not a crawler, rate-limited by upstream |
| **Firecrawl** | Crawl-as-a-service API | LLM-ready Markdown output | Not for bulk crawls, young project |

**Pipeline:**
```
SearXNG (discover URLs) → Crawlee + Playwright (fetch) → Parser → PostgreSQL + S3
```

---

## 3. Core Concepts

### Crawler vs Scraper
- **Scraper** — extracts data from a page you already have (single page, known list)
- **Crawler** — discovers new URLs and drives the scraper across them (link-following, recursive)

### Why Standard HTTP Fails on JS Pages
Static HTTP gets the empty shell (`<div id="root"></div>`). React/Vue/Angular render the DOM client-side after executing JavaScript — content doesn't exist in the server response. A headless browser (Playwright) runs the full browser engine, executes JS, waits for `networkidle`, then hands back a fully-rendered DOM.

### Crawl Frontier
The URL queue and memory system of a crawler:
- **Seen set** — SHA-256 dedup, O(1) lookup
- **Priority queue** — Redis sorted set, score = timestamp + (1/priority)
- **Per-domain FIFOs** — politeness, one queue per host
- **URL state machine:** `DISCOVERED → QUEUED → FETCHING → DONE / FAILED → DEAD`

### Anti-Blocking Layers
| Layer | Defense |
|---|---|
| Rate limiting | Token bucket per domain + exponential backoff + jitter on 429 |
| User-agent | Rotate real browser UAs with matching `sec-ch-ua`, `Accept-Language` |
| IP blocking | Residential proxy pool with health monitoring + sticky sessions |
| Browser fingerprint | `playwright-extra` stealth + `fingerprint-suite` |
| robots.txt | Parse + cache (TTL 24h), respect `Crawl-delay` |
| Honeypots | Skip `display:none` / `visibility:hidden` links |

---

## 4. Implementation Plan

### Phase 1 — MVP (Weeks 1–3)
- URL normalizer, PostgreSQL migrations, Redis frontier (Lua scripts for atomic ops)
- `HttpCrawler` (static) + render detector heuristics + `PlaywrightCrawler` (JS)
- SearXNG seed discovery, CLI entrypoint, end-to-end integration test
- **Exit criteria:** 1,000 URLs/hr, correct dedup and state tracking

### Phase 2 — Anti-blocking (Weeks 4–6)
- Token bucket rate limiter, per-domain FIFO queues, `Crawl-delay` enforcement
- UA rotation, `playwright-extra` stealth, `fingerprint-suite`, proxy rotation
- Honeypot detector, CAPTCHA circuit breaker, Firecrawl adapter
- **Exit criteria:** 10,000 URL job, under 2% block rate

### Phase 3 — Scale (Weeks 7–9)
- BullMQ worker isolation, `SET NX` distributed locking, graceful shutdown
- Prometheus metrics, Pino structured logging, OpenTelemetry, K8s health probes
- Dockerfile (multi-stage), Helm chart, HPA on queue depth
- **Exit criteria:** 100K URL job across 5 K8s pods

---

## 5. Build Order (Critical Path)

| Step | Module | Reason |
|---|---|---|
| 1 | `url-normalizer.ts` | Every module touches URLs — bugs compound |
| 2 | PostgreSQL migrations + `url-repository.ts` | State machine is the source of truth |
| 3 | `redis-frontier.ts` (Lua scripts) | Test concurrent writes before crawler touches it |
| 4 | `robots-cache.ts` + `rate-limiter.ts` | Must be live before any real fetch |
| 5 | `static-crawler.ts` + `render-detector.ts` | ~70% of pages are static |
| 6 | `js-crawler.ts` (Playwright) | Only after static path is stable |
| 7 | `content-extractor.ts` + `object-store.ts` | Real pages needed to validate quality |
| 8 | End-to-end integration test | Lock contracts before adding complexity |
| 9 | Anti-blocking layer | Baseline must work before evasion is layered in |
| 10 | BullMQ + worker isolation | Final step, frontier interface unchanged |

---

## 6. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Redis OOM on large jobs | Hard `max_urls_per_job` cap; overflow to PostgreSQL |
| Playwright process leaks | `fetching_heartbeat_at` updated every 30s; scheduler requeues stuck rows |
| Normalization divergence | Single `normalize()` call site; idempotency property tests |
| Proxy pool exhaustion | CAPTCHA circuit breaker pauses domain 1hr; rotation throttled per domain |
| PostgreSQL bottleneck | Write-behind: buffer 100 transitions, flush every 500ms; Redis is the hot path |
| Render escalation too high | Track rate via metrics; pin always-JS domains in Redis override hash |

---

## 7. Data Models (Key Fields)

**UrlRecord:** `id, url, url_hash, job_id, state, depth, retry_count, fetching_heartbeat_at, render_mode, parent_url_id`

**CrawlJob:** `id, seed_urls, state, config_snapshot, max_depth, max_urls, allowed_domains`

**ExtractedContent:** `text_content, markdown_content, raw_html_key, outgoing_links, schema_org_data, meta_tags`

---

## 8. Stack at a Glance

| Concern | Technology |
|---|---|
| Crawler framework | Crawlee (Node.js) |
| JS rendering | Playwright (Chromium) |
| URL queue / dedup | Redis (sorted sets + Lua) |
| State + metadata DB | PostgreSQL |
| Raw HTML storage | MinIO / S3 |
| URL discovery | SearXNG (self-hosted) |
| LLM content output | Firecrawl |
| Job queue (Phase 3) | BullMQ |
| Metrics | Prometheus + Grafana |
| Logging | Pino (structured JSON) |
| Container | Docker + Kubernetes |
