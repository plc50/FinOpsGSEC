import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Right-align numeric columns. */
  align?: 'left' | 'right';
  className?: string;
}

/**
 * Column-config driven table. Renders a dense <table> on >= md and collapses to
 * one card per row (label/value pairs) on narrow screens (§1.1.2, §7.2/§7.3).
 */
export function ResponsiveTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  rowClassName,
  emptyMessage,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  emptyMessage?: string;
}) {
  if (rows.length === 0 && emptyMessage) {
    return (
      <div className="border border-dashed border-line p-6 text-center text-sm text-text-secondary rounded-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'whitespace-nowrap px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary',
                    c.align === 'right' && 'text-right',
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={getRowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-line/60',
                  onRowClick && 'cursor-pointer hover:bg-surface-raised',
                  rowClassName?.(row),
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'whitespace-nowrap px-2 py-1.5 align-middle',
                      c.align === 'right' && 'text-right tabular',
                      c.className,
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards */}
      <div className="space-y-2 md:hidden">
        {rows.map((row, i) => (
          <div
            key={getRowKey(row, i)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(
              'border border-line bg-surface p-2.5 rounded-sm',
              onRowClick && 'cursor-pointer active:bg-surface-raised',
              rowClassName?.(row),
            )}
          >
            <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-2 gap-y-1">
              {columns.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="truncate text-[11px] uppercase tracking-wide text-text-secondary">
                    {c.header}
                  </dt>
                  <dd className="min-w-0 break-words text-right text-sm tabular">
                    {c.render(row)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}
