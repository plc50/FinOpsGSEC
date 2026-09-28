import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({
  children,
  className,
  as: As = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}) {
  return (
    <As
      className={cn(
        'overflow-hidden rounded-lg border border-line bg-surface shadow-card',
        className,
      )}
    >
      {children}
    </As>
  );
}

export function CardHeader({
  title,
  actions,
  hint,
}: {
  title: ReactNode;
  actions?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-text">{title}</h2>
        {hint ? (
          <p className="truncate text-[11px] text-text-muted">{hint}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('p-3', className)}>{children}</div>;
}
