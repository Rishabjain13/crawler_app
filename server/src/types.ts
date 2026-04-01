// ── URL / Job state machines ────────────────────────────────────────────────
export type UrlState   = 'DISCOVERED' | 'QUEUED' | 'FETCHING' | 'DONE' | 'FAILED' | 'DEAD';
export type RenderMode = 'static' | 'js';

// ── Internal record stored per crawled URL ──────────────────────────────────
export interface UrlRecord {
  id:          string;
  url:         string;
  urlHash:     string;
  jobId:       string;
  state:       UrlState;
  depth:       number;
  retryCount:  number;
  renderMode:  RenderMode;
  parentUrl?:  string;
  title?:      string;
  description?:string;
  excerpt?:    string;  // first 500 chars of extracted text content
  statusCode?: number;
  linksFound?: number;
  fetchedAt?:  string;
  error?:      string;
}

// ── Job configuration (mirrors frontend CrawlJob) ──────────────────────────
export interface CrawlJobConfig {
  seedUrls:       string[];
  maxDepth:       number;
  maxUrls:        number;
  allowedDomains: string; // comma-separated, blank = seed hostname
  query?:         string; // original search query (set by /api/search)
}

export interface CrawlJobState {
  id:          string;
  config:      CrawlJobConfig;
  status:      'running' | 'done' | 'failed';
  startedAt:   number;
  finishedAt?: number;
}

// ── What content-extractor returns ─────────────────────────────────────────
export interface ExtractedContent {
  title:         string;
  description:   string;
  textContent:   string;
  outgoingLinks: string[];
  schemaOrgData: unknown[];
  metaTags:      Record<string, string>;
}

// ── API response shape (matches frontend src/types.ts exactly) ─────────────
export interface CrawlResult {
  id:          string;
  url:         string;
  title:       string;
  description: string;
  statusCode:  number;
  depth:       number;
  linksFound:  number;
  crawledAt:   string;
  state:       UrlState;
  renderMode:  RenderMode;
  retryCount:  number;
  parentUrl?:  string;
}

export interface CrawlStats {
  totalPages:  number;
  totalLinks:  number;
  staticPages: number;
  jsPages:     number;
  failedUrls:  number;
  deadUrls:    number;
  duration:    number; // ms
}
