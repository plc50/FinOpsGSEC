import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { TONE_CLASSES, type SignalTone } from '@/lib/signals';

export function Badge({
  children,
  tone = 'neutral',
  className,
  title,
}: {
  children: ReactNode;
  tone?: SignalTone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A tiny status dot for compact contexts. */
export function Dot({ tone = 'neutral' }: { tone?: SignalTone }) {
  const color =
    tone === 'green'
      ? 'bg-signal-green'
      : tone === 'amber'
        ? 'bg-signal-amber'
        : tone === 'red'
          ? 'bg-signal-red'
          : 'bg-text-muted';
  return <span className={cn('inline-block h-2 w-2 rounded-full', color)} />;
}
