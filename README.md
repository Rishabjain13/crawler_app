# WebCrawler

A full-stack research tool that takes a natural language query, discovers seed URLs via **SearXNG**, crawls those pages with automatic JS escalation via **Playwright**, extracts content, and streams live results to the UI — no Google Search API, no OpenAI, no external AI services.

---

## Tech Stack

### Frontend
| Tech | Purpose |
|---|---|
| React 19 | UI framework |
| TypeScript | Type safety |
| Vite | Dev server + bundler |
| Tailwind CSS | Styling |
| `EventSource` (browser API) | SSE streaming from backend |

### Backend
| Tech | Purpose |
|---|---|
| Node.js + TypeScript | Runtime |
| Express | HTTP server + routing |
| axios | Static HTTP fetching (plain HTML pages) |
| Playwright (optional) | Headless Chromium for JS-rendered SPAs |
| Cheerio | Fast HTML parsing — titles, links, meta tags, JSON-LD |
| jsdom | Full DOM simulation required by Readability |
| @mozilla/readability | Article text extraction (Firefox Reader View algorithm) |
| robots-parser | robots.txt compliance |
| pino | Structured JSON logging |
| Node `EventEmitter` | SSE bridge between crawl pipeline and HTTP stream |

### Search
| Tech | Purpose |
|---|---|
| SearXNG | Self-hosted meta-search engine — converts query into seed URLs |

---

## Full Flow

```
User types query in SearchBar
        │
        ▼
POST /api/search
  { query, searxngUrl, maxDepth, maxUrls, allowedDomains }
        │
        ▼
searchSearXNG()
  → GET searxng/search?q=...&format=json
  → deduplicate by URL
  → return up to 10 seed URLs
        │
        ▼
jobStore.createJob(config)  →  jobId (UUID)
        │
        ▼
startPipeline()  ← fire-and-forget, 202 returned to frontend immediately
        │
        ▼
Frontend opens EventSource on /api/jobs/:jobId/stream
        │
        ▼
runCrawlPipeline(jobId, config)
  │
  ├── normalizeUrl(seedUrl)
  │     - upgrades http → https
  │     - lowercases hostname
  │     - strips #fragment
  │     - sorts query params
  │     - SSRF guard (blocks 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x)
  │     - returns null for private/invalid URLs → skip
  │
  ├── frontier.push({ url, depth: 0, priority: Date.now() })
  │     - InMemoryFrontier backed by binary min-heap (O log n push/pop)
  │     - SHA-256 seen-set for O(1) dedup
  │
  └── MAIN LOOP: while frontier has URLs and crawledCount < maxUrls
        │
        ├── frontier.pop()  →  entry { url, depth, parentUrl }
        │
        ├── record created: state=FETCHING, renderMode='static'
        │   jobStore.saveRecord() → emits "record:<jobId>" → SSE sends to browser
        │
        ├── getRobotsRules(url)   ← cached 24h per hostname
        │   isAllowed(url, rules) → if blocked: state=DEAD, skip
        │
        ├── waitForToken(hostname, crawlDelay)
        │     - token bucket rate limiter (one bucket per hostname)
        │     - respects robots.txt Crawl-delay (min 500ms)
        │     - exponential backoff + jitter on retries
        │
        ├── fetchStatic(url)   ← Phase 1 — always runs
        │     - axios GET, arraybuffer response type
        │     - persistent keep-alive connection pool (maxSockets: 10)
        │     - round-robin User-Agent rotation (3 real Chrome strings)
        │     - follows up to 5 redirects
        │     - 5 MB content-length cap
        │     - charset detection from Content-Type header (UTF-8 / ISO-8859-1 / latin1)
        │     - returns { html, statusCode, finalUrl }
        │
        ├── empty response → state=DEAD
        │
        ├── detectRenderMode(html)   ← heuristic, 4 signals in priority order
        │     1. Empty SPA mount point (#root/#app/#__next/#__nuxt) with <100 chars
        │     2. Hashed JS bundle <script src> (main.abc123.js) + body text <300 chars
        │     3. Inline framework boot signals (__NEXT_DATA__, ReactDOM.render,
        │        createRoot, new Vue, angular.bootstrap, etc.)
        │     4. Sparse body: HTML >5KB but visible text <200 chars
        │     → returns 'static' or 'js'
        │
        ├── if 'js':  fetchWithPlaywright(url)   ← Phase 2 — optional escalation
        │     - singleton headless Chromium (lazy launch, reused across all URLs)
        │     - semaphore: max 3 concurrent tabs (pageWaiters queue for excess)
        │     - page.goto(url, { waitUntil: 'networkidle', timeout: 30s })
        │       networkidle = no network requests for 500ms (SPA API calls settle)
        │     - page.content() → fully rendered DOM as HTML string
        │     - finally: releasePage() + page.close() (always, even on error)
        │     - returns null if Playwright not installed → fallback to static html
        │
        ├── statusCode ≥ 400 → state=DEAD (4xx) or FAILED (5xx, retryable)
        │
        ├── extractContent(html, finalUrl)
        │     CHEERIO (fast path, no DOM):
        │       - title: og:title → <title> tag
        │       - description: og:description → meta[name=description]
        │       - metaTags: all meta[name] and meta[property] key-value pairs
        │       - outgoingLinks: all <a href>, resolved via new URL(href, finalUrl)
        │         (handles relative, absolute, protocol-relative; skips mailto/js)
        │       - schemaOrgData: all <script type="application/ld+json"> parsed as JSON
        │     JSDOM + READABILITY (article text):
        │       - jsdom builds full DOM from HTML (browser-equivalent environment)
        │       - Readability scores every block by text density, link ratio,
        │         class names — strips nav/footer/ads/sidebars, returns main content
        │       - textContent.replace(/\s+/g, ' ').trim()
        │       - fallback: $('body').text() if jsdom/Readability throws
        │
        ├── record updated:
        │     state=DONE, renderMode='static'|'js',
        │     title, description, excerpt (first 500 chars of textContent),
        │     linksFound, fetchedAt, statusCode
        │   jobStore.saveRecord() → emits "record:<jobId>" → SSE sends DONE record
        │
        ├── link discovery (only if depth < maxDepth):
        │     for each outgoingLink:
        │       normalizeUrl(link, finalUrl) → null? skip
        │       hostname in allowedDomains?  → no? skip
        │       frontier.push({ url, depth: depth+1,
        │                        priority: Date.now() + depth*1000 })
        │         (deeper pages get lower priority = crawled later)
        │
        └── on error (network/timeout):
              retryCount < 3 → state=FAILED, requeue with 5s*retryCount delay
              retryCount ≥ 3 → state=DEAD, applyBackoff(hostname)

        │
        ▼
jobStore.updateJob({ status: 'done' })
  → emits "job:<jobId>" → SSE handler fires

        │
        ▼
SSE 'done' event:
  synthesize(records)
    - sort by depth asc, then fetchedAt asc (BFS order)
    - map UrlRecord → CrawlResult (public API shape)
    - stats: totalPages, totalLinks, staticPages, jsPages, failedUrls, deadUrls, duration

  buildSummary(records, query)   ← only for /api/search jobs
    - filter to DONE records only
    - tokenize query: lowercase, split on \W+, drop terms ≤2 chars
    - score each record: count query terms found in title+description+excerpt
    - sort: highest score first, tiebreak by lower depth first
    - take top 8
    - format: plain text with bullet per result (title, hostname, snippet ≤200 chars)
    - append failed/dead URL count

        │
        ▼
Frontend receives 'done':
  - setResults(payload.results) — replaces accumulated live records with final sorted list
  - setStats(payload.stats)     — StatsBar renders totals + render mode breakdown
  - setSummary(payload.summary) — collapsible Research Summary panel
  - ResultCard per result:
      - blue "Static" badge or amber "JS ⚡" badge (renderMode)
      - colored HTTP status badge (green 200, blue 301/302, red 404, orange 500)
      - colored state badge (DONE/FAILED/DEAD/FETCHING)
      - depth, links found, retry count, parent URL path, crawledAt time
```

---

## URL State Machine

Every URL goes through a forward-only state machine (never moves backwards):

```
DISCOVERED → QUEUED → FETCHING → DONE
                              → FAILED  (retryable, requeued)
                              → DEAD    (blocked by robots / 4xx / max retries)
```

`jobStore.saveRecord()` enforces the order — a record in state DONE cannot be overwritten with FETCHING even if a race occurs.

---

## SSE Architecture

```
runCrawlPipeline()
    │  jobStore.saveRecord()  →  emits "record:<jobId>"
    │  jobStore.updateJob()   →  emits "job:<jobId>"
    │
JobStore extends EventEmitter
    │
    │  .on("record:<jobId>", onRecord)
    │  .on("job:<jobId>",    onJob)
    │
handleStreamJob()
    │  res.write(`event: record\ndata: {...}\n\n`)
    │  res.write(`event: done\ndata: {...}\n\n`)  →  res.end()
    │
    │  cleanup() on: job done, crawl_error, req.on('close') (client disconnect)
    │
EventSource (browser)
    │  .addEventListener('record', ...)
    │  .addEventListener('done', ...)
    │  .addEventListener('crawl_error', ...)
```

Jobs are cleaned up from memory after 1 hour via `setTimeout` in `jobStore.updateJob`.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 18+ | Required |
| Docker | any | For SearXNG |
| Playwright Chromium | optional | Only for JS-rendered pages |

---

## Running locally

### 1. Clone and install

```bash
git clone <repo-url>
cd crawler_app

# Frontend
npm install

# Backend
cd server
npm install
```

### 2. Install Playwright browsers (optional)

Only needed for JS-heavy pages (SPAs). The crawler works without it — JS pages fall back to the static result.

```bash
cd server
npx playwright install chromium
```

### 3. Start SearXNG

```bash
docker run -d -p 8888:8080 --name searxng searxng/searxng
```

Enable JSON format (required once):

```bash
docker exec searxng python3 -c "
txt = open('/etc/searxng/settings.yml').read()
txt = txt.replace('  formats:\n    - html', '  formats:\n    - html\n    - json')
open('/etc/searxng/settings.yml', 'w').write(txt)
"
docker restart searxng
```

Verify:

```bash
curl "http://localhost:8888/search?q=test&format=json"
```

### 4. Start the backend

```bash
cd server
npm run dev
# Listening on http://localhost:3001
```

### 5. Start the frontend

```bash
# from crawler_app/ root, separate terminal
npm run dev
# http://localhost:5173
```

Open **http://localhost:5173**, enter your SearXNG URL as `http://localhost:8888`, type a query, and search.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Backend port |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:5174` | CORS allowlist |
| `SEARXNG_URL` | `http://localhost:8080` | Server-side fallback if `searxngUrl` not sent in request body |

---

## API Reference

### `GET /api/health`

```json
{ "ok": true, "ts": "2024-01-01T00:00:00.000Z" }
```

---

### `POST /api/search`

Query → SearXNG → seed URLs → crawl job.

**Request body**
```json
{
  "query":          "best open-source LLMs 2024",
  "searxngUrl":     "http://localhost:8888",
  "maxDepth":       1,
  "maxUrls":        20,
  "allowedDomains": ""
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `query` | string | yes | max 500 chars |
| `searxngUrl` | string | no | defaults to `SEARXNG_URL` env var |
| `maxDepth` | number | no | clamped to [1, 5], default 1 |
| `maxUrls` | number | no | clamped to [1, 50], default 20 |
| `allowedDomains` | string | no | comma-separated hostnames; blank = all |

**Response `202 Accepted`**
```json
{ "jobId": "uuid", "seedUrls": ["https://..."] }
```

| Error | Status |
|---|---|
| Missing/empty query | 400 |
| Invalid or private `searxngUrl` | 400 |
| SearXNG returned no results | 422 |
| SearXNG unreachable | 503 |

---

### `POST /api/crawl`

Start a crawl from explicit seed URLs (no SearXNG step). No `summary` is generated.

**Request body**
```json
{
  "seedUrls":       ["https://example.com"],
  "maxDepth":       2,
  "maxUrls":        20,
  "allowedDomains": ""
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `seedUrls` | string[] | yes | 1–10 URLs, http/https only, no private IPs |
| `maxDepth` | number | no | clamped to [1, 5], default 2 |
| `maxUrls` | number | no | clamped to [1, 50], default 20 |
| `allowedDomains` | string | no | comma-separated; blank = seed hostnames only |

**Response `202 Accepted`**
```json
{ "jobId": "uuid" }
```

---

### `GET /api/jobs/:jobId`

Poll job status and all results.

**Response `200 OK`**
```json
{
  "jobId":   "uuid",
  "status":  "running | done | failed",
  "results": [
    {
      "id":          "uuid",
      "url":         "https://example.com",
      "title":       "Example Domain",
      "description": "This domain is for illustrative examples.",
      "statusCode":  200,
      "depth":       0,
      "linksFound":  3,
      "crawledAt":   "12:34:56 PM",
      "state":       "DONE | FAILED | DEAD | FETCHING",
      "renderMode":  "static | js",
      "retryCount":  0,
      "parentUrl":   "https://..."
    }
  ],
  "stats": {
    "totalPages":  10,
    "totalLinks":  87,
    "staticPages": 8,
    "jsPages":     2,
    "failedUrls":  0,
    "deadUrls":    1,
    "duration":    14200
  },
  "summary": "Research summary for: \"query\"\n\nCrawled 8 pages..."
}
```

`summary` only present for jobs started via `/api/search`.

| Error | Status |
|---|---|
| `jobId` not a valid UUID | 400 |
| Job not found | 404 |

---

### `GET /api/jobs/:jobId/stream`

SSE stream. Connect with `EventSource` for live results.

**Events**

| Event | Payload | When |
|---|---|---|
| `record` | Full `UrlRecord` (same shape as `results[]` above) | After each URL completes (including FAILED/DEAD) |
| `done` | `{ results, stats, summary? }` | Crawl finished |
| `crawl_error` | `{ error: string }` | Pipeline crashed |

If you connect after the job is already done, all records are flushed synchronously and the connection closes immediately.

**Example**
```js
const es = new EventSource(`/api/jobs/${jobId}/stream`);

es.addEventListener('record', e => {
  const page = JSON.parse(e.data);
  console.log(page.url, page.state, page.renderMode);
});

es.addEventListener('done', e => {
  const { results, stats, summary } = JSON.parse(e.data);
  console.log(summary);
  es.close();
});

es.addEventListener('crawl_error', e => {
  console.error(JSON.parse(e.data).error);
  es.close();
});
```

---

## Project structure

```
crawler_app/
├── src/                            # React frontend
│   ├── App.tsx                     # Root — SSE wiring, state, layout
│   ├── types.ts                    # CrawlResult, CrawlStats, RenderMode, UrlState
│   └── components/
│       ├── SearchBar.tsx           # Query input, depth selector, advanced options
│       ├── ResultCard.tsx          # Per-URL card — badges, title, description, meta
│       ├── StatsBar.tsx            # Totals + static/js breakdown + escalation %
│       ├── SkeletonCard.tsx        # Loading placeholder while waiting for first result
│       └── EmptyState.tsx          # idle / error / no-results states
│
└── server/
    └── src/
        ├── index.ts                # Express app, CORS, routes, graceful shutdown
        ├── types.ts                # UrlRecord, CrawlJobConfig, CrawlResult, CrawlStats
        ├── logger.ts               # pino logger
        ├── api/
        │   └── crawl-handler.ts    # Route handlers + SSE stream handler
        ├── search/
        │   └── searxng-client.ts   # SearXNG HTTP client — query, dedup, return URLs
        ├── crawler/
        │   ├── static-crawler.ts   # axios fetch — keep-alive pool, charset decode, UA rotation
        │   ├── js-crawler.ts       # Playwright — singleton Chromium, semaphore, networkidle
        │   ├── render-detector.ts  # Heuristic — 4 signals to detect SPA vs static
        │   └── url-normalizer.ts   # Canonical URL + SSRF guard (RFC-1918 + loopback)
        ├── parsers/
        │   ├── content-extractor.ts  # Cheerio (meta/links/JSON-LD) + Readability (article text)
        │   └── robots-cache.ts       # robots.txt fetch, parse, 24h cache per hostname
        ├── middleware/
        │   └── rate-limiter.ts       # Token bucket per domain, exponential backoff + jitter
        ├── frontier/
        │   └── frontier.ts           # Binary min-heap priority queue + SHA-256 seen-set
        ├── pipeline/
        │   └── crawl-pipeline.ts     # Main orchestration loop — all phases in sequence
        ├── storage/
        │   └── job-store.ts          # In-memory Map + EventEmitter, forward-only state machine
        └── synthesis/
            └── synthesizer.ts        # CrawlResult mapper, CrawlStats, extractive summary
```

---

## Definition of Done

- [x] I can type a search query and get results from crawled pages
- [x] JS-heavy pages are handled correctly (auto-detected, auto-escalated to headless Chromium)
- [x] APIs are documented (all endpoints, request/response shapes, error codes)
- [x] Code has been reviewed before submission
- [x] A short README explains how to run the project locally
