# WebCrawler

A self-hosted research tool that takes a natural language query, discovers seed URLs via **SearXNG**, crawls those pages (with full **Playwright** support for JavaScript-rendered content), extracts text, and synthesizes a ranked summary — no Google Search API, no OpenAI, no external AI services.

---

## How it works

```
User query
  └─ POST /api/search
      └─ SearXNG  →  up to 10 seed URLs
          └─ Crawl frontier (BFS, depth-limited)
              ├─ Static fetch (axios)       — fast HTML pages
              └─ Playwright escalation      — JS-rendered SPAs
                  └─ extractContent()       — title, description, text, links
                      └─ buildSummary()     — extractive ranked summary
                          └─ SSE stream → frontend
```

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 18+ | Required |
| Docker | any | For SearXNG |
| Playwright Chromium | auto-installed | `npx playwright install chromium` |

---

## Local setup

### 1. Clone and install

```powershell
git clone <repo-url>
cd crawler_app

# Frontend deps
npm install

# Backend deps
cd server
npm install
npx playwright install chromium
cd ..
```

### 2. Start SearXNG

```powershell
docker run -d -p 8888:8080 --name searxng searxng/searxng
```

Enable JSON format (required once after first run):

```powershell
docker exec searxng python3 -c "
txt = open('/etc/searxng/settings.yml').read()
txt = txt.replace('  formats:\n    - html', '  formats:\n    - html\n    - json')
open('/etc/searxng/settings.yml', 'w').write(txt)
"
docker restart searxng
```

Verify it works:

```powershell
curl "http://localhost:8888/search?q=test&format=json"
```

### 3. Start the backend

```powershell
cd server
$env:PORT=3001; npm run dev
```

### 4. Start the frontend

```powershell
# in a second terminal, from crawler_app/
npm run dev
```

Open **http://localhost:5173** (or 5174 if 5173 is taken).

---

## Environment variables

All optional — defaults work for local development.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend server port |
| `SEARXNG_URL` | `http://localhost:8080` | SearXNG base URL (overrides frontend input) |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:5174` | CORS allowlist (comma-separated) |

---

## API Reference

### `POST /api/search`

Accepts a natural language query, queries SearXNG for seed URLs, and starts a crawl job.

**Request**

```json
{
  "query":          "best open-source LLMs 2024",
  "searxngUrl":     "http://localhost:8888",
  "maxDepth":       1,
  "maxUrls":        20,
  "allowedDomains": ""
}
```

| Field | Type | Required | Default | Constraints |
|-------|------|----------|---------|-------------|
| `query` | string | yes | — | max 500 chars |
| `searxngUrl` | string | no | env `SEARXNG_URL` or `localhost:8080` | valid http/https URL |
| `maxDepth` | number | no | `1` | clamped to [1, 5] |
| `maxUrls` | number | no | `20` | clamped to [1, 50] |
| `allowedDomains` | string | no | `""` | comma-separated hostnames; blank = all |

**Response `202 Accepted`**

```json
{
  "jobId":    "550e8400-e29b-41d4-a716-446655440000",
  "seedUrls": ["https://example.com", "https://other.com"]
}
```

**Error responses**

| Status | Reason |
|--------|--------|
| `400` | `query` is missing or empty |
| `422` | SearXNG returned zero results |
| `503` | SearXNG instance unreachable |

---

### `POST /api/crawl`

Start a crawl from explicit seed URLs (no SearXNG step).

**Request**

```json
{
  "seedUrls":       ["https://example.com"],
  "maxDepth":       2,
  "maxUrls":        20,
  "allowedDomains": ""
}
```

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `seedUrls` | string[] | yes | 1–10 URLs, http/https only, no private IPs |
| `maxDepth` | number | no | clamped to [1, 5] |
| `maxUrls` | number | no | clamped to [1, 50] |
| `allowedDomains` | string | no | comma-separated; blank = seed hostnames only |

**Response `202 Accepted`**

```json
{ "jobId": "550e8400-e29b-41d4-a716-446655440000" }
```

---

### `GET /api/jobs/:jobId`

Poll job status and get all accumulated results.

**Response `200 OK`**

```json
{
  "jobId":   "550e8400-e29b-41d4-a716-446655440000",
  "status":  "running",
  "results": [
    {
      "id":          "uuid",
      "url":         "https://example.com",
      "title":       "Example Domain",
      "description": "This domain is for use in examples.",
      "statusCode":  200,
      "depth":       0,
      "linksFound":  3,
      "crawledAt":   "12:34:56",
      "state":       "DONE",
      "renderMode":  "static",
      "retryCount":  0,
      "parentUrl":   null
    }
  ],
  "stats": {
    "totalPages":  1,
    "totalLinks":  3,
    "staticPages": 1,
    "jsPages":     0,
    "failedUrls":  0,
    "deadUrls":    0,
    "duration":    1243
  },
  "summary": "Research summary for: \"example query\"\n\nFound 1 page..."
}
```

**Error responses**

| Status | Reason |
|--------|--------|
| `400` | `jobId` is not a valid UUID |
| `404` | Job not found |

---

### `GET /api/jobs/:jobId/stream`

Server-Sent Events (SSE) stream for live results as pages are crawled.

**Events**

| Event name | Payload | When |
|------------|---------|------|
| `record` | `UrlRecord` (single page result) | After each URL completes |
| `done` | `{ results, stats, summary }` | When crawl finishes |
| `crawl_error` | `{ error: string }` | On pipeline failure |

**Example (JavaScript)**

```js
const es = new EventSource(`/api/jobs/${jobId}/stream`);

es.addEventListener('record', e => {
  const page = JSON.parse(e.data);
  console.log(page.url, page.state);
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

### `GET /api/health`

Liveness probe.

```json
{ "ok": true, "ts": "2024-01-01T00:00:00.000Z" }
```

---

## Definition of Done

- [x] Type a search query → get results from crawled pages
- [x] JS-heavy pages handled via Playwright (auto-detected, auto-escalated)
- [x] All APIs documented with request/response schemas
- [x] README explains how to run locally

## Technical requirements

- [x] JavaScript-rendered pages via Playwright (headless Chromium)
- [x] No Google Search API, no OpenAI API
- [x] SearXNG as self-hosted search entry point for seed URLs
- [x] Crawl → extract page content → synthesize response
- [x] Graceful error handling: timeouts, blocked pages, empty results

---

## Project structure

```
crawler_app/
├── src/                        # React frontend (Vite + TailwindCSS)
│   ├── App.tsx                 # SSE streaming, state management
│   ├── components/
│   │   ├── SearchBar.tsx       # Query input + SearXNG URL config
│   │   ├── ResultCard.tsx      # Per-URL result card
│   │   ├── StatsBar.tsx        # Aggregate stats display
│   │   └── EmptyState.tsx      # Idle / error / no-results states
│   └── types.ts
│
└── server/                     # Express backend (Node.js + TypeScript)
    └── src/
        ├── index.ts            # Express app, CORS, routes
        ├── api/
        │   └── crawl-handler.ts   # POST /api/search, /api/crawl, GET /api/jobs
        ├── search/
        │   └── searxng-client.ts  # SearXNG HTTP client
        ├── crawler/
        │   ├── static-crawler.ts  # axios HTTP fetch
        │   ├── js-crawler.ts      # Playwright headless browser
        │   └── render-detector.ts # Heuristic JS vs static detection
        ├── parsers/
        │   ├── content-extractor.ts  # Cheerio + Readability
        │   └── robots-cache.ts       # robots.txt fetch + 24h cache
        ├── middleware/
        │   └── rate-limiter.ts    # Token bucket per domain
        ├── frontier/
        │   └── frontier.ts        # In-memory min-heap priority queue
        ├── pipeline/
        │   └── crawl-pipeline.ts  # Main orchestration loop
        ├── storage/
        │   └── job-store.ts       # In-memory job state + EventEmitter
        └── synthesis/
            └── synthesizer.ts     # Extractive summary (no LLM)
```
