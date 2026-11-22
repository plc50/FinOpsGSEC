import { cn } from '@/lib/cn';

/** Fixed-height skeleton block; used to avoid layout shift (§8). */
export function Skeleton({
  className,
  height,
}: {
  className?: string;
  height?: number | string;
}) {
  return (
    <div
      className={cn('skeleton rounded-sm', className)}
      style={height !== undefined ? { height } : undefined}
    />
  );
}

export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} className={i === lines - 1 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  );
}
