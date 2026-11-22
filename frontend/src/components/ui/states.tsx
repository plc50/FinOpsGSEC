import type { ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { cn } from '@/lib/cn';

/**
 * Error state (§8): shows the backend human message plus the contract `code`.
 * Handles 403 forbidden_scope as an explicit access-denied (§3/§10).
 */
export function ErrorState({
  title = 'Unable to load data',
  error,
  onRetry,
  className,
}: {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const apiError = error instanceof ApiError ? error : null;
  const message =
    apiError?.message ??
    (error instanceof Error ? error.message : 'Unexpected error.');
  const code = apiError?.code;
  const forbidden = apiError?.isForbiddenScope;

  return (
    <div
      role="alert"
      className={cn(
        'border border-signal-red/40 bg-signal-red/5 p-4 rounded-sm',
        className,
      )}
    >
      <p className="text-sm font-medium text-signal-red">
        {forbidden ? 'Access denied' : title}
      </p>
      <p className="mt-1 text-sm text-text">{message}</p>
      {code ? (
        <p className="mt-1 font-mono text-xs text-text-secondary">
          code: {code}
        </p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 border border-line bg-surface-raised px-2 py-1 text-xs text-text hover:border-line-strong"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-24 items-center justify-center border border-dashed border-line p-6 text-center text-sm text-text-secondary rounded-sm',
        className,
      )}
    >
      {message}
    </div>
  );
}

/**
 * Generic query-state renderer. Keeps loading/empty/error/ready handling (§8)
 * consistent across every page and avoids layout shift by delegating the
 * loading fallback (which should reserve final height).
 */
export function QueryState<T>({
  isPending,
  isError,
  error,
  data,
  loading,
  isEmpty,
  emptyMessage,
  onRetry,
  errorTitle,
  children,
}: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
  loading: ReactNode;
  isEmpty?: (data: T) => boolean;
  emptyMessage?: string;
  onRetry?: () => void;
  errorTitle?: string;
  children: (data: T) => ReactNode;
}) {
  if (isPending) return <>{loading}</>;
  if (isError) return <ErrorState title={errorTitle} error={error} onRetry={onRetry} />;
  if (data === undefined) return <>{loading}</>;
  if (isEmpty && isEmpty(data) && emptyMessage) {
    return <EmptyState message={emptyMessage} />;
  }
  return <>{children(data)}</>;
}
