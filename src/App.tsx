import { useState, useRef } from 'react';
import SearchBar   from './components/SearchBar';
import ResultCard  from './components/ResultCard';
import SkeletonCard from './components/SkeletonCard';
import StatsBar    from './components/StatsBar';
import EmptyState  from './components/EmptyState';
import type { SearchQuery, CrawlResult, CrawlStats, CrawlStatus } from './types';

export default function App() {
  const [status,   setStatus]   = useState<CrawlStatus>('idle');
  const [results,  setResults]  = useState<CrawlResult[]>([]);
  const [stats,    setStats]    = useState<CrawlStats | null>(null);
  const [summary,  setSummary]  = useState<string>('');
  const [errorMsg, setErrorMsg] = useState('');
  const [filter,   setFilter]   = useState('');
  const [phase,    setPhase]    = useState<'searching' | 'crawling'>('searching');
  const esRef = useRef<EventSource | null>(null);

  function cancelCrawl() {
    esRef.current?.close();
    esRef.current = null;
    setStatus('idle');
  }

  async function handleSearch(job: SearchQuery) {
    // Tear down any in-flight crawl
    esRef.current?.close();
    esRef.current = null;

    setStatus('loading');
    setResults([]);
    setStats(null);
    setSummary('');
    setErrorMsg('');
    setFilter('');
    setPhase('searching');

    // ── 1. Discover seed URLs via SearXNG (POST /api/search) ────────────────
    let jobId: string;
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch('/api/search', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(job),
        signal:  controller.signal,
      });
      clearTimeout(tid);

      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error((payload as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { jobId: string; seedUrls?: string[] };
      jobId = data.jobId;
      setPhase('crawling');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start search';
      setErrorMsg(msg.slice(0, 300));
      setStatus('error');
      return;
    }

    // ── 2. Stream results via SSE (/api/jobs/:jobId/stream) ─────────────────
    const es = new EventSource(`/api/jobs/${jobId}/stream`);
    esRef.current = es;

    es.addEventListener('record', (e: MessageEvent) => {
      try {
        const record = JSON.parse(e.data) as CrawlResult;
        setResults(prev => [...prev, record]);
      } catch { /* ignore malformed SSE frame */ }
    });

    es.addEventListener('done', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as {
          results: CrawlResult[];
          stats:   CrawlStats;
          summary?: string;
        };
        setResults(payload.results);
        setStats(payload.stats);
        if (payload.summary) setSummary(payload.summary);
      } catch { /* keep accumulated results */ }
      setStatus('success');
      es.close();
      esRef.current = null;
    });

    es.addEventListener('crawl_error', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { error?: string };
        setErrorMsg((payload.error ?? 'Crawl failed').slice(0, 300));
      } catch {
        setErrorMsg('Crawl failed');
      }
      setStatus('error');
      es.close();
      esRef.current = null;
    });

    es.onerror = () => {
      if (status !== 'success') {
        setErrorMsg('Connection lost — the server may have restarted');
        setStatus('error');
      }
      es.close();
      esRef.current = null;
    };
  }

  const filtered = filter
    ? results.filter(
        r =>
          r.url.toLowerCase().includes(filter.toLowerCase()) ||
          r.title.toLowerCase().includes(filter.toLowerCase()),
      )
    : results;

  const isLoading    = status === 'loading';
  const showSkeleton = isLoading && results.length === 0;
  const showResults  = results.length > 0;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
            </div>
            <h1 className="text-xl font-bold tracking-tight">WebCrawler</h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 ml-9">
            SearXNG · Playwright · Open-source search pipeline
          </p>
        </header>

        {/* Search */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 mb-6 shadow-sm">
          <SearchBar onSubmit={handleSearch} onCancel={cancelCrawl} status={status} />
        </div>

        {/* States */}
        {status === 'idle'  && !showResults && <EmptyState type="idle" />}
        {status === 'error' && <EmptyState type="error" message={errorMsg} />}
        {status === 'success' && results.length === 0 && <EmptyState type="no-results" />}

        {/* Skeleton while waiting for first result */}
        {showSkeleton && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 mb-4">
              <Spinner />
              <span className="font-medium">
                {phase === 'searching' ? 'Querying SearXNG…' : 'Crawling pages…'}
              </span>
              <span className="text-gray-400 dark:text-gray-500 text-xs">
                {phase === 'searching' ? 'discovering seed URLs' : 'routing through frontier'}
              </span>
            </div>
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} index={i} />)}
          </div>
        )}

        {/* Live + final results */}
        {showResults && (
          <>
            {/* In-progress counter */}
            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 mb-4">
                <Spinner />
                <span className="font-medium">
                  Crawling… {results.length} page{results.length !== 1 ? 's' : ''} so far
                </span>
              </div>
            )}

            {stats && <StatsBar stats={stats} resultCount={filtered.length} />}

            {/* Research summary */}
            {summary && (
              <details className="mb-4 bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl overflow-hidden" open>
                <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-violet-700 dark:text-violet-300 select-none flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Research Summary
                </summary>
                <pre className="px-4 pb-4 text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                  {summary}
                </pre>
              </details>
            )}

            {/* Filter */}
            <div className="relative mb-4">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
                </svg>
              </div>
              <input
                type="text"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Filter by URL or title…"
                className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              {filter && (
                <button
                  onClick={() => setFilter('')}
                  className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>

            {filtered.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-10">No results match "{filter}"</p>
            ) : (
              <div className="space-y-3">
                {filtered.map((result, i) => (
                  <ResultCard key={result.id} result={result} index={i} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
