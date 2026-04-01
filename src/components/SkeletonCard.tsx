export default function SkeletonCard({ index }: { index: number }) {
  return (
    <div
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-md bg-gray-200 dark:bg-gray-800 animate-pulse shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex justify-between gap-2">
            <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-2/3" />
            <div className="h-4 w-10 bg-gray-200 dark:bg-gray-800 rounded animate-pulse shrink-0" />
          </div>
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-1/2" />
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-full" />
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded animate-pulse w-4/5" />
          <div className="flex gap-3 pt-1">
            <div className="h-3 w-14 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
            <div className="h-3 w-14 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
            <div className="h-3 w-20 bg-gray-200 dark:bg-gray-800 rounded animate-pulse ml-auto" />
          </div>
        </div>
      </div>
    </div>
  );
}
