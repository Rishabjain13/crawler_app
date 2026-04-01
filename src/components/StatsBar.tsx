import type { CrawlStats } from '../types';

interface StatsBarProps {
  stats: CrawlStats;
  resultCount: number;
}

export default function StatsBar({ stats, resultCount }: StatsBarProps) {
  const duration =
    stats.duration >= 1000
      ? `${(stats.duration / 1000).toFixed(1)}s`
      : `${stats.duration}ms`;

  return (
    <div className="mb-4 space-y-2">
      {/* Primary stats */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800 pb-3">
        <Stat label="Pages" value={stats.totalPages} />
        <Stat label="Links found" value={stats.totalLinks} />
        <Stat
          label="Failed"
          value={stats.failedUrls}
          valueClass={stats.failedUrls > 0 ? 'text-red-500' : undefined}
        />
        <Stat
          label="Dead"
          value={stats.deadUrls}
          valueClass={stats.deadUrls > 0 ? 'text-gray-400' : undefined}
        />
        <Stat label="Duration" value={duration} />
        <span className="ml-auto text-xs">
          Showing{' '}
          <strong className="text-gray-700 dark:text-gray-300">{resultCount}</strong>{' '}
          result{resultCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Render-mode breakdown */}
      {(stats.staticPages + stats.jsPages) > 0 && (
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span>Render mode:</span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-sky-400" />
            Static — <strong className="text-gray-700 dark:text-gray-300">{stats.staticPages}</strong>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
            JS (Playwright) — <strong className="text-gray-700 dark:text-gray-300">{stats.jsPages}</strong>
          </span>
          {stats.jsPages > 0 && (
            <span className="text-gray-400">
              ({Math.round((stats.jsPages / (stats.staticPages + stats.jsPages)) * 100)}% escalated)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string | number;
  valueClass?: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span>{label}:</span>
      <strong className={`text-gray-800 dark:text-gray-200 ${valueClass ?? ''}`}>{value}</strong>
    </span>
  );
}
