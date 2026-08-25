"use client";

export function LoadingSkeleton({
  rows = 3,
  height = 200,
}: {
  rows?: number;
  height?: number;
}) {
  return (
    <div className="animate-pulse space-y-3">
      <div className="rounded-lg bg-white/5" style={{ height }} />
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-4 rounded bg-white/5"
          style={{ width: `${80 - i * 15}%` }}
        />
      ))}
    </div>
  );
}

export function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
      <p className="text-sm text-red-400">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 text-xs font-medium text-red-300 underline hover:text-red-200"
        >
          Retry
        </button>
      )}
    </div>
  );
}
