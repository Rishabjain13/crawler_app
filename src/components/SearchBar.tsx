import { useState } from 'react';
import type { FormEvent } from 'react';
import type { SearchQuery, CrawlStatus } from '../types';

interface SearchBarProps {
  onSubmit: (job: SearchQuery) => void;
  onCancel: () => void;
  status: CrawlStatus;
}

export default function SearchBar({ onSubmit, onCancel, status }: SearchBarProps) {
  const [query,          setQuery]          = useState('');
  const [searxngUrl,     setSearxngUrl]     = useState('http://localhost:8888');
  const [depth,          setDepth]          = useState(1);
  const [maxUrls,        setMaxUrls]        = useState(20);
  const [allowedDomains, setAllowedDomains] = useState('');
  const [showAdvanced,   setShowAdvanced]   = useState(false);

  const isLoading = status === 'loading';

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    onSubmit({ query: query.trim(), searxngUrl, maxDepth: depth, maxUrls, allowedDomains });
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3">
      {/* Query input + action buttons */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <SearchIcon className="w-4 h-4 text-gray-400" />
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What do you want to research? e.g. &quot;best open-source LLMs 2024&quot;"
            disabled={isLoading}
            className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {isLoading ? (
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-3 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <StopIcon />
            Cancel
          </button>
        ) : (
          <button
            type="submit"
            disabled={!query.trim()}
            className="px-5 py-3 rounded-lg bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
          >
            <SearchIcon className="w-4 h-4" />
            Search
          </button>
        )}
      </div>

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
          <svg
            className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          Advanced
        </button>
      </div>

      {/* Advanced options */}
      {showAdvanced && (
        <div className="grid grid-cols-1 gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              SearXNG URL <span className="text-gray-400">(self-hosted instance)</span>
            </label>
            <input
              type="text"
              value={searxngUrl}
              onChange={(e) => setSearxngUrl(e.target.value)}
              placeholder="http://localhost:8080"
              disabled={isLoading}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Max URLs</label>
              <input
                type="number"
                min={1}
                max={50}
                value={maxUrls}
                onChange={(e) => setMaxUrls(Number(e.target.value))}
                disabled={isLoading}
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                Allowed domains <span className="text-gray-400">(blank = all)</span>
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
        </div>
      )}
    </form>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
    </svg>
  );
}
