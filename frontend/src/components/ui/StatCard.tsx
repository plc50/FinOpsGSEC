import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Skeleton } from './Skeleton';
import type { SignalTone } from '@/lib/signals';

const VALUE_TONE: Record<SignalTone, string> = {
  green: 'text-signal-green',
  amber: 'text-signal-amber',
  red: 'text-signal-red',
  neutral: 'text-text',
};

/** Compact KPI card. Fixed min-height so loading skeleton doesn't shift. */
export function StatCard({
  label,
  value,
  sub,
  tone = 'neutral',
  loading = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: SignalTone;
  loading?: boolean;
}) {
  return (
    <div className="flex min-h-[84px] flex-col justify-between rounded-lg border border-line bg-surface p-3 shadow-card">
      <span className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
        {label}
      </span>
      {loading ? (
        <Skeleton height={22} className="mt-2 w-3/4" />
      ) : (
        <span
          className={cn(
            'mt-1 text-2xl font-semibold leading-none tracking-tight tabular',
            VALUE_TONE[tone],
          )}
        >
          {value}
        </span>
      )}
      {sub && !loading ? (
        <span className="mt-1 text-[11px] text-text-muted">{sub}</span>
      ) : null}
    </div>
  );
}
