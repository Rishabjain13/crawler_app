import type { CrawlResult, UrlState, RenderMode } from '../types';

interface ResultCardProps {
  result: CrawlResult;
  index: number;
}

const httpStatusColor: Record<number, string> = {
  200: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  301: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  302: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  404: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  500: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
};

function httpColor(code: number) {
  return httpStatusColor[code] ?? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
}

const urlStateStyle: Record<UrlState, string> = {
  DISCOVERED: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  QUEUED:     'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
  FETCHING:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  DONE:       'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  FAILED:     'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  DEAD:       'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-500',
};

const renderModeStyle: Record<RenderMode, { label: string; cls: string }> = {
  static: { label: 'Static', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400' },
  js:     { label: 'JS', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' },
};

export default function ResultCard({ result, index }: ResultCardProps) {
  const hostname = (() => {
    try { return new URL(result.url).hostname; }
    catch { return result.url; }
  })();

  const rm = renderModeStyle[result.renderMode];

  return (
    <div
      className="group bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-violet-300 dark:hover:border-violet-700 hover:shadow-md transition-all duration-150"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-start gap-3">
        {/* Favicon placeholder */}
        <div className="mt-0.5 w-8 h-8 rounded-md bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
          <span className="text-xs font-bold text-violet-600 dark:text-violet-400 uppercase">
            {hostname.charAt(0)}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate leading-snug">
              {result.title || 'Untitled Page'}
            </h3>
            {/* Badges */}
            <div className="flex items-center gap-1 shrink-0">
              <span className={`text-xs font-mono font-medium px-1.5 py-0.5 rounded ${httpColor(result.statusCode)}`}>
                {result.statusCode}
              </span>
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${urlStateStyle[result.state]}`}>
                {result.state}
              </span>
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${rm.cls}`}>
                {result.renderMode === 'js' ? (
                  <span title="Rendered with Playwright (headless browser)">{rm.label} ⚡</span>
                ) : rm.label}
              </span>
            </div>
          </div>

          {/* URL */}
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-violet-600 dark:text-violet-400 hover:underline truncate block mb-2"
          >
            {result.url}
          </a>

          {/* Description */}
          {result.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-3">
              {result.description}
            </p>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
              </svg>
              Depth {result.depth}
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              {result.linksFound} links
            </span>
            {result.retryCount > 0 && (
              <span className="text-amber-500 dark:text-amber-400 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {result.retryCount} retr{result.retryCount === 1 ? 'y' : 'ies'}
              </span>
            )}
            {result.parentUrl && (
              <span className="truncate max-w-[160px]" title={`Parent: ${result.parentUrl}`}>
                ↑ {new URL(result.parentUrl).pathname || '/'}
              </span>
            )}
            <span className="ml-auto">{result.crawledAt}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
