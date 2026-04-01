import { useState, useRef } from 'react';
import SearchBar   from './components/SearchBar';
import ResultCard  from './components/ResultCard';
import SkeletonCard from './components/SkeletonCard';
import StatsBar    from './components/StatsBar';
import EmptyState  from './components/EmptyState';
import type { CrawlJob, CrawlResult, CrawlStats, CrawlStatus } from './types';

export default function App() {
  const [status,   setStatus]   = useState<CrawlStatus>('idle');
  const [results,  setResults]  = useState<CrawlResult[]>([]);
  const [stats,    setStats]    = useState<CrawlStats | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [filter,   setFilter]   = useState('');
  // Hold a ref to the active EventSource so we can cancel it
  const esRef = useRef<EventSource | null>(null);

  function cancelCrawl() {
    esRef.current?.close();
    esRef.current = null;
    setStatus('idle');
  }

  async function handleCrawl(job: CrawlJob) {
    // Tear down any in-flight crawl
    esRef.current?.close();
    esRef.current = null;

    setStatus('loading');
    setResults([]);
    setStats(null);
    setErrorMsg('');
    setFilter('');

    // ── 1. Start the job (POST /api/crawl) ──────────────────────────────────
    let jobId: string;
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch('/api/crawl', {
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
      jobId = ((await res.json()) as { jobId: string }).jobId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start crawl';
      setErrorMsg(msg.slice(0, 200));
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
        const payload = JSON.parse(e.data) as { results: CrawlResult[]; stats: CrawlStats };
        // Replace accumulated records with the synthesized final list (correct order)
        setResults(payload.results);
        setStats(payload.stats);
      } catch { /* keep accumulated results */ }
      setStatus('success');
      es.close();
      esRef.current = null;
    });

    es.addEventListener('crawl_error', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { error?: string };
        setErrorMsg((payload.error ?? 'Crawl failed').slice(0, 200));
      } catch {
        setErrorMsg('Crawl failed');
      }
      setStatus('error');
      es.close();
      esRef.current = null;
    });

    // Native connection-level error (network drop, server restart, etc.)
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
            Crawlee + Playwright · Redis frontier · PostgreSQL state machine
          </p>
        </header>

        {/* Search */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 mb-6 shadow-sm">
          <SearchBar onSubmit={handleCrawl} onCancel={cancelCrawl} status={status} />
        </div>

        {/* States */}
        {status === 'idle'  && !showResults && <EmptyState type="idle" />}
        {status === 'error' && <EmptyState type="error" message={errorMsg} />}
        {status === 'success' && results.length === 0 && <EmptyState type="no-results" />}

        {/* Skeleton while waiting for first result */}
        {showSkeleton && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-violet-600 dark:text-violet-400 mb-4">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="font-medium">Crawling pages…</span>
              <span className="text-gray-400 dark:text-gray-500 text-xs">routing through frontier</span>
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
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="font-medium">Crawling… {results.length} page{results.length !== 1 ? 's' : ''} so far</span>
              </div>
            )}

            {stats && <StatsBar stats={stats} resultCount={filtered.length} />}

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
