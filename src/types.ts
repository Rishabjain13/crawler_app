export type UrlState = 'DISCOVERED' | 'QUEUED' | 'FETCHING' | 'DONE' | 'FAILED' | 'DEAD';
export type RenderMode = 'static' | 'js';
export type JobState = 'idle' | 'running' | 'done' | 'failed';
export type CrawlStatus = 'idle' | 'loading' | 'success' | 'error';

export interface CrawlJob {
  seedUrls: string[];
  maxDepth: number;
  maxUrls: number;
  allowedDomains: string; // comma-separated input string
}

export interface CrawlResult {
  id: string;
  url: string;
  title: string;
  description: string;
  statusCode: number;
  depth: number;
  linksFound: number;
  crawledAt: string;
  state: UrlState;
  renderMode: RenderMode;
  retryCount: number;
  parentUrl?: string;
}

export interface CrawlStats {
  totalPages: number;
  totalLinks: number;
  staticPages: number;
  jsPages: number;
  failedUrls: number;
  deadUrls: number;
  duration: number; // ms
}
