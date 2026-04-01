import { useState } from 'react';
import type { FormEvent } from 'react';
import type { CrawlJob, CrawlStatus } from '../types';

interface SearchBarProps {
  onSubmit: (job: CrawlJob) => void;
  status: CrawlStatus;
}

export default function SearchBar({ onSubmit, status }: SearchBarProps) {
  const [url, setUrl] = useState('');
  const [depth, setDepth] = useState(2);
  const [maxUrls, setMaxUrls] = useState(1000);
  const [allowedDomains, setAllowedDomains] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [urlError, setUrlError] = useState('');

  const isLoading = status === 'loading';

  function validate(value: string): boolean {
    try {
      new URL(value);
      setUrlError('');
      return true;
    } catch {
      setUrlError('Enter a valid URL (e.g. https://example.com)');
      return false;
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate(url)) return;
    onSubmit({
      seedUrls: [url.trim()],
      maxDepth: depth,
      maxUrls,
      allowedDomains,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3">
      {/* URL + submit row */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <input
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); if (urlError) validate(e.target.value); }}
            placeholder="https://example.com"
            disabled={isLoading}
            className={`w-full pl-10 pr-4 py-3 rounded-lg border text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 disabled:cursor-not-allowed ${
              urlError ? 'border-red-400 dark:border-red-500' : 'border-gray-200 dark:border-gray-700'
            }`}
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !url}
          className="px-5 py-3 rounded-lg bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
        >
          {isLoading ? (
            <><Spinner />Crawling…</>
          ) : (
            <><SearchIcon />Start Crawl</>
          )}
        </button>
      </div>

      {urlError && (
        <p className="text-xs text-red-500 dark:text-red-400 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {urlError}
        </p>
      )}

      {/* Basic options */}
      <div className="flex items-center gap-6 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span>Depth:</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDepth(d)}
                disabled={isLoading}
                className={`w-8 h-8 rounded text-xs font-medium transition-colors disabled:opacity-50 ${
                  depth === d
                    ? 'bg-violet-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </label>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="ml-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
        >
          <svg className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          Advanced
        </button>
      </div>

      {/* Advanced options */}
      {showAdvanced && (
        <div className="grid grid-cols-2 gap-3 pt-1 border-t border-gray-100 dark:border-gray-800">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Max URLs</label>
            <input
              type="number"
              min={1}
              max={100000}
              value={maxUrls}
              onChange={(e) => setMaxUrls(Number(e.target.value))}
              disabled={isLoading}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              Allowed domains <span className="text-gray-400">(comma-separated, blank = same host)</span>
            </label>
            <input
              type="text"
              value={allowedDomains}
              onChange={(e) => setAllowedDomains(e.target.value)}
              placeholder="example.com, docs.example.com"
              disabled={isLoading}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
            />
          </div>
        </div>
      )}
    </form>
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

function SearchIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}
